/**
 * Local Service Provider for the bash capability seam over the subprocess
 * capability seam. Public commands run as `bash -c` in a managed process group spawned
 * through `ctx.subprocess`; subclasses may reuse the same mechanics with an
 * explicit argv. This executor owns command defaulting, deadlines and cause
 * classification, the model-friendly terminal environment, and the model-facing
 * stdout/stderr merge for background reads. Execution policy belongs in
 * `tools/pre-execute` or a sandboxing executor.
 * @module @deepseek-ai/dsh-bash-local
 */
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import z from '@deepseek-ai/schemastery';
import { SHELL_SETTINGS_NAMESPACE, ShellExecutor } from '@deepseek-ai/dsh-shell';
import { installSettingsSection } from '@deepseek-ai/dsh-settings';
import { clampTimeout, deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout';
/**
 * Model-friendly environment overrides: disable colors, pagers, and
 * interactive terminal features that would garble tool output (the same set
 * Codex hardcodes; Claude Code achieves it via TERM=dumb). Bash-tool policy —
 * merged first into the spawn's explicit env, so a trusted caller's own entry
 * still wins; the subprocess service applies its credential scrub independently.
 */
export const ENV_OVERRIDES = {
    NO_COLOR: '1',
    TERM: 'dumb',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
};
/** Default SIGTERM→SIGKILL grace period (the `graceMs` config; matches OpenCode's 3s). */
const DEFAULT_GRACE_MS = 3_000;
/** Default per-stream spill cap (the `maxSpillBytes` config). */
const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024;
/** Project a settled collect-mode reader into the final CollectedOutput shape. */
function finalOutput(reader) {
    const read = reader.readFrom(0);
    return {
        text: read.text,
        truncated: read.lossy,
        ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {},
    };
}
function assertPositiveFinite(name, value) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`bash-local: ${name} must be a positive finite number`);
    }
}
/**
 * Reject a resolved section this executor could not run with. The schema
 * expresses neither "positive and finite" nor the timer bound `graceMs` has to
 * fit, so a stored value is refused where it is written instead of failing at
 * the next command.
 * @param config - the resolved section, schema-valid by construction.
 * @throws Error naming the field that cannot be used.
 */
export function assertServiceableBashConfig(config) {
    const resolved = config;
    assertPositiveFinite('timeoutMs', resolved.timeoutMs);
    assertPositiveFinite('maxTimeoutMs', resolved.maxTimeoutMs);
    assertPositiveFinite('maxOutputBytes', resolved.maxOutputBytes);
    assertPositiveFinite('maxSpillBytes', resolved.maxSpillBytes);
    assertPositiveFinite('graceMs', resolved.graceMs);
    if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
        throw new Error(`bash-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
    }
}
/**
 * Local bash executor over `ctx.subprocess`. Bounded output, spill files, and
 * process-group SIGTERM→SIGKILL escalation are the subprocess service's
 * mechanics; this executor supplies their configured budgets per spawn, so a
 * still-running background process stays managed (killed and joined at
 * composition teardown) even across an executor reload.
 */
export class LocalBashExecutor extends ShellExecutor {
    static inject = ['subprocess'];
    static Config = z.object({
        cwd: z.string(),
        timeoutMs: z.number().default(120_000),
        maxTimeoutMs: z.number().default(600_000),
        maxOutputBytes: z.number().default(64_000),
        maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES),
        graceMs: z.number().default(DEFAULT_GRACE_MS),
    });
    /** The currently authoritative config: the settings section, or the composition entry. */
    source;
    /** Validated config (schemastery applied the defaults before construction). */
    get config() {
        return this.source();
    }
    constructor(ctx, config) {
        super(ctx);
        // Schemastery fills these fields before construction; the type does not encode that step.
        const entry = config;
        assertServiceableBashConfig(entry);
        this.source = () => entry;
        installSettingsSection(ctx, SHELL_SETTINGS_NAMESPACE, LocalBashExecutor.Config, entry, {
            validate: assertServiceableBashConfig,
            setSource: (current) => {
                this.source = current;
            },
            // Every field is read through the getter at each command, so nothing
            // derived from the source needs rebuilding when the document changes.
            onChange: () => { },
        });
    }
    /**
     * Resolve a request into a fully-specified spec: fill `workdir` from
     * `config.cwd` (else `process.cwd()`), and `timeoutMs` from
     * `config.timeoutMs`, capped at `config.maxTimeoutMs`. The tool layer calls
     * this before {@link run}/{@link start}, so those methods receive explicit
     * values and never re-default.
     */
    resolve(request) {
        const timeoutMs = clampTimeout(request.timeoutMs, this.config.timeoutMs, this.config.maxTimeoutMs, 'bash-local: request.timeoutMs');
        const stdoutMaxBytes = request.stdoutMaxBytes ?? this.config.maxOutputBytes;
        assertPositiveFinite('request.stdoutMaxBytes', stdoutMaxBytes);
        return {
            command: request.command,
            workdir: request.workdir ?? this.config.cwd ?? process.cwd(),
            timeoutMs,
            stdoutMaxBytes,
            ...request.signal ? { signal: request.signal } : {},
            // Carry stdin/ordinary env/trusted dshEnv through verbatim — optional,
            // no config default. The subprocess service owns the scrub and merge order.
            ...request.stdin !== undefined ? { stdin: request.stdin } : {},
            ...request.env !== undefined ? { env: request.env } : {},
            ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
            // Carry a sandbox policy through verbatim: this executor never
            // confines, so the field is inert here (the seam contract) — a
            // sandboxing subclass overrides resolve() to stamp its default instead.
            sandboxPolicy: request.sandboxPolicy,
        };
    }
    /** Map one resolved bash spec and explicit argv onto a fully-specified subprocess spawn. */
    // XXX(stateful-shell): evaluate persistent cwd or PTY sessions when workflows require shell state.
    spawnSpec(spec, argv, stdoutMaxBytes, signal) {
        const collect = (maxBytes) => ({ maxBytes, spill: { maxBytes: this.config.maxSpillBytes } });
        return {
            argv,
            cwd: spec.workdir,
            stdio: {
                stdin: spec.stdin !== undefined ? { data: spec.stdin } : 'ignore',
                stdout: collect(stdoutMaxBytes),
                stderr: collect(this.config.maxOutputBytes),
            },
            graceMs: this.config.graceMs,
            signal,
            // One explicit env map for the seam, layered so the trusted dshEnv
            // snapshot beats both the caller's env and the terminal overrides; the
            // subprocess service merges the whole map after its ambient scrub.
            env: { ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv },
        };
    }
    /** The collect-mode readers the executor itself requested (present by construction). */
    static collected(handle) {
        const { stdout, stderr } = handle.collected;
        /* v8 ignore start -- collect dispositions expose both readers by the seam contract; defensive. */
        if (stdout === undefined || stderr === undefined) {
            throw new Error('bash-local: subprocess implementation dropped a requested collect stream');
        }
        /* v8 ignore stop */
        return { stdout, stderr };
    }
    async run(spec) {
        return this.runArgv(spec, ['bash', '-c', spec.command]);
    }
    /**
     * Run an explicit argv with the foreground lifecycle, environment, output,
     * timeout, and cancellation semantics of this executor. Subclasses use this
     * after replacing the public command's shell argv at an execution boundary.
     * @param spec - resolved execution settings and caller-owned command metadata.
     * @param argv - exact executable and arguments to hand to `ctx.subprocess`.
     * @returns the settled foreground result with collected output and cause facts.
     */
    async runArgv(spec, argv) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            // One deadline combines timeout and upstream cancellation; disposal clears its timer.
            const d = __addDisposableResource(env_1, deadline(spec.signal, spec.timeoutMs, 'BASH_TIMEOUT'), false);
            const handle = this.ctx.subprocess.spawn(this.spawnSpec(spec, argv, spec.stdoutMaxBytes, d.signal));
            const outcome = await handle.done;
            const collected = LocalBashExecutor.collected(handle);
            // Only this executor's timeout reason counts as timedOut; outer deadlines count as aborts.
            const timedOut = timeoutOf(d.signal, 'BASH_TIMEOUT') !== undefined;
            const aborted = d.signal.aborted && !timedOut;
            return {
                ...outcome,
                timedOut,
                aborted,
                timeoutMs: spec.timeoutMs,
                stdout: finalOutput(collected.stdout),
                stderr: finalOutput(collected.stderr),
            };
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
    start(spec) {
        return this.startArgv(spec, ['bash', '-c', spec.command]);
    }
    /**
     * Start an explicit argv with the background lifecycle, environment, output,
     * cancellation, and process-tree ownership semantics of this executor.
     * Subclasses use this after replacing the public command's shell argv at an
     * execution boundary.
     * @param spec - resolved execution settings and caller-owned command metadata.
     * @param argv - exact executable and arguments to hand to `ctx.subprocess`.
     * @returns the live background handle; spawn rejection settles it as killed.
     */
    startArgv(spec, argv) {
        // Background runs ignore timeoutMs; callers stop them through kill() or spec.signal.
        const running = this.ctx.subprocess.spawn(this.spawnSpec(spec, argv, this.config.maxOutputBytes, spec.signal));
        const collected = LocalBashExecutor.collected(running);
        // A spawn failure produces no process output, so the subprocess service has nothing
        // to buffer; the note is delivered exactly once through the read path.
        let spawnFailureNote;
        const consumeSpawnFailure = () => {
            const note = spawnFailureNote ?? '';
            spawnFailureNote = undefined;
            return note;
        };
        let stdoutOffset = 0;
        let stderrOffset = 0;
        const proc = {
            status: 'running',
            exitCode: null,
            signal: null,
            done: running.done.then((outcome) => {
                // Any signal termination is killed, including a command signaling itself.
                if (proc.status === 'running') {
                    proc.status = spec.signal?.aborted === true || outcome.signal !== null ? 'killed' : 'completed';
                }
                proc.exitCode = outcome.exitCode;
                proc.signal = outcome.signal;
                this.onProcessDone(proc, collected.stderr.readFrom(0).text, false);
            }, (error) => {
                // Background spawn failures settle as killed and surface through the read path.
                proc.status = 'killed';
                spawnFailureNote = `spawn failed: ${String(error)}`;
                this.onProcessDone(proc, spawnFailureNote, true, error);
            }),
            readOutput: () => {
                const out = collected.stdout.readFrom(stdoutOffset);
                const err = collected.stderr.readFrom(stderrOffset);
                stdoutOffset = out.nextOffset;
                stderrOffset = err.nextOffset;
                // A failed spawn never produced process output, so the note and real
                // stderr text are mutually exclusive.
                const errText = err.text.length > 0 ? err.text : consumeSpawnFailure();
                // Single newline between sections: stdout chunks usually end with one
                // already; add it only when missing.
                const separator = out.text.length > 0 && !out.text.endsWith('\n') ? '\n' : '';
                const delta = out.text
                    + (errText.length > 0 ? `${separator}[stderr]\n${errText}` : '');
                return {
                    delta,
                    lossy: out.lossy || err.lossy,
                    ...out.spillPath !== undefined ? { stdoutSpillPath: out.spillPath } : {},
                    ...err.spillPath !== undefined ? { stderrSpillPath: err.spillPath } : {},
                };
            },
            kill: () => {
                if (proc.status !== 'running')
                    return false;
                proc.status = 'killed';
                running.terminate();
                return true;
            },
        };
        return proc;
    }
    /**
     * Settlement hook for subclasses that attach execution facts to a process.
     * Called after exit facts or spawn-failure output are stamped and before
     * {@link ShellProcess.done} resolves. The base implementation is intentionally
     * empty.
     * @param _proc - the settled process handle.
     * @param _stderr - the process's retained stderr tail used by subclasses for settlement classification.
     * @param _spawnFailed - whether the subprocess promise rejected before a process started.
     * @param _spawnError - the original spawn rejection reason, which may itself be undefined.
     */
    onProcessDone(_proc, _stderr, _spawnFailed, _spawnError) { }
}
export default LocalBashExecutor;
//# sourceMappingURL=index.js.map