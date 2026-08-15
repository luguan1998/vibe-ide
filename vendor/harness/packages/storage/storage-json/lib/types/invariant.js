/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-storage-json`.
 * @module @deepseek-ai/dsh-storage-json/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-storage-json';
/** Cordis companion plugin name. */
export const name = 'storage-json-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: correctness here is write-durability and
 * publish-then-reparse equivalence, which require medium round-trip tests
 * (the shared backend conformance suite); the backend exposes no continuously
 * observable in-process relation.
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