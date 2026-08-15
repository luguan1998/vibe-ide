/**
 * Package-owned invariant companion for the browse directory-picker backend.
 * @module @deepseek-ai/dsh-host-directory-picker-browse/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-host-directory-picker-browse';
/** Cordis companion plugin name. */
export const name = 'host-directory-picker-browse-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: each list/create is one stateless filesystem round trip; the filesystem itself is the authoritative state. */
const install = () => { };
/**
 * Register the browse directory-picker invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map