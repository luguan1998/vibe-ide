import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { addHarnessSourceSection } from "@deepseek-ai/dsh-app-boot";
import * as FrontendStatic from "@deepseek-ai/dsh-host-frontend-static";
//#region lib/types/index.js
/**
* @deepseek-ai/dsh-web-app — the browser-surface bundle's runtime glue plugin
* plus the bundle patch (`cordis.patch.yml`, declared by the `dsh.bundle.patch`
* manifest field). The plugin owns the browser-surface glue: it resolves
* the built frontend dist (workspace knowledge of this bundle, never user
* config), mounts the `frontend-static` fallback owner over it, registers the
* harness-source and web-surface prompt sections, the bash-visible web runtime
* variable, and the URL line. App command-line values arrive through the
* `webStartup` service expressions in the bundle patch.
* @module @deepseek-ai/dsh-web-app
*/
/** Stable Cordis plugin name. */
const name = "web-app";
/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
/** Runtime service that releases Web rows after bind-dependent values resolve. */
const WEB_RUNTIME_SERVICE = "webRuntime";
/** Services required before the web runtime can mount. */
const inject = ["webServer"];
const Config = z.object({
	printUrl: z.boolean().default(true),
	surfaceContext: z.boolean().default(true),
	trustedHosts: z.array(String).default([])
});
/** Environment variable naming the canonical local URL of this Web GUI. */
const DSH_WEB_URL = "DSH_WEB_URL";
const LOOPBACK_HOST = "127.0.0.1";
/** The webserver schema's all-interfaces bind literal. */
const ALL_INTERFACES_HOST = "0.0.0.0";
/**
* Resolve one LAN-trust snapshot from the active server bind.
*
* Derived entries are port-less IP literals: DNS rebinding needs an
* attacker-controlled name, while an IP-literal Host is safe on any port and
* an OS-assigned port is unknowable before bind.
* @param bindHost - the active webserver bind host.
* @param extra - explicit `--trusted-host` values, in argument order.
* @returns the LAN display addresses and invocation-derived fence authorities.
*/
function resolveLanTrust(bindHost, extra) {
	const lanAddresses = bindHost === ALL_INTERFACES_HOST ? Object.values(networkInterfaces()).flat().filter((iface) => iface !== void 0 && iface.family === "IPv4" && !iface.internal).map((iface) => iface.address) : [];
	return {
		lanAddresses,
		trustedHosts: [...lanAddresses, ...extra]
	};
}
/** Model-visible orientation and acceptance boundary for sessions created through `dsh web`. */
function webSurfacePrompt(webUrl) {
	return `You are interacting with the user through the DeepSeek Harness Web GUI at ${webUrl}. When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. The browser provides no implicit DOM, route, or screenshot context. The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while \`pnpm run dev:web\` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.`;
}
/** Resolve the canonical loopback URL from the active Web server. */
function localWebUrl(ctx) {
	const port = ctx.get("webServer")?.port;
	if (port === void 0) throw new Error("web-app: webServer service missing while resolving Web runtime");
	return `http://${LOOPBACK_HOST}:${String(port)}`;
}
/** Dist location is workspace knowledge of this bundle: resolved through the frontend package exports, not configured. */
function resolveDistIndex() {
	const require = createRequire(import.meta.url);
	try {
		return require.resolve("@deepseek-ai/dsh-web-frontend/dist/index.html");
	} catch {
		/* v8 ignore next 2 -- reachable only on a checkout without a built dist; the test tree builds it */
		throw new Error("web-app: frontend dist not built; run pnpm run build from the repository root first");
	}
}
/** Test hook: hosts with no built frontend dist substitute the resolver; production never touches this. */
const internals = { resolveDistIndex };
/**
* Mount the Web runtime: dist serving, surface prompt, the bash runtime
* variable, and the URL line.
* @param ctx - plugin context carrying the webServer service.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	const runtime = resolveLanTrust(ctx.webServer.host, config.trustedHosts);
	ctx.provide(WEB_RUNTIME_SERVICE, runtime);
	ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() });
	if (config.surfaceContext) {
		ctx.inject(["systemPrompt"], (promptCtx) => {
			addHarnessSourceSection(promptCtx, SOURCE_ROOT);
			promptCtx.systemPrompt.section({
				name: "app:web-surface",
				order: -98,
				text: () => webSurfacePrompt(localWebUrl(promptCtx))
			});
		});
		ctx.inject(["shellEnv"], (runtimeCtx) => {
			runtimeCtx.shellEnv.register({
				name: "web-runtime",
				variables: { [DSH_WEB_URL]: { description: "Canonical local URL of the DeepSeek Harness Web GUI serving this session." } },
				resolve: () => ({ [DSH_WEB_URL]: localWebUrl(runtimeCtx) })
			});
		});
	}
	if (config.printUrl) {
		const printUrl = () => {
			const lanCandidate = runtime.lanAddresses[0];
			const port = ctx.webServer.port;
			console.log(`dsh web: ${localWebUrl(ctx)}${lanCandidate === void 0 ? "" : ` (LAN: http://${lanCandidate}:${String(port)})`}`);
		};
		const settled = ctx.get("loader")?.await();
		if (settled === void 0) printUrl();
		else settled.then(() => {
			if (ctx.get("webServer") !== void 0) printUrl();
		}, () => {});
	}
}
//#endregion
export { Config, apply, inject, internals, name, resolveLanTrust };
