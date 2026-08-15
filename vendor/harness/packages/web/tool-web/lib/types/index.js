/**
 * Model-facing `web_search` and `web_fetch` tools over `ctx.web`. This package owns schemas,
 * validation, prompt guidance, limits, and presentation, never concrete providers. Enablement
 * controls tool registration; an enabled tool remains visible when its provider is unavailable
 * and fails with a structured error at execution time.
 * @module @deepseek-ai/dsh-tool-web
 */
import z from '@deepseek-ai/schemastery';
import { applyWebSearchTool, WEB_SEARCH_MAX_RESULTS } from "./search.js";
import { applyWebFetchTool } from "./fetch.js";
export { WEB_SEARCH_MAX_RESULTS, applyWebSearchTool, formatSearchOutput, parseSearchArgs, presentSearchCall, presentSearchResult, searchMetaFromValue, searchMetaFromResult } from "./search.js";
export { applyWebFetchTool, formatFetchOutput, parseFetchArgs, presentFetchCall, presentFetchResult, fetchMetaFromValue, fetchMetaFromResult } from "./fetch.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-web';
/** Services required by the web tool suite. */
export const inject = ['tools', 'web', 'systemPrompt'];
/** Default cooperative tool-call timeout budget (ms) for the web tools. */
export const DEFAULT_WEB_TOOL_TIMEOUT_MS = 30_000;
/**
 * Default cap on one `web_fetch` output and on source characters converted
 * synchronously. This leaves headroom above the local provider's default
 * 100,000-character body cap while bounding custom providers and rendered output.
 */
export const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 200_000;
export const Config = z.object({
    search: z.boolean().default(true),
    fetch: z.boolean().default(true),
    searchMaxResults: z.number().default(WEB_SEARCH_MAX_RESULTS),
    fetchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
    searchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
    fetchMaxOutputChars: z.number().default(DEFAULT_FETCH_MAX_OUTPUT_CHARS),
});
/** Configured count, timeout, and character caps must be positive integers. */
function assertPositiveInteger(name, value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`tool-web: ${name} must be a positive integer`);
    }
}
/**
 * Register the enabled web tools. `search`/`fetch` default to true; a product
 * that wants only one disables the other in config. Each tool's cooperative
 * timeout budget (`fetchTimeoutMs`/`searchTimeoutMs`, default 30000) is resolved
 * here and attached to the tool as `ToolDefinition.timeoutMs` for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce. The tools' disposers are
 * fiber-scoped (the effect-based registries clean up on dispose), so no manual
 * teardown is needed.
 */
export function apply(ctx, config) {
    // schemastery (Config) has already filled every defaulted field.
    const resolved = config;
    assertPositiveInteger('searchMaxResults', resolved.searchMaxResults);
    assertPositiveInteger('fetchTimeoutMs', resolved.fetchTimeoutMs);
    assertPositiveInteger('searchTimeoutMs', resolved.searchTimeoutMs);
    assertPositiveInteger('fetchMaxOutputChars', resolved.fetchMaxOutputChars);
    if (resolved.search) {
        applyWebSearchTool(ctx, resolved.searchMaxResults, resolved.searchTimeoutMs, resolved.fetch);
    }
    if (resolved.fetch)
        applyWebFetchTool(ctx, resolved.fetchTimeoutMs, resolved.fetchMaxOutputChars);
}
//# sourceMappingURL=index.js.map