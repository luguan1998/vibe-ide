/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-terminal-bash`.
 * @module @deepseek-ai/dsh-terminal-bash/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-terminal-bash';
/** Cordis companion plugin name. */
export const name = 'terminal-bash-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: readiness, terminal buffers, and process-tree state are private per-session
 * implementation state, and the backend publishes no independent lifecycle stream or snapshot.
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