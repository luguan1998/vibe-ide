import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Frame-wide dynamic Plugin inventory, approvals, versions, and lifecycle actions. */
import { useEffect, useRef, useState } from 'react';
import { IconCheckOutline16, IconCloseOutline16, IconCordisPluginOutline14, IconPlayOutline16, IconStopFill16, IconTrashOutline16, Tooltip, } from '@deepseek-ai/dsh-client-ui-primitives';
import { cordisVisibleStatus, packageOf } from "./status.js";
import css from './CordisPanel.module.css';
const STATUS_LABELS = {
    idle: 'status.idle',
    'awaiting-approval': 'status.awaitingApproval',
    'client-pending': 'status.clientPending',
    running: 'status.running',
    failed: 'status.failed',
};
const RENDER_FAILURE_LABELS = {
    abdicated: 'render.failedAbdicated',
    held: 'render.failedHeld',
};
function selectedPackageIdOf({ pluginId, listed, activity }, selected) {
    const selectedPackageId = selected[pluginId];
    if (selectedPackageId !== undefined
        && listed?.packages.some(pkg => pkg.packageId === selectedPackageId))
        return selectedPackageId;
    return listed?.nextPackageId
        ?? listed?.currentPackageId
        ?? listed?.packages.at(-1)?.packageId
        ?? activity?.packageId;
}
function visiblePanelStatus(view, selectedPackageId, loaded) {
    const { listed, activity } = view;
    const latest = listed?.latestRun;
    if (activity?.phase === 'awaiting-approval' || latest?.status === 'awaiting-approval') {
        return 'awaiting-approval';
    }
    if (latest?.status === 'failed' && latest.packageId === selectedPackageId)
        return 'failed';
    if (listed?.activeRun === undefined)
        return 'idle';
    return cordisVisibleStatus(listed, listed.activeRun.packageId, loaded);
}
function blockingFirst(rows) {
    return [
        ...rows.filter(row => row.activity?.phase === 'awaiting-approval'),
        ...rows.filter(row => row.activity?.phase !== 'awaiting-approval'),
    ];
}
function RowAction({ label, children, ...props }) {
    return (_jsx(Tooltip, { label: label, side: "bottom", delayMs: 500, children: _jsx("button", { type: "button", className: css.actionButton, "aria-label": label, ...props, children: children }) }));
}
function DoubleCheckIcon() {
    return (_jsxs("span", { className: css.doubleCheck, "aria-hidden": true, children: [_jsx(IconCheckOutline16, { size: 12 }), _jsx(IconCheckOutline16, { size: 12 })] }));
}
/** Render the inventory panel and its unified footer action. */
export function CordisPanel({ wide, useSessions, useInventory, useActiveRuns, useRunErrors, useLoaded, useRenderFailures, onApprove, onDecline, onRun, onStop, onRemove, onRefresh, t, }) {
    const inventory = useInventory(snapshot => snapshot);
    const activeRuns = useActiveRuns(snapshot => snapshot);
    const errors = useRunErrors(snapshot => snapshot);
    const loaded = useLoaded(snapshot => snapshot);
    const renderFailures = useRenderFailures(snapshot => snapshot);
    const current = useSessions(state => state.current);
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState({});
    const [pending, setPending] = useState(new Set());
    const [actionErrors, setActionErrors] = useState(new Map());
    const visibleRequests = useRef(new Set());
    useEffect(() => {
        const now = new Set();
        for (const activity of activeRuns.values()) {
            if (activity.phase === 'awaiting-approval')
                now.add(activity.requestId);
        }
        const discovered = [...now].some(requestId => !visibleRequests.current.has(requestId));
        visibleRequests.current = now;
        if (discovered)
            setOpen(true);
    }, [activeRuns]);
    useEffect(() => { onRefresh(); }, [onRefresh]);
    useEffect(() => { if (open)
        onRefresh(); }, [onRefresh, open]);
    const byPlugin = new Map();
    for (const listed of inventory.rows) {
        const activity = activeRuns.get(listed.pluginId);
        byPlugin.set(listed.pluginId, {
            pluginId: listed.pluginId,
            agentId: activity?.agentId ?? listed.agentId,
            listed,
            ...activity === undefined ? {} : { activity },
        });
    }
    for (const [pluginId, activity] of activeRuns) {
        if (byPlugin.has(pluginId))
            continue;
        byPlugin.set(pluginId, { pluginId, agentId: activity.agentId, activity });
    }
    const all = [...byPlugin.values()];
    const mine = blockingFirst(all.filter(row => current !== undefined && row.agentId === current));
    const theirs = blockingFirst(all.filter(row => current === undefined || row.agentId !== current));
    const approvals = [...activeRuns.values()].filter(activity => activity.phase === 'awaiting-approval').length;
    const running = all.filter(view => visiblePanelStatus(view, selectedPackageIdOf(view, selected), loaded) === 'running').length;
    if (all.length === 0)
        return null;
    const runAction = async (pluginId, action) => {
        if (pending.has(pluginId))
            return;
        setPending(currentPending => new Set(currentPending).add(pluginId));
        setActionErrors((currentErrors) => {
            const next = new Map(currentErrors);
            next.delete(pluginId);
            return next;
        });
        try {
            const result = await action();
            if (result !== undefined && !result.ok) {
                setActionErrors(currentErrors => new Map(currentErrors).set(pluginId, result.message ?? 'operation failed'));
            }
        }
        catch (error) {
            setActionErrors(currentErrors => new Map(currentErrors).set(pluginId, error instanceof Error ? error.message : String(error)));
        }
        finally {
            setPending((currentPending) => {
                const next = new Set(currentPending);
                next.delete(pluginId);
                return next;
            });
            onRefresh();
        }
    };
    const renderRow = (view) => {
        const { pluginId, listed, activity } = view;
        const selectedPackageId = selectedPackageIdOf(view, selected);
        const selectedPackage = listed !== undefined && selectedPackageId !== undefined
            ? packageOf(listed, selectedPackageId)
            : undefined;
        const activePackage = listed?.activeRun === undefined
            ? undefined
            : packageOf(listed, listed.activeRun.packageId);
        const name = selectedPackage?.name
            ?? (activity?.phase === 'awaiting-approval' ? activity.name : pluginId);
        const purpose = selectedPackage?.purpose
            ?? (activity?.phase === 'awaiting-approval' ? activity.purpose : '');
        const latest = listed?.latestRun;
        const awaiting = activity?.phase === 'awaiting-approval'
            ? activity.requestId
            : latest?.status === 'awaiting-approval' ? latest.approvalRequestId : undefined;
        const status = visiblePanelStatus(view, selectedPackageId, loaded);
        const busy = pending.has(pluginId) || activity?.phase === 'orchestrating';
        const failure = errors.get(pluginId);
        const hostFailure = latest?.status === 'failed' ? latest.error : undefined;
        const renderFailure = renderFailures.get(pluginId);
        const actionError = actionErrors.get(pluginId);
        const nextPackageId = listed?.nextPackageId !== undefined
            && listed.nextPackageId !== listed.currentPackageId ? listed.nextPackageId : undefined;
        const currentPackageId = listed?.currentPackageId;
        const runMode = listed?.currentPackageId !== undefined
            && selectedPackageId !== listed.currentPackageId ? 'update' : 'run';
        return (_jsxs("li", { className: css.row, "data-cordis-row": pluginId, "data-cordis-status": status, "data-cordis-awaiting": awaiting !== undefined || undefined, children: [_jsxs("div", { className: css.rowHead, children: [_jsx("span", { className: css.rowId, children: pluginId }), _jsx("span", { className: css.rowName, children: name }), _jsx("span", { className: css.rowStatus, children: t(STATUS_LABELS[status]) })] }), listed !== undefined && listed.packages.length > 1 && selectedPackageId !== undefined && (_jsxs("label", { className: css.versionPicker, children: [_jsx("span", { children: t('panel.version') }), _jsx("select", { value: selectedPackageId, disabled: busy, onChange: (event) => {
                                setSelected(currentSelected => ({
                                    ...currentSelected,
                                    [pluginId]: event.target.value,
                                }));
                            }, children: listed.packages.map(pkg => (_jsx("option", { value: pkg.packageId, children: `${pkg.name} · ${pkg.packageId}` }, pkg.packageId))) })] })), _jsxs("div", { className: css.rowDetail, children: [_jsx("span", { className: css.rowPurpose, children: purpose }), _jsxs("div", { className: css.rowActions, children: [awaiting !== undefined && (_jsxs(_Fragment, { children: [_jsx(RowAction, { label: t('action.approveOnce'), "data-cordis-approve": awaiting, disabled: busy, onClick: () => {
                                                void runAction(pluginId, async () => {
                                                    await onApprove(awaiting, false);
                                                    setOpen(false);
                                                });
                                            }, children: _jsx(IconCheckOutline16, { size: 14 }) }), _jsx(RowAction, { label: t('action.approvePlugin'), "data-cordis-approve-plugin": awaiting, disabled: busy, onClick: () => {
                                                void runAction(pluginId, async () => {
                                                    await onApprove(awaiting, true);
                                                    setOpen(false);
                                                });
                                            }, children: _jsx(DoubleCheckIcon, {}) }), _jsx(RowAction, { label: t('action.decline'), "data-cordis-decline": awaiting, disabled: busy, onClick: () => {
                                                void runAction(pluginId, async () => {
                                                    await onDecline(awaiting);
                                                    setOpen(false);
                                                });
                                            }, children: _jsx(IconCloseOutline16, { size: 14 }) })] })), awaiting === undefined && listed !== undefined
                                    && selectedPackageId !== undefined && listed.activeRun === undefined && (_jsx(RowAction, { label: t('action.run'), "data-cordis-switch": "run", disabled: busy, onClick: () => {
                                        void runAction(pluginId, () => onRun({
                                            agentId: listed.agentId,
                                            pluginId,
                                            packageId: selectedPackageId,
                                            mode: runMode,
                                            hasClientHalf: selectedPackage?.hasClientHalf === true,
                                        }));
                                    }, children: _jsx(IconPlayOutline16, { size: 14 }) })), awaiting === undefined && listed !== undefined && listed.activeRun !== undefined
                                    && selectedPackageId !== listed.activeRun.packageId && selectedPackage !== undefined && (_jsx(RowAction, { label: t('action.run'), "data-cordis-switch": "run", disabled: busy, onClick: () => {
                                        void runAction(pluginId, () => onRun({
                                            agentId: listed.agentId,
                                            pluginId,
                                            packageId: selectedPackage.packageId,
                                            mode: runMode,
                                            hasClientHalf: selectedPackage.hasClientHalf,
                                        }));
                                    }, children: _jsx(IconPlayOutline16, { size: 14 }) })), awaiting === undefined && listed !== undefined && listed.activeRun !== undefined && status === 'client-pending'
                                    && activePackage !== undefined && selectedPackageId === listed.activeRun.packageId && (_jsx(RowAction, { label: t('action.run'), "data-cordis-switch": "run", disabled: busy, onClick: () => {
                                        void runAction(pluginId, () => onRun({
                                            agentId: listed.agentId,
                                            pluginId,
                                            packageId: activePackage.packageId,
                                            mode: 'run',
                                            hasClientHalf: true,
                                        }));
                                    }, children: _jsx(IconPlayOutline16, { size: 14 }) })), awaiting === undefined && listed !== undefined && listed.activeRun !== undefined && (_jsx(RowAction, { label: t('action.stop'), "data-cordis-switch": "stop", disabled: busy, onClick: () => { void runAction(pluginId, () => onStop(listed.agentId, pluginId)); }, children: _jsx(IconStopFill16, { size: 14 }) })), awaiting === undefined && listed !== undefined && (_jsx(RowAction, { label: t('action.remove'), "data-cordis-remove": pluginId, disabled: busy, onClick: () => { void runAction(pluginId, () => onRemove(listed.agentId, pluginId)); }, children: _jsx(IconTrashOutline16, { size: 14 }) }))] })] }), awaiting === undefined && nextPackageId !== undefined && listed !== undefined && (_jsxs("div", { className: css.transition, children: [_jsx("span", { children: currentPackageId === undefined ? '' : t('panel.current', { packageId: currentPackageId }) }), _jsx("span", { children: t('panel.next', { packageId: nextPackageId }) }), _jsxs("div", { className: css.transitionActions, children: [_jsx("button", { type: "button", disabled: busy, onClick: () => {
                                        void runAction(pluginId, () => onRun({
                                            agentId: listed.agentId,
                                            pluginId,
                                            packageId: nextPackageId,
                                            mode: currentPackageId === undefined ? 'run' : 'update',
                                            hasClientHalf: packageOf(listed, nextPackageId)?.hasClientHalf === true,
                                        }));
                                    }, children: t('action.retry') }), currentPackageId !== undefined && (_jsx("button", { type: "button", disabled: busy, onClick: () => {
                                        void runAction(pluginId, () => onRun({
                                            agentId: listed.agentId,
                                            pluginId,
                                            packageId: currentPackageId,
                                            mode: 'run',
                                            hasClientHalf: packageOf(listed, currentPackageId)?.hasClientHalf === true,
                                        }));
                                    }, children: t('action.rollback') }))] })] })), failure !== undefined && (_jsx("div", { className: css.rowError, role: "alert", children: `${failure.message} (${failure.reason})` })), failure === undefined && hostFailure !== undefined && (_jsx("div", { className: css.rowError, role: "alert", children: `${hostFailure.message} (${hostFailure.phase})` })), actionError !== undefined && _jsx("div", { className: css.rowError, role: "alert", children: actionError }), renderFailure !== undefined && (_jsx("div", { className: css.rowError, role: "alert", "data-cordis-render-failure": renderFailure.slot, "data-cordis-render-abdicated": renderFailure.abdicated || undefined, children: `${t(RENDER_FAILURE_LABELS[renderFailure.abdicated ? 'abdicated' : 'held'], {
                        slot: renderFailure.slot,
                    })} ${renderFailure.message}` })), activePackage !== undefined && activePackage.packageId !== selectedPackageId && (_jsx("span", { className: css.activeVersion, children: `${t('status.running')}: ${activePackage.name} · ${activePackage.packageId}` }))] }, pluginId));
    };
    return (_jsxs("div", { className: wide ? css.layer : `${css.layer} ${css.rail}`, children: [open && (_jsxs("section", { className: css.panel, "data-cordis-panel": true, "aria-label": t('panel.title'), children: [_jsx("header", { className: css.header, children: _jsx("span", { className: css.title, children: t('panel.title') }) }), _jsxs("div", { className: css.body, children: [inventory.error !== undefined && (_jsx("p", { className: css.readError, role: "alert", children: t('panel.readFailed', { message: inventory.error }) })), !inventory.read && inventory.error === undefined && _jsx("p", { className: css.note, children: t('panel.loading') }), inventory.read && all.length === 0 && _jsx("p", { className: css.note, children: t('panel.empty') }), mine.length > 0 && (_jsxs("section", { children: [_jsx("h3", { className: css.group, children: t('panel.group.current') }), _jsx("ul", { className: css.rows, children: mine.map(renderRow) })] })), theirs.length > 0 && (_jsxs("section", { children: [_jsx("h3", { className: css.group, children: t('panel.group.others') }), _jsx("ul", { className: css.rows, children: theirs.map(renderRow) })] }))] })] })), _jsx("div", { className: css.footerButtons, children: _jsxs("button", { type: "button", className: css.badge, "data-cordis-badge": all.length, "data-cordis-approval-badge": approvals, "data-active": approvals > 0 || undefined, "aria-label": t('panel.plugins.aria'), "aria-expanded": open, onClick: () => { setOpen(value => !value); }, children: [_jsx(IconCordisPluginOutline14, {}), wide && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.badgeLabel, children: t('panel.trigger') }), _jsx("span", { className: css.badgeCount, children: t('panel.runningCount', { count: running }) })] }))] }) })] }));
}
//# sourceMappingURL=CordisPanel.js.map