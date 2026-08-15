/**
 * Durable session-persistence Service Definition (`ctx.sessionPersistence`). Backends store
 * {@link SessionEvent}s as the event-sourced log and carry non-replayable
 * {@link SessionHeader} metadata separately.
 * @module @deepseek-ai/dsh-session-persistence
 */
import { Service } from '@deepseek-ai/cordis';
import { SessionPreparation } from '@deepseek-ai/dsh-session';
export { SessionPersistenceRevision } from "./revision.js";
// The backend-agnostic write-path orchestration first-party backends compose.
export { DEFAULT_PREPARED_SESSION_CACHE_SIZE, DEFAULT_WRITE_BATCH_MAX_DELAY_MS, MAX_WRITE_BATCH_DELAY_MS, PersistenceCoordinator, SessionFormatUnsupportedError, SessionPersistenceCorruptionError, sessionFormatVersionRefusal, } from "./coordinator.js";
/**
 * Durable append-only session storage. Implementations preserve contiguous,
 * losslessly JSON-serializable events; {@link append} resolves only after
 * durability, and {@link load} balances a complete interrupted tail without
 * rewriting committed events.
 */
export class SessionPersistence extends Service {
    constructor(ctx) {
        super(ctx, 'sessionPersistence');
    }
    /**
     * Read a session's backend-owned artifact text verbatim — the exact durable
     * bytes the backend wrote (decoded from its physical encoding, e.g. a
     * decompressed JSONL). The returned `content` is the raw text, not a
     * reconstruction from parsed events, so it preserves backend-specific
     * serialization (chunk packing, key order, line breaks). Callers first test
     * {@link supportsRawArtifacts}; `undefined` then means only that the requested
     * session has no materialized artifact.
     * @param _id - the persisted session to read (unused by the default: no
     * per-session artifact).
     * @param signal - optional cancellation for backend read work.
     * @returns the raw artifact plus its parsed header, or `undefined` when the
     * session is absent.
     * @throws when this backend does not expose per-session raw artifacts.
     */
    readRaw(_id, signal) {
        if (signal?.aborted === true) {
            return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        }
        return Promise.reject(new Error('this session persistence backend does not expose raw artifacts'));
    }
    /**
     * Prepare the exact unpublished Session used by resume. Implementations may
     * reuse object graphs retained by an earlier {@link inspect} after confirming
     * their durable revision is still current; disposal releases an unpublished
     * reservation. Revision retries require the durable log to remain unchanged
     * for one read/check round trip; continuous external writers may delay completion.
     * @param id - persisted session to prepare.
     * @param signal - optional cancellation for preparation work.
     * @returns one owned unpublished Session preparation.
     */
    async prepare(id, signal) {
        signal?.throwIfAborted();
        const loaded = await this.load(id);
        signal?.throwIfAborted();
        const sessions = this.ctx.get('sessions');
        if (sessions === undefined) {
            throw new Error('cannot prepare a session: SessionStore is not configured');
        }
        return SessionPreparation.create(sessions.prepare(id, {
            seed: loaded.events.map(event => structuredClone(event)),
            meta: structuredClone(loaded.meta),
            seedSource: 'persistence',
        }));
    }
}
export default SessionPersistence;
//# sourceMappingURL=index.js.map