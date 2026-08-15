/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-query-sqlite`.
 * @module @deepseek-ai/dsh-session-query-sqlite/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-query-sqlite';
/** Cordis companion plugin name. */
export const name = 'session-query-sqlite-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: reconciliation, cursor generations, and derived-index
 * ownership are validated at each serialized query boundary.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map