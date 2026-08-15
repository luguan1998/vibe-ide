import { defineProperty, isNullable } from '@deepseek-ai/cosmokit';
import { getTraceable, symbols, withProps } from "./utils.js";
function enhanceError(error) {
    const lines = error.stack.split('\n');
    lines.splice(0, 2, `Error: ${error.message}`);
    error.stack = lines.join('\n');
    return error;
}
const RESERVED_WORDS = ['prototype', 'then'];
// - is a symbol
// - is a reserved word (prototype, then)
// - is a number string (0, 1, 2, ...)
// - starts with `_`
function isSpecialProperty(prop) {
    return typeof prop === 'symbol'
        || RESERVED_WORDS.includes(prop)
        || parseInt(prop).toString() === prop
        || prop.startsWith('_');
}
/**
 * Reflection and service-resolution layer installed as `ctx.reflect`.
 *
 * This service powers the context proxy, service registration, accessors, and
 * the mixins that expose core service methods directly on `ctx`.
 */
export class ReflectService {
    ctx;
    /** Proxy traps implementing service resolution for every context object. */
    static handler = {
        get: (target, prop, ctx) => {
            if (isSpecialProperty(prop)) {
                return Reflect.get(target, prop, ctx);
            }
            if (Reflect.has(target, prop)) {
                return getTraceable(ctx, Reflect.get(target, prop, ctx));
            }
            const error = new Error(`cannot get property "${prop}" without inject`);
            try {
                const def = target.reflect.props[prop];
                if (def?.type === 'accessor') {
                    return def.get.call(ctx, ctx[symbols.receiver], error);
                }
                if (!ctx.fiber.runtime)
                    return ctx.reflect.get(prop, false);
                return ctx.events.waterfall('internal/get', ctx, prop, error, () => {
                    const key = target[symbols.isolate][prop];
                    let fiber = (ctx[symbols.shadow] ?? ctx).fiber;
                    while (true) {
                        const impl = fiber.store?.[prop];
                        if (impl)
                            return getTraceable(ctx, impl.value);
                        if (prop in fiber.inject) {
                            error.message = `cannot get required service "${prop}" in inactive context`;
                            throw error;
                        }
                        if (!fiber.runtime)
                            throw error;
                        if (fiber.parent[symbols.isolate][prop] !== key)
                            throw error;
                        fiber = fiber.parent.fiber;
                    }
                });
            }
            catch (e) {
                throw e === error ? enhanceError(e) : e;
            }
        },
        set: (target, prop, value, ctx) => {
            if (isSpecialProperty(prop)) {
                return Reflect.set(target, prop, value, ctx);
            }
            const error = new Error(`cannot set property "${prop}" without provide`);
            const def = target.reflect.props[prop];
            if (!def) {
                if (!ctx.fiber.runtime)
                    return Reflect.set(target, prop, value, ctx);
                throw enhanceError(error);
            }
            try {
                if (def.type === 'accessor') {
                    if (!def.set)
                        return false;
                    return def.set.call(ctx, value, ctx[symbols.receiver], error);
                }
                return ctx.events.waterfall('internal/set', ctx, prop, value, error, () => {
                    return ctx.reflect.set(prop, value, error);
                });
            }
            catch (e) {
                throw e === error ? enhanceError(e) : e;
            }
        },
        has: (target, prop) => {
            if (isSpecialProperty(prop)) {
                return Reflect.has(target, prop);
            }
            if (Reflect.has(target, prop))
                return true;
            return !!target.reflect.props[prop];
        },
    };
    /** Service implementations, keyed by isolation label. */
    store = Object.create(null);
    /** Declared context properties (services and accessors), by name. */
    props = Object.create(null);
    constructor(ctx) {
        this.ctx = ctx;
        defineProperty(this, symbols.tracker, {
            property: 'ctx',
            noShadow: true,
        });
        this.mixin('reflect', ['get', 'set', 'provide', 'accessor', 'mixin']);
        this.mixin('fiber', ['runtime', 'effect']);
        this.mixin('registry', ['inject', 'plugin']);
        this.mixin('events', ['on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall']);
    }
    /**
     * Read a service from the store without the inject requirement.
     *
     * @param name — the service name.
     * @param strict — when `true`, only return implementations whose providing
     * fiber is currently active.
     * @returns the service value, or `undefined` when not (yet) provided.
     */
    get(name, strict = true) {
        return getTraceable(this.ctx, this._getImpl(name, strict)?.value);
    }
    _getImpl(name, strict = true) {
        const key = this.ctx[symbols.isolate][name];
        const impl = key && this.store[key];
        if (!impl)
            return;
        if (strict && impl.fiber.state !== 2 /* FiberState.ACTIVE */)
            return;
        return impl;
    }
    /**
     * Overwrite a provided service's value.
     *
     * @param name — the service name.
     * @param value — the new service value.
     * @param error — carrier for the caller stack in diagnostics.
     * @returns `true` on success.
     * @throws when `name` was never provided, or was provided by another fiber.
     */
    set(name, value, error) {
        const key = this.ctx[symbols.isolate][name];
        const impl = this.store[key];
        if (!impl) {
            throw new Error(`cannot set property "${name}" without provide`);
        }
        if (impl.fiber !== this.ctx.fiber) {
            throw new Error(`cannot set property "${name}" in multiple fibers`);
        }
        impl.value = value;
        return true;
    }
    /**
     * Register a service implementation owned by the current fiber.
     *
     * See the `ctx.provide()` overload above for the full contract.
     *
     * @param name — the service name.
     * @param value — the service value.
     * @param check — optional availability predicate for dependents.
     * @returns a disposer that unregisters the service.
     */
    provide(name, value, check) {
        return this.ctx.fiber.effect(() => {
            if (!this.props[name]) {
                this.props[name] ??= { type: 'service' };
            }
            else if (this.props[name].type !== 'service') {
                throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
            }
            this.props[name] = { type: 'service' };
            this.ctx.root[symbols.isolate][name] ??= Symbol(name);
            const key = this.ctx[symbols.isolate][name];
            const impl = { name, value, fiber: this.ctx.fiber, check };
            if (this.store[key]) {
                throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`);
            }
            this.store[key] = impl;
            this.ctx.fiber.store[name] = impl;
            if (this.ctx.fiber.state === 2 /* FiberState.ACTIVE */) {
                this.notify([name]);
            }
            return async () => {
                delete this.store[key];
                const fibers = this.notify([name]);
                await Promise.allSettled(fibers.map(fiber => fiber.await()));
                // ensure self access before dependencies cleanup
                delete this.ctx.fiber.store[name];
            };
        }, `ctx.provide(${JSON.stringify(name)})`);
    }
    /**
     * Re-evaluate every fiber that requires one of the given services.
     *
     * @param names — the service names that changed.
     * @param filter — restricts notification to matching isolation scopes.
     * @returns the fibers whose dependency state was refreshed.
     */
    notify(names, filter = (ctx, name) => ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]) {
        const fibers = [];
        for (const runtime of this.ctx.registry.values()) {
            for (const fiber of runtime.fibers) {
                let hasUpdate = false;
                for (const name of names) {
                    if (!(name in fiber.inject))
                        continue;
                    if (!filter(fiber.ctx, name))
                        continue;
                    hasUpdate = true;
                    fiber._checkImpl(name);
                }
                if (!hasUpdate)
                    continue;
                fiber._refresh();
                fibers.push(fiber);
            }
        }
        for (const name of names) {
            const self = Object.create(this.ctx);
            self[symbols.filter] = (target) => filter(target, name);
            this.ctx.events.emit(self, 'internal/service', name, this._getImpl(name, false)?.value);
        }
        return fibers;
    }
    /**
     * Define a computed context property backed by get/set hooks.
     *
     * @param name — the context property name.
     * @param options — the `get` hook and optional `set` hook.
     * @returns a disposer that removes the accessor.
     */
    accessor(name, options) {
        return this.ctx.fiber.effect(() => {
            if (name in this.props) {
                throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
            }
            this.props[name] = { type: 'accessor', ...options };
            return () => delete this.props[name];
        }, `ctx.accessor(${JSON.stringify(name)})`);
    }
    /**
     * Expose selected members of a service directly on `ctx`.
     *
     * See the `ctx.mixin()` overload above for the full contract.
     *
     * @param source — a context property name or a source object.
     * @param mixins — keys to forward, or a source-key → ctx-key map.
     * @returns a disposer that removes all created accessors.
     */
    mixin(source, mixins) {
        const self = this;
        return this.ctx.fiber.effect(function* () {
            const entries = Array.isArray(mixins) ? mixins.map(key => [key, key]) : Object.entries(mixins);
            const getTarget = (ctx, error) => {
                // TODO enhance error message
                return ctx[source];
            };
            for (const [key, value] of entries) {
                yield self.accessor(value, {
                    get(receiver, error) {
                        const service = getTarget(this, error);
                        if (isNullable(service))
                            return service;
                        const mixin = receiver ? withProps(receiver, service) : service;
                        const value = Reflect.get(service, key, mixin);
                        if (typeof value !== 'function')
                            return value;
                        return value.bind(mixin ?? service);
                    },
                    set(value, receiver, error) {
                        const service = getTarget(this, error);
                        const mixin = receiver ? withProps(receiver, service) : service;
                        return Reflect.set(service, key, value, mixin);
                    },
                });
            }
        }, `ctx.mixin(${JSON.stringify(source)})`);
    }
    /**
     * Attach this context's tracing wrapper to a value.
     *
     * @param value — the value to wrap.
     * @returns the traceable wrapper (or the value itself when not applicable).
     */
    trace(value) {
        return getTraceable(this.ctx, value);
    }
    /**
     * Wrap a callback so calls trace `this` and arguments to this context.
     *
     * @param callback — the function to wrap.
     * @returns a proxy delegating to `callback` with traced values.
     */
    bind(callback) {
        return new Proxy(callback, {
            apply: (target, thisArg, args) => {
                return Reflect.apply(target, this.trace(thisArg), args.map(arg => this.trace(arg)));
            },
            construct: (target, args, newTarget) => {
                return Reflect.construct(target, args.map(arg => this.trace(arg)), newTarget);
            },
        });
    }
}
//# sourceMappingURL=reflect.js.map