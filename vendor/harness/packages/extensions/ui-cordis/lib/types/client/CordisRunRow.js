import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** `cordis_run` card and the host seat for Package-owned interactive UI. */
import { useEffect } from 'react';
import { IconCodeOutline16, IconInspectOutline12, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import { cordisRunCard } from "./card-model.js";
import { cordisToolViewKey } from "./run-card-index.js";
import { cordisVisibleStatus } from "./status.js";
import css from './CordisRunRow.module.css';
const READING_LABELS = {
    idle: 'status.idle',
    'awaiting-approval': 'status.awaitingApproval',
    failed: 'status.failed',
    'client-pending': 'status.clientPending',
    running: 'status.running',
    removed: 'status.removed',
    superseded: 'status.superseded',
};
/** Render one activation result and, when eligible, its Package-owned view. */
export function CordisRunRow({ callId, block, inspect, renderSlot, useInventory, useLoaded, useRunCards, useActiveRuns, onObserveRunCard, t, }) {
    const card = cordisRunCard(block);
    const inventory = useInventory(snapshot => snapshot);
    const loaded = useLoaded(snapshot => snapshot);
    const latest = useRunCards(snapshot => snapshot);
    const activeRuns = useActiveRuns(snapshot => snapshot);
    const key = card.state === 'ok'
        && card.pluginId !== null
        && card.packageId !== null
        && card.pluginRunId !== null
        && card.seq !== null
        ? cordisToolViewKey(card.pluginId, card.packageId)
        : null;
    useEffect(() => {
        if (key === null || card.seq === null || card.pluginRunId === null)
            return;
        onObserveRunCard({ key, callId, seq: card.seq, pluginRunId: card.pluginRunId });
    }, [callId, card.pluginRunId, card.seq, key, onObserveRunCard]);
    const row = card.pluginId === null
        ? undefined
        : inventory.rows.find(candidate => candidate.pluginId === card.pluginId);
    const pointer = key === null ? undefined : latest.get(key);
    const superseded = pointer !== undefined && pointer.callId !== callId && pointer.seq >= (card.seq ?? -1);
    const activity = card.pluginId === null ? undefined : activeRuns.get(card.pluginId);
    const attempt = card.pluginRunId !== null && row?.latestRun?.pluginRunId === card.pluginRunId
        ? row.latestRun
        : undefined;
    const awaitingApproval = attempt?.status === 'awaiting-approval' || (card.packageId !== null
        && activity?.phase === 'awaiting-approval'
        && activity.packageId === card.packageId
        && (card.mode === null || activity.mode === card.mode));
    const reading = card.pluginId !== null && inventory.removed.has(card.pluginId)
        ? 'removed'
        : superseded
            ? 'superseded'
            : awaitingApproval
                ? 'awaiting-approval'
                : attempt?.status === 'failed'
                    ? 'failed'
                    : row !== undefined && card.packageId !== null
                        ? cordisVisibleStatus(row, card.packageId, loaded)
                        : 'idle';
    const status = t(READING_LABELS[reading]);
    const summary = card.errorSummary
        ?? (card.pluginId === null ? callId : `${card.pluginId}${card.packageId === null ? '' : ` · ${card.packageId}`}`);
    const showBusiness = reading === 'running' && key !== null;
    return (_jsxs("div", { className: css.card, "data-tool": "cordis_run", "data-state": card.state, "data-cordis-plugin-id": card.pluginId ?? undefined, "data-cordis-package-id": card.packageId ?? undefined, "data-cordis-run-id": card.pluginRunId ?? undefined, "data-cordis-status": reading, children: [_jsxs("div", { className: css.row, children: [_jsx("span", { className: css.icon, children: card.state === 'error'
                            ? _jsx(StateDot, { state: "error" })
                            : card.state === 'stopped'
                                ? _jsx(StateDot, { state: "warning" })
                                : _jsx(IconCodeOutline16, { size: 14 }) }), _jsx("span", { className: css.title, children: t(card.mode === 'update' ? 'row.updateTitle' : 'row.runTitle') }), _jsx("span", { className: css.separator, "aria-hidden": true }), _jsx("span", { className: card.errorSummary === null ? css.summary : css.error, children: summary }), _jsx("span", { className: css.status, children: status }), inspect !== undefined && (_jsx("button", { type: "button", className: css.inspect, "aria-label": "Inspect", onClick: inspect, children: _jsx(IconInspectOutline12, {}) }))] }), reading === 'removed' && _jsx("div", { className: css.message, children: t('run.removed') }), reading === 'superseded' && _jsx("div", { className: css.message, children: t('run.superseded') }), reading === 'failed' && attempt?.error !== undefined && (_jsx("div", { className: css.message, children: attempt.error.message })), showBusiness && card.pluginId !== null && card.packageId !== null && card.pluginRunId !== null && (_jsx("div", { className: css.business, "data-cordis-business-view": key, children: renderSlot('tool.view.cordis', {
                    pluginId: card.pluginId,
                    packageId: card.packageId,
                    pluginRunId: card.pluginRunId,
                }, {
                    entryKey: key,
                    fallback: card.output === null ? null : _jsx("pre", { className: css.output, children: card.output }),
                }) })), !showBusiness && reading !== 'removed' && reading !== 'superseded' && card.output !== null && (_jsx("pre", { className: css.output, children: card.output }))] }));
}
//# sourceMappingURL=CordisRunRow.js.map