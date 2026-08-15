/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-command-compact`.
 * @module @deepseek-ai/dsh-command-compact/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-command-compact';
/** Cordis companion plugin name. */
export const name = 'command-compact-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this command adapter owns no state or event stream; the compaction seam owns
 * the balanced durable transaction and the command registry owns registration and dispatch lifecycle.
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