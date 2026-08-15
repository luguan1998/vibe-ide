/** Default bundle-load hook: same-origin external classic script. */
const defaultLoadBundle = (url) => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.async = true;
    el.src = url;
    el.addEventListener('load', () => {
        el.remove();
        resolve();
    }, { once: true });
    el.addEventListener('error', () => {
        el.remove();
        reject(new Error(`client-modules: bundle script ${url} failed to load`));
    }, { once: true });
    document.head.append(el);
});
/**
 * A plugin bundle IS its package's client half: `<id>/client` (the exports
 * subpath external bundles emit) and the bare graph id name the same
 * exports, so table lookups normalize the suffix away.
 */
const stripClientSuffix = (spec) => spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec;
/**
 * Claim and inventory the <style> tags a factory injected during
 * materialization: preset-emitted tags arrive pre-tagged with data-plugin;
 * any untagged tag is claimed for the materializing plugin (HMR bookkeeping).
 */
const claimStyles = (id) => {
    if (typeof document === 'undefined')
        return [];
    for (const el of document.querySelectorAll('style:not([data-plugin])')) {
        el.setAttribute('data-plugin', id);
    }
    const owned = [];
    for (const el of document.querySelectorAll(`style[data-plugin=${JSON.stringify(id)}]`)) {
        owned.push(el.getAttribute('data-plugin-css') ?? id);
    }
    return owned;
};
/**
 * The client module system: state tables plus the arrival/materialization
 * machinery implementing {@link ClientModuleLoader} (whose members carry the
 * contract documentation). Construction indexes the boot rows and installs the
 * `window.__ModuleLoader__` registration sink — once per page.
 */
export class ClientModuleSystem {
    version = 'client';
    loadCache = new Map();
    seed;
    statics = new Map();
    factories = new Map();
    /** In-flight prefetch (script load) per id; concurrent callers share it. */
    pendingArrival = new Map();
    /** Materialization re-entrancy guard: factory-form CJS cannot deliver partial exports, so a cycle is fatal. */
    materializing = new Set();
    graphRows = new Map();
    loadBundle;
    /**
     * Build the module system over the parsed boot rows.
     * @param options - Module rows, module-table staticModules, and bundle-load hook.
     */
    constructor(options) {
        this.seed = new Map(Object.entries(options.staticModules));
        this.loadBundle = options.loadBundle ?? defaultLoadBundle;
        for (const row of options.modules) {
            if (this.graphRows.has(row.id))
                throw new Error(`client-modules: duplicate graph entry "${row.id}"`);
            this.graphRows.set(row.id, row);
        }
        const win = globalThis;
        if (win.__ModuleLoader__ !== undefined)
            throw new Error('client-modules: window.__ModuleLoader__ already installed (double boot?)');
        win.__ModuleLoader__ = {
            load: (handoff) => {
                // Registration is keyed by the handoff id; a duplicate means a bundle
                // executed twice without an invalidate — always a bug, always loud.
                if (this.factories.has(handoff.id))
                    throw new Error(`client-modules: duplicate factory registration for "${handoff.id}" (bundle executed twice without invalidate?)`);
                this.factories.set(handoff.id, handoff.factory);
            },
        };
    }
    /** Load one graph row so its factory is registered (idempotent per in-flight arrival). */
    arrive(row) {
        const { id, url } = row;
        const pending = this.pendingArrival.get(id);
        if (pending !== undefined)
            return pending;
        if (this.factories.has(id))
            return Promise.resolve();
        const task = this.loadBundle(url).then(() => {
            if (!this.factories.has(id)) {
                throw new Error(`client-modules: bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`);
            }
        }).finally(() => { this.pendingArrival.delete(id); });
        this.pendingArrival.set(id, task);
        return task;
    }
    /** Materialize a registered factory (synchronous; memoized in loadCache). */
    materialize(id) {
        const existing = this.loadCache.get(id);
        if (existing !== undefined)
            return existing;
        const registered = this.factories.get(id);
        /* v8 ignore next -- callers check the factory branch before dispatching here. */
        if (registered === undefined)
            throw new Error(`client-modules: no registered factory for "${id}"`);
        if (this.materializing.has(id)) {
            throw new Error(`client-modules: require cycle through "${id}" (factory-form CJS cannot deliver partial exports)`);
        }
        this.materializing.add(id);
        try {
            const edges = new Set();
            const exports = registered(this.makeRequire(edges));
            const record = { id, exports, styles: claimStyles(id), edges };
            this.loadCache.set(id, record);
            return record;
        }
        finally {
            this.materializing.delete(id);
        }
    }
    /**
     * The synchronous require answered to factories: seed → static → memoized
     * record → registered factory (recursive materialization — this is what
     * makes load order self-resolving). Fetching is async and therefore
     * unreachable from here; an unregistered plugin specifier is loud (and a
     * cross-plugin value import is already a build error upstream).
     */
    makeRequire(edges) {
        return (spec) => {
            edges.add(spec);
            if (this.seed.has(spec))
                return this.seed.get(spec);
            if (this.statics.has(spec))
                return this.statics.get(spec);
            const id = stripClientSuffix(spec);
            const record = this.loadCache.get(id);
            if (record !== undefined)
                return record.exports;
            if (this.factories.has(id))
                return this.materialize(id).exports;
            throw new Error(`client-modules: require("${spec}") missed the module table — not a platform seed word, not a shell-own module, `
                + 'and no registered factory (a build-time externals drift, or a forbidden cross-plugin value import)');
        };
    }
    async import(specifier) {
        if (this.seed.has(specifier))
            return this.seed.get(specifier);
        const existing = this.loadCache.get(specifier);
        if (existing !== undefined)
            return existing.exports;
        if (this.statics.has(specifier)) {
            const exports = this.statics.get(specifier);
            this.loadCache.set(specifier, { id: specifier, exports, styles: [], edges: new Set() });
            return exports;
        }
        if (!this.factories.has(specifier)) {
            const row = this.graphRows.get(specifier);
            if (row === undefined) {
                throw new Error(`client-modules: cannot resolve "${specifier}" — not a seed word, not a shell-own module, `
                    + 'and not a row in the boot graph (the runtime mirror of the bundle purity gate)');
            }
            await this.arrive(row);
        }
        return this.materialize(specifier).exports;
    }
    registerStatic(id, module) {
        if (this.statics.has(id))
            throw new Error(`client-modules: shell-own module "${id}" registered twice`);
        this.statics.set(id, module);
    }
    async prefetch(id) {
        if (this.statics.has(id))
            return;
        const row = this.graphRows.get(id);
        if (row === undefined)
            throw new Error(`client-modules: prefetch("${id}") — not a graph entry`);
        await this.arrive(row);
    }
    invalidate(id) {
        this.factories.delete(id);
        this.loadCache.delete(id);
    }
}
//# sourceMappingURL=system.js.map