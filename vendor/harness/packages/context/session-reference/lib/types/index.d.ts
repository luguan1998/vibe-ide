/**
 * Cross-session snapshot preparation. Hosts adapt mentions into structured
 * references; this service owns exact reads, projection, budgets, and durable context.
 *
 * @module @deepseek-ai/dsh-session-reference
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type Config } from './config.ts';
import type { PreparedReferencedMessage, SessionReferenceCandidate, SessionReferenceInput } from './types.ts';
export type * from './types.ts';
export type { Config, SessionReferenceErrorCode } from './config.ts';
export { DEFAULT_CANDIDATE_LIMIT, DEFAULT_MAX_REFERENCE_BYTES, MAX_REFERENCES, SessionReferenceError, } from './config.ts';
export { SESSION_REFERENCE_SCHEME, decodeSessionReferenceUri, encodeSessionReferenceUri, formatSessionReferenceMention, parseSessionReferenceText, } from './uri.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessionReferenceResolver: SessionReferenceResolver;
    }
}
/** Exact-read consumer that prepares immutable cross-session message context. */
export declare class SessionReferenceResolver extends Service {
    static inject: string[];
    static Config: z<Config>;
    private readonly config;
    constructor(ctx: Context, config?: Config);
    /**
     * List reference candidates, ranked by working-directory affinity.
     * @param agent - target agent; self is excluded and its cwd drives ranking.
     * @param query - optional case-insensitive session-id/cwd/title substring.
     * @param limit - optional positive result cap.
     * @param signal - optional cancellation boundary for host autocomplete teardown.
     * @returns candidates labeled by latest title or, when absent, session id.
     */
    listCandidates(agent: Agent, query?: string, limit?: number, signal?: AbortSignal): Promise<SessionReferenceCandidate[]>;
    /**
     * Snapshot all references before enqueue and return one aggregated durable context.
     * @param agent - target agent; references to it are rejected.
     * @param content - already host-normalized readable message content.
     * @param references - structured source sessions in mention order.
     * @param signal - optional cancellation boundary for host request teardown.
     * @returns detached content and optional referenced-session context.
     */
    prepare(agent: Agent, content: ContentBlock[], references: SessionReferenceInput[], signal?: AbortSignal): Promise<PreparedReferencedMessage>;
    private renderSources;
}
export default SessionReferenceResolver;
//# sourceMappingURL=index.d.ts.map