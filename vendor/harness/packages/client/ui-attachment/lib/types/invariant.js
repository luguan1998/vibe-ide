/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-attachment`.
 * @module @deepseek-ai/dsh-client-ui-attachment/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-attachment';
/** Cordis companion plugin name. */
export const name = 'client-ui-attachment-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: pure props-in React atoms with no Cordis API —
 * no events, no services, no mutable cross-plugin state; rendering contracts
 * are asserted directly by this package's component specs.
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