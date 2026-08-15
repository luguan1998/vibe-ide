import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ValueField } from "./fields.js";
import { PluginCard } from "./PluginCard.js";
/**
 * Render the shell card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function BashCard(props) {
    const { t } = props;
    const state = props.useBashCard(snapshot => snapshot);
    const disabled = !state.writable;
    return (_jsxs(PluginCard, { t: t, titleKey: "bashTitle", descriptionKey: "bashDescription", state: state, onSave: props.save, onDiscard: props.discard, children: [_jsx(ValueField, { id: "plugin-config-bash-timeout", label: t('bashTimeoutMs'), hint: t('bashTimeoutMsHint'), overriddenLabel: t('overridden'), resetLabel: t('reset'), invalidLabel: t('invalidNumber'), numeric: true, disabled: disabled, ...state.timeoutMs, onEdit: (text) => { props.edit('timeoutMs', text); }, onReset: () => { props.resetField('timeoutMs'); } }), _jsx(ValueField, { id: "plugin-config-bash-output", label: t('bashMaxOutputBytes'), hint: t('bashMaxOutputBytesHint'), overriddenLabel: t('overridden'), resetLabel: t('reset'), invalidLabel: t('invalidNumber'), numeric: true, disabled: disabled, ...state.maxOutputBytes, onEdit: (text) => { props.edit('maxOutputBytes', text); }, onReset: () => { props.resetField('maxOutputBytes'); } })] }));
}
//# sourceMappingURL=BashCard.js.map