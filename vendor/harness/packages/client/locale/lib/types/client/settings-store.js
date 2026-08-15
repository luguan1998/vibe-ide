/**
 * Language row slot store: a mirror of the locale service snapshot. The
 * plugin's apply-world change listener is the only writer; the row component
 * reads via props.useStore.
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Declares the Language row state and write surface.
 * @returns the store handle.
 */
export function createLanguageRowStore() {
    return defineStore({
        init: () => ({ active: '', options: [], revision: -1 }),
        actions: {
            sync: (d, active, options, revision) => {
                if (revision <= d.revision)
                    return;
                d.active = active;
                d.options = options;
                d.revision = revision;
            },
        },
    });
}
//# sourceMappingURL=settings-store.js.map