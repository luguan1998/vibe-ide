import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Product-wide, versioned internal-testing notice. */
import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { OnboardingModal } from "./OnboardingModal.js";
import css from './WelcomeNotice.module.css';
/**
 * Render the current notice until its exact copy version is acknowledged.
 * @param props - settings-shell owner state and welcome dependencies.
 * @returns the welcome modal or null while the step decides not to show.
 */
export function WelcomeNotice(props) {
    const { complete, controller, useWelcome, t } = props;
    const state = useWelcome(snapshot => snapshot);
    const finished = useRef(false);
    const finish = useCallback(() => {
        if (finished.current)
            return;
        finished.current = true;
        complete();
    }, [complete]);
    useEffect(() => {
        if (state.status === 'idle')
            void controller.load();
    }, [controller, state.status]);
    useEffect(() => {
        if (state.acknowledged)
            finish();
    }, [finish, state.acknowledged]);
    if (state.status === 'idle' || state.status === 'loading' || state.acknowledged)
        return null;
    const acknowledge = async () => {
        if (await controller.acknowledge())
            finish();
    };
    const paragraphs = t('welcomeBody').split('\n\n');
    return (_jsxs(OnboardingModal, { title: t('welcomeTitle'), focusTitle: true, children: [_jsx("div", { className: css.copy, children: paragraphs.map(paragraph => _jsx("p", { children: paragraph }, paragraph)) }), state.error === null ? null : _jsx("p", { className: css.error, role: "alert", children: t('welcomeError') }), _jsx("div", { className: css.actions, children: _jsx(Button, { variant: "primary", className: css.primary, disabled: state.status === 'saving', onClick: () => { void acknowledge(); }, children: t('welcomeContinue') }) })] }));
}
//# sourceMappingURL=WelcomeNotice.js.map