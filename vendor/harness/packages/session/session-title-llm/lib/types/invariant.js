/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-title-llm`.
 * @module @deepseek-ai/dsh-session-title-llm/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-title-llm';
/** Cordis companion plugin name. */
export const name = 'session-title-llm-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this stateless helper validates and freezes each auxiliary request before
 * dispatch; deadline, stream, cited message seqs, and provider/model fields are checked synchronously and by tests.
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