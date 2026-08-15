/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-call-timeout-policy`.
 * @module @deepseek-ai/dsh-tool-call-timeout-policy/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-call-timeout-policy';
/** Cordis companion plugin name. */
export const name = 'timeout-policy-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this stateless policy plugin owns no package-local event history or mutable
 * data relation beyond the seam it intercepts.
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