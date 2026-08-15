/**
 * Cooperative tool-call timeout enforcer. A tool declares `timeoutMs` and
 * promises to honor `exec.signal`; this wrapper arms that deadline and maps its
 * own expiry to `TOOL_TIMEOUT` without racing or abandoning the tool promise.
 *
 * FIXME: settle the intended `@deepseek-ai/dsh-timeout-guard` rename before the
 * first tagged release — suggestion only, aligning the name with its `guard/`
 * home; decide at resolution time
 * ([regrouping Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-29-package-regrouping.md)).
 *
 * @module @deepseek-ai/dsh-tool-call-timeout-policy
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
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';
/**
 * The code owned by this plugin, used BOTH as the internal {@link deadline}
 * classification code AND as the structured error `code` on the replacement
 * tool result. Scoping {@link timeoutOf} to it keeps a nested outer deadline
 * (another `tools/execute` wrapper's timer that fired first) from being misread
 * as this plugin's own timeout — it reads as an ordinary upstream cancel.
 */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT';
/** Cordis plugin name used by loader diagnostics. */
export const name = 'timeout-policy';
/** The tool registry service this plugin wraps (`tools/execute`) and reads (`get`). */
export const inject = ['tools'];
/**
 * The structured result substituted when this plugin's deadline wins. `content`
 * is the model-facing message; `error.code` is the same {@link TOOL_TIMEOUT}
 * this plugin owns, so a retry/sandbox plugin (and replay) can route on it.
 *
 * @param timeoutMs - the elapsed budget, rendered into the model-facing message.
 * @returns the `isError` {@link ToolExecutionResult} with a `TOOL_TIMEOUT` error.
 */
function toolTimeoutResult(timeoutMs) {
    const message = `tool call timed out after ${timeoutMs}ms`;
    return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
        error: { message, info: { name: 'ToolTimeoutError', code: TOOL_TIMEOUT } },
    };
}
/**
 * Register the timeout wrapper. It resolves the caller-visible tool definition,
 * temporarily replaces `exec.signal`, delegates, restores the upstream signal,
 * and replaces the result only when this wrapper's own timer fired.
 */
export function apply(ctx) {
    ctx.on('tools/execute', async (exec, next) => {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const timeoutMs = ctx.tools.get(exec.name, exec.agent)?.timeoutMs;
            // A tool that declares no budget: no deadline, delegate unchanged.
            if (timeoutMs === undefined)
                return next();
            const d = __addDisposableResource(env_1, deadline(exec.signal, timeoutMs, TOOL_TIMEOUT)
            // Swap the derived deadline onto exec for dispatch, then restore the
            // caller's own signal so post-execute listeners never see this plugin's
            // (possibly already-aborted) timeout signal.
            , false);
            // Swap the derived deadline onto exec for dispatch, then restore the
            // caller's own signal so post-execute listeners never see this plugin's
            // (possibly already-aborted) timeout signal.
            const upstream = exec.signal;
            exec.signal = d.signal;
            try {
                const result = await next();
                // If OUR timer fired (scoped by code — a nested outer deadline reads as
                // undefined here), the tool/capability saw the abort and reached
                // quiescence; replace whatever it returned (its own abort result) with the
                // structured TOOL_TIMEOUT the model sees.
                if (timeoutOf(d.signal, TOOL_TIMEOUT) !== undefined) {
                    return toolTimeoutResult(timeoutMs);
                }
                return result;
            }
            finally {
                exec.signal = upstream;
            }
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    });
}
//# sourceMappingURL=index.js.map