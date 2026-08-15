import * as ReactJsxRuntime from "react/jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import * as Cordis from "@deepseek-ai/cordis";
import { Context } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import * as ReactDomClient from "react-dom/client";
import { createRoot } from "react-dom/client";
import * as ModulesClient from "@deepseek-ai/dsh-client-modules/client";
import { ClientModuleSystem, parseBootManifest } from "@deepseek-ai/dsh-client-modules/client";
import * as WebReact from "@deepseek-ai/dsh-client-web-react";
import { bindSnapshotSelector, createSlotRenderer } from "@deepseek-ai/dsh-client-web-react";
import * as React from "react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import * as ReactDom from "react-dom";
import * as UiSlots from "@deepseek-ai/dsh-client-ui-slots";
import * as UiPrimitives from "@deepseek-ai/dsh-client-ui-primitives";
import * as UiAttachment from "@deepseek-ai/dsh-client-ui-attachment";
import * as SchemaForm from "@deepseek-ai/dsh-client-schema-form";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region lib/types/DocumentTitle.js
/**
* Project the selected durable session title into the browser title and
* restore the shell's original product title when unmounted.
* @param props - selected session title projection.
* @returns no rendered content.
*/
function DocumentTitle({ title }) {
	const original = useRef(document.title);
	useEffect(() => {
		document.title = title === void 0 ? original.current : `${title} — ${original.current}`;
		return () => {
			document.title = original.current;
		};
	}, [title]);
	return null;
}
//#endregion
//#region lib/types/app.js
/**
* Build the renderApp factory the app-shell plugin provides to AppRoot.
* @param deps - assembly inputs.
* @returns factory producing the real UI tree (called once per AppRoot render after settled).
*/
function buildRenderApp(deps) {
	const { ctx } = deps;
	const sessions = ctx.get("sessions");
	if (sessions === void 0) throw new Error("shell assembly: sessions service unavailable");
	const useSessions = bindSnapshotSelector(sessions.list);
	const SessionDocumentTitle = () => {
		const title = useSessions((state) => {
			const id = state.current;
			return id === void 0 ? void 0 : state.byId[id]?.title;
		});
		return jsx(DocumentTitle, { ...title === void 0 ? {} : { title } });
	};
	return () => jsxs(Fragment, { children: [jsx(SessionDocumentTitle, {}), ctx.slots.renderSlot("root", {})] });
}
//#endregion
//#region lib/types/app-shell.js
var app_shell_exports = /* @__PURE__ */ __exportAll({
	APP_SHELL_ID: () => APP_SHELL_ID,
	apply: () => apply,
	inject: () => inject,
	name: () => name
});
/** Shell-owned pseudo entry id under which the host graph mounts this plugin. */
const APP_SHELL_ID = "@deepseek-ai/dsh-client-app-shell";
/** Cordis plugin name. */
const name = "app-shell";
/** Services required before shell assembly. */
const inject = [
	"slots",
	"sessions",
	"layout"
];
/** Installs the React renderer and exposes the assembled application.
* @param ctx - Plugin context.
*/
function apply(ctx) {
	ctx.slots.install(createSlotRenderer());
	let renderApp;
	ctx.reflect.provide("appShell", { renderApp: () => {
		renderApp ??= buildRenderApp({ ctx });
		return renderApp();
	} });
}
//#endregion
//#region \0dsh-css-stub:./AppRoot.module.css.mjs
var AppRoot_module_css_default = {};
//#endregion
//#region lib/types/AppRoot.js
/**
* Shell root: boot loading page → (boot settled) → real UI in one switch.
* Pure kernel component with zero plugin dependencies — before settled it may
* only rely on itself (the fail-loud presentation must not depend on the
* system whose failure it reports; the status/signal stores are kernel-own,
* shell self-sufficiency rule); the real UI is produced by the
* app-shell entry once every entry is active. A failed boot keeps the
* loading page, lists the per-entry fiber states and the sweep report (fail
* loud, no partial UI).
*/
/** Boot gate: loading page until the boot settles; failures stay here. */
function AppRoot(props) {
	const settled = useSyncExternalStore(props.settled.subscribe, props.settled.getSnapshot);
	const status = useSyncExternalStore(props.status.subscribe, props.status.getSnapshot);
	const error = useSyncExternalStore(props.error.subscribe, props.error.getSnapshot);
	const failed = Object.entries(status).filter(([, s]) => s === "failed");
	if (settled) return jsx(Fragment, { children: props.renderApp() });
	const loud = error !== void 0 || failed.length > 0;
	return jsx("div", {
		className: AppRoot_module_css_default.boot,
		children: jsxs("div", {
			className: AppRoot_module_css_default.card,
			children: [jsx("div", {
				className: AppRoot_module_css_default.wordmark,
				children: "HARNESS"
			}), !loud ? jsxs(Fragment, { children: [jsx("div", { className: AppRoot_module_css_default.spinner }), jsx("div", {
				className: AppRoot_module_css_default.hint,
				children: "Loading plugins…"
			})] }) : jsxs("div", {
				className: AppRoot_module_css_default.failed,
				children: [
					jsx("div", {
						className: AppRoot_module_css_default.failedTitle,
						children: "Failed to load plugins"
					}),
					failed.map(([id]) => jsx("div", {
						className: AppRoot_module_css_default.failedItem,
						children: id
					}, id)),
					error !== void 0 && jsx("div", {
						className: AppRoot_module_css_default.failedItem,
						children: error
					})
				]
			})]
		})
	});
}
//#endregion
//#region lib/types/seed.js
/**
* Platform-singleton module-table. These are the ONLY entities the shell
* shares into the frozen module table — fetch bundles resolve their externals
* against exactly this set through the loader's require. Keys come from the
* platform constant module ({@link ./platform.ts}, the single source
* of truth with the tsdown client externals); values stay shell-static
* imports so every bundle sees the same instance.
*/
/**
* Build the static table handed to the module loader at boot.
* @returns module specifier → exported entity (one entry per platform word).
*/
function getStaticModules() {
	return {
		"react": React,
		"react/jsx-runtime": ReactJsxRuntime,
		"react-dom": ReactDom,
		"react-dom/client": ReactDomClient,
		"@deepseek-ai/cordis": Cordis,
		"@deepseek-ai/dsh-client-ui-slots": UiSlots,
		"@deepseek-ai/dsh-client-web-react": WebReact,
		"@deepseek-ai/dsh-client-ui-primitives": UiPrimitives,
		"@deepseek-ai/dsh-client-ui-attachment": UiAttachment,
		"@deepseek-ai/dsh-client-schema-form": SchemaForm
	};
}
//#endregion
//#region lib/types/loader-status.js
/**
* Value mirror of cordis's `FiberState` const enum: a const enum has no
* runtime object to import (and esbuild-based pipelines cannot inline it
* across modules), so these values mirror the pinned vendored definition
* while retaining its type (same rationale as dsh-tool-cordis's mirror).
*/
const FIBER_STATE = {
	PENDING: 0,
	LOADING: 1,
	ACTIVE: 2,
	FAILED: 3,
	DISPOSED: 4,
	UNLOADING: 5
};
/** Label for each fiber state, keyed by member (inlining-safe — no reverse mapping). */
const STATE_LABELS = {
	[FIBER_STATE.PENDING]: "pending",
	[FIBER_STATE.LOADING]: "loading",
	[FIBER_STATE.ACTIVE]: "active",
	[FIBER_STATE.FAILED]: "failed",
	[FIBER_STATE.DISPOSED]: "disposed",
	[FIBER_STATE.UNLOADING]: "unloading"
};
/**
* Create a writable kernel signal.
* @param init - initial value.
* @returns the signal.
*/
function createSignal(init) {
	let value = init;
	const listeners = /* @__PURE__ */ new Set();
	return {
		getSnapshot: () => value,
		subscribe: (fn) => {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
			};
		},
		set: (next) => {
			value = next;
			for (const fn of [...listeners]) fn();
		}
	};
}
/**
* Create the boot status store.
* @returns the store (empty until the boot chain projects rows).
*/
function createLoaderStatusStore() {
	let value = {};
	const listeners = /* @__PURE__ */ new Set();
	return {
		getSnapshot: () => value,
		subscribe: (fn) => {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
			};
		},
		set: (id, state) => {
			value = {
				...value,
				[id]: state
			};
			for (const fn of [...listeners]) fn();
		}
	};
}
//#endregion
//#region lib/types/boot.js
/**
* Web shell boot kernel — the face consumed by the apps/web entry. Everything
* here is machinery that cannot itself be a loader entry, and none of it
* value-imports a plugin package (shell self-sufficiency rule: the
* loading page must work while — especially when — plugins fail). The one
* sanctioned exception is the modules package (bootstrap
* identity): the module system cannot arrive through itself, so its class
* and its client-half wrapper are shell-bundled and the kernel adopts its
* plugin entry once cordis is up.
*
* AppWebEntry.run(), module face first, then plugin face: parse
* `window.__DSH_BOOT__` into the two-view BootManifest (wire boundary)
* → build the module system over the module-view rows → render the loading
* page → prefetch every `immediately` row in parallel with mounting the
* vendored cordis Loader (`internal` contract injection BEFORE any entry exists —
* the bare-import fallback in tree.import must never run in a browser) →
* await the prefetch tier, THEN adopt the modules entry and create one
* loader entry per plugin-view row plus the shell-own app-shell assembly
* entry → loader.await() + a full fiber sweep (all ACTIVE, else fail
* listing who/what/which service) → flip the settled signal so AppRoot
* switches to the real UI in one pass.
*
* Entry creation waits for the whole immediately tier: materialization runs
* synchronous cross-package require edges (e.g. locale → runtime/client) that
* fiber inject waiting cannot protect — a bundle's factory must be
* registered before any dependent entry materializes. Per-row prefetch
* failures still resolve silently (the create-side import reloads and
* owns the loud failure), so the barrier never turns one bad bundle into a
* boot-wide fail-fast.
*
* Composition lives in the host graph; the shell makes zero composition
* decisions (the app-shell assembly is itself a graph entry, the only
* shell-own module registered with the module system).
*/
/**
* The modules package's own graph row id. The kernel adopts that entry
* itself (its wrapper is statically registered — shell-bundled code, never
* fetched), so the plugin-row loop must skip it: the vendored Group.create
* does not deduplicate by name, and a second fiber would provide 'modules'
* twice.
*/
const MODULES_ID = "@deepseek-ai/dsh-client-modules";
/**
* The web shell kernel: mounts the loading page into a DOM element and runs
* the two-stage boot over the host graph. Fields hold only what must exist
* before cordis does — the parsed manifest, the module system, and the
* loading-page UI handles; everything else lives in plugins.
*/
var AppWebEntry = class {
	el;
	seams;
	status = createLoaderStatusStore();
	settled = createSignal(false);
	error = createSignal(void 0);
	ctx;
	modules;
	manifest;
	root;
	/**
	* Hold the mount point; all work happens in {@link run}.
	* @param el - mount point (the app's #root).
	* @param seams - Optional module transport overrides for test environments.
	*/
	constructor(el, seams) {
		this.el = el;
		this.seams = seams;
	}
	/**
	* Run the boot chain to settlement. Boot-chain failures resolve (not
	* reject): the loading page stays up and renders the failure report (the
	* fail-loud surface the kernel owns). Rejects only when the boot manifest
	* is missing or malformed — there is nothing to boot against.
	* @returns resolves once the UI settled or the failure report rendered.
	*/
	async run() {
		this.manifest = parseBootManifest(globalThis.__DSH_BOOT__);
		this.modules = new ClientModuleSystem({
			modules: this.manifest.modules,
			staticModules: getStaticModules(),
			...this.seams
		});
		this.modules.registerStatic(APP_SHELL_ID, app_shell_exports);
		this.modules.registerStatic(MODULES_ID, ModulesClient);
		globalThis.__DSH_MODULES__ = this.modules;
		this.root = createRoot(this.el);
		this.root.render(jsx(AppRoot, {
			settled: this.settled,
			status: this.status,
			error: this.error,
			renderApp: () => {
				const shell = this.ctx.get("appShell");
				if (shell === void 0) throw new Error("web boot: appShell service missing after settled");
				return shell.renderApp();
			}
		}));
		const prefetching = this.prefetchImmediateTier();
		this.ctx = new Context();
		try {
			await this.runPluginBoot(prefetching);
			this.settled.set(true);
		} catch (reason) {
			console.error(reason);
			this.error.set(reason instanceof Error ? reason.message : String(reason));
		}
	}
	/** Unmount the shell (loading page or settled UI). */
	dispose() {
		this.root?.unmount();
	}
	/** Prefetch the immediately tier (factory registration only; failures defer to the import path). */
	async prefetchImmediateTier() {
		await Promise.all(this.manifest.plugins.filter((row) => row.immediately).map((row) => this.modules.prefetch(row.id).catch(() => {})));
	}
	/** Plugin face: mount the Loader, inject the `internal` contract, adopt modules, create the graph entries, settle, sweep. */
	async runPluginBoot(prefetching) {
		const ctx = this.ctx;
		await ctx.plugin(Loader);
		const loader = ctx.loader;
		loader.internal = this.modules;
		ctx.on("internal/status", (fiber) => {
			const entry = fiber.entry;
			if (entry === void 0 || entry.fiber === void 0) return;
			this.status.set(entry.options.name, STATE_LABELS[entry.fiber.state]);
		});
		await prefetching;
		const rows = [
			MODULES_ID,
			...this.manifest.plugins.map((row) => row.id).filter((id) => id !== MODULES_ID),
			APP_SHELL_ID
		];
		await Promise.all(rows.map(async (name) => {
			this.status.set(name, "loading");
			const id = await loader.create({ name });
			if (loader.resolve(id).fiber === void 0) this.status.set(name, "failed");
		}));
		await loader.await();
		this.assertEntriesActive();
	}
	/**
	* Sweep every loader entry after the tree quiesced: an entry without a
	* fiber failed its import; a fiber not ACTIVE is FAILED (apply threw) or
	* PENDING (a required service never arrived — cordis inject waiting has no
	* timeout, so this sweep is the fail-loud compensation).
	*/
	assertEntriesActive() {
		const ctx = this.ctx;
		const failures = [];
		for (const entry of ctx.loader.entries()) {
			const name = entry.options.name;
			if (entry.fiber === void 0) {
				failures.push(`${name}: import failed (see console for the import error)`);
				continue;
			}
			const state = STATE_LABELS[entry.fiber.state];
			if (state === "active") continue;
			if (state === "pending") {
				const missing = Object.keys(entry.fiber.inject).filter((service) => ctx.get(service) === void 0);
				failures.push(`${name}: pending (waiting for service${missing.length === 1 ? "" : "s"}: ${missing.join(", ") || "unknown"})`);
			} else failures.push(`${name}: ${state}`);
		}
		if (failures.length > 0) throw new Error(`web boot: ${String(failures.length)} entr${failures.length === 1 ? "y" : "ies"} did not activate\n${failures.join("\n")}`);
	}
};
//#endregion
//#region lib/types/platform.js
/**
* Shared browser platform modules. Seeding, bundling externals, and Vite
* aliases consume this list so their module identities cannot drift.
* @module @deepseek-ai/dsh-client-web/src/platform
*/
/** The module specifiers the shell shares into the frozen module table. */
const PLATFORM_MODULES = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	"react-dom/client",
	"@deepseek-ai/cordis",
	"@deepseek-ai/dsh-client-ui-slots",
	"@deepseek-ai/dsh-client-web-react",
	"@deepseek-ai/dsh-client-ui-primitives",
	"@deepseek-ai/dsh-client-ui-attachment",
	"@deepseek-ai/dsh-client-schema-form"
];
//#endregion
export { APP_SHELL_ID, AppRoot, AppWebEntry, DocumentTitle, FIBER_STATE, PLATFORM_MODULES, STATE_LABELS, buildRenderApp, createLoaderStatusStore, createSignal, getStaticModules };
