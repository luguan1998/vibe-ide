/**
 * Bounded per-session write batching for the shared persistence coordinator.
 * @module @deepseek-ai/dsh-session-persistence/write-behind
 */
/**
 * Owns one live session's pending events, fixed batching deadline, active write,
 * failure retention, and explicit quiescence barrier.
 */
export class SessionWriteBehind {
    options;
    pending = [];
    timer;
    active;
    barrier;
    deadlineExpired = false;
    automaticPaused = false;
    /**
     * @param options - fixed scheduling policy and durable batch sink.
     */
    constructor(options) {
        this.options = options;
    }
    /** Whether this controller owns queued events or an active durable write. */
    get hasWork() {
        return this.pending.length > 0 || this.active !== undefined;
    }
    /**
     * Copy one event into the persistence-owned queue and start a fixed deadline
     * when the automatic path is idle.
     * @param event - frozen live event to retain independently of its producer.
     */
    enqueue(event) {
        const wasEmpty = this.pending.length === 0;
        this.pending.push(structuredClone(event));
        if (this.barrier !== undefined)
            return;
        if (this.automaticPaused) {
            this.automaticPaused = false;
            this.deadlineExpired = false;
            this.armTimer();
        }
        else if (wasEmpty) {
            this.armTimer();
        }
    }
    /**
     * Cancel the batching wait and durably drain through a quiescent point.
     * Concurrent callers join the same barrier.
     * @returns a promise that rejects if the barrier's durable retry fails.
     */
    flush() {
        if (this.barrier !== undefined)
            return this.barrier;
        this.cancelTimer();
        this.deadlineExpired = false;
        this.automaticPaused = false;
        const barrier = Promise.withResolvers();
        this.barrier = barrier.promise;
        void this.drainBarrier(barrier.resolve, barrier.reject);
        return barrier.promise;
    }
    /** Cancel the current automatic deadline without draining retained work. */
    cancelAutomaticWait() {
        this.cancelTimer();
        this.deadlineExpired = false;
    }
    /** Start the one fixed window for the current pending prefix. */
    armTimer() {
        this.timer = setTimeout(() => { this.onDeadline(); }, this.options.maxDelayMs);
    }
    /** Cancel any pending automatic deadline. */
    cancelTimer() {
        if (this.timer === undefined)
            return;
        clearTimeout(this.timer);
        this.timer = undefined;
    }
    /** Start a background write now, or remember that an active write used the budget. */
    onDeadline() {
        this.timer = undefined;
        if (this.active !== undefined) {
            this.deadlineExpired = true;
            return;
        }
        this.startBackground();
    }
    /** Start one detached write whose failure is reported and retained. */
    startBackground() {
        const active = this.startWrite(true);
        void active.then(() => { this.continueAutomatic(); }, () => { });
    }
    /** Continue immediately after an over-budget active write, otherwise keep its timer. */
    continueAutomatic() {
        if (this.barrier !== undefined || this.pending.length === 0)
            return;
        if (this.deadlineExpired) {
            this.deadlineExpired = false;
            this.startBackground();
        }
    }
    /** Await overlapping work, drain to quiescence, and settle the shared barrier. */
    async drainBarrier(resolve, reject) {
        try {
            const overlapping = this.active;
            if (overlapping !== undefined) {
                await Promise.allSettled([overlapping]);
                this.automaticPaused = false;
            }
            while (this.pending.length > 0)
                await this.startWrite(false);
        }
        catch (error) {
            this.barrier = undefined;
            reject(error);
            return;
        }
        // Close admission to this barrier in the same job that observes the empty
        // queue, before resolving callers. A later enqueue therefore starts its own
        // automatic window instead of being stranded behind a settled barrier.
        this.barrier = undefined;
        resolve();
    }
    /** Start one stable pending prefix, retaining it in order if durability fails. */
    startWrite(background) {
        const batch = this.pending.splice(0);
        this.cancelTimer();
        this.deadlineExpired = false;
        const operation = Promise.resolve().then(() => this.options.write(batch));
        const active = operation
            .catch((error) => {
            this.pending = batch.concat(this.pending);
            this.cancelTimer();
            this.deadlineExpired = false;
            this.automaticPaused = true;
            if (background)
                this.options.reportBackgroundFailure(error);
            throw error;
        })
            .finally(() => {
            this.active = undefined;
        });
        this.active = active;
        return active;
    }
}
//# sourceMappingURL=write-behind.js.map