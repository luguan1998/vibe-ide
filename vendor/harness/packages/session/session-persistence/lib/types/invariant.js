/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-persistence`.
 * @module @deepseek-ai/dsh-session-persistence/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-persistence';
/** Cordis companion plugin name. */
export const name = 'session-persistence-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: persistence correctness requires backend round-trip and crash-tail tests;
 * this package exposes no continuously observable in-process relation.
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