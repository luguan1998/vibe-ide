import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Read-only `cordis_define` card with Host and Client source tabs. */
import { useId, useState } from 'react';
import { CodeBlock, DisclosureRow, IconCodeOutline16, IconInspectOutline12, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import { cordisDefineCard } from "./card-model.js";
import { cordisVisibleStatus } from "./status.js";
import css from './CordisDefineRow.module.css';
const READING_LABELS = {
    idle: 'status.idle',
    'client-pending': 'status.clientPending',
    running: 'status.running',
    removed: 'status.removed',
};
function stateStatus(state) {
    switch (state) {
        case 'running': return 'a11y.defining';
        case 'error': return 'a11y.failed';
        case 'stopped': return 'a11y.stopped';
        default: return null;
    }
}
function leadingFor(state) {
    switch (state) {
        case 'error': return _jsx(StateDot, { state: "error" });
        case 'stopped': return _jsx(StateDot, { state: "warning" });
        default: return _jsx(IconCodeOutline16, { size: 14 });
    }
}
/** Render one immutable Package definition. */
export function CordisDefineRow({ callId, block, inspect, useInventory, useLoaded, t, }) {
    const card = cordisDefineCard(block);
    const inventory = useInventory(snapshot => snapshot);
    const loaded = useLoaded(snapshot => snapshot);
    const [expanded, setExpanded] = useState(false);
    const [selectedSource, setSelectedSource] = useState(card.clientCode !== null ? 'client' : 'host');
    const sourcePanelId = useId();
    const row = card.pluginId === null
        ? undefined
        : inventory.rows.find(candidate => candidate.pluginId === card.pluginId);
    const reading = card.pluginId !== null && inventory.removed.has(card.pluginId)
        ? 'removed'
        : row !== undefined && card.packageId !== null
            ? cordisVisibleStatus(row, card.packageId, loaded)
            : 'idle';
    const name = card.name ?? callId;
    const expandable = card.hostCode !== null || card.clientCode !== null || card.output !== null;
    const open = expanded && expandable;
    const a11yState = stateStatus(card.state);
    const hasSource = card.clientCode !== null || card.hostCode !== null;
    const activeSource = selectedSource === 'client' && card.clientCode !== null
        ? 'client'
        : selectedSource === 'host' && card.hostCode !== null
            ? 'host'
            : card.clientCode !== null ? 'client' : 'host';
    const activeCode = activeSource === 'client' ? card.clientCode : card.hostCode;
    return (_jsxs("div", { className: css.card, "data-tool": "cordis_define", "data-state": card.state, "data-terminal": reading === 'removed' || undefined, "data-cordis-plugin-id": card.pluginId ?? undefined, "data-cordis-package-id": card.packageId ?? undefined, "data-cordis-status": reading, children: [a11yState !== null && _jsx("span", { className: css.visuallyHidden, children: t(a11yState) }), _jsx(DisclosureRow, { rowClassName: css.row, titleClassName: css.title, chevronClassName: css.chevron, icon: leadingFor(card.state), title: t('row.defineTitle'), open: open, expandable: expandable, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: () => { setExpanded(value => !value); }, collapsedContent: (_jsxs(_Fragment, { children: [_jsx("span", { className: css.separator, "aria-hidden": true }), _jsx("span", { className: card.errorSummary === null ? css.name : css.errorSummary, children: card.errorSummary ?? name }), card.errorSummary === null && (_jsx("span", { className: css.purpose, children: card.purpose ?? t('purpose.missing') })), card.pluginId !== null && (_jsx("span", { className: css.readout, children: _jsx("span", { className: css.statusLabel, children: t(READING_LABELS[reading]) }) }))] })), children: _jsxs("div", { className: css.bodyWrap, children: [hasSource && activeCode !== null && (_jsxs("section", { className: css.sourceCard, children: [_jsx("div", { className: css.sourceTabs, role: "tablist", "aria-label": t('body.source'), children: ['client', 'host'].map((source) => {
                                        const available = source === 'client' ? card.clientCode !== null : card.hostCode !== null;
                                        return (_jsx("button", { id: `${sourcePanelId}-${source}`, type: "button", role: "tab", "aria-controls": sourcePanelId, "aria-selected": activeSource === source, className: activeSource === source ? `${css.sourceTab} ${css.sourceTabActive}` : css.sourceTab, disabled: !available, onClick: () => { setSelectedSource(source); }, children: t(source === 'client' ? 'body.clientCode' : 'body.hostCode') }, source));
                                    }) }), _jsx("div", { id: sourcePanelId, className: css.sourcePanel, role: "tabpanel", "aria-labelledby": `${sourcePanelId}-${activeSource}`, children: _jsx(CodeBlock, { code: activeCode, lang: "javascript", copyLabel: t('body.copy'), copiedLabel: t('body.copied'), className: css.sourceCode }) })] })), card.output !== null && (_jsxs("section", { className: css.codeSection, children: [_jsx("div", { className: css.sectionLabel, children: t('body.output') }), _jsx("pre", { className: css.output, "data-error": card.state === 'error' || undefined, children: card.output })] })), card.pluginId !== null && _jsx("div", { className: css.panelHint, children: t('panel.hint') }), inspect !== undefined && (_jsxs("button", { type: "button", className: css.inspectButton, onClick: inspect, children: [_jsx(IconInspectOutline12, {}), "Inspect"] }))] }) })] }));
}
//# sourceMappingURL=CordisDefineRow.js.map