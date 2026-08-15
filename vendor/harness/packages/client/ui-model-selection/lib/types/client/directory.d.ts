/**
 * Per-session model directory: the ONE state both selection entries share.
 * The /model popup and the composer-seat selector load through the same
 * controller and submit through the same selectModel call, so the host stays
 * the single fact source and the store is one shared echo — a switch made in
 * either entry is what the other shows next.
 */
import type { IApiClient, ModelCatalogFailure, ModelProviderGroup, ModelSelection, SessionId, SessionModels } from '@deepseek-ai/dsh-api-remotes/client';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** Directory snapshot both entries render from. */
export interface ModelDirectoryState {
    /** Model selection the host reports for the next assembled step; null before the first load. */
    current: ModelSelection | null;
    /**
     * Whether an adapter serves the current selection's provider, as the host reports
     * it — null before the first load, which is NOT the same as blocked. Read
     * this rather than "current matches no group": catalog membership is
     * advisory, so a route serving a model it stopped advertising is missing
     * from the groups yet perfectly usable.
     */
    routable: boolean | null;
    /** Successfully loaded provider groups (last good load). */
    groups: readonly ModelProviderGroup[];
    /** Provider-local failures from the last load; usable groups stay usable. */
    failures: readonly ModelCatalogFailure[];
    /** Lifecycle of the in-flight operation. */
    status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error';
    /** Whole-request or selection failure text; null when none. */
    error: string | null;
}
/** One session's shared directory controller; disposed with the session scope. */
export declare class ModelDirectory {
    private readonly sessions;
    private readonly sessionId;
    private readonly available;
    /** The shared snapshot both entries render from (uSES-safe store). */
    readonly store: SnapshotStore<ModelDirectoryState>;
    /** Latest operation wins; an older response never overwrites a newer one. */
    private generation;
    private disposed;
    /**
     * @param sessions - the session wire face (captured from the plugin's root connection).
     * @param sessionId - the owning session.
     * @param available - whether this session may use Agent-bound model RPCs.
     */
    constructor(sessions: Pick<IApiClient['sessions'], 'models' | 'selectModel'>, sessionId: SessionId, available: () => boolean);
    /**
     * Refresh the advisory directory (both entries call this on open).
     * Failure preserves the last good groups and current selection.
     * @returns the fresh directory value.
     */
    load(): Promise<SessionModels>;
    /**
     * Select the complete provider/model/reasoning selection (both entries submit through here). Success
     * updates the shared current; failure surfaces on the store and throws so
     * each entry's own retry surface engages.
     * @param selection - provider, provider-owned model id, and optional adapter-owned effort.
   */
    select(selection: ModelSelection): Promise<void>;
    /**
     * Drop the previous Host generation's projection and repull it. Clearing
     * first prevents an unconsumed process-local selection from being displayed
     * while the restarted Host has restored the last logged model selection.
     */
    resetConnected(): void;
    /** Scope teardown: late settlements lose write access to the store. */
    dispose(): void;
    private assertAvailable;
}
//# sourceMappingURL=directory.d.ts.map