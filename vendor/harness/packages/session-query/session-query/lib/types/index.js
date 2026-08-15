/**
 * Service Definition for combined session-history reads, traces, filters, and full-text search.
 *
 * @module @deepseek-ai/dsh-session-query
 */
import { Service } from '@deepseek-ai/cordis';
import { Session, snapshotSessionEvent } from '@deepseek-ai/dsh-session';
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title';
import { SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY, SESSION_QUERY_READ_WINDOW_MAX, SessionQueryError, } from "./config.js";
import { SessionCorpus } from "./corpus.js";
import { buildSessionEventSearchDocuments } from "./documents.js";
import { filterSessionEventDocuments, filterSessionResults, materializeSessionEventResultFilters, materializeSessionResultFilters, } from "./filters.js";
import * as tracing from "./tracing.js";
export { SessionSearchCursor } from "./cursor.js";
export { SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY, SESSION_QUERY_READ_WINDOW_MAX, SessionQueryError, } from "./config.js";
export { extractSessionEventText } from "./extraction.js";
export { buildSessionEventRecords, buildSessionEventSearchDocuments } from "./documents.js";
export { compileSessionTextFilter, filterSessionEventDocuments, filterSessionResults, materializeSessionEventResultFilters, materializeSessionResultFilters, } from "./filters.js";
export { assertSessionHeadersCompatible } from "./sources.js";
/**
 * Unified live-preferred session query service.
 *
 * Exact reads, filters, and traces are backend-independent concrete behavior.
 * A backend implements full-text observation, reconciliation, ranking, cursor
 * generations, and query execution on the same `ctx.sessionQuery` service.
 */
export class SessionQueryEngine extends Service {
    static inject = ['sessions'];
    _readWindowMax;
    _corpus;
    constructor(ctx, config = {}) {
        super(ctx, 'sessionQuery');
        this._readWindowMax = config.readWindowMax ?? SESSION_QUERY_READ_WINDOW_MAX;
        if (!Number.isInteger(this._readWindowMax) || this._readWindowMax < 0) {
            throw new SessionQueryError('session-query: readWindowMax must be a non-negative integer', 'SESSION_QUERY_INVALID_CONFIG');
        }
        const persistedInspectConcurrency = config.persistedInspectConcurrency
            ?? SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY;
        if (!Number.isSafeInteger(persistedInspectConcurrency) || persistedInspectConcurrency < 1) {
            throw new SessionQueryError('session-query: persistedInspectConcurrency must be a positive safe integer', 'SESSION_QUERY_INVALID_CONFIG');
        }
        this._corpus = new SessionCorpus(ctx, persistedInspectConcurrency);
    }
    /**
     * List the complete logical corpus using live-preferred records.
     * @param signal - optional cancellation for persistence listing.
     * @returns deterministic newest-first cloned session records.
     */
    listSessions(signal) {
        return this._corpus.listSessions(signal);
    }
    /**
     * Read and replay-validate one complete logical session log without making it live.
     * @param sessionId - live or persisted session id to read.
     * @returns cloned header and complete raw event log from one observation.
     * @throws when persistence, header compatibility, or replay validation fails.
     */
    async readSession(sessionId) {
        const loaded = await this._corpus.load(sessionId);
        Session.create(sessionId, loaded.events, loaded.header);
        return {
            session: structuredClone(loaded.header),
            events: loaded.events.map(snapshotSessionEvent),
        };
    }
    /**
     * Filter the complete logical corpus with provider-independent predicates.
     * @param filters - ANDed session metadata and availability clauses.
     * @param signal - optional cancellation for persistence listing.
     * @returns matching cloned records in deterministic newest-first order.
     */
    async filterSessions(filters, signal) {
        const ownedFilters = materializeSessionResultFilters(filters);
        return this._filterSessions(ownedFilters, signal);
    }
    /**
     * Fold the latest log-backed title from one live-preferred logical session.
     * @param sessionId - live or persisted session id to read.
     * @param signal - optional cancellation for source resolution and title folding.
     * @returns latest title snapshot, or `undefined` when the log has no title event.
     */
    async readTitle(sessionId, signal) {
        return (await this.readTitleSnapshot(sessionId, signal)).title;
    }
    /**
     * Fold the latest title and return its source header from one corpus observation.
     * @param sessionId - live or persisted session id to read.
     * @param signal - optional cancellation for source resolution and title folding.
     * @returns cloned source header and optional latest title snapshot.
     */
    async readTitleSnapshot(sessionId, signal) {
        const result = (await this.readTitleSnapshots([sessionId], signal))[0];
        if (result.status === 'rejected')
            throw result.reason;
        return result.value;
    }
    /**
     * Fold titles for unique sessions from one cancellable corpus observation.
     *
     * Results preserve first-occurrence input order. Operational failures stay
     * isolated per session, while cancellation rejects the complete operation.
     * @param sessionIds - live or persisted session ids to observe.
     * @param signal - optional cancellation shared by all source reads.
     * @returns one fulfilled or rejected result per unique requested id.
     */
    async readTitleSnapshots(sessionIds, signal) {
        return this._corpus.projectMany(sessionIds, (source) => {
            const title = foldSessionTitle(source.events);
            return {
                session: structuredClone(source.header),
                ...title === undefined ? {} : { title },
            };
        }, signal);
    }
    /**
     * List lightweight raw-log event records for one logical session.
     * @param sessionId - live-preferred session id to read.
     * @returns event records in ascending seq order.
     */
    async listEvents(sessionId) {
        const loaded = await this._corpus.load(sessionId);
        return tracing.eventRecords(sessionId, loaded.events);
    }
    /**
     * Scan first-party semantic event documents with provider-independent filters.
     * @param sessionId - live-preferred session id to scan.
     * @param filters - ANDed metadata and literal-text predicates.
     * @returns matching semantic documents in ascending seq order.
     */
    async filterEvents(sessionId, filters) {
        const ownedFilters = materializeSessionEventResultFilters(filters);
        return this._filterEvents(sessionId, ownedFilters);
    }
    async _filterSessions(filters, signal) {
        return filterSessionResults(await this._corpus.listSessions(signal), filters);
    }
    async _filterEvents(sessionId, filters) {
        const loaded = await this._corpus.load(sessionId);
        const documents = buildSessionEventSearchDocuments(sessionId, loaded.events);
        return filterSessionEventDocuments(documents, filters);
    }
    /**
     * Read one session's complete current model surface from one corpus observation.
     * @param sessionId - live-preferred session id to read.
     * @returns cloned header, current surface, and the last sequence number included in the raw-log capture.
     * @throws when source resolution fails or the session surface is invalid.
     */
    async readSurface(sessionId) {
        const loaded = await this._corpus.load(sessionId);
        return {
            session: structuredClone(loaded.header),
            capturedThroughSeq: loaded.events.at(-1)?.seq ?? null,
            events: tracing.currentSurfaceEvents(sessionId, loaded.events),
        };
    }
    /**
     * Trace known ancestry and descendants from one corpus observation.
     * @param sessionId - logical session id to trace.
     * @param signal - optional cancellation for persistence listing.
     * @returns a complete lineage or the first parent that could not be resolved.
     * @throws when corpus resolution fails, the target is absent, or its known ancestry cycles.
     */
    async traceSession(sessionId, signal) {
        const records = await this._corpus.listSessions(signal);
        signal?.throwIfAborted();
        return tracing.traceSession(records, sessionId);
    }
    /**
     * Trace one event's direct positional replacements and cited source events.
     * @param request - target session id and event seq.
     * @param signal - optional cancellation for persisted source resolution.
     * @returns source header, direct links, and the target's positional replacement chain.
     * @throws when source resolution fails, the target is absent, or surface/source-event validation fails.
     */
    async traceEvent(request, signal) {
        const loaded = await this._corpus.load(request.sessionId, signal);
        signal?.throwIfAborted();
        return {
            session: loaded.header,
            ...tracing.traceEvent(request.sessionId, loaded.events, request.seq),
        };
    }
    /**
     * Read one full event plus a bounded raw-log context window.
     * @param request - target session/seq and context sizes.
     * @param signal - optional cancellation for persisted source resolution.
     * @returns cloned target and neighboring events.
     */
    async readEvent(request, signal) {
        const before = this._readWindow('before', request.before);
        const after = this._readWindow('after', request.after);
        const sessionId = request.sessionId;
        const seq = request.seq;
        return this._readEvent(sessionId, seq, before, after, signal);
    }
    async _readEvent(sessionId, seq, before, after, signal) {
        const loaded = await this._corpus.load(sessionId, signal);
        signal?.throwIfAborted();
        const target = loaded.events[seq];
        if (target === undefined || target.seq !== seq) {
            throw new SessionQueryError(`session "${sessionId}" has no event at seq ${seq}`, 'SESSION_QUERY_EVENT_NOT_FOUND');
        }
        const startSeq = Math.max(0, seq - before);
        const endSeq = Math.min(loaded.events.length - 1, seq + after);
        const targetSnapshot = snapshotSessionEvent(target);
        const events = loaded.events.slice(startSeq, endSeq + 1)
            .map(event => event === target
            ? targetSnapshot
            : snapshotSessionEvent(event));
        return {
            session: structuredClone(loaded.header),
            target: targetSnapshot,
            events,
            startSeq,
            endSeq,
        };
    }
    _readWindow(name, value) {
        if (value === undefined)
            return 0;
        if (!Number.isInteger(value) || value < 0 || value > this._readWindowMax) {
            throw new SessionQueryError(`${name} must be an integer between 0 and ${this._readWindowMax}`, 'SESSION_QUERY_INVALID_WINDOW');
        }
        return value;
    }
}
export default SessionQueryEngine;
//# sourceMappingURL=index.js.map