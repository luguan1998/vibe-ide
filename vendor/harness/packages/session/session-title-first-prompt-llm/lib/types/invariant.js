/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-title-first-prompt-llm`.
 * @module @deepseek-ai/dsh-session-title-first-prompt-llm/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-title-first-prompt-llm';
/** Cordis companion plugin name. */
export const name = 'session-title-first-prompt-llm-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this thin provider delegates request and result validation to the shared
 * title service and LLM helper and retains no independent mutable state.
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