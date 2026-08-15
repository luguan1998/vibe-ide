/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-client`.
 * @module @deepseek-ai/dsh-mcp-client/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-client';
/** Cordis companion plugin name. */
export const name = 'mcp-client-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: MCP generations contribute through the tool registry, but the bridge
 * exposes no independent server-to-tool snapshot after an asynchronous resync.
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