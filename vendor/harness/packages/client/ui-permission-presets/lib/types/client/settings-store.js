/**
 * Permission default-settings controller. The host descriptor supplies the
 * current value and the dynamic preset enum; writes target only
 * `defaultPreset` and carry the descriptor revision.
 */
import { createSnapshotStore, } from '@deepseek-ai/dsh-client-runtime/client';
import { nodeAtPath, rehydrateSchema, } from '@deepseek-ai/dsh-client-schema-form';
import { displayPermissionPreset } from "./presentation.js";
/** Permission's settings namespace on the host wire. */
export const PERMISSION_SETTINGS_NS = 'permission';
/**
 * Read the dynamic preset enum encoded by the host's `defaultPreset` schema.
 * @param view - permission namespace descriptor.
 * @returns current value and selectable options.
 */
export function permissionDefaultOf(view) {
    const value = view.value?.defaultPreset;
    if (typeof value !== 'string')
        throw new Error('permission settings has no defaultPreset value');
    const node = nodeAtPath(rehydrateSchema(view.schema), ['defaultPreset']);
    if (node === undefined)
        throw new Error('permission settings schema has no defaultPreset field');
    const rawChoices = node.type === 'union'
        ? node.list ?? []
        : [node];
    const options = rawChoices.flatMap((candidate) => {
        const choice = candidate;
        if (choice.type !== 'const' || typeof choice.value !== 'string')
            return [];
        const described = choice.meta?.description;
        return [{
                id: choice.value,
                label: typeof described === 'string' && described.length > 0
                    ? displayPermissionPreset(choice.value, described)
                    : displayPermissionPreset(choice.value, choice.value),
            }];
    });
    if (options.length === 0 || !options.some(option => option.id === value)) {
        throw new Error('permission settings schema does not advertise its current preset');
    }
    return { currentValue: value, options };
}
/** Controller joining Settings reads, writes, and pushed invalidations. */
export class PermissionPresetSettingsController {
    api;
    /** Row snapshot consumed through a bound selector hook. */
    store = createSnapshotStore({
        status: 'idle',
        error: null,
        writable: false,
        currentValue: '',
        options: [],
        revision: 0,
    });
    generation = 0;
    view;
    /** @param api - Settings wire face. */
    constructor(api) {
        this.api = api;
    }
    /**
     * Refresh the permission descriptor. Latest request wins.
     * @returns nothing; {@link store} carries success or failure.
     */
    async load() {
        const generation = ++this.generation;
        this.store.update((state) => {
            state.status = 'loading';
            state.error = null;
        });
        try {
            const response = await this.api.settings.describe({});
            if (!response.result.ok)
                throw new Error(response.result.error.message);
            if (generation !== this.generation)
                return;
            const view = response.result.value.namespaces.find(entry => entry.ns === PERMISSION_SETTINGS_NS);
            if (view === undefined) {
                this.view = undefined;
                this.store.update((state) => {
                    state.status = 'unavailable';
                    state.writable = false;
                    state.currentValue = '';
                    state.options = [];
                });
                return;
            }
            this.accept(view, response.result.value.writable);
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.fail(error);
        }
    }
    /**
     * Persist one preset as the default for subsequently created sessions.
     * @param preset - advertised preset key.
     * @returns nothing; {@link store} carries success or failure.
     */
    async select(preset) {
        const view = this.view;
        const state = this.store.getSnapshot();
        if (view === undefined || !state.writable)
            return;
        const generation = ++this.generation;
        this.store.update((draft) => {
            draft.status = 'saving';
            draft.error = null;
        });
        try {
            const response = await this.api.settings.mutate({
                ns: PERMISSION_SETTINGS_NS,
                ops: [{ op: 'set', path: ['defaultPreset'], value: preset }],
                expectedRevision: view.revision,
            });
            if (generation !== this.generation)
                return;
            if (!response.result.ok)
                throw new Error(response.result.error.message);
            this.accept(response.result.value, true);
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.fail(error);
        }
    }
    /** Stop in-flight responses from publishing after plugin disposal. */
    dispose() {
        this.generation += 1;
        this.view = undefined;
    }
    accept(view, writable) {
        const resolved = permissionDefaultOf(view);
        this.view = view;
        this.store.update((state) => {
            state.status = 'ready';
            state.error = null;
            state.writable = writable;
            state.currentValue = resolved.currentValue;
            state.options = resolved.options;
            state.revision = view.revision;
        });
    }
    fail(error) {
        this.store.update((state) => {
            state.status = 'error';
            state.error = error instanceof Error ? error.message : String(error);
        });
    }
}
/**
 * Refetch only after the row has opened once.
 * @param controller - permission settings controller.
 */
export function refreshPermissionIfLoaded(controller) {
    if (controller.store.getSnapshot().status === 'idle')
        return;
    void controller.load();
}
//# sourceMappingURL=settings-store.js.map