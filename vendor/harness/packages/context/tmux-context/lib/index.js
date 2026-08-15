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
* Opt-in request-preparation tmux-location context. Eligible step attempts
* append durable, source-attributed context naming the tmux session, window,
* and pane this agent process runs in, plus the window's pane-tree layout.
*
* The plugin pulls state once per turn, for the first request (`step === 1`), by
* running one `tmux display-message` through the `ctx.shell` executor service. It
* confirms this process genuinely runs inside the pane `$TMUX_PANE` names by
* matching the pane's `#{pane_tty}` against this process's controlling terminal,
* so a terminal that merely inherited `$TMUX`/`$TMUX_PANE` from a tmux ancestor
* (e.g. a VS Code integrated terminal) reads as "not in tmux". It re-injects
* only when the rendered tmux state changes since the last injection (a moved,
* renamed, or re-laid-out pane), with an optional `refreshIntervalMs` floor
* between injections. Absent tmux environment, an inherited-only environment,
* absent `ctx.shell`, or a failed query is a no-op, never an error: an executor
* rejection is contained and logged as a warning so the turn continues.
*
* @module @deepseek-ai/dsh-tmux-context
*/
/** Cordis plugin name used by loader diagnostics. */
const name = "tmux-context";
/** The agent registry that owns pre-step processing. */
const inject = ["agents"];
/** Schemastery validation for {@link Config}. */
const Config = z.object({ refreshIntervalMs: z.number() });
/**
* Tab-separated tmux format fields, in query order. Layout (`window_layout`)
* is the pane-tree description; pane/window pixel sizes are intentionally
* excluded (own location and layout only, per the package scope).
*/
const TMUX_FIELDS = [
	"#{session_name}",
	"#{window_index}",
	"#{window_name}",
	"#{pane_index}",
	"#{pane_id}",
	"#{window_active}",
	"#{pane_active}",
	"#{window_layout}"
];
/** Prefix marking the volatile turn/step preamble line of a rendered reading. */
const READING_PREFIX = "tmux location (turn ";
/**
* Field separator between tmux format fields. tmux does not interpret C escapes
* in a format, so the literal two-character sequence `\t` is emitted verbatim
* and split back out here; this avoids embedding raw whitespace in the command.
*/
const FIELD_SEP = "\\t";
/**
* Read this process's tmux location through the bash seam, or `undefined` when
* this process is not genuinely running inside a tmux pane or the query fails.
*
* `$TMUX_PANE` alone is insufficient: a terminal launched from a tmux shell
* (e.g. VS Code's integrated terminal, a desktop launcher) inherits `$TMUX` and
* `$TMUX_PANE` from that ancestor, so the variables are present even though this
* process does not live in that pane. The command therefore also compares the
* pane's `#{pane_tty}` against this process's own controlling terminal
* (`ps -o tty=` for {@link processId}); a genuine pane owns this process's tty,
* an inherited environment names some other pane's tty. Fields are emitted only
* on a match, so an inherited environment reads as "not in tmux" and injects
* nothing.
*
* The location is optional context, so an executor rejection is a failed query,
* not a turn failure: `resolve()` may reject the command on policy grounds and
* `run()` only promises to resolve for nonzero exits, timeouts, and aborts, so
* both are contained and reported as a warning.
*
* @param bash - The executor service used to run the read-only tmux/ps commands.
* @param logger - receives a warning when the executor rejects the query.
* @param processId - this agent process's pid, whose controlling tty must match the pane.
* @param signal - abort signal forwarded to the executor.
* @returns the parsed location, or `undefined` when not in a real pane or on any failure.
*/
async function queryTmuxLocation(bash, logger, processId, signal) {
	const format = TMUX_FIELDS.join(FIELD_SEP);
	const command = [
		"[ -n \"$TMUX_PANE\" ] || exit 1",
		`self_tty=$(ps -o tty= -p ${processId} | tr -d ' ')`,
		"[ -n \"$self_tty\" ] || exit 1",
		"pane_tty=$(tmux display-message -t \"$TMUX_PANE\" -p '#{pane_tty}') || exit 1",
		"[ \"$pane_tty\" = \"/dev/$self_tty\" ] || exit 1",
		`exec tmux display-message -t "$TMUX_PANE" -p '${format}'`
	].join("\n");
	let result;
	try {
		result = await bash.run(bash.resolve({
			command,
			signal
		}));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn(`tmux location query failed: ${message}; injecting no location this turn`);
		return;
	}
	if (result.exitCode !== 0) return void 0;
	const parts = result.stdout.text.split("\n", 1)[0].split(FIELD_SEP);
	if (parts.length !== TMUX_FIELDS.length) return void 0;
	const [sessionName, windowIndex, windowName, paneIndex, paneId, windowActive, paneActive, windowLayout] = parts;
	if (paneId.length === 0) return void 0;
	return {
		sessionName,
		windowIndex,
		windowName,
		paneIndex,
		paneId,
		windowActive,
		paneActive,
		windowLayout
	};
}
/**
* Render the stable tmux state block: the part of a reading compared for
* change suppression. It excludes the turn preamble so re-injection is driven
* only by tmux state, not by loop position.
*/
function renderState(location) {
	return `session ${location.sessionName}, window ${location.windowIndex} ${JSON.stringify(location.windowName)}, pane ${location.paneIndex} ${location.paneId}\nwindow active=${location.windowActive}, pane active=${location.paneActive}, layout ${location.windowLayout}`;
}
/** Render the full durable reading, including the volatile turn preamble. */
function renderReading(location, turn) {
	return `${READING_PREFIX}${turn}):\n${renderState(location)}`;
}
/**
* The stable state block of this plugin's latest durable injection, or
* `undefined` when the session has none. Scans raw durable events so the
* schedule survives compaction and resumed processes without process-local
* cache state.
*/
function latestInjectedState(agent) {
	for (const event of [...agent.session.events].reverse()) if (event.type === "user/message" && event.data.source.kind === "plugin" && event.data.source.plugin === "tmux-context") {
		const [block] = event.data.content;
		if (block?.type !== "text") return void 0;
		const newline = block.text.indexOf("\n");
		return {
			state: newline === -1 ? "" : block.text.slice(newline + 1),
			time: event.time
		};
	}
}
/** Reject refresh intervals that cannot represent an exact elapsed-millisecond threshold. */
function validateRefreshInterval(refreshIntervalMs) {
	if (refreshIntervalMs !== void 0 && (!Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 0)) throw new TypeError(`tmux-context: refreshIntervalMs must be a non-negative safe integer, got ${String(refreshIntervalMs)}`);
}
/**
* Register a prepended pre-step listener for the lifetime of `ctx`.
* @param ctx - plugin context; the listener is disposed with it.
* @param config - durable refresh scheduling configuration.
* @throws when the refresh interval is invalid.
*/
function apply(ctx, config) {
	const refreshIntervalMs = config.refreshIntervalMs;
	validateRefreshInterval(refreshIntervalMs);
	ctx.on("agent/pre-step", async ({ agent, turn, step, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject" || signal.aborted || step !== 1) return decision;
		const bash = ctx.get("shell");
		if (bash === void 0) return decision;
		const previous = latestInjectedState(agent);
		if (refreshIntervalMs !== void 0 && refreshIntervalMs > 0 && previous !== void 0) {
			const now = Date.now();
			if (now >= previous.time && now - previous.time < refreshIntervalMs) return decision;
		}
		const location = await queryTmuxLocation(bash, ctx.logger, process.pid, signal);
		if (location === void 0) return decision;
		const state = renderState(location);
		if (previous !== void 0 && previous.state === state) return decision;
		const text = renderReading(location, turn);
		return {
			kind: "enter",
			messages: [createUserMessage({
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
			}), ...decision.messages]
		};
	}, { prepend: true });
}
//#endregion
export { Config, apply, inject, name };
