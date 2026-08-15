/** Welcome-notice state, durable when the browser may use Host settings. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import { WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE, WELCOME_NOTICE_VERSION, } from "../onboarding-copy.js";
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function acknowledgementOf(view) {
    if (typeof view.value !== 'object' || view.value === null)
        return undefined;
    const value = view.value[WELCOME_NOTICE_ACK_FIELD];
    return typeof value === 'string' ? value : undefined;
}
/** Coordinates durable Host acknowledgement or a process-local remote fallback. */
export class WelcomeNoticeStore {
    api;
    persistence;
    /** uSES-safe state source shared by the registered welcome step. */
    store = createSnapshotStore({
        status: 'idle', acknowledged: false, error: null,
    });
    generation = 0;
    /**
     * @param api - settings wire face used for durable reads and writes.
     * @param persistence - remote browsers use memory because settings is loopback-only.
     */
    constructor(api, persistence = 'host') {
        this.api = api;
        this.persistence = persistence;
    }
    /** Load the acknowledgement from Host settings or initialize process-local state. */
    async load() {
        const generation = ++this.generation;
        if (this.persistence === 'memory') {
            this.store.update((state) => { state.status = 'ready'; state.error = null; });
            return;
        }
        this.store.update((state) => { state.status = 'loading'; state.error = null; });
        try {
            const response = await this.api.settings.describe({});
            if (!response.result.ok)
                throw new Error(response.result.error.message);
            const view = response.result.value.namespaces.find(candidate => candidate.ns === WELCOME_NOTICE_SETTINGS_NAMESPACE);
            if (view === undefined)
                throw new Error('welcome acknowledgement settings are unavailable');
            if (generation !== this.generation)
                return;
            this.store.update((state) => {
                state.status = 'ready';
                state.acknowledged = acknowledgementOf(view) === WELCOME_NOTICE_VERSION;
                state.error = null;
            });
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.store.update((state) => {
                state.status = 'error';
                state.acknowledged = false;
                state.error = messageOf(error);
            });
        }
    }
    /**
     * Persist this copy version, or advance only this process for a remote browser.
     * @returns true when the selected persistence mode accepted the acknowledgement.
     */
    async acknowledge() {
        const generation = ++this.generation;
        if (this.persistence === 'memory') {
            this.store.update((state) => {
                state.status = 'ready';
                state.acknowledged = true;
                state.error = null;
            });
            return true;
        }
        this.store.update((state) => { state.status = 'saving'; state.error = null; });
        try {
            const response = await this.api.settings.mutate({
                ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
                ops: [{ op: 'set', path: [WELCOME_NOTICE_ACK_FIELD], value: WELCOME_NOTICE_VERSION }],
            });
            if (!response.result.ok)
                throw new Error(response.result.error.message);
            if (generation === this.generation) {
                this.store.update((state) => {
                    state.status = 'ready';
                    state.acknowledged = true;
                    state.error = null;
                });
            }
            return true;
        }
        catch (error) {
            if (generation === this.generation) {
                this.store.update((state) => {
                    state.status = 'error';
                    state.acknowledged = false;
                    state.error = messageOf(error);
                });
            }
            return false;
        }
    }
}
/**
 * Refresh only after welcome state has left idle. A memory-mode load retains
 * acknowledgement so reconnect does not reopen a process-local notice.
 * @param controller - welcome state owner whose current status decides whether to load.
 */
export function refreshWelcomeIfLoaded(controller) {
    if (controller.store.getSnapshot().status === 'idle')
        return;
    void controller.load();
}
//# sourceMappingURL=welcome-store.js.map