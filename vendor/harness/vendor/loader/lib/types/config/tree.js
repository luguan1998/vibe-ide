var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { composeError } from '@deepseek-ai/cordis';
import { isNonNullable } from '@deepseek-ai/cosmokit';
import { EntryGroup } from "./group.js";
/** Mutable tree of loader entries. Persistence is supplied by subclasses. */
export class EntryTree {
    static sep = ':';
    ctx;
    enableLogs;
    root;
    store = Object.create(null);
    constructor(ctx) {
        this.ctx = ctx.extend({ baseUrl: ctx.baseUrl });
        this.root = new EntryGroup(this.ctx, this);
        const entry = this.ctx.fiber.entry;
        if (entry)
            entry.subtree = this;
    }
    get context() {
        return this.ctx;
    }
    /** Iterate entries in this tree and any nested subtrees. */
    *entries() {
        for (const entry of Object.values(this.store)) {
            yield entry;
            if (!entry.subtree)
                continue;
            yield* entry.subtree.entries();
        }
    }
    /** Return pending import and lifecycle tasks owned by this tree. */
    getTasks() {
        return [...this.entries()]
            .map(entry => entry._initTask || entry.fiber?.inertia)
            .filter(isNonNullable);
    }
    /**
     * Wait until this tree has no active import or lifecycle tasks.
     * @throws a settled fiber failure, or an aggregate when several fibers failed.
     */
    async await() {
        while (true) {
            const tasks = this.getTasks();
            if (tasks.length) {
                await Promise.allSettled(tasks);
                continue;
            }
            const outcomes = await Promise.allSettled([...this.entries()].map(entry => entry._await()));
            const failures = outcomes
                .filter((outcome) => outcome.status === 'rejected')
                .map(outcome => outcome.reason);
            if (failures.length === 1)
                throw failures[0];
            if (failures.length > 1)
                throw new AggregateError(failures, 'loader fibers failed');
            this.ctx.reflect.notify(['loader']);
            if (!this.getTasks().length)
                return;
        }
    }
    ensureId(options) {
        if (!options.id) {
            do {
                options.id = Math.random().toString(16).slice(2, 10);
            } while (this.store[options.id]);
        }
        return options.id;
    }
    /** Resolve an entry by id, including nested ids separated by `EntryTree.sep`. */
    resolve(id) {
        const parts = id.split(EntryTree.sep);
        let tree = this;
        const final = parts.pop();
        for (const part of parts) {
            tree = tree.store[part]?.subtree;
            if (!tree)
                throw new Error(`cannot resolve entry ${id}`);
        }
        const entry = tree.store[final];
        if (!entry)
            throw new Error(`cannot resolve entry ${id}`);
        return entry;
    }
    resolveGroup(id) {
        if (!id)
            return this.root;
        const entry = this.resolve(id);
        if (!entry.subgroup)
            throw new Error(`entry ${id} is not a group`);
        return entry.subgroup;
    }
    /** Create an entry in the root group or a nested group. */
    async create(options, parent = null, position = Infinity) {
        const group = this.resolveGroup(parent);
        const id = await group.create(options);
        const entry = this.resolve(id);
        group.data.splice(position, 0, entry.options);
        group.tree.write();
        return id;
    }
    /** Stop and remove an entry from its parent group. */
    async remove(id) {
        const entry = this.resolve(id);
        await entry.parent.remove(id);
        entry.parent.tree.write();
    }
    /** Update an entry and optionally move it to another group. */
    async update(id, options, parent, position) {
        const entry = this.resolve(id);
        const source = entry.parent;
        const sourceIndex = source.data.indexOf(entry.options);
        let target = source;
        if (parent !== undefined) {
            target = this.resolveGroup(parent);
            source.unlink(entry.options);
            target.data.splice(position ?? Infinity, 0, entry.options);
            entry.parent = target;
        }
        try {
            await entry.update(options, false, true);
        }
        catch (error) {
            if (parent !== undefined) {
                target.unlink(entry.options);
                source.data.splice(sourceIndex < 0 ? source.data.length : sourceIndex, 0, entry.options);
                entry.parent = source;
                try {
                    await entry.update({}, false, true);
                }
                catch (rollbackError) {
                    throw new AggregateError([error, rollbackError], `failed to roll back loader entry move ${id}`);
                }
            }
            throw error;
        }
        source.tree.write();
        if (target !== source)
            target.tree.write();
    }
    /** Import a plugin module from a specifier or `cordis:` builtin. */
    import(name, getOuterStack) {
        if (name.startsWith('cordis:')) {
            return this.ctx.loader.builtins[name.slice(7)];
        }
        return composeError(async (info) => {
            // ModuleJob.run
            // onImport.tracePromise.__proto__
            // internal.import
            info.offset += 3;
            if (this.ctx.loader.internal) {
                return await this.ctx.loader.internal.import(name, this.ctx.baseUrl, {});
            }
            else if (name.startsWith('.')) {
                return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ new URL(name, this.ctx.baseUrl).href));
            }
            else {
                return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ name));
            }
        }, getOuterStack);
    }
}
//# sourceMappingURL=tree.js.map