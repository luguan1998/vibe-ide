/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-timeout`.
 * @module @deepseek-ai/dsh-timeout/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-timeout';
/** Cordis companion plugin name. */
export const name = 'timeout-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this pure utility owns no event stream or mutable runtime data; its value
 * algebra is enforced by unit tests.
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