import { EventsService } from "./events.js";
import { LoggerService } from "./logger.js";
import { ReflectService } from "./reflect.js";
import { RegistryService } from "./registry.js";
import { getTraceable, symbols } from "./utils.js";
import { Fiber } from "./fiber.js";
/**
 * Root and child dependency containers for Cordis plugins.
 *
 * A context is a proxy: normal property reads go through the service resolver,
 * while `extend()`, `isolate()`, and `intercept()` create scoped child
 * contexts without mutating their parent.
 */
export class Context {
    /** Symbol key under which a disposer exposes its {@link EffectMeta} diagnostics tree. */
    static effect = symbols.effect;
    /** Symbol key for a context's listener filter, consulted on every event dispatch. */
    static filter = symbols.filter;
    /** Symbol key of the isolation map (see the `Context[symbols.isolate]` property). */
    static isolate = symbols.isolate;
    /** Symbol key of the intercept map (see the `Context[symbols.intercept]` property). */
    static intercept = symbols.intercept;
    /**
     * Returns true for Cordis context proxies and context prototypes.
     *
     * Works across realms and across multiple copies of cordis, because the
     * brand is keyed by a global symbol rather than by `instanceof`.
     *
     * @param value — the value to test.
     * @returns `true` if `value` is a Cordis context, narrowing its type.
     */
    static is(value) {
        return !!value?.[Context.is];
    }
    static {
        Context.is[Symbol.toPrimitive] = () => Symbol.for('cordis.is');
        Context.prototype[Context.is] = true;
    }
    /** Create the root context and install the built-in services. */
    constructor() {
        this[symbols.isolate] = Object.create(null);
        this[symbols.intercept] = Object.create(null);
        const self = new Proxy(this, ReflectService.handler);
        this.root = self;
        this.baseUrl = undefined;
        this.fiber = new Fiber(self, {}, Object.create(null), null, () => []);
        this.reflect = new ReflectService(self);
        this.registry = new RegistryService(self);
        this.events = new EventsService(self);
        this.logger = new LoggerService(self);
        this.fiber._disposables.clear();
        return self;
    }
    [Symbol.for('nodejs.util.inspect.custom')]() {
        return `Context <${this.fiber.name}>`;
    }
    /**
     * Create a child context with extra metadata on top of the current scope.
     *
     * The child prototypally inherits every property of this context; own
     * properties of `meta` shadow the inherited ones. The parent is not mutated.
     *
     * @param meta — own properties (including symbol keys) to define on the child.
     * @returns a child context inheriting from this one.
     */
    extend(meta = {}) {
        const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value;
        const self = Object.create(getTraceable(this, this));
        for (const prop of Reflect.ownKeys(meta)) {
            Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop));
        }
        if (!shadow)
            return self;
        return Object.assign(Object.create(self), { [symbols.shadow]: shadow });
    }
    /**
     * Create a child context with an independent service scope for `name`.
     *
     * Below the returned context, reads and writes of the service `name`
     * resolve against the new label instead of the parent's, so a different
     * implementation can be provided without affecting the parent scope.
     * Passing the same `label` to two `isolate()` calls joins their scopes.
     *
     * @param name — the service name to isolate.
     * @param label — scope label to join; defaults to a fresh unique symbol.
     * @returns a child context whose `name` service resolves in the new scope.
     */
    isolate(name, label) {
        const shadow = Object.create(this[symbols.isolate]);
        shadow[name] = label ?? Symbol(name);
        return this.extend({ [symbols.isolate]: shadow });
    }
    intercept(name, config) {
        const intercept = Object.create(this[symbols.intercept]);
        intercept[name] = config;
        return this.extend({ [symbols.intercept]: intercept });
    }
}
//# sourceMappingURL=context.js.map