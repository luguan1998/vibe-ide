import { Inject, Service } from '@deepseek-ai/cordis';
import { defineProperty, isNullable } from '@deepseek-ai/cosmokit';
import { ModuleLoader } from "./internal.js";
import { Entry } from "./config/entry.js";
import { EntryGroup } from "./config/group.js";
import isolate from "./config/isolate.js";
import { EntryTree } from "./config/tree.js";
import { interpolate } from "./config/utils.js";
/** Re-export entry node APIs. */
export * from "./config/entry.js";
/** Re-export nested entry group APIs. */
export * from "./config/group.js";
/** Re-export service isolation helpers. */
export * from "./config/isolate.js";
/** Re-export entry tree persistence APIs. */
export * from "./config/tree.js";
/** Re-export loader config expression helpers. */
export * from "./config/utils.js";
/** Re-export Node internal module loader compatibility types. */
export * from "./internal.js";
/**
 * Service that owns a loader entry tree and imports configured plugins.
 *
 * Subclasses provide persistence by implementing `write()` on `EntryTree`.
 */
export class Loader extends EntryTree {
    config;
    envData = process.env.CORDIS_SHARED
        ? JSON.parse(process.env.CORDIS_SHARED)
        : { startTime: Date.now() };
    name = 'loader';
    internal = ModuleLoader.fromInternal();
    builtins = Object.create(null);
    constructor(ctx, config = {}) {
        super(ctx);
        this.config = config;
        if (config.baseUrl) {
            this.ctx.baseUrl = config.baseUrl;
        }
        const self = this;
        defineProperty(this, Service.tracker, {
            associate: 'loader',
            property: 'ctx',
            noShadow: true,
        });
        ctx.reflect.provide('loader', this, this[Service.check]);
        ctx.on('internal/config', function (_config, next) {
            const config = next();
            if (!this.entry || this.parent.fiber?.entry === this.entry)
                return config;
            // Tree carriers (Group, Include) keep their configs literal: their
            // entry and patch lists hold other rows' configs, whose `!!js`
            // expressions belong to those rows' own fibers.
            const plugin = this.runtime?.callback;
            if (plugin?.[EntryGroup.key])
                return config;
            return interpolate(this.ctx, config);
        }, { global: true });
        ctx.on('internal/update', async function (config, noSave, next) {
            if (!this.entry || noSave || this.parent.fiber?.entry === this.entry)
                return next();
            await next();
            const unparse = this.runtime?.Config?.['simplify'];
            this.entry.options.config = unparse ? unparse(config) : config;
            this.entry.parent.tree.write();
        }, { global: true, prepend: true });
        ctx.on('internal/update', function (config, _, next) {
            if (!this.entry || this.parent.fiber?.entry === this.entry)
                return next();
            self.showLog(this.entry, 'reload');
            return next();
        }, { global: true });
        ctx.on('internal/plugin', (fiber) => {
            // 1. set `fiber.entry`
            if (fiber.parent[Entry.key] && !fiber.entry) {
                fiber.entry = fiber.parent[Entry.key];
                // FIXME merge config
                Inject.resolve(fiber.entry.options.inject, fiber.inject);
            }
            // 2. handle self-dispose
            // We only care about `ctx.fiber.dispose()`, so we need to filter out other cases.
            // case 1: fiber is created
            if (fiber.uid)
                return;
            // case 2: fiber is not tracked by loader
            if (!fiber.entry)
                return;
            // case 3: fiber is a child plugin under the entry (not the entry's root fiber)
            if (fiber.parent.fiber?.entry === fiber.entry)
                return;
            // case 4: fiber is disposed on behalf of plugin deletion (such as plugin hmr)
            // self-dispose: ctx.fiber.dispose() -> fiber / runtime dispose -> delete(plugin)
            // plugin hmr: delete(plugin) -> runtime dispose -> fiber dispose
            if (!ctx.registry.has(fiber.runtime.callback))
                return;
            // case 5: the entry's tree is being disposed
            const treeOwner = fiber.entry.parent.tree.ctx.fiber;
            if (!treeOwner.uid || treeOwner.state === 5 /* FiberState.UNLOADING */)
                return;
            // case 6: Loader is replacing or removing this exact fiber
            if (fiber.entry._disposing)
                return;
            this.showLog(fiber.entry, 'unload');
            // case 7: fiber is disposed by loader behavior
            // such as inject checker, config file update, ancestor group disable
            if (fiber.entry.disabled)
                return;
            fiber.entry.options.disabled = true;
            fiber.entry.parent.tree.write();
        });
        ctx.plugin(isolate);
    }
    write() {
        // Loader's root tree is in-memory; writes are no-ops.
    }
    [Service.check]() {
        const config = Service.prototype[Service.resolveConfig].call(this);
        if (config.await && this.getTasks().length)
            return false;
        return true;
    }
    showLog(entry, type) {
        if (entry.options.group || !entry.parent.tree.enableLogs)
            return;
        this.ctx.root.logger?.('loader').info('%s plugin %C', type, entry.options.name);
    }
    /** Return the loader entry id that owns `fiber`, if any. */
    locate(fiber = this.ctx.fiber) {
        while (1) {
            if (fiber.entry)
                return fiber.entry.id;
            const next = fiber.parent.fiber;
            if (fiber === next)
                return;
            fiber = next;
        }
    }
    /** Hook for hosts that can restart the process on full-reload requests. */
    exit() {
    }
    /** Normalize ESM/CJS/default export shapes before applying a plugin. */
    unwrapExports(exports) {
        if (isNullable(exports))
            return exports;
        exports = exports.default ?? exports;
        // https://github.com/evanw/esbuild/issues/2623
        // https://esbuild.github.io/content-types/#default-interop
        if (!exports.__esModule)
            return exports;
        return exports.default ?? exports;
    }
}
export default Loader;
//# sourceMappingURL=index.js.map