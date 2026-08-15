import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import clsx from 'clsx';
import css from './Input.module.css';
/**
 * Render a text input with an optional leading icon.
 * @param props.icon - optional 16px leading icon node.
 * @returns wrapper span containing the native input; input attributes pass through.
 */
export function Input({ icon, className, ...rest }) {
    return (_jsxs("span", { className: clsx(css.wrap, className), children: [icon != null && _jsx("span", { className: css.icon, children: icon }), _jsx("input", { className: css.input, ...rest })] }));
}
//# sourceMappingURL=Input.js.map