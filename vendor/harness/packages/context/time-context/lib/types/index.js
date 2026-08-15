/**
 * Opt-in request clock context. Eligible steps add durable,
 * source-attributed time readings to the request history.
 *
 * @module @deepseek-ai/dsh-time-context
 */
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { deriveBrowserTimeZoneContext, renderBrowserTimeZoneContext, } from "./request-zone.js";
import { createTimestampFormatter, formatTimestamp } from "./timestamp.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'time-context';
/** The agent registry that owns pre-step processing. */
export const inject = ['agents'];
/** Schemastery validation for {@link Config}. */
export const Config = z.object({
    timeZone: z.string(),
    refreshIntervalMs: z.number(),
});
/** Format a non-negative elapsed millisecond count as compact whole-second units. */
function formatDuration(elapsedMs) {
    let seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
    const days = Math.floor(seconds / 86_400);
    seconds %= 86_400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;
    const parts = [];
    if (days > 0)
        parts.push(`${days}d`);
    if (hours > 0)
        parts.push(`${hours}h`);
    if (minutes > 0)
        parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}
/** Find the latest model-visible event, excluding this plugin's pending append. */
function precedingMessageTime(agent) {
    for (const event of [...agent.session.events].reverse()) {
        switch (event.type) {
            case 'user/message':
            case 'assistant/message':
            case 'tool/result':
                return event.time;
            default:
                // Merge-extensible session events: non-surface records are not messages.
                break;
        }
    }
    return undefined;
}
/** Find the preceding time-context event within the open turn. */
function precedingStepContextTime(agent, turn) {
    for (const event of [...agent.session.events].reverse()) {
        if (event.type === 'turn/start' && event.data.turn === turn)
            return undefined;
        if (event.type === 'user/message'
            && event.data.source.kind === 'plugin'
            && event.data.source.plugin === name) {
            return event.time;
        }
    }
    return undefined;
}
/** Find this plugin's latest durable injection, including a shadowed surface event. */
function latestInjectionTime(agent) {
    for (const event of [...agent.session.events].reverse()) {
        if (event.type === 'user/message'
            && event.data.source.kind === 'plugin'
            && event.data.source.plugin === name) {
            return event.time;
        }
    }
    return undefined;
}
/** Collect already-entered and proposed user messages belonging to one open turn. */
function requestMessages(agent, turn, proposed) {
    const start = agent.session.events.findLastIndex(event => event.type === 'turn/start' && event.data.turn === turn);
    const entered = start < 0
        ? []
        : agent.session.events.slice(start + 1)
            .flatMap(event => event.type === 'user/message' ? [event.data] : []);
    return [...entered, ...proposed];
}
function renderText(now, turn, step, previous, formatter, timeZone, browserContext) {
    const elapsed = previous === undefined ? 'unavailable' : formatDuration(now - previous);
    const baseline = step === 1 ? 'model-visible message' : 'step context';
    const browserText = renderBrowserTimeZoneContext(browserContext);
    return `Time sampled while preparing turn ${turn}, step ${step}: ${formatTimestamp(now, formatter, timeZone)}\n`
        + `${browserText}\n`
        + `Elapsed since the preceding ${baseline}: ${elapsed}.`;
}
/** Reject refresh intervals that cannot represent an exact elapsed-millisecond threshold. */
function validateRefreshInterval(refreshIntervalMs) {
    if (refreshIntervalMs !== undefined && (!Number.isSafeInteger(refreshIntervalMs)
        || refreshIntervalMs < 0)) {
        throw new TypeError(`time-context: refreshIntervalMs must be a non-negative safe integer, got ${String(refreshIntervalMs)}`);
    }
}
/**
 * Register a prepended pre-step listener for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - time zone and durable refresh scheduling configuration.
 * @throws when the refresh interval is invalid or the configured or process time zone cannot be resolved.
 */
export function apply(ctx, config) {
    const timeZone = config.timeZone;
    const refreshIntervalMs = config.refreshIntervalMs;
    validateRefreshInterval(refreshIntervalMs);
    let fallbackFormatter;
    try {
        fallbackFormatter = createTimestampFormatter(timeZone);
    }
    catch (error) {
        const message = timeZone === undefined
            ? 'time-context: failed to resolve the system time zone'
            : `time-context: invalid IANA timeZone ${JSON.stringify(timeZone)}`;
        throw new Error(message, { cause: error });
    }
    const fallbackTimeZone = fallbackFormatter.resolvedOptions().timeZone;
    const formatters = new Map([[fallbackTimeZone, fallbackFormatter]]);
    /** Resolve and cache one request-local timestamp formatter. */
    const formatterFor = (selectedTimeZone) => {
        const existing = formatters.get(selectedTimeZone);
        if (existing !== undefined)
            return existing;
        const created = createTimestampFormatter(selectedTimeZone);
        formatters.set(selectedTimeZone, created);
        return created;
    };
    ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || signal.aborted)
            return decision;
        const now = Date.now();
        if (refreshIntervalMs !== undefined && refreshIntervalMs > 0) {
            const lastInjection = latestInjectionTime(agent);
            if (lastInjection !== undefined
                && now >= lastInjection
                && now - lastInjection < refreshIntervalMs)
                return decision;
        }
        const previous = step === 1
            ? precedingMessageTime(agent)
            : precedingStepContextTime(agent, turn);
        const messages = requestMessages(agent, turn, decision.messages);
        const browser = deriveBrowserTimeZoneContext(messages);
        const selectedTimeZone = browser.kind === 'resolved' ? browser.timeZone : fallbackTimeZone;
        const text = renderText(now, turn, step, previous, formatterFor(selectedTimeZone), selectedTimeZone, browser);
        return {
            kind: 'enter',
            messages: [
                ...decision.messages,
                createUserMessage({
                    content: [{ type: 'text', text }],
                    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
                }),
            ],
        };
    }, { prepend: true });
}
//# sourceMappingURL=index.js.map