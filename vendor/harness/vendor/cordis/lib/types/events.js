import { defineProperty } from '@deepseek-ai/cosmokit';
import { Context } from "./context.js";
import { DisposableList, symbols } from "./utils.js";
/**
 * Return whether an event result should stop a bail-style dispatch.
 *
 * @param value — a listener's return value.
 * @returns `true` unless `value` is `null`, `false`, or `undefined`.
 */
export function isBailed(value) {
    return value !== null && value !== false && value !== undefined;
}
/**
 * Event bus installed as `ctx.events` and mixed into every context.
 *
 * The service supports concurrent, synchronous, serial, bail, and waterfall
 * dispatch and automatically disposes listeners with their owning fiber.
 */
export class EventsService {
    ctx;
    _hooks = {};
    constructor(ctx) {
        this.ctx = ctx;
        defineProperty(this, symbols.tracker, {
            property: 'ctx',
            noShadow: true,
        });
        this.on('internal/listener', function (name, listener, options) {
            if (name === 'internal/update' && !options.global) {
                const hooks = this.fiber._hooks['internal/update'] ??= new DisposableList();
                const method = options.prepend ? 'unshift' : 'push';
                return hooks[method](listener);
            }
        });
        this.on('internal/update', function (config, noSave, next) {
            const cbs = [...this._hooks['internal/update'] || []];
            const _next = () => {
                const cb = cbs.shift() ?? next;
                return cb.call(this, config, noSave, _next);
            };
            return _next();
        }, { global: true, prepend: true });
    }
    /**
     * Resolve listeners for one dispatch and apply context filtering.
     *
     * @param type — the dispatch mode, reported on `internal/dispatch`.
     * @param args — the raw dispatch arguments; consumed up to the event name.
     * @returns the matching listener callbacks, bound to the dispatch `this`.
     */
    dispatch(type, args) {
        const thisArg = typeof args[0] === 'object' || typeof args[0] === 'function' ? args.shift() : null;
        const name = args.shift();
        if (!name.startsWith('internal/')) {
            this.emit('internal/dispatch', type, name, args, thisArg);
        }
        const filter = thisArg?.[Context.filter];
        return (this._hooks[name] || [])
            .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))
            .map(hook => hook.callback.bind(thisArg));
    }
    /**
     * Run listeners concurrently and wait for all of them.
     *
     * @param args — optional `this`, the event name, then listener arguments.
     * @returns a promise resolving once every listener has settled.
     */
    async parallel(...args) {
        const results = await Promise.allSettled(this.dispatch('emit', args).map(async (cb) => cb(...args)));
        const errors = results.filter((result) => result.status === 'rejected');
        if (errors.length)
            throw new AggregateError(errors.map(error => error.reason));
    }
    /**
     * Run listeners synchronously without waiting for returned promises.
     *
     * @param args — optional `this`, the event name, then listener arguments.
     */
    emit(...args) {
        this.dispatch('emit', args).map(cb => cb(...args));
    }
    /**
     * Run listeners in order, awaiting each, until one returns a bail value.
     *
     * @param args — optional `this`, the event name, then listener arguments.
     * @returns the first bail value (see {@link isBailed}), if any.
     */
    async serial(...args) {
        for (const cb of this.dispatch('serial', args)) {
            const result = await cb(...args);
            if (isBailed(result))
                return result;
        }
    }
    /**
     * Run listeners synchronously until one returns a bail value.
     *
     * @param args — optional `this`, the event name, then listener arguments.
     * @returns the first bail value (see {@link isBailed}), if any.
     */
    bail(...args) {
        for (const cb of this.dispatch('bail', args)) {
            const result = cb(...args);
            if (isBailed(result))
                return result;
        }
    }
    /**
     * Compose listeners around the final `next` callback.
     *
     * The last dispatch argument is treated as the innermost `next`. Listeners
     * run outermost-first; a listener that does not call `next()` vetoes the
     * rest of the chain, including the built-in behavior.
     *
     * @param args — optional `this`, the event name, listener arguments, then `next`.
     * @returns the outermost listener's return value.
     */
    waterfall(...args) {
        const cbs = this.dispatch('waterfall', args);
        const inner = args.pop();
        const next = () => {
            const cb = cbs.shift() ?? inner;
            return cb(...args);
        };
        args.push(next);
        return next();
    }
    /**
     * Store a listener record as an effect on the current fiber.
     *
     * @param label — effect label shown in fiber diagnostics.
     * @param hooks — the listener list for one event.
     * @param callback — the listener to store.
     * @param options — placement and filtering options.
     * @returns a disposer that unregisters the listener.
     */
    register(label, hooks, callback, options) {
        const method = options.prepend ? 'unshift' : 'push';
        return this.ctx.fiber.effect(() => {
            hooks[method]({ ctx: this.ctx, callback, ...options });
            return () => this.unregister(hooks, callback);
        }, label);
    }
    /**
     * Remove a stored listener record.
     *
     * @param hooks — the listener list for one event.
     * @param callback — the listener to remove.
     * @returns `true` if the listener was found and removed.
     */
    unregister(hooks, callback) {
        const index = hooks.findIndex(hook => hook.callback === callback);
        if (index >= 0) {
            hooks.splice(index, 1);
            return true;
        }
    }
    /**
     * Register an event listener owned by the current fiber.
     *
     * The listener is removed automatically when the fiber unloads. Throws
     * `CordisError('INACTIVE_EFFECT')` if the fiber is already disposed.
     *
     * @param name — the event name to listen for.
     * @param listener — called with the dispatch arguments.
     * @param options — listener options; a boolean is shorthand for `prepend`.
     * @returns a disposer removing the listener; `true` if it was still registered.
     */
    on(name, listener, options) {
        if (typeof options !== 'object') {
            options = { prepend: options };
        }
        // handle special events
        this.ctx.fiber.assertActive();
        listener = this.ctx.reflect.bind(listener);
        const result = this.bail(this.ctx, 'internal/listener', name, listener, options);
        if (result)
            return result;
        const hooks = this._hooks[name] ||= [];
        const label = `ctx.on(${typeof name === 'string' ? JSON.stringify(name) : name.toString()})`;
        return this.register(label, hooks, listener, options);
    }
    /**
     * Register an event listener that disposes itself after the first call.
     *
     * @param name — the event name to listen for.
     * @param listener — called at most once with the dispatch arguments.
     * @param options — listener options; a boolean is shorthand for `prepend`.
     * @returns a disposer removing the listener; `true` if it was still registered.
     */
    once(name, listener, options) {
        const dispose = this.on(name, function (...args) {
            dispose();
            return listener.apply(this, args);
        }, options);
        return dispose;
    }
}
//# sourceMappingURL=events.js.map