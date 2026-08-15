import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// SearchBlock: the search surface for a completed content or path search — a
// banner (result summary that folds the pre-cap total in when the tool capped
// the result, plus a copy control), then either grep matches grouped by file
// (each file a bold
// path header with its `lineNumber: line` rows, the group collapsible) or a
// flat glob path list. Both shapes flatten to one list of rows the height cap
// slices head/tail over, and neither soft-wraps: a long match line or path
// scrolls horizontally instead of folding. Geometry mirrors CodeBlock and
// TerminalBlock so a search card reads as one family with them.
import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { headTailCap } from "./head-tail-cap.js";
import { useCopyFeedback } from "./use-copy-feedback.js";
import css from './SearchBlock.module.css';
/**
 * Result rows shown before the height cap collapses the middle. Matches
 * {@link DEFAULT_TERMINAL_MAX_LINES} so a search card and a terminal card cut a
 * long result at the same place.
 */
export const DEFAULT_SEARCH_MAX_LINES = 16;
/**
 * The plain-text form the copy control writes: the whole structured result
 * regardless of the height cap or which groups are collapsed, so the clipboard
 * carries the result rather than what the card happens to be showing.
 * @param props - the card's props.
 * @returns the copyable text, or the empty string for an empty result.
 */
function copyText(props) {
    if (props.kind === 'paths')
        return props.paths.join('\n');
    return props.files
        .map(file => [file.path, ...file.matches.map(m => `${m.lineNumber}: ${m.line}`)].join('\n'))
        .join('\n\n');
}
/**
 * Number of retained results the card holds: the matched-line count across all
 * files for a matches card, the path count for a paths card. This is the count
 * the banner summary reports against `total` when the result was capped.
 * @param props - the card's props.
 * @returns the retained result count.
 */
function shownCount(props) {
    return props.kind === 'paths'
        ? props.paths.length
        : props.files.reduce((sum, file) => sum + file.matches.length, 0);
}
/**
 * The banner summary. When the search was capped it reads `显示 X / 共 N …` so
 * the retained count and the pre-cap total sit in one clause (mirroring the read
 * card's `显示 X / Y 行`); when it was not capped it is a plain count of what the
 * card holds. The unit — `处匹配 · K 个文件` for grep, `个路径` for glob — trails
 * the count either way.
 * @param props - the card's props.
 * @param shown - the retained result count from {@link shownCount}.
 * @param truncated - whether the search was capped.
 * @param total - the pre-cap total the truncation clause reports.
 * @returns the summary text.
 */
function summaryText(props, shown, truncated, total) {
    const count = truncated ? `显示 ${shown} / 共 ${total}` : `${shown}`;
    return props.kind === 'paths'
        ? `${count} 个路径`
        : `${count} 处匹配 · ${props.files.length} 个文件`;
}
/**
 * Flatten a card's shape into its render rows, dropping a collapsed file
 * group's match rows.
 * @param props - the card's props.
 * @param collapsed - the set of collapsed file-group indices (matches only).
 * @returns the flattened rows in output order.
 */
function toRows(props, collapsed) {
    if (props.kind === 'paths')
        return props.paths.map((path) => ({ type: 'path', path }));
    const rows = [];
    props.files.forEach((file, index) => {
        const isCollapsed = collapsed.has(index);
        rows.push({ type: 'file', path: file.path, count: file.matches.length, index, collapsed: isCollapsed });
        if (isCollapsed)
            return;
        for (const match of file.matches) {
            rows.push({ type: 'match', lineNumber: match.lineNumber, line: match.line, key: `${index}:${match.lineNumber}`, fileIndex: index });
        }
    });
    return rows;
}
/**
 * A stable React key for a flattened render row: the group-scoped match key, a
 * file-index-scoped header key, or the path itself. Rows of different types
 * never collide, since each key carries its type prefix or the group index.
 * @param row - the flattened row.
 * @returns the key.
 */
function rowKey(row) {
    switch (row.type) {
        case 'match': return `match:${row.key}`;
        case 'file': return `file:${row.index}`;
        case 'path': return `path:${row.path}`;
    }
}
/**
 * Render a completed search as a grouped-matches or flat-path card.
 * @param props - see {@link SearchBlockProps}.
 * @returns the search block element.
 */
export function SearchBlock(props) {
    const { truncated, total, maxLines = DEFAULT_SEARCH_MAX_LINES, className } = props;
    const [expanded, setExpanded] = useState(false);
    const [collapsed, setCollapsed] = useState(() => new Set());
    // `props` is a fresh object each render, so memoizing on it never hits; the
    // flatten is cheap, so it runs inline keyed on the collapse set instead.
    const rows = toRows(props, collapsed);
    const shown = shownCount(props);
    const empty = rows.length === 0;
    const { copied, onCopy } = useCopyFeedback(copyText(props));
    const onToggle = useCallback(() => { setExpanded(value => !value); }, []);
    const toggleFile = useCallback((index) => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(index))
                next.delete(index);
            else
                next.add(index);
            return next;
        });
    }, []);
    const { hidden, capped, headLines, tailLines } = headTailCap(rows.length, maxLines, expanded);
    const head = capped ? rows.slice(0, headLines) : rows;
    const naturalTail = capped ? rows.slice(rows.length - tailLines) : [];
    // When the tail slice begins inside a file's matches, its own header sits
    // above the cut and is not shown, so those rows could not be attributed to a
    // file. Restore the owning header at the top of the tail — unless the head
    // slice already carries it (a single large file), where it would duplicate.
    const tailLead = naturalTail[0];
    const tailHeader = tailLead?.type === 'match'
        && !head.some(row => row.type === 'file' && row.index === tailLead.fileIndex)
        ? rows.find((row) => row.type === 'file' && row.index === tailLead.fileIndex)
        : undefined;
    // The restored header is itself a row. Left extra it would push the card to
    // maxLines + 1 and overstate `hidden` by one, so it consumes a tail slot: drop
    // the tail's first row (the match whose header this is) for it. Visible rows
    // hold at maxLines and `hidden` stays exact; the dropped match joins the
    // hidden middle.
    const tail = tailHeader === undefined ? naturalTail : naturalTail.slice(1);
    const renderRow = (row) => {
        if (row.type === 'path')
            return _jsx("div", { className: css.line, children: row.path });
        if (row.type === 'match') {
            return (_jsxs("div", { className: css.line, children: [_jsxs("span", { className: css.lineNumber, children: [row.lineNumber, ": "] }), row.line] }));
        }
        return (_jsxs("button", { type: "button", className: css.fileHeader, "aria-expanded": !row.collapsed, onClick: () => { toggleFile(row.index); }, children: [_jsx("span", { className: css.filePath, children: row.path }), _jsx("span", { className: css.fileCount, children: row.count })] }));
    };
    return (_jsxs("div", { className: clsx(css.block, className), "data-search": props.kind, children: [_jsxs("div", { className: css.header, children: [_jsx("span", { className: css.summary, children: summaryText(props, shown, truncated, total) }), !empty && (_jsx("button", { type: "button", className: css.copyButton, onClick: onCopy, children: copied ? '复制成功' : '复制' }))] }), empty
                ? _jsx("div", { className: css.empty, children: "\u65E0\u7ED3\u679C" })
                : (_jsxs("div", { className: css.body, children: [head.map(row => (_jsx("div", { children: renderRow(row) }, rowKey(row)))), hidden > 0 && (_jsx("button", { type: "button", className: css.expand, "aria-expanded": expanded, "aria-label": expanded ? '收起结果' : `展开其余 ${hidden} 行结果`, onClick: onToggle, children: expanded ? '收起' : `… 其余 ${hidden} 行` })), tailHeader !== undefined && (_jsx("div", { children: renderRow(tailHeader) }, `tailHeader:${rowKey(tailHeader)}`)), tail.map(row => (_jsx("div", { children: renderRow(row) }, rowKey(row))))] }))] }));
}
//# sourceMappingURL=SearchBlock.js.map