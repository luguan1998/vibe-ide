import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ReadBlock: the file surface for a read tool result — a banner (label +
// language + a "showing N of M" note when the read is a window + a copy
// control) over line-numbered, syntax-highlighted source. Each row carries the
// file's OWN line number in a gutter, so a windowed read past an offset keeps
// its file numbering rather than re-counting from 1. Highlighting reuses the
// CodeBlock shiki path (highlight.ts) at the per-line granularity a gutter
// needs; an unknown or absent language renders plain monospace. Long content is
// height-capped with the same head/tail arithmetic TerminalBlock uses, so the
// two cards collapse a long body at the same place. Colors resolve through
// --shiki-*/--dsw-* tokens.
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { writeClipboard } from "./clipboard.js";
import { grammarLoadCount, highlightLines, subscribeGrammarLoaded, } from "./markdown/highlight.js";
import css from './ReadBlock.module.css';
/**
 * Content lines shown before the height cap collapses the middle. Matches
 * TerminalBlock's default so a long read and a long command output cut at the
 * same place in the same flow.
 */
export const DEFAULT_READ_MAX_LINES = 16;
/**
 * Render one line's highlighted runs. The css-variables theme colors every run,
 * so each run is a styled span; a line with no highlighting at all takes the
 * bare-text path in the caller instead (an unknown or absent language).
 * @param spans - the line's styled runs.
 * @returns the line's children.
 */
function renderSpans(spans) {
    return spans.map((span, index) => _jsx("span", { style: span.style, children: span.text }, index));
}
/**
 * Render a read tool result as a line-numbered, optionally syntax-highlighted
 * file view.
 * @param props - see {@link ReadBlockProps}.
 * @returns the read block element.
 */
export function ReadBlock({ label, lines, totalLines, lang, maxLines = DEFAULT_READ_MAX_LINES, className, }) {
    // The raw text the copy control writes and the highlighter tokenizes: the
    // window's lines joined by newlines, without the file numbers or any chrome.
    // Highlighting the whole window in one call (not line by line) keeps grammar
    // context across lines — a multi-line string or comment stays one construct.
    const raw = useMemo(() => lines.map(line => line.text).join('\n'), [lines]);
    // Re-render when a lazy grammar finishes loading, so a read card that showed
    // plain text while its language's grammar imported picks up highlighting. The
    // snapshot value is opaque; only its change across renders drives the memo.
    const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount);
    // Per-line highlighted runs aligned 1:1 with `lines`; undefined for an
    // unknown/absent (or not-yet-loaded) language, when every line renders as
    // bare text.
    const highlighted = useMemo(() => highlightLines(raw, lang), [raw, lang, loaded]);
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const onCopy = useCallback(() => {
        if (copied)
            return;
        // The window's raw text, never the rendered tree: the gutter numbers and the
        // banner are chrome the file does not contain.
        void writeClipboard(raw).then((ok) => {
            if (!ok)
                return;
            setCopied(true);
            window.setTimeout(() => { setCopied(false); }, 1000);
        });
    }, [copied, raw]);
    const onToggle = useCallback(() => { setExpanded(value => !value); }, []);
    const hidden = lines.length - maxLines;
    const capped = hidden > 0 && !expanded;
    // Same split arithmetic as TerminalBlock's height cap, so a long read and a
    // long command output slice their head and tail at the same place.
    const headLines = Math.ceil(maxLines / 2);
    const tailLines = maxLines - headLines;
    // A read is a window when its returned lines are fewer than the file's total;
    // the note states that so a reader is not misled that the file ends here.
    const windowed = lines.length < totalLines;
    /**
     * Render a slice of the line array as gutter-numbered rows.
     * @param slice - the lines to draw, each with its aligned run array.
     * @returns the row elements.
     */
    const rows = (slice) => slice.map(([line, spans]) => (_jsxs("div", { className: css.line, children: [_jsx("span", { className: css.gutter, "aria-hidden": true, children: line.number }), _jsx("span", { className: css.content, children: spans === undefined ? line.text : renderSpans(spans) })] }, line.number)));
    // Pair each line with its aligned run array up front, so head/tail slicing
    // keeps the two in step without re-indexing.
    const paired = lines.map((line, index) => [line, highlighted?.[index]]);
    return (_jsxs("div", { className: clsx(css.block, className), "data-read": "", children: [_jsxs("div", { className: css.banner, children: [_jsx("div", { className: css.label, children: label ?? '' }), _jsxs("div", { className: css.action, children: [windowed && (_jsx("span", { className: css.count, children: `显示 ${lines.length} / ${totalLines} 行` })), _jsx("span", { className: css.lang, children: lang ?? '' }), lines.length > 0 && (_jsx("button", { type: "button", className: css.copyButton, onClick: onCopy, children: copied ? '复制成功' : '复制' }))] })] }), _jsxs("div", { className: css.body, children: [rows(capped ? paired.slice(0, headLines) : paired), hidden > 0 && (_jsx("button", { type: "button", className: css.expand, "aria-expanded": expanded, "aria-label": expanded ? '收起内容' : `展开其余 ${hidden} 行`, onClick: onToggle, children: expanded ? '收起' : `… 其余 ${hidden} 行` })), capped && rows(paired.slice(paired.length - tailLines))] })] }));
}
//# sourceMappingURL=ReadBlock.js.map