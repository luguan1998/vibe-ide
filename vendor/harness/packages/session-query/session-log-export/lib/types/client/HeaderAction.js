import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { SessionLogDownloadDialog } from "./Dialog.js";
import css from './HeaderAction.module.css';
/**
 * Render the Session Header export capsule and its shared result dialog.
 * @param props - Session runtime, download controller, and localized dialog copy.
 * @returns the persistent Header action and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props) {
    const { sessionId, useSessionLogDownload, request } = props;
    const entry = useSessionLogDownload(state => state.bySession[String(sessionId)]);
    const busy = entry?.status === 'downloading';
    return (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: css.sessionLogButton, disabled: busy, "aria-busy": busy, onClick: () => { void request(sessionId); }, children: [_jsx("span", { children: "Session log" }), _jsx(IconDownloadOutline16, { size: 12 })] }), _jsx(SessionLogDownloadDialog, { ...props })] }));
}
//# sourceMappingURL=HeaderAction.js.map