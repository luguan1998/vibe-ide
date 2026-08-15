import { jsx as _jsx } from "react/jsx-runtime";
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
/**
 * Modal shared by the Session Header button and this browser's `/export` command.
 * @param props - Session runtime, bound controller state, actions, and localized copy.
 * @returns the modal portal contribution.
 */
export function SessionLogDownloadDialog({ sessionId, useSessionLogDownload, dismiss, t, }) {
    const entry = useSessionLogDownload(state => state.bySession[String(sessionId)]);
    const status = entry?.status;
    const open = entry?.open === true;
    const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null;
    const title = status === 'downloading'
        ? t('dialog.preparingTitle')
        : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle');
    const description = status === 'downloading'
        ? t('dialog.preparingDescription')
        : status === 'success' ? t('dialog.successDescription') : error ?? t('dialog.commandFailed');
    return (_jsx(Modal, { open: open, onClose: () => { dismiss(sessionId); }, title: title, description: description, closeLabel: t('dialog.close'), footer: _jsx(Button, { variant: "primary", onClick: () => { dismiss(sessionId); }, children: t('dialog.close') }) }));
}
//# sourceMappingURL=Dialog.js.map