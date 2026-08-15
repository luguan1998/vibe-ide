import { EVENTS_ENDPOINT } from "../events.js";
export { EVENTS_ENDPOINT } from "../events.js";
/** Cordis plugin name. */
export const name = 'client-hmr';
/** Required services: the vendored Loader (entry governance) and the client module system (boot provide, service name `modules`). */
export const inject = ['loader', 'modules'];
/** Find the loader entry whose module specifier is `id` (entry tree ids are random; the package name lives in `options.name`). */
function findEntry(loader, id) {
    for (const entry of loader.entries()) {
        if (entry.options.name === id)
            return entry;
    }
    return undefined;
}
/** Remove every `<style data-plugin>` tag owned by `id` (attribute compared verbatim — no CSS-selector escaping pitfalls). */
function removeOwnedStyles(id) {
    for (const el of document.querySelectorAll('style[data-plugin]')) {
        if (el.getAttribute('data-plugin') === id)
            el.remove();
    }
}
/**
 * Mount the HMR driver: subscribe to the system SSE channel and hot-swap
 * rebuilt entries.
 * @param ctx - plugin context with `loader` and `modules` available.
 */
export function apply(ctx) {
    // Both are declared injections (typed Context merges: `modules` from the
    // client module loader package, `loader` from the vendored Loader).
    const modLoader = ctx.modules;
    const loader = ctx.loader;
    async function reload(id) {
        const entry = findEntry(loader, id);
        if (entry === undefined) {
            ctx.logger.warn(`client-hmr: rebuilt frame for unknown entry "${id}" (not in the loader tree)`);
            return;
        }
        // Invalidate first (drop stale factory + record — a live factory makes
        // prefetch a no-op and re-registration a loud duplicate), then run the
        // async half while the old fiber still serves: script loading registers
        // the fresh factory with zero side effects (lazy CJS — module bodies run
        // at materialization, not execution).
        modLoader.invalidate(id);
        await modLoader.prefetch(id);
        const oldFiber = entry.fiber;
        if (oldFiber !== undefined) {
            // Registry-first teardown (see module comment): the runtime record must
            // be gone before the fiber's disposer emits internal/plugin, or the
            // Loader flags the entry disabled.
            const runtime = oldFiber.runtime;
            if (runtime !== null)
                entry.ctx.registry.delete(runtime.callback);
            // Drain the unload: effect disposers (slots, subscriptions) must finish
            // before the new bundle executes and the new apply re-registers.
            while (oldFiber.inertia !== undefined)
                await oldFiber.inertia;
            delete entry.fiber;
        }
        // Old owned styles go before materialization re-injects them (the CSS
        // idempotency guard keys on stable tag ids).
        removeOwnedStyles(id);
        // Re-init through the entry: fiber cleared above, so refresh() re-imports
        // — materializing the prefetched factory (CSS injects here) — and
        // re-plugins under the entry context. Import failures are logged by
        // Entry._init and leave the entry fiberless (retryable).
        await entry.refresh();
        // Surface apply failures loudly (no rollback, FAILED state stays).
        await entry.fiber?.await();
    }
    // Serialize reloads: frames can arrive faster than a swap completes, and
    // interleaved dispose/execute chains would corrupt the single-slot handoff.
    let queue = Promise.resolve();
    const handle = (frame) => {
        switch (frame.type) {
            case 'rebuilt':
                queue = queue.then(() => reload(frame.id)).catch((error) => {
                    ctx.logger.error(`client-hmr: reload of "${frame.id}" failed`);
                    ctx.logger.error(error);
                });
                break;
            case 'graph':
                // Connect-time snapshot, unused. The loader's cached graph rev
                // goes stale after rebuilds — harmless, since prefetch hits the
                // network anyway (host serves bundles no-cache); graph rev refresh
                // lands with the reconnect-handshake mechanism.
                break;
            default:
                // Merge-extensible frame union: unknown frame types from newer hosts
                // are ignored by design.
                break;
        }
    };
    ctx.effect(() => {
        const source = new EventSource(EVENTS_ENDPOINT);
        source.addEventListener('message', (event) => {
            let frame;
            try {
                frame = JSON.parse(event.data);
            }
            catch {
                // Wire boundary: a malformed dev-channel frame is dropped loudly.
                ctx.logger.warn(`client-hmr: unparseable event frame: ${event.data}`);
                return;
            }
            handle(frame);
        });
        return () => { source.close(); };
    }, 'client-hmr: event source');
}
//# sourceMappingURL=index.js.map