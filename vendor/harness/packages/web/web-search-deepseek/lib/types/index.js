/**
 * Register a DeepSeek-backed provider in `ctx.web`. It calls the Anthropic-compatible Messages API
 * with native `web_search_20250305`. The provider reuses `DEEPSEEK_API_KEY` but not
 * `DEEPSEEK_BASE_URL`, because search and chat-completions use different bases.
 * @module @deepseek-ai/dsh-web-search-deepseek
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { DeepSeekSearchProvider, DEEPSEEK_DEFAULT_API_VERSION, DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_DEFAULT_MAX_TOKENS, DEEPSEEK_DEFAULT_MAX_USES, DEEPSEEK_DEFAULT_MODEL, } from "./provider.js";
export { DeepSeekSearchProvider, DEEPSEEK_DEFAULT_API_VERSION, DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_DEFAULT_MAX_TOKENS, DEEPSEEK_DEFAULT_MAX_USES, DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_PROVIDER_ID, } from "./provider.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-deepseek';
/** The web seam this provider registers into. */
export const inject = ['web'];
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY';
export const Config = z.object({
    apiKey: z.string().role('secret'),
    apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
    // Declared here rather than only at the use site: a configuration surface
    // renders the resolved section, so a default the schema does not carry reads
    // there as no value at all.
    baseURL: z.string(),
    model: z.string().default(DEEPSEEK_DEFAULT_MODEL),
    apiVersion: z.string().default(DEEPSEEK_DEFAULT_API_VERSION),
    maxTokens: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_TOKENS),
    maxUses: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_USES),
});
/**
 * Environment variable naming this provider's endpoint. Deliberately distinct
 * from `$DEEPSEEK_BASE_URL`, which belongs to the chat-completions adapter:
 * search speaks the Anthropic-compatible Messages API, so one variable cannot
 * serve both.
 */
const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL';
/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE = settingsNamespace('web-search-deepseek');
/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx, config) {
    const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
    const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
        ? config.apiKey
        : undefined;
    return {
        ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
        resolveApiKey: async () => {
            const credentials = ctx.get('credentials');
            if (credentials !== undefined)
                return (await credentials.resolve(apiKeyEnv))?.value;
            // Without the seam the environment is the whole credential plane.
            const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
            return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
        },
        apiKeyEnv,
        baseURL: config.baseURL
            ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
            ?? DEEPSEEK_DEFAULT_BASE_URL,
        model: config.model ?? DEEPSEEK_DEFAULT_MODEL,
        apiVersion: config.apiVersion ?? DEEPSEEK_DEFAULT_API_VERSION,
        maxTokens: config.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
        maxUses: config.maxUses ?? DEEPSEEK_DEFAULT_MAX_USES,
        recordRequest: (request) => {
            ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', request);
        },
    };
}
/** Register the DeepSeek search provider with `ctx.web`. */
export function apply(ctx, config) {
    let current = () => config;
    installSettingsSection(ctx, WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE, Config, config, {
        setSource: (source) => {
            current = source;
        },
        // The registration carries no resolved value: the provider projects the
        // section per search, so a committed change needs no re-registration.
        onChange: () => { },
    });
    ctx.web.registerSearchProvider(new DeepSeekSearchProvider(() => resolveOptions(ctx, current())));
}
//# sourceMappingURL=index.js.map