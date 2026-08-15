import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// Bash toolview registrant: third-party posture over the keyed toolview hole
// (ctx.slots.register + ToolRowProps only — never imports the chat domain).
// Product chrome matches ToolRow / Think (figma: Bash · {description}).
//
// A bash call normally declares the terminal render intent, so this row renders
// the command's own output through TerminalBlock. Execution failures that
// settle without terminal material use the bounded generic IN/OUT fallback —
// both are expand-gated exactly like
// ToolRow's unified interaction: collapsed by default, the whole summary row
// is the toggle (click / Enter / Space, icon→chevron hover preview; the
// summary stays inline while open),
// and the expanded card max-height-scrolls inside its own surface with the
// full output (maxLines Infinity — no middle collapse). An error row's
// collapsed summary is the failure's first line in the error color.
import { useState } from 'react';
import clsx from 'clsx';
import { IconApiOutline14, IconChevronDownOutline14, IconInspectOutline12, StateDot, TerminalBlock, } from '@deepseek-ai/dsh-client-ui-primitives';
import { terminalBlockLabels, terminalCardModel, terminalFailed } from "../models/terminal-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
import css from './bash-sample.module.css';
function leadingFor(state) {
    switch (state) {
        case 'error': return _jsx(StateDot, { state: "error" });
        case 'stopped': return _jsx(StateDot, { state: "warning" });
        // Running keeps the icon — the row sweep carries the in-flight signal.
        default: return _jsx(IconApiOutline14, { size: 14 });
    }
}
/** Visually hidden status — StateDot is aria-hidden; AT needs a text label. */
function stateStatus(state, t) {
    switch (state) {
        case 'running': return t('bash.running');
        case 'error': return t('bash.failed');
        case 'stopped': return t('bash.stopped');
        default: return null;
    }
}
/**
 * Bash row: icon + Bash · {description} in the shared ToolRow chrome, the
 * whole row toggling the command's terminal or generic error card (ToolRow's unified
 * expand interaction, replicated locally per the registrant posture).
 */
export function BashRow({ toolName, block, sessionId, useSessions, inspect, t }) {
    const model = toolRowModel(toolName, block);
    // Session workspace root: the terminal view's cwd resolves against it (an
    // omitted workdir IS the workspace), which the pure presenter cannot do.
    const cwd = useSessions(list => list.byId[sessionId]?.cwd);
    const terminal = terminalCardModel(block, cwd);
    // A failing exit status is the terminal card's own error signal (the call
    // itself settles isError:false), surfaced as the row's red state dot.
    const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
        ? 'error'
        : model.state;
    const status = stateStatus(state, t);
    const [expanded, setExpanded] = useState(false);
    // Execution failures (for example cancellation before the process reports a
    // terminal result) use the generic presenter. Keep their recorded args and
    // full error reachable instead of collapsing the row to the first line.
    const genericError = terminal === null
        && model.state === 'error'
        && (model.body !== null || model.output !== null);
    const expandable = terminal !== null || genericError;
    const open = expanded && expandable;
    const failureLine = model.state === 'error' ? model.errorSummary : null;
    const toggleExpand = () => {
        setExpanded(v => !v);
    };
    const toggleFromKeyboard = (event) => {
        if (!expandable || (event.key !== 'Enter' && event.key !== ' '))
            return;
        event.preventDefault();
        toggleExpand();
    };
    const leading = open
        ? _jsx(IconChevronDownOutline14, { className: css.chevron })
        : expandable
            ? (_jsxs(_Fragment, { children: [_jsx("span", { className: css.iconIdle, children: leadingFor(state) }), _jsx(IconChevronDownOutline14, { className: clsx(css.chevron, css.chevronHover) })] }))
            : leadingFor(state);
    return (_jsxs("div", { className: css.card, children: [_jsxs("div", { className: css.root, "data-sample": "bash", "data-variant": "bash", "data-state": state, "data-expandable": expandable || undefined, role: expandable ? 'button' : undefined, tabIndex: expandable ? 0 : undefined, "aria-expanded": expandable ? open : undefined, onClick: expandable ? toggleExpand : undefined, onKeyDown: expandable ? toggleFromKeyboard : undefined, children: [_jsx("span", { className: css.leading, children: leading }), status !== null && _jsx("span", { className: css.visuallyHidden, children: status }), _jsx("span", { className: css.title, children: model.title }), _jsx("span", { className: css.sep, "aria-hidden": true }), _jsx("span", { className: clsx(css.summary, failureLine !== null && css.errorSummary), children: failureLine ?? terminal?.description ?? model.summary })] }), open && (_jsxs("div", { className: css.bodyWrap, children: [terminal !== null
                        ? (_jsx(TerminalBlock, { ...terminal.card, maxLines: Infinity, labels: terminalBlockLabels(t), className: css.terminal }))
                        : (_jsxs("div", { className: css.ioCard, children: [model.body !== null && (_jsxs("div", { className: css.ioSection, children: [_jsx("span", { className: css.ioLabel, children: "IN" }), _jsx("span", { className: css.ioText, children: model.body })] })), model.body !== null && model.output !== null && (_jsx("span", { className: css.ioDivider, "aria-hidden": true })), model.output !== null && (_jsxs("div", { className: css.ioSection, children: [_jsx("span", { className: css.ioLabel, children: "OUT" }), _jsx("span", { className: css.ioText, "data-error": true, children: model.output })] }))] })), inspect !== undefined && (_jsxs("button", { type: "button", className: css.inspectButton, onClick: inspect, children: [_jsx(IconInspectOutline12, {}), "Inspect"] }))] }))] }));
}
/**
 * The sample as a plain registrant plugin. Slot injection follows the chat
 * toolview declaration across independent activation and reload lifetimes.
 */
export const bashToolviewSample = {
    name: 'bash-toolview-sample',
    inject: ['slots'],
    /**
     * Register the bash row into the Tool-owned keyed view slot.
     * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
     */
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow));
    },
};
//# sourceMappingURL=bash-sample.js.map