import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Trigger candidate menu: renders the InputTriggerService menu store into the
 * conversation.input.overlay anchor. Closed state renders null (the overlay
 * slot stays mounted); groups render in roster order under localized title
 * rows, pending groups as a loading row; pointer picks route back through
 * the service (combobox pattern — focus never leaves the textarea, so rows
 * are mousedown-handled and the highlight is exposed via
 * aria-activedescendant on the listbox).
 */
import { Fragment, useEffect, useRef, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './MenuView.module.css';
/** Design cap on the list height (figma SLASH 39:26572 MenuDropdown). */
const MAX_HEIGHT = 320;
/** DOM id of one option row (the aria-activedescendant target). */
function optionId(source, index) {
    return `dsh-slash-option-${source}-${index}`;
}
/**
 * Render the candidate menu overlay entry.
 * @param props - injected face (the menu store and the pick route); `t` rides the standard locale seat.
 * @returns the dropdown while open; null while closed.
 */
export function MenuView({ menu, onPick, onDismiss, t }) {
    const state = useSyncExternalStore(fn => menu.subscribe(fn), () => menu.getSnapshot());
    const listRef = useRef(null);
    // The list is bottom-anchored above the composer; clamp the design cap to
    // the space above it, re-measured on every store update (the anchor moves
    // when the composer grows).
    const maxHeight = useAnchoredMaxHeight(listRef, MAX_HEIGHT, state);
    const highlight = state.open ? state.highlight : null;
    // Focus stays in the textarea (combobox pattern), so the browser never
    // scrolls the active option into view on keyboard moves — do it here.
    useEffect(() => {
        if (highlight === null)
            return;
        document.getElementById(optionId(highlight.source, highlight.index))
            ?.scrollIntoView({ block: 'nearest' });
    }, [highlight]);
    // Dismiss on pointer outside the menu AND outside the composer card
    // (clicking the textarea or bottom bar must not close the menu).
    useEffect(() => {
        if (!state.open)
            return;
        const onPointerDown = (ev) => {
            if (!(ev.target instanceof Node))
                return;
            if (listRef.current?.contains(ev.target))
                return;
            const composerCard = listRef.current?.closest('[data-composer-card]');
            if (composerCard?.contains(ev.target))
                return;
            onDismiss();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => { document.removeEventListener('pointerdown', onPointerDown, true); };
    }, [state.open, onDismiss]);
    if (!state.open)
        return null;
    return (_jsx("div", { ref: listRef, className: css.menu, style: { maxHeight }, role: "listbox", "aria-label": t('suggestions.aria'), "aria-activedescendant": highlight !== null ? optionId(highlight.source, highlight.index) : undefined, children: _jsx("div", { className: css.viewport, children: state.groups.map(group => (group.status === 'ready' && group.items.length === 0)
                ? null
                : (_jsxs(Fragment, { children: [_jsx("div", { className: css.groupTitle, role: "presentation", "data-source": group.source, children: t(group.source) }), group.status === 'pending'
                            ? _jsx("div", { className: css.loading, "data-source": group.source, children: t('loading') })
                            : group.items.map((item, index) => {
                                const active = highlight !== null && highlight.source === group.source && highlight.index === index;
                                return (_jsxs("button", { id: optionId(group.source, index), type: "button", role: "option", "aria-selected": active, className: clsx(css.item, active && css.active), 
                                    // mousedown, not click: the textarea keeps focus (combobox
                                    // pattern) — preventing default stops the focus steal, and the
                                    // pick runs before any blur-driven teardown.
                                    onMouseDown: (ev) => {
                                        ev.preventDefault();
                                        onPick(group.source, index);
                                    }, children: [item.icon !== undefined && _jsx("span", { className: css.itemIcon, "aria-hidden": true, children: item.icon }), _jsx("span", { className: css.itemName, children: item.name }), item.description !== undefined && _jsx("span", { className: css.itemDescription, children: item.description })] }, `${group.source}:${item.name}`));
                            })] }, group.source))) }) }));
}
//# sourceMappingURL=MenuView.js.map