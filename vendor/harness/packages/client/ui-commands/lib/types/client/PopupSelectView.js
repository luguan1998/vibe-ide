import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Official popupSelect shell: renders one session's PopupSelectController
 * store into the conversation.input.overlay anchor. Unlike the slash menu
 * (combobox — textarea keeps focus), this shell HOLDS focus while open: the
 * inner search input takes focus, plain typing filters the loaded options
 * locally, Enter/↑↓ drive the filtered highlight (scrolled into view), Escape
 * dismisses back to the composer, and ←→ keep the search input's native
 * caret. Any pointer interaction outside the box dismisses (the click's own
 * target takes focus). Closed state renders null; the overlay slot stays
 * mounted. The card height clamps to the space above the composer.
 */
import { useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { IconCheckOutline16, RiskConfirmation, useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives';
import { filterOptions } from "./popup.js";
import css from './PopupSelectView.module.css';
/** Design cap on the card height (same MenuDropdown family as the slash menu). */
const MAX_HEIGHT = 320;
/**
 * Render the popupSelect shell overlay entry.
 * @param props - injected face: the session's shell controller; `t` rides the standard locale seat.
 * @returns the select card while open; null while closed.
 */
export function PopupSelectView({ popup, t }) {
    const state = useSyncExternalStore(fn => popup.state.subscribe(fn), () => popup.state.getSnapshot());
    const cardRef = useRef(null);
    const searchRef = useRef(null);
    // The card is bottom-anchored above the composer; clamp the design cap to
    // the space above it, re-measured on every store update.
    const maxHeight = useAnchoredMaxHeight(cardRef, MAX_HEIGHT, state);
    const active = state.open ? state.active : null;
    // The search input keeps focus while arrows move a virtual highlight, so
    // the browser never scrolls the active row into view — do it here.
    useEffect(() => {
        if (active === null)
            return;
        cardRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [active]);
    // Focus ownership: the search input grabs on open, and ANY outside
    // pointer interaction dismisses —
    // capture phase so a click landing anywhere else (textarea included)
    // closes the shell before its own handlers run; that click's target then
    // takes focus naturally, so no focusComposer here.
    useEffect(() => {
        if (!state.open || state.confirming !== null)
            return;
        const onPointerDown = (ev) => {
            if (cardRef.current !== null && ev.target instanceof Node && cardRef.current.contains(ev.target))
                return;
            popup.dismiss();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => { document.removeEventListener('pointerdown', onPointerDown, true); };
    }, [state.open, state.confirming, popup]);
    // Focus the search input after it mounts (separate effect so the ref is populated).
    useEffect(() => {
        if (state.open && state.confirming === null)
            searchRef.current?.focus();
    }, [state.open, state.confirming]);
    if (!state.open)
        return null;
    const rows = filterOptions(state.options, state.search);
    const confirmation = state.confirming?.confirmation;
    const onKeyDown = (ev) => {
        // ArrowLeft/ArrowRight fall through on purpose: the search input keeps
        // its native caret movement.
        switch (ev.key) {
            case 'ArrowDown':
                ev.preventDefault();
                popup.move(1);
                return;
            case 'ArrowUp':
                ev.preventDefault();
                popup.move(-1);
                return;
            case 'Enter':
                ev.preventDefault();
                void popup.select(state.active);
                return;
            case 'Escape':
                ev.preventDefault();
                popup.dismiss({ focusComposer: true });
                return;
            default:
        }
    };
    return (_jsxs(_Fragment, { children: [state.confirming === null && (_jsxs("div", { ref: cardRef, className: css.card, style: { maxHeight }, "aria-label": t('overlay.aria', { command: String(state.command) }), onKeyDown: onKeyDown, children: [_jsx("input", { ref: searchRef, className: css.search, type: "text", placeholder: t('search.placeholder'), "aria-label": t('search.aria'), value: state.search, readOnly: state.submitting, onChange: (ev) => { popup.setSearch(ev.currentTarget.value); } }), state.error !== null && (_jsxs("div", { className: css.error, role: "alert", children: [_jsx("span", { className: css.errorText, children: state.error }), state.status === 'failed' && (_jsx("button", { type: "button", className: css.retry, onClick: () => { popup.retry(); }, children: t('retry') }))] })), state.status === 'pending' && _jsx("div", { className: css.status, children: t('status.loading') }), state.submitting && _jsx("div", { className: css.status, children: t('status.applying') }), state.status === 'ready' && rows.length === 0 && _jsx("div", { className: css.status, children: t('status.empty') }), state.status === 'ready' && (_jsx("div", { role: "listbox", "aria-label": t('listbox.aria', { command: String(state.command) }), className: css.viewport, children: rows.map((option, index) => (_jsxs("div", { role: "option", "aria-selected": index === state.active, className: clsx(css.row, index === state.active && css.rowActive), 
                            // mousedown would race the document capture listener; the shell
                            // owns focus anyway, so a plain click (inside the card → no
                            // dismiss) works.
                            onClick: () => { void popup.select(index); }, onMouseEnter: () => { popup.highlight(index); }, children: [_jsx("span", { className: css.label, children: option.label }), option.detail !== undefined && _jsx("span", { className: css.detail, children: option.detail }), option.active === true && _jsx("span", { className: css.check, children: _jsx(IconCheckOutline16, {}) })] }, option.id))) }))] })), confirmation !== undefined && (_jsx(RiskConfirmation, { open: true, title: confirmation.title, description: confirmation.description, acknowledgeLabel: confirmation.acknowledgeLabel, cancelLabel: confirmation.cancelLabel, confirmLabel: confirmation.confirmLabel, acknowledged: state.acknowledged, onAcknowledgedChange: (value) => { popup.acknowledge(value); }, onCancel: () => { popup.cancelConfirmation(); }, onConfirm: () => { void popup.confirm(); } }))] }));
}
//# sourceMappingURL=PopupSelectView.js.map