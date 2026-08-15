/**
 * Concrete session-query service with SQLite FTS5 over the live-preferred corpus.
 *
 * @module @deepseek-ai/dsh-session-query-sqlite
 */
import { createHash, randomUUID } from 'node:crypto';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import SessionQueryEngine, { SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY, SESSION_QUERY_READ_WINDOW_MAX, SessionQueryError, SessionSearchCursor, assertSessionHeadersCompatible, buildSessionEventSearchDocuments, } from '@deepseek-ai/dsh-session-query';
import { openSearchDatabase, } from "./schema.js";
import { FTS_HIGHLIGHT_END, FTS_HIGHLIGHT_START, assertFts5OuterPredicateCount, assertPortableBindingCount, buildEventWhere, buildSessionWhere, makeSnippet, normalizeEventRequest, normalizeSessionRequest, quoteFtsData, requestFingerprint, sanitizeFtsText, SQLITE_MAX_PAGE_LIMIT, } from "./query.js";
export { SESSION_QUERY_SQLITE_APPLICATION_ID, SESSION_QUERY_SQLITE_SCHEMA_VERSION, } from "./schema.js";
/** Boot-context slot for a launcher-owned absolute path to this process's derived query index. */
export const SESSION_QUERY_SQLITE_PATH_KEY = 'launcherSessionQueryPath';
/** Default result page size. */
export const SESSION_QUERY_SQLITE_DEFAULT_LIMIT = 20;
/** Maximum accepted result page size. */
export const SESSION_QUERY_SQLITE_MAX_LIMIT = 100;
/** Default maximum snippet length in Unicode code points. */
export const SESSION_QUERY_SQLITE_SNIPPET_CHARS = 240;
// One transient source change gets a retry; repeated churn fails rather than monopolizing the queue.
const STABLE_OBSERVATION_ATTEMPTS = 2;
/** Concrete SQLite owner of the combined `ctx.sessionQuery` service. */
export class SqliteSessionQueryEngine extends SessionQueryEngine {
    static inject = ['sessions'];
    static Config = z.object({
        path: z.string().required(),
        openAt: z.union(['startup', 'first-search', 'never']).default('startup'),
        journalMode: z.union(['wal', 'delete', 'truncate', 'persist']).default('wal'),
        defaultLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(SESSION_QUERY_SQLITE_DEFAULT_LIMIT),
        maxLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(SESSION_QUERY_SQLITE_MAX_LIMIT),
        snippetChars: z.number().step(1).min(1).default(SESSION_QUERY_SQLITE_SNIPPET_CHARS),
        readWindowMax: z.number().step(1).min(0).default(SESSION_QUERY_READ_WINDOW_MAX),
        persistedInspectConcurrency: z.number()
            .step(1)
            .min(1)
            .max(Number.MAX_SAFE_INTEGER)
            .default(SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY),
    });
    /** Validated and defaulted backend configuration. */
    config;
    _instance = randomUUID();
    _ready;
    _db;
    _persistenceBinding = { identity: Symbol() };
    _lastPersistenceIdentity;
    _persistenceEpoch = 0;
    _globalGeneration = 0;
    _localGeneration = 0;
    _tail = Promise.resolve();
    _closed = false;
    _closePromise;
    _optionalPersistenceFiber;
    constructor(ctx, config) {
        // The assignment expression resolves before the base constructor can
        // register `ctx.sessionQuery`; keep that same validated value afterward.
        super(ctx, config = resolveConfig(config));
        this.config = config;
        this._optionalPersistenceFiber = ctx.inject(['sessionPersistence'], (childCtx) => {
            const service = childCtx.sessionPersistence;
            const binding = { identity: Symbol(), service };
            this._persistenceBinding = binding;
            childCtx.effect(() => () => {
                /* v8 ignore next -- a stale optional-service disposer cannot clear a replacement */
                if (this._persistenceBinding !== binding)
                    return;
                this._persistenceBinding = { identity: Symbol() };
            }, 'sessionQuerySqlite.persistenceBinding');
        });
        ctx.effect(() => {
            return () => this._optionalPersistenceFiber.dispose();
        }, 'sessionQuerySqlite.optionalPersistence');
        ctx.effect(() => async () => this.close(), 'sessionQuerySqlite.close');
    }
    /** Open eagerly only when activation owns the configured readiness boundary. */
    async [Service.init]() {
        if (this.config.openAt === 'startup')
            await this._ensureReady(undefined);
    }
    async searchSessions(request, exec) {
        this._assertSearchEnabled();
        const normalized = normalizeSessionRequest(request, this.config);
        const signal = exec?.signal;
        return this._serialized(signal, async () => {
            await this._ensureReady(signal);
            const persistenceBinding = await this._reconcile(signal);
            assertNotAborted(signal);
            const generation = String(this._globalGeneration);
            const fingerprint = requestFingerprint(normalized);
            const offset = normalized.cursor === undefined
                ? 0
                : decodeCursor(normalized.cursor, this._instance, 'sessions', fingerprint, generation);
            const rows = this._querySessions(normalized, offset, persistenceBinding);
            return page(rows, normalized.limit, row => this._sessionHit(row), cursorOffset => encodeCursor({
                version: 1,
                instance: this._instance,
                scope: 'sessions',
                fingerprint,
                generation,
                offset: cursorOffset,
            }), offset);
        });
    }
    async searchEvents(request, exec) {
        this._assertSearchEnabled();
        const normalized = normalizeEventRequest(request, this.config);
        const signal = exec?.signal;
        return this._serialized(signal, async () => {
            await this._ensureReady(signal);
            const persistenceBinding = await this._reconcile(signal);
            assertNotAborted(signal);
            const target = this._targetObservation(normalized.sessionId, persistenceBinding);
            const fingerprint = requestFingerprint(normalized);
            const offset = normalized.cursor === undefined
                ? 0
                : decodeCursor(normalized.cursor, this._instance, 'events', fingerprint, target.generation);
            const rows = this._queryEvents(normalized, offset, persistenceBinding);
            return {
                session: target.header,
                ...page(rows, normalized.limit, row => this._eventHit(row), cursorOffset => encodeCursor({
                    version: 1,
                    instance: this._instance,
                    scope: 'events',
                    fingerprint,
                    generation: target.generation,
                    offset: cursorOffset,
                }), offset),
            };
        });
    }
    /** Close the database after every accepted operation reaches quiescence. */
    close() {
        this._closePromise ??= this._close();
        return this._closePromise;
    }
    /**
     * Refuse full-text calls under `openAt: 'never'` before any request
     * normalization or SQLite work, so a disabled deployment never imports
     * node:sqlite, opens the index, or observes sources.
     */
    _assertSearchEnabled() {
        if (this.config.openAt !== 'never')
            return;
        throw new SessionQueryError('session search is disabled: this deployment configures the session-query index with openAt "never"', 'SESSION_QUERY_SEARCH_DISABLED');
    }
    async _close() {
        this._closed = true;
        await this._tail;
        if (this._ready !== undefined) {
            try {
                await this._ready;
            }
            catch {
                // Opening already closed a partially-created handle; disposal only waits.
            }
        }
        this._db?.close();
        this._db = undefined;
    }
    async _open() {
        this._db = await openSearchDatabase(this.config.path, this.config.journalMode);
        const state = this._db.prepare('SELECT global_generation FROM search_state WHERE singleton = 1').get();
        this._globalGeneration = state.global_generation;
        this._localGeneration = state.global_generation;
    }
    async _ensureReady(signal) {
        this._ready ??= this._open();
        try {
            await waitWithAbort(this._ready, signal);
        }
        catch (error) {
            if (isAbort(error))
                throw error;
            throw new SessionQueryError(`session-search SQLite index failed to open: ${errorMessage(error)}`, 'SESSION_QUERY_INDEX_FAILED', { cause: error });
        }
    }
    async _serialized(signal, operation) {
        if (this._isClosed())
            throw indexClosed();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const prior = this._tail;
        this._tail = prior.then(() => gate);
        try {
            await waitWithAbort(prior, signal);
        }
        catch (error) {
            release();
            throw error;
        }
        if (this._isClosed()) {
            release();
            throw indexClosed();
        }
        try {
            assertNotAborted(signal);
            return await operation();
        }
        finally {
            release();
        }
    }
    async _reconcile(signal) {
        assertNotAborted(signal);
        const db = this._requireDb();
        const persistedRows = db.prepare('SELECT id, revision, generation FROM persisted_sessions').all();
        const liveRows = db.prepare('SELECT id, fingerprint, persisted, generation FROM temp.live_sessions').all();
        const persistedById = new Map(persistedRows.map(row => [row.id, row]));
        const liveById = new Map(liveRows.map(row => [row.id, row]));
        const observation = await this._observeStable(persistedById, signal);
        assertNotAborted(signal);
        const persistentChanges = observation.persistenceBinding.service === undefined
            ? []
            : [...observation.persisted.values()].filter(entry => entry.loaded !== undefined);
        const persistentDeletes = observation.persistenceBinding.service === undefined
            ? []
            : persistedRows.filter(row => !observation.persisted.has(row.id));
        const liveChanges = [...observation.live.values()].filter((entry) => {
            const indexed = liveById.get(entry.header.id);
            const persisted = observation.persisted.has(entry.header.id) ? 1 : 0;
            return indexed?.fingerprint !== entry.fingerprint || indexed.persisted !== persisted;
        });
        const liveDeletes = liveRows.filter(row => !observation.live.has(row.id));
        const pointerChanged = this._lastPersistenceIdentity !== undefined
            && this._lastPersistenceIdentity !== observation.persistenceBinding.identity;
        const hasWrites = persistentChanges.length > 0
            || persistentDeletes.length > 0
            || liveChanges.length > 0
            || liveDeletes.length > 0;
        let nextMainGeneration = this._mainGeneration();
        let nextLocalGeneration = this._localGeneration;
        if (persistentChanges.length > 0 || persistentDeletes.length > 0)
            nextMainGeneration += 1;
        const liveReplacements = liveChanges.map((entry) => {
            nextLocalGeneration = Math.max(nextLocalGeneration, nextMainGeneration) + 1;
            return {
                entry,
                generation: nextLocalGeneration,
                persisted: observation.persisted.has(entry.header.id),
            };
        });
        if (hasWrites) {
            let began = false;
            try {
                db.exec('BEGIN IMMEDIATE');
                began = true;
                for (const row of persistentDeletes)
                    this._deleteSession('persisted', row.id);
                for (const entry of persistentChanges) {
                    /* v8 ignore next -- observation loads every entry whose revision differs */
                    if (entry.loaded === undefined)
                        throw new Error(`missing loaded revision for session "${entry.header.id}"`);
                    this._replacePersistedSession(entry.loaded, entry.revision, nextMainGeneration);
                }
                if (persistentChanges.length > 0 || persistentDeletes.length > 0) {
                    db.prepare('UPDATE search_state SET global_generation = ? WHERE singleton = 1').run(nextMainGeneration);
                }
                for (const row of liveDeletes)
                    this._deleteSession('live', row.id);
                for (const { entry, generation, persisted } of liveReplacements) {
                    this._replaceLiveSession(entry, generation, persisted);
                }
                db.exec('COMMIT');
            }
            catch (error) {
                /* v8 ignore next -- a BEGIN failure has no transaction to roll back; the common wrapper still reports it. */
                if (began) {
                    /* v8 ignore next 5 -- ROLLBACK failure requires a SQLite double fault; the original failure remains actionable. */
                    try {
                        db.exec('ROLLBACK');
                    }
                    catch {
                        // The original SQLite failure remains the actionable cause.
                    }
                }
                throw new SessionQueryError(`session-search reconciliation failed: ${errorMessage(error)}`, 'SESSION_QUERY_INDEX_FAILED', { cause: error });
            }
        }
        if (hasWrites || pointerChanged)
            this._globalGeneration += 1;
        if (pointerChanged)
            this._persistenceEpoch += 1;
        this._localGeneration = nextLocalGeneration;
        this._lastPersistenceIdentity = observation.persistenceBinding.identity;
        return observation.persistenceBinding;
    }
    async _observeStable(indexed, signal) {
        for (let attempt = 0; attempt < STABLE_OBSERVATION_ATTEMPTS; attempt += 1) {
            assertNotAborted(signal);
            const persistenceBinding = this._persistenceBinding;
            const persistence = persistenceBinding.service;
            const initiallyLive = new Set(this.ctx.sessions.list().map(session => session.id));
            let persisted = new Map();
            if (persistence !== undefined) {
                try {
                    const canReuseIndexed = this._lastPersistenceIdentity === undefined
                        || this._lastPersistenceIdentity === persistenceBinding.identity;
                    const before = await persistence.listSnapshots(signal);
                    assertNotAborted(signal);
                    persisted = materializePersistenceSnapshots(before);
                    for (const entry of persisted.values()) {
                        if (canReuseIndexed && indexed.get(entry.header.id)?.revision === entry.revision)
                            continue;
                        // Skip work already shadowed by a live owner. `inspect()` is
                        // non-mutating, so an owner attaching after this check cannot cause
                        // crash-repair side effects; the live-membership retry below makes
                        // the returned observation live-preferred.
                        if (initiallyLive.has(entry.header.id) || this.ctx.sessions.get(entry.header.id) !== undefined)
                            continue;
                        assertNotAborted(signal);
                        const loaded = await persistence.inspect(entry.header.id, signal);
                        assertNotAborted(signal);
                        assertSessionHeadersCompatible(entry.header, loaded.meta);
                        entry.loaded = observeSession(loaded.meta, loaded.events);
                    }
                    assertNotAborted(signal);
                    const afterSnapshots = await persistence.listSnapshots(signal);
                    assertNotAborted(signal);
                    const after = materializePersistenceSnapshots(afterSnapshots);
                    if (!samePersistenceSnapshots(persisted, after))
                        continue;
                    if (this._persistenceBinding !== persistenceBinding)
                        continue;
                }
                catch (error) {
                    if (isAbort(error) || signal?.aborted) {
                        throw new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED', {
                            cause: error,
                        });
                    }
                    if (this._persistenceBinding !== persistenceBinding)
                        continue;
                    if (error instanceof SessionQueryError)
                        throw error;
                    throw new SessionQueryError(`session-search persistence observation failed: ${errorMessage(error)}`, 'SESSION_QUERY_PERSISTENCE_FAILED', { cause: error });
                }
            }
            const live = new Map();
            for (const session of this.ctx.sessions.list()) {
                const observed = observeLive(session);
                const durable = persisted.get(session.id);
                if (durable !== undefined)
                    assertSessionHeadersCompatible(observed.header, durable.header);
                live.set(session.id, observed);
            }
            if (!sameSessionIds(initiallyLive, live))
                continue;
            return { persistenceBinding, persisted, live };
        }
        throw new SessionQueryError('session-search persistence observation did not stabilize after one retry', 'SESSION_QUERY_PERSISTENCE_FAILED');
    }
    _mainGeneration() {
        const row = this._requireDb().prepare('SELECT global_generation FROM search_state WHERE singleton = 1').get();
        return row.global_generation;
    }
    _deleteSession(source, id) {
        const db = this._requireDb();
        if (source === 'persisted') {
            db.prepare('DELETE FROM persisted_docs WHERE session_id = ?').run(id);
            db.prepare('DELETE FROM persisted_sessions WHERE id = ?').run(id);
        }
        else {
            db.prepare('DELETE FROM temp.live_docs WHERE session_id = ?').run(id);
            db.prepare('DELETE FROM temp.live_sessions WHERE id = ?').run(id);
        }
    }
    _replacePersistedSession(entry, revision, generation) {
        this._deleteSession('persisted', entry.header.id);
        const db = this._requireDb();
        db.prepare(`
      INSERT INTO persisted_sessions
        (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, revision, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...headerBindings(entry.header), revision, generation);
        const insert = db.prepare(`
      INSERT INTO persisted_docs (text, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        for (const document of entry.documents) {
            const text = sanitizeFtsText(document.text);
            insert.run(text, document.sessionId, document.seq, document.type, document.time, document.surface, Array.from(text).length);
        }
    }
    _replaceLiveSession(entry, generation, persisted) {
        this._deleteSession('live', entry.header.id);
        const db = this._requireDb();
        db.prepare(`
      INSERT INTO temp.live_sessions
        (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, fingerprint, persisted, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...headerBindings(entry.header), entry.fingerprint, persisted ? 1 : 0, generation);
        const insert = db.prepare(`
      INSERT INTO temp.live_docs (text, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        for (const document of entry.documents) {
            const text = sanitizeFtsText(document.text);
            insert.run(text, document.sessionId, document.seq, document.type, document.time, document.surface, Array.from(text).length);
        }
    }
    _querySessions(request, offset, persistenceBinding) {
        const selected = selectedDocumentsSql();
        const sessionWhere = buildSessionWhere(request.sessionFilters);
        const eventWhere = buildEventWhere(request.eventFilters);
        assertFts5OuterPredicateCount(sessionWhere.predicateCount + eventWhere.predicateCount);
        const where = [sessionWhere.sql, eventWhere.sql].filter(Boolean).join(' AND ');
        const bindings = [
            ...selectedDocumentsParams(request.query, persistenceBinding.service !== undefined),
            ...sessionWhere.params,
            ...eventWhere.params,
            request.limit + 1,
            offset,
        ];
        assertPortableBindingCount(bindings.length);
        // The browser fixture mirrors these rank keys in
        // `packages/client/connection/src/client/fixture.ts`; update both together.
        return this._requireDb().prepare(`
      ${selected.sql},
      filtered AS (
        SELECT * FROM matched ${where.length === 0 ? '' : `WHERE ${where}`}
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY session_id
          ORDER BY match_count DESC, document_length ASC, time DESC, seq DESC
        ) AS event_rank
        FROM filtered
      )
      SELECT * FROM ranked
      WHERE event_rank = 1
      ORDER BY match_count DESC, document_length ASC, time DESC, session_id ASC, seq DESC
      LIMIT ? OFFSET ?
    `).all(...bindings);
    }
    _queryEvents(request, offset, persistenceBinding) {
        const selected = selectedDocumentsSql();
        const eventWhere = buildEventWhere(request.filters);
        assertFts5OuterPredicateCount(1 + eventWhere.predicateCount);
        const where = ['session_id = ?', eventWhere.sql].filter(Boolean).join(' AND ');
        const bindings = [
            ...selectedDocumentsParams(request.query, persistenceBinding.service !== undefined),
            request.sessionId,
            ...eventWhere.params,
            request.limit + 1,
            offset,
        ];
        assertPortableBindingCount(bindings.length);
        return this._requireDb().prepare(`
      ${selected.sql}
      SELECT * FROM matched
      WHERE ${where}
      ORDER BY match_count DESC, document_length ASC, time DESC, seq DESC
      LIMIT ? OFFSET ?
    `).all(...bindings);
    }
    _targetObservation(sessionId, persistenceBinding) {
        const db = this._requireDb();
        const live = db.prepare(`SELECT
        id AS session_id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, generation
      FROM temp.live_sessions
      WHERE id = ?`).get(sessionId);
        if (live !== undefined) {
            return { header: rowHeader(live), generation: `live:${live.generation}` };
        }
        if (persistenceBinding.service !== undefined) {
            const persisted = db.prepare(`SELECT
          id AS session_id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, generation
        FROM persisted_sessions
        WHERE id = ?`).get(sessionId);
            if (persisted !== undefined) {
                return {
                    header: rowHeader(persisted),
                    generation: `persisted:${this._persistenceEpoch}:${persisted.generation}`,
                };
            }
        }
        throw new SessionQueryError(`session "${sessionId}" not found`, 'SESSION_QUERY_SESSION_NOT_FOUND');
    }
    _sessionHit(row) {
        return {
            header: rowHeader(row),
            live: row.live === 1,
            persisted: row.persisted === 1,
            bestMatch: this._eventHit(row),
        };
    }
    _eventHit(row) {
        return {
            sessionId: row.session_id,
            seq: row.seq,
            type: row.type,
            time: row.time,
            surface: row.surface,
            snippet: makeSnippet(row.marked_text, this.config.snippetChars),
        };
    }
    _requireDb() {
        /* v8 ignore next -- callers await `_ready`; this guards lifecycle misuse */
        if (this._db === undefined)
            throw indexClosed();
        return this._db;
    }
    _isClosed() {
        return this._closed;
    }
}
/**
 * The header columns both session upserts bind, in the order their INSERT
 * lists them. The two statements differ only in what they append after these.
 * @param header - the session header being written.
 * @returns one bound value per header column.
 */
function headerBindings(header) {
    return [
        header.id,
        header.version,
        header.createdAt,
        header.cwd ?? null,
        header.parentSession ?? null,
        header.seedLength ?? null,
        header.delegationDepth ?? null,
        header.agentPreset ?? null,
    ];
}
function selectedDocumentsSql() {
    return {
        sql: `WITH candidates AS (
      SELECT
        pd.session_id AS session_id,
        ps.version AS version,
        ps.created_at AS created_at,
        ps.cwd AS cwd,
        ps.parent_session AS parent_session,
        ps.seed_length AS seed_length,
        ps.delegation_depth AS delegation_depth,
        ps.agent_preset AS agent_preset,
        0 AS live,
        1 AS persisted,
        CAST(pd.seq AS INTEGER) AS seq,
        pd.type AS type,
        CAST(pd.time AS INTEGER) AS time,
        pd.surface AS surface,
        highlight(persisted_docs, 0, ?, ?) AS marked_text,
        CAST(pd.codepoint_length AS INTEGER) AS document_length
      FROM persisted_docs AS pd
      JOIN persisted_sessions AS ps ON ps.id = pd.session_id
      WHERE persisted_docs MATCH ?
        AND ? = 1
        AND NOT EXISTS (SELECT 1 FROM temp.live_sessions AS ls WHERE ls.id = pd.session_id)
      UNION ALL
      SELECT
        ld.session_id AS session_id,
        ls.version AS version,
        ls.created_at AS created_at,
        ls.cwd AS cwd,
        ls.parent_session AS parent_session,
        ls.seed_length AS seed_length,
        ls.delegation_depth AS delegation_depth,
        ls.agent_preset AS agent_preset,
        1 AS live,
        CASE WHEN ? = 1 THEN ls.persisted ELSE 0 END AS persisted,
        CAST(ld.seq AS INTEGER) AS seq,
        ld.type AS type,
        CAST(ld.time AS INTEGER) AS time,
        ld.surface AS surface,
        highlight(live_docs, 0, ?, ?) AS marked_text,
        CAST(ld.codepoint_length AS INTEGER) AS document_length
      FROM temp.live_docs AS ld
      JOIN temp.live_sessions AS ls ON ls.id = ld.session_id
      WHERE live_docs MATCH ?
    ), matched AS (
      SELECT *,
        (
          length(CAST(marked_text AS BLOB))
          - length(CAST(replace(marked_text, ?, '') AS BLOB))
        ) / ? AS match_count
      FROM candidates
    )`,
    };
}
function selectedDocumentsParams(query, persistenceVisible) {
    const expression = quoteFtsData(query);
    const visible = persistenceVisible ? 1 : 0;
    return [
        FTS_HIGHLIGHT_START,
        FTS_HIGHLIGHT_END,
        expression,
        visible,
        visible,
        FTS_HIGHLIGHT_START,
        FTS_HIGHLIGHT_END,
        expression,
        FTS_HIGHLIGHT_START,
        Buffer.byteLength(FTS_HIGHLIGHT_START, 'utf8'),
    ];
}
function observeLive(session) {
    return observeSession(session.header, session.events);
}
function observeSession(header, events) {
    const detachedHeader = structuredClone(header);
    const detachedEvents = events.map(event => structuredClone(event));
    return {
        header: detachedHeader,
        documents: buildSessionEventSearchDocuments(detachedHeader.id, detachedEvents),
        fingerprint: createHash('sha256')
            .update(JSON.stringify({ header: detachedHeader, events: detachedEvents }))
            .digest('base64url'),
    };
}
function materializePersistenceSnapshots(snapshots) {
    if (!isRuntimeArray(snapshots))
        throw new Error('persistence snapshots must be an array');
    const result = new Map();
    for (const snapshot of snapshots) {
        if (typeof snapshot.revision !== 'string') {
            throw new Error('persistence snapshot revision must be a string');
        }
        const header = structuredClone(snapshot.header);
        if (result.has(header.id)) {
            throw new Error(`persistence listed duplicate session "${header.id}"`);
        }
        result.set(header.id, { header, revision: snapshot.revision });
    }
    return result;
}
function samePersistenceSnapshots(before, after) {
    if (before.size !== after.size)
        return false;
    for (const [id, first] of before) {
        const second = after.get(id);
        if (second === undefined
            || first.revision !== second.revision
            || !sameHeader(first.header, second.header))
            return false;
    }
    return true;
}
function sameSessionIds(before, after) {
    if (before.size !== after.size)
        return false;
    for (const id of before) {
        if (!after.has(id))
            return false;
    }
    return true;
}
function sameHeader(a, b) {
    return a.version === b.version
        && a.id === b.id
        && a.createdAt === b.createdAt
        && a.cwd === b.cwd
        && a.parentSession === b.parentSession
        && a.seedLength === b.seedLength
        && (a.delegationDepth ?? 0) === (b.delegationDepth ?? 0)
        && a.agentPreset === b.agentPreset;
}
function rowHeader(row) {
    return {
        version: row.version,
        id: row.session_id,
        createdAt: row.created_at,
        ...row.cwd === null ? {} : { cwd: row.cwd },
        ...row.parent_session === null ? {} : { parentSession: row.parent_session },
        ...row.seed_length === null ? {} : { seedLength: row.seed_length },
        ...row.delegation_depth === null ? {} : { delegationDepth: row.delegation_depth },
        ...row.agent_preset === null ? {} : { agentPreset: row.agent_preset },
    };
}
function page(rows, limit, convert, nextCursor, offset) {
    const hasMore = rows.length > limit;
    return {
        items: rows.slice(0, limit).map(convert),
        ...hasMore ? { nextCursor: nextCursor(offset + limit) } : {},
    };
}
function encodeCursor(payload) {
    return SessionSearchCursor(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'));
}
function decodeCursor(cursor, instance, scope, fingerprint, generation) {
    let decoded;
    try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    }
    catch (error) {
        throw invalidCursor(error);
    }
    if (decoded.version !== 1
        || decoded.instance !== instance
        || decoded.scope !== scope
        || decoded.fingerprint !== fingerprint
        || !Number.isSafeInteger(decoded.offset)
        || decoded.offset === undefined
        || decoded.offset < 0) {
        throw invalidCursor(new Error('cursor does not belong to this normalized request'));
    }
    if (decoded.generation !== generation) {
        throw new SessionQueryError('session-search cursor is stale because its relevant corpus changed', 'SESSION_QUERY_STALE_CURSOR');
    }
    return decoded.offset;
}
function invalidCursor(cause) {
    return new SessionQueryError('session-search cursor is invalid', 'SESSION_QUERY_INVALID_CURSOR', { cause });
}
function resolveConfig(config) {
    const resolved = {
        path: config.path,
        openAt: config.openAt ?? 'startup',
        journalMode: config.journalMode ?? 'wal',
        defaultLimit: config.defaultLimit ?? SESSION_QUERY_SQLITE_DEFAULT_LIMIT,
        maxLimit: config.maxLimit ?? SESSION_QUERY_SQLITE_MAX_LIMIT,
        snippetChars: config.snippetChars ?? SESSION_QUERY_SQLITE_SNIPPET_CHARS,
        readWindowMax: config.readWindowMax ?? SESSION_QUERY_READ_WINDOW_MAX,
        persistedInspectConcurrency: config.persistedInspectConcurrency
            ?? SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
    };
    if (typeof resolved.path !== 'string' || resolved.path.trim().length === 0) {
        throw invalidConfig('path must not be blank');
    }
    const openPhases = ['startup', 'first-search', 'never'];
    if (!openPhases.includes(resolved.openAt))
        throw invalidConfig('openAt is not supported');
    assertPageLimit('defaultLimit', resolved.defaultLimit);
    assertPageLimit('maxLimit', resolved.maxLimit);
    assertPositiveInteger('snippetChars', resolved.snippetChars);
    if (!Number.isInteger(resolved.readWindowMax) || resolved.readWindowMax < 0) {
        throw invalidConfig('readWindowMax must be a non-negative integer');
    }
    if (!Number.isSafeInteger(resolved.persistedInspectConcurrency)
        || resolved.persistedInspectConcurrency < 1) {
        throw invalidConfig('persistedInspectConcurrency must be a positive safe integer');
    }
    if (resolved.defaultLimit > resolved.maxLimit) {
        throw invalidConfig('defaultLimit must be less than or equal to maxLimit');
    }
    const journalModes = ['wal', 'delete', 'truncate', 'persist'];
    if (!journalModes.includes(resolved.journalMode))
        throw invalidConfig('journalMode is not supported');
    return resolved;
}
function assertPositiveInteger(name, value) {
    if (!Number.isInteger(value) || value < 1)
        throw invalidConfig(`${name} must be a positive integer`);
}
function assertPageLimit(name, value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > SQLITE_MAX_PAGE_LIMIT) {
        throw invalidConfig(`${name} must be an integer between 1 and ${SQLITE_MAX_PAGE_LIMIT}`);
    }
}
function invalidConfig(detail) {
    return new SessionQueryError(`session-search SQLite config: ${detail}`, 'SESSION_QUERY_INVALID_CONFIG');
}
function indexClosed() {
    return new SessionQueryError('session-search SQLite index is closed', 'SESSION_QUERY_INDEX_FAILED');
}
function assertNotAborted(signal) {
    if (signal?.aborted) {
        throw new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED');
    }
}
function waitWithAbort(promise, signal) {
    if (signal === undefined)
        return promise;
    if (signal.aborted)
        return Promise.reject(new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED'));
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            reject(new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(asError(error));
        });
    });
}
function isAbort(error) {
    return error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED';
}
function asError(error) {
    return error instanceof Error
        ? error
        : new Error('session-search dependency rejected with a non-Error value', { cause: error });
}
function errorMessage(error) {
    return error instanceof Error ? error.message : 'unknown error';
}
function isRuntimeArray(value) {
    return Array.isArray(value);
}
export default SqliteSessionQueryEngine;
//# sourceMappingURL=index.js.map