import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The preset picker both surfaces render: a menu of presets over a button
 * naming the current one.
 *
 * The settings row and the composer seat differ in where they sit, what they
 * call the current value, and when they refuse a pick — not in how the picker
 * itself behaves. Trust is the one thing the list always says: a locally
 * authored preset is exactly as privileged as the plugins it names, so the
 * label marks it rather than presenting every preset as shipped and vetted.
 */
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import { presetDisplayText } from "./locales.js";
/**
 * Render the preset picker.
 * @param props - the calling surface's copy, styling, and handlers.
 * @returns the menu and its trigger.
 */
export function PresetMenu({ options, selectedId, label, t, buttonClassName, chevronClassName, disabled, open, onOpenChange, onSelect, }) {
    return (_jsx(Menu, { open: open, onClose: () => { onOpenChange(false); }, items: options.map((option) => {
            const name = presetDisplayText(option, t).name;
            return {
                id: option.id,
                // All preset surfaces resolve copy the same way; the id is addressing,
                // not a label, except where no display name exists.
                label: option.trust === 'user' ? `${name} · ${t('userTrust')}` : name,
            };
        }), selectedId: selectedId, onSelect: (id) => {
            onOpenChange(false);
            onSelect(id);
        }, align: "end", portal: true, anchor: (_jsxs("button", { type: "button", className: buttonClassName, "aria-haspopup": "menu", "aria-expanded": open, disabled: disabled, onClick: () => { onOpenChange(!open); }, children: [label, _jsx(IconChevronDownOutline14, { className: chevronClassName })] })) }));
}
//# sourceMappingURL=PresetMenu.js.map