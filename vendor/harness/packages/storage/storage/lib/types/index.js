/**
 * Storage hub (`ctx.storage`): a named backend registry plus mounted
 * data-form facilities. The hub itself performs no IO — backends own media,
 * data forms (the domain layer first) own semantics.
 * @module @deepseek-ai/dsh-storage
 */
import { Service } from '@deepseek-ai/cordis';
import { StorageError } from "./error.js";
import { BackendRegistry } from "./registry.js";
export { BackendRegistry } from "./registry.js";
export { StorageError } from "./error.js";
export { UNIT_NAME_RE } from "./backend.js";
/**
 * Derive the Cordis lifecycle service that one named backend plugin provides.
 * Domain-form providers inject these keys so activation cannot race backend
 * registration even though callers continue resolving backends through the
 * storage registry.
 * @param name - Backend registry name.
 * @returns the corresponding lifecycle-only service key.
 */
export function storageBackendServiceKey(name) {
    return `storage.backend.${name}`;
}
/**
 * The storage hub service. Backends register under `backend`; data forms
 * mount under their `StorageForms` key and are reached as `ctx.storage.<form>`.
 */
export class Storage extends Service {
    /** Named backend table; multiple backends stay mounted side by side. */
    backend = new BackendRegistry();
    forms = new Map();
    constructor(ctx) {
        super(ctx, 'storage');
    }
    /**
     * Mount a data-form facility on the hub. Mounting is an effect: the
     * returned disposer unmounts the form.
     * @param form - Form key declared in {@link StorageForms}.
     * @param facility - The facility instance to expose.
     * @returns the disposer that unmounts the form.
     */
    mount(form, facility) {
        if (this.forms.has(form)) {
            throw new StorageError('duplicate-mount', `storage form '${String(form)}' is already mounted`);
        }
        this.forms.set(form, facility);
        return () => {
            // Same stale-disposer guard as BackendRegistry.register.
            if (this.forms.get(form) === facility) {
                this.forms.delete(form);
            }
        };
    }
    /**
     * Resolve a mounted data form.
     * @param form - Form key declared in {@link StorageForms}.
     * @returns the mounted facility.
     */
    form(form) {
        if (!this.forms.has(form)) {
            throw new StorageError('form-not-mounted', `storage form '${String(form)}' is not mounted`);
        }
        return this.forms.get(form);
    }
    /** Domain data form; present once the domain layer plugin is loaded. */
    get domain() {
        return this.form('domain');
    }
}
// Service packages default-export their service class and nothing else
// plugin-shaped (packages/AGENTS.md): mixing a default export with a
// function-plugin `apply` makes the Loader drop the plugin namespace.
export default Storage;
//# sourceMappingURL=index.js.map