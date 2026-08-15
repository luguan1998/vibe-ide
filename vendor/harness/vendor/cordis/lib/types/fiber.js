import { defineProperty, isNullable } from '@deepseek-ai/cosmokit';
import { Context } from "./context.js";
import { buildOuterStack, composeError, DisposableList, getTraceable, isConstructor, isObject, symbols } from "./utils.js";
const kValidationError = Symbol.for('ValidationError');
/** Error raised when plugin configuration fails standard-schema validation. */
export class ValidationError extends TypeError {
    name = 'ValidationError';
    /**
     * Build the aggregated message from schema issues.
     *
     * @param issues — the standard-schema issues, one message line each.
     */
    constructor(issues) {
        super(`invalid config:\n` + issues.map(issue => {
            if (issue.path) {
                return `  - ${issue.message} (at ${issue.path.join('.')})`;
            }
            else {
                return `  - ${issue.message}`;
            }
        }).join('\n'));
    }
}
Object.defineProperty(ValidationError.prototype, kValidationError, {
    value: true,
});
/**
 * Validate and normalize config for a plugin runtime before it starts.
 *
 * @param runtime — the plugin runtime whose `Config` schema to apply.
 * @param config — the raw user config.
 * @returns the validated config, or `config` unchanged if the runtime has no schema.
 * @throws {ValidationError} when validation reports issues.
 */
export function resolveConfig(runtime, config) {
    if (!runtime.Config)
        return config;
    // TODO: async validation
    const result = runtime.Config['~standard'].validate(config);
    if ('then' in result) {
        throw new TypeError('Async config validation is not supported');
    }
    if (result.issues) {
        throw new ValidationError(result.issues);
    }
    else {
        return result.value;
    }
}
// Public effect disposers remain single-shot, but structural owners and outer
// effects must still be able to join a cleanup that another caller started.
const effectInertia = new WeakMap();
function runDisposable(dispose) {
    const result = dispose();
    return effectInertia.get(dispose)?.() ?? result;
}
/** Notify plugin teardown without allowing one observer to break ownership cleanup. */
function emitPluginDisposed(context, fiber) {
    const args = ['internal/plugin', fiber];
    let callbacks;
    try {
        callbacks = context.events.dispatch('emit', args);
    }
    catch (error) {
        context.logger.error(error);
        return;
    }
    for (const callback of callbacks) {
        try {
            const returned = callback(...args);
            void Promise.resolve(returned).catch(error => context.logger.error(error));
        }
        catch (error) {
            context.logger.error(error);
        }
    }
}
/** Framework error with a stable machine-readable code. */
export class CordisError extends Error {
    code;
    /**
     * @param code — the stable error code; also the default message.
     * @param message — optional human-readable override.
     */
    constructor(code, message) {
        super(message ?? CordisError.Code[code]);
        this.code = code;
    }
}
/** Cordis error code definitions. */
(function (CordisError) {
    CordisError.Code = {
        INACTIVE_EFFECT: 'cannot create effect on inactive context',
    };
})(CordisError || (CordisError = {}));
const INACTIVE = '__INACTIVE__';
/**
 * Runtime instance of one plugin application.
 *
 * A fiber tracks dependency state, validated config, lifecycle effects, and
 * cleanup for the plugin context returned by `ctx.plugin()`.
 */
export class Fiber {
    parent;
    inject;
    runtime;
    /** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
    uid;
    /** The context this fiber's plugin runs in (extends the parent context). */
    ctx;
    /** The validated plugin config (updated by `update()`). */
    config;
    /** The raw plugin config, re-resolved before each activation. */
    _config;
    /** Current lifecycle state; transitions emit `internal/status`. */
    state = 0 /* FiberState.PENDING */;
    /** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
    dispose;
    /** Snapshot of required service implementations while loaded; `undefined` otherwise. */
    store;
    /** The in-flight load/unload transition, if one is currently running. */
    inertia;
    _hooks = Object.create(null);
    _disposables = new DisposableList();
    // Same as `this.ctx`, but with a more specific type.
    context;
    _error;
    _runner;
    _store = Object.create(null);
    /**
     * Create a fiber. Plugin authors normally obtain fibers from `ctx.plugin()`
     * rather than constructing them directly.
     *
     * @param parent — the context the plugin was loaded from.
     * @param config — raw config, validated against the runtime's schema.
     * @param inject — resolved dependency map (service name → intercept config).
     * @param runtime — the shared plugin runtime, or `null` for the root fiber.
     * @param getOuterStack — captures the caller stack for effect diagnostics.
     */
    constructor(parent, config, inject, runtime, getOuterStack) {
        this.parent = parent;
        this.inject = inject;
        this.runtime = runtime;
        this._config = config;
        const collect = (dispose) => {
            this._disposables.push(dispose);
        };
        if (runtime) {
            this.uid = parent.registry.counter;
            this.ctx = this.context = parent.extend({ fiber: this });
            const injectEntries = Object.entries(this.inject);
            if (injectEntries.length) {
                this.ctx[Context.intercept] = Object.create(parent[Context.intercept]);
                for (const [name, config] of injectEntries) {
                    if (isNullable(config))
                        continue;
                    this.ctx[Context.intercept][name] = config;
                }
            }
            this._runner = {
                epoch: INACTIVE,
                getOuterStack,
                execute: function () {
                    if (isConstructor(runtime.callback)) {
                        // eslint-disable-next-line new-cap
                        const instance = new runtime.callback(this.ctx, this.config);
                        for (const hook of instance?.[symbols.initHooks] ?? []) {
                            hook();
                        }
                        return instance?.[symbols.init]?.();
                    }
                    else {
                        return runtime.callback(this.ctx, this.config);
                    }
                },
                collect,
            };
            this.dispose = parent.fiber.effect(() => {
                const remove = runtime.fibers.push(this);
                return async () => {
                    this.uid = null;
                    emitPluginDisposed(this.context, this);
                    if (this.ctx.registry.has(runtime.callback)) {
                        remove();
                        if (!runtime.fibers.length) {
                            this.ctx.registry.delete(runtime.callback);
                        }
                    }
                    this._setEpoch(INACTIVE);
                    // A PENDING fiber can already own effects registered by an
                    // internal/plugin observer. Its epoch is still INACTIVE, so
                    // _setEpoch() has no transition to drive; explicitly unload that
                    // pre-activation work before reporting disposal complete.
                    if (!this.inertia) {
                        this._updateState(() => {
                            this.inertia = this._unload();
                            return 5 /* FiberState.UNLOADING */;
                        });
                    }
                    // `this.inertia` itself should never reject — both `_reload` and
                    // `_unload` swallow their own work errors via `ctx.logger.error`.
                    // If it *does* reject, the only remaining cause is the logger
                    // itself failing, which we can't recover from in this exact spot
                    // (calling the logger again is what just failed). Let the
                    // rejection propagate; process-level crash is the honest outcome.
                    while (this.inertia) {
                        await this.inertia;
                    }
                };
            }, 'ctx.plugin()');
            try {
                // Publish only after the parent owns a fully assigned disposer. A
                // synchronous observer may dispose either this fiber or its parent.
                this.context.emit('internal/plugin', this);
            }
            catch (error) {
                // Publication failed synchronously. The disposer removes the child
                // from both the parent and runtime before control escapes.
                void Promise.resolve(this.dispose()).catch(reason => this.ctx.logger.error(reason));
                throw error;
            }
            // Keep the initial notification's historical PENDING view. The loader
            // may also extend `inject` in that notification, so resolve dependencies
            // only after publication. A reentrant parent unload makes the child
            // disposer responsible for draining any PENDING effects instead.
            if (this.uid !== null && parent.fiber.state !== 5 /* FiberState.UNLOADING */) {
                for (const name of Object.keys(this.inject)) {
                    this._checkImpl(name);
                }
                this._refresh();
            }
        }
        else {
            this.uid = 0;
            this.ctx = this.context = parent;
            this.state = 2 /* FiberState.ACTIVE */;
            this.store = Object.create(null);
            this._runner = {
                epoch: '',
                getOuterStack,
                execute: () => { },
                collect,
            };
            this.dispose = () => this.restart();
        }
    }
    /** The plugin's display name, inherited from the nearest named ancestor, else `'root'`. */
    get name() {
        let fiber = this;
        do {
            if (fiber.runtime?.name)
                return fiber.runtime.name;
            fiber = fiber.parent.fiber;
        } while (fiber !== fiber.parent.fiber);
        return 'root';
    }
    /**
     * Throw if the fiber has already been disposed.
     *
     * @returns nothing when the fiber is still active.
     * @throws {CordisError} `INACTIVE_EFFECT` when the fiber's uid has been cleared.
     */
    assertActive() {
        if (this.uid !== null)
            return;
        throw new CordisError('INACTIVE_EFFECT');
    }
    _execute(runner) {
        const oldEpoch = runner.epoch;
        return composeError((info) => {
            const safeCollect = (dispose) => {
                if (typeof dispose === 'function') {
                    runner.collect(dispose);
                }
                else if (!isNullable(dispose)) {
                    throw new TypeError('Invalid effect');
                }
            };
            const effect = runner.execute.call(this);
            if (typeof effect === 'function') {
                return runner.collect(effect);
            }
            else if (isNullable(effect)) {
                // return
            }
            else if (!isObject(effect)) {
                throw new TypeError('Invalid effect');
            }
            else if ('then' in effect) {
                return effect.then(safeCollect);
            }
            else if (Symbol.iterator in effect) {
                info.error = new Error();
                const iter = effect[Symbol.iterator]();
                while (true) {
                    const result = iter.next();
                    safeCollect(result.value);
                    if (result.done)
                        return;
                }
            }
            else if (Symbol.asyncIterator in effect) {
                const iter = effect[Symbol.asyncIterator]();
                return (async () => {
                    // force async stack trace
                    await Promise.resolve();
                    info.error = new Error();
                    while (true) {
                        if (runner.epoch !== oldEpoch)
                            return;
                        const result = await iter.next();
                        safeCollect(result.value);
                        if (result.done)
                            return;
                    }
                })();
            }
            else {
                throw new TypeError('Invalid effect');
            }
        }, runner.getOuterStack);
    }
    effect(execute, label = 'anonymous') {
        this.assertActive();
        if (this.state === 5 /* FiberState.UNLOADING */) {
            throw new CordisError('INACTIVE_EFFECT');
        }
        const disposables = [];
        let disposing = false;
        let disposalTask;
        const dispose = () => {
            if (disposing)
                return disposalTask;
            disposing = true;
            let task;
            for (const disposable of disposables.splice(0).reverse()) {
                if (task) {
                    task = task.then(() => runDisposable(disposable));
                }
                else {
                    const result = runDisposable(disposable);
                    if (isObject(result) && 'then' in result) {
                        task = result;
                    }
                }
            }
            return disposalTask = task;
        };
        const meta = { label, children: [] };
        const runner = {
            execute,
            epoch: true,
            collect: (dispose) => {
                disposables.push(dispose);
                this._disposables.delete(dispose);
                if (dispose[symbols.effect]) {
                    meta.children.push(dispose[symbols.effect]);
                }
            },
            getOuterStack: buildOuterStack(),
        };
        let task;
        let executing = true;
        let resolveSetup;
        let rejectSetup;
        let setupBarrier;
        let setupFailed = false;
        let inFlight;
        let removeWrapper = () => false;
        const waitForSetup = () => {
            setupBarrier ??= new Promise((resolve, reject) => {
                resolveSetup = resolve;
                rejectSetup = reject;
            });
            return setupBarrier;
        };
        const disposeAfter = (setup) => {
            return Promise.resolve(setup).then(() => dispose(), async (reason) => {
                await dispose();
                throw reason;
            });
        };
        const finalizeDisposal = (callback) => {
            let result;
            try {
                result = callback();
            }
            catch (error) {
                removeWrapper();
                throw error;
            }
            if (isObject(result) && 'then' in result) {
                const pending = Promise.resolve(result).finally(() => {
                    removeWrapper();
                    if (inFlight === pending)
                        inFlight = undefined;
                });
                return inFlight = pending;
            }
            removeWrapper();
            return result;
        };
        const wrapper = defineProperty(() => {
            // A synchronous setup failure can race an owner unload that already
            // captured this wrapper but has not invoked it yet. The failed effect is
            // never returned publicly, so let that internal caller await rollback.
            if (!runner.epoch)
                return setupFailed ? inFlight : undefined;
            runner.epoch = false;
            return finalizeDisposal(() => {
                if (executing)
                    return disposeAfter(waitForSetup());
                return task ? disposeAfter(task) : dispose();
            });
        }, symbols.effect, meta);
        effectInertia.set(wrapper, () => inFlight);
        // Make the effect visible to a reentrant owner unload before execute()
        // runs any plugin code. Async teardown stays owner-visible until it
        // settles, allowing an outer effect to join cleanup another caller began.
        removeWrapper = this._disposables.push(wrapper);
        try {
            task = this._execute(runner);
        }
        catch (reason) {
            executing = false;
            setupFailed = true;
            runner.epoch = false;
            let cleanup;
            try {
                cleanup = finalizeDisposal(dispose);
            }
            finally {
                rejectSetup?.(reason);
            }
            if (isObject(cleanup) && 'then' in cleanup) {
                cleanup.catch(error => this.ctx.logger.error(error));
            }
            throw reason;
        }
        executing = false;
        if (setupBarrier) {
            Promise.resolve(task).then(resolveSetup, rejectSetup);
        }
        // prevent unhandled rejection — both from `task` itself and from the
        // disposer chain if it fails to settle cleanly.
        task?.catch(() => {
            if (!runner.epoch)
                return dispose();
            return finalizeDisposal(dispose);
        }).catch((error) => this.ctx.logger.error(error));
        const disposeAsync = () => {
            if (!runner.epoch)
                return;
            runner.epoch = false;
            return finalizeDisposal(dispose);
        };
        wrapper.then = async (onFulfilled, onRejected) => {
            return Promise.resolve(task)
                .then(() => disposeAsync)
                .then(onFulfilled, onRejected);
        };
        return wrapper;
    }
    /**
     * Return metadata for currently registered effects.
     *
     * @returns one {@link EffectMeta} tree per labeled live effect.
     */
    getEffects() {
        return [...this._disposables]
            .map(dispose => dispose[symbols.effect])
            .filter(Boolean);
    }
    _getState() {
        if (this.uid === null)
            return 4 /* FiberState.DISPOSED */;
        if (this._error)
            return 3 /* FiberState.FAILED */;
        if (this._runner.epoch !== INACTIVE)
            return 2 /* FiberState.ACTIVE */;
        return 0 /* FiberState.PENDING */;
    }
    _updateState(callback) {
        const oldState = this.state;
        this.state = callback() ?? this._getState();
        if (oldState === this.state)
            return;
        // FIXME internal/fiber-info
        this.context.emit('internal/status', this, oldState);
        // only notify changes between ACTIVE and NON-ACTIVE states
        if (oldState !== 2 /* FiberState.ACTIVE */ && this.state !== 2 /* FiberState.ACTIVE */)
            return;
        for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
            const impl = this.ctx.reflect.store[key];
            if (impl.fiber !== this)
                continue;
            this.ctx.reflect.notify([impl.name]);
        }
    }
    _checkImpl(name) {
        const impl = this.ctx.reflect._getImpl(name, true);
        if (!impl)
            return delete this._store[name];
        try {
            if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) {
                return delete this._store[name];
            }
        }
        catch (error) {
            impl.fiber.ctx.logger.error(error);
            return delete this._store[name];
        }
        this._store[name] = impl;
    }
    _refresh() {
        let epoch = false;
        epoch = '';
        for (const name of Object.keys(this.inject)) {
            const impl = this._store[name];
            if (!impl) {
                epoch = INACTIVE;
                break;
            }
            epoch += ':' + impl.fiber.uid;
        }
        this._setEpoch(epoch);
    }
    _setEpoch(epoch) {
        const oldEpoch = this._runner.epoch;
        if (epoch === oldEpoch)
            return;
        this._runner.epoch = epoch;
        if (this.inertia)
            return;
        this._updateState(() => {
            if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
                this.inertia = this._reload();
                return 1 /* FiberState.LOADING */;
            }
            else {
                this.inertia = this._unload();
                return 5 /* FiberState.UNLOADING */;
            }
        });
    }
    _resolveConfig(config) {
        config = this.context.waterfall(this, 'internal/config', config, () => config);
        return this.runtime ? resolveConfig(this.runtime, config) : config;
    }
    async _reload() {
        this.store = { ...this._store };
        const oldEpoch = this._runner.epoch;
        try {
            await Promise.resolve();
            // A disposer queued before this checkpoint may already have invalidated
            // the load. Do not run plugin code for a stale epoch; the state update
            // below will drain any effects collected while the fiber was PENDING.
            if (this._runner.epoch === oldEpoch) {
                this.config = this._resolveConfig(this._config);
                await this._execute(this._runner);
                this._error = undefined;
            }
        }
        catch (reason) {
            // impl guarantees that the error is non-null (?)
            this.ctx.logger.error(reason);
            this._error = reason;
            this._runner.epoch = INACTIVE;
        }
        this._updateState(() => {
            if (this._runner.epoch === oldEpoch) {
                this.inertia = undefined;
            }
            else {
                this.inertia = this._unload();
                return 5 /* FiberState.UNLOADING */;
            }
        });
    }
    async _unload() {
        await Promise.all(this._disposables.clear().map(async (dispose) => {
            try {
                await composeError(async (info) => {
                    await Promise.resolve();
                    info.error = new Error();
                    await runDisposable(dispose);
                }, this._runner.getOuterStack);
            }
            catch (reason) {
                this.ctx.logger.error(reason);
            }
        }));
        this.store = undefined;
        this._updateState(() => {
            if (this._runner.epoch === INACTIVE) {
                this.inertia = undefined;
            }
            else {
                this.inertia = this._reload();
                return 1 /* FiberState.LOADING */;
            }
        });
    }
    /**
     * Wait for current lifecycle work and rethrow startup errors.
     *
     * @returns this fiber, once it has settled into a stable state.
     * @throws the config-validation or plugin-startup error, if any.
     */
    async await() {
        while (this.inertia) {
            await this.inertia;
        }
        if (this._error)
            throw this._error;
        return this;
    }
    /**
     * Dispose and immediately reload this plugin with its current config.
     *
     * @returns a promise resolving once the reload settled.
     * @throws {CordisError} `INACTIVE_EFFECT` when the fiber is already disposed.
     */
    async restart() {
        this.assertActive();
        this._setEpoch(INACTIVE);
        this._refresh();
        await this.await();
    }
    /**
     * Validate and apply new config, then restart the plugin.
     *
     * Runs the `internal/update` waterfall first, so update hooks (and HMR)
     * can veto or replace the restart.
     *
     * @param config — the new raw config; validated before anything restarts.
     * @param noSave — hint for persistence hooks not to write the change back.
     * @returns the update waterfall result; the default restart returns a promise.
     * @throws when validation, an update listener, or the restarted plugin fails.
     */
    update(config, noSave = false) {
        this.assertActive();
        this._config = config;
        if (this.state !== 2 /* FiberState.ACTIVE */) {
            // Config resolution may access injected services, so defer it until the
            // fiber can activate.
            this._error = undefined;
            this._setEpoch(INACTIVE);
            this._refresh();
            return;
        }
        config = this._resolveConfig(config);
        return this.context.waterfall(this, 'internal/update', config, noSave, () => {
            this.config = config;
            this._error = undefined;
            return this.restart();
        });
    }
}
//# sourceMappingURL=fiber.js.map