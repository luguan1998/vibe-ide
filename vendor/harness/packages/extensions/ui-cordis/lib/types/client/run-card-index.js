/** Session-local ownership index for Package business views on `cordis_run` cards. */
function createStore() {
    const pointers = new Map();
    const listeners = new Set();
    let cache;
    return {
        getSnapshot: () => cache ??= new Map(pointers),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        observe: (pointer) => {
            const current = pointers.get(pointer.key);
            if (current !== undefined && current.seq >= pointer.seq)
                return;
            pointers.set(pointer.key, pointer);
            cache = undefined;
            for (const listener of [...listeners])
                listener();
        },
    };
}
/** Page-lifetime registry that gives all cards of one session the same Store. */
export class CordisRunCardRegistry {
    sessions = new Map();
    /**
     * Return the persistent page-local Store for a session.
     * @param sessionId - session whose cards share supersession state.
     * @returns the page-local Store retained for that session.
     */
    forSession(sessionId) {
        let store = this.sessions.get(sessionId);
        if (store === undefined) {
            store = createStore();
            this.sessions.set(sessionId, store);
        }
        return store;
    }
}
/**
 * Build the Package business-view key shared by registrations and Run cards.
 * @param pluginId - stable Plugin identity.
 * @param packageId - immutable Package identity.
 * @returns the shared business-view key.
 */
export function cordisToolViewKey(pluginId, packageId) {
    return `${pluginId}.${packageId}`;
}
//# sourceMappingURL=run-card-index.js.map