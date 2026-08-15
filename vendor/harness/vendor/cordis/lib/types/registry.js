import { defineProperty } from '@deepseek-ai/cosmokit';
import { Fiber } from "./fiber.js";
import { buildOuterStack, DisposableList, symbols, withProps } from "./utils.js";
function isApplicable(object) {
    return object && typeof object === 'object' && typeof object.apply === 'function';
}
/**
 * Decorator for declaring service dependencies on classes or class methods.
 *
 * On classes it contributes to the plugin's static `inject` map. On methods it
 * delays the method call until the declared services are available.
 */
/**
 * @param name — the required service name.
 * @param config — optional intercept config applied for that service.
 * @returns the class or method decorator.
 */
export function Inject(name, config) {
    return function (value, decorator) {
        if (decorator.kind === 'class') {
            if (!Object.hasOwn(value, 'inject')) {
                defineProperty(value, 'inject', Object.create(Object.getPrototypeOf(value).inject ?? null));
                defineProperty(value.inject, symbols.checkProto, true);
            }
            value.inject[name] = config;
        }
        else if (decorator.kind === 'method') {
            const inject = (value[symbols.metadata] ??= {}).inject ??= Object.create(null);
            inject[name] = config;
            decorator.addInitializer(function () {
                const property = this[symbols.tracker]?.property;
                (this[symbols.initHooks] ??= []).push(() => {
                    this.ctx.inject(inject, (ctx) => {
                        return value.call(property ? withProps(this, { [property]: ctx }) : this);
                    });
                });
            });
        }
        else {
            throw new Error('@Inject() can only be used on class or class methods');
        }
    };
}
/** Utilities for normalizing plugin dependency declarations. */
(function (Inject) {
    /**
     * Convert array/object/class-inherited inject metadata into a plain map.
     *
     * @param inject — the declaration to normalize; `null`/`undefined` add nothing.
     * @param result — the map to fill (service name → intercept config or `null`).
     * @returns `result`.
     */
    function resolve(inject, result = Object.create(null)) {
        if (!inject)
            return result;
        if (Array.isArray(inject)) {
            for (const name of inject) {
                result[name] = null;
            }
        }
        else if (Reflect.has(inject, symbols.checkProto)) {
            Object.assign(result, resolve(Object.getPrototypeOf(inject)));
            for (const name of Object.keys(inject)) {
                result[name] = inject[name] ?? null;
            }
        }
        else {
            for (const name of Object.keys(inject)) {
                result[name] = inject[name] ?? null;
            }
        }
        return result;
    }
    Inject.resolve = resolve;
})(Inject || (Inject = {}));
/**
 * Plugin registry installed as `ctx.registry` and mixed into every context.
 *
 * It normalizes plugin shapes, tracks plugin runtimes, starts fibers, and
 * exposes map-like inspection over active plugin callbacks.
 */
export class RegistryService {
    ctx;
    _counter = 0;
    _internal = new Map();
    constructor(ctx) {
        this.ctx = ctx;
        defineProperty(this, symbols.tracker, {
            property: 'ctx',
            noShadow: true,
        });
    }
    /** Allocate the next fiber uid (increments on every read). */
    get counter() {
        return ++this._counter;
    }
    /** Number of registered plugin runtimes. */
    get size() {
        return this._internal.size;
    }
    /**
     * Resolve a supported plugin shape to its executable callback.
     *
     * @param plugin — a function, class, or `{ apply }` object plugin.
     * @returns the callback identifying the plugin, or `undefined` if invalid.
     */
    resolve(plugin) {
        // plugin.apply may throw
        try {
            if (typeof plugin === 'function')
                return plugin;
            if (isApplicable(plugin))
                return plugin.apply;
        }
        catch { }
    }
    /**
     * Look up the runtime record for a plugin.
     *
     * @param plugin — any supported plugin shape.
     * @returns the runtime, or `undefined` when the plugin is not registered.
     */
    get(plugin) {
        const key = this.resolve(plugin);
        return key && this._internal.get(key);
    }
    /**
     * Check whether a plugin has a registered runtime.
     *
     * @param plugin — any supported plugin shape.
     * @returns `true` when at least one fiber of the plugin exists.
     */
    has(plugin) {
        const key = this.resolve(plugin);
        return !!key && this._internal.has(key);
    }
    /**
     * Dispose every running fiber for a plugin and remove its runtime record.
     *
     * @param plugin — any supported plugin shape.
     * @returns the removed runtime, or `undefined` when none was registered.
     */
    delete(plugin) {
        const key = this.resolve(plugin);
        const runtime = key && this._internal.get(key);
        if (!runtime)
            return;
        this._internal.delete(key);
        for (const fiber of runtime.fibers) {
            fiber.dispose();
        }
        return runtime;
    }
    /** Iterate the registered plugin callbacks. */
    keys() {
        return this._internal.keys();
    }
    /** Iterate the registered plugin runtimes. */
    values() {
        return this._internal.values();
    }
    /** Iterate `[callback, runtime]` pairs. */
    entries() {
        return this._internal.entries();
    }
    /**
     * Visit every registered runtime.
     *
     * @param callback — receives each runtime and its identifying callback.
     */
    forEach(callback) {
        return this._internal.forEach(callback);
    }
    /**
     * Start a callback once the requested dependencies are available.
     *
     * @param inject — required services, as an array or a name → config map.
     * @param callback — plugin body called with `(ctx, config)`.
     * @returns the fiber; awaiting it settles once loading finished.
     */
    inject(inject, callback) {
        return this.plugin({ inject, apply: callback, name: callback.name });
    }
    /**
     * Start a plugin in the current context and return its fiber.
     *
     * Creates (or reuses) the plugin's runtime record, then starts a new fiber
     * under the current context. Throws if `plugin` is not a supported shape or
     * if the current fiber is already disposed.
     *
     * @param plugin — a function, class, or `{ apply }` object plugin.
     * @param config — the plugin config, validated against its `Config` schema.
     * @param getOuterStack — captures the caller stack for effect diagnostics.
     * @returns the fiber; awaiting it settles once loading finished.
     */
    plugin(plugin, config, getOuterStack = buildOuterStack()) {
        // check if it's a valid plugin
        const callback = this.resolve(plugin);
        if (!callback)
            throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin);
        this.ctx.fiber.assertActive();
        let runtime = this._internal.get(callback);
        if (!runtime) {
            let name = plugin.name;
            if (name === 'apply')
                name = undefined;
            runtime = { name, callback, fibers: new DisposableList(), Config: plugin.Config };
            this._internal.set(callback, runtime);
        }
        const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
        const wrapped = Object.create(fiber);
        wrapped.then = (onFulfilled, onRejected) => {
            return fiber.await().then(onFulfilled, onRejected);
        };
        return wrapped;
    }
}
//# sourceMappingURL=registry.js.map