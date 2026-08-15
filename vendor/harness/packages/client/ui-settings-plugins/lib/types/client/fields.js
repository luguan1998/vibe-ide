import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Hand-written controls for the plugin configuration forms. Each renders one
 * field's label, its staged text, whether saving would leave an override, and
 * — when one stands — the reset that stages a clear back to the composition
 * layer. Nothing here writes: a control reports what the user typed, and the
 * card's save is the single point where a draft becomes a document mutation.
 */
import css from './fields.module.css';
/**
 * A staged value field. `numeric` only hints the keypad: which drafts a field
 * accepts is decided by its spec, so the control never silently rewrites what
 * the user typed.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled control.
 */
export function ValueField(props) {
    return (_jsxs("div", { className: css.field, children: [_jsxs("div", { className: css.head, children: [_jsx("label", { className: css.label, htmlFor: props.id, children: props.label }), props.overridden
                        ? (_jsxs("span", { className: css.badges, children: [_jsx("span", { className: css.badge, children: props.overriddenLabel }), _jsx("button", { type: "button", className: css.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel })] }))
                        : null] }), _jsx("input", { id: props.id, className: props.invalid ? css.inputInvalid : css.input, type: "text", ...props.numeric === true ? { inputMode: 'numeric' } : {}, ...props.invalid ? { 'aria-invalid': true } : {}, value: props.text, placeholder: props.placeholder ?? '', disabled: props.disabled, onChange: (event) => { props.onEdit(event.target.value); } }), _jsx("p", { className: props.invalid ? css.invalid : css.hint, children: props.invalid ? props.invalidLabel : props.hint })] }));
}
/**
 * A write-only credential control. The value never rides a response, so the
 * control reports only whether one is configured and starts blank; a blank
 * draft writes nothing, which keeps the stored key rather than clearing it.
 * @param props - the field's copy, its staged text, and the configured state.
 * @returns the labelled control.
 */
export function SecretField(props) {
    return (_jsxs("div", { className: css.field, children: [_jsxs("div", { className: css.head, children: [_jsx("label", { className: css.label, htmlFor: props.id, children: props.label }), _jsx("span", { className: css.badges, children: _jsx("span", { className: props.configured ? css.badge : css.badgeMuted, children: props.stateLabel }) })] }), _jsx("input", { id: props.id, className: css.input, type: "password", autoComplete: "off", value: props.text, disabled: props.disabled, onChange: (event) => { props.onEdit(event.target.value); } }), _jsx("p", { className: css.hint, children: props.hint })] }));
}
//# sourceMappingURL=fields.js.map