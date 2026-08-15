import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// ToolRow: the single-line tool summary row (figma component set 122:9479) —
// 16px leading slot (state dot / tool icon, chevron on hover or expanded) + title +
// separator dot + FILL-truncated summary, drawn through the shared
// DisclosureRow chrome with the whole row as the expand toggle (click /
// Enter / Space, icon→chevron hover preview). The collapsed row is always
// one line; every row with body, output, or a card material (terminal, diff,
// read, search, web) is expandable; the summary stays inline while open.
// The expanded body — an IN/OUT gutter-labeled card (figma 1249:35657) for
// text input/output, the run_code program through CodeBlock, or a card
// primitive (TerminalBlock, DiffBlock, ReadBlock, SearchBlock, WebBlock) for a
// call that declared that render intent — lives in a max-height scroll
// container so a long payload scrolls internally instead of taking over the
// message flow. Every card kind starts collapsed, so a run of tool calls stays
// scannable; the details panel is the single-call full-height reading surface.
// Expand state is component-local view state. File-tool summaries are path
// links that open through the host (stopPropagation keeps the two gestures
// independent); an error row's collapsed summary is the failure's first line in
// the error color.
import { useState } from 'react';
import clsx from 'clsx';
import { CodeBlock, DiffBlock, DisclosureRow, IconInspectOutline12, ReadBlock, SearchBlock, StateDot, TerminalBlock, WebBlock, } from '@deepseek-ai/dsh-client-ui-primitives';
import { CHAT_DIFF_MAX_LINES } from "../models/diff-card-model.js";
import { CHAT_READ_MAX_LINES } from "../models/read-card-model.js";
import { CHAT_SEARCH_MAX_LINES } from "../models/search-card-model.js";
import { terminalBlockLabels } from "../models/terminal-card-model.js";
import css from './ToolRow.module.css';
/** Leading-slot state substitution: the tool icon yields to the terminal state
 *  semantic (error = red, interrupted = amber halo). Running keeps the icon —
 *  the row sweep (CSS on data-state) carries the in-flight signal. */
function leadingFor(state, icon) {
    switch (state) {
        case 'error': return _jsx(StateDot, { state: "error" });
        case 'stopped': return _jsx(StateDot, { state: "warning" });
        default: return icon;
    }
}
/** Visually hidden run-state label: the StateDot and the CSS sweep are both
 *  aria-hidden / colour-only, so assistive technology needs this text to know a
 *  row is running, failed, or interrupted. null in the ok state (the icon and
 *  summary already describe a settled row). */
function stateStatus(state, t) {
    switch (state) {
        case 'running': return t('row.running');
        case 'error': return t('row.failed');
        case 'stopped': return t('row.stopped');
        default: return null;
    }
}
export function ToolRow({ t, variant, toolName, icon, title, summary, summarySuffix, body, output, errorSummary, terminal, diff, read, search, web, state, filePath, onOpenFile, inspect, }) {
    const [expanded, setExpanded] = useState(false);
    const terminalBody = terminal ?? null;
    const diffBody = diff ?? null;
    const readBody = read ?? null;
    const searchBody = search ?? null;
    const webBody = web ?? null;
    const outputText = output ?? null;
    // A card replaces the text body; a call carries at most one card kind, so the
    // card props are mutually exclusive. Any of them, or a text body/output,
    // makes the row expandable.
    const card = terminalBody ?? diffBody ?? readBody ?? searchBody ?? webBody;
    const expandable = body !== null || outputText !== null || card !== null;
    const open = expanded && expandable;
    // The run-state label AT needs: the StateDot and the running sweep are both
    // aria-hidden / colour-only, so a stopped or running row is otherwise silent.
    const status = stateStatus(state, t);
    // An error row's collapsed summary IS the failure: the first error line in
    // the error color outranks both the args summary and a terminal description.
    const failureLine = state === 'error' ? errorSummary ?? null : null;
    const summaryText = failureLine ?? summary;
    // The failure line replaces the summary wholesale, so a suffix derived from
    // the call args has nothing left to sit beside.
    const suffix = failureLine === null ? summarySuffix ?? null : null;
    // The failure line is error prose, not the path: no open-file affordance.
    const fileLink = filePath !== undefined && onOpenFile !== undefined && failureLine === null;
    const toggleExpand = () => {
        setExpanded(v => !v);
    };
    const openFile = (event) => {
        event.stopPropagation();
        if (filePath !== undefined)
            onOpenFile?.(filePath);
    };
    // Keep Enter/Space on the focused path link from bubbling to the row's
    // keydown handler, which would preventDefault() the key and toggle expand
    // instead of activating the link — the keyboard analogue of openFile's
    // stopPropagation. The native button still fires its own onClick from the key.
    const fileLinkKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ')
            event.stopPropagation();
    };
    // The code variant's program renders through CodeBlock (shiki), so only its
    // output joins the IN/OUT card; every other variant's input does too.
    const cardBody = variant === 'code' ? null : body;
    // The state substitution rides the idle icon slot, so an expandable error
    // row keeps DisclosureRow's icon→chevron hover preview (its default) instead
    // of losing it with the icon.
    return (_jsxs("div", { className: css.root, "data-variant": variant, "data-tool": toolName, "data-state": state, children: [status !== null && _jsx("span", { className: css.visuallyHidden, children: status }), _jsx(DisclosureRow, { rowClassName: css.row, leadingClassName: css.leading, titleClassName: css.title, chevronClassName: css.chevron, icon: leadingFor(state, icon), title: title, open: open, expandable: expandable, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: toggleExpand, collapsedContent: summaryText !== '' && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.sep, "aria-hidden": true }), fileLink ? (_jsx("button", { type: "button", className: css.fileLink, onClick: openFile, onKeyDown: fileLinkKeyDown, children: summaryText })) : (_jsx("span", { className: clsx(css.summary, failureLine !== null && css.errorSummary), children: summaryText })), suffix !== null && _jsx("span", { className: css.summarySuffix, children: suffix })] })), children: _jsxs("div", { className: css.bodyWrap, children: [terminalBody !== null
                            ? (_jsx(TerminalBlock, { ...terminalBody.card, maxLines: Infinity, labels: terminalBlockLabels(t), className: css.terminalBody }))
                            : diffBody !== null
                                ? _jsx(DiffBlock, { ...diffBody.card, maxLines: CHAT_DIFF_MAX_LINES, className: css.diffBody })
                                : readBody !== null
                                    ? _jsx(ReadBlock, { ...readBody, maxLines: CHAT_READ_MAX_LINES, className: css.readBody })
                                    : searchBody !== null
                                        ? (_jsxs(_Fragment, { children: [_jsx(SearchBlock, { ...searchBody.card, maxLines: CHAT_SEARCH_MAX_LINES, className: css.searchBody }), searchBody.recovery !== undefined && (_jsx("div", { className: css.searchRecovery, children: searchBody.recovery }))] }))
                                        : webBody !== null
                                            ? _jsx(WebBlock, { ...webBody, className: css.webBody })
                                            : (_jsxs(_Fragment, { children: [variant === 'code' && body !== null && (_jsx("div", { className: css.bodyScroll, children: _jsx(CodeBlock, { code: body, lang: "typescript", copyLabel: t('copy'), copiedLabel: t('copied'), className: css.codeBody }) })), (cardBody !== null || outputText !== null) && (_jsxs("div", { className: css.ioCard, children: [cardBody !== null && (_jsxs("div", { className: css.ioSection, children: [_jsx("span", { className: css.ioLabel, children: "IN" }), _jsx("span", { className: css.ioText, children: cardBody })] })), cardBody !== null && outputText !== null && (_jsx("span", { className: css.ioDivider, "aria-hidden": true })), outputText !== null && (_jsxs("div", { className: css.ioSection, children: [_jsx("span", { className: css.ioLabel, children: "OUT" }), _jsx("span", { className: css.ioText, "data-error": state === 'error' || undefined, children: outputText })] }))] }))] })), inspect !== undefined && (_jsxs("button", { type: "button", className: css.inspectButton, onClick: inspect, children: [_jsx(IconInspectOutline12, {}), "Inspect"] }))] }) })] }));
}
//# sourceMappingURL=ToolRow.js.map