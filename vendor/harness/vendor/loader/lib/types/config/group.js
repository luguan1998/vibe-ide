import { Service } from '@deepseek-ai/cordis';
import { Entry } from "./entry.js";
/** Runtime owner for a list of child loader entries. */
export class EntryGroup {
    ctx;
    tree;
    static key = Symbol.for('cordis.group');
    data = [];
    constructor(ctx, tree) {
        this.ctx = ctx;
        this.tree = tree;
        const entry = ctx.fiber.entry;
        if (entry)
            entry.subgroup = this;
    }
    get context() {
        return this.ctx;
    }
    async create(options) {
        const id = this.tree.ensureId(options);
        const existing = this.tree.store[id];
        const entry = existing ?? (this.tree.store[id] = new Entry(this.ctx.loader));
        const previousParent = entry.parent;
        // Entry may be moved from another group,
        // so we need to update the parent reference.
        entry.parent = this;
        // Use `create: true` to replace existing entry.options.
        try {
            await entry.update(options, true, true);
        }
        catch (error) {
            if (existing) {
                entry.parent = previousParent;
            }
            else {
                delete this.tree.store[id];
            }
            throw error;
        }
        return entry.id;
    }
    unlink(options) {
        const config = this.data;
        const index = config.indexOf(options);
        if (index >= 0)
            config.splice(index, 1);
    }
    async remove(id, isDispose = false) {
        const entry = this.tree.store[id];
        if (!entry)
            return;
        await entry._dispose();
        if (!isDispose) {
            this.unlink(entry.options);
        }
        delete this.tree.store[id];
        this.context.emit('loader/partial-dispose', entry, entry.options, false);
    }
    async update(config) {
        const oldConfig = this.data;
        const seen = new Set();
        for (const options of config) {
            const id = this.tree.ensureId(options);
            if (seen.has(id))
                throw new TypeError(`duplicate loader entry id: ${id}`);
            seen.add(id);
        }
        const oldMap = Object.fromEntries(oldConfig.map(options => [options.id, options]));
        const newMap = Object.fromEntries(config.map(options => [options.id, options]));
        try {
            const outcomes = await Promise.allSettled(config.map(options => this.create(options)));
            // Disposal owns termination: sibling starts can still be settling after
            // the containing tree has gone away, but their failures no longer
            // describe a live update to roll back.
            if (this.ctx.fiber.uid === null)
                return;
            const failures = outcomes
                .filter((outcome) => outcome.status === 'rejected')
                .map(outcome => outcome.reason);
            if (failures.length === 1)
                throw failures[0];
            if (failures.length > 1)
                throw new AggregateError(failures, 'loader entries failed to apply');
            for (const id of Object.keys(oldMap)) {
                if (!newMap[id])
                    await this.remove(id, true);
            }
            this.data = config;
        }
        catch (error) {
            const rollbackErrors = [];
            for (const id of Object.keys(newMap).reverse()) {
                if (oldMap[id])
                    continue;
                try {
                    await this.remove(id, true);
                }
                catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            for (const options of oldConfig) {
                try {
                    await this.create(options);
                }
                catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            this.data = oldConfig;
            if (rollbackErrors.length)
                throw new AggregateError([error, ...rollbackErrors], 'loader entry rollback failed');
            throw error;
        }
    }
    async stop() {
        for (const options of this.data) {
            await this.remove(options.id, true);
        }
    }
}
/** Plugin that mounts a nested loader entry group. */
export class Group extends EntryGroup {
    ctx;
    config;
    static initial = [];
    static [EntryGroup.key] = true;
    constructor(ctx, config) {
        super(ctx, ctx.fiber.entry.parent.tree);
        this.ctx = ctx;
        this.config = config;
        ctx.on('internal/update', config => this.update(config));
    }
    async *[Service.init]() {
        yield () => this.stop();
        await this.update(this.config);
    }
}
//# sourceMappingURL=group.js.map