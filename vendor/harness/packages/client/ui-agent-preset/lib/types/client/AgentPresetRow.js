import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Agent-preset preference row: the preset new sessions are composed from.
 * A running session keeps the composition it began with, so this row never
 * disturbs work in progress.
 */
import { useEffect, useState } from 'react';
import { presetDisplayText } from "./locales.js";
import { PresetMenu } from "./PresetMenu.js";
import css from './AgentPresetRow.module.css';
/**
 * Render the new-session agent-preset selector.
 * @param props - composed slot props.
 * @returns the row, or null when the deployment composes no presets.
 */
export function AgentPresetRow({ load, select, useAgentPreset, t }) {
    const state = useAgentPreset(snapshot => snapshot);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        void load();
    }, [load]);
    useEffect(() => {
        if (state.writable && state.status !== 'unavailable')
            return;
        setOpen(false);
    }, [state.status, state.writable]);
    // A deployment that composes no presets has nothing to choose between, and
    // every session shares the host composition — the row simply does not exist.
    if (state.status === 'unavailable')
        return null;
    const busy = state.status === 'loading' || state.status === 'saving';
    // Every preset surface applies the same display-copy rule. The id remains
    // addressing rather than a label, except where no display name exists.
    const chosen = state.options.find(option => option.id === state.currentValue);
    const chosenText = chosen === undefined ? undefined : presetDisplayText(chosen, t);
    const label = state.currentValue === '' ? t('loading') : (chosenText?.name ?? state.currentValue);
    const description = state.error ?? t('description');
    return (_jsxs("div", { className: css.row, children: [_jsxs("div", { className: css.rowText, children: [_jsx("div", { className: css.title, children: t('title') }), _jsx("div", { className: css.desc, role: state.error === null ? undefined : 'alert', children: description })] }), _jsx(PresetMenu, { options: state.options, selectedId: state.currentValue, label: label, t: t, buttonClassName: css.selector, chevronClassName: css.chevron, disabled: busy || !state.writable || state.options.length === 0, open: open, onOpenChange: setOpen, onSelect: (id) => { void select(id); } })] }));
}
//# sourceMappingURL=AgentPresetRow.js.map