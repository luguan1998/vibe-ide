/**
 * Bounded sharing and exclusive reservation of unpublished Sessions.
 * @module @deepseek-ai/dsh-session-persistence/preparations
 */
/** Per-coordinator cold-read sharing, exclusive reservation, and ready-entry LRU. */
export class SessionPreparations {
    capacity;
    entries = new Map();
    constructor(capacity) {
        this.capacity = capacity;
    }
    /**
     * Whether this pool currently knows about an unpublished identity.
     * @param id - session identity.
     * @returns whether an entry exists for the identity.
     */
    has(id) {
        return this.entries.has(id);
    }
    /**
     * Observe one prepared source, sharing an in-flight read for the same id.
     * @param id - session identity.
     * @param load - cold loader used when no entry exists.
     * @param signal - optional cancellation signal while waiting.
     * @returns the shared prepared source.
     */
    async inspect(id, load, signal) {
        const entry = this.entryFor(id, load);
        const loaded = signal === undefined
            ? await entry.result
            : await observeQueuedAbort(entry.result, signal);
        const source = entry.source ?? loaded;
        if (this.entries.get(id) === entry && entry.phase === 'ready')
            this.touch(entry);
        return source;
    }
    /**
     * Reserve one ready source after committing its pending durable repair.
     * @param id - session identity.
     * @param load - cold loader used when no entry exists.
     * @param commit - durable repair and cursor-state commit.
     * @param signal - optional cancellation signal while waiting.
     * @returns the exclusive reservation, or undefined if its entry was invalidated.
     */
    async reserve(id, load, commit, signal) {
        const entry = this.entryFor(id, load);
        await (signal === undefined ? entry.result : observeQueuedAbort(entry.result, signal));
        while (this.entries.get(id) === entry && entry.phase !== 'ready') {
            const settled = entry.reservationSettled;
            /* v8 ignore next -- committing/reserved transitions install this waiter synchronously. */
            if (settled === undefined)
                throw new Error(`session "${id}" preparation lost its reservation waiter`);
            if (signal === undefined)
                await settled;
            else
                await observeQueuedAbort(settled, signal);
        }
        if (this.entries.get(id) !== entry)
            return undefined;
        const source = entry.source;
        const reservationSettled = Promise.withResolvers();
        entry.phase = 'committing';
        entry.reservationSettled = reservationSettled.promise;
        entry.settleReservation = reservationSettled.resolve;
        let committed;
        try {
            committed = await commit(source);
        }
        catch (error) {
            this.remove(entry);
            throw error;
        }
        if (committed === undefined) {
            this.remove(entry);
            return undefined;
        }
        entry.source = committed.source;
        try {
            signal?.throwIfAborted();
        }
        catch (error) {
            this.makeReady(entry);
            throw error;
        }
        if (this.entries.get(id) !== entry)
            return undefined;
        const reservation = {
            entry,
            source: committed.source,
            state: committed.state,
        };
        entry.phase = 'reserved';
        entry.reservation = reservation;
        return reservation;
    }
    /**
     * Return the exact reservation for Session publication, rejecting aliases.
     * @param session - exact Session candidate for publication.
     * @returns its reservation, or undefined when no preparation exists.
     */
    reservationFor(session) {
        const entry = this.entries.get(session.id);
        if (entry === undefined)
            return undefined;
        if (entry.phase === 'reserved'
            && entry.source?.session === session
            && entry.reservation !== undefined) {
            return entry.reservation;
        }
        throw new Error(`cannot publish session "${session.id}": persisted state already owns this identity`);
    }
    /**
     * Consume a reservation after its exact Session has attached.
     * @param reservation - reservation to consume.
     */
    attach(reservation) {
        const { entry } = reservation;
        if (this.entries.get(entry.id) !== entry || entry.reservation !== reservation) {
            throw new Error(`session "${entry.id}" preparation is no longer reserved`);
        }
        this.remove(entry);
    }
    /**
     * Consume a reservation whose caller only needs the committed inspection.
     * @param reservation - reservation to consume.
     */
    discard(reservation) {
        const { entry } = reservation;
        if (this.entries.get(entry.id) !== entry || entry.reservation !== reservation)
            return;
        this.remove(entry);
    }
    /**
     * Return a reusable unpublished reservation to the ready LRU.
     * @param reservation - reservation to release.
     * @param reusable - whether the source remains valid for reuse.
     */
    release(reservation, reusable) {
        const { entry } = reservation;
        if (this.entries.get(entry.id) !== entry
            || entry.reservation !== reservation
            || entry.phase !== 'reserved')
            return;
        if (!reusable) {
            this.remove(entry);
            return;
        }
        delete entry.reservation;
        this.makeReady(entry);
    }
    /**
     * Discard a prepared view after the durable log changes.
     * @param id - changed session identity.
     */
    invalidate(id) {
        const entry = this.entries.get(id);
        if (entry !== undefined)
            this.remove(entry);
    }
    /**
     * Discard an exact stale ready source without disturbing an exclusive owner.
     * @param id - changed session identity.
     * @param expected - exact source observed before its revision check.
     * @returns whether the source was discarded, retained by a reservation, or is absent.
     */
    discardReady(id, expected) {
        const entry = this.entries.get(id);
        if (entry === undefined || entry.source !== expected)
            return 'missing';
        if (entry.phase !== 'ready')
            return 'retained';
        this.remove(entry);
        return 'discarded';
    }
    /**
     * Reject writes while an unpublished Session exclusively reserves the id.
     * @param id - session identity to check.
     */
    assertWritable(id) {
        const phase = this.entries.get(id)?.phase;
        if (phase === 'committing' || phase === 'reserved') {
            throw new Error(`cannot append session "${id}" while its persisted preparation is reserved`);
        }
    }
    /**
     * Remove a completed entry for an already-serialized append adoption.
     * @param id - adopted session identity.
     * @returns the prepared source, or undefined when no ready entry exists.
     */
    takeReady(id) {
        const entry = this.entries.get(id);
        if (entry === undefined || entry.phase !== 'ready' || entry.source === undefined)
            return undefined;
        this.remove(entry);
        return entry.source;
    }
    entryFor(id, load) {
        const existing = this.entries.get(id);
        if (existing !== undefined)
            return existing;
        const deferred = Promise.withResolvers();
        const entry = {
            id,
            result: deferred.promise,
            phase: 'loading',
        };
        this.entries.set(id, entry);
        let loading;
        try {
            // Start immediately so a same-tick serialized append queues behind this
            // read. The deferred result settles only after the entry becomes ready.
            loading = load();
        }
        catch (error) {
            this.remove(entry);
            deferred.reject(error);
            return entry;
        }
        void loading.then((source) => {
            if (this.entries.get(id) === entry) {
                entry.source = source;
                this.makeReady(entry);
            }
            deferred.resolve(source);
        }, (error) => {
            this.remove(entry);
            deferred.reject(error);
        });
        return entry;
    }
    makeReady(entry) {
        if (this.entries.get(entry.id) !== entry)
            return;
        entry.phase = 'ready';
        const settle = entry.settleReservation;
        delete entry.reservationSettled;
        delete entry.settleReservation;
        settle?.();
        this.touch(entry);
    }
    remove(entry) {
        if (this.entries.get(entry.id) !== entry)
            return;
        this.entries.delete(entry.id);
        const settle = entry.settleReservation;
        delete entry.reservationSettled;
        delete entry.settleReservation;
        settle?.();
    }
    touch(entry) {
        this.entries.delete(entry.id);
        this.entries.set(entry.id, entry);
        let readyCount = 0;
        for (const candidate of this.entries.values()) {
            if (candidate.phase === 'ready')
                readyCount += 1;
        }
        if (readyCount <= this.capacity)
            return;
        for (const [id, candidate] of this.entries) {
            if (candidate.phase !== 'ready')
                continue;
            this.entries.delete(id);
            return;
        }
    }
}
/**
 * Give a queued observer a prompt cancellation view without cancelling shared work.
 * @param operation - shared operation whose settlement remains authoritative.
 * @param signal - observer-local cancellation signal.
 * @param started - whether the operation has crossed its cancellation cutoff.
 * @returns the operation result or the observer's prompt cancellation.
 */
export function observeQueuedAbort(operation, signal, started = () => false) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            callback();
        };
        const onAbort = () => {
            if (started())
                return;
            finish(() => {
                try {
                    signal.throwIfAborted();
                }
                catch (reason) {
                    rejectObservation(reject, reason);
                    return;
                }
                /* v8 ignore next -- a native AbortSignal emits abort only after becoming aborted. */
                reject(new Error('queued observation abort event lacked an aborted signal'));
            });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        operation.then((value) => { finish(() => { resolve(value); }); }, (reason) => {
            finish(() => { rejectObservation(reject, reason); });
        });
        if (signal.aborted)
            onAbort();
    });
}
/** Preserve an exact loader or AbortSignal reason, including legacy non-Error values. */
function rejectObservation(reject, reason) {
    reject(reason);
}
//# sourceMappingURL=preparations.js.map