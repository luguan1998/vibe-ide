import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// DiffBlock: the inline-diff surface for a file mutation (write/edit) — a copy
// control over one or more per-file hunks, each a bold path header followed by
// the removed block (`-`, error color) and the added block (`+`, success
// color), with a dim `└ +A -R · N file(s)` footer. Unlike the TUI's exact
// changed-row comparison, this block renders the old and new sides in full.
// Both front ends share the line-terminator rule and distinct-path file count.
// Output never soft-wraps — an aligned source line keeps its indentation and
// scrolls horizontally instead of folding. Colors resolve through --dsw-*
// tokens; geometry mirrors CodeBlock.
import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { writeClipboard } from "./clipboard.js";
import css from './DiffBlock.module.css';
/**
 * Output lines shown before the height cap collapses the middle. Matches
 * {@link DEFAULT_TERMINAL_MAX_LINES} so a diff card and a terminal card cut a
 * long body at the same place.
 */
export const DEFAULT_DIFF_MAX_LINES = 16;
/** Local exhaustiveness helper — this package does not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a row kind is forged */
function assertNever(value) {
    throw new Error(`unreachable diff row kind: ${String(value)}`);
}
/** The dim class per row kind (path/gap chrome vs the diff's own +/- colors). */
const ROW_CLASS = {
    path: css.path,
    del: css.del,
    add: css.add,
    gap: css.gap,
};
/**
 * Flatten the hunks into the body's rows plus the footer counts. A path header
 * opens each new file; a same-file second hunk (a scattered edit) opens with a
 * `⋯` gap instead of repeating the path. Every old-side line counts toward
 * `removed` and every new-side line toward `added`. The file count is of
 * DISTINCT paths, matching the TUI diff card's footer, so two hunks in one file
 * read as `1 file` on both front ends.
 * @param diffs - the hunks to render.
 * @returns the body rows, the +/- totals, and the distinct-file count.
 */
function buildRows(diffs) {
    const rows = [];
    const paths = new Set();
    let added = 0;
    let removed = 0;
    let prevPath;
    for (const diff of diffs) {
        paths.add(diff.path);
        if (diff.path !== prevPath)
            rows.push({ kind: 'path', text: diff.path });
        else
            rows.push({ kind: 'gap', text: '⋯' });
        prevPath = diff.path;
        if (diff.oldText !== null) {
            for (const line of contentLines(diff.oldText)) {
                rows.push({ kind: 'del', text: line });
                removed++;
            }
        }
        for (const line of contentLines(diff.newText)) {
            rows.push({ kind: 'add', text: line });
            added++;
        }
    }
    return { rows, added, removed, files: paths.size };
}
/**
 * Split a side's text into its content lines. Empty text is zero lines (a full
 * deletion's `newText` or a create's absent `oldText` side draws nothing), and a
 * single trailing newline is a line terminator rather than an extra empty line —
 * the same terminator rule TerminalBlock applies to command output. An interior
 * blank line (a genuine `\n\n`) survives.
 * @param text - the removed or added side's text.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text) {
    if (text === '')
        return [];
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    return body.split('\n');
}
/**
 * The diff text a reader copies: each row's `-`/`+`/path/gap prefix and its
 * content, exactly what the card shows. The removed and added blocks are the
 * change; the path headers keep a multi-file copy attributable.
 * @param rows - the flattened body rows.
 * @returns the diff as plain text.
 */
function copyText(rows) {
    return rows.map((row) => {
        switch (row.kind) {
            case 'del': return `- ${row.text}`;
            case 'add': return `+ ${row.text}`;
            case 'path': return row.text;
            case 'gap': return row.text;
            /* v8 ignore next -- closed-union backstop; only reached if a row kind is forged */
            default: return assertNever(row.kind);
        }
    }).join('\n');
}
/**
 * Render a file mutation as an inline diff surface.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export function DiffBlock({ diffs, maxLines = DEFAULT_DIFF_MAX_LINES, className }) {
    const { rows, added, removed, files } = useMemo(() => buildRows(diffs), [diffs]);
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const onCopy = useCallback(() => {
        if (copied)
            return;
        void writeClipboard(copyText(rows)).then((ok) => {
            if (!ok)
                return;
            setCopied(true);
            window.setTimeout(() => { setCopied(false); }, 1000);
        });
    }, [copied, rows]);
    const onToggle = useCallback(() => { setExpanded(value => !value); }, []);
    if (rows.length === 0)
        return null;
    const hidden = rows.length - maxLines;
    const capped = hidden > 0 && !expanded;
    // Same split arithmetic as TerminalBlock and the TUI transcript's collapsed
    // card, so a body's head and tail slices agree across the front ends.
    const headLines = Math.ceil(maxLines / 2);
    const tailLines = maxLines - headLines;
    const head = capped ? rows.slice(0, headLines) : rows;
    const tail = capped ? rows.slice(rows.length - tailLines) : [];
    return (_jsxs("div", { className: clsx(css.block, className), "data-diff": "", children: [_jsx("button", { type: "button", className: css.copyButton, onClick: onCopy, children: copied ? '复制成功' : '复制' }), _jsxs("div", { className: css.body, children: [head.map((row, index) => (_jsx("div", { className: clsx(css.line, ROW_CLASS[row.kind]), children: row.text }, index))), hidden > 0 && (_jsx("button", { type: "button", className: css.expand, "aria-expanded": expanded, "aria-label": expanded ? '收起差异' : `展开其余 ${hidden} 行差异`, onClick: onToggle, children: expanded ? '收起' : `… 其余 ${hidden} 行` })), tail.map((row, index) => (_jsx("div", { className: clsx(css.line, ROW_CLASS[row.kind]), children: row.text }, index)))] }), _jsxs("div", { className: css.footer, children: ["\u2514 +", added, " -", removed, " \u00B7 ", files, " file", files === 1 ? '' : 's'] })] }));
}
//# sourceMappingURL=DiffBlock.js.map