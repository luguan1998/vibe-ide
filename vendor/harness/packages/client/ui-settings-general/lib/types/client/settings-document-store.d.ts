/** State owner for the optional local settings-document action. */
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client';
import { type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** Browser state of the Host-owned settings document. */
export interface SettingsDocumentState {
    /** Metadata-loading phase; unavailable means the provider has no local document or the read failed. */
    status: 'idle' | 'loading' | 'ready' | 'unavailable';
    /** Whether one native-open request is in flight. */
    opening: boolean;
    /** Last metadata/native-open diagnostic; UI exposes only localized copy. */
    error: string | null;
}
/** Loads local-document availability and invokes the pathless Host-owned open operation. */
export declare class SettingsDocumentStore {
    private readonly api;
    /** uSES-safe state source shared by the registered header action. */
    readonly store: SnapshotStore<SettingsDocumentState>;
    private generation;
    /**
     * @param api - loopback settings wire face that reports and opens the provider document.
     */
    constructor(api: Pick<IApiClient, 'settings'>);
    /**
     * Load whether the current provider owns a local document.
     * @returns after the latest metadata response updates the store.
     */
    load(): Promise<void>;
    /**
     * Open the loaded document once; concurrent gestures collapse behind the in-flight action.
     * @returns after the native-open request settles, or immediately when unavailable/already opening.
     */
    open(): Promise<void>;
}
/**
 * Refresh document availability after reconnect only when a surface has already requested it.
 * @param controller - optional loopback document state owner.
 */
export declare function refreshDocumentIfLoaded(controller: SettingsDocumentStore | undefined): void;
//# sourceMappingURL=settings-document-store.d.ts.map