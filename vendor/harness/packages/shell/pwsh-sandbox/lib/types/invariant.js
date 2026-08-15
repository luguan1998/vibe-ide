/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-pwsh-sandbox`.
 * @module @deepseek-ai/dsh-pwsh-sandbox/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-pwsh-sandbox';
/** Cordis companion plugin name. */
export const name = 'pwsh-sandbox-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this package exposes no independent event sequence or
 * mutable data relation beyond contracts enforced at its owning seams.
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