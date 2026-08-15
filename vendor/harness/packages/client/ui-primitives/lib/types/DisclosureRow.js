import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import clsx from 'clsx';
import { IconChevronDownOutline14 } from "./icons/index.js";
import css from './DisclosureRow.module.css';
/**
 * Render one disclosure header and its controlled expanded content.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export function DisclosureRow({ icon, title, open, expandable, onToggle, expandOnRowClick = false, previewChevron = expandable, keepContentWhenOpen = false, collapsedContent, children, className, rowClassName, leadingClassName, chevronClassName, titleClassName, }) {
    const rowExpands = expandable && expandOnRowClick;
    const toggleFromLeading = (event) => {
        event.stopPropagation();
        onToggle();
    };
    const toggleFromKeyboard = (event) => {
        if (!rowExpands || (event.key !== 'Enter' && event.key !== ' '))
            return;
        event.preventDefault();
        onToggle();
    };
    const collapsedLeading = previewChevron
        ? (_jsxs(_Fragment, { children: [_jsx("span", { className: css.iconIdle, children: icon }), _jsx(IconChevronDownOutline14, { className: clsx(chevronClassName, css.chevronHover) })] }))
        : icon;
    const leading = open
        ? _jsx(IconChevronDownOutline14, { className: chevronClassName })
        : collapsedLeading;
    return (_jsxs("div", { className: clsx(css.root, className), "data-open": open || undefined, children: [_jsxs("div", { className: clsx(css.row, rowClassName), "data-disclosure-row": true, "data-expandable": rowExpands || undefined, role: rowExpands ? 'button' : undefined, tabIndex: rowExpands ? 0 : undefined, "aria-expanded": rowExpands ? open : undefined, onClick: rowExpands ? onToggle : undefined, onKeyDown: rowExpands ? toggleFromKeyboard : undefined, children: [expandable && !rowExpands ? (_jsx("button", { type: "button", className: clsx(css.leading, leadingClassName), "aria-expanded": open, onClick: toggleFromLeading, children: leading })) : (_jsx("span", { className: clsx(css.leading, leadingClassName), children: leading })), _jsx("span", { className: clsx(css.title, titleClassName), children: title }), (keepContentWhenOpen || !open) && collapsedContent] }), open && children] }));
}
//# sourceMappingURL=DisclosureRow.js.map