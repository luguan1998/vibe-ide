import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Permission preference row: the default preset for subsequently created
 * sessions. Current-session switches remain on the composer `/permission`
 * control.
 */
import { useEffect, useState } from 'react';
import { IconChevronDownOutline14, Menu, RiskConfirmation, } from '@deepseek-ai/dsh-client-ui-primitives';
import { FULL_ACCESS_PRESET } from "./presentation.js";
import css from './PermissionRow.module.css';
/**
 * Render the new-session Permission default selector.
 * @param props - composed slot props.
 * @returns the row, or null when the host does not expose permission settings.
 */
export function PermissionRow({ load, select, usePermission, t }) {
    const state = usePermission(snapshot => snapshot);
    const [open, setOpen] = useState(false);
    const [confirmingFullAccess, setConfirmingFullAccess] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);
    useEffect(() => {
        void load();
    }, [load]);
    useEffect(() => {
        if (state.writable && state.status !== 'unavailable')
            return;
        setOpen(false);
        setAcknowledged(false);
        setConfirmingFullAccess(false);
    }, [state.status, state.writable]);
    if (state.status === 'unavailable')
        return null;
    const selected = state.options.find(option => option.id === state.currentValue);
    const busy = state.status === 'loading' || state.status === 'saving' || confirmingFullAccess;
    const label = selected?.label
        ?? (busy ? t('loading') : t('unavailable'));
    const description = state.error ?? t('description');
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.row, children: [_jsxs("div", { className: css.rowText, children: [_jsx("div", { className: css.title, children: t('title') }), _jsx("div", { className: css.desc, role: state.error === null ? undefined : 'alert', children: description })] }), _jsx(Menu, { open: open, onClose: () => { setOpen(false); }, items: state.options.map(option => ({ id: option.id, label: option.label })), selectedId: state.currentValue, onSelect: (id) => {
                            setOpen(false);
                            if (id === state.currentValue)
                                return;
                            if (id === FULL_ACCESS_PRESET) {
                                setAcknowledged(false);
                                setConfirmingFullAccess(true);
                                return;
                            }
                            void select(id);
                        }, align: "end", portal: true, anchor: (_jsxs("button", { type: "button", className: css.selector, "aria-haspopup": "menu", "aria-expanded": open, disabled: busy || !state.writable || state.options.length === 0, onClick: () => { setOpen(value => !value); }, children: [label, _jsx(IconChevronDownOutline14, { className: css.chevron })] })) })] }), _jsx(RiskConfirmation, { open: confirmingFullAccess, title: t('confirm.title'), description: t('confirm.description'), acknowledgeLabel: t('confirm.acknowledge'), cancelLabel: t('confirm.cancel'), confirmLabel: t('confirm.enable'), acknowledged: acknowledged, disabled: !state.writable || state.status === 'saving', onAcknowledgedChange: setAcknowledged, onCancel: () => {
                    setAcknowledged(false);
                    setConfirmingFullAccess(false);
                }, onConfirm: () => {
                    setAcknowledged(false);
                    setConfirmingFullAccess(false);
                    void select(FULL_ACCESS_PRESET);
                } })] }));
}
//# sourceMappingURL=PermissionRow.js.map