/** Package-owned invariant companion for the bash seam. @module @deepseek-ai/dsh-shell/invariant */
const PACKAGE_NAME = '@deepseek-ai/dsh-shell';
/** Cordis companion plugin name. */
export const name = 'shell-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: this stateless Service Definition owns request/result types, while executors and policy own observations. */
const install = () => { };
/**
 * Register the bash invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map