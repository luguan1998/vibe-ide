//#region lib/types/index.js
/** Web Session-log download command over the host endpoint owned by ApiProxy. */
const name = "session-log-download";
const inject = ["commands"];
const REQUESTED = {
	kind: "success",
	text: "Session log download requested."
};
/**
* Register the Web-only `/export` command that the browser download plugin observes.
* @param ctx - Host context carrying the human-command registry.
*/
function apply(ctx) {
	ctx.effect(() => ctx.commands.register({
		name: "export",
		description: "Download this Session log as a ZIP archive",
		handler: (invocation) => Promise.resolve(invocation.rawInput.trim() === "" ? REQUESTED : {
			kind: "error",
			text: "The Web /export command does not accept a path."
		})
	}), "session-log-download: command");
}
//#endregion
export { apply, inject, name };
