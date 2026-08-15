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
import type { Api, Model, ModelThinkingLevel, OpenAICompletionsCompat, Provider } from '@earendil-works/pi-ai';
/** One request modality a pi-ai model may accept. */
export type PiAiModality = Model<Api>['input'][number];
/** Every request modality a profile may declare. */
export declare const MODALITIES: readonly PiAiModality[];
/** Every pi-ai thinking level a profile may declare, in escalation order. */
export declare const THINKING_LEVELS: readonly ModelThinkingLevel[];
/** The `compat.thinkingFormat` spellings pi-ai accepts on an `openai-completions` model. */
type PiThinkingFormat = NonNullable<OpenAICompletionsCompat['thinkingFormat']>;
/**
 * pi-ai thinking formats a profile cannot name: both drive the request through
 * `chatTemplateKwargs`, which this configuration does not expose.
 */
type WithheldThinkingFormat = 'chat-template' | 'qwen-chat-template';
/** One reasoning-dispatch wire format a profile may name. */
export type PiAiThinkingFormat = Exclude<PiThinkingFormat, WithheldThinkingFormat>;
/** Reasoning-dispatch wire formats a profile may name, most-reached first. */
export declare const SUPPORTED_THINKING_FORMATS: readonly PiAiThinkingFormat[];
/**
 * The installed catalog provider for one route, when pi-ai ships one.
 * @param provider - provider route key.
 * @returns the catalog provider, or `undefined` for a route pi-ai does not ship.
 */
export declare function catalogProvider(provider: string): Provider | undefined;
/**
 * Every provider route the installed pi-ai catalog ships.
 * @returns the catalog provider ids.
 */
export declare function catalogProviderIds(): readonly string[];
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
export declare function catalogProviderTakesApiKey(provider: string): boolean;
/**
 * The installed catalog models for one route, indexed by model id.
 * @param provider - provider route key.
 * @returns catalog models by id; empty for a route pi-ai does not ship.
 */
export declare function catalogModels(provider: string): Map<string, Model<Api>>;
/**
 * Selectable reasoning efforts for one model: each key is a level the model
 * offers (and selectors show), and its value is the wire spelling dispatch
 * sends for it. `off` alone may leave its value empty — "supported, send
 * nothing" — because for most providers not thinking is the parameter's
 * absence; every other declared level must name a wire value. A level absent
 * from the dict is not offered.
 */
export type PiAiReasoningEfforts = Partial<Record<ModelThinkingLevel, string | null>>;
/**
 * Reasoning-dispatch compatibility switches, set on the route (its models'
 * default) or per model (winning over the route). Only the switches pi-ai's
 * reasoning dispatch reads are offered; the rest of pi-ai's compat surface
 * keeps its baseURL-derived auto-detection. pi-ai types both fields only on
 * `OpenAICompletionsCompat` — the other wire protocols define their reasoning
 * fields in the protocol itself — so resolution rejects a model-level switch
 * anywhere else, while a route-level default skips past models it cannot fit.
 */
export interface PiAiCompatProfile {
    /** Reasoning parameter format the endpoint expects; absent keeps the catalog entry's, then pi-ai's baseURL-derived guess. */
    thinkingFormat?: PiAiThinkingFormat;
    /** Whether the endpoint accepts `reasoning_effort`; absent keeps the catalog entry's, then pi-ai's baseURL-derived guess. */
    supportsReasoningEffort?: boolean;
}
/** One configured model entry: an id plus the catalog fields it overrides. */
export interface PiAiModelProfile {
    /** Model id sent to the provider and accepted by {@link GenerateOptions.model}. */
    id: string;
    /** Display name for selectors; defaults to the catalog name, then the id. */
    name?: string;
    /** Maximum combined request and response context in tokens. */
    contextWindow?: number;
    /**
     * Maximum output tokens. Configuring one also makes it this model's
     * per-request default; a value inherited from the installed catalog, or the
     * route's fallback, is the model's capability and never becomes a request
     * default on its own.
     */
    maxTokens?: number;
    /**
     * Request modalities this model accepts. Absent — or empty, which describes
     * a model that accepts nothing and so states no answer either — keeps the
     * installed catalog entry's modalities, then the route's `defaultInput`.
     * Declaring images is what makes a hand-declared vision model usable, and
     * declaring text alone corrects a catalog model whose gateway does not serve
     * what the catalog records. This is a claim about the endpoint, not a check
     * of it: nothing interrogates a gateway for what it accepts, so a model
     * claiming images its endpoint refuses is refused by the provider instead,
     * mid-turn.
     */
    input?: PiAiModality[];
    /**
     * Selectable reasoning efforts. Absent inherits the installed catalog
     * entry's capability (a hand-declared model has none and does not reason);
     * `false` declares a non-reasoning model, which is how a profile strips
     * reasoning from a catalog model its gateway cannot serve; a non-empty dict
     * declares the offered levels and their wire spellings.
     */
    reasoningEfforts?: false | PiAiReasoningEfforts;
    /** Reasoning-dispatch switches for this model, winning over the route's. */
    compat?: PiAiCompatProfile;
}
/**
 * Customization of one installed catalog model, keyed by its id in the
 * route's `modelOverrides` dict — the same fields a `models` entry may set,
 * with the id living in the key. Unlike a `models` list, overrides leave the
 * rest of the catalog serving untouched, which is what makes "correct one
 * model, keep the other thirty-seven" a three-line edit.
 */
export type PiAiModelOverride = Omit<PiAiModelProfile, 'id'>;
/** The route-level facts model materialization reads. */
export interface RouteCatalogRequest {
    /** Provider route key, stamped onto every materialized model. */
    provider: string;
    /** Wire protocol override; absent defers to each catalog model's own API. */
    api?: string;
    /** Endpoint override; absent defers to the catalog model, then the catalog provider. */
    baseURL?: string;
    /** Configured catalog; absent means the whole installed catalog for this route. */
    models?: readonly PiAiModelProfile[];
    /** Installed-catalog customizations by model id; only meaningful while `models` is absent. */
    modelOverrides?: Readonly<Record<string, PiAiModelOverride>>;
    /** Reasoning-dispatch switches for every `openai-completions` model on the route; entries override per field. */
    compat?: PiAiCompatProfile;
    /** Context capacity for a model neither the entry nor the catalog sizes. */
    defaultContextWindow: number;
    /** Output capability for a model neither the entry nor the catalog sizes. */
    defaultMaxTokens: number;
    /** Modalities for a model neither the entry nor the catalog declares. */
    defaultInput: Model<Api>['input'];
}
/** One route's materialized catalog, plus the request caps its profile chose. */
export interface RouteCatalog {
    /** The materialized models in configuration order. */
    models: readonly Model<Api>[];
    /**
     * Per-request output caps this profile explicitly configured, by model id.
     *
     * Separate from `Model.maxTokens` because the two answer different
     * questions: pi-ai requires `maxTokens` as the model's output *capability*,
     * while the harness seam's `defaultMaxTokens` is a cap the deployment chose
     * to send on requests that name none. Materializing a catalog capability as
     * a request default would start capping every request at a number nobody
     * picked, so only an explicit configuration lands here.
     */
    configuredMaxTokens: ReadonlyMap<string, number>;
}
/**
 * Materialize one route's catalog by merging the installed catalog defaults
 * under the configured entries. A route with no configured `models` serves the
 * installed catalog unchanged, which is what keeps an existing
 * `providers: { deepseek: { apiKeyEnv: … } }` profile working untouched.
 * @param request - the route-level catalog facts.
 * @returns the materialized models and the explicitly configured request caps.
 */
export declare function resolveRouteModels(request: RouteCatalogRequest): RouteCatalog;
export {};
//# sourceMappingURL=catalog.d.ts.map