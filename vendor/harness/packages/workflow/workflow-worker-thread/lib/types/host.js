/**
 * Host side of one workflow run. The first worker result, unexpected death, or
 * cancellation-grace expiry owns settlement and closes message admission.
 * Pending starts share one abort signal; published children share idempotent
 * cleanup, and quiescence waits for both while synthesizing any missing end events.
 * @module @deepseek-ai/dsh-workflow-worker-thread/host
 */
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { assertNever } from '@deepseek-ai/dsh-llm';
import { snapshotJsonValue } from '@deepseek-ai/dsh-session';
import { renderThrown } from "./realm.js";
import { HostToWorkerType, WorkerToHostType } from "./protocol.js";
/**
 * The scrubbed worker environment: no ambient credentials, no loader flags.
 * Windows derives `os.tmpdir()` from `TMP`/`TEMP` and falls back to the
 * literal relative path `undefined\temp` when the environment is empty, so
 * tsx's transform cache would land in a cwd-relative `undefined/temp`
 * directory; the host's real temp path (not a credential) is injected there.
 * The unbuilt shape additionally forwards `TSX_TSCONFIG_PATH` for path
 * resolution.
 * @param platform - host platform; overridable so tests exercise both peer arms.
 * @param tsconfigPath - the tsconfig pin to forward; only the unbuilt caller
 *   passes one, so the built worker never observes the host's pin.
 * @returns the scrubbed worker environment object.
 */
export function workerSpawnEnv(platform = process.platform, tsconfigPath) {
    const env = {};
    if (platform === 'win32') {
        const tmp = tmpdir();
        env.TMP = tmp;
        env.TEMP = tmp;
    }
    if (tsconfigPath !== undefined)
        env.TSX_TSCONFIG_PATH = tsconfigPath;
    return env;
}
/**
 * Resolve a built worker bundle or an unbuilt bootstrap that installs both tsx
 * transforms inside the worker. Both shapes clear `execArgv` and the ambient
 * environment (the worker only sees the platform temp path and, unbuilt,
 * `TSX_TSCONFIG_PATH`).
 * @param init - the run payload, passed as `workerData`.
 * @returns the entry path or URL and the Worker options to spawn it with.
 */
function resolveWorkerSpawn(init) {
    /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/); the built-worker e2e exercises this shape for real */
    if (!import.meta.url.endsWith('.ts')) {
        return { entry: fileURLToPath(new URL('./worker.cjs', import.meta.url)), options: { workerData: init, env: workerSpawnEnv(), execArgv: [] } };
    }
    // Resolve tsx only for unbuilt consumers and install it before importing TS.
    const workerEntry = new URL('./worker.ts', import.meta.url);
    const tsxEsmApiEntry = import.meta.resolve('tsx/esm/api');
    const tsxCjsApiEntry = import.meta.resolve('tsx/cjs/api');
    const bootstrap = [
        `import { register as registerEsm } from ${JSON.stringify(tsxEsmApiEntry)}`,
        `import { register as registerCjs } from ${JSON.stringify(tsxCjsApiEntry)}`,
        'registerCjs()',
        'registerEsm()',
        `await import(${JSON.stringify(workerEntry.href)})`,
    ].join('\n');
    return {
        entry: new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`),
        options: {
            workerData: init,
            env: workerSpawnEnv(undefined, process.env.TSX_TSCONFIG_PATH),
            execArgv: [],
        },
    };
}
/**
 * One live worker-engine run — the seam's {@link WorkflowRun}, returned by
 * `start()` directly. Owns the Worker, the child registry, and the result
 * settlement; `result` never rejects. `meta` is trusted same-process data
 * borrowed as immutable by the handle and lifecycle events. The holder-bound
 * SubagentRuntime handle is captured before the
 * engine returns this run, so unloading the engine removes only the ability to
 * start another workflow; this run can still start and clean up its children.
 */
export class WorkerRun {
    ctx;
    subagents;
    id;
    meta;
    parent;
    provider;
    disposeGraceMs;
    observer;
    /** Settles exactly once with the run's outcome; never rejects. */
    result;
    settleResolve;
    settled = false;
    /** A Result/death/grace outcome atomically won before teardown callbacks. */
    terminalClaimed = false;
    /** The first death signal closes worker-message admission and owns failure-time cleanup. */
    workerDeathObserved = false;
    cancelReason;
    graceTimer;
    worker;
    /** Set on `exit`: the thread is gone, so posting has nowhere to go. */
    workerGone = false;
    /** Accepted `child-start` messages — the terminate-path `agentsStarted` (see module doc). */
    hostStarted = 0;
    /** Published children by callId; an entry leaves only after disposal settles. */
    children = new Map();
    /** Provider starts that have not yet fulfilled or rejected. */
    pendingStarts = new Set();
    /** Started-but-not-ended agents by seq — the pairing ledger the HOST guarantees (see {@link endAgent}). */
    liveAgents = new Map();
    quiescenceWaiters = [];
    /** The per-run abort fanout every child start request carries. */
    controller = new AbortController();
    /** External start signal and the exact callback installed on it, retained only until first settle/teardown. */
    inputSignal;
    inputSignalAbort;
    disposed;
    constructor(ctx, subagents, id, meta, parent, init, provider, disposeGraceMs, observer, signal) {
        this.ctx = ctx;
        this.subagents = subagents;
        this.id = id;
        this.meta = meta;
        this.parent = parent;
        this.provider = provider;
        this.disposeGraceMs = disposeGraceMs;
        this.observer = observer;
        this.result = new Promise((resolve) => { this.settleResolve = resolve; });
        // workerData rides the structured clone: args are plain JSON by the seam
        // contract, so the clone is total and doubles as the caller-isolation
        // copy (a clone failure throws loud out of start()).
        const { entry, options } = resolveWorkerSpawn(init);
        this.worker = new Worker(entry, options);
        this.worker.on('message', (message) => { this.onMessage(message); });
        this.worker.on('error', (error) => { this.onWorkerDeath(`workflow worker failed: ${renderThrown(error)}`, false); });
        /* v8 ignore next -- messageerror: not constructible from the engine's own protocol (every payload is JSON data) */
        this.worker.on('messageerror', (error) => { this.onWorkerDeath(`workflow worker message failed to deserialize: ${renderThrown(error)}`, false); });
        this.worker.on('exit', (code) => {
            this.workerGone = true;
            this.onWorkerDeath(`workflow worker exited before the run settled (exit code ${code})`, true);
        });
        if (signal?.aborted) {
            this.cancel('workflow start signal already aborted');
        }
        else if (signal !== undefined) {
            const onAbort = () => {
                this.detachInputSignal();
                this.cancel('workflow signal aborted');
            };
            this.inputSignal = signal;
            this.inputSignalAbort = onAbort;
            signal.addEventListener('abort', onAbort, { once: true });
        }
    }
    /**
     * Cancel the run: the worker is told (its hooks start throwing and the
     * script dies at its next await), the required signal shared by every child
     * start is aborted, and the grace timer
     * arms: a run still unsettled `disposeGraceMs` later force-settles
     * `cancelled` and its worker is TERMINATED. Idempotent; the first reason
     * wins.
     * @param reason - human-readable cause (default `'workflow cancelled'`).
     */
    cancel(reason) {
        // A settled run has nothing left to cancel, and a terminal source claimed
        // before its cleanup callbacks must exclude cancellation reentered by one
        // of those callbacks. Without the settled guard the
        // ordinary consumer path (await result, then dispose -> cancel) would arm
        // a grace timer nothing ever clears, pinning the run and its Worker
        // closure until the grace expires - a bounded leak per completed run.
        if (this.settled || this.terminalClaimed || this.cancelReason !== undefined)
            return;
        this.cancelReason = reason ?? 'workflow cancelled';
        this.post(HostToWorkerType.Cancel, { reason: this.cancelReason });
        this.abortChildren(this.cancelReason);
        this.graceTimer = setTimeout(() => {
            // Cancellation already owns the race through cancelReason; close the
            // terminal boundary explicitly before observer teardown callbacks.
            this.terminalClaimed = true;
            // The worker may no longer speak (it is about to be terminated): pair
            // every stranded start before the run settles, so ends precede
            // workflow/end.
            this.endStrandedAgents();
            this.settleResult(this.cancelledResult(this.hostStarted));
            void this.worker.terminate();
        }, this.disposeGraceMs);
        // unref'd: an armed grace timer must never hold the process open.
        this.graceTimer.unref();
    }
    /**
     * Cancel + bounded settle + termination. Host-drives every registered
     * child's disposal IMMEDIATELY — a wedged worker can relay no dispose RPC,
     * and deferring child teardown to the post-terminate reap would spend the
     * whole grace waiting for a quiescence that cannot start, then return with
     * the disposals still in flight — so child disposal overlaps the same
     * grace the worker gets to settle (the worker's own dispose RPCs join the
     * shared per-child disposal). Waits (at most the grace) for the result and
     * child quiescence, then terminates the worker unconditionally — the
     * thread never outlives its run — and reaps whatever children remain
     * (their disposal is contained, not awaited past the grace, the same
     * abandonment the seam documents for a slow-disposing child). Idempotent;
     * safe on every path.
     * @returns resolves when the run's resources are released or abandoned.
     */
    dispose() {
        if (this.disposed !== undefined)
            return this.disposed;
        // Claim the public transaction BEFORE its body invokes child/provider
        // disposal. A raw provider callback can reenter handle.dispose(); it must
        // join this promise rather than start a second traversal.
        const claimed = Promise.withResolvers();
        this.disposed = claimed.promise;
        void (async () => {
            this.detachInputSignal();
            this.cancel('workflow disposed');
            // cancel() deliberately becomes a no-op after terminal settlement, but
            // disposal still owns every registered child. Reap independently so an
            // already-settled workflow cannot wait on child quiescence before it has
            // started the surviving children's disposals. On an unsettled run this
            // joins the cancel path through the per-call cancellation/disposal gates.
            this.reapChildren('workflow disposed');
            await Promise.race([
                (async () => {
                    await this.result;
                    await this.childQuiescence();
                })(),
                sleep(this.disposeGraceMs),
            ]);
            await this.worker.terminate();
            this.reapChildren('workflow disposed');
        })().then(() => { claimed.resolve(undefined); }, 
        /* v8 ignore next -- result/quiescence never reject and Worker.terminate is the only external promise */
        (error) => { claimed.reject(error); });
        return this.disposed;
    }
    /** Post one message to the worker (payload looked up from the tag's map entry), tolerating a thread that is already gone. */
    post(type, payload) {
        if (this.workerGone || this.workerDeathObserved)
            return;
        try {
            this.worker.postMessage({ type, ...payload });
        }
        catch (error) {
            // Only a teardown race can land here (every engine message is JSON
            // data, so serialization cannot fail); there is nothing left to
            // deliver to — log and move on.
            /* v8 ignore next -- postMessage teardown race (a throw between exit and its event): not constructible in-process */
            this.ctx.logger.warn(`workflow-worker-thread: postMessage failed: ${renderThrown(error)}`);
        }
    }
    onMessage(message) {
        // Node may emit `error`, then deliver an already-queued `message`, then
        // emit `exit`. The first death signal is the host's logical delivery
        // barrier: nothing arriving afterward may create a child, narrate after
        // workflow/end, or compete with the chosen outcome.
        if (this.workerDeathObserved)
            return;
        switch (message.type) {
            case WorkerToHostType.Ready:
                this.post(HostToWorkerType.Go, {});
                break;
            case WorkerToHostType.Phase:
                // Post-cancel narration is suppressed host-side: worker-side the
                // hooks throw once the cancel message is PROCESSED, but narration
                // already in flight (or emitted while the cancel crossed the
                // boundary) must not reach observers — nothing is emitted after
                // cancel() returns.
                if (this.cancelReason === undefined)
                    this.observer.phase(message.title);
                break;
            case WorkerToHostType.Log:
                if (this.cancelReason === undefined)
                    this.observer.log(message.message);
                break;
            case WorkerToHostType.AgentStart:
                this.liveAgents.set(message.info.seq, message.info);
                this.observer.agentStart(message.info);
                break;
            case WorkerToHostType.AgentEnd:
                // NOT suppressed on cancel: cancelled children report their paired
                // agent-end with outcome 'cancelled'. The gate (with the termination
                // paths' synthesis) is what makes the one-pair-per-started-child
                // contract hold on every stop path.
                this.endAgent(message.info);
                break;
            case WorkerToHostType.ChildStart:
                this.onChildStart(message.callId, message.request);
                break;
            case WorkerToHostType.ChildDispose:
                this.onChildDispose(message.callId);
                break;
            case WorkerToHostType.Result:
                this.onResult(message.result);
                break;
            /* v8 ignore next 2 -- closed engine-owned union; the arm only makes adding a message type a compile error */
            default:
                assertNever(message, 'worker-to-host message');
        }
    }
    /** Why a ready provider result may no longer be admitted to the worker. */
    childAdmissionFailure() {
        if (this.cancelReason !== undefined) {
            return { reason: this.cancelReason, rendered: `workflow run cancelled: ${this.cancelReason}` };
        }
        if (this.workerDeathObserved) {
            return { reason: 'workflow worker gone', rendered: 'workflow worker is no longer available' };
        }
        if (this.terminalClaimed) {
            return { reason: 'workflow settled', rendered: 'workflow run already settled' };
        }
        return undefined;
    }
    onChildStart(callId, request) {
        const initialFailure = this.childAdmissionFailure();
        if (initialFailure !== undefined) {
            // Refuse after a terminal boundary: a child must never start on an
            // already-aborted signal (a provider subscribing only to future abort
            // events would never observe it).
            this.post(HostToWorkerType.ChildStartError, { callId, rendered: initialFailure.rendered });
            return;
        }
        this.hostStarted += 1;
        const task = this.startChild(callId, request);
        this.pendingStarts.add(task);
        void task.then(() => { this.finishPendingStart(task); }, 
        /* v8 ignore next -- startChild contains provider and cleanup failures */
        () => { this.finishPendingStart(task); });
    }
    /** Await one provider-owned startup transaction and publish only while admitted. */
    async startChild(callId, request) {
        let run;
        try {
            run = await this.subagents.start(this.provider, {
                prompt: [{ type: 'text', text: request.prompt }],
                parent: this.parent,
                signal: this.controller.signal,
                ...request.schema !== undefined ? { outputSchema: request.schema } : {},
                ...request.provider !== undefined || request.model !== undefined
                    ? {
                        agentOptions: {
                            ...request.provider !== undefined ? { provider: request.provider } : {},
                            ...request.model !== undefined ? { model: request.model } : {},
                        },
                    }
                    : {},
            });
        }
        catch (error) {
            const failure = this.childAdmissionFailure();
            this.post(HostToWorkerType.ChildStartError, {
                callId,
                rendered: failure?.rendered ?? renderThrown(error),
            });
            return;
        }
        const failure = this.childAdmissionFailure();
        if (failure !== undefined) {
            this.post(HostToWorkerType.ChildStartError, { callId, rendered: failure.rendered });
            try {
                await run.dispose();
            }
            catch (error) {
                this.ctx.logger.warn(`workflow-worker-thread: refused child dispose failed: ${renderThrown(error)}`);
            }
            return;
        }
        const record = { run };
        this.children.set(callId, record);
        // Attach result forwarding before publishing the child handle. Because the
        // callback itself runs in a later microtask, ChildStarted is still posted
        // first even for an already-settled scripted provider.
        const forwardResult = run.result.then((result) => {
            try {
                const snapshot = snapshotJsonValue({
                    output: result.output,
                    ...result.structured !== undefined ? { structured: result.structured } : {},
                    stopReason: result.stopReason,
                });
                if (snapshot === undefined)
                    throw new TypeError('child result is not losslessly JSON-serializable');
                return () => { this.post(HostToWorkerType.ChildSettled, { callId, result: snapshot }); };
            }
            catch (error) {
                const rendered = `workflow child result could not cross the worker boundary: ${renderThrown(error)}`;
                return () => { this.post(HostToWorkerType.ChildFailed, { callId, rendered }); };
            }
        }, (error) => {
            const rendered = renderThrown(error);
            return () => { this.post(HostToWorkerType.ChildFailed, { callId, rendered }); };
        });
        this.post(HostToWorkerType.ChildStarted, { callId, childId: run.id });
        void forwardResult.then((forward) => { forward(); });
    }
    onChildDispose(callId) {
        const record = this.children.get(callId);
        if (record === undefined) {
            // Already disposed host-side (a dispose() drive or a death reap beat
            // the RPC) — the ack is still owed (the worker-side wrapper awaits it).
            this.post(HostToWorkerType.ChildDisposed, { callId });
            return;
        }
        // disposeChild never rejects (containment is inside), so the ack always follows.
        void this.disposeChild(callId, record).then(() => { this.post(HostToWorkerType.ChildDisposed, { callId }); });
    }
    /**
     * Start (or join) one registered child's disposal; the registry entry
     * leaves when it settles. Memoized per callId: the worker's dispose RPC,
     * the dispose() host drive, and the reap can all land on the same child —
     * the child's `dispose()` runs once and every caller awaits that one
     * settlement. A rejection is contained (the subagent seam's dispose() is
     * not supposed to reject, but a backend that does anyway must not break
     * quiescence): logged, and the child still leaves the registry.
     * @param callId - the child's registry key.
     * @param record - the registered child (the caller looked it up).
     * @returns resolves when the disposal settled either way; never rejects.
     */
    disposeChild(callId, record) {
        if (record.disposal !== undefined)
            return record.disposal;
        record.disposal = Promise.resolve()
            .then(() => record.run.dispose())
            .catch((error) => {
            this.ctx.logger.warn(`workflow-worker-thread: child dispose failed: ${renderThrown(error)}`);
        })
            .then(() => { this.finishChild(callId); });
        return record.disposal;
    }
    /** Drop a child record and release quiescence waiters when all work ends. */
    finishChild(callId) {
        this.children.delete(callId);
        this.notifyChildQuiescence();
    }
    /** Retire one provider startup transaction. */
    finishPendingStart(task) {
        this.pendingStarts.delete(task);
        this.notifyChildQuiescence();
    }
    /** Release waiters only after both pending starts and published children end. */
    notifyChildQuiescence() {
        if (this.children.size !== 0 || this.pendingStarts.size !== 0)
            return;
        for (const waiter of this.quiescenceWaiters.splice(0))
            waiter();
    }
    /** Resolves once every pending start and published child has reached quiescence. */
    childQuiescence() {
        if (this.children.size === 0 && this.pendingStarts.size === 0)
            return Promise.resolve();
        return new Promise((resolve) => { this.quiescenceWaiters.push(resolve); });
    }
    /** Abort + dispose every registered child (worker death / final teardown); disposal is contained, not awaited. */
    reapChildren(reason) {
        this.abortChildren(this.cancelReason ?? reason);
        for (const [callId, record] of [...this.children]) {
            void this.disposeChild(callId, record);
        }
    }
    /** Abort the one canonical signal shared by pending and published children. */
    abortChildren(reason) {
        if (!this.controller.signal.aborted)
            this.controller.abort(reason);
    }
    onResult(result) {
        // The owned worker session sends one Result. Keep a late duplicate or a
        // Result queued behind another terminal source completely side-effect-free.
        if (this.terminalClaimed)
            return;
        // First-wins is decided when the Result message reaches the host. If no
        // external cancellation was already in flight, this result won. Reaping a
        // stray child below may synchronously reenter cancel() through provider
        // callbacks, but that internal post-result cleanup must not retroactively
        // rewrite the worker result that arrived first.
        const cancellationWasRequested = this.cancelReason !== undefined;
        // Claim before settlement cleanup invokes provider disposal. Once Result
        // won, a later cancellation cannot rewrite it.
        this.terminalClaimed = true;
        // Abort pending starts and begin disposing published children before the
        // workflow becomes externally settled. Cleanup remains independently
        // tracked by childQuiescence and the holder's dispose().
        this.reapChildren('workflow settled');
        if (!cancellationWasRequested) {
            this.settleResult(result);
            return;
        }
        if (result.stopReason !== 'cancelled') {
            // The script settled while our cancel was crossing the thread boundary
            // — the seam-visible result had NOT settled when cancellation was
            // requested, so report cancelled (the vm drive()'s post-settle check,
            // relocated to the receiving side of the race).
            this.settleResult(this.cancelledResult(result.agentsStarted));
            return;
        }
        this.settleResult(result);
    }
    /** Process an error/messageerror/exit signal; `exit` also performs the final disposal sweep. */
    onWorkerDeath(message, isExit) {
        if (!this.workerDeathObserved) {
            // Close message admission BEFORE cleanup callbacks: Node can deliver a
            // message queued before the crash after its `error` event. Treating the
            // first death signal as a logical barrier prevents that late message
            // from creating work or narrating after workflow/end.
            this.workerDeathObserved = true;
            const outcomeWasClaimed = this.terminalClaimed;
            const cancellationWasRequested = this.cancelReason !== undefined;
            // When death is itself the terminal source, claim BEFORE child reap or
            // synthesized observer callbacks. Either can reenter cancel(); a death
            // that arrived first remains an error, while a cancellation already
            // accepted before death remains cancelled. If Result/grace already won,
            // preserve it while still performing prompt failure-time cleanup.
            if (!outcomeWasClaimed)
                this.terminalClaimed = true;
            if (this.children.size > 0 || this.pendingStarts.size > 0)
                this.reapChildren('workflow worker gone');
            this.endStrandedAgents();
            if (!outcomeWasClaimed) {
                if (cancellationWasRequested) {
                    this.settleResult(this.cancelledResult(this.hostStarted));
                }
                else {
                    this.settleResult({ value: null, stopReason: 'error', error: message, agentsStarted: this.hostStarted });
                }
            }
        }
        if (!isExit)
            return;
        // `error` is not Node's physical delivery barrier: a queued message may
        // precede `exit`. Admission is already closed, so this final sweep only
        // joins/starts disposal for registry survivors; it deliberately does not
        // repeat explicit provider cancellation.
        for (const [callId, record] of [...this.children])
            void this.disposeChild(callId, record);
        this.endStrandedAgents();
    }
    /**
     * The single agent-end emission gate: forwards `end` iff its start is still
     * unpaired in the ledger, so every forwarded `workflow/agent-start` gets
     * EXACTLY one `workflow/agent-end` — the worker's own report where it can
     * speak, a host-synthesized one where it cannot ({@link endStrandedAgents}).
     * @param end - the settlement to emit (worker-reported or synthesized).
     */
    endAgent(end) {
        /* v8 ignore next -- a real end still in flight across the grace force-settle: not orderable in-process */
        if (!this.liveAgents.delete(end.seq))
            return;
        this.observer.agentEnd(end);
    }
    /**
     * Synthesize the missing `agent-end` for every started-but-unpaired agent,
     * outcome `'cancelled'`: the reap cancels every child, and a real
     * settlement racing the force-settle loses to that already-started external
     * cancellation. The atomic terminal boundaries in {@link onResult} and
     * {@link onWorkerDeath} deliberately exclude teardown callbacks as contenders.
     * Called where the worker can no longer speak (the grace force-settle,
     * worker death, physical exit). When grace/death is the terminal source it
     * runs before settleResult, so already-known pairs precede `workflow/end`;
     * after an earlier Result, exit cleanup may close a survivor afterward.
     * The ledger preserves exactly-once pairing in both orders.
     */
    endStrandedAgents() {
        for (const info of [...this.liveAgents.values()]) {
            this.endAgent({ ...info, outcome: 'cancelled' });
        }
    }
    cancelledResult(agentsStarted) {
        // cancel() is the only writer of cancelReason and every caller checks it
        // first; the fallback guards the type, not a reachable path.
        /* v8 ignore next */
        const reason = this.cancelReason ?? 'workflow cancelled';
        return { value: null, stopReason: 'cancelled', error: `workflow run cancelled: ${reason}`, agentsStarted };
    }
    /** Remove the exact abort callback installed on the caller's start signal. */
    detachInputSignal() {
        const signal = this.inputSignal;
        const onAbort = this.inputSignalAbort;
        if (signal === undefined || onAbort === undefined)
            return;
        this.inputSignal = undefined;
        this.inputSignalAbort = undefined;
        signal.removeEventListener('abort', onAbort);
    }
    /** First settle wins; disarms the grace timer and releases the caller signal. */
    settleResult(result) {
        // Every current terminal source claims ownership before calling here; keep
        // the fallback local so a future caller cannot resolve twice.
        /* v8 ignore next -- defensive fallback outside the claimed state machine */
        if (this.settled)
            return;
        this.terminalClaimed = true;
        this.settled = true;
        this.detachInputSignal();
        clearTimeout(this.graceTimer);
        this.settleResolve(result);
    }
}
/** A plain timer sleep (the dispose grace); unref'd so it never holds the process open. */
function sleep(ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref();
    });
}
//# sourceMappingURL=host.js.map