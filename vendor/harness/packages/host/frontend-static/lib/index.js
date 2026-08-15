import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
//#region lib/types/index.js
/**
* @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
* fallback seat: serves the built frontend directory with the semantics the
* Web shell locked at step1 — traversal outside the dist root is 403, any
* miss falls back to index.html with HTTP 200 (SPA routing), unknown
* extensions ship as octet-stream, non-GET/HEAD is 405. Every index response
* runs through the webserver's registered index taps (boot-manifest
* injection). The dist location is workspace knowledge of the composing
* application, so `distIndex` is typically supplied through a `!!js`
* expression, never hardcoded by a deployment.
* @module @deepseek-ai/dsh-host-frontend-static
*/
/** Stable Cordis plugin name. */
const name = "frontend-static";
/** Service required before the fallback seat can be claimed. */
const inject = ["webServer"];
const Config = z.object({ distIndex: z.string().required() });
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".json": "application/json",
	".map": "application/json",
	".webmanifest": "application/manifest+json"
};
/**
* Serve one GET/HEAD static request from the dist root.
* @param pathname - decoded URL pathname of the request.
* @param res - the node:http response to write.
* @param distRoot - absolute dist root directory (resolved by the caller).
* @param distIndex - absolute path of index.html inside distRoot.
* @param renderIndex - produces the index.html body (index-tap injection) for
* `/` and every SPA fallback.
*/
async function serveStatic(pathname, res, distRoot, distIndex, renderIndex) {
	const target = resolve(normalize(join(distRoot, pathname)));
	if (target !== distRoot && !target.startsWith(distRoot + sep)) {
		res.writeHead(403);
		res.end();
		return;
	}
	const serveIndex = async () => {
		const body = await renderIndex();
		res.writeHead(200, { "content-type": MIME[".html"] });
		res.end(body);
	};
	if (target === distRoot || target === distIndex) {
		await serveIndex();
		return;
	}
	try {
		const body = await readFile(target);
		res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
		res.end(body);
	} catch {
		await serveIndex();
	}
}
/**
* Claim the webserver fallback seat and serve the dist.
* @param ctx - plugin context carrying the webServer service.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	const distIndex = config.distIndex;
	const distRoot = dirname(distIndex);
	const renderIndex = async () => ctx.webServer.applyIndexTaps(await readFile(distIndex, "utf8"));
	ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405);
			res.end();
			return;
		}
		/* v8 ignore next -- node:http always sets url on server requests */
		const rawPath = new URL(req.url ?? "/", "http://x").pathname;
		await serveStatic(decodeURIComponent(rawPath), res, distRoot, distIndex, renderIndex);
	}), "frontend-static: fallback seat");
}
//#endregion
export { Config, apply, inject, name, serveStatic };
