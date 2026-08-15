/**
 * Shared insertion-ordered storage and effect ownership for scope-aware registries.
 *
 * @module @deepseek-ai/dsh-scope
 */
import { scopeChainOf, scopeOf } from "./index.js";
/**
 * Insertion-ordered named entries with caller-owned duplicate diagnostics.
 *
 * Values are borrowed. Iterators are live within one nonempty table
 * generation; draining the table detaches them from later insertions. Each
 * successful insertion returns an idempotent undo for that exact entry.
 */
export class NamedEntries {
    duplicateError;
    data = new Map();
    constructor(duplicateError) {
        this.duplicateError = duplicateError;
    }
    /**
     * Insert one unique name.
     * @param name - name unique within this table.
     * @param value - borrowed value to retain.
     * @returns an idempotent undo that removes only this insertion.
     */
    insert(name, value) {
        const data = this.data;
        if (data.has(name))
            throw this.duplicateError(name);
        data.set(name, value);
        let active = true;
        return () => {
            if (!active)
                return;
            active = false;
            data.delete(name);
            if (data.size === 0 && this.data === data)
                this.data = new Map();
        };
    }
    /**
     * Read one named value.
     * @param name - name to resolve.
     * @returns the retained value, or `undefined` when absent.
     */
    get(name) {
        return this.data.get(name);
    }
    /**
     * Test one name for membership.
     * @param name - name to test.
     * @returns whether the table contains that name.
     */
    has(name) {
        return this.data.has(name);
    }
    /**
     * Iterate live names in insertion order.
     * @returns the native live key iterator.
     */
    keys() {
        return this.data.keys();
    }
    /**
     * Iterate live entries in insertion order.
     * @returns the native live entry iterator.
     */
    entries() {
        return this.data.entries();
    }
    /**
     * Iterate live values in insertion order.
     * @returns the native live value iterator.
     */
    values() {
        return this.data.values();
    }
    /**
     * Test whether this table has no entries.
     * @returns whether the table is empty.
     */
    isEmpty() {
        return this.data.size === 0;
    }
}
/**
 * Insertion-ordered anonymous entries with independent registration identity.
 *
 * Equal values remain separate registrations. Values are borrowed, and
 * iterators are live within one nonempty table generation; draining the table
 * detaches them from later appends.
 */
export class AnonymousEntries {
    data = new Map();
    /**
     * Append one independently owned value.
     * @param value - borrowed value to retain.
     * @returns an idempotent undo for this exact append.
     */
    append(value) {
        const data = this.data;
        const key = Symbol();
        data.set(key, value);
        let active = true;
        return () => {
            if (!active)
                return;
            active = false;
            data.delete(key);
            if (data.size === 0 && this.data === data)
                this.data = new Map();
        };
    }
    /**
     * Iterate live values in insertion order.
     * @returns the native live value iterator.
     */
    values() {
        return this.data.values();
    }
    /**
     * Test whether this table has no entries.
     * @returns whether the table is empty.
     */
    isEmpty() {
        return this.data.size === 0;
    }
}
/**
 * Own the global and exact-scope layers for one registry.
 *
 * Reads never create scoped layers. Registrations derive both visibility and
 * effect ownership from the supplied Cordis context, collect undo before
 * notification, and reclaim only a completely empty aggregate layer.
 */
export class ScopedLayers {
    createLayer;
    onChange;
    /** The eagerly constructed context-global layer. */
    global;
    scoped = new Map();
    constructor(createLayer, onChange) {
        this.createLayer = createLayer;
        this.onChange = onChange;
        this.global = createLayer(undefined);
    }
    /**
     * Read an existing exact-scope overlay. Deliberately chain-blind: callers
     * addressing one scope's OWN contributions (its restrictions, its guards)
     * must not silently pick up an ancestor's — use {@link chainLayers} where
     * inheritance is the point.
     * @param scope - exact scope key; `undefined` denotes no overlay.
     * @returns the existing scoped layer, or `undefined` without creating one.
     */
    peek(scope) {
        if (scope === undefined)
            return undefined;
        return this.scoped.get(scope);
    }
    /**
     * Existing overlays along the scope's parent chain ({@link scopeChainOf}),
     * farthest ancestor first and the exact scope last, so a caller layering
     * them in order gives the nearest scope the final word.
     * @param scope - viewing scope, or `undefined` for no overlays.
     * @returns the existing layers, nearest last; absent overlays are skipped.
     */
    chainLayers(scope) {
        const layers = [];
        for (const key of scopeChainOf(scope).reverse()) {
            const layer = this.scoped.get(key);
            if (layer !== undefined)
                layers.push(layer);
        }
        return layers;
    }
    /**
     * Materialize global named entries followed by scope-chain shadows,
     * farthest ancestor first, so the nearest scope's entry wins a name.
     * @param scope - viewing scope, or `undefined` for the global view.
     * @param pick - select the named table from a layer.
     * @returns an insertion-ordered effective map.
     */
    merge(scope, pick) {
        const merged = new Map(pick(this.global).entries());
        for (const layer of this.chainLayers(scope)) {
            for (const [name, value] of pick(layer).entries())
                merged.set(name, value);
        }
        return merged;
    }
    /**
     * Attach one synchronous layer mutation to its registration context.
     * @param ctx - context that determines both scope visibility and effect ownership.
     * @param action - atomic mutation returning its synchronous undo.
     * @param options - Cordis effect label and optional change notification.
     * @returns the exact disposer returned by `ctx.effect()`.
     */
    effect(ctx, action, options) {
        const scope = scopeOf(ctx);
        const notify = options.notify ?? true;
        const dispose = ctx.effect(function* () {
            let layer;
            let created = false;
            if (scope === undefined) {
                layer = this.global;
            }
            else {
                const existing = this.scoped.get(scope);
                if (existing === undefined) {
                    layer = this.createLayer(scope);
                    this.scoped.set(scope, layer);
                    created = true;
                }
                else {
                    layer = existing;
                }
            }
            let undo;
            try {
                undo = action(layer);
            }
            catch (error) {
                if (scope !== undefined && created && layer.isEmpty())
                    this.scoped.delete(scope);
                throw error;
            }
            yield () => {
                undo();
                if (scope !== undefined && layer.isEmpty())
                    this.scoped.delete(scope);
                if (notify)
                    this.onChange();
            };
            if (notify)
                this.onChange();
        }.bind(this), options.label);
        // oxlint-disable-next-line typescript/no-misused-promises -- exact synchronous disposer preserves Cordis effect identity
        return dispose;
    }
}
//# sourceMappingURL=store.js.map