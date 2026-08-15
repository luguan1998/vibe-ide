import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Localized cards for `cordis_stop` and `cordis_undefine`. */
import { IconInspectOutline12, IconStopFill16, IconTrashOutline16, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import { cordisActionCard } from "./card-model.js";
import css from './CordisRunRow.module.css';
/** Render one Stop or Remove call with Cordis-owned localized copy. */
export function CordisActionRow({ callId, toolName, block, inspect, t }) {
    const card = cordisActionCard(block);
    const remove = toolName === 'cordis_undefine';
    const summary = card.errorSummary ?? card.pluginId ?? callId;
    return (_jsxs("div", { className: css.card, "data-tool": toolName, "data-state": card.state, children: [_jsxs("div", { className: css.row, children: [_jsx("span", { className: css.icon, children: card.state === 'error'
                            ? _jsx(StateDot, { state: "error" })
                            : card.state === 'stopped'
                                ? _jsx(StateDot, { state: "warning" })
                                : remove ? _jsx(IconTrashOutline16, { size: 14 }) : _jsx(IconStopFill16, { size: 14 }) }), _jsx("span", { className: css.title, children: t(remove ? 'row.removeTitle' : 'row.stopTitle') }), _jsx("span", { className: css.separator, "aria-hidden": true }), _jsx("span", { className: card.errorSummary === null ? css.summary : css.error, children: summary }), inspect !== undefined && (_jsx("button", { type: "button", className: css.inspect, "aria-label": "Inspect", onClick: inspect, children: _jsx(IconInspectOutline12, {}) }))] }), card.output !== null && _jsx("pre", { className: css.output, children: card.output })] }));
}
//# sourceMappingURL=CordisActionRow.js.map