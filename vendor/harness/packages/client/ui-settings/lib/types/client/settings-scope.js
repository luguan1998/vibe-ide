/**
 * Host transport for the settings-namespace scope contract. The contract types
 * live in `dsh-client-runtime` (the common dependency of every feature that
 * owns a preference); this file owns the wire behavior and the invalidation
 * subscription, both of which are Settings-surface concerns.
 */
import { Service } from '@deepseek-ai/cordis';
import { rehydrateSchema, validateDraft } from '@deepseek-ai/dsh-client-schema-form';
import { createSnapshotStore, } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Serializes one namespace's Host reads and writes behind a snapshot store.
 * Reads never block plugin activation; writes carry the latest known
 * namespace revision and teardown waits for the operation already crossing
 * the wire.
 */
export class SettingsScopeController {
    api;
    spec;
    persistence;
    store;
    tail = Promise.resolve();
    readGeneration = 0;
    writeGeneration = 0;
    disposed = false;
    /**
     * @param api - settings wire face.
     * @param spec - namespace identity and optional narrowing decoder.
     * @param persistence - remote browsers remain process-local because settings RPCs are loopback-only.
     */
    constructor(api, spec, persistence = 'host') {
        this.api = api;
        this.spec = spec;
        this.persistence = persistence;
        this.store = createSnapshotStore({
            status: persistence === 'host' ? 'loading' : 'unavailable',
            value: undefined,
            base: undefined,
            user: undefined,
            revision: undefined,
            writable: false,
            mode: persistence,
        });
    }
    /** @returns the current sync snapshot (stable reference until the next change). */
    getSnapshot() {
        return this.store.getSnapshot();
    }
    /**
     * Observe snapshot replacements.
     * @param listener - invoked after each snapshot change.
     * @returns the disposer removing this listener.
     */
    subscribe(listener) {
        return this.store.subscribe(listener);
    }
    /**
     * Queue a Host refresh; a newer read or user write suppresses stale publication.
     * @returns settlement after the queued read completes or is skipped.
     */
    load() {
        const generation = ++this.readGeneration;
        return this.enqueue(() => this.read(generation));
    }
    /**
     * Queue one field write; see {@link SettingsScope.set} for the ordering,
     * revision, and recovery contract.
     * @param field - scalar field inside the namespace section.
     * @param value - JSON-shaped value selected by the user.
     * @returns settlement after the write and any latest-write recovery read.
     */
    set(field, value) {
        return this.write({ op: 'set', path: [field], value });
    }
    /**
     * Queue one field clear; see {@link SettingsScope.unset} for the ordering,
     * revision, and recovery contract.
     * @param field - scalar field inside the namespace section.
     * @returns settlement after the clear and any latest-write recovery read.
     */
    unset(field) {
        return this.write({ op: 'unset', path: [field] });
    }
    write(op) {
        this.readGeneration += 1;
        const generation = ++this.writeGeneration;
        return this.enqueue(async () => {
            const revision = this.getSnapshot().revision;
            let response;
            try {
                response = await this.api.settings.mutate({
                    ns: this.spec.namespace,
                    ops: [op],
                    ...(revision === undefined ? {} : { expectedRevision: revision }),
                });
            }
            catch (_settingsWriteFailure) {
                if (!this.disposed && generation === this.writeGeneration)
                    await this.read(++this.readGeneration);
                return;
            }
            if (!response.result.ok) {
                if (!this.disposed && generation === this.writeGeneration)
                    await this.read(++this.readGeneration);
                return;
            }
            this.accept(response.result.value, generation === this.writeGeneration);
        });
    }
    /**
     * Stop queued operations and wait for the current wire call to settle.
     * @returns settlement after the controller reaches quiescence.
     */
    async dispose() {
        this.disposed = true;
        this.readGeneration += 1;
        this.writeGeneration += 1;
        await this.tail;
    }
    enqueue(operation) {
        if (this.persistence === 'memory' || this.disposed)
            return Promise.resolve();
        const task = this.tail.then(async () => {
            if (this.disposed)
                return;
            await operation();
        });
        // The returned task carries its own settlement to the caller; the queue
        // tail is kept fulfilled so one failed subscriber cannot strand later operations.
        this.tail = task.catch(() => { });
        return task;
    }
    async read(generation) {
        let response;
        try {
            response = await this.api.settings.describe({});
        }
        catch (_settingsReadFailure) {
            return;
        }
        if (!response.result.ok || this.disposed)
            return;
        const { namespaces, writable } = response.result.value;
        const view = namespaces.find(candidate => candidate.ns === this.spec.namespace);
        const publish = generation === this.readGeneration;
        if (view === undefined) {
            if (publish) {
                this.store.update((draft) => {
                    draft.status = 'unavailable';
                    draft.writable = writable;
                });
            }
            return;
        }
        this.accept(view, publish, writable);
    }
    accept(view, publish, writable) {
        const decoded = publish ? this.decode(view) : undefined;
        this.store.update((draft) => {
            draft.revision = view.revision;
            draft.base = view.base;
            draft.user = view.user;
            if (writable !== undefined)
                draft.writable = writable;
            if (decoded === undefined)
                return;
            draft.status = 'ready';
            draft.value = decoded;
        });
    }
    decode(view) {
        if (this.spec.decode !== undefined)
            return this.spec.decode(view.value);
        // Sections are plain objects by construction; schemastery alone would
        // resolve null or an array through object defaults instead of refusing.
        if (typeof view.value !== 'object' || view.value === null || Array.isArray(view.value))
            return undefined;
        let failure;
        try {
            failure = validateDraft(rehydrateSchema(view.schema), view.value);
        }
        catch (_malformedSchemaEnvelope) {
            // A schema envelope this client cannot rehydrate vouches for no section;
            // the value is treated exactly like a schema-invalid one.
            return undefined;
        }
        return failure === undefined ? view.value : undefined;
    }
}
/**
 * The settings domain's base service. Features that own a preference reach the
 * settings transport through this service rather than a shared function: the
 * client bundle purity gate forbids cross-plugin value imports and directs
 * cross-plugin collaboration through cordis services
 * (`packages/client/tsdown.client.ts`).
 */
export class SettingsScopeBinder extends Service {
    /**
     * @param ctx - the providing plugin's context.
     */
    constructor(ctx) {
        super(ctx, 'settingsScope');
    }
    /**
     * Bind one namespace scope to settings and connection invalidations on the
     * CALLER's plugin lifecycle — the service proxy binds `this.ctx` to the
     * caller at call time, so the scope's disposer belongs to the calling fiber.
     * Listeners exist before the initial background read starts, so activation
     * never blocks on the settings transport. The caller injects `connection`
     * for the transport and `remote` for the forwarded settings invalidation.
     * @param spec - domain-owned namespace contract.
     * @returns the bound scope consumed by the domain's services and rows.
     */
    bind(spec) {
        const ctx = this.ctx;
        const connection = ctx.get('connection');
        const controller = new SettingsScopeController(connection.api, spec, connection.isLoopback ? 'host' : 'memory');
        ctx.effect(() => {
            const refresh = (namespace) => {
                if (namespace !== undefined && namespace !== spec.namespace)
                    return;
                void controller.load();
            };
            const disposers = [
                ctx.get('remote').$on('settings/document-updated', refresh),
                ctx.on('connection/reset', () => { refresh(); }),
            ];
            void controller.load();
            return async () => {
                for (const dispose of disposers)
                    dispose();
                await controller.dispose();
            };
        }, `ui-settings: ${spec.namespace} settings scope`);
        return controller;
    }
}
//# sourceMappingURL=settings-scope.js.map