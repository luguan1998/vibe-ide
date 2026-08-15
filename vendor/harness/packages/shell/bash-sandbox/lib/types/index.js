/**
 * Sandbox-consuming bash executor. It wraps the exact local bash argv through
 * `ctx.sandbox`, inherits local process mechanics, and reports the selected
 * mode, enforcement, and denial facts. Positive runner-launch evidence means
 * the command never ran: foreground calls throw `SANDBOX_UNAVAILABLE`, while
 * background processes carry `runnerFailed`; other spawn rejections retain
 * local-executor semantics. The tool owns approval and passes a complete per-call policy.
 * @module @deepseek-ai/dsh-bash-sandbox
 */
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox';
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
import { classifyDenial, classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature } from "./helpers.js";
/**
 * Registers as `ctx.shell` in place of the local executor and requires a
 * `ctx.sandbox` provider plus `ctx.sandboxPolicy`; the tool layer is
 * unchanged. Tool calls pass the calling session's resolved policy; direct
 * calls fall back to deployment policy. `result.sandbox` reports the mode and
 * enforcement actually used.
 */
export class SandboxBashExecutor extends LocalBashExecutor {
    static inject = ['subprocess', 'sandbox', 'sandboxPolicy'];
    // No own Config: the sandbox default (mode + workspaceRoot) is owned by
    // ctx.sandboxPolicy, so this executor inherits LocalBashExecutor's Config
    // verbatim (the config catalog walks the inherited static).
    mode;
    /**
     * Per-process confinement facts retained until settlement. Providers may
     * vary enforcement and diagnostic dialect between overlapping calls, so a
     * shared latest-wrap value would classify a process against the wrong facts.
     * Unconfined processes have no entry.
     */
    processFacts = new Map();
    constructor(ctx, config) {
        super(ctx, config);
        // The default mode is the capability fact used for schema advertisement;
        // actual tool executions carry their resolved per-call policy.
        this.mode = ctx.sandboxPolicy.defaultMode;
    }
    /** The configured default mode — the capability fact the tool layer reads. */
    get sandboxMode() {
        return this.mode;
    }
    /**
     * Stamp a complete per-call policy onto the spec. Tool calls supply the
     * calling session's resolved mode and root; lower-level callers fall back to
     * the deployment policy.
     */
    resolve(request) {
        return { ...super.resolve(request), sandboxPolicy: request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve() };
    }
    async run(spec) {
        const policy = spec.sandboxPolicy;
        const { mode } = policy;
        if (mode === 'danger-full-access') {
            const result = await super.run(spec);
            return { ...result, sandbox: { mode, denied: false } };
        }
        const confined = this.confine(spec.command, { ...policy, mode });
        let result;
        try {
            result = await this.runArgv(spec, confined.argv);
        }
        catch (error) {
            // An upstream abort remains cancellation even when it prevents spawn.
            if (spec.signal?.aborted === true)
                spec.signal.throwIfAborted();
            if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
                throw new SandboxUnavailableError(mode, String(error));
            }
            throw error;
        }
        // Runner failure outranks denial because the command did not run. Carry
        // the matched fatal line, not an informational line that preceded it.
        const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, confined.runnerFailureRules);
        if (runnerFailure !== undefined) {
            throw new SandboxUnavailableError(mode, runnerFailure.detail);
        }
        return { ...result, sandbox: { mode, denied: classifyDenial(result, confined.denialSignatures), enforcement: confined.enforcement } };
    }
    start(spec) {
        const policy = spec.sandboxPolicy;
        const { mode } = policy;
        if (mode === 'danger-full-access')
            return super.start(spec);
        // Once startArgv returns, install facts synchronously; promise settlement
        // cannot run before start() returns.
        const confined = this.confine(spec.command, { ...policy, mode });
        let proc;
        try {
            proc = this.startArgv(spec, confined.argv);
        }
        catch (error) {
            // LocalSubprocessRuntime reports ENOENT/EACCES with the failed executable path through async
            // `done` rejection; this covers alternatives that throw the same error synchronously.
            if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
                throw new SandboxUnavailableError(mode, String(error));
            }
            throw error;
        }
        const { enforcement, denialSignatures, runnerFailureRules } = confined;
        this.processFacts.set(proc, {
            mode,
            enforcement,
            denialSignatures,
            runnerFailureRules,
            runnerProgram: confined.argv[0],
            workdir: spec.workdir,
        });
        return proc;
    }
    /**
     * Stamp per-process sandbox facts before `done` settles. Full-access processes
     * have no facts; signal deaths are not denials.
     */
    onProcessDone(proc, stderr, spawnFailed, spawnError) {
        const facts = this.processFacts.get(proc);
        if (facts !== undefined) {
            this.processFacts.delete(proc);
            // A rejected spawn never started the confined launch. Otherwise runner
            // failure outranks denial because its diagnostics may contain denial terms.
            const runnerFailed = spawnFailed
                ? isRunnerSpawnFailure(spawnError, facts.runnerProgram, facts.workdir)
                : classifyRunnerFailure(proc.exitCode, stderr, facts.runnerFailureRules) !== undefined;
            proc.sandbox = {
                mode: facts.mode,
                denied: !runnerFailed && matchesSignature(proc.exitCode, stderr, facts.denialSignatures),
                enforcement: facts.enforcement,
                ...(runnerFailed ? { runnerFailed } : {}),
            };
        }
        super.onProcessDone(proc, stderr, spawnFailed, spawnError);
    }
    /**
     * Wrap one shell command via the `ctx.sandbox` provider. Provider errors
     * propagate unchanged; the returned argv is handed directly to the local
     * executor's subprocess path.
     * @param command - shell source for the confined inner `bash -c`.
     * @param policy - resolved confined execution policy.
     * @returns the provider's exact argv and settlement-classification facts.
     */
    confine(command, policy) {
        return this.ctx.sandbox.confine(['bash', '-c', command], policy);
    }
}
export default SandboxBashExecutor;
//# sourceMappingURL=index.js.map