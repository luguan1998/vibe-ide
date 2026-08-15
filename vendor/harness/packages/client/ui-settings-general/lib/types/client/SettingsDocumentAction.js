import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Optional settings-header action for opening a file-backed Host document. */
import { useEffect } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './SettingsDocumentAction.module.css';
/**
 * Render the open-document action only after Host metadata confirms document availability.
 * @param props - header owner props, localized copy, and injected document state.
 * @returns the action, or null while unavailable or unresolved.
 */
export function SettingsDocumentAction({ controller, useSnapshot, t }) {
    const state = useSnapshot(snapshot => snapshot);
    useEffect(() => {
        void controller.load();
    }, [controller]);
    if (state.status !== 'ready')
        return null;
    return (_jsxs("div", { className: css.action, children: [state.error === null ? null : _jsx("span", { className: css.error, role: "alert", children: t('openDocument.error') }), _jsx(Button, { variant: "outline", size: "sm", disabled: state.opening, onClick: () => { void controller.open(); }, children: t('openDocument') })] }));
}
//# sourceMappingURL=SettingsDocumentAction.js.map