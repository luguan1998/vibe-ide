/** Configuration resolution for deterministic tool-result pruning. */
import { deepFreeze } from '@deepseek-ai/dsh-llm';
/** Fixed marker substituted for every removed middle span. */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n';
/** Low-friction defaults for coding-agent tool output. */
export const DEFAULTS = deepFreeze({
    thresholdChars: 8192,
    headChars: 4096,
    tailChars: 1024,
});
const CONFIG_KEYS = new Set([
    'thresholdChars',
    'headChars',
    'tailChars',
]);
/**
 * Count Unicode code points without splitting surrogate pairs.
 * @param text - text to measure.
 * @returns the Unicode code-point count.
 */
export function codePointLength(text) {
    return Array.from(text).length;
}
/**
 * Resolve and validate pruning budgets.
 * @param config - raw plugin configuration.
 * @returns a detached deeply immutable configuration.
 */
export function resolveConfig(config = {}) {
    for (const key of Object.keys(config)) {
        if (!CONFIG_KEYS.has(key)) {
            throw new Error(`ToolResultPruneConfig: unknown key "${key}" `
                + '(allowed: thresholdChars, headChars, tailChars)');
        }
    }
    const resolved = {
        thresholdChars: config.thresholdChars ?? DEFAULTS.thresholdChars,
        headChars: config.headChars ?? DEFAULTS.headChars,
        tailChars: config.tailChars ?? DEFAULTS.tailChars,
    };
    assertPositiveInteger('thresholdChars', resolved.thresholdChars);
    assertNonNegativeInteger('headChars', resolved.headChars);
    assertNonNegativeInteger('tailChars', resolved.tailChars);
    const emittedChars = resolved.headChars
        + codePointLength(PRUNE_MARKER)
        + resolved.tailChars;
    if (emittedChars > resolved.thresholdChars) {
        throw new Error(`ToolResultPruneConfig: headChars + marker + tailChars (${emittedChars}) `
            + `must be at most thresholdChars (${resolved.thresholdChars})`);
    }
    return deepFreeze(structuredClone(resolved));
}
function assertPositiveInteger(name, value) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a positive integer`);
    }
}
function assertNonNegativeInteger(name, value) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a non-negative integer`);
    }
}
//# sourceMappingURL=config.js.map