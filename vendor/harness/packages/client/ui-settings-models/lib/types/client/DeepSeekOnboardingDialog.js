import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Official-DeepSeek first-run step. Readiness comes from the same
 * provider/settings/credential join as the Models page: any provider the user
 * can already talk to ends the step, and only a user with none is offered the
 * official DeepSeek route. The step reuses that page's credential editor in
 * the onboarding plugin's shared modal, so the key is entered once.
 */
import { useEffect } from 'react';
import { onboardingReadiness } from "./store.js";
import { ProviderEditor } from "./ProviderEditor.js";
import { OnboardingModal } from "./OnboardingModal.js";
import styles from './DeepSeekOnboardingDialog.module.css';
/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value) {
    throw new Error('unexpected DeepSeek onboarding state');
}
/**
 * Prompt a first-run user for the official DeepSeek credential while no
 * provider can serve requests and that credential is writable.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props) {
    const { complete, controller, useModels, api, t } = props;
    const state = useModels(snapshot => snapshot);
    const readiness = onboardingReadiness(state);
    useEffect(() => {
        if (state.status === 'idle')
            void controller.load();
    }, [controller, state.status]);
    useEffect(() => {
        if (readiness.kind === 'adapter-absent'
            || readiness.kind === 'provider-ready'
            || readiness.kind === 'unavailable')
            complete();
    }, [complete, readiness.kind]);
    switch (readiness.kind) {
        case 'loading':
        case 'adapter-absent':
        case 'provider-ready':
        case 'unavailable':
            return null;
        case 'credential-missing':
            break;
        /* v8 ignore next -- every current readiness variant is handled above */
        default:
            return assertNever(readiness);
    }
    const row = state.rows.find(candidate => candidate.entry.provider === 'deepseek-official'
        && candidate.entry.settingsNs === 'llm-deepseek'
        && candidate.entry.settingsPath.length === 0);
    const namespace = state.namespaces.get('llm-deepseek');
    /* v8 ignore next 2 -- credential-missing is derived only from this exact joined row. */
    if (row === undefined || namespace === undefined)
        return null;
    const finishCredential = (changed) => {
        if (!changed) {
            complete();
            return;
        }
        void controller.load();
    };
    return (_jsxs(OnboardingModal, { title: t('onboardingTitle'), children: [_jsx("p", { className: styles.description, children: t('onboardingDescription') }), _jsx("div", { className: styles.editor, children: _jsx(ProviderEditor, { provider: row.entry.provider, displayName: row.entry.displayName, namespace: namespace, settingsPath: row.entry.settingsPath, api: api, t: t, readOnly: false, hideTitle: true, credentialOnly: true, credentialRequired: true, autoFocusCredential: true, cancelLabel: "onboardingLater", submitLabel: "onboardingSave", submitBusyLabel: "onboardingSaving", onClose: finishCredential }) })] }));
}
//# sourceMappingURL=DeepSeekOnboardingDialog.js.map