/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-app-boot`.
 * @module @deepseek-ai/dsh-app-boot/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-app-boot';
/** Cordis companion plugin name. */
export const name = 'app-boot-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this presentation adapter owns no durable package-local event stream;
 * boundary and replay tests cover its protocol mapping.
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