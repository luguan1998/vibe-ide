/** Locale preference stored in the Host user-settings document. */
import z from '@deepseek-ai/schemastery';
/** Settings namespace owned by the locale plugin. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale';
/** Field carrying an explicit locale selection; absence delegates to the browser. */
export const LOCALE_PREFERENCE_FIELD = 'preference';
/** Locale identifiers shipped by the browser client. */
export const LOCALE_IDS = ['zh', 'en'];
/** Durable locale schema; also the wire envelope the browser scope validates against. */
export const LocaleSettingsSchema = z.object({
    [LOCALE_PREFERENCE_FIELD]: z.union([...LOCALE_IDS]).required(false),
});
//# sourceMappingURL=locale-settings.js.map