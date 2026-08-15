/**
 * Node half of the client module system (`dsh.client` dual-face package): scans
 * the host Loader's entries for packages declaring `dsh.client`, composes the
 * `window.__DSH_BOOT__` entry graph (wire single source: {@link WebBootEntry}
 * in `./client/manifest.ts`), serves `/plugins/<id>/client.js` and its source
 * map, taps the index render to inject the boot manifest, and provides the
 * `clientModuleHost` service (the HMR node half's registration/notification
 * face).
 *
 * Scanning is incremental per package — there is no full-rescan code path.
 * Every cordis `internal/plugin` emission (fiber construction/disposal) marks
 * the fiber's entry name dirty; a microtask flush reconciles each dirty name
 * against the live loader entries. The activation pass seeds the same dirty
 * set with all current entries and flushes synchronously, so first scan and
 * steady state share one implementation. Package metadata (including the
 * negative "not a client package" verdict) is cached per name and never
 * expires — plugin-set changes take effect on restart; bundle content
 * changes reach the graph only through
 * {@link ClientModuleRegistry.rebuilt}.
 * @module @deepseek-ai/dsh-client-modules
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
/** Recovery instruction shared by grouped startup and steady-state bundle diagnostics. */
const CLIENT_BUNDLE_BUILD_INSTRUCTION = 'run `pnpm run build` before launch';
/** Missing built client export, retained as structured data for activation-error grouping. */
class MissingClientBundleError extends Error {
    packageName;
    clientPath;
    constructor(packageName, clientPath, cause) {
        super([
            `client-modules: client bundle not found; ${CLIENT_BUNDLE_BUILD_INSTRUCTION}:`,
            `  package: ${packageName}`,
            `  path: ${clientPath}`,
        ].join('\n'), { cause });
        this.packageName = packageName;
        this.clientPath = clientPath;
    }
}
/** Activation failures grouped by actionable package-build errors and unrelated failures. */
class ClientPackageCompositionError extends AggregateError {
    constructor(failures) {
        const missingBundles = failures.filter((error) => error instanceof MissingClientBundleError);
        const otherFailures = failures.filter(error => !(error instanceof MissingClientBundleError));
        const packageNoun = failures.length === 1 ? 'package' : 'packages';
        const lines = [`client-modules: ${String(failures.length)} client ${packageNoun} failed to compose:`];
        if (missingBundles.length > 0) {
            lines.push(`  client bundles not found; ${CLIENT_BUNDLE_BUILD_INSTRUCTION}:`);
            for (const error of missingBundles) {
                lines.push(`    - package: ${error.packageName}`, `      path: ${error.clientPath}`);
            }
        }
        if (otherFailures.length > 0) {
            lines.push('  other failures:', ...otherFailures.map(error => `    - ${error.message}`));
        }
        super(failures, lines.join('\n'));
    }
}
/** Narrow an unknown parsed JSON value to the `dsh.client` declaration, throwing on malformed fields. */
function parseDshClient(pkgName, value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'object' || value === null) {
        throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
    }
    const decl = value;
    if (typeof decl.platform !== 'string') {
        throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
    }
    if (decl.inject !== undefined && (!Array.isArray(decl.inject) || decl.inject.some(i => typeof i !== 'string'))) {
        throw new Error(`client-modules: ${pkgName} dsh.client.inject must be a string array`);
    }
    if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
        throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
    }
    return {
        platform: decl.platform,
        ...(decl.inject !== undefined ? { inject: decl.inject } : {}),
        ...(decl.immediately !== undefined ? { immediately: decl.immediately } : {}),
    };
}
/** Resolve `exports["./client"]` to a relative path, accepting the string and one-level conditional forms. */
function clientExportOf(pkgName, exportsField) {
    if (typeof exportsField !== 'object' || exportsField === null)
        return undefined;
    const client = exportsField['./client'];
    if (client === undefined)
        return undefined;
    if (typeof client === 'string')
        return client;
    if (typeof client === 'object' && client !== null) {
        const fallback = client.default;
        if (typeof fallback === 'string')
            return fallback;
    }
    throw new Error(`client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`);
}
/** sha1 content hash shortened to 12 hex chars (bundle rev / graph rev). */
function shortHash(input) {
    return createHash('sha1').update(input).digest('hex').slice(0, 12);
}
/** Graph row for one bundle rev (url carries the rev as its cache-busting query). */
function graphRow(id, rev, injectEdges, immediately) {
    return {
        id,
        url: `/plugins/${id}/client.js?rev=${rev}`,
        rev,
        ...(injectEdges !== undefined ? { inject: injectEdges } : {}),
        ...(immediately ? { immediately: true } : {}),
    };
}
/**
 * Inject the boot entry graph into index.html: `window.__DSH_BOOT__` as the
 * first script in <head> (before the shell bundle reads it). `<` is escaped in
 * the JSON so plugin-controlled strings cannot break out of the script element.
 * @param html - the index.html source.
 * @param graph - the composed entry graph.
 * @returns the html with the graph script injected.
 */
export function injectBootManifest(html, graph) {
    const json = JSON.stringify(graph).replaceAll('<', '\\u003c');
    const script = `<script>window.__DSH_BOOT__ = ${json}</script>`;
    const head = html.indexOf('<head>');
    if (head !== -1)
        return `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`;
    // Headless fixture pages may lack <head>; prepending keeps the read-before-shell ordering.
    return `${script}${html}`;
}
/**
 * The web plugin table service: incremental `dsh.client` scan + wire composition
 * + bundle route + index tap. Construction runs the activation scan
 * synchronously — a malformed declaration or missing bundle among the
 * already-loaded entries aggregates into one loud throw (FAILED fiber; the
 * boot activation audit reports it).
 */
export class ClientModuleRegistry extends Service {
    static inject = ['webServer', 'loader'];
    table = new Map();
    // Negative verdicts (unresolvable specifier — builtins like cordis:include,
    // subpath rows — or a package without a web `dsh.client` declaration) are
    // cached as null and never expire: plugin-set changes take effect on restart.
    pkgMeta = new Map();
    rebuildListeners = new Set();
    graphListeners = new Set();
    dirty = new Set();
    resolvePkgJson;
    flushQueued = false;
    composed;
    /**
     * Build the service: subscribe, seed, and run the activation flush.
     * @param ctx - plugin context carrying webServer and loader.
     */
    constructor(ctx) {
        super(ctx, 'clientModules');
        // Resolution anchor: the config tree's baseUrl (the cordis.yml directory,
        // whose package declares every composed plugin as a dependency). The
        // modules package's own URL would miss sibling packages under pnpm's
        // isolated node_modules.
        if (ctx.baseUrl === undefined) {
            throw new Error('client-modules: ctx.baseUrl is unset — the node half needs the config-tree anchor to resolve plugin packages');
        }
        const require = createRequire(ctx.baseUrl);
        this.resolvePkgJson = spec => require.resolve(`${spec}/package.json`);
        // Subscribe before seeding so a fiber arriving mid-activation lands in the
        // same dirty set (Set idempotence makes the overlap harmless). An entry-less
        // fiber is a child plugin or a manual mount — never a loader row; O(1) drop.
        ctx.on('internal/plugin', (fiber) => {
            const entryName = fiber.entry?.options.name;
            if (entryName === undefined)
                return;
            this.dirty.add(entryName);
            if (this.flushQueued)
                return;
            this.flushQueued = true;
            queueMicrotask(() => {
                this.flushQueued = false;
                this.flush((err) => { ctx.logger.warn(err); });
            });
        });
        // Activation pass: the initial scan IS the incremental path over the
        // current entries, flushed synchronously (nothing async between subscribe,
        // seed, and flush).
        for (const entry of ctx.loader.entries())
            this.dirty.add(entry.options.name);
        this.composed = this.compose();
        const failures = [];
        this.flush(err => failures.push(err));
        if (failures.length > 0) {
            throw new ClientPackageCompositionError(failures);
        }
        ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/plugins', handler: this.serveBundle }), 'client-modules: bundle route');
        ctx.effect(() => ctx.webServer.tapIndex(html => injectBootManifest(html, this.composed)), 'client-modules: boot manifest injection');
    }
    /**
     * Current composed entry graph (stable object between changes).
     * @returns the graph served as `window.__DSH_BOOT__`.
     */
    graph() {
        return this.composed;
    }
    /**
     * Absolute path of an entry's client bundle.
     * @param id - entry id (package name).
     * @returns the path, or undefined for an unknown id.
     */
    clientPath(id) {
        return this.table.get(id)?.clientPath;
    }
    /**
     * Re-hash one bundle (the HMR watch's registration hook — the only entry
     * point through which bundle content changes reach the graph).
     * @param id - entry id (package name).
     * @returns the new rev, or undefined for an unknown id.
     */
    rebuilt(id) {
        const record = this.table.get(id);
        if (record === undefined)
            return undefined;
        const rev = shortHash(readFileSync(record.clientPath));
        if (rev === record.entry.rev)
            return rev;
        record.entry = graphRow(id, rev, record.entry.inject, record.entry.immediately === true);
        this.composed = this.compose();
        for (const notify of this.rebuildListeners) {
            // Containment: rebuilt() runs inside the HMR watch callback — a
            // throwing subscriber must not kill the poll or skip later subscribers.
            try {
                notify(id, rev);
            }
            catch (error) {
                this.ctx.logger.error(error);
            }
        }
        this.notifyGraphChanged();
        return rev;
    }
    /**
     * Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.
     * @param listener - receives the entry id and its new bundle rev.
     * @returns the unsubscriber.
     */
    onRebuilt(listener) {
        this.rebuildListeners.add(listener);
        return () => { this.rebuildListeners.delete(listener); };
    }
    /**
     * Fires after any flush that recomposed the graph (row added/removed, or a
     * rebuilt rev change). Pull model: listeners re-read {@link graph}.
     * @param listener - notified with no payload.
     * @returns the unsubscriber.
     */
    onGraphChanged(listener) {
        this.graphListeners.add(listener);
        return () => { this.graphListeners.delete(listener); };
    }
    compose() {
        const entries = [...this.table.values()].map(record => record.entry);
        return { rev: shortHash(JSON.stringify(entries)), entries };
    }
    notifyGraphChanged() {
        for (const listener of this.graphListeners) {
            // A throwing subscriber must not skip later subscribers (or escape into
            // whatever triggered the flush — possibly an fs.watchFile callback).
            try {
                listener();
            }
            catch (error) {
                this.ctx.logger.error(error);
            }
        }
    }
    resolveMeta(pkgName) {
        const cached = this.pkgMeta.get(pkgName);
        if (cached !== undefined)
            return cached;
        let pkgPath;
        try {
            pkgPath = this.resolvePkgJson(pkgName);
        }
        catch {
            // Not a resolvable package root: loader builtins (cordis:include) and
            // subpath entries (…/gateway) land here — permanently not a client row.
            this.pkgMeta.set(pkgName, null);
            return null;
        }
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const dsh = pkg.dsh;
        const decl = parseDshClient(pkgName, dsh !== null && typeof dsh === 'object' ? dsh.client : undefined);
        if (decl === undefined || decl.platform !== 'web') {
            this.pkgMeta.set(pkgName, null);
            return null;
        }
        const clientRel = clientExportOf(pkgName, pkg.exports);
        if (clientRel === undefined) {
            throw new Error(`client-modules: ${pkgName} declares dsh.client but exports no "./client" bundle`);
        }
        const meta = {
            clientPath: join(dirname(pkgPath), clientRel),
            ...(decl.inject !== undefined ? { inject: decl.inject } : {}),
            immediately: decl.immediately === true,
        };
        this.pkgMeta.set(pkgName, meta);
        return meta;
    }
    /**
     * Read the activation-time bundle revision.
     * @param pkgName - package that declares the client bundle.
     * @param clientPath - absolute path of the built client artifact.
     * @returns the bundle content's short hash for use as its revision.
     * @throws {MissingClientBundleError} when the read fails with `ENOENT`; other filesystem errors are rethrown unchanged.
     */
    initialBundleRevision(pkgName, clientPath) {
        try {
            return shortHash(readFileSync(clientPath));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            throw new MissingClientBundleError(pkgName, clientPath, error);
        }
    }
    /** Reconcile one entry name against the live loader entries. @returns whether the table changed. */
    processOne(entryName) {
        let qualifies = false;
        for (const entry of this.ctx.loader.entries()) {
            if (entry.options.name === entryName && entry.fiber !== undefined && !entry.disabled) {
                qualifies = true;
                break;
            }
        }
        if (!qualifies)
            return this.table.delete(entryName);
        if (this.table.has(entryName))
            return false;
        const meta = this.resolveMeta(entryName);
        if (meta === null)
            return false;
        // The rev rides the row from here on: a fiber restart reuses the row (and
        // its rev) untouched; only rebuilt() re-reads the bundle.
        const rev = this.initialBundleRevision(entryName, meta.clientPath);
        this.table.set(entryName, { entry: graphRow(entryName, rev, meta.inject, meta.immediately), clientPath: meta.clientPath });
        return true;
    }
    flush(onError) {
        let changed = false;
        for (const entryName of [...this.dirty]) {
            this.dirty.delete(entryName);
            try {
                if (this.processOne(entryName))
                    changed = true;
            }
            catch (error) {
                // Steady state: one broken package must not poison the others; the
                // activation pass aggregates these into a loud throw instead.
                onError(error instanceof Error ? error : new Error(String(error)));
            }
        }
        if (changed) {
            this.composed = this.compose();
            this.notifyGraphChanged();
        }
    }
    serveBundle = async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405);
            res.end();
            return;
        }
        /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        // The id may contain a scope slash. Anything else under /plugins (including
        // /plugins/events when the HMR row is absent) is an unknown resource.
        const prefix = '/plugins/';
        const mapSuffix = '/client.js.map';
        const bundleSuffix = '/client.js';
        const isSourceMap = pathname.startsWith(prefix) && pathname.endsWith(mapSuffix);
        const suffix = isSourceMap ? mapSuffix : bundleSuffix;
        const clientPath = pathname.startsWith(prefix) && pathname.endsWith(suffix)
            ? this.clientPath(pathname.slice(prefix.length, -suffix.length))
            : undefined;
        const path = clientPath === undefined ? undefined : `${clientPath}${isSourceMap ? '.map' : ''}`;
        if (path === undefined) {
            res.writeHead(404);
            res.end();
            return;
        }
        try {
            const body = await readFile(path);
            res.writeHead(200, {
                'content-type': isSourceMap ? 'application/json; charset=utf-8' : 'text/javascript; charset=utf-8',
                'cache-control': 'no-cache',
            });
            res.end(body);
        }
        catch {
            // Registered but unreadable (bundle not built yet): loud 404 beats a silent SPA-fallback HTML page.
            res.writeHead(404);
            res.end();
        }
    };
}
export default ClientModuleRegistry;
//# sourceMappingURL=index.js.map