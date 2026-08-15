/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-bash-persistent`.
 * @module @deepseek-ai/dsh-tool-bash-persistent/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-bash-persistent';
/** Cordis companion plugin name. */
export const name = 'tool-bash-persistent-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the adapter's private owner-to-shell cache has no
 * observable event or data relation. Lifecycle tests prove its cleanup without
 * adding a public API solely for an invariant.
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