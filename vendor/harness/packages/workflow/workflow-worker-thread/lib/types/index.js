/**
 * Worker-thread workflow engine. Each run executes its model-written script in
 * an escapable vm context on a fresh worker and bridges `agent()` calls to host
 * subagents. The thread prevents synchronous script work from blocking the host
 * and permits forced termination, but it is containment rather than a security boundary.
 * @module @deepseek-ai/dsh-workflow-worker-thread
 */
import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import * as vm from 'node:vm';
import z from '@deepseek-ai/schemastery';
import WorkflowEngine, { WorkflowError, WorkflowRunId } from '@deepseek-ai/dsh-workflow';
import { WorkerRun } from "./host.js";
import { validateMeta } from "./meta.js";
export { validateMeta } from "./meta.js";
export { materializeFromRealm, MaterializeError } from "./realm.js";
/** A body that still carries the Claude Code-style meta header (meta rides the seam as data here). */
const META_STATEMENT = /^\s*export\s+const\s+meta\b/;
/**
 * Parse-check the body with the SAME wrapper the worker-side runtime
 * compiles, so `start()` keeps the seam's synchronous `SCRIPT_PARSE` throw
 * (the worker's own compile happens a thread away, after `start()` returned).
 * One redundant parse per run, bought deliberately for the contract. A body
 * opening with `export const meta` gets a pointed message instead of the
 * wrapper's bare SyntaxError — the model's likeliest authoring slip.
 */
function assertBodyParses(body, name) {
    if (META_STATEMENT.test(body)) {
        throw new WorkflowError('workflow meta rides the `meta` request field, not the script: remove the `export const meta = {...}` statement from the body', 'SCRIPT_PARSE');
    }
    try {
        // Parse only — the script object is discarded, nothing executes.
        void new vm.Script(`(async () => {\n${body}\n})()`, { filename: `workflow:${name}`, lineOffset: -1 });
    }
    catch (error) {
        throw new WorkflowError(`workflow script does not parse: ${String(error)}`, 'SCRIPT_PARSE', { cause: error });
    }
}
/** Resolve one run's provider route before publishing work. */
function resolveSubagentProvider(ctx, configured, override) {
    const provider = override ?? configured;
    if (provider.length === 0 || provider !== provider.trim()) {
        throw new WorkflowError('workflow subagentProvider must be a non-empty normalized string', 'INVALID_ARGUMENT');
    }
    if (ctx.subagents.getProvider(provider) === undefined) {
        throw new WorkflowError(`no subagent provider registered for "${provider}"`, 'AGENT_START');
    }
    return provider;
}
/** Resolve one run's total-child cap against the engine deployment ceiling. */
function resolveMaxTotalAgents(requested, ceiling) {
    if (requested === undefined)
        return ceiling;
    if (!Number.isSafeInteger(requested) || requested < 1) {
        throw new WorkflowError('workflow maxTotalAgents must be a positive safe integer', 'INVALID_ARGUMENT');
    }
    if (requested > ceiling) {
        throw new WorkflowError(`workflow maxTotalAgents ${requested} exceeds the engine ceiling ${ceiling}`, 'INVALID_ARGUMENT');
    }
    return requested;
}
/**
 * The worker-thread engine service. `start()` validates the script up front
 * (meta + a host-side body parse) and returns a {@link WorkflowRun} whose
 * `result` never rejects; the `workflow/*` events fire around the run per
 * the seam contract.
 */
class WorkerThreadWorkflowEngine extends WorkflowEngine {
    static inject = ['subagents'];
    static Config = z.object({
        provider: z.string().default('spawn'),
        maxConcurrentAgents: z.natural().default(0),
        maxTotalAgents: z.natural().min(1).default(1000),
        maxItemsPerCall: z.natural().min(1).default(4096),
        syncTimeoutMs: z.natural().min(1).default(5000),
        disposeGraceMs: z.natural().default(5000),
    });
    config;
    constructor(ctx, config) {
        super(ctx);
        // schemastery (static Config) has already filled the defaulted fields;
        // the assertion records that resolution, not a hidden fallback.
        this.config = config;
    }
    /**
     * Validate and execute a workflow script in a fresh worker thread. Throws
     * {@link WorkflowError} synchronously (`META_INVALID` for a malformed meta
     * block, `SCRIPT_PARSE` for a body that does not compile) for a request
     * that cannot begin; once a run is returned, every failure resolves through
     * `result.stopReason` instead.
     * @param request - the script body, its meta data and `args`, the parent
     *   agent, and an optional cancel signal.
     * @returns the live run (its `result` resolves when the script settles).
     */
    start(request) {
        const meta = validateMeta(request.meta);
        assertBodyParses(request.script, meta.name);
        const subagentProvider = resolveSubagentProvider(this.ctx, this.config.provider, request.subagentProvider);
        const maxTotalAgents = resolveMaxTotalAgents(request.maxTotalAgents, this.config.maxTotalAgents);
        const id = WorkflowRunId(randomUUID());
        const info = { id, meta };
        const limits = {
            maxConcurrentAgents: this.config.maxConcurrentAgents === 0
                ? Math.min(16, Math.max(1, availableParallelism() - 2))
                : this.config.maxConcurrentAgents,
            maxTotalAgents,
            maxItemsPerCall: this.config.maxItemsPerCall,
            syncTimeoutMs: this.config.syncTimeoutMs,
        };
        const init = {
            meta,
            body: request.script,
            ...request.args !== undefined ? { args: request.args } : {},
            limits,
        };
        // Capture the dependency while this service call is still traced through
        // the start() holder. Cordis strips the engine-provider shadow when it
        // returns the SubagentRuntime handle, so an already-returned run can keep
        // starting children after an engine HMR unload removes ctx.workflowEngine.
        // Re-resolving `this.ctx.subagents` later from WorkerRun would instead walk
        // the now-inactive engine fiber and break the seam's holder-owned lifetime.
        const runCtx = this.ctx;
        const subagents = runCtx.subagents;
        const workerRun = new WorkerRun(runCtx, subagents, id, meta, request.parent, init, subagentProvider, this.config.disposeGraceMs, {
            phase: (title) => { this.emitWorkflowEvent('workflow/phase', info, title); },
            log: (message) => { this.emitWorkflowEvent('workflow/log', info, message); },
            agentStart: (agent) => { this.emitWorkflowEvent('workflow/agent-start', info, agent); },
            agentEnd: (agent) => { this.emitWorkflowEvent('workflow/agent-end', info, agent); },
        }, request.signal);
        this.emitWorkflowEvent('workflow/start', info);
        // `workflow/end` fires as the (never-rejecting) result settles, with the
        // outcome DATA only — the value stays with the run's holder.
        void workerRun.result.then((settled) => {
            this.emitWorkflowEvent('workflow/end', info, {
                stopReason: settled.stopReason,
                ...settled.error !== undefined ? { error: settled.error } : {},
                agentsStarted: settled.agentsStarted,
            });
        });
        return workerRun;
    }
}
export default WorkerThreadWorkflowEngine;
//# sourceMappingURL=index.js.map