/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-workflow-worker-thread`.
 * @module @deepseek-ai/dsh-workflow-worker-thread/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-workflow-worker-thread';
/** Cordis companion plugin name. */
export const name = 'workflow-worker-thread-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this process-boundary implementation exposes no same-process event relation;
 * worker protocol and built-worker tests cover it.
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