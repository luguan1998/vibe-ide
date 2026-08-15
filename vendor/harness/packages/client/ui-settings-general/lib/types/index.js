/** Host loader entry for the browser implementation exported from `./client`. */
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
/** Durable settings namespace for product-wide GUI onboarding facts. */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding';
const OnboardingSettingsSchema = z.object({
    welcomeNoticeVersion: z.string(),
});
/** Register the durable GUI-onboarding section when a settings provider exists. */
export function apply(ctx) {
    ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.settings.register(settingsNamespace(ONBOARDING_SETTINGS_NAMESPACE), OnboardingSettingsSchema);
    });
}
//# sourceMappingURL=index.js.map