/**
 * Load-time validation and routed-model policy resolution for compaction-basic.
 *
 * @module @deepseek-ai/dsh-compaction-basic/config
 */
import { deepFreeze } from '@deepseek-ai/dsh-llm';
/** Default request-pressure fraction for every routed model. */
const DEFAULT_THRESHOLD_RATIO = 0.8;
/** Default verbatim-tail fraction for every routed model. */
const DEFAULT_RETAIN_RATIO = 0.16;
/** Fields shared by top-level defaults and exact-target overrides. */
const POLICY_CONFIG_KEYS = [
    'thresholdRatio',
    'retainRatio',
    'retainTokens',
    'summarizationProvider',
    'summarizationModel',
    'maxTokens',
    'compactionRetries',
    'maxOverflowRetries',
];
/** Complete public top-level configuration key set. */
const BASIC_COMPACT_CONFIG_KEYS = new Set([
    ...POLICY_CONFIG_KEYS,
    'modelPolicies',
    'auto',
]);
/** Complete exact-target override key set. */
const MODEL_POLICY_KEYS = new Set([
    'provider',
    'model',
    ...POLICY_CONFIG_KEYS,
]);
/** Target-specific pressure configuration failure eligible for warning suppression. */
export class TargetPressureConfigError extends Error {
    targetKey;
    /**
     * @param targetKey - exact provider/model route used as the warning key.
     * @param message - actionable configuration failure detail.
     */
    constructor(targetKey, message) {
        super(message);
        this.targetKey = targetKey;
    }
}
/**
 * Resolve and validate service defaults plus exact-target partial overrides.
 * @param config - untrusted plugin configuration after Loader normalization.
 * @returns detached immutable defaults and validated exact-target overrides.
 */
export function resolveConfig(config = {}) {
    validateKeys(config, BASIC_COMPACT_CONFIG_KEYS, 'BasicCompactionConfig');
    validatePolicy(config, 'BasicCompactionConfig');
    if (config.auto !== undefined && typeof config.auto !== 'boolean') {
        throw new Error('BasicCompactionConfig: auto must be a boolean');
    }
    const thresholdRatio = config.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
    const retention = resolveRetention(config, { retainRatio: DEFAULT_RETAIN_RATIO });
    validateRatioRetention(thresholdRatio, retention, 'BasicCompactionConfig');
    const modelPolicies = resolveModelPolicies(config.modelPolicies);
    for (const [index, policy] of modelPolicies.entries()) {
        validateRatioRetention(policy.thresholdRatio ?? thresholdRatio, resolveRetention(policy, retention), `BasicCompactionConfig: modelPolicies[${index}]`);
    }
    return deepFreeze({
        thresholdRatio,
        ...retention,
        summarizationProvider: config.summarizationProvider ?? '',
        summarizationModel: config.summarizationModel ?? '',
        maxTokens: config.maxTokens ?? 8192,
        compactionRetries: config.compactionRetries ?? 1,
        maxOverflowRetries: config.maxOverflowRetries ?? 1,
        modelPolicies,
        auto: config.auto ?? true,
    });
}
/**
 * Merge the exact provider/model override over the validated default policy.
 * @param config - validated service defaults and override table.
 * @param target - exact durable provider/model route to match.
 * @returns detached immutable policy before model-capacity scaling.
 */
export function resolveTargetPolicy(config, target) {
    const override = config.modelPolicies.find(policy => (policy.provider === target.provider && policy.model === target.model));
    const inheritedRetention = config.retainTokens === undefined
        ? { retainRatio: config.retainRatio }
        : { retainTokens: config.retainTokens };
    return deepFreeze({
        target: { provider: target.provider, model: target.model },
        thresholdRatio: override?.thresholdRatio ?? config.thresholdRatio,
        ...resolveRetention(override ?? {}, inheritedRetention),
        summarizationProvider: override?.summarizationProvider ?? config.summarizationProvider,
        summarizationModel: override?.summarizationModel ?? config.summarizationModel,
        maxTokens: override?.maxTokens ?? config.maxTokens,
        compactionRetries: override?.compactionRetries ?? config.compactionRetries,
        maxOverflowRetries: override?.maxOverflowRetries ?? config.maxOverflowRetries,
    });
}
/**
 * Scale one routed policy into concrete token budgets for its model capacity.
 * @param policy - merged policy for the exact routed target.
 * @param contextWindow - positive adapter-owned capacity for that target.
 * @returns detached immutable pressure and retention budgets.
 */
export function resolveCompactSpec(policy, contextWindow) {
    const targetKey = `${policy.target.provider}/${policy.target.model}`;
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
        throw new TargetPressureConfigError(targetKey, `BasicCompactionConfig: contextWindow (${contextWindow}) must be a positive integer`);
    }
    const thresholdTokens = Math.floor(contextWindow * policy.thresholdRatio);
    const retainTokens = policy.retainTokens === undefined
        ? Math.floor(contextWindow * policy.retainRatio)
        : policy.retainTokens;
    if (retainTokens >= thresholdTokens) {
        throw new TargetPressureConfigError(targetKey, `BasicCompactionConfig: ${policy.target.provider}/${policy.target.model} retainTokens `
            + `(${retainTokens}) must be less than threshold tokens ${thresholdTokens}`);
    }
    return deepFreeze({
        target: { ...policy.target },
        contextWindow,
        thresholdRatio: policy.thresholdRatio,
        thresholdTokens,
        retainTokens,
        summarizationProvider: policy.summarizationProvider,
        summarizationModel: policy.summarizationModel,
        maxTokens: policy.maxTokens,
        compactionRetries: policy.compactionRetries,
        maxOverflowRetries: policy.maxOverflowRetries,
    });
}
/** Choose an explicit retention form or inherit the already-resolved fallback. */
function resolveRetention(config, fallback) {
    if (config.retainTokens !== undefined)
        return { retainTokens: config.retainTokens };
    if (config.retainRatio !== undefined)
        return { retainRatio: config.retainRatio };
    return fallback;
}
/** Reject a capacity-independent retention conflict at plugin load. */
function validateRatioRetention(thresholdRatio, retention, name) {
    if (retention.retainRatio !== undefined && retention.retainRatio >= thresholdRatio) {
        throw new Error(`${name}: retainRatio (${retention.retainRatio}) must be less than `
            + `the resolved thresholdRatio (${thresholdRatio})`);
    }
}
/** Validate, detach, and reject duplicate exact-target policies. */
function resolveModelPolicies(configured) {
    if (configured === undefined)
        return [];
    if (!Array.isArray(configured)) {
        throw new Error('BasicCompactionConfig: modelPolicies must be an array');
    }
    const seen = new Set();
    return configured.map((source, index) => {
        const name = `BasicCompactionConfig: modelPolicies[${index}]`;
        assertModelPolicy(source, name);
        const key = `${source.provider}\u0000${source.model}`;
        if (seen.has(key)) {
            throw new Error(`BasicCompactionConfig: duplicate model policy for ${source.provider}/${source.model}`);
        }
        seen.add(key);
        return { ...source };
    });
}
/** Validate one untrusted exact-target override and narrow its public type. */
function assertModelPolicy(source, name) {
    if (!isUnknownRecord(source))
        throw new Error(`${name} must be an object`);
    validateKeys(source, MODEL_POLICY_KEYS, name);
    assertNonEmptyString(`${name}.provider`, source.provider);
    assertNonEmptyString(`${name}.model`, source.model);
    validatePolicy(source, name);
}
/** Validate the fields common to defaults and exact-target partial overrides. */
function validatePolicy(config, name) {
    const thresholdRatio = config.thresholdRatio;
    const retainRatio = config.retainRatio;
    const retainTokens = config.retainTokens;
    const maxTokens = config.maxTokens;
    const compactionRetries = config.compactionRetries;
    const maxOverflowRetries = config.maxOverflowRetries;
    if (thresholdRatio !== undefined)
        assertRatio(`${name}.thresholdRatio`, thresholdRatio);
    if (retainRatio !== undefined)
        assertRatio(`${name}.retainRatio`, retainRatio);
    if (retainTokens !== undefined)
        assertNonNegativeInteger(`${name}.retainTokens`, retainTokens);
    if (retainRatio !== undefined && retainTokens !== undefined) {
        throw new Error(`${name}: retainRatio and retainTokens are mutually exclusive`);
    }
    if (maxTokens !== undefined)
        assertPositiveInteger(`${name}.maxTokens`, maxTokens);
    if (compactionRetries !== undefined) {
        assertNonNegativeInteger(`${name}.compactionRetries`, compactionRetries);
    }
    if (maxOverflowRetries !== undefined) {
        assertNonNegativeInteger(`${name}.maxOverflowRetries`, maxOverflowRetries);
    }
    validateSummarizationPair(config, name);
}
/** Require one scope to omit, clear, or replace the summarization target as a pair. */
function validateSummarizationPair(config, name) {
    const provider = config.summarizationProvider;
    const model = config.summarizationModel;
    if (provider !== undefined && typeof provider !== 'string') {
        throw new Error(`${name}.summarizationProvider must be a string`);
    }
    if (model !== undefined && typeof model !== 'string') {
        throw new Error(`${name}.summarizationModel must be a string`);
    }
    if (provider === undefined && model === undefined)
        return;
    if (provider === undefined || model === undefined
        || (provider.length === 0) !== (model.length === 0)) {
        throw new Error(`${name}: summarizationProvider and summarizationModel must be set together `
            + 'as an empty or non-empty pair');
    }
}
/** Reject stale or misspelled keys before defaults can hide them. */
function validateKeys(config, keys, name) {
    for (const key of Object.keys(config)) {
        if (!keys.has(key))
            throw new Error(`${name}: unknown key "${key}"`);
    }
}
function isUnknownRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function assertNonEmptyString(name, value) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
}
function assertPositiveInteger(name, value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} (${String(value)}) must be a positive integer`);
    }
}
function assertNonNegativeInteger(name, value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`${name} (${String(value)}) must be a non-negative integer`);
    }
}
function assertRatio(name, value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
        throw new Error(`${name} (${String(value)}) must be a number in (0, 1]`);
    }
}
//# sourceMappingURL=config.js.map