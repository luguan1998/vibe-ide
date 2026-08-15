import { jsx as _jsx } from "react/jsx-runtime";
import css from './PluginsSettingsSection.module.css';
/** Render cards registered by plugins that expose editable settings. */
export function ConfigurablePluginsTab({ t, renderSlot, cardCount }) {
    return cardCount === 0
        ? _jsx("p", { className: css.empty, children: t('empty') })
        : _jsx("ul", { className: css.cards, children: renderSlot('settings.plugin.item', {}) });
}
//# sourceMappingURL=ConfigurablePluginsTab.js.map