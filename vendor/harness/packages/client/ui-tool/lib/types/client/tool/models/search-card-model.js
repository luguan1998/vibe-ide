/**
 * Result rows the chat row's resident search body shows before collapsing the
 * middle — half the primitive's own default, which the details panel keeps. A
 * chat row is a summary surface inside the message flow: the flow must stay
 * scannable across many calls, while the details panel is the single-call
 * reading surface. A design constant of this UI's row geometry, not a
 * deployment choice, so it is fixed here rather than a plugin Config field.
 */
export const CHAT_SEARCH_MAX_LINES = 8;
/**
 * Whether every file group in a matches view is structurally valid: the wire
 * frame carries `shape` and `card` as strings the host schema checks, but not the
 * grouped `files` fields, so a version mismatch or loose producer could deliver
 * `shape: 'matches'` with a missing or malformed `files`. Rendering that would
 * crash {@link SearchBlock} at `.reduce`/`.map`; invalid fields select the
 * generic path instead.
 * @param files - the candidate `files` field off the untrusted result view.
 * @returns whether `files` is a valid {@link SearchFileGroup} array.
 */
function isValidFiles(files) {
    return Array.isArray(files) && files.every(file => typeof file === 'object' && file !== null
        && typeof file.path === 'string'
        && Array.isArray(file.matches)
        && file.matches.every(match => typeof match === 'object' && match !== null
            && typeof match.lineNumber === 'number'
            && typeof match.line === 'string'));
}
/**
 * Flatten a settled tool result's content blocks to their text, joined by
 * newlines. The search view carries no result text — a UI without a card falls
 * back to the raw `tool/result` content — so the truncation recovery footer is
 * read from the block's own content here. Non-text blocks (a search result
 * carries none) are skipped.
 * @param content - the result node's content blocks.
 * @returns the joined text, or undefined when empty.
 */
function flattenContent(content) {
    const text = content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n');
    return text === '' ? undefined : text;
}
/**
 * Derive the search-card props for a tool call, or null when this call is not a
 * search card and belongs on the generic path.
 *
 * Only the result side matters: the search card carries no call-time state, so
 * a still-running call (no result view) is null, as is a settled call whose
 * result view is not a search card — including a `card` value this UI version
 * does not know, which arrives over the wire and cannot be trusted to be one of
 * the compiled variants, a `card: 'search'` view whose `shape` is neither
 * `matches` nor `paths` (equally untrusted wire data), and a generic result a
 * `grep`/`glob` failure or nested `run_code` dispatch produces (its text keeps
 * the generic path).
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @returns the search-card props, or null for the generic path.
 */
export function searchCardModel(block) {
    // Running: no result view exists yet, and a search card is result-only.
    if (!('kind' in block))
        return null;
    const result = block.resultView?.card === 'search' ? block.resultView : null;
    if (result === null)
        return null;
    const common = { truncated: result.truncated, total: result.total };
    // The recovery footer only matters when the tool capped the result: an
    // uncapped card holds every match/path, so the raw text adds nothing the card
    // does not already show. When capped, the raw result's `Full … stored at …`
    // locator is the only way to retrieve the omitted rows, so include it.
    const recovery = result.truncated ? flattenContent(block.content) : undefined;
    if (result.shape === 'matches') {
        // `files` rides the untrusted wire frame: the host schema checks `card`/`shape`
        // strings but not the grouped `files` fields, so validate them before
        // SearchBlock, which would crash on a missing or malformed `files`.
        // Invalid fields select the generic view.
        if (!isValidFiles(result.files))
            return null;
        return { title: result.title, recovery, card: { kind: 'matches', files: result.files, ...common } };
    }
    // `shape` rides the same untrusted wire frame as `card`, so a version mismatch
    // or a loose protocol producer could deliver a `card: 'search'` subtype this
    // client does not compile. Guard the paths shape explicitly: an unknown shape
    // falls to the generic path rather than being rendered as a paths card, which
    // would leave SearchBlock calling `.length`/`.map` on an absent `paths`.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- shape is wire data; the compiled union cannot prove this exhaustive.
    if (result.shape !== 'paths')
        return null;
    // `paths` is likewise unchecked by the wire schema; a known shape with a
    // missing/malformed array would crash the paths card at `.map`.
    if (!Array.isArray(result.paths) || !result.paths.every((path) => typeof path === 'string'))
        return null;
    return { title: result.title, recovery, card: { kind: 'paths', paths: result.paths, ...common } };
}
//# sourceMappingURL=search-card-model.js.map