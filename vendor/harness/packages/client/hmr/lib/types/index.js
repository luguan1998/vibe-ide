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
import { statSync } from 'node:fs';
import z from '@deepseek-ai/schemastery';
import { EVENTS_ENDPOINT } from "./events.js";
export { EVENTS_ENDPOINT } from "./events.js";
/** Cordis plugin name. */
export const name = 'client-hmr';
/** Required services: the web plugin table and the route registry. */
export const inject = ['clientModules', 'webServer'];
export const Config = z.object({
    pollIntervalMs: z.number().step(1).min(1).default(500),
});
/** Serialize one frame as an SSE data line. */
function sseData(frame) {
    return `data: ${JSON.stringify(frame)}\n\n`;
}
/**
 * Mount the dev chain: bundle watches, rebuilt reporting, and the SSE channel.
 * @param ctx - host plugin context carrying clientModuleHost and webServer.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
    // schemastery's .default() guarantees the field is set after validation.
    const pollIntervalMs = config.pollIntervalMs;
    // --- bundle watch: one HMR-owned stat poll ------------------------------
    const watched = new Map();
    const rehash = (id, watch, current) => {
        try {
            // rebuilt() re-hashes; an unchanged hash stays silent (clientModuleHost
            // fires onRebuilt only on a real rev change).
            ctx.clientModules.rebuilt(id);
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT') {
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
        }
        catch (error) {
            watched.set(id, { path, mtimeMs: 0, size: 0, dirty: true });
            if (error.code !== 'ENOENT')
                ctx.logger.warn(error);
            return;
        }
        const watch = { path, mtimeMs: baseline.mtimeMs, size: baseline.size, dirty: false };
        watched.set(id, watch);
        // The module host hashed before publishing the graph. Re-hash immediately
        // after capturing this baseline so a write in between cannot become an
        // already-current baseline paired with a stale graph rev.
        rehash(id, watch, baseline);
    };
    const pollWatches = () => {
        for (const [id, watch] of watched) {
            let current;
            try {
                current = statSync(watch.path);
            }
            catch (error) {
                watch.dirty = true;
                if (error.code !== 'ENOENT')
                    ctx.logger.warn(error);
                continue;
            }
            if (!watch.dirty && current.mtimeMs === watch.mtimeMs && current.size === watch.size)
                continue;
            // Stat-before-hash preserves a detectable older baseline for writes that
            // land during hashing. Repeated stat changes heal a torn read.
            rehash(id, watch, current);
        }
    };
    // Diff the watch set against the current graph: drop watches for removed
    // rows (or rows whose bundle path moved), add watches for new rows.
    const syncWatches = () => {
        const rows = new Map();
        for (const row of ctx.clientModules.graph().entries) {
            const path = ctx.clientModules.clientPath(row.id);
            if (path !== undefined)
                rows.set(row.id, path);
        }
        for (const [id, watch] of watched) {
            if (rows.get(id) === watch.path)
                continue;
            watched.delete(id);
        }
        for (const [id, path] of rows) {
            if (!watched.has(id))
                watchRow(id, path);
        }
    };
    ctx.effect(() => {
        // Initial sync covers rows already in the graph; the subscription covers
        // rows arriving later (boot-window activations, including this plugin's
        // own row — no self-exemption, a modules/hmr rebuild rides the same chain).
        syncWatches();
        const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches);
        const timer = setInterval(pollWatches, pollIntervalMs);
        timer.unref();
        return () => {
            unsubscribe();
            clearInterval(timer);
            watched.clear();
        };
    }, 'client-hmr: bundle watches');
    // --- /plugins/events SSE channel ----------------------------------------
    const connections = new Set();
    const connect = (res) => {
        res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
        });
        // Comment line on open so clients/proxies see a live channel even when
        // no rebuild ever happens; EventSource frame parsing skips it naturally.
        res.write(': connected\n\n');
        res.write(sseData({ type: 'graph', graph: ctx.clientModules.graph() }));
        connections.add(res);
        res.on('close', () => { connections.delete(res); });
    };
    ctx.effect(() => {
        const disposeRoute = ctx.webServer.register({
            kind: 'exact',
            path: EVENTS_ENDPOINT,
            handler: (req, res) => {
                // Named routes match ahead of the carrier's method gate; keep the old
                // global 405 semantics for non-GET hits on this endpoint.
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    res.writeHead(405);
                    res.end();
                    return;
                }
                connect(res);
            },
        });
        const unsubscribe = ctx.clientModules.onRebuilt((id, rev) => {
            const line = sseData({ type: 'rebuilt', id, rev });
            for (const res of connections)
                res.write(line);
        });
        return () => {
            unsubscribe();
            disposeRoute();
            for (const res of connections)
                res.destroy();
            connections.clear();
        };
    }, 'client-hmr: /plugins/events channel');
}
//# sourceMappingURL=index.js.map