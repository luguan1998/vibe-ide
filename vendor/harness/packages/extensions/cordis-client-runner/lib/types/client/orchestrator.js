/**
 * Page-side run orchestration for model approvals and direct panel gestures.
 * Host activation always precedes Client loading. The same Plugin-keyed state
 * drives every surface, so remounting a panel never loses an open approval or
 * an in-flight transition.
 */
import { errorDetails } from "./runtime.js";
/** Drives Host → Client activation and publishes Plugin-keyed activity. */
export class CordisRunOrchestrator {
    env;
    requests = new Map();
    activity = new Map();
    failures = new Map();
    inFlight = new Map();
    listeners = new Set();
    activityCache;
    failureCache;
    /** @param env - Client loader and folded Host operations. */
    constructor(env) {
        this.env = env;
    }
    /** Open approvals and current activation attempts, keyed by stable Plugin ID. */
    activeRuns = {
        getSnapshot: () => this.activityCache ??= new Map(this.activity),
        subscribe: fn => this.observe(fn),
    };
    /** Latest page-side activation failure for each Plugin. */
    lastRunError = {
        getSnapshot: () => this.failureCache ??= new Map(this.failures),
        subscribe: fn => this.observe(fn),
    };
    /**
     * Register a Client activation request, starting it immediately when the Plugin is already authorized.
     * @param request - forwarded approval and activation metadata.
     */
    open(request) {
        this.requests.set(request.requestId, request);
        if (!request.requiresApproval) {
            void this.orchestrate({
                agentId: request.agentId,
                pluginId: request.pluginId,
                packageId: request.packageId,
                mode: request.mode,
                requestId: request.requestId,
                hasClientHalf: true,
            }).catch((error) => {
                console.error(`[cordis-client-runner] automatic activation ${request.requestId} failed:`, error);
            });
            return;
        }
        if (this.activity.get(request.pluginId)?.phase !== 'orchestrating') {
            this.activity.set(request.pluginId, {
                phase: 'awaiting-approval',
                requestId: request.requestId,
                agentId: request.agentId,
                packageId: request.packageId,
                mode: request.mode,
                name: request.name,
                purpose: request.purpose,
            });
        }
        this.commit();
    }
    /**
     * Rebuild pending approvals and automatic Client activations from an authoritative Host inventory read.
     * @param rows - complete process-wide Plugin inventory.
     */
    reconcileApprovals(rows) {
        const expected = new Map();
        for (const row of rows) {
            const attempt = row.latestRun;
            if (attempt?.approvalRequestId === undefined
                || (attempt.status !== 'awaiting-approval'
                    && attempt.status !== 'starting-host'
                    && attempt.status !== 'client-pending'))
                continue;
            const pkg = row.packages.find(candidate => candidate.packageId === attempt.packageId);
            if (pkg === undefined)
                continue;
            expected.set(attempt.approvalRequestId, {
                requestId: attempt.approvalRequestId,
                agentId: row.agentId,
                pluginId: row.pluginId,
                packageId: attempt.packageId,
                mode: attempt.mode,
                name: pkg.name,
                purpose: pkg.purpose,
                requiresApproval: attempt.requiresApproval ?? attempt.status === 'awaiting-approval',
            });
        }
        let changed = false;
        for (const [requestId, request] of [...this.requests]) {
            if (expected.has(requestId))
                continue;
            this.requests.delete(requestId);
            const current = this.activity.get(request.pluginId);
            if (current?.phase === 'awaiting-approval' && current.requestId === requestId) {
                this.activity.delete(request.pluginId);
            }
            changed = true;
        }
        for (const [requestId, request] of expected) {
            const previous = this.requests.get(requestId);
            const current = this.activity.get(request.pluginId);
            if (!request.requiresApproval && current?.phase === 'orchestrating')
                continue;
            if (request.requiresApproval
                && sameRequest(previous, request)
                && current?.phase === 'awaiting-approval'
                && current.requestId === requestId)
                continue;
            if (!request.requiresApproval) {
                this.open(request);
                changed = true;
                continue;
            }
            this.requests.set(requestId, request);
            if (current?.phase !== 'orchestrating') {
                this.activity.set(request.pluginId, {
                    phase: 'awaiting-approval',
                    requestId,
                    agentId: request.agentId,
                    packageId: request.packageId,
                    mode: request.mode,
                    name: request.name,
                    purpose: request.purpose,
                });
            }
            changed = true;
        }
        if (changed)
            this.commit();
    }
    /**
     * Close an approval settled by another page or by cancellation.
     * @param requestId - approval request that can no longer be answered here.
     */
    close(requestId) {
        const request = this.requests.get(requestId);
        if (request === undefined)
            return;
        this.requests.delete(requestId);
        const current = this.activity.get(request.pluginId);
        if (current?.phase === 'awaiting-approval' && current.requestId === requestId) {
            this.activity.delete(request.pluginId);
        }
        this.commit();
    }
    /**
     * Approve and execute one still-open model request.
     * @param requestId - approval request to execute.
     * @param approveFutureVersions - whether this approval covers later Packages for the same Plugin.
     */
    approve(requestId, approveFutureVersions) {
        const request = this.requests.get(requestId);
        if (request === undefined || !request.requiresApproval)
            return Promise.resolve();
        return this.orchestrate({
            agentId: request.agentId,
            pluginId: request.pluginId,
            packageId: request.packageId,
            mode: request.mode,
            requestId,
            approveFutureVersions,
            hasClientHalf: true,
        });
    }
    /**
     * Reject one still-open model request without executing either half.
     * @param requestId - approval request to reject.
     */
    async decline(requestId) {
        const request = this.requests.get(requestId);
        if (request === undefined || !request.requiresApproval)
            return;
        const current = this.activity.get(request.pluginId);
        if (current?.phase !== 'awaiting-approval' || current.requestId !== requestId)
            return;
        this.requests.delete(requestId);
        this.activity.delete(request.pluginId);
        this.commit();
        await this.answer(requestId, { ok: false, reason: 'rejected' });
    }
    /**
     * Execute a direct panel run; the user gesture itself authorizes it.
     * @param request - exact Package activation selected by the user.
     */
    startUserRun(request) {
        return this.orchestrate(request);
    }
    observe(fn) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
    }
    commit() {
        this.activityCache = undefined;
        this.failureCache = undefined;
        for (const fn of [...this.listeners])
            fn();
    }
    orchestrate(plan) {
        const running = this.inFlight.get(plan.pluginId);
        if (running !== undefined)
            return running;
        this.activity.set(plan.pluginId, {
            phase: 'orchestrating',
            agentId: plan.agentId,
            packageId: plan.packageId,
            mode: plan.mode,
        });
        this.failures.delete(plan.pluginId);
        if (plan.requestId !== undefined)
            this.requests.delete(plan.requestId);
        this.commit();
        const attempt = this.drive(plan).finally(() => {
            this.inFlight.delete(plan.pluginId);
            this.activity.delete(plan.pluginId);
            this.commit();
        });
        this.inFlight.set(plan.pluginId, attempt);
        return attempt;
    }
    async drive(plan) {
        const started = await this.startHost(plan);
        if (!started.ok) {
            this.fail(plan, 'host-half-failed', started);
            if (plan.requestId !== undefined) {
                await this.answer(plan.requestId, { ...started, reason: 'host-half-failed' });
            }
            return;
        }
        if (!plan.hasClientHalf)
            return;
        let source;
        try {
            source = await this.env.host.getClientCode(plan.agentId, plan.pluginId, started.pluginRunId);
        }
        catch (error) {
            await this.finishClientFailure(plan, started.pluginRunId, started.startedHere, errorDetails(error), error);
            return;
        }
        const loaded = await this.env.runner.load({
            pluginId: source.pluginId,
            packageId: source.packageId,
            pluginRunId: source.pluginRunId,
            agentId: plan.agentId,
            name: source.name,
            code: source.code,
        }).catch((error) => ({ ok: false, cause: 'evaluate', ...errorDetails(error), error }));
        if (!loaded.ok) {
            await this.finishClientFailure(plan, started.pluginRunId, started.startedHere, {
                message: `${loaded.cause}: ${loaded.message}`,
                ...loaded.stack === undefined ? {} : { stack: loaded.stack },
            }, loaded.error);
            return;
        }
        const resolution = {
            ok: true,
            pluginRunId: loaded.pluginRunId,
            ...loaded.waitingFor === undefined ? {} : { waitingFor: loaded.waitingFor },
        };
        if (plan.requestId !== undefined) {
            await this.answer(plan.requestId, resolution);
            return;
        }
        await this.settleDirect(plan, resolution);
    }
    async startHost(plan) {
        try {
            return await this.env.host.runHostHalf(plan.agentId, plan.pluginId, plan.packageId, plan.mode, plan.requestId ?? null, plan.approveFutureVersions ?? false);
        }
        catch (error) {
            return { ok: false, ...errorDetails(error) };
        }
    }
    async finishClientFailure(plan, pluginRunId, startedHere, failure, originalError) {
        console.error(`[cordis-client-runner] Client activation ${plan.pluginId}/${plan.packageId} (${pluginRunId}) failed:`, originalError ?? failure);
        this.fail(plan, 'client-half-failed', failure);
        const resolution = {
            ok: false,
            reason: 'client-half-failed',
            pluginRunId,
            startedHere,
            ...failure,
        };
        if (plan.requestId !== undefined)
            await this.answer(plan.requestId, resolution);
        else
            await this.settleDirect(plan, resolution);
    }
    async settleDirect(plan, resolution) {
        try {
            const response = await this.env.host.settleUserRun(plan.agentId, plan.pluginId, resolution);
            if (!response.ok)
                this.fail(plan, 'client-half-failed', response);
        }
        catch (error) {
            this.fail(plan, 'client-half-failed', errorDetails(error));
        }
    }
    async answer(requestId, resolution) {
        try {
            await this.env.host.resolveRequestRun(requestId, resolution);
        }
        catch (error) {
            console.error(`[cordis-client-runner] answering run request ${requestId} failed:`, error);
        }
    }
    fail(plan, reason, failure) {
        this.failures.set(plan.pluginId, { packageId: plan.packageId, reason, ...failure });
        this.commit();
    }
}
function sameRequest(left, right) {
    return left?.requestId === right.requestId
        && left.agentId === right.agentId
        && left.pluginId === right.pluginId
        && left.packageId === right.packageId
        && left.mode === right.mode
        && left.name === right.name
        && left.purpose === right.purpose
        && left.requiresApproval === right.requiresApproval;
}
//# sourceMappingURL=orchestrator.js.map