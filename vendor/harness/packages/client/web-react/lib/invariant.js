//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-client-web-react`.
* @module @deepseek-ai/dsh-client-web-react/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-client-web-react";
/** Cordis companion plugin name. */
const name = "client-web-react-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: pure ctx-to-React glue — it emits no cordis events
* and owns no cross-plugin mutable relation; store batching, selector
* equality short-circuits, and inject-cache identity are asserted directly
* by this package's behavior specs.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
