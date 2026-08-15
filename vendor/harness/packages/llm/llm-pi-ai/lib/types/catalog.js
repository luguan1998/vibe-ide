/**
 * Materialization of one provider route's model catalog. The installed pi-ai
 * catalog supplies defaults keyed by model id, and a profile's own model
 * entries override them field by field, so a route naming a catalog provider
 * stays configuration-free while a route pi-ai has never heard of is fully
 * describable from `settings.yaml`.
 *
 * Every pi-ai `Model` field the harness cannot default is required here rather
 * than at request time: an unserviceable route fails while its configuration is
 * being resolved, which is the earliest point that can name the offending key.
 *
 * @module dsh-llm-pi-ai/catalog
 */
import { builtinProviders, getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
/**
 * Pricing for a model the installed catalog does not describe. The harness
 * never reads pi-ai's cost metadata — `replay.ts` zeroes it and no consumer
 * reports spend — so this is the absence of a fact, not a configurable rate.
 */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
/**
 * Every pi-ai request modality. The `Record` key type is a drift gate: a pi-ai
 * upgrade that adds or removes a modality fails compilation here naming the
 * drifted key, instead of silently narrowing what a profile may declare.
 */
const MODALITY_GATE = {
    text: true,
    image: true,
};
/** Every request modality a profile may declare. */
export const MODALITIES = Object.keys(MODALITY_GATE);
/**
 * One entry's modality list, or `undefined` when it states no answer. Absent
 * and empty mean the same thing — `[]` describes a model that accepts nothing
 * and could serve no request — which is what makes an entry naming a catalog
 * model without declaring modalities keep the catalog's, since the config
 * schema materializes `[]` for an absent array.
 * @param configured - the list a `models` or `modelOverrides` entry supplied.
 * @returns the declared modalities, or `undefined` to ask the next level.
 */
function declaredInput(configured) {
    return configured === undefined || configured.length === 0 ? undefined : [...configured];
}
/**
 * Every pi-ai thinking level, in pi-ai's canonical escalation order. The
 * `Record` key type is a drift gate: a pi-ai upgrade that adds or removes a
 * level fails compilation here naming the drifted key, instead of silently
 * narrowing what a profile may declare.
 */
const THINKING_LEVEL_GATE = {
    off: true,
    minimal: true,
    low: true,
    medium: true,
    high: true,
    xhigh: true,
    max: true,
};
/** Every pi-ai thinking level a profile may declare, in escalation order. */
export const THINKING_LEVELS = Object.keys(THINKING_LEVEL_GATE);
/**
 * The nameable reasoning-dispatch formats, most-reached first. The `Record`
 * key type is a drift gate: a pi-ai upgrade that adds a format (0.84 added
 * `baseten`) fails compilation here until the format is classified as offered
 * here or withheld above, so the offer never silently lags the upstream set.
 */
const THINKING_FORMAT_GATE = {
    'openai': true,
    'deepseek': true,
    'openrouter': true,
    'together': true,
    'zai': true,
    'qwen': true,
    'string-thinking': true,
    'ant-ling': true,
};
/** Reasoning-dispatch wire formats a profile may name, most-reached first. */
export const SUPPORTED_THINKING_FORMATS = Object.keys(THINKING_FORMAT_GATE);
let providerIndex;
/**
 * Installed catalog providers by id, constructed once. Each entry owns the API
 * implementations for its own models, which is why a catalog route reuses this
 * provider instead of being rebuilt from parts.
 * @returns the catalog provider index.
 */
function catalogProviders() {
    providerIndex ??= new Map(builtinProviders().map(provider => [provider.id, provider]));
    return providerIndex;
}
/**
 * The installed catalog provider for one route, when pi-ai ships one.
 * @param provider - provider route key.
 * @returns the catalog provider, or `undefined` for a route pi-ai does not ship.
 */
export function catalogProvider(provider) {
    return catalogProviders().get(provider);
}
/**
 * Every provider route the installed pi-ai catalog ships.
 * @returns the catalog provider ids.
 */
export function catalogProviderIds() {
    return getBuiltinProviders();
}
/**
 * Whether the installed catalog provider for one route declares an api-key
 * method — the only authentication this adapter obtains on its own.
 *
 * A key is what the harness resolves through its own credential seam and hands
 * pi-ai per request. pi-ai's other method, OAuth, resolves from a *stored*
 * OAuth credential alone: `resolveProviderAuth` has no ambient path for it,
 * this adapter builds its `Models` collection with no credential store, and
 * nothing here runs a login flow. So a provider offering OAuth by itself
 * leaves nothing for this adapter to authenticate with, and the posture such a
 * provider invites — no key configured, credentials discovered by the provider
 * — fails every request with `Provider is not configured`.
 * @param provider - provider route key.
 * @returns whether the catalog provider takes an api key; false for a route
 *   pi-ai does not ship, which the caller answers for separately.
 */
export function catalogProviderTakesApiKey(provider) {
    return catalogProvider(provider)?.auth.apiKey !== undefined;
}
/**
 * The installed catalog models for one route, indexed by model id.
 * @param provider - provider route key.
 * @returns catalog models by id; empty for a route pi-ai does not ship.
 */
export function catalogModels(provider) {
    if (!catalogProviders().has(provider))
        return new Map();
    const models = getBuiltinModels(provider);
    return new Map(models.map(model => [model.id, model]));
}
/** Report a route the deployment cannot serve, naming the settings key at fault. */
function invalid(provider, detail) {
    throw new Error(`llm-pi-ai: provider "${provider}" ${detail}`);
}
/**
 * The one wire protocol a catalog route's shipped models agree on. This is what
 * lets a deployment add a model the installed catalog has not caught up with —
 * a provider's newest release — without restating the protocol its siblings
 * already use. A route whose shipped models disagree (an OpenAI-style catalog
 * spanning Responses and Chat Completions) has no such answer, so a model it
 * does not describe must name its protocol at the route.
 */
function sharedCatalogApi(defaults) {
    const apis = new Set();
    for (const model of defaults.values())
        apis.add(model.api);
    return apis.size === 1 ? [...apis][0] : undefined;
}
/**
 * Resolve one model's reasoning capability from its declared efforts.
 *
 * A declared dict translates to pi-ai's `thinkingLevelMap` with every level
 * decided explicitly: declared levels carry their wire spelling, undeclared
 * levels are pinned to `null` (unsupported). Pinning matters because pi-ai's
 * own defaulting is asymmetric — an absent key means "supported" for the five
 * base levels but "unsupported" for `xhigh`/`max` — and a profile author
 * should not need to know that. A declared `off` with no value is the one
 * exception: it stays absent from the map, which pi-ai reads as "supported,
 * send nothing" — the correct dispatch where not thinking is the parameter's
 * absence — while `off` with a value sends that value.
 * @param provider - provider route key, for diagnostics.
 * @param entry - the configured model entry.
 * @param base - the installed catalog entry of the same id, when one exists.
 * @returns the reasoning fields the materialized model carries.
 */
function resolveModelReasoning(provider, entry, base) {
    const efforts = entry.reasoningEfforts;
    if (efforts === undefined) {
        // Reasoning rides the installed entry or is absent: a bare capability flag
        // would make pi-ai advertise effort levels with no `thinkingLevelMap` to
        // spell them, and no listing endpoint reports a model's reasoning
        // protocol. The entry's map (when any) arrives through the `...base`
        // spread in the model literal.
        return { reasoning: base?.reasoning ?? false };
    }
    // The installed entry's map may ride along through `...base`; pi-ai never
    // reads it on a non-reasoning model, so stripping it is not worth a field
    // enumeration here.
    if (efforts === false)
        return { reasoning: false };
    // A YAML `reasoningEfforts:` left valueless arrives as null through the
    // schema union — outside the field's declared type, hence the widening —
    // while an explicit `{}` arrives as an empty dict. Both declare nothing,
    // and neither is a spelling of "inherit" or "disable".
    if (efforts === null || Object.keys(efforts).length === 0) {
        invalid(provider, `model "${entry.id}" has an empty reasoningEfforts; declare the offered levels, set`
            + ' false for a non-reasoning model, or omit the field to keep the installed catalog\'s capability');
    }
    const declared = THINKING_LEVELS.flatMap((level) => {
        const wire = efforts[level];
        return wire === undefined ? [] : [[level, wire]];
    });
    for (const [level, wire] of declared) {
        if (wire === null) {
            if (level !== 'off') {
                invalid(provider, `model "${entry.id}" reasoningEfforts.${level} needs the wire value dispatch`
                    + ' should send; only "off" may leave it empty');
            }
        }
        else if (wire.length === 0) {
            invalid(provider, `model "${entry.id}" reasoningEfforts.${level} must not be an empty string`);
        }
    }
    if (!declared.some(([level]) => level !== 'off')) {
        invalid(provider, `model "${entry.id}" reasoningEfforts offers no level beyond "off"; declare a thinking`
            + ' level, or set reasoningEfforts to false for a non-reasoning model');
    }
    const map = {};
    for (const level of THINKING_LEVELS) {
        const wire = efforts[level];
        if (wire === undefined) {
            map[level] = null;
        }
        else if (wire !== null) {
            map[level] = wire;
        }
    }
    return { reasoning: true, thinkingLevelMap: map };
}
/**
 * Resolve one model's compat block from the profile's reasoning switches.
 *
 * A model switch wins over the route switch; whatever neither sets keeps the
 * installed entry's value, and a field no layer decides falls through to
 * pi-ai's baseURL-derived detection. Only an `openai-completions` model takes
 * the switches at all: a model-level switch on any other protocol fails
 * resolution, while a route-level default skips past such models — the same
 * posture as the route-level `reasoning` default, which also must not fail
 * models it does not fit.
 * @param provider - provider route key, for diagnostics.
 * @param entry - the configured model entry.
 * @param route - the route-level switches, when any.
 * @param base - the installed catalog entry of the same id, when one exists.
 * @param api - the model's resolved wire protocol.
 * @returns a `compat` field to spread into the model, or nothing.
 */
function resolveModelCompat(provider, entry, route, base, api) {
    const thinkingFormat = entry.compat?.thinkingFormat ?? route?.thinkingFormat;
    const supportsReasoningEffort = entry.compat?.supportsReasoningEffort ?? route?.supportsReasoningEffort;
    if (thinkingFormat === undefined && supportsReasoningEffort === undefined)
        return {};
    if (api !== 'openai-completions') {
        if (entry.compat?.thinkingFormat !== undefined || entry.compat?.supportsReasoningEffort !== undefined) {
            invalid(provider, `model "${entry.id}" sets compat reasoning switches, but its api is "${api}";`
                + ' thinkingFormat and supportsReasoningEffort exist only on openai-completions');
        }
        return {};
    }
    // The installed entry's compat matches the entry's OWN api — a route-level
    // `api` repoint (an anthropic catalog served through an OpenAI-compatible
    // gateway) leaves `base.compat` in the other protocol's shape, so it is
    // inherited only while the resolved api still is the entry's. A repointed
    // model starts from pi-ai's baseURL-derived detection instead, which is
    // what a protocol change means for every other compat field too.
    const inherited = base?.api === api ? base.compat : undefined;
    return {
        compat: {
            ...inherited,
            ...thinkingFormat === undefined ? {} : { thinkingFormat },
            ...supportsReasoningEffort === undefined ? {} : { supportsReasoningEffort },
        },
    };
}
/**
 * Materialize one route's catalog by merging the installed catalog defaults
 * under the configured entries. A route with no configured `models` serves the
 * installed catalog unchanged, which is what keeps an existing
 * `providers: { deepseek: { apiKeyEnv: … } }` profile working untouched.
 * @param request - the route-level catalog facts.
 * @returns the materialized models and the explicitly configured request caps.
 */
export function resolveRouteModels(request) {
    const { provider } = request;
    const defaults = catalogModels(provider);
    const providerBaseUrl = catalogProvider(provider)?.baseUrl;
    // An absent `models` key and an empty one are the same request: the config
    // schema materializes `[]` for the absent case, and an empty catalog could
    // serve no request anyway, so both mean "serve the installed catalog".
    const configured = request.models ?? [];
    const overrides = request.modelOverrides ?? {};
    // Every miss is refused, never skipped: an override that lands nowhere is a
    // typo someone would otherwise hunt for in a silently unchanged model.
    for (const [id, override] of Object.entries(overrides)) {
        if (id.length === 0)
            invalid(provider, 'has a modelOverrides entry with an empty model id');
        if (defaults.size === 0) {
            invalid(provider, `sets modelOverrides for "${id}", but the installed catalog does not describe this route;`
                + ' a declared route spells every model out in its models list');
        }
        if (configured.length > 0) {
            invalid(provider, `sets modelOverrides for "${id}" beside a models list; models already replaces the served`
                + ' catalog, so declare the fields on its entries');
        }
        if (!defaults.has(id)) {
            invalid(provider, `modelOverrides names "${id}", which the installed catalog does not describe`);
        }
        // The id lives in the dict key; a value carrying its own would quietly
        // rename the model it meant to customize. The static shape already omits
        // it — this guards the schema boundary, which passes unknown keys through.
        if ('id' in override) {
            invalid(provider, `modelOverrides entry "${id}" sets "id", which is the dict key`);
        }
    }
    // An override becomes the catalog entry's configuration, so everything a
    // models entry may declare — capacities, efforts, compat — resolves through
    // the same path with the same diagnostics and request-default semantics.
    const entries = configured.length > 0
        ? configured
        : [...defaults.values()].map(model => ({ id: model.id, ...overrides[model.id] }));
    if (entries.length === 0) {
        invalid(provider, 'resolves no models; the installed catalog does not describe this route, so its models'
            + ' must be listed in configuration');
    }
    const routeApi = sharedCatalogApi(defaults);
    const routeCompatDefined = request.compat?.thinkingFormat !== undefined
        || request.compat?.supportsReasoningEffort !== undefined;
    const seen = new Set();
    const configuredMaxTokens = new Map();
    const models = entries.map((entry) => {
        if (entry.id.length === 0)
            invalid(provider, 'has a model with an empty id');
        if (seen.has(entry.id))
            invalid(provider, `lists model "${entry.id}" more than once`);
        seen.add(entry.id);
        const base = defaults.get(entry.id);
        const api = request.api ?? base?.api ?? routeApi;
        if (api === undefined) {
            invalid(provider, `model "${entry.id}" needs an api; the installed catalog does not describe it, so set the`
                + ' route\'s api to the wire protocol its endpoint speaks');
        }
        const baseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl;
        if (baseUrl === undefined) {
            invalid(provider, `model "${entry.id}" needs a baseURL; the installed catalog does not describe this route`);
        }
        // Capacities fall back to the route's own defaults, so a model listing that
        // discloses nothing but ids still yields a serviceable route. The fallback
        // is a guess by construction, which is why it is a configurable route field
        // rather than a constant buried here.
        const contextWindow = entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow;
        if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
            invalid(provider, `model "${entry.id}" contextWindow must be a positive integer`);
        }
        const maxTokens = entry.maxTokens ?? base?.maxTokens ?? request.defaultMaxTokens;
        if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
            invalid(provider, `model "${entry.id}" maxTokens must be a positive integer`);
        }
        // Only a value the profile named is a deployment choice; the catalog's is
        // the model's capability and stays out of request defaults.
        if (entry.maxTokens !== undefined)
            configuredMaxTokens.set(entry.id, entry.maxTokens);
        return {
            // The installed entry lays the floor, and the fields below override it.
            // Enumerating instead would silently drop every `Model` field this
            // package does not model — reasoning-level spellings, compatibility
            // quirks, model headers, and whatever a pi-ai upgrade adds next. Spread,
            // never enumerate.
            ...base,
            id: entry.id,
            name: entry.name ?? base?.name ?? entry.id,
            api,
            provider,
            baseUrl,
            input: declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput],
            cost: base?.cost ?? NO_COST,
            contextWindow,
            maxTokens,
            ...resolveModelReasoning(provider, entry, base),
            ...resolveModelCompat(provider, entry, request.compat, base, api),
        };
    });
    if (routeCompatDefined && !models.some(model => model.api === 'openai-completions')) {
        invalid(provider, 'sets compat reasoning switches, but no model on the route speaks openai-completions;'
            + ' thinkingFormat and supportsReasoningEffort exist only on that protocol');
    }
    return { models, configuredMaxTokens };
}
//# sourceMappingURL=catalog.js.map