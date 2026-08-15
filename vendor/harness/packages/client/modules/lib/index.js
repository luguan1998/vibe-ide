import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
//#region lib/types/index.js
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
/** Recovery instruction shared by grouped startup and steady-state bundle diagnostics. */
const CLIENT_BUNDLE_BUILD_INSTRUCTION = "run `pnpm run build` before launch";
/** Missing built client export, retained as structured data for activation-error grouping. */
var MissingClientBundleError = class extends Error {
	packageName;
	clientPath;
	constructor(packageName, clientPath, cause) {
		super([
			`client-modules: client bundle not found; ${CLIENT_BUNDLE_BUILD_INSTRUCTION}:`,
			`  package: ${packageName}`,
			`  path: ${clientPath}`
		].join("\n"), { cause });
		this.packageName = packageName;
		this.clientPath = clientPath;
	}
};
/** Activation failures grouped by actionable package-build errors and unrelated failures. */
var ClientPackageCompositionError = class extends AggregateError {
	constructor(failures) {
		const missingBundles = failures.filter((error) => error instanceof MissingClientBundleError);
		const otherFailures = failures.filter((error) => !(error instanceof MissingClientBundleError));
		const packageNoun = failures.length === 1 ? "package" : "packages";
		const lines = [`client-modules: ${String(failures.length)} client ${packageNoun} failed to compose:`];
		if (missingBundles.length > 0) {
			lines.push(`  client bundles not found; ${CLIENT_BUNDLE_BUILD_INSTRUCTION}:`);
			for (const error of missingBundles) lines.push(`    - package: ${error.packageName}`, `      path: ${error.clientPath}`);
		}
		if (otherFailures.length > 0) lines.push("  other failures:", ...otherFailures.map((error) => `    - ${error.message}`));
		super(failures, lines.join("\n"));
	}
};
/** Narrow an unknown parsed JSON value to the `dsh.client` declaration, throwing on malformed fields. */
function parseDshClient(pkgName, value) {
	if (value === void 0) return void 0;
	if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
	const decl = value;
	if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
	if (decl.inject !== void 0 && (!Array.isArray(decl.inject) || decl.inject.some((i) => typeof i !== "string"))) throw new Error(`client-modules: ${pkgName} dsh.client.inject must be a string array`);
	if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
	return {
		platform: decl.platform,
		...decl.inject !== void 0 ? { inject: decl.inject } : {},
		...decl.immediately !== void 0 ? { immediately: decl.immediately } : {}
	};
}
/** Resolve `exports["./client"]` to a relative path, accepting the string and one-level conditional forms. */
function clientExportOf(pkgName, exportsField) {
	if (typeof exportsField !== "object" || exportsField === null) return void 0;
	const client = exportsField["./client"];
	if (client === void 0) return void 0;
	if (typeof client === "string") return client;
	if (typeof client === "object" && client !== null) {
		const fallback = client.default;
		if (typeof fallback === "string") return fallback;
	}
	throw new Error(`client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`);
}
/** sha1 content hash shortened to 12 hex chars (bundle rev / graph rev). */
function shortHash(input) {
	return createHash("sha1").update(input).digest("hex").slice(0, 12);
}
/** Graph row for one bundle rev (url carries the rev as its cache-busting query). */
function graphRow(id, rev, injectEdges, immediately) {
	return {
		id,
		url: `/plugins/${id}/client.js?rev=${rev}`,
		rev,
		...injectEdges !== void 0 ? { inject: injectEdges } : {},
		...immediately ? { immediately: true } : {}
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
function injectBootManifest(html, graph) {
	const script = `<script>window.__DSH_BOOT__ = ${JSON.stringify(graph).replaceAll("<", "\\u003c")}<\/script>`;
	const head = html.indexOf("<head>");
	if (head !== -1) return `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`;
	return `${script}${html}`;
}
/**
* The web plugin table service: incremental `dsh.client` scan + wire composition
* + bundle route + index tap. Construction runs the activation scan
* synchronously — a malformed declaration or missing bundle among the
* already-loaded entries aggregates into one loud throw (FAILED fiber; the
* boot activation audit reports it).
*/
var ClientModuleRegistry = class extends Service {
	static inject = ["webServer", "loader"];
	table = /* @__PURE__ */ new Map();
	pkgMeta = /* @__PURE__ */ new Map();
	rebuildListeners = /* @__PURE__ */ new Set();
	graphListeners = /* @__PURE__ */ new Set();
	dirty = /* @__PURE__ */ new Set();
	resolvePkgJson;
	flushQueued = false;
	composed;
	/**
	* Build the service: subscribe, seed, and run the activation flush.
	* @param ctx - plugin context carrying webServer and loader.
	*/
	constructor(ctx) {
		super(ctx, "clientModules");
		if (ctx.baseUrl === void 0) throw new Error("client-modules: ctx.baseUrl is unset — the node half needs the config-tree anchor to resolve plugin packages");
		const require = createRequire(ctx.baseUrl);
		this.resolvePkgJson = (spec) => require.resolve(`${spec}/package.json`);
		ctx.on("internal/plugin", (fiber) => {
			const entryName = fiber.entry?.options.name;
			if (entryName === void 0) return;
			this.dirty.add(entryName);
			if (this.flushQueued) return;
			this.flushQueued = true;
			queueMicrotask(() => {
				this.flushQueued = false;
				this.flush((err) => {
					ctx.logger.warn(err);
				});
			});
		});
		for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name);
		this.composed = this.compose();
		const failures = [];
		this.flush((err) => failures.push(err));
		if (failures.length > 0) throw new ClientPackageCompositionError(failures);
		ctx.effect(() => ctx.webServer.register({
			kind: "prefix",
			path: "/plugins",
			handler: this.serveBundle
		}), "client-modules: bundle route");
		ctx.effect(() => ctx.webServer.tapIndex((html) => injectBootManifest(html, this.composed)), "client-modules: boot manifest injection");
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
		if (record === void 0) return void 0;
		const rev = shortHash(readFileSync(record.clientPath));
		if (rev === record.entry.rev) return rev;
		record.entry = graphRow(id, rev, record.entry.inject, record.entry.immediately === true);
		this.composed = this.compose();
		for (const notify of this.rebuildListeners) try {
			notify(id, rev);
		} catch (error) {
			this.ctx.logger.error(error);
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
		return () => {
			this.rebuildListeners.delete(listener);
		};
	}
	/**
	* Fires after any flush that recomposed the graph (row added/removed, or a
	* rebuilt rev change). Pull model: listeners re-read {@link graph}.
	* @param listener - notified with no payload.
	* @returns the unsubscriber.
	*/
	onGraphChanged(listener) {
		this.graphListeners.add(listener);
		return () => {
			this.graphListeners.delete(listener);
		};
	}
	compose() {
		const entries = [...this.table.values()].map((record) => record.entry);
		return {
			rev: shortHash(JSON.stringify(entries)),
			entries
		};
	}
	notifyGraphChanged() {
		for (const listener of this.graphListeners) try {
			listener();
		} catch (error) {
			this.ctx.logger.error(error);
		}
	}
	resolveMeta(pkgName) {
		const cached = this.pkgMeta.get(pkgName);
		if (cached !== void 0) return cached;
		let pkgPath;
		try {
			pkgPath = this.resolvePkgJson(pkgName);
		} catch {
			this.pkgMeta.set(pkgName, null);
			return null;
		}
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		const dsh = pkg.dsh;
		const decl = parseDshClient(pkgName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0);
		if (decl === void 0 || decl.platform !== "web") {
			this.pkgMeta.set(pkgName, null);
			return null;
		}
		const clientRel = clientExportOf(pkgName, pkg.exports);
		if (clientRel === void 0) throw new Error(`client-modules: ${pkgName} declares dsh.client but exports no "./client" bundle`);
		const meta = {
			clientPath: join(dirname(pkgPath), clientRel),
			...decl.inject !== void 0 ? { inject: decl.inject } : {},
			immediately: decl.immediately === true
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
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			throw new MissingClientBundleError(pkgName, clientPath, error);
		}
	}
	/** Reconcile one entry name against the live loader entries. @returns whether the table changed. */
	processOne(entryName) {
		let qualifies = false;
		for (const entry of this.ctx.loader.entries()) if (entry.options.name === entryName && entry.fiber !== void 0 && !entry.disabled) {
			qualifies = true;
			break;
		}
		if (!qualifies) return this.table.delete(entryName);
		if (this.table.has(entryName)) return false;
		const meta = this.resolveMeta(entryName);
		if (meta === null) return false;
		const rev = this.initialBundleRevision(entryName, meta.clientPath);
		this.table.set(entryName, {
			entry: graphRow(entryName, rev, meta.inject, meta.immediately),
			clientPath: meta.clientPath
		});
		return true;
	}
	flush(onError) {
		let changed = false;
		for (const entryName of [...this.dirty]) {
			this.dirty.delete(entryName);
			try {
				if (this.processOne(entryName)) changed = true;
			} catch (error) {
				onError(error instanceof Error ? error : new Error(String(error)));
			}
		}
		if (changed) {
			this.composed = this.compose();
			this.notifyGraphChanged();
		}
	}
	serveBundle = async (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405);
			res.end();
			return;
		}
		/* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
		const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
		const prefix = "/plugins/";
		const mapSuffix = "/client.js.map";
		const bundleSuffix = "/client.js";
		const isSourceMap = pathname.startsWith(prefix) && pathname.endsWith(mapSuffix);
		const suffix = isSourceMap ? mapSuffix : bundleSuffix;
		const clientPath = pathname.startsWith(prefix) && pathname.endsWith(suffix) ? this.clientPath(pathname.slice(9, -suffix.length)) : void 0;
		const path = clientPath === void 0 ? void 0 : `${clientPath}${isSourceMap ? ".map" : ""}`;
		if (path === void 0) {
			res.writeHead(404);
			res.end();
			return;
		}
		try {
			const body = await readFile(path);
			res.writeHead(200, {
				"content-type": isSourceMap ? "application/json; charset=utf-8" : "text/javascript; charset=utf-8",
				"cache-control": "no-cache"
			});
			res.end(body);
		} catch {
			res.writeHead(404);
			res.end();
		}
	};
};
//#endregion
export { ClientModuleRegistry, ClientModuleRegistry as default, injectBootManifest };
