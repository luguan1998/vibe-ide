import { relativizeToCwd } from "./tool-call-model.js";
/**
 * Content lines the chat row's resident read body shows before collapsing the
 * middle — half the primitive's own default, which the details panel keeps. A
 * chat row is a summary surface inside the message flow: the flow must stay
 * scannable across many calls, while the details panel is the single-call
 * reading surface. A design constant of this UI's row geometry, not a
 * deployment choice, so it is fixed here rather than a plugin Config field. The
 * same split [`CHAT_TERMINAL_MAX_LINES`](./terminal-card-model.ts) draws for
 * terminal output.
 */
export const CHAT_READ_MAX_LINES = 8;
/**
 * Derive the read-card props for a tool call, or null when this call is not a
 * read card and belongs on the generic path.
 *
 * The read card is result-side only, so only a settled call whose result view
 * declares `card:'read'` produces one. Every other case is null — the
 * documented generic-card default:
 *
 * - A running call: it has no result view yet, and a read carries no content at
 *   call time.
 * - A settled call whose result view is not a read card — including a `card`
 *   value this UI version does not know, which arrives over the wire and cannot
 *   be trusted to be one of the compiled variants, and the read tool's own
 *   generic fallback for an error result or a non-envelope body.
 *
 * The label is the read view's `title` when the tool supplied one (the
 * presentation contract's replacement-title rule), otherwise the file path
 * relativized to the session workspace so a workspace-rooted absolute path
 * displays the same short form the row summary shows.
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @param sessionCwd - the session workspace root; a workspace-rooted absolute
 *   path label displays relative to it. Absent leaves the path as authored.
 * @returns the read-card props, or null for the generic path.
 */
export function readCardModel(block, sessionCwd) {
    // Running has no result view; a read carries no content until execute returns.
    if (!('kind' in block))
        return null;
    const result = block.resultView?.card === 'read' ? block.resultView : null;
    if (result === null)
        return null;
    // Lines arrive frozen off the snapshot; copy into the primitive's own line
    // shape so the card never holds a reference into the runtime's cache.
    const lines = result.lines.map(line => ({ number: line.number, text: line.text }));
    return {
        label: result.title ?? relativizeToCwd(result.path, sessionCwd),
        lines,
        totalLines: result.totalLines,
        lang: result.lang,
    };
}
//# sourceMappingURL=read-card-model.js.map