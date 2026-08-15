/**
 * Permission default-settings controller. The host descriptor supplies the
 * current value and the dynamic preset enum; writes target only
 * `defaultPreset` and carry the descriptor revision.
 */
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client';
import { type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** Permission's settings namespace on the host wire. */
export declare const PERMISSION_SETTINGS_NS = "permission";
/** One selectable new-session default. */
export interface PermissionDefaultOption {
    /** Preset key written to Settings. */
    id: string;
    /** Host-supplied label or a title-cased preset key. */
    label: string;
}
/** Permission settings-row snapshot. */
export interface PermissionSettingsState {
    status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error';
    error: string | null;
    writable: boolean;
    currentValue: string;
    options: readonly PermissionDefaultOption[];
    revision: number;
}
/**
 * Read the dynamic preset enum encoded by the host's `defaultPreset` schema.
 * @param view - permission namespace descriptor.
 * @returns current value and selectable options.
 */
export declare function permissionDefaultOf(view: SettingsNamespaceView): {
    currentValue: string;
    options: PermissionDefaultOption[];
};
/** Controller joining Settings reads, writes, and pushed invalidations. */
export declare class PermissionPresetSettingsController {
    private readonly api;
    /** Row snapshot consumed through a bound selector hook. */
    readonly store: SnapshotStore<PermissionSettingsState>;
    private generation;
    private view;
    /** @param api - Settings wire face. */
    constructor(api: Pick<IApiClient, 'settings'>);
    /**
     * Refresh the permission descriptor. Latest request wins.
     * @returns nothing; {@link store} carries success or failure.
     */
    load(): Promise<void>;
    /**
     * Persist one preset as the default for subsequently created sessions.
     * @param preset - advertised preset key.
     * @returns nothing; {@link store} carries success or failure.
     */
    select(preset: string): Promise<void>;
    /** Stop in-flight responses from publishing after plugin disposal. */
    dispose(): void;
    private accept;
    private fail;
}
/**
 * Refetch only after the row has opened once.
 * @param controller - permission settings controller.
 */
export declare function refreshPermissionIfLoaded(controller: PermissionPresetSettingsController): void;
//# sourceMappingURL=settings-store.d.ts.map