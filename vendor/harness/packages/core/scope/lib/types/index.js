/**
 * Scoped-context primitive: mint a Cordis context that tags registrations with
 * an opaque identity and build routing-only event carriers for that identity.
 *
 * @module @deepseek-ai/dsh-scope
 */
import { Context as CordisContext } from '@deepseek-ai/cordis';
export { AnonymousEntries, NamedEntries, ScopedLayers } from "./store.js";
/** Context tag written by {@link createScope}. */
const kScope = Symbol('dsh.scope');
/** The key associated with each carrier. Presence distinguishes an unkeyed carrier from a non-carrier. */
const carrierKeys = new WeakMap();
/**
 * The enclosing scope of each key. One relation powers both directions of
 * scope nesting: registration views inherit DOWN the chain (a child scope
 * sees its ancestors' layers — {@link ScopedLayers}), and event admission
 * extends UP it (a listener tagged with an ancestor receives events dispatched
 * to a descendant key — {@link scopeTarget}).
 */
const scopeParents = new WeakMap();
/** Cycle-checked write shared by the bind and every rebind. */
function linkScopeParent(key, parent) {
    for (let cursor = parent; cursor !== undefined; cursor = scopeParents.get(cursor)) {
        if (cursor === key)
            throw new Error('dsh-scope: scope parent link would form a cycle');
    }
    scopeParents.set(key, parent);
}
/**
 * Bind `parent` as `key`'s enclosing scope, once.
 *
 * A key that already has a parent throws: there is no open re-link path, so a
 * scope's ancestry cannot be moved by anyone but the original binder, who
 * alone receives the {@link ScopeParentBinding}. A link that would close a
 * cycle is rejected, because every chain consumer walks parents to the root.
 * @param key - the child scope key.
 * @param parent - its enclosing scope key.
 * @returns the binding that alone may re-link this key.
 */
export function bindScopeParent(key, parent) {
    if (scopeParents.has(key)) {
        throw new Error('dsh-scope: scope key is already bound to a parent; re-linking requires the binding returned by the original bind');
    }
    linkScopeParent(key, parent);
    return {
        rebind(next) {
            linkScopeParent(key, next);
        },
    };
}
/**
 * Read one key's enclosing scope.
 * @param key - the scope key to inspect.
 * @returns its parent key, or `undefined` for a root scope.
 */
export function scopeParentOf(key) {
    return scopeParents.get(key);
}
/**
 * The chain from a key to its root ancestor.
 * @param key - the starting key, or `undefined` for the empty chain.
 * @returns keys nearest-first: `[key, parent, grandparent, …]`.
 */
export function scopeChainOf(key) {
    const chain = [];
    for (let cursor = key; cursor !== undefined; cursor = scopeParents.get(cursor))
        chain.push(cursor);
    return chain;
}
/** Follow a Cordis fiber through asynchronous teardown even if its raw disposer was already claimed. */
async function quiesceFiber(fiber) {
    await Promise.resolve(fiber.dispose());
    while (fiber.inertia !== undefined)
        await fiber.inertia;
}
/** Shared no-op plugin used as the backing scope fiber. */
function scope() { }
/**
 * Mint a scope under `ctx`. The scoped context inherits the minting plugin's
 * dependency API and owns every registration made through it.
 * @param ctx - active context whose dependency API the scope inherits.
 * @param key - opaque identity used for listener routing.
 * @param options - optional scope-chain placement.
 * @returns the scoped context and exact/shared disposal boundaries.
 */
export function createScope(ctx, key, options) {
    if (options?.parent !== undefined)
        bindScopeParent(key, options.parent);
    const fiber = ctx.plugin(scope);
    const scoped = fiber.ctx.extend({ [kScope]: key });
    let disposing;
    return {
        ctx: scoped,
        rawDispose: fiber.dispose,
        dispose: () => (disposing ??= quiesceFiber(fiber)),
    };
}
/**
 * Read the nearest scope tag inherited by a context.
 * @param ctx - context to inspect.
 * @returns its scope key, or `undefined` for an unscoped context.
 */
export function scopeOf(ctx) {
    return ctx[kScope];
}
/**
 * Build an opaque receiver that preserves the base filter, admits untagged
 * listeners globally, and admits tagged listeners for a matching key or any
 * of its ancestors ({@link bindScopeParent}): a listener owned by an enclosing
 * scope receives every descendant scope's events, which is what lets one
 * standing composition observe each of the agents composed under it. A tag
 * BELOW the dispatch key stays excluded — events flow up the chain, never
 * down.
 * @param base - subject or service whose existing Cordis filter is preserved.
 * @param key - routed scope identity, or `undefined` for an unscoped subject.
 * @returns a carrier whose subject remains available only through event arguments.
 */
export function scopeTarget(base, key) {
    const baseFilter = base[CordisContext.filter];
    const carrier = {
        [CordisContext.filter](ctx) {
            if (baseFilter !== undefined && !baseFilter.call(base, ctx))
                return false;
            const tag = scopeOf(ctx);
            if (tag === undefined)
                return true;
            for (let cursor = key; cursor !== undefined; cursor = scopeParents.get(cursor)) {
                if (cursor === tag)
                    return true;
            }
            return false;
        },
    };
    carrierKeys.set(carrier, key);
    return carrier;
}
/**
 * Test whether a value is a scope carrier.
 * @param value - dispatch receiver to inspect.
 * @returns whether {@link scopeTarget} created it.
 */
export function isScopeCarrier(value) {
    return typeof value === 'object' && value !== null && carrierKeys.has(value);
}
/**
 * Read a carrier's routing key.
 * @param value - dispatch receiver to inspect.
 * @returns the carrier key, or `undefined` for an unkeyed/non-carrier value.
 */
export function carrierKeyOf(value) {
    if (!isScopeCarrier(value))
        return undefined;
    return carrierKeys.get(value);
}
//# sourceMappingURL=index.js.map