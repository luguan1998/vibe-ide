// Head/tail height-cap arithmetic shared by the block primitives (TerminalBlock,
// SearchBlock), so long results use consistent head and tail slices. The split is
// `ceil(maxLines / 2)` head rows and the remainder as tail rows; a result within
// the cap shows every row and hides none.
/**
 * Compute the head/tail cap metrics for a list of `total` rows against `maxLines`,
 * given whether the surface is expanded. Pure arithmetic; the caller slices its
 * own rows with `headLines`/`tailLines` so a block can layer its own concerns
 * (SearchBlock restores a tail file header) on top.
 * @param total - the list's row count.
 * @param maxLines - the collapsed-height cap in rows.
 * @param expanded - whether the surface is expanded (uncaps the list).
 * @returns the split metrics.
 */
export function headTailCap(total, maxLines, expanded) {
    const hidden = total - maxLines;
    const headLines = Math.ceil(maxLines / 2);
    return { hidden, capped: hidden > 0 && !expanded, headLines, tailLines: maxLines - headLines };
}
//# sourceMappingURL=head-tail-cap.js.map