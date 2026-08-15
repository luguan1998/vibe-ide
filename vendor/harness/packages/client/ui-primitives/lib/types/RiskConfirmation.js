import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Controlled risk acknowledgement dialog shared by product surfaces that
 * must gate a sensitive action behind an explicit checkbox.
 */
import { Button } from "./Button.js";
import { IconWarningOutline16 } from "./icons/index.js";
import { Modal } from "./Modal.js";
import css from './RiskConfirmation.module.css';
/**
 * Render one in-page confirmation whose primary action is unavailable until
 * the caller-controlled acknowledgement is checked.
 */
export function RiskConfirmation({ open, title, description, acknowledgeLabel, cancelLabel, confirmLabel, acknowledged, disabled = false, onAcknowledgedChange, onCancel, onConfirm, }) {
    return (_jsxs(Modal, { open: open, onClose: onCancel, title: title, className: css.confirmation ?? '', contentClassName: css.confirmationContent ?? '', footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", className: css.modalAction, onClick: onCancel, children: cancelLabel }), _jsx(Button, { variant: "primary", className: css.confirmAction, disabled: disabled || !acknowledged, onClick: onConfirm, children: confirmLabel })] })), children: [_jsxs("div", { className: css.warning, children: [_jsx(IconWarningOutline16, { size: 18, className: css.warningIcon }), _jsx("p", { children: description })] }), _jsxs("label", { className: css.acknowledgement, children: [_jsx("input", { type: "checkbox", checked: acknowledged, disabled: disabled, autoFocus: true, onChange: (event) => { onAcknowledgedChange(event.currentTarget.checked); } }), _jsx("span", { children: acknowledgeLabel })] })] }));
}
//# sourceMappingURL=RiskConfirmation.js.map