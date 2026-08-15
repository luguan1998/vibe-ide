import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import css from './SubagentReadOnlyComposer.module.css';
/**
 * Explain why the normal composer is unavailable for an addressed child.
 * @param props - selector-owned read-only reason plus standard slot props.
 * @returns A read-only composer replacement.
 */
export function SubagentReadOnlyComposer({ matched, t, }) {
    const oneShot = matched.reason === 'one-shot';
    return (_jsxs("div", { className: css.frame, role: "status", children: [_jsx("strong", { children: t(oneShot ? 'readonly.oneShot.title' : 'readonly.title') }), _jsx("span", { children: t(oneShot ? 'readonly.oneShot.body' : 'readonly.body') })] }));
}
//# sourceMappingURL=SubagentReadOnlyComposer.js.map