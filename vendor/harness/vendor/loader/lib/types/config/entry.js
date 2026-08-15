import { deepEqual, isNullable } from '@deepseek-ai/cosmokit';
import { EntryTree } from "./tree.js";
import { evaluate, isJsExpr } from "./utils.js";
function updateError(stage, options, cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new Error(`failed to ${stage} loader entry ${options.id} (${options.name}): ${detail}`, { cause });
}
function takeEntries(object, keys) {
    const result = [];
    for (const key of keys) {
        if (!(key in object))
            continue;
        result.push([key, object[key]]);
        delete object[key];
    }
    return result;
}
function sortKeys(object, prepend = ['id', 'name'], append = ['config']) {
    const part1 = takeEntries(object, prepend);
    const part2 = takeEntries(object, append);
    const rest = takeEntries(object, Object.keys(object)).sort(([a], [b]) => a.localeCompare(b));
    return Object.assign(object, Object.fromEntries([...part1, ...rest, ...part2]));
}
function replaceKeys(target, source) {
    for (const key of Object.keys(target))
        Reflect.deleteProperty(target, key);
    return Object.assign(target, source);
}
/** One configured plugin node inside an `EntryTree`. */
export class Entry {
    loader;
    static key = Symbol.for('cordis.entry');
    ctx;
    fiber;
    parent;
    // safety: call `entry.update()` immediately after creating an entry
    options = {};
    subgroup;
    subtree;
    _initTask;
    _disposing = 0;
    constructor(loader) {
        this.loader = loader;
        this.ctx = loader.ctx.extend({ [Entry.key]: this });
        this.context.emit('loader/entry-init', this);
    }
    get context() {
        return this.ctx;
    }
    get id() {
        let id = this.options.id;
        if (this.parent.tree.ctx.fiber.entry) {
            id = this.parent.tree.ctx.fiber.entry.id + EntryTree.sep + id;
        }
        return id;
    }
    /** True when this entry or any owning parent entry is disabled. */
    get disabled() {
        return this._disabled(this.options);
    }
    _disabled(options) {
        // group is always enabled
        if (options.group)
            return false;
        if (this.disabledOf(options))
            return true;
        let entry = this.parent.ctx.fiber.entry;
        while (entry) {
            if (this.disabledOf(entry.options))
                return true;
            entry = entry.parent.ctx.fiber.entry;
        }
        return false;
    }
    /**
     * Effective disabled state: a `!!js` expression evaluates against the loader
     * context. The raw node stays in the options, so write-back keeps the form.
     */
    disabledOf(options) {
        return isJsExpr(options.disabled)
            ? Boolean(this.evaluate(options.disabled.__jsExpr))
            : Boolean(options.disabled);
    }
    evaluate(expr) {
        return evaluate(this.ctx, expr);
    }
    async _patchContext(diff) {
        await this.context.waterfall('loader/patch-context', this, async () => {
            Object.setPrototypeOf(this.ctx, this.parent.ctx);
            if (this.fiber?.uid && (diff.includes('config') || this.options.group)) {
                await this.fiber.update(this.options.config, true);
            }
        });
    }
    async refresh() {
        if (this.fiber)
            return;
        if (this.disabled)
            return;
        await this.init();
    }
    async _dispose(fiber = this.fiber) {
        if (!fiber)
            return;
        if (this.fiber === fiber)
            this.fiber = undefined;
        this._disposing += 1;
        try {
            await fiber.dispose();
        }
        finally {
            this._disposing -= 1;
        }
    }
    /** Merge new options, restart as needed, and persist through the parent tree. */
    async update(options, create = false, force = false) {
        const previousOptions = this.options;
        const legacy = { ...previousOptions };
        const candidate = create ? options : { ...previousOptions };
        if (!create) {
            for (const [key, value] of Object.entries(options)) {
                if (isNullable(value)) {
                    delete candidate[key];
                }
                else {
                    candidate[key] = value;
                }
            }
        }
        sortKeys(candidate);
        const diff = Object
            .keys({ ...candidate, ...legacy })
            .filter(key => !deepEqual(candidate[key], legacy[key]));
        if (!diff.length && !force)
            return;
        const commit = () => {
            if (create)
                return;
            this.options = replaceKeys(previousOptions, candidate);
        };
        const previous = this.fiber;
        if (!previous?.uid) {
            this.fiber = undefined;
            this.options = candidate;
            try {
                if (!this._disabled(candidate))
                    await this.init();
            }
            catch (error) {
                this.options = previousOptions;
                throw error;
            }
            commit();
            return;
        }
        if (this._disabled(candidate)) {
            this.options = candidate;
            try {
                await this._dispose(previous);
            }
            catch (error) {
                this.options = previousOptions;
                throw updateError('dispose', candidate, error);
            }
            commit();
            this.context.emit('loader/partial-dispose', this, legacy, true);
            return;
        }
        const replace = diff.some(key => key === 'name' || key === 'inject' || key === 'group');
        if (!replace) {
            this.options = candidate;
            try {
                await this._patchContext(diff);
            }
            catch (error) {
                this.options = previousOptions;
                try {
                    await this._patchContext(diff);
                }
                catch (rollbackError) {
                    throw updateError('rollback', legacy, new AggregateError([error, rollbackError]));
                }
                this.context.emit('loader/partial-dispose', this, candidate, true);
                throw updateError('apply', candidate, error);
            }
            commit();
            this.context.emit('loader/partial-dispose', this, legacy, true);
            return;
        }
        let plugin;
        try {
            plugin = diff.includes('name')
                ? this.loader.unwrapExports(await this.parent.tree.import(candidate.name, this.getOuterStack))
                : previous.runtime.callback;
        }
        catch (error) {
            throw updateError('import', candidate, error);
        }
        const previousPlugin = previous.runtime.callback;
        this.options = candidate;
        try {
            await this._dispose(previous);
        }
        catch (error) {
            this.options = previousOptions;
            throw updateError('dispose', candidate, error);
        }
        try {
            await this._start(plugin);
        }
        catch (error) {
            this.options = previousOptions;
            try {
                await this._start(previousPlugin);
            }
            catch (rollbackError) {
                throw updateError('rollback', legacy, new AggregateError([error, rollbackError]));
            }
            this.context.emit('loader/partial-dispose', this, candidate, true);
            throw updateError('apply', candidate, error);
        }
        commit();
        this.context.emit('loader/partial-dispose', this, legacy, true);
    }
    getOuterStack = () => {
        let entry = this;
        const result = [];
        do {
            result.push(`    at ${entry.parent.tree.ctx.baseUrl}#${entry.options.id}`);
            entry = entry.parent.ctx.fiber.entry;
        } while (entry);
        return result;
    };
    /** Import and start the configured plugin if it is not already running. */
    async init() {
        try {
            await (this._initTask ??= this._init());
        }
        finally {
            this._initTask = undefined;
            if (!this.loader.getTasks().length)
                this.ctx.reflect.notify(['loader']);
        }
        await this._await();
    }
    async _await() {
        try {
            await this.fiber?.await();
        }
        catch (error) {
            throw updateError('apply', this.options, error);
        }
    }
    async _init() {
        let plugin;
        try {
            plugin = this.loader.unwrapExports(await this.parent.tree.import(this.options.name, this.getOuterStack));
        }
        catch (error) {
            throw updateError('import', this.options, error);
        }
        try {
            await this._start(plugin);
        }
        catch (error) {
            throw updateError('apply', this.options, error);
        }
    }
    async _start(plugin) {
        let fiber;
        try {
            await this._patchContext([]);
            this.loader.showLog(this, 'apply');
            fiber = this.fiber = this.ctx.registry.plugin(plugin, this.options.config, this.getOuterStack);
            await fiber.await();
        }
        catch (error) {
            await this._dispose(fiber);
            throw error;
        }
    }
}
//# sourceMappingURL=entry.js.map