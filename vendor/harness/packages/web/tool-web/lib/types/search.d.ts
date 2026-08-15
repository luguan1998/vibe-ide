/**
 * The model-facing `web_search` tool: discover current information on the web.
 * Execution goes through `ctx.web` — this module owns only the model-facing
 * schema, argument validation, the result-count bound, and result formatting,
 * never provider selection or network access.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { GenericCallView, JsonValue, ToolResult, WebSearchResultView, WebSource } from '@deepseek-ai/dsh-tools';
import type { WebSearchResult } from '@deepseek-ai/dsh-web';
/**
 * Default upper bound on returned sources (the `searchMaxResults` config).
 * Owned by the consumer (not the provider or model), mirroring `dsh-tool-fs`'s
 * `READ_LIMIT`. The model just asks a question; the product controls how much
 * context returns. The default `8` aligns with OpenCode's Exa default.
 */
export declare const WEB_SEARCH_MAX_RESULTS = 8;
/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `query`. Throws a plain `Error` otherwise.
 *
 * @param args - the schema-validated `web_search` arguments.
 * @returns the accepted arguments, passed through unchanged.
 */
export declare function parseSearchArgs(args: {
    query: string;
}): {
    query: string;
};
/**
 * Format a search result as one model-facing text block.
 *
 * @param result - the seam's search outcome.
 * @returns the provider answer (when any), a markdown source list with snippet
 *   and date metadata (or `No results found.`), a refine-the-query note when
 *   truncated, and a standing cite-your-sources instruction.
 */
export declare function formatSearchOutput(result: WebSearchResult): string;
/**
 * Pending-call presentation: a search card titled by the query.
 *
 * @param args - the raw tool arguments; only `query` feeds the view.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
export declare function presentSearchCall(args: {
    query: string;
}): GenericCallView;
/**
 * The `web_search` tool's private `tool/result` `meta` payload: the structured
 * sources, the optional provider answer, and the truncation flag. Attached
 * opaquely (as `JsonValue`) on the tool result and persisted with the session
 * log, so `presentResult` reproduces the search card on replay. This projection
 * is the only faithful route to the per-source fields, which the lossy render
 * text cannot carry (the owning rationale is the web-result-card Agent Note).
 */
export interface WebSearchMeta {
    /** The faithful structured sources, in result order. */
    sources: WebSource[];
    /** True when the seam cut the source list to honor the result cap. */
    truncated: boolean;
    /** The provider-generated answer text, when any. */
    answer?: string;
}
/**
 * Project a validated `web_search` output value into its replayable
 * presentation meta ({@link WebSearchMeta} as opaque JSON).
 *
 * @param value - the canonical `web_search` output value (the seam's result shape).
 * @returns the structured sources, the truncation flag, and the answer when present.
 */
export declare function searchMetaFromValue(value: WebSearchResult): JsonValue;
/**
 * Narrow opaque live or replayed result metadata to a {@link WebSearchMeta}.
 * Malformed metadata returns `undefined` so presentation can fall back to the
 * generic card instead of throwing during replay.
 *
 * @param meta - result metadata.
 * @returns the validated search meta, or `undefined` for absent or malformed data.
 */
export declare function searchMetaFromResult(meta: unknown): WebSearchMeta | undefined;
/**
 * Completed-call presentation: a `web` search card carrying the faithful
 * structured sources from `meta`. It sets no `content` copy — a UI without the
 * `web` capability falls back to the raw `tool/result` content, which is the
 * same text (see the web-result-card Agent Note).
 *
 * @param args - the raw tool arguments; `query` becomes the result-state title so
 *   a window-truncated replay that dropped the call head still has one.
 * @param result - the final model-facing tool result; `meta` carries the sources.
 * @returns the search result view, or `undefined` (generic card) on failure or
 *   malformed meta.
 */
export declare function presentSearchResult(args: {
    query: string;
}, result: ToolResult): WebSearchResultView | undefined;
/**
 * Register the `web_search` tool and its system-prompt guidance.
 *
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param maxResults - the deployment's source cap, sent as every seam
 *   request's `maxResults`.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the tool's
 *   `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 * @param fetchEnabled - whether the same composition exposes `web_fetch`, which
 *   controls whether search guidance may recommend that follow-up tool.
 */
export declare function applyWebSearchTool(ctx: Context, maxResults: number, timeoutMs: number, fetchEnabled: boolean): void;
//# sourceMappingURL=search.d.ts.map