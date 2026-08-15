/**
 * `DeepSeekAdapter`: fetch + SSE against a DeepSeek (OpenAI-compatible)
 * chat-completions endpoint, emitting harness StreamChunks. The adapter is
 * transport-only: connection facts arrive through a thunk resolved once per
 * operation and the bearer token through a per-request resolver, so the
 * registering plugin owns validation, layering, and credential policy.
 *
 * @module dsh-llm-deepseek/adapter
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
import { attributionHeaders, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError, ProviderRequestId, QUOTA_EXCEEDED_CODE, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout';
import { serializeRequest } from "./serialize.js";
import { parseSse } from "./sse.js";
import { translate } from "./translate.js";
/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;
/** Default combined request/response context capacity. */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;
/** Default per-request output-token cap. */
export const DEFAULT_MAX_TOKENS = 256_000;
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT';
const OFF_REASONING_EFFORT = ReasoningEffortId('off');
const HIGH_REASONING_EFFORT = ReasoningEffortId('high');
const MAX_REASONING_EFFORT = ReasoningEffortId('max');
const REASONING_EFFORTS = [
    { id: OFF_REASONING_EFFORT, name: 'Off' },
    { id: HIGH_REASONING_EFFORT, name: 'High' },
    { id: MAX_REASONING_EFFORT, name: 'Max' },
];
const OFF_ONLY_REASONING_EFFORTS = [
    { id: OFF_REASONING_EFFORT, name: 'Off' },
];
function modelInfo(provider, model) {
    return {
        provider,
        id: model.id,
        name: model.name ?? model.id,
        ...model.description === undefined ? {} : { description: model.description },
        inputModalities: ['text'],
    };
}
function providerRetryAfterMs(value) {
    if (value === null)
        return undefined;
    if (/^\d+$/.test(value)) {
        const delay = Number(value) * 1_000;
        return Number.isFinite(delay) && delay > 0 ? delay : undefined;
    }
    const delay = Date.parse(value) - Date.now();
    return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}
function requestId(headers) {
    const value = headers.get('x-request-id') ?? headers.get('x-deepseek-request-id');
    return value === null || value.length === 0 ? undefined : ProviderRequestId(value);
}
/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param error - parsed provider error body, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status, error) {
    if (status === 401 || status === 403)
        return 'AUTH';
    const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ');
    if (isQuotaExceededError(detail))
        return QUOTA_EXCEEDED_CODE;
    if (status === 429)
        return 'RATE_LIMIT';
    if (status === 400) {
        if (isContextWindowExceededError(detail))
            return CONTEXT_WINDOW_EXCEEDED_CODE;
        return 'INVALID_REQUEST';
    }
    if (status >= 500)
        return 'SERVER';
    return `HTTP_${status}`;
}
/**
 * The first real `LlmAdapter`. One instance serves every model name it was
 * registered under (the harness model name IS the wire model name).
 *
 * One stable signal reaches both initial fetch and body reads. Caller aborts
 * map to `ABORTED`; the configured per-read idle watchdog maps to `TIMEOUT`.
 */
export class DeepSeekAdapter extends LlmAdapter {
    config;
    constructor(config) {
        super();
        this.config = config;
    }
    providerInfo(provider) {
        return { id: provider, name: 'DeepSeek' };
    }
    providerRetryPolicy(_provider) {
        return this.config.options().retryPolicy;
    }
    listModels(provider) {
        return Promise.resolve(this.config.options().models.map(model => modelInfo(provider, model)));
    }
    resolveModel(provider, model, _signal) {
        const connection = this.config.options();
        const configured = connection.models.find(entry => entry.id === model);
        const contextWindow = configured?.contextWindow
            ?? connection.defaultContextWindow;
        return Promise.resolve({
            // The chat-completions wire route is text-only regardless of catalog
            // membership, so the uncatalogued fallback declares the same negative
            // capability — "unknown" here would let the host accept and persist
            // images the serializer must then reject.
            ...configured === undefined
                ? { provider, id: model, name: model, inputModalities: ['text'] }
                : modelInfo(provider, configured),
            context: { contextWindow },
            defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
            ...connection.defaults.thinking === 'disabled'
                ? {
                    reasoning: {
                        efforts: OFF_ONLY_REASONING_EFFORTS,
                        defaultEffort: OFF_REASONING_EFFORT,
                    },
                }
                : {
                    reasoning: {
                        efforts: REASONING_EFFORTS,
                        defaultEffort: connection.defaults.reasoningEffort === 'off'
                            ? OFF_REASONING_EFFORT
                            : connection.defaults.reasoningEffort === 'max'
                                ? MAX_REASONING_EFFORT
                                : HIGH_REASONING_EFFORT,
                    },
                },
        });
    }
    async *stream(options) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            // One resolution per stream call: connection facts and the credential
            // freeze here and hold for this whole request, so an in-flight stream
            // never observes a configuration change and the next call re-resolves.
            // The key resolves *from this snapshot*, so an endpoint and the secret
            // sent to it can never come from different configuration generations.
            const connection = this.config.options();
            const apiKey = await this.config.resolveApiKey(connection);
            const userId = this.config.resolveUserId();
            const consumer = new AbortController();
            const upstream = options.signal === undefined
                ? consumer.signal
                : AbortSignal.any([options.signal, consumer.signal]);
            const watchdog = __addDisposableResource(env_1, idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE), false);
            const iterator = this.request(options, watchdog.signal, connection, apiKey, userId, () => { watchdog.pulse(); })[Symbol.asyncIterator]();
            let exhausted = false;
            try {
                while (true) {
                    const result = await watchdog.next(iterator);
                    if (result.done) {
                        exhausted = true;
                        return;
                    }
                    yield result.value;
                }
            }
            catch (error) {
                if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
                    throw new LlmError(`DeepSeek stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error });
                }
                if (options.signal?.aborted) {
                    throw new LlmError('DeepSeek request aborted by caller', 'ABORTED', { cause: error });
                }
                if (error instanceof LlmError)
                    throw error;
                throw new LlmError(`DeepSeek API stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error });
            }
            finally {
                consumer.abort('DeepSeek stream consumer stopped');
                if (!exhausted && iterator.return !== undefined) {
                    try {
                        await iterator.return();
                    }
                    catch (_abortedTransportTeardown) {
                        // The consumer controller already owns termination; a return-time abort cannot add a second outcome.
                    }
                }
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
    async *request(options, signal, connection, apiKey, userId, onComment) {
        const body = serializeRequest(options, connection.defaults);
        // Prepared outside the try so the TRANSPORT label below covers exactly the
        // transport boundary, never a serialization failure.
        const payload = JSON.stringify(body);
        const headers = {
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'accept': 'text/event-stream',
            ...attributionHeaders(),
            'x-deepseek-harness-user-id': String(userId),
            ...options.sessionId !== undefined
                ? { 'x-deepseek-harness-session-id': String(options.sessionId) }
                : {},
            ...options.purpose === 'compaction'
                ? { 'x-deepseek-harness-compact': '1' }
                : {},
        };
        // TODO(http): adopt the Cordis HTTP service when shared transport configuration
        // outweighs its additional runtime dependencies.
        let response;
        try {
            response = await fetch(`${connection.baseURL}/chat/completions`, {
                method: 'POST',
                headers,
                body: payload,
                signal,
            });
        }
        catch (error) {
            // The outer stream distinguishes caller cancellation and watchdog expiry.
            if (signal.aborted)
                throw error;
            // fetch wraps every transport failure (DNS, refused connection, TLS,
            // proxy) in a bare `TypeError: fetch failed` whose actionable detail
            // lives on `cause`. Wrapping with the endpoint and chaining the cause
            // lets `errorChain` render the full diagnosis at every reporting boundary.
            throw new LlmError(`DeepSeek API request to ${connection.baseURL} failed`, 'TRANSPORT', { cause: error });
        }
        if (!response.ok) {
            let message = `DeepSeek API error (HTTP ${response.status})`;
            let providerError;
            try {
                const parsed = await response.json();
                providerError = parsed.error;
                if (providerError?.message)
                    message = providerError.message;
            }
            catch {
                // Only swallow error-body parsing: the HTTP status still identifies the
                // failure, so malformed gateway JSON must not mask it.
            }
            const delay = providerRetryAfterMs(response.headers.get('retry-after'));
            const id = requestId(response.headers);
            throw new LlmError(message, httpErrorCode(response.status, providerError), {
                status: response.status,
                ...delay === undefined ? {} : { providerRetryAfterMs: delay },
                ...id === undefined ? {} : { requestId: id },
            });
        }
        if (!response.body) {
            throw new LlmError('DeepSeek API returned no response body', 'EMPTY_RESPONSE');
        }
        yield* translate(parseSse(response.body, onComment));
    }
}
//# sourceMappingURL=adapter.js.map