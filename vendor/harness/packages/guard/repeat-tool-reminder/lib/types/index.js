/**
 * Advisory per-agent repeat-call detector. It enriches post-execute decisions
 * with logged model context without vetoing or rewriting calls. Configuration
 * and chain semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @deepseek-ai/dsh-repeat-tool-reminder
 */
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
export const name = 'repeat-tool-reminder';
export const Config = z.object({
    thresholds: z.array(z.number()).default([3, 5, 8]),
    include: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
    argumentsPreviewChars: z.number().default(500),
});
/**
 * The `{kind:'plugin'}` source stamped on every reminder this guard injects —
 * the label is load-bearing (an unlabeled context would render as a user
 * prompt in derived history).
 */
const PLUGIN_SOURCE = { kind: 'plugin', plugin: 'repeat-tool-reminder' };
/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER = 'You are repeating the exact same tool call with identical arguments. '
    + 'Carefully analyze the previous result before calling again: if the task is '
    + 'not complete, try a different approach or different arguments instead of '
    + 'repeating the call.';
/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName, count, canonicalArguments) {
    return 'Repeated tool call detected:\n'
        + `- tool: ${toolName}\n`
        + `- consecutive_calls: ${count}\n`
        + `- arguments: ${canonicalArguments}\n`
        + 'The repeated calls are not making progress. Do not call this tool with '
        + 'these exact arguments again. Inspect the latest result and choose a '
        + 'different action, different arguments, or finish the task if enough '
        + 'evidence has been gathered.';
}
/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ
 * only in property order canonicalize identically. Arguments reach the guard
 * as the loop's `JSON.parse` output (or its raw-string fallback for malformed
 * argument JSON), so JSON's value domain is the whole input domain — no
 * bigint, cycle, or `undefined` handling exists because no input path can
 * produce them.
 */
function sortJsonValue(value) {
    if (Array.isArray(value))
        return value.map(sortJsonValue);
    if (value !== null && typeof value === 'object') {
        const record = value;
        const sorted = {};
        for (const key of Object.keys(record).sort()) {
            sorted[key] = sortJsonValue(record[key]);
        }
        return sorted;
    }
    return value;
}
/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue) {
    return JSON.stringify(sortJsonValue(argumentsValue));
}
/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw `\$&`);
    return new RegExp(`^${escaped.replaceAll('*', '.*')}$`);
}
/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the
 * chain key always uses the full canonical string.
 */
function previewArguments(canonical, cap) {
    if (canonical.length <= cap)
        return canonical;
    return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`;
}
/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once).
 */
function validateThresholds(values) {
    if (values.length === 0) {
        throw new Error('repeat-tool-reminder: `thresholds` must not be empty');
    }
    for (const value of values) {
        if (!Number.isInteger(value) || value < 2) {
            throw new Error(`repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`);
        }
    }
    if (new Set(values).size !== values.length) {
        throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates');
    }
    return [...values].sort((a, b) => a - b);
}
/**
 * Prepend the guard's reminder while preserving every downstream context's
 * source and metadata.
 */
function prependContext(ours, theirs) {
    return [ours, ...theirs ?? []];
}
/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `thresholds` is re-checked fail-loud here.
 */
export function apply(ctx, config) {
    // schemastery's .default() guarantees the fields are set after validation.
    const thresholds = validateThresholds(config.thresholds);
    const thresholdSet = new Set(thresholds);
    const includePatterns = config.include.map(wildcardToRegExp);
    const excludePatterns = config.exclude.map(wildcardToRegExp);
    const argumentsPreviewChars = config.argumentsPreviewChars;
    if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
        throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`);
    }
    const chains = new WeakMap();
    /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
    function tracked(toolName) {
        if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(toolName)))
            return false;
        return !excludePatterns.some(pattern => pattern.test(toolName));
    }
    /**
     * Advance the calling agent's chain for one attempt and return the reminder
     * to deliver, if this attempt's run length hits a configured threshold.
     * Counting happens here — in post-execute — because denied calls also flow
     * through this waterfall (`ToolRuntime.execute` routes a deny through the
     * same pipeline), and a model hammering a denied call is exactly the loop
     * worth breaking.
     */
    function observe(exec) {
        // A direct `ctx.tools.execute()` caller has no model to remind and no id
        // to key on; only agent-loop calls participate.
        if (!exec.agent)
            return undefined;
        if (!tracked(exec.name))
            return undefined;
        const canonical = canonicalize(exec.arguments);
        const key = JSON.stringify([exec.name, canonical]);
        const chain = chains.get(exec.agent);
        const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1;
        chains.set(exec.agent, { key, count });
        if (!thresholdSet.has(count))
            return undefined;
        const text = count === thresholds[0]
            ? GENTLE_REMINDER
            : detailedReminder(exec.name, count, previewArguments(canonical, argumentsPreviewChars));
        return createUserMessage({
            content: [{ type: 'text', text }],
            source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} × ${count}` },
        });
    }
    // Observe-and-enrich, never veto: count first (state advances regardless of
    // the downstream outcome), DELEGATE so a later listener can still block or
    // replace, then fold the reminder onto whatever came back — additionalContexts
    // rides both decision variants, so a blocked call still gets the nudge.
    ctx.on('tools/post-execute', async (exec, _result, next) => {
        const reminder = observe(exec);
        const downstream = await next();
        if (!reminder)
            return downstream;
        if (downstream.kind === 'block') {
            return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(reminder, downstream.additionalContexts) };
        }
        return {
            ...downstream,
            additionalContexts: prependContext(reminder, downstream.additionalContexts),
        };
    });
    // A user interjection changes the context; repetition across it is not a
    // loop. Pure reset hook: always delegates (attaching nothing, vetoing
    // nothing).
    ctx.on('agent/pre-step', ({ agent, messages }, next) => {
        if (messages.some(message => message.source.kind === 'user'))
            chains.delete(agent);
        return next();
    });
}
//# sourceMappingURL=index.js.map