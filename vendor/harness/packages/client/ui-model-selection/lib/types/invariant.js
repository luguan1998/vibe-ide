/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-model-selection`.
 * @module @deepseek-ai/dsh-client-ui-model-selection/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-model-selection';
/** Cordis companion plugin name. */
export const name = 'client-ui-model-selection-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: a single command contribution registration whose disposal is
 * proven by the HMR-safety spec — it emits no cordis events and owns no
 * cross-plugin mutable state.
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