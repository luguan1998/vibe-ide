import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import "@deepseek-ai/cordis";
//#region ../../llm/llm/src/brand.ts
/**
* Brand a message identifier.
* @param id - the opaque message identifier.
* @returns the same string, branded; no validation is performed.
*/
function MessageId(id) {
	return id;
}
//#endregion
//#region ../../llm/llm/src/call-config.ts
/**
* Deep-freeze a value in place with an iterative traversal, guarding cycles,
* so later mutation throws without imposing a JavaScript call-stack depth cap.
* {@link AbortSignal} objects are deliberately skipped because they are the
* request's live cancellation channel and freezing them breaks abort.
* @param value - the value to freeze in place.
* @returns the same value, frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region ../../llm/llm/src/message.ts
/** Message value types, identity, and immutable construction helpers. */
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return freezeMessage({
		...input,
		id: MessageId(crypto.randomUUID())
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
//#endregion
//#region ../../util/timeout/src/index.ts
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region ../../llm/llm/src/error.ts
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
//#endregion
//#region ../../llm/llm/src/retry-policy.ts
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = z.object({
	initialDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: z.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = z.object({
	mode: z.const("normal").required(),
	maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = z.object({
	mode: z.const("always").required(),
	backoff: backoffSchema
});
z.union([normalPolicySchema, alwaysPolicySchema]);
//#endregion
//#region ../../llm/llm/src/attribution.ts
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
//#endregion
//#region ../../llm/llm/src/never.ts
/**
* Exhaustiveness helper for closed core unions. Use {@link assertNever} at the default branch so a
* new variant fails compilation at every required handler. Do not use it for declaration-merged
* unions such as session events or content blocks: handle known variants and explicitly fall
* through because plugins may add valid unknown cases.
* @module @deepseek-ai/dsh-llm/never
*/
/**
* Mark an unreachable closed-union branch. A newly unhandled typed variant fails at the call site;
* a value that escaped its type throws with diagnostics at runtime.
* @param value - the impossible value; typed `never` so an unhandled variant fails compilation at the call site.
* @param context - optional label (e.g. the switch site) prefixed into the throw message.
* @returns never — it always throws, with the offending value JSON-rendered in the message.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
//#endregion
//#region lib/types/request-zone.js
/** Browser-zone derivation and model-facing policy text for one open request turn. */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/;
/** Read and validate a Host-canonicalized browser zone from one ordinary user-rpc message. */
function browserTimeZone(message) {
	const source = message.source;
	const value = source.kind === "user" && "rpcId" in source && typeof source.rpcId === "string" && "clientTimeZone" in source && typeof source.clientTimeZone === "string" ? source.clientTimeZone : void 0;
	if (value === void 0) return void 0;
	if (value !== "UTC" && !IANA_TIME_ZONE.test(value)) throw new TypeError(`browser time zone must be canonical UTC or IANA Area/Location: ${JSON.stringify(value)}`);
	let canonical;
	try {
		canonical = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
	} catch (error) {
		throw new TypeError(`browser time zone is unsupported: ${JSON.stringify(value)}`, { cause: error });
	}
	if (canonical !== value) throw new TypeError(`browser time zone must be canonical: ${JSON.stringify(value)}`);
	return value;
}
/**
* Derive the unique, mixed, or missing browser zone for one open turn.
* @param messages - Entered and proposed user messages belonging to the turn.
* @returns Sorted, duplicate-free browser-zone facts.
* @throws TypeError when a user-rpc source carries an invalid or noncanonical zone.
*/
function deriveBrowserTimeZoneContext(messages) {
	const timeZones = [...new Set(messages.flatMap((message) => {
		const timeZone = browserTimeZone(message);
		return timeZone === void 0 ? [] : [timeZone];
	}))].sort();
	const [timeZone, ...remaining] = timeZones;
	if (timeZone === void 0) return { kind: "missing" };
	if (remaining.length === 0) return {
		kind: "resolved",
		timeZone
	};
	return {
		kind: "mixed",
		timeZones
	};
}
/**
* Render the model instruction for one browser-zone context.
* @param context - Browser-zone facts for the open turn.
* @returns One durable policy line.
*/
function renderBrowserTimeZoneContext(context) {
	switch (context.kind) {
		case "resolved": return `Browser time zone for this request: ${context.timeZone}. Interpret otherwise-unqualified dates and times in this zone.`;
		case "mixed": return `Browser time zone for this request: mixed ${JSON.stringify(context.timeZones)}. Ask the user to clarify otherwise-unqualified dates and times.`;
		case "missing": return "Browser time zone for this request: unavailable. Ask the user to clarify otherwise-unqualified dates and times.";
		/* v8 ignore next 2 -- the closed BrowserTimeZoneContext union is exhausted above. */
		default: return assertNever(context, "BrowserTimeZoneContext");
	}
}
//#endregion
//#region lib/types/timestamp.js
/** ISO-shaped time-context timestamp formatting shared by production and replay validation. */
/**
* Create the exact formatter used by durable time-context readings.
* @param timeZone - Explicit display zone, or `undefined` for the process fallback.
* @returns A formatter with stable numeric local fields and long numeric offset.
*/
function createTimestampFormatter(timeZone) {
	return new Intl.DateTimeFormat("en-US", {
		...timeZone === void 0 ? {} : { timeZone },
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
		timeZoneName: "longOffset"
	});
}
/**
* Format an epoch millisecond value as an ISO-shaped timestamp with offset and IANA zone.
* @param now - Epoch milliseconds to display.
* @param formatter - Formatter created for `timeZone`.
* @param timeZone - Canonical zone label carried in brackets.
* @returns The durable timestamp text.
*/
function formatTimestamp(now, formatter, timeZone) {
	const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
	const offset = parts.timeZoneName.replace(/^GMT$/, "GMT+00:00").slice(3);
	return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}${offset}[${timeZone}]`;
}
//#endregion
//#region lib/types/index.js
/**
* Opt-in request clock context. Eligible steps add durable,
* source-attributed time readings to the request history.
*
* @module @deepseek-ai/dsh-time-context
*/
/** Cordis plugin name used by loader diagnostics. */
const name = "time-context";
/** The agent registry that owns pre-step processing. */
const inject = ["agents"];
/** Schemastery validation for {@link Config}. */
const Config = z.object({
	timeZone: z.string(),
	refreshIntervalMs: z.number()
});
/** Format a non-negative elapsed millisecond count as compact whole-second units. */
function formatDuration(elapsedMs) {
	let seconds = Math.floor(Math.max(0, elapsedMs) / 1e3);
	const days = Math.floor(seconds / 86400);
	seconds %= 86400;
	const hours = Math.floor(seconds / 3600);
	seconds %= 3600;
	const minutes = Math.floor(seconds / 60);
	seconds %= 60;
	const parts = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	parts.push(`${seconds}s`);
	return parts.join(" ");
}
/** Find the latest model-visible event, excluding this plugin's pending append. */
function precedingMessageTime(agent) {
	for (const event of [...agent.session.events].reverse()) switch (event.type) {
		case "user/message":
		case "assistant/message":
		case "tool/result": return event.time;
		default: break;
	}
}
/** Find the preceding time-context event within the open turn. */
function precedingStepContextTime(agent, turn) {
	for (const event of [...agent.session.events].reverse()) {
		if (event.type === "turn/start" && event.data.turn === turn) return void 0;
		if (event.type === "user/message" && event.data.source.kind === "plugin" && event.data.source.plugin === "time-context") return event.time;
	}
}
/** Find this plugin's latest durable injection, including a shadowed surface event. */
function latestInjectionTime(agent) {
	for (const event of [...agent.session.events].reverse()) if (event.type === "user/message" && event.data.source.kind === "plugin" && event.data.source.plugin === "time-context") return event.time;
}
/** Collect already-entered and proposed user messages belonging to one open turn. */
function requestMessages(agent, turn, proposed) {
	const start = agent.session.events.findLastIndex((event) => event.type === "turn/start" && event.data.turn === turn);
	return [...start < 0 ? [] : agent.session.events.slice(start + 1).flatMap((event) => event.type === "user/message" ? [event.data] : []), ...proposed];
}
function renderText(now, turn, step, previous, formatter, timeZone, browserContext) {
	const elapsed = previous === void 0 ? "unavailable" : formatDuration(now - previous);
	const baseline = step === 1 ? "model-visible message" : "step context";
	const browserText = renderBrowserTimeZoneContext(browserContext);
	return `Time sampled while preparing turn ${turn}, step ${step}: ${formatTimestamp(now, formatter, timeZone)}\n${browserText}\nElapsed since the preceding ${baseline}: ${elapsed}.`;
}
/** Reject refresh intervals that cannot represent an exact elapsed-millisecond threshold. */
function validateRefreshInterval(refreshIntervalMs) {
	if (refreshIntervalMs !== void 0 && (!Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 0)) throw new TypeError(`time-context: refreshIntervalMs must be a non-negative safe integer, got ${String(refreshIntervalMs)}`);
}
/**
* Register a prepended pre-step listener for the lifetime of `ctx`.
* @param ctx - plugin context; the listener is disposed with it.
* @param config - time zone and durable refresh scheduling configuration.
* @throws when the refresh interval is invalid or the configured or process time zone cannot be resolved.
*/
function apply(ctx, config) {
	const timeZone = config.timeZone;
	const refreshIntervalMs = config.refreshIntervalMs;
	validateRefreshInterval(refreshIntervalMs);
	let fallbackFormatter;
	try {
		fallbackFormatter = createTimestampFormatter(timeZone);
	} catch (error) {
		const message = timeZone === void 0 ? "time-context: failed to resolve the system time zone" : `time-context: invalid IANA timeZone ${JSON.stringify(timeZone)}`;
		throw new Error(message, { cause: error });
	}
	const fallbackTimeZone = fallbackFormatter.resolvedOptions().timeZone;
	const formatters = new Map([[fallbackTimeZone, fallbackFormatter]]);
	/** Resolve and cache one request-local timestamp formatter. */
	const formatterFor = (selectedTimeZone) => {
		const existing = formatters.get(selectedTimeZone);
		if (existing !== void 0) return existing;
		const created = createTimestampFormatter(selectedTimeZone);
		formatters.set(selectedTimeZone, created);
		return created;
	};
	ctx.on("agent/pre-step", async ({ agent, turn, step, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject" || signal.aborted) return decision;
		const now = Date.now();
		if (refreshIntervalMs !== void 0 && refreshIntervalMs > 0) {
			const lastInjection = latestInjectionTime(agent);
			if (lastInjection !== void 0 && now >= lastInjection && now - lastInjection < refreshIntervalMs) return decision;
		}
		const previous = step === 1 ? precedingMessageTime(agent) : precedingStepContextTime(agent, turn);
		const browser = deriveBrowserTimeZoneContext(requestMessages(agent, turn, decision.messages));
		const selectedTimeZone = browser.kind === "resolved" ? browser.timeZone : fallbackTimeZone;
		const text = renderText(now, turn, step, previous, formatterFor(selectedTimeZone), selectedTimeZone, browser);
		return {
			kind: "enter",
			messages: [...decision.messages, createUserMessage({
				content: [{
					type: "text",
					text
				}],
				source: {
					kind: "plugin",
					plugin: name,
					form: "snapshot",
					sections: [{
						name,
						text
					}]
				}
			})]
		};
	}, { prepend: true });
}
//#endregion
export { Config, apply, inject, name };
