import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './PlanModeControl.module.css';
/**
 * Plan-mode status over the host-computed `plan` projection. The chip renders
 * only while the effective target is plan mode (`pending ? !active : active`
 * — a folded host value, not client optimism) and executes /plan off.
 */
export function PlanChip({ useProjection, locked, exitPlanMode, t }) {
    const plan = useProjection('plan');
    const [leaving, setLeaving] = useState(false);
    const [error, setError] = useState(null);
    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);
    if (plan === undefined)
        return null;
    const target = plan.pending ? !plan.active : plan.active;
    if (!target)
        return null;
    const off = () => {
        // No leaving/locked guard: both disable the button, so no click arrives.
        setLeaving(true);
        setError(null);
        void exitPlanMode().then((failure) => {
            if (!aliveRef.current)
                return;
            setLeaving(false);
            setError(failure);
        }, (reason) => {
            if (!aliveRef.current)
                return;
            setLeaving(false);
            setError(reason instanceof Error ? reason.message : String(reason));
        });
    };
    return (_jsxs("span", { className: css.wrap, children: [_jsxs("button", { type: "button", className: css.chip, "aria-label": t('chip.on.aria'), title: t('chip.on.title'), disabled: locked || leaving, onClick: off, children: ["Plan", _jsx("span", { className: css.close, "aria-hidden": true, children: _jsx(IconCloseFill14, { size: 12 }) })] }), error !== null && _jsx("span", { className: css.error, role: "status", title: error, children: "failed to exit plan mode" })] }));
}
//# sourceMappingURL=PlanModeControl.js.map