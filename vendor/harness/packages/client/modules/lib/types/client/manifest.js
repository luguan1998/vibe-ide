/**
 * Client module system: the browser peer of Node's internal ESM loader, built
 * as a lazy CJS table. The vendored cordis Loader consumes this object
 * through its `internal` contract (the only call site is `EntryTree.import` →
 * `internal.import`), which keeps entry governance (fiber lifecycle, inject
 * waiting, update/refresh) entirely on the vendored side while this package
 * owns code arrival.
 *
 * Lazy CJS model: executing a plugin bundle only REGISTERS its
 * factory (`window.__ModuleLoader__.load({id, factory})`); every module body
 * side effect — including CSS injection — lives inside the factory closure
 * and runs at materialization, not at script execution. Materialization
 * (factory(require) → exports) happens on first import/require and is
 * memoized in {@link ClientModuleLoader.loadCache}; a factory that requires
 * another registered-but-unmaterialized module materializes it recursively,
 * so load order needs no external sequencing.
 *
 * Resolution branch order (import): seed word → shell instance; memoized
 * record → exports; static registry (shell-own modules, e.g. app-shell) →
 * module; registered factory → materialize; graph row → load + materialize;
 * anything else → throw (loud — the runtime mirror of the
 * build-time bundle purity gate). The synchronous `require` handed to
 * factories walks the same order minus the load branch: loading is async,
 * so only already-registered bundles can be required — and cross-plugin value
 * imports are a build error anyway.
 *
 * This file is the browser-safe contract face (zero node imports): the
 * `__DSH_BOOT__` wire types, the boot-manifest parser, and the boundaries around
 * {@link ClientModuleSystem}. The package root is the host-side service that
 * composes the wire.
 */
/**
 * Parse `window.__DSH_BOOT__` into the two consumer views. Wire boundary:
 * a missing or malformed graph throws (the shell shows the loud failure —
 * a page without a valid manifest cannot boot anything).
 * @param wire - the raw `window.__DSH_BOOT__` value.
 * @returns the manifest with optional plugin-view fields normalized.
 */
export function parseBootManifest(wire) {
    if (typeof wire !== 'object' || wire === null) {
        throw new Error('client-modules: window.__DSH_BOOT__ is missing or not an object');
    }
    const graph = wire;
    if (typeof graph.rev !== 'string') {
        throw new Error('client-modules: boot manifest rev must be a string');
    }
    if (!Array.isArray(graph.entries)) {
        throw new Error('client-modules: boot manifest entries must be an array');
    }
    const modules = [];
    const plugins = [];
    for (const value of graph.entries) {
        if (typeof value !== 'object' || value === null) {
            throw new Error('client-modules: boot manifest entry is not an object');
        }
        const row = value;
        const where = typeof row.id === 'string' ? `"${row.id}"` : JSON.stringify(row);
        if (typeof row.id !== 'string' || typeof row.url !== 'string' || typeof row.rev !== 'string') {
            throw new Error(`client-modules: boot manifest entry ${where} must carry string id/url/rev`);
        }
        if (row.inject !== undefined && (!Array.isArray(row.inject) || row.inject.some(i => typeof i !== 'string'))) {
            throw new Error(`client-modules: boot manifest entry ${where} inject must be a string array`);
        }
        if (row.immediately !== undefined && typeof row.immediately !== 'boolean') {
            throw new Error(`client-modules: boot manifest entry ${where} immediately must be a boolean`);
        }
        modules.push({ id: row.id, url: row.url, rev: row.rev });
        plugins.push({
            id: row.id,
            inject: row.inject === undefined ? [] : [...row.inject],
            immediately: row.immediately === true,
        });
    }
    return { rev: graph.rev, modules, plugins };
}
//# sourceMappingURL=manifest.js.map