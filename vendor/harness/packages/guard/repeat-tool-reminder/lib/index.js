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
//#region lib/types/index.js
/**
* Advisory per-agent repeat-call detector. It enriches post-execute decisions
* with logged model context without vetoing or rewriting calls. Configuration
* and chain semantics live in the package README; rationale lives in the
* repeat-tool-reminder Agent Note.
* @module @deepseek-ai/dsh-repeat-tool-reminder
*/
const name = "repeat-tool-reminder";
const Config = z.object({
	thresholds: z.array(z.number()).default([
		3,
		5,
		8
	]),
	include: z.array(z.string()).default([]),
	exclude: z.array(z.string()).default([]),
	argumentsPreviewChars: z.number().default(500)
});
/**
* The `{kind:'plugin'}` source stamped on every reminder this guard injects —
* the label is load-bearing (an unlabeled context would render as a user
* prompt in derived history).
*/
const PLUGIN_SOURCE = {
	kind: "plugin",
	plugin: "repeat-tool-reminder"
};
/**
* The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
* count, so a custom first threshold keeps the gentle-then-detailed escalation.
*/
const GENTLE_REMINDER = "You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.";
/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName, count, canonicalArguments) {
	return `Repeated tool call detected:
- tool: ${toolName}\n- consecutive_calls: ${count}\n- arguments: ${canonicalArguments}\nThe repeated calls are not making progress. Do not call this tool with these exact arguments again. Inspect the latest result and choose a different action, different arguments, or finish the task if enough evidence has been gathered.`;
}
/**
* Deep key-sort of a parsed-JSON value so two argument objects that differ
* only in property order canonicalize identically. Arguments reach the guard
* as the loop's `JSON.parse` output (or its raw-string fallback for malformed
* argument JSON), so JSON's value domain is the whole input domain — no
* bigint, cycle, or `undefined` handling exists because no input path can
* produce them.
*/
function sortJsonValue(value) {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (value !== null && typeof value === "object") {
		const record = value;
		const sorted = {};
		for (const key of Object.keys(record).sort()) sorted[key] = sortJsonValue(record[key]);
		return sorted;
	}
	return value;
}
/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue) {
	return JSON.stringify(sortJsonValue(argumentsValue));
}
/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern) {
	const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`);
	return new RegExp(`^${escaped.replaceAll("*", ".*")}$`);
}
/**
* Head-truncate the canonical arguments for quoting in the detailed reminder,
* marking how much was omitted. Bounds only the model-visible text — the
* chain key always uses the full canonical string.
*/
function previewArguments(canonical, cap) {
	if (canonical.length <= cap) return canonical;
	return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`;
}
/**
* Validate `thresholds` per the fail-loud contract and return them sorted
* ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
* order is normalized here, once).
*/
function validateThresholds(values) {
	if (values.length === 0) throw new Error("repeat-tool-reminder: `thresholds` must not be empty");
	for (const value of values) if (!Number.isInteger(value) || value < 2) throw new Error(`repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`);
	if (new Set(values).size !== values.length) throw new Error("repeat-tool-reminder: `thresholds` must not contain duplicates");
	return [...values].sort((a, b) => a - b);
}
/**
* Prepend the guard's reminder while preserving every downstream context's
* source and metadata.
*/
function prependContext(ours, theirs) {
	return [ours, ...theirs ?? []];
}
/**
* Install the guard's listeners.
* @param ctx - plugin context; listeners are scoped to it and disposed with it.
* @param config - validated {@link Config}; `thresholds` is re-checked fail-loud here.
*/
function apply(ctx, config) {
	const thresholds = validateThresholds(config.thresholds);
	const thresholdSet = new Set(thresholds);
	const includePatterns = config.include.map(wildcardToRegExp);
	const excludePatterns = config.exclude.map(wildcardToRegExp);
	const argumentsPreviewChars = config.argumentsPreviewChars;
	if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`);
	const chains = /* @__PURE__ */ new WeakMap();
	/** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
	function tracked(toolName) {
		if (includePatterns.length > 0 && !includePatterns.some((pattern) => pattern.test(toolName))) return false;
		return !excludePatterns.some((pattern) => pattern.test(toolName));
	}
	/**
	* Advance the calling agent's chain for one attempt and return the reminder
	* to deliver, if this attempt's run length hits a configured threshold.
	* Counting happens here — in post-execute — because denied calls also flow
	* through this waterfall (`ToolRuntime.execute` routes a deny through the
	* same pipeline), and a model hammering a denied call is exactly the loop
	* worth breaking.
	*/
	function observe(exec) {
		if (!exec.agent) return void 0;
		if (!tracked(exec.name)) return void 0;
		const canonical = canonicalize(exec.arguments);
		const key = JSON.stringify([exec.name, canonical]);
		const chain = chains.get(exec.agent);
		const count = chain !== void 0 && chain.key === key ? chain.count + 1 : 1;
		chains.set(exec.agent, {
			key,
			count
		});
		if (!thresholdSet.has(count)) return void 0;
		return createUserMessage({
			content: [{
				type: "text",
				text: count === thresholds[0] ? GENTLE_REMINDER : detailedReminder(exec.name, count, previewArguments(canonical, argumentsPreviewChars))
			}],
			source: {
				...PLUGIN_SOURCE,
				form: "notice",
				summary: `${exec.name} × ${count}`
			}
		});
	}
	ctx.on("tools/post-execute", async (exec, _result, next) => {
		const reminder = observe(exec);
		const downstream = await next();
		if (!reminder) return downstream;
		if (downstream.kind === "block") return {
			kind: "block",
			feedback: downstream.feedback,
			additionalContexts: prependContext(reminder, downstream.additionalContexts)
		};
		return {
			...downstream,
			additionalContexts: prependContext(reminder, downstream.additionalContexts)
		};
	});
	ctx.on("agent/pre-step", ({ agent, messages }, next) => {
		if (messages.some((message) => message.source.kind === "user")) chains.delete(agent);
		return next();
	});
}
//#endregion
export { Config, apply, name };
