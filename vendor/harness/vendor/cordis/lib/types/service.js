import { defineProperty } from '@deepseek-ai/cosmokit';
import { Context } from "./context.js";
import { createCallable, joinPrototype, symbols } from "./utils.js";
/**
 * Base class for services that expose a named API on `ctx`.
 *
 * Subclasses call `super(ctx, name)` from their constructor. The service is
 * registered immediately and is automatically removed with the owning fiber.
 */
export class Service {
    ctx;
    /** Symbol key of an instance method run after construction (class plugins). */
    static init = symbols.init;
    /** Symbol key of the availability predicate passed to `ctx.provide()`. */
    static check = symbols.check;
    /** Symbol key of the phantom intercept-config type parameter. */
    static config = symbols.config;
    /** Symbol key of the call body making a service callable (e.g. `ctx.logger()`). */
    static invoke = symbols.invoke;
    /** Symbol key of the helper deriving an extended service instance. */
    static extend = symbols.extend;
    /** Symbol key of the tracker metadata used for context tracing. */
    static tracker = symbols.tracker;
    /** Symbol key of the intercept-config resolution helper below. */
    static resolveConfig = symbols.resolveConfig;
    /** The service name this instance is registered under. */
    name;
    /**
     * Register this instance as `name` in the current context.
     *
     * Calls `ctx.reflect.provide(name, this, this[Service.check])`, so the
     * service is unregistered automatically when the owning fiber unloads.
     * Services with a `[Service.invoke]` body return a callable instance.
     *
     * @param ctx — the context to register in (stored as `this.ctx`).
     * @param name — the service name; defaults to the static `provide` field.
     */
    constructor(ctx, name) {
        this.ctx = ctx;
        name ??= this.constructor['provide'];
        let self = this;
        const tracker = {
            associate: name,
            property: 'ctx',
        };
        if (self[symbols.invoke]) {
            self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
        }
        self.ctx = ctx;
        self.name = name;
        defineProperty(self, symbols.tracker, tracker);
        self.ctx.reflect.provide(name, self, this[symbols.check]);
        return self;
    }
    [symbols.filter](ctx) {
        return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name];
    }
    [symbols.extend](props) {
        let self;
        if (this[Service.invoke]) {
            self = createCallable(this.name, this, this[symbols.tracker]);
        }
        else {
            self = Object.create(this);
        }
        return Object.assign(self, props);
    }
    /**
     * Merge intercept config from ancestors with optional base and head values.
     *
     * Entries added closer to the root apply first; `base` is prepended and
     * `head` appended. Uses `Config.merge` when the service declares one,
     * otherwise a shallow `Object.assign`.
     *
     * @param base — lowest-precedence config merged before all intercepts.
     * @param head — highest-precedence config merged after all intercepts.
     * @returns the merged config.
     */
    [symbols.resolveConfig](base, head) {
        let intercept = this.ctx[Context.intercept];
        const configs = [];
        while (this.name in intercept) {
            if (Object.hasOwn(intercept, this.name)) {
                configs.unshift(intercept[this.name]);
            }
            intercept = Object.getPrototypeOf(intercept);
        }
        if (base)
            configs.unshift(base);
        if (head)
            configs.push(head);
        if (this['Config']?.merge) {
            return this['Config'].merge(...configs);
        }
        else {
            return Object.assign({}, ...configs);
        }
    }
    static [Symbol.hasInstance](instance) {
        if (!instance)
            return false;
        let constructor = instance.constructor;
        while (constructor) {
            // constructor may be a proxy
            constructor = constructor.prototype?.constructor;
            if (constructor === this)
                return true;
            constructor &&= Object.getPrototypeOf(constructor);
        }
        return false;
    }
}
//# sourceMappingURL=service.js.map