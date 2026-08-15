import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, } from 'react';
import clsx from 'clsx';
import { IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14, IconWarningOutline16, Toast, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './ModelSelect.module.css';
/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect({ locked, available, directory, load, select, t }) {
    const state = useSyncExternalStore(fn => directory.subscribe(fn), () => directory.getSnapshot());
    const [open, setOpen] = useState(false);
    const [pane, setPane] = useState('root');
    // The in-menu error strip serves catalog loads (its Retry re-runs the
    // load); a rejected SELECTION announces through the transient toast
    // instead, so the strip renders only while the latest failure-capable
    // action was a load.
    const lastActionRef = useRef('load');
    const [toast, setToast] = useState(null);
    const toastSeq = useRef(0);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const itemRefs = useRef([]);
    const id = useId();
    const choices = useMemo(() => state.groups.flatMap(group => group.models.map(model => ({
        group,
        model,
        selection: {
            provider: group.id,
            model: model.id,
            ...model.reasoning?.defaultEffort === undefined
                ? {}
                : { reasoningEffort: model.reasoning.defaultEffort },
        },
    }))), [state.groups]);
    const selectedIndex = state.current === null
        ? -1
        : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model);
    const currentChoice = choices[selectedIndex];
    const reasoning = currentChoice?.model.reasoning;
    const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
    const effortLabel = reasoning === undefined
        ? undefined
        : effectiveEffort === undefined
            ? t('effort.providerDefault')
            : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort;
    const effortChoices = useMemo(() => reasoning === undefined
        ? []
        : [
            ...reasoning.defaultEffort === undefined
                ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
                : [],
            ...reasoning.efforts.map((effort) => ({
                key: `effort:${effort.id}`,
                effort: effort.id,
                label: effort.name,
                ...effort.description === undefined ? {} : { description: effort.description },
            })),
        ], [reasoning, t]);
    const busy = state.status === 'selecting';
    const reload = () => {
        lastActionRef.current = 'load';
        load();
    };
    // Mount-time load resolves the trigger label; every open refreshes.
    useEffect(() => {
        if (available) {
            lastActionRef.current = 'load';
            load();
        }
    }, [available, load]);
    useEffect(() => {
        if (!open)
            return;
        const closeOutside = (event) => {
            if (!rootRef.current?.contains(event.target))
                setOpen(false);
        };
        document.addEventListener('mousedown', closeOutside);
        return () => { document.removeEventListener('mousedown', closeOutside); };
    }, [open]);
    if (!available)
        return null;
    const show = () => {
        setPane('root');
        setOpen(true);
        reload();
    };
    const close = (restoreFocus = false) => {
        setOpen(false);
        setPane('root');
        if (restoreFocus)
            queueMicrotask(() => { triggerRef.current?.focus(); });
    };
    const moveFocus = (offset) => {
        const items = itemRefs.current.filter(item => item !== null);
        if (items.length === 0)
            return;
        const active = items.findIndex(item => item === document.activeElement);
        const next = (Math.max(active, 0) + offset + items.length) % items.length;
        items[next]?.focus();
    };
    const onRootKeyDown = (event) => {
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            // Escape backs out of a drilled pane first, then closes.
            if (pane !== 'root')
                setPane('root');
            else
                close(true);
            return;
        }
        if (!open)
            return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(event.key === 'ArrowDown' ? 1 : -1);
        }
    };
    const onBlur = (event) => {
        if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget))
            return;
        close();
    };
    const settleSelection = (accepted) => {
        if (accepted) {
            if (rootRef.current !== null)
                close(true);
            return;
        }
        const message = directory.getSnapshot().error;
        if (message !== null) {
            toastSeq.current += 1;
            setToast({ seq: toastSeq.current, text: t('error.action', { message }) });
        }
    };
    const choose = (selection) => {
        if (state.current?.provider === selection.provider && state.current.model === selection.model) {
            close(true);
            return;
        }
        lastActionRef.current = 'select';
        void select(selection).then(settleSelection);
    };
    const chooseEffort = (effort) => {
        if (state.current === null)
            return;
        if (effectiveEffort === effort) {
            close(true);
            return;
        }
        const selection = {
            provider: state.current.provider,
            model: state.current.model,
            ...effort === undefined ? {} : { reasoningEffort: effort },
        };
        lastActionRef.current = 'select';
        void select(selection).then(settleSelection);
    };
    const modelLabel = currentChoice?.model.name ?? t('trigger.fallback');
    const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`;
    const triggerAria = currentChoice === undefined
        ? t('trigger.selectAria')
        : effortLabel === undefined
            ? t('trigger.aria', { model: modelLabel })
            : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel });
    itemRefs.current = [];
    let itemIndex = 0;
    const itemRef = () => {
        const at = itemIndex++;
        return (node) => { itemRefs.current[at] = node; };
    };
    return (_jsxs("div", { ref: rootRef, className: css.root, onKeyDown: onRootKeyDown, onBlur: onBlur, children: [_jsxs("button", { ref: triggerRef, type: "button", className: css.trigger, "aria-label": triggerAria, "aria-haspopup": "menu", "aria-expanded": open, "aria-controls": open ? `${id}-menu` : undefined, title: triggerLabel, disabled: locked, onClick: () => {
                    if (open) {
                        close();
                    }
                    else {
                        show();
                    }
                }, children: [_jsx("span", { className: css.triggerLabel, children: modelLabel }), effortLabel !== undefined && _jsx("span", { className: css.triggerEffort, children: effortLabel }), _jsx(IconChevronDownOutline14, { className: clsx(css.chevron, open && css.chevronOpen) })] }), open && (_jsxs("div", { id: `${id}-menu`, className: css.menu, role: "menu", "aria-label": t('menu.aria'), "aria-busy": state.status === 'loading' || busy, children: [pane === 'root' && (_jsxs(_Fragment, { children: [_jsxs("button", { ref: itemRef(), type: "button", role: "menuitem", className: css.cell, onClick: () => { setPane('model'); }, children: [_jsx("span", { className: css.cellLabel, children: t('menu.model') }), _jsx("span", { className: css.cellValue, children: modelLabel }), _jsx(IconChevronRightOutline14, { className: css.cellChevron })] }), reasoning !== undefined && (_jsxs("button", { ref: itemRef(), type: "button", role: "menuitem", className: css.cell, onClick: () => { setPane('effort'); }, children: [_jsx("span", { className: css.cellLabel, children: t('menu.effort') }), _jsx("span", { className: css.cellValue, children: effortLabel }), _jsx(IconChevronRightOutline14, { className: css.cellChevron })] }))] })), pane === 'model' && (_jsxs(_Fragment, { children: [state.status === 'loading' && (_jsx("div", { className: css.status, children: t('status.loading') })), state.error !== null && lastActionRef.current === 'load' && (_jsxs("div", { className: css.error, children: [_jsx("span", { children: t('error.action', { message: state.error }) }), _jsx("button", { type: "button", className: css.retry, onClick: reload, children: t('retry') })] })), state.failures.map(failure => (_jsxs("div", { className: css.warning, children: [_jsx("span", { children: t('warning.groupLoad', { name: failure.name, message: failure.message }) }), _jsx("button", { type: "button", className: css.retry, onClick: reload, children: t('retry') })] }, failure.id))), _jsx("div", { className: clsx(css.groups, 'scrollable'), children: state.groups.map((group) => {
                                    const headingId = `${id}-${group.id}`;
                                    return (_jsxs("section", { role: "group", "aria-labelledby": headingId, className: css.group, children: [_jsx("div", { className: css.groupTitle, id: headingId, children: group.name }), group.models.map((model) => {
                                                const selected = state.current?.provider === group.id && state.current.model === model.id;
                                                return (_jsxs("button", { ref: itemRef(), type: "button", role: "menuitemradio", "aria-checked": selected, className: clsx(css.option, selected && css.selected), title: model.name, disabled: busy, onClick: () => { choose({ provider: group.id, model: model.id }); }, children: [_jsxs("span", { className: css.optionCopy, children: [_jsx("span", { className: css.modelName, children: model.name }), model.description !== undefined && (_jsx("span", { className: css.description, children: model.description }))] }), _jsx("span", { className: css.check, children: selected ? _jsx(IconCheckOutline16, {}) : null })] }, model.id));
                                            })] }, group.id));
                                }) }), state.status === 'ready' && choices.length === 0 && (_jsx("div", { className: css.empty, children: t('empty.models') }))] })), pane === 'effort' && (_jsxs(_Fragment, { children: [state.error !== null && lastActionRef.current === 'load' && (_jsxs("div", { className: css.error, children: [_jsx("span", { children: t('error.action', { message: state.error }) }), _jsx("button", { type: "button", className: css.retry, onClick: reload, children: t('action.reload') })] })), effortChoices.length === 0
                                ? _jsx("div", { className: css.empty, children: t('empty.efforts') })
                                : effortChoices.map(level => (_jsxs("button", { ref: itemRef(), type: "button", role: "menuitemradio", "aria-checked": effectiveEffort === level.effort, className: clsx(css.option, effectiveEffort === level.effort && css.selected), disabled: busy, onClick: () => { chooseEffort(level.effort); }, children: [_jsxs("span", { className: css.optionCopy, children: [_jsx("span", { className: css.modelName, children: level.label }), level.description !== undefined && (_jsx("span", { className: css.description, children: level.description }))] }), _jsx("span", { className: css.check, children: effectiveEffort === level.effort ? _jsx(IconCheckOutline16, {}) : null })] }, level.key)))] }))] })), toast !== null && (_jsx(Toast, { text: toast.text, icon: _jsx(IconWarningOutline16, {}), anchor: rootRef.current?.closest('[data-composer-card]') ?? null, onDone: () => { setToast(null); } }, toast.seq))] }));
}
//# sourceMappingURL=ModelSelect.js.map