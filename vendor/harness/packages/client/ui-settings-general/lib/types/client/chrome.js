import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Shell chrome content registered into the shell's trigger/header seats: the
 * trigger row icon + label (figma sidebar foot) and the panel title text.
 * The shell renders the surrounding chrome (button, nav heading row) and
 * reads each entry's `label` option for aria text.
 */
import { IconSettingsOutline14, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './chrome.module.css';
/**
 * Render the trigger row content (icon; label only in the wide column).
 * @param props - composed slot props.
 * @returns the trigger content fragment.
 */
export function TriggerContent({ wide, t }) {
    return (_jsxs(_Fragment, { children: [wide ? _jsx(IconSettingsOutline16, { size: 16 }) : _jsx(IconSettingsOutline14, { size: 18 }), wide && _jsx("span", { className: css.triggerLabel, children: t('trigger') })] }));
}
/**
 * Render the panel title text.
 * @param props - composed slot props.
 * @returns the title text node.
 */
export function HeaderContent({ t }) {
    return _jsx(_Fragment, { children: t('title') });
}
/**
 * Render the close button's visually-hidden label text.
 * @param props - composed slot props.
 * @returns the label text node.
 */
export function CloseLabel({ t }) {
    return _jsx(_Fragment, { children: t('close') });
}
//# sourceMappingURL=chrome.js.map