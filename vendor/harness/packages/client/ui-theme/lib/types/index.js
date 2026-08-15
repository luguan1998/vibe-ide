/** Host registration for the browser theme preference and pre-plugin palette. */
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { injectBootTheme } from "./boot-theme.js";
import { DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema, } from "./theme-settings.js";
export { DEFAULT_PREFERENCE, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE, } from "./theme-settings.js";
const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE);
/** Read the registered preference or use the schema default without a settings provider. */
function readPreference(ctx) {
    const settings = ctx.get('settings');
    if (settings === undefined)
        return DEFAULT_PREFERENCE;
    const section = settings.get(THEME_NAMESPACE);
    if (section === undefined)
        return DEFAULT_PREFERENCE;
    return section.preference;
}
/**
 * Register the durable theme section and initial-theme index transform when
 * their optional Host services are composed.
 * @param ctx - Host context that may acquire settings and HTTP services.
 */
export function apply(ctx) {
    ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema);
    });
    ctx.inject(['webServer'], (httpCtx) => {
        httpCtx.effect(() => httpCtx.webServer.tapIndex(html => injectBootTheme(html, readPreference(ctx))), 'client-ui-theme: initial theme bootstrap');
    });
}
//# sourceMappingURL=index.js.map