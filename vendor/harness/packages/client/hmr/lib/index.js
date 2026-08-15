import { statSync } from "node:fs";
import z from "@deepseek-ai/schemastery";
//#region lib/types/events.js
/**
* Wire protocol of the `/plugins/events` dev SSE channel — single source for
* both halves of this package. Frames still cross a wire boundary: the
* browser half validates them at its JSON parse point; sharing the type keeps
* the two ends from drifting, not from parsing.
*/
/** System SSE endpoint pushing graph/rebuilt frames (wire protocol constant). */
const EVENTS_ENDPOINT = "/plugins/events";
//#endregion
//#region lib/types/index.js
/**
* HMR plugin, node half: the host end of the dev reload chain. One interval
* stat-polls every graph row's client bundle (polling by design: network
* mounts deliver no inotify events), reports content changes through
* `clientModuleHost.rebuilt(id)`, and serves the `/plugins/events` SSE channel
* broadcasting graph/rebuilt frames to the browser half (src/client/).
* The web bundle mounts this row unconditionally: without a rebuild
* watcher rewriting client bundles, the poll observes no changes and the
* chain stays idle.
*/
/** Cordis plugin name. */
const name = "client-hmr";
/** Required services: the web plugin table and the route registry. */
const inject = ["clientModules", "webServer"];
const Config = z.object({ pollIntervalMs: z.number().step(1).min(1).default(500) });
/** Serialize one frame as an SSE data line. */
function sseData(frame) {
	return `data: ${JSON.stringify(frame)}\n\n`;
}
/**
* Mount the dev chain: bundle watches, rebuilt reporting, and the SSE channel.
* @param ctx - host plugin context carrying clientModuleHost and webServer.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	const pollIntervalMs = config.pollIntervalMs;
	const watched = /* @__PURE__ */ new Map();
	const rehash = (id, watch, current) => {
		try {
			ctx.clientModules.rebuilt(id);
		} catch (error) {
			if (error.code === "ENOENT") {
				watch.dirty = true;
				return;
			}
			ctx.logger.warn(error);
		}
		watch.mtimeMs = current.mtimeMs;
		watch.size = current.size;
		watch.dirty = false;
	};
	const watchRow = (id, path) => {
		let baseline;
		try {
			baseline = statSync(path);
		} catch (error) {
			watched.set(id, {
				path,
				mtimeMs: 0,
				size: 0,
				dirty: true
			});
			if (error.code !== "ENOENT") ctx.logger.warn(error);
			return;
		}
		const watch = {
			path,
			mtimeMs: baseline.mtimeMs,
			size: baseline.size,
			dirty: false
		};
		watched.set(id, watch);
		rehash(id, watch, baseline);
	};
	const pollWatches = () => {
		for (const [id, watch] of watched) {
			let current;
			try {
				current = statSync(watch.path);
			} catch (error) {
				watch.dirty = true;
				if (error.code !== "ENOENT") ctx.logger.warn(error);
				continue;
			}
			if (!watch.dirty && current.mtimeMs === watch.mtimeMs && current.size === watch.size) continue;
			rehash(id, watch, current);
		}
	};
	const syncWatches = () => {
		const rows = /* @__PURE__ */ new Map();
		for (const row of ctx.clientModules.graph().entries) {
			const path = ctx.clientModules.clientPath(row.id);
			if (path !== void 0) rows.set(row.id, path);
		}
		for (const [id, watch] of watched) {
			if (rows.get(id) === watch.path) continue;
			watched.delete(id);
		}
		for (const [id, path] of rows) if (!watched.has(id)) watchRow(id, path);
	};
	ctx.effect(() => {
		syncWatches();
		const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches);
		const timer = setInterval(pollWatches, pollIntervalMs);
		timer.unref();
		return () => {
			unsubscribe();
			clearInterval(timer);
			watched.clear();
		};
	}, "client-hmr: bundle watches");
	const connections = /* @__PURE__ */ new Set();
	const connect = (res) => {
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			"connection": "keep-alive"
		});
		res.write(": connected\n\n");
		res.write(sseData({
			type: "graph",
			graph: ctx.clientModules.graph()
		}));
		connections.add(res);
		res.on("close", () => {
			connections.delete(res);
		});
	};
	ctx.effect(() => {
		const disposeRoute = ctx.webServer.register({
			kind: "exact",
			path: EVENTS_ENDPOINT,
			handler: (req, res) => {
				if (req.method !== "GET" && req.method !== "HEAD") {
					res.writeHead(405);
					res.end();
					return;
				}
				connect(res);
			}
		});
		const unsubscribe = ctx.clientModules.onRebuilt((id, rev) => {
			const line = sseData({
				type: "rebuilt",
				id,
				rev
			});
			for (const res of connections) res.write(line);
		});
		return () => {
			unsubscribe();
			disposeRoute();
			for (const res of connections) res.destroy();
			connections.clear();
		};
	}, "client-hmr: /plugins/events channel");
}
//#endregion
export { Config, EVENTS_ENDPOINT, apply, inject, name };
