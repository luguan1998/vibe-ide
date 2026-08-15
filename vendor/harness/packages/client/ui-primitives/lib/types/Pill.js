import { jsx as _jsx } from "react/jsx-runtime";
import clsx from 'clsx';
import css from './Pill.module.css';
/**
 * Render a pill chip. Interactive when onClick is supplied (renders a button);
 * otherwise a static span.
 * @param props.active - selected/active visual state.
 * @returns pill element.
 */
export function Pill({ active = false, className, children, onClick, ...rest }) {
    if (!onClick) {
        return _jsx("span", { className: clsx(css.pill, active && css.active, className), children: children });
    }
    return (_jsx("button", { type: "button", className: clsx(css.pill, css.interactive, active && css.active, className), onClick: onClick, ...rest, children: children }));
}
//# sourceMappingURL=Pill.js.map