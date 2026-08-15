import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from './ModelsSection.module.css';
/**
 * Render one provider card's action row.
 * @param props - the labels, commit gating, and handlers the owning card supplies.
 * @returns the cancel/commit row.
 */
export function EditorFooter(props) {
    const { t } = props;
    return (_jsxs("div", { className: styles['editorActions'], children: [_jsx("button", { type: "button", className: styles['secondaryButton'], disabled: props.busy, onClick: props.onCancel, children: t(props.cancelLabel ?? 'cancel') }), _jsx("button", { type: "button", className: styles['primaryButton'], disabled: props.submitDisabled, onClick: props.onSubmit, children: props.busy ? t(props.submitBusyLabel) : t(props.submitLabel) })] }));
}
//# sourceMappingURL=EditorFooter.js.map