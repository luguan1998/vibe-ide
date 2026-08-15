/** Persistent PTY session over the subprocess seam's terminal primitive. */
import { Buffer } from 'node:buffer';
import { TerminalError } from '@deepseek-ai/dsh-terminal';
import { CONTROLLED_PROMPT, TerminalSanitizer } from "./sanitize.js";
function utf8Tail(text, maxBytes) {
    if (Buffer.byteLength(text) <= maxBytes)
        return { text, truncated: false };
    const chars = Array.from(text);
    let bytes = 0;
    let start = chars.length;
    while (start > 0) {
        const next = Buffer.byteLength(chars[start - 1]);
        if (bytes + next > maxBytes)
            break;
        bytes += next;
        start -= 1;
    }
    return { text: chars.slice(start).join(''), truncated: true };
}
class BoundedTextBuffer {
    maxBytes;
    maxLines;
    value = '';
    dropped = false;
    constructor(maxBytes, maxLines) {
        this.maxBytes = maxBytes;
        this.maxLines = maxLines;
    }
    append(text) {
        if (text.length === 0)
            return;
        this.value += text;
        if (this.maxLines !== undefined) {
            const lines = this.value.split('\n');
            if (lines.length > this.maxLines) {
                this.value = lines.slice(lines.length - this.maxLines).join('\n');
                this.dropped = true;
            }
        }
        const tail = utf8Tail(this.value, this.maxBytes);
        this.value = tail.text;
        this.dropped ||= tail.truncated;
    }
    consume() {
        const delta = this.value;
        const truncated = this.dropped;
        this.value = '';
        this.dropped = false;
        return { delta, truncated };
    }
    snapshot() {
        return { text: this.value, truncated: this.dropped };
    }
}
class LocalSendOperation {
    startedAt;
    onCancel;
    output;
    promise;
    finished = false;
    cancellationRequested = false;
    initialForegroundLeftWait;
    initialForegroundPgid;
    constructor(maxBytes, startedAt, onCancel) {
        this.startedAt = startedAt;
        this.onCancel = onCancel;
        this.output = new BoundedTextBuffer(maxBytes);
        this.promise = Promise.withResolvers();
        this.initialForegroundLeftWait = true;
    }
    get done() {
        return this.promise.promise;
    }
    get settled() {
        return this.finished;
    }
    get cancelRequested() {
        return this.cancellationRequested;
    }
    append(text) {
        if (!this.finished)
            this.output.append(text);
    }
    settle(waitReason, sessionStatus, inheritedTruncation) {
        if (this.finished)
            return;
        this.finished = true;
        const read = this.output.snapshot();
        this.promise.resolve({
            viewport: read.text,
            waitReason,
            sessionStatus,
            truncated: read.truncated || inheritedTruncation,
        });
    }
    fail(error) {
        if (this.finished)
            return;
        this.finished = true;
        this.promise.reject(error);
    }
    readOutput() {
        return this.output.consume();
    }
    setInitialForeground(foreground) {
        this.initialForegroundPgid = foreground?.processGroupId;
        this.initialForegroundLeftWait = foreground?.inputWaiting !== true;
    }
    acceptsStdinWait(pgid, waiting) {
        // The same group may still expose the wait that existed before terminal.write.
        // Observe every poll so a departure before the exact-settlement threshold
        // still makes a later return to that wait post-write evidence.
        if (pgid !== this.initialForegroundPgid)
            return waiting;
        if (!waiting)
            this.initialForegroundLeftWait = true;
        return waiting && this.initialForegroundLeftWait;
    }
    cancel() {
        if (this.finished)
            return false;
        this.cancellationRequested = true;
        this.onCancel();
        return true;
    }
}
/** Backend session wrapping one provider-owned terminal process. */
export class LocalPtySession {
    terminal;
    config;
    motd = '';
    pid;
    decoder = new TextDecoder();
    sanitizer;
    scrollback;
    outputEnded = Promise.withResolvers();
    completion;
    statusValue = { kind: 'running' };
    // TODO(pty-send-state-consolidation): Fold the per-send fields below
    // (active/activeTimer/activeDeadlineTimer/activeAbort/interrupting/
    // activeWrite/pollingReady/polling) into one send-lifecycle owner; the
    // cancellation/readiness interplay now has enough pinned tests to carry
    // that refactor safely.
    active;
    activeTimer;
    activeDeadlineTimer;
    activeAbort;
    interrupting;
    activeWrite;
    pollingReady;
    polling = false;
    promptSeen = false;
    promptTextSeen = false;
    promptTail = '';
    shellPgid;
    initializing = false;
    lastOutputAt = Date.now();
    closing = false;
    closePromise;
    transportFailure;
    constructor(terminal, config) {
        this.terminal = terminal;
        this.config = config;
        this.pid = terminal.pid;
        this.sanitizer = new TerminalSanitizer(config.maxReadBytes);
        this.scrollback = new BoundedTextBuffer(config.scrollbackMaxBytes, config.scrollbackLines);
        terminal.output.on('data', this.onTerminalData);
        terminal.output.once('end', this.onTerminalEnd);
        terminal.output.once('error', this.onTerminalError);
        this.completion = terminal.done.then(outcome => this.onExit(outcome), (error) => { this.onTransportFailure(error); });
    }
    /**
     * Capture startup output through the same readiness contract as later sends.
     * @param signal - optional cancellation while the shell reaches its first prompt.
     * @returns Resolves after startup readiness; rejects on exit or readiness timeout.
     */
    async initialize(signal) {
        this.initializing = true;
        try {
            const operation = this.startSend({ text: '', submit: false, ...signal !== undefined ? { signal } : {} });
            const result = await operation.done;
            if (result.waitReason === 'session_exit')
                throw new Error('PTY shell exited during startup');
            if (result.waitReason === 'timeout')
                throw new Error('PTY shell did not reach readiness before startup timeout');
            this.motd = result.viewport;
        }
        catch (error) {
            signal?.throwIfAborted();
            throw error;
        }
        finally {
            this.initializing = false;
        }
    }
    startSend(request) {
        if (this.closing)
            throw new Error('PTY session is closing');
        if (this.statusValue.kind === 'exited')
            throw new Error('PTY session has exited');
        if (this.active !== undefined) {
            const draining = this.activeWrite !== undefined
                ? ' or draining provider write'
                : this.interrupting !== undefined
                    ? ' or draining foreground interrupt'
                    : '';
            throw new TerminalError(`PTY session already has an active send${draining}`, 'SEND_ACTIVE');
        }
        if (request.signal?.aborted === true)
            throw new Error('PTY send aborted before write');
        const operation = new LocalSendOperation(this.config.maxReadBytes, Date.now(), () => { this.interrupt(operation); });
        this.active = operation;
        this.resetReadinessEvidence();
        if (request.signal !== undefined) {
            const onAbort = () => { operation.cancel(); };
            request.signal.addEventListener('abort', onAbort, { once: true });
            this.activeAbort = () => request.signal?.removeEventListener('abort', onAbort);
        }
        this.activeDeadlineTimer = setTimeout(() => {
            if (this.active === operation) {
                this.settleActive('timeout', this.activeWrite !== undefined || this.interrupting === operation);
            }
        }, this.config.timeoutMs);
        void this.beginSend(operation, request);
        return operation;
    }
    async beginSend(operation, request) {
        let foreground;
        try {
            foreground = await this.terminal.inspectForeground();
        }
        catch (error) {
            // A pre-write inspection failure while cancellation owns the slot must not
            // release it: interruptOnce's in-flight foreground signal could land on a
            // successor's foreground group. The interrupt path's post-signal tail
            // resumes polling, whose guarded catch propagates a persistent failure.
            // A retained settled operation implies that same in-flight interrupt, so
            // this guard admits only an unsettled active send.
            if (this.active === operation && !this.closing && this.interrupting !== operation) {
                this.failActive(error);
            }
            return;
        }
        try {
            if (this.active !== operation || this.closing || this.interrupting === operation)
                return;
            operation.setInitialForeground(foreground);
            const input = `${request.text}${request.submit ? '\r' : ''}`;
            if (input.length > 0 && !operation.cancelRequested) {
                this.resetReadinessEvidence();
                const write = this.terminal.write(input);
                this.activeWrite = write.then(() => true, () => false);
                try {
                    await write;
                }
                finally {
                    this.activeWrite = undefined;
                }
            }
            // Cancellation owns post-write signalling and reservation release.
            if (operation.cancelRequested)
                return;
            if (this.active === operation && operation.settled) {
                this.clearActive();
                return;
            }
            // Closing can race the awaited provider write even though static analysis sees only local assignments.
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- awaited provider writes can close the session.
            if (this.active === operation && !this.closing) {
                this.pollingReady = operation;
                this.schedulePoll(operation);
            }
        }
        catch (error) {
            if (this.active === operation && !this.closing) {
                if (operation.settled)
                    this.clearActive();
                else
                    this.failActive(error);
            }
        }
    }
    resetReadinessEvidence() {
        this.lastOutputAt = Date.now();
        this.promptSeen = false;
        this.promptTextSeen = false;
        this.promptTail = '';
    }
    read(request) {
        const snapshot = this.scrollback.snapshot();
        const lines = snapshot.text.split('\n');
        const totalLines = snapshot.text.length === 0 ? 0 : lines.length;
        const offset = request.offset ?? 0;
        const count = request.count ?? 500;
        if (!Number.isSafeInteger(offset) || offset < 0)
            throw new Error('PTY read offset must be a non-negative safe integer');
        if (!Number.isSafeInteger(count) || count <= 0)
            throw new Error('PTY read count must be a positive safe integer');
        if (offset >= totalLines) {
            return { text: '', totalLines, lineBegin: offset, lineEnd: offset, truncated: snapshot.truncated };
        }
        const end = totalLines - offset;
        const start = Math.max(0, end - count);
        const requested = lines.slice(start, end).join('\n');
        const bounded = utf8Tail(requested, this.config.maxReadBytes);
        const returnedLines = bounded.text.length === 0 ? 0 : bounded.text.split('\n').length;
        return {
            text: bounded.text,
            totalLines,
            lineBegin: offset,
            lineEnd: offset + returnedLines,
            truncated: snapshot.truncated || bounded.truncated,
        };
    }
    async signal(signal) {
        if (this.closing)
            throw new Error('PTY session is closing');
        const targetPgid = await this.terminal.signalForeground(signal);
        return { delivered: true, targetPgid };
    }
    status() {
        return this.statusValue;
    }
    close(reason) {
        this.closing = true;
        if (this.closePromise !== undefined)
            return this.closePromise;
        const closing = this.closeOnce(reason).catch((error) => {
            this.closePromise = undefined;
            this.failActive(error);
            throw error;
        });
        this.closePromise = closing;
        return closing;
    }
    onTerminalData = (chunk) => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
        this.onData(this.decoder.decode(bytes, { stream: true }));
    };
    onTerminalEnd = () => {
        this.onData(this.decoder.decode());
        this.appendOutput(this.sanitizer.flush());
        this.outputEnded.resolve();
    };
    onTerminalError = (error) => {
        this.onTransportFailure(error);
        this.outputEnded.resolve();
    };
    onData(data) {
        const sanitized = this.sanitizer.push(data);
        this.appendOutput(sanitized.text);
        if (sanitized.prompt) {
            // TODO(pty-delayed-signal-prompt): With a reproducer, define a marker-generation boundary
            // before attributing a signal-delayed prompt to a later send.
            // Bash can print PROMPT_COMMAND before the kernel publishes its return
            // to the foreground process group. Retain the marker; polling below is
            // the authority that accepts it only after bash owns the foreground.
            this.promptSeen = true;
            this.promptTail = '';
            this.lastOutputAt = Date.now();
        }
        if (this.promptSeen && sanitized.promptTail !== undefined) {
            const remaining = Math.max(0, CONTROLLED_PROMPT.length + 1 - this.promptTail.length);
            this.promptTail += sanitized.promptTail.slice(0, remaining);
            if (sanitized.promptTail.length > remaining)
                this.promptTail = `${CONTROLLED_PROMPT}\0`;
            this.promptTextSeen = this.promptTail === CONTROLLED_PROMPT;
        }
    }
    async onExit(outcome) {
        await this.outputEnded.promise;
        if (this.transportFailure !== undefined)
            return;
        this.statusValue = { kind: 'exited', exitCode: outcome.exitCode, signal: outcome.signal };
        this.settleActive('session_exit');
    }
    onTransportFailure(error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.transportFailure ??= failure;
        this.statusValue = { kind: 'exited', exitCode: null, signal: null };
        this.failActive(failure);
        void this.terminal.terminate().catch(() => { });
    }
    appendOutput(text) {
        if (text.length === 0)
            return;
        this.lastOutputAt = Date.now();
        this.scrollback.append(text);
        this.active?.append(text);
    }
    schedulePoll(operation, delayMs = this.config.pollIntervalMs) {
        if (this.active !== operation || this.interrupting === operation || this.polling)
            return;
        if (this.activeTimer !== undefined)
            clearTimeout(this.activeTimer);
        this.activeTimer = setTimeout(() => {
            this.activeTimer = undefined;
            void this.pollReadiness(operation);
        }, delayMs);
    }
    async pollReadiness(operation) {
        if (this.active !== operation || this.polling)
            return;
        this.polling = true;
        try {
            if (this.statusValue.kind === 'exited') {
                this.settleActive('session_exit');
                return;
            }
            const foreground = await this.terminal.inspectForeground();
            if (this.active !== operation || this.closing || this.interrupting === operation)
                return;
            const idleFor = Date.now() - this.lastOutputAt;
            if (this.promptSeen && foreground !== undefined && this.shellPgid === undefined) {
                this.shellPgid = foreground.processGroupId;
            }
            if (this.promptSeen && this.promptTextSeen && idleFor >= this.config.pollIntervalMs
                && foreground?.processGroupId === this.shellPgid) {
                this.settleActive('stdin_read');
                return;
            }
            const elapsed = Date.now() - operation.startedAt;
            const startupHasOutput = !this.initializing || this.scrollback.snapshot().text.length > 0;
            const acceptsStdinWait = startupHasOutput && foreground !== undefined
                && operation.acceptsStdinWait(foreground.processGroupId, foreground.inputWaiting);
            if (elapsed >= this.config.exactProbeAfterMs && acceptsStdinWait) {
                this.settleActive('stdin_read');
                return;
            }
            // A prompt candidate can race bash's foreground handoff, but an interactive
            // child also inherits PROMPT_COMMAND. Silence therefore remains the bound
            // on waiting for shell ownership instead of letting a child marker suppress
            // readiness until the absolute timeout.
            const handoffGrace = this.promptSeen ? this.config.handoffGraceMs : 0;
            if (startupHasOutput && idleFor >= this.config.idleSilenceMs + handoffGrace) {
                this.settleActive('inferred_idle');
            }
        }
        catch (error) {
            if (this.active === operation && !this.closing && this.interrupting !== operation)
                this.failActive(error);
        }
        finally {
            this.polling = false;
            const active = this.active;
            // Awaited provider inspection can clear or replace the active send despite static analysis.
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- awaited inspection can replace the active send.
            if (active !== undefined && this.pollingReady === active)
                this.schedulePoll(active);
        }
    }
    settleActive(waitReason, retainOwnership = false) {
        const operation = this.active;
        if (operation === undefined)
            return;
        const scrollbackTruncated = this.scrollback.snapshot().truncated;
        if (retainOwnership) {
            this.stopPolling();
            this.activeAbort?.();
            this.activeAbort = undefined;
        }
        else {
            this.clearActive();
        }
        operation.settle(waitReason, this.statusValue, scrollbackTruncated);
    }
    stopPolling() {
        this.stopReadinessPolling();
        if (this.activeDeadlineTimer !== undefined)
            clearTimeout(this.activeDeadlineTimer);
        this.activeDeadlineTimer = undefined;
    }
    stopReadinessPolling() {
        if (this.activeTimer !== undefined)
            clearTimeout(this.activeTimer);
        this.activeTimer = undefined;
        this.pollingReady = undefined;
    }
    clearActive() {
        const operation = this.active;
        this.stopPolling();
        this.activeAbort?.();
        this.activeAbort = undefined;
        if (this.interrupting === operation)
            this.interrupting = undefined;
        this.pollingReady = undefined;
        this.active = undefined;
    }
    failActive(error) {
        const operation = this.active;
        if (operation === undefined)
            return;
        this.clearActive();
        operation.fail(error);
    }
    interrupt(operation) {
        if (this.active !== operation)
            return;
        this.interrupting = operation;
        this.stopReadinessPolling();
        void this.interruptOnce(operation);
    }
    async interruptOnce(operation) {
        try {
            const activeWrite = this.activeWrite;
            if (activeWrite !== undefined && !await activeWrite)
                return;
            await this.terminal.signalForeground('SIGINT');
        }
        catch (error) {
            if (this.active === operation && !this.closing)
                this.onTransportFailure(error);
            return;
        }
        finally {
            if (this.interrupting === operation)
                this.interrupting = undefined;
        }
        if (this.active === operation && operation.settled) {
            this.clearActive();
        }
        else if (this.active === operation && !this.closing) {
            this.pollingReady = operation;
            this.schedulePoll(operation, 0);
        }
    }
    async closeOnce(reason) {
        // Stop readiness polling but retain the active operation: teardown settles
        // it as session_exit below, so an in-flight send is never mis-settled as
        // stdin_read/inferred_idle/timeout during the grace period.
        this.stopPolling();
        try {
            await this.terminal.terminate();
        }
        catch (error) {
            throw new Error(`PTY cleanup failed (${reason})`, { cause: error });
        }
        // Quiescence is the active send's terminal outcome.
        this.settleActive('session_exit');
        await this.completion;
        this.terminal.output.off('data', this.onTerminalData);
        this.terminal.output.off('end', this.onTerminalEnd);
        this.terminal.output.off('error', this.onTerminalError);
        if (this.transportFailure !== undefined)
            throw this.transportFailure;
    }
}
//# sourceMappingURL=session.js.map