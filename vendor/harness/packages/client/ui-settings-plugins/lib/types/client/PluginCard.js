import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * One plugin's card: a header naming the plugin and what its settings govern,
 * disclosing that plugin's controls in place, with the save that writes them.
 *
 * The header is its own button rather than a shared disclosure row because a
 * card stacks its name over its description, while that row lays the two side
 * by side — the layout, not the behavior, is what differs. Disclosure is
 * card-local state: which card a user has open is a reading gesture, not
 * something the Host or the section has any stake in. Staged edits outlive
 * collapsing, so the header marks a card holding unsaved edits.
 *
 * A card renders nothing while its namespace is unavailable: a deployment that
 * does not compose the owning plugin should show no trace of it, rather than a
 * disabled card the user cannot act on.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './PluginCard.module.css';
/**
 * Render one plugin card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function PluginCard(props) {
    const [open, setOpen] = useState(false);
    const { state } = props;
    if (!state.available)
        return null;
    const title = props.t(props.titleKey);
    const blocked = !state.dirty || state.invalid || state.saving;
    return (_jsxs("li", { className: clsx(css.card, open && css.cardOpen), children: [_jsxs("button", { type: "button", className: css.header, "aria-expanded": open, "aria-label": `${props.t(open ? 'collapse' : 'expand')}: ${title}`, onClick: () => { setOpen(!open); }, children: [_jsxs("span", { className: css.headText, children: [_jsx("span", { className: css.name, children: title }), _jsx("span", { className: css.description, children: props.t(props.descriptionKey) })] }), state.dirty ? _jsx("span", { className: css.pending, children: props.t('unsaved') }) : null, _jsx(IconChevronDownOutline14, { className: clsx(css.chevron, open && css.chevronOpen) })] }), open
                ? (_jsxs("div", { className: css.body, children: [!state.writable ? _jsx("p", { className: css.readOnly, role: "status", children: props.t('readOnly') }) : null, props.children, _jsxs("div", { className: css.footer, children: [state.failed ? _jsx("p", { className: css.failed, role: "status", children: props.t('saveFailed') }) : null, _jsx("button", { type: "button", className: css.discard, disabled: !state.dirty || state.saving, onClick: props.onDiscard, children: props.t('discard') }), _jsx("button", { type: "button", className: css.save, disabled: blocked, onClick: props.onSave, children: props.t(state.saving ? 'saving' : 'save') })] })] }))
                : null] }));
}
//# sourceMappingURL=PluginCard.js.map