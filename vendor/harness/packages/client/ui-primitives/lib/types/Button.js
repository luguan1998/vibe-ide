import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import clsx from 'clsx';
import css from './Button.module.css';
/**
 * Render a button.
 * @param props.variant - visual family (default 'ghost').
 * @param props.size - 'md' 36px capsule (figma Button) or 'sm' 28px compact.
 * @param props.icon - optional leading 16px icon node.
 * @returns the button element; native button attributes pass through.
 */
export function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }) {
    return (_jsxs("button", { type: "button", className: clsx(css.button, css[variant], css[size], className), ...rest, children: [icon != null && _jsx("span", { className: css.icon, children: icon }), children] }));
}
//# sourceMappingURL=Button.js.map