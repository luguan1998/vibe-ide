/** Welcome-notice state, durable when the browser may use Host settings. */
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** State rendered by the welcome step. */
export interface WelcomeNoticeState {
    status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
    acknowledged: boolean;
    error: string | null;
}
/** Coordinates durable Host acknowledgement or a process-local remote fallback. */
export declare class WelcomeNoticeStore {
    private readonly api;
    private readonly persistence;
    /** uSES-safe state source shared by the registered welcome step. */
    readonly store: SnapshotStore<WelcomeNoticeState>;
    private generation;
    /**
     * @param api - settings wire face used for durable reads and writes.
     * @param persistence - remote browsers use memory because settings is loopback-only.
     */
    constructor(api: Pick<IApiClient, 'settings'>, persistence?: 'host' | 'memory');
    /** Load the acknowledgement from Host settings or initialize process-local state. */
    load(): Promise<void>;
    /**
     * Persist this copy version, or advance only this process for a remote browser.
     * @returns true when the selected persistence mode accepted the acknowledgement.
     */
    acknowledge(): Promise<boolean>;
}
/**
 * Refresh only after welcome state has left idle. A memory-mode load retains
 * acknowledgement so reconnect does not reopen a process-local notice.
 * @param controller - welcome state owner whose current status decides whether to load.
 */
export declare function refreshWelcomeIfLoaded(controller: WelcomeNoticeStore): void;
//# sourceMappingURL=welcome-store.d.ts.map