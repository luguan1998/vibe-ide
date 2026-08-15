import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Shared modal chrome for every step registered by this onboarding plugin. */
import { useEffect, useRef } from 'react';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './OnboardingModal.module.css';
const ignoreImplicitDismiss = () => { };
/**
 * Render a blocking onboarding dialog and keep the application root inert.
 * @param props.title - accessible and visible dialog title.
 * @param props.focusTitle - focus the title when the step has no form control.
 * @param props.children - step-owned body and actions.
 * @returns the body-portaled modal.
 */
export function OnboardingModal({ title, focusTitle = false, children, }) {
    const titleRef = useRef(null);
    useEffect(() => {
        const appRoot = document.getElementById('root');
        if (appRoot === null)
            return;
        const previous = appRoot.inert;
        appRoot.inert = true;
        return () => { appRoot.inert = previous; };
    }, []);
    useEffect(() => {
        if (focusTitle)
            titleRef.current?.focus();
    }, [focusTitle]);
    return (_jsx(Modal, { open: true, title: title, onClose: ignoreImplicitDismiss, headless: true, className: css.dialog, children: _jsxs("div", { className: css.content, children: [_jsx("h2", { ref: titleRef, className: css.title, tabIndex: focusTitle ? -1 : undefined, children: title }), _jsx("div", { className: css.body, children: children })] }) }));
}
//# sourceMappingURL=OnboardingModal.js.map