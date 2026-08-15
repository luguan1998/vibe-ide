//#region lib/types/invariant.js
/** Package-owned durable todo-snapshot invariants. @module @deepseek-ai/dsh-tool-todo/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-tool-todo";
const TODO_STATUSES = new Set([
	"pending",
	"in_progress",
	"completed"
]);
/** Cordis companion plugin name. */
const name = "tool-todo-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* Validate one whole-list todo snapshot before it reaches the durable log.
*
* Deliberately silent on how many items are `in_progress`. That is the tool's
* per-deployment policy (`Config.allowParallelInProgress`), not a durable-shape
* rule: a log written while parallel work was allowed must still replay after a
* deployment tightens the policy, so tying the invariant to the current config
* would reject history that was valid when it was written.
*/
function validateTodos(value, fail) {
	if (!Array.isArray(value)) fail("todo/write todos must be an array");
	const seen = /* @__PURE__ */ new Set();
	for (const item of value) {
		if (typeof item !== "object" || item === null) fail("todo/write entries must be objects");
		const { content, status } = item;
		if (typeof content !== "string" || content.length === 0 || content.trim() !== content) fail("todo/write content must be non-empty and already trimmed");
		if (seen.has(content)) fail(`todo/write repeats content ${JSON.stringify(content)}`);
		seen.add(content);
		if (typeof status !== "string" || !TODO_STATUSES.has(status)) fail(`todo/write carries unknown status ${JSON.stringify(status)}`);
	}
}
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event, fail) {
	if (event.type === "todo/write") validateTodos(event.data.todos, fail);
}
/** Install validation for loaded and newly appended whole-list todo snapshots. */
const install = Object.assign((ctx, fail) => {
	for (const session of ctx.sessions.list()) for (const event of session.events) validateEvent(event, fail);
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "session/event") return;
		const event = args[1];
		validateEvent(event, fail);
	}, { global: true });
}, { inject: ["sessions"] });
/**
* Register the todo invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
