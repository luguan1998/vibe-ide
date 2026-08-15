/**
 * Model-facing persistent `bash` tool over the owner-scoped PTY seam.
 * @module @deepseek-ai/dsh-tool-bash-persistent
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
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';
import { defineTool } from '@deepseek-ai/dsh-tools';
// TODO: Replace the file-search advice; arbitrary command output need not come from a searchable file.
const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>';
const LOST_PREFIX_MESSAGE = '<response clipped><NOTE>The beginning of this command output was dropped by the terminal scrollback limit. The following text is the earliest retained output.</NOTE>\n';
const SHELL_RESET_MESSAGE = 'The persistent bash shell was reset; the next bash call starts from the workspace with a fresh current directory and environment.';
const SHELL_PROMPT = '__DSH_PERSISTENT_BASH_PROMPT__ ';
const TIMEOUT_CODE = 'PERSISTENT_BASH_TIMEOUT';
// One page is enough to find a just-emitted completion marker; the full
// scrollback is assembled only when a command settles or needs partial output.
const SCROLLBACK_PAGE_LINES = 1_000;
const POLL_INTERVAL_MS = 25;
const DEFAULT_DESCRIPTION = 'Run commands in a persistent bash shell. State, including the current directory and exported environment variables, persists across calls for this agent.';
function maybeTruncate(content, maxOutputChars, incomplete = false) {
    if (content.length <= maxOutputChars && !incomplete)
        return content;
    return content.length <= maxOutputChars
        ? content + TRUNCATED_MESSAGE
        : content.slice(0, maxOutputChars) + TRUNCATED_MESSAGE;
}
function markers() {
    const nonce = randomUUID();
    return {
        start: `__DSH_PERSISTENT_BASH_START_${nonce}__`,
        end: `__DSH_PERSISTENT_BASH_END_${nonce}:`,
    };
}
function quoteForBash(value) {
    return `$'${value
        .replaceAll('\\', '\\\\')
        .replaceAll("'", "\\'")
        .replaceAll('\r', '\\r')
        .replaceAll('\n', '\\n')}'`;
}
function wrapCommand(command, marker) {
    // Keep the wrapper on one physical line. An interactive bash prints PS2 for
    // embedded newlines before executing the buffer, which would leak terminal
    // prompts and marker source text into the model-facing result.
    return `printf '%s\\n' ${quoteForBash(marker.start)}; eval -- ${quoteForBash(command)}; __dsh_persistent_bash_status=$?; printf '%s%s\\n' ${quoteForBash(marker.end)} "$__dsh_persistent_bash_status"`;
}
function stripPrompt(text) {
    let result = text.replace(/\r?\n$/, '');
    while (result.endsWith(SHELL_PROMPT)) {
        result = result.slice(0, -SHELL_PROMPT.length);
    }
    return result.endsWith('\n') ? result.slice(0, -1) : result;
}
function commandOutput(snapshot, marker) {
    const text = snapshot.text;
    const end = text.lastIndexOf(marker.end);
    const status = /^(\d+)\r?\n/.exec(text.slice(end + marker.end.length))?.[1];
    if (status === undefined)
        return undefined;
    const startMarker = text.lastIndexOf(marker.start, end);
    const start = startMarker < 0 ? 0 : startMarker + marker.start.length;
    return {
        text: stripPrompt(text.slice(start, end).replace(/^\r?\n/, '')),
        incomplete: startMarker < 0,
        exitCode: Number(status),
    };
}
function promptCompleted(result) {
    return result.viewport.endsWith(SHELL_PROMPT)
        || result.viewport.endsWith(`${SHELL_PROMPT}\r\n`)
        || result.viewport.endsWith(`${SHELL_PROMPT}\n`);
}
function partialOutput(snapshot, marker, fallback, fallbackTruncated = false) {
    const startMarker = snapshot.text.lastIndexOf(marker.start);
    if (startMarker >= 0) {
        return {
            text: stripPrompt(snapshot.text.slice(startMarker + marker.start.length).replace(/^\r?\n/, '')),
            incomplete: false,
        };
    }
    const fallbackStart = fallback.lastIndexOf(marker.start);
    const afterStart = fallbackStart < 0
        ? fallback
        : fallback.slice(fallbackStart + marker.start.length).replace(/^\r?\n/, '');
    const fallbackEnd = afterStart.lastIndexOf(marker.end);
    const beforeEnd = fallbackEnd < 0 ? afterStart : afterStart.slice(0, fallbackEnd);
    return {
        text: stripPrompt(beforeEnd.replaceAll(SHELL_PROMPT, '')),
        incomplete: fallbackTruncated || fallbackStart < 0,
    };
}
async function pause() {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
}
function nextScrollbackOffset(page, offset) {
    if (page.text.length === 0 || page.lineEnd <= offset)
        return undefined;
    return page.lineEnd;
}
function retainedScrollback(ctx, owner, id, latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES })) {
    const pages = latest.text.length === 0 ? [] : [latest.text];
    let offset = latest.lineEnd;
    let truncated = latest.truncated;
    while (true) {
        if (offset >= latest.totalLines)
            break;
        const page = ctx.terminals.read(owner, id, { offset, count: SCROLLBACK_PAGE_LINES });
        truncated ||= page.truncated;
        if (page.text.length > 0)
            pages.unshift(page.text);
        const next = nextScrollbackOffset(page, offset);
        if (next === undefined || next >= page.totalLines)
            break;
        offset = next;
    }
    return { text: pages.join('\n'), truncated };
}
function renderCaptured(output, maxOutputChars) {
    const rendered = maybeTruncate(output.text, maxOutputChars, output.incomplete);
    const withPrefix = output.incomplete && output.text.length > 0
        ? LOST_PREFIX_MESSAGE + rendered
        : rendered;
    const marker = output.exitCode !== undefined && output.exitCode !== 0
        ? `[exit code: ${output.exitCode}]`
        : undefined;
    return appendStatusMarker(withPrefix, marker);
}
function appendStatusMarker(content, marker) {
    if (marker === undefined)
        return content;
    return content.length === 0 ? marker : `${content}\n${marker}`;
}
function renderShellExitStatus(content, exitCode, signal) {
    const marker = signal !== null
        ? `[shell killed by signal: ${signal}]`
        : exitCode !== null
            ? `[shell exited: code ${exitCode}]`
            : '[shell exited]';
    return appendStatusMarker(content, marker);
}
function persistentShells(ctx, config) {
    const pending = new WeakMap();
    const live = new Map();
    const creating = new Set();
    const ownerCleanupInstalled = new WeakSet();
    const lifecycle = new AbortController();
    const close = async (owner, id, reason) => {
        if (!ctx.terminals.list(owner).some(snapshot => snapshot.sessionId === id))
            return;
        await ctx.terminals.kill(owner, id, reason);
    };
    ctx.effect(() => async () => {
        lifecycle.abort(new Error('tool-bash-persistent disposed during shell creation'));
        await Promise.allSettled([...creating]);
        const closing = [...live].map(async ([owner, id]) => { await close(owner, id, 'tool-bash-persistent disposed'); });
        await Promise.all(closing);
        live.clear();
    }, 'tool-bash-persistent shell cleanup');
    const reset = async (owner, reason) => {
        pending.delete(owner);
        const id = live.get(owner);
        live.delete(owner);
        if (id !== undefined)
            await close(owner, id, reason);
    };
    const get = (owner, signal) => {
        const existing = pending.get(owner);
        if (existing !== undefined)
            return existing;
        const combinedSignal = AbortSignal.any([signal, lifecycle.signal]);
        const creation = (async () => {
            try {
                const cwd = owner.session.header.cwd;
                const spawned = await ctx.terminals.spawn(owner, {
                    type: config.backendType,
                    ...cwd === undefined ? {} : { cwd },
                }, combinedSignal);
                live.set(owner, spawned.sessionId);
                if (!ownerCleanupInstalled.has(owner)) {
                    ownerCleanupInstalled.add(owner);
                    owner.ctx.effect(() => () => {
                        pending.delete(owner);
                        live.delete(owner);
                    }, 'tool-bash-persistent owner cache cleanup');
                }
                const setup = ctx.terminals.startSend(owner, spawned.sessionId, {
                    text: `stty -echo; PS1=${quoteForBash(SHELL_PROMPT)}`,
                    submit: true,
                    signal: combinedSignal,
                });
                const result = await setup.done;
                if (result.sessionStatus.kind === 'exited' || result.waitReason === 'timeout') {
                    throw new Error('persistent bash shell did not accept initialization');
                }
                return spawned.sessionId;
            }
            catch (error) {
                await reset(owner, 'persistent bash initialization failed');
                throw error;
            }
        })();
        const tracked = creation.finally(() => {
            creating.delete(tracked);
        });
        creating.add(tracked);
        pending.set(owner, tracked);
        return tracked;
    };
    return { get, reset };
}
async function executeCommand(ctx, shells, owner, command, config, upstream) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const commandDeadline = __addDisposableResource(env_1, deadline(upstream, config.timeoutMs, TIMEOUT_CODE), false);
        const id = await shells.get(owner, commandDeadline.signal);
        const marker = markers();
        const wrapped = wrapCommand(command, marker);
        let first = true;
        let fallback = '';
        let fallbackTruncated = false;
        while (true) {
            let operation;
            let result;
            try {
                operation = ctx.terminals.startSend(owner, id, {
                    text: first ? wrapped : '',
                    submit: first,
                    signal: commandDeadline.signal,
                });
                first = false;
                result = await operation.done;
            }
            catch (error) {
                await shells.reset(owner, 'persistent bash send failed');
                throw error;
            }
            const incremental = operation.readOutput();
            fallback = incremental.delta.length > 0 ? fallback + incremental.delta : result.viewport;
            fallbackTruncated ||= incremental.truncated || result.truncated;
            const latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES });
            const timedOut = timeoutOf(commandDeadline.signal, TIMEOUT_CODE);
            if (timedOut !== undefined) {
                const snapshot = retainedScrollback(ctx, owner, id, latest);
                const partial = renderCaptured(partialOutput(snapshot, marker, fallback, fallbackTruncated), config.maxOutputChars);
                await shells.reset(owner, 'persistent bash command timed out');
                return [
                    // TODO: Report a timeout only; this signal does not establish an OOM.
                    `Your command timed out after ${Math.round(timedOut.timeoutMs / 1000)} seconds or experienced an OOM error. Below is partial output:`,
                    partial,
                    SHELL_RESET_MESSAGE,
                ].join('\n');
            }
            if (commandDeadline.signal.aborted) {
                await shells.reset(owner, 'persistent bash command aborted');
                commandDeadline.signal.throwIfAborted();
            }
            if (latest.text.includes(marker.end)) {
                const complete = commandOutput(retainedScrollback(ctx, owner, id, latest), marker);
                if (complete !== undefined)
                    return renderCaptured(complete, config.maxOutputChars);
            }
            if (result.sessionStatus.kind === 'exited') {
                const snapshot = retainedScrollback(ctx, owner, id, latest);
                await shells.reset(owner, 'persistent bash shell exited');
                return [
                    renderShellExitStatus(renderCaptured(partialOutput(snapshot, marker, fallback, fallbackTruncated), config.maxOutputChars), result.sessionStatus.exitCode, result.sessionStatus.signal),
                    SHELL_RESET_MESSAGE,
                ].filter(part => part.length > 0).join('\n');
            }
            if (promptCompleted(result)) {
                const snapshot = retainedScrollback(ctx, owner, id, latest);
                return renderCaptured(partialOutput(snapshot, marker, fallback, fallbackTruncated), config.maxOutputChars);
            }
            await pause();
        }
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/**
 * Register the model-facing persistent `bash` tool.
 * @param ctx - plugin context carrying tools and the owner-scoped PTY service.
 * @param config - selected PTY backend and command deadline.
 */
function registerPersistentBash(ctx, config) {
    const shells = persistentShells(ctx, config);
    const queues = new WeakMap();
    const serialized = async (owner, operation) => {
        const prior = queues.get(owner) ?? Promise.resolve();
        const run = prior.then(operation, operation);
        const tail = run.then(() => undefined, () => undefined);
        queues.set(owner, tail);
        try {
            return await run;
        }
        finally {
            if (queues.get(owner) === tail)
                queues.delete(owner);
        }
    };
    ctx.tools.register(defineTool({
        name: 'bash',
        description: config.description,
        parameters: {
            command: {
                type: 'string',
                required: true,
                description: 'The bash command to run. Relative path is preferred in the command.',
            },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args, exec) {
            if (args.command.trim().length === 0)
                throw new Error('command must be a non-empty string');
            const owner = exec.agent;
            if (owner === undefined)
                throw new Error('bash requires an owning agent session');
            return serialized(owner, async () => {
                exec.signal.throwIfAborted();
                return executeCommand(ctx, shells, owner, args.command, config, exec.signal);
            });
        },
        presentCall: args => ({ card: 'terminal', title: args.command }),
    }));
}
export const name = 'tool-bash-persistent';
export const inject = ['tools', 'terminals'];
/** Runtime configuration schema for the persistent Bash tool. */
export const Config = z.object({
    backendType: z.string().default('shell'),
    timeoutMs: z.number().default(300_000),
    maxOutputChars: z.number().default(16_000),
    description: z.string().default(DEFAULT_DESCRIPTION),
});
/** Register one owner-scoped persistent `bash` tool. */
export function apply(ctx, config) {
    const resolved = {
        backendType: config.backendType ?? 'shell',
        timeoutMs: config.timeoutMs ?? 300_000,
        maxOutputChars: config.maxOutputChars ?? 16_000,
        description: config.description ?? DEFAULT_DESCRIPTION,
    };
    if (resolved.backendType.trim().length === 0) {
        throw new Error('tool-bash-persistent: backendType must be non-empty');
    }
    if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
        throw new Error('tool-bash-persistent: timeoutMs must be a positive safe integer');
    }
    if (!Number.isSafeInteger(resolved.maxOutputChars) || resolved.maxOutputChars <= 0) {
        throw new Error('tool-bash-persistent: maxOutputChars must be a positive safe integer');
    }
    if (resolved.description.trim().length === 0) {
        throw new Error('tool-bash-persistent: description must be non-empty');
    }
    registerPersistentBash(ctx, resolved);
}
//# sourceMappingURL=index.js.map