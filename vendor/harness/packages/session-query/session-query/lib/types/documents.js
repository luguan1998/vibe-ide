/** Shared event metadata and semantic-document projection. */
import { foldSurface } from '@deepseek-ai/dsh-session';
import { SessionQueryError } from "./config.js";
import { extractSessionEventText } from "./extraction.js";
/**
 * Project a raw log into lightweight surface-aware event records.
 * @param sessionId - session that owns the log.
 * @param events - complete contiguous raw event log.
 * @returns one record per event in ascending seq order.
 */
export function buildSessionEventRecords(sessionId, events) {
    const surfaceBySeq = classifySurface(events);
    return events.map(event => ({
        sessionId,
        seq: event.seq,
        type: event.type,
        time: event.time,
        surface: surfaceBySeq.get(event.seq) ?? 'log-only',
    }));
}
/**
 * Build first-party semantic documents for one complete raw event log.
 * @param sessionId - session that owns the log.
 * @param events - complete contiguous raw event log.
 * @returns searchable documents in ascending seq order; structural events are omitted.
 */
export function buildSessionEventSearchDocuments(sessionId, events) {
    const surfaceBySeq = classifySurface(events);
    const documents = [];
    for (const event of events) {
        const text = extractSessionEventText(event);
        if (text.length === 0)
            continue;
        documents.push({
            sessionId,
            seq: event.seq,
            type: event.type,
            time: event.time,
            surface: surfaceBySeq.get(event.seq) ?? 'log-only',
            text,
        });
    }
    return documents;
}
function classifySurface(events) {
    let folded;
    try {
        folded = foldSurface(events);
    }
    catch (error) {
        throw new SessionQueryError(
        /* v8 ignore next -- foldSurface throws Error instances */
        `invalid session surface: ${error instanceof Error ? error.message : 'unknown error'}`, 'SESSION_QUERY_INVALID_SURFACE', { cause: error });
    }
    const result = new Map();
    for (const seq of folded.nodes)
        result.set(seq, 'current');
    for (const replacement of folded.replacements) {
        for (const seq of replacement.shadowedSeqs)
            result.set(seq, 'shadowed');
    }
    return result;
}
//# sourceMappingURL=documents.js.map