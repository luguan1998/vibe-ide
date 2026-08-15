/** Read-only Host plugin inventory registered into Web Settings. */
import { PluginInventorySettingsTab } from "./PluginInventorySettingsTab.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory';
/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory'];
/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries');
    const t = ctx.locale.bind(NS);
    const list = async () => {
        const result = await ctx.remote.pluginInventory.list();
        if (!result.ok) {
            throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`);
        }
        return result.value;
    };
    const injected = () => ({ list });
    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'all',
        order: 10,
        label: () => t('tab'),
        locale: NS,
        inject: injected,
    }, PluginInventorySettingsTab));
}
//# sourceMappingURL=index.js.map