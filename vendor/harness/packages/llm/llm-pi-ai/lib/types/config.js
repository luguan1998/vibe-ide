/**
 * Configuration schema and provider-profile validation for the pi-ai adapter.
 * Profiles are a dict keyed by provider route, so the composition base and a
 * user-settings layer merge per provider and the route set is structural.
 *
 * A route key is not required to name an installed pi-ai provider. When it does,
 * that provider's endpoint, protocol, display name, and model catalog are the
 * profile's defaults and the profile overrides them field by field; when it does
 * not, the profile is the whole provider declaration. Resolution therefore ends
 * in a built pi-ai `Provider` per route: everything a request needs is decided
 * once, while the configuration key that made a route unserviceable can still be
 * named in the failure.
 *
 * @module dsh-llm-pi-ai/config
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm';
import { MODALITIES, resolveRouteModels, SUPPORTED_THINKING_FORMATS, THINKING_LEVELS } from "./catalog.js";
import { buildProvider, supportedProtocols } from "./provider.js";
/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;
/** Context capacity assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_CONTEXT_WINDOW = 262_144;
/** Output capability assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_MAX_TOKENS = 32_768;
/**
 * Modalities assumed for a model neither configuration nor the catalog
 * declares. Text is the floor every supported protocol certainly carries, so
 * this is the absence of a declaration rather than a guess at the endpoint:
 * nothing can interrogate a gateway for its modalities, and the two wrong
 * answers do not cost the same. Under-claiming refuses the image before it is
 * attached, naming the model. Over-claiming admits one the provider then
 * rejects mid-turn, after the message is durable, leaving the session
 * repeating a request that cannot succeed.
 */
export const DEFAULT_INPUT = ['text'];
const thinkingBudgets = z.object({
    minimal: z.number(),
    low: z.number(),
    medium: z.number(),
    high: z.number(),
});
const compatProfile = z.object({
    thinkingFormat: z.union(SUPPORTED_THINKING_FORMATS),
    supportsReasoningEffort: z.boolean(),
});
/**
 * Keys are the offered levels, values their wire spellings. A valueless key
 * (`off:`) survives validation because schemastery passes nullable data
 * through before any member schema runs — `z.const(null)` only controls the
 * error for non-null wrong values and what a configuration UI renders.
 * Only resolution decides which levels may leave the value empty, so the
 * diagnostic can name the route and model. The assertion narrows
 * schemastery's `Dict`, which types every literal key as required; dict
 * validation checks only present keys, so the runtime value is a partial record.
 */
const reasoningEfforts = z.dict(z.union([z.string(), z.const(null)]), z.union(THINKING_LEVELS));
/** The fields a `models` entry and a `modelOverrides` value share; only the id's home differs. */
const modelFields = {
    name: z.string(),
    contextWindow: z.number().step(1).min(1),
    maxTokens: z.number().step(1).min(1),
    // No explicit default, unlike the route's `defaultInput`: schemastery
    // materializes `[]` for an absent array, and resolution reads that as "no
    // answer here" so the catalog entry below still applies.
    input: z.array(z.union(MODALITIES)),
    // The union, not a bare dict: schemastery materializes an absent dict as
    // `{}`, and absent must stay distinguishable — it means "inherit the
    // installed catalog's capability", while `false` disables reasoning.
    reasoningEfforts: z.union([z.const(false), reasoningEfforts]),
    compat: compatProfile,
};
const modelProfile = z.object({
    id: z.string().required(),
    ...modelFields,
});
/** A {@link modelProfile} whose id lives in the `modelOverrides` dict key. */
const modelOverride = z.object(modelFields);
const profile = z.object({
    apiKeyEnv: z.string().role('credential-ref'),
    displayName: z.string(),
    api: z.union(supportedProtocols()),
    baseURL: z.string(),
    models: z.array(modelProfile),
    modelOverrides: z.dict(modelOverride),
    compat: compatProfile,
    defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
    defaultMaxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
    defaultInput: z.array(z.union(MODALITIES)).default([...DEFAULT_INPUT]),
    headers: z.dict(z.string()),
    reasoning: z.union(THINKING_LEVELS),
    thinkingBudgets,
    cacheRetention: z.union(['none', 'short', 'long']),
    transport: z.union(['sse', 'websocket', 'websocket-cached', 'auto']),
    timeoutMs: z.natural(),
    websocketConnectTimeoutMs: z.natural(),
    streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
    retryPolicy: RetryPolicySchema,
});
/** Runtime schema for {@link Config}. */
export const Config = z.object({
    providers: z.dict(profile).default({}),
});
/**
 * Reject a section this adapter could not serve. Registered as the settings
 * namespace's validator, so an unserviceable profile is refused where it is
 * *written* — `settings.mutate` answers `settings-rejected` with the offending
 * route and model named — instead of being stored and then quietly disabling
 * every route in the namespace. It stays a validator rather than a schema
 * transform because the schema is also the shape a configuration surface
 * renders and the value an absent section resolves to; wrapping it would break
 * both.
 * @param config - the resolved section to check.
 * @throws Error naming the route and model that cannot be served.
 */
export function assertServiceable(config) {
    resolveProfiles(config.providers);
}
/** Reject removed pre-release profile fields and name their replacements. */
function rejectRemovedFields(provider, source) {
    const legacy = source;
    if ('provider' in legacy) {
        throw new Error(`llm-pi-ai: provider "${provider}" sets "provider", which moved to the providers dict key`);
    }
    if ('maxRetries' in legacy || 'maxRetryDelayMs' in legacy) {
        throw new Error(`llm-pi-ai: provider "${provider}" sets maxRetries or maxRetryDelayMs, which were removed;`
            + ' compose agent recovery with dsh-llm-retry');
    }
}
/**
 * Validate profiles and return a detached route-keyed map suitable for
 * per-request reads. This is the one explicit resolve step, so an omitted dict
 * resolves to the empty (dormant) route set here rather than through a hidden
 * fallback, and each route's models and pi-ai provider are materialized once.
 * @param providers - configured provider profiles keyed by route.
 * @returns validated profiles in configuration order.
 */
export function resolveProfiles(providers) {
    if (Array.isArray(providers)) {
        throw new Error('llm-pi-ai: providers is now a dict keyed by provider route, not an array of profiles');
    }
    const entries = Object.entries(providers ?? {});
    const resolved = new Map();
    for (const [provider, source] of entries) {
        rejectRemovedFields(provider, source);
        if (provider.length === 0)
            throw new Error('llm-pi-ai: provider names must be non-empty');
        if (source.baseURL !== undefined && source.baseURL.length === 0) {
            throw new Error(`llm-pi-ai: provider "${provider}" has an empty baseURL`);
        }
        if (source.displayName !== undefined && source.displayName.length === 0) {
            throw new Error(`llm-pi-ai: provider "${provider}" has an empty displayName`);
        }
        const streamIdleTimeoutMs = source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
        if (!Number.isFinite(streamIdleTimeoutMs)
            || streamIdleTimeoutMs <= 0
            || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
            throw new Error(`llm-pi-ai: provider "${provider}" streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
        }
        // Detached from the configuration object because pi-ai types `Model.input`
        // mutable. The schema's explicit default covers an absent key, so an empty
        // list here is always one someone typed — and unlike an entry's, nothing
        // below it can answer instead — so it is refused rather than read as "no
        // answer".
        const defaultInput = [...source.defaultInput ?? DEFAULT_INPUT];
        if (defaultInput.length === 0) {
            throw new Error(`llm-pi-ai: provider "${provider}" defaultInput must name at least one modality`);
        }
        // The route key, not the installed provider's own name: the directory has
        // always shown route keys, and a catalog route must not silently rename
        // itself on every configuration surface just because it gained a profile.
        const displayName = source.displayName ?? provider;
        const catalog = resolveRouteModels({
            provider,
            ...source.api === undefined ? {} : { api: source.api },
            ...source.baseURL === undefined ? {} : { baseURL: source.baseURL },
            ...source.models === undefined ? {} : { models: source.models },
            ...source.modelOverrides === undefined ? {} : { modelOverrides: source.modelOverrides },
            ...source.compat === undefined ? {} : { compat: source.compat },
            defaultInput,
            defaultContextWindow: source.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
            defaultMaxTokens: source.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
        });
        const { apiKeyEnv, retryPolicy, models: _models, displayName: _displayName, ...rest } = source;
        resolved.set(provider, {
            ...rest,
            provider,
            displayName,
            ...apiKeyEnv === undefined ? {} : { apiKeyEnv: credentialRef(apiKeyEnv) },
            streamIdleTimeoutMs,
            retryPolicy: resolveRetryPolicy(retryPolicy, `llm-pi-ai: provider "${provider}" retryPolicy`),
            ...rest.headers === undefined ? {} : { headers: { ...rest.headers } },
            ...rest.thinkingBudgets === undefined ? {} : { thinkingBudgets: { ...rest.thinkingBudgets } },
            configuredMaxTokens: catalog.configuredMaxTokens,
            piProvider: buildProvider({
                provider,
                displayName,
                ...source.api === undefined ? {} : { api: source.api },
                ...source.baseURL === undefined ? {} : { baseURL: source.baseURL },
                models: catalog.models,
                namesCredential: apiKeyEnv !== undefined,
            }),
        });
    }
    return resolved;
}
//# sourceMappingURL=config.js.map