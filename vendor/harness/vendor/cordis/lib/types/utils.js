import { defineProperty } from '@deepseek-ai/cosmokit';
/** Ordered collection of disposable values with O(1) deletion by value. */
export class DisposableList {
    sn = 0;
    map = new Map();
    weak = new WeakMap();
    get length() {
        return this.map.size;
    }
    push(value) {
        const sn = ++this.sn;
        this.map.set(sn, value);
        this.weak.set(value, sn);
        return () => this.map.delete(sn);
    }
    delete(value) {
        const sn = this.weak.get(value);
        if (!sn)
            return false;
        return this.map.delete(sn);
    }
    clear() {
        const values = [...this.map.values()];
        this.map.clear();
        return values.reverse();
    }
    [Symbol.iterator]() {
        return this.map.values();
    }
    [Symbol.for('nodejs.util.inspect.custom')]() {
        return [...this];
    }
}
/** Shared symbols used to avoid public property-name collisions. */
export const symbols = {
    // internal symbols
    shadow: Symbol.for('cordis.shadow'),
    receiver: Symbol.for('cordis.receiver'),
    original: Symbol.for('cordis.original'),
    metadata: Symbol.for('cordis.metadata'),
    initHooks: Symbol.for('cordis.initHooks'),
    checkProto: Symbol.for('cordis.checkProto'),
    // context symbols
    effect: Symbol.for('cordis.effect'),
    filter: Symbol.for('cordis.filter'),
    isolate: Symbol.for('cordis.isolate'),
    intercept: Symbol.for('cordis.intercept'),
    // service symbols
    init: Symbol.for('cordis.init'),
    check: Symbol.for('cordis.check'),
    config: Symbol.for('cordis.config'),
    invoke: Symbol.for('cordis.invoke'),
    extend: Symbol.for('cordis.extend'),
    tracker: Symbol.for('cordis.tracker'),
    resolveConfig: Symbol.for('cordis.resolveConfig'),
};
const GeneratorFunction = function* () { }.constructor;
const AsyncGeneratorFunction = async function* () { }.constructor;
/** Return true when a plugin callback should be constructed with `new`. */
export function isConstructor(func) {
    // async function or arrow function
    if (!func.prototype)
        return false;
    // generator function or malformed definition
    // we cannot use below check because `mock.fn()` is proxied
    // if (func.prototype.constructor !== func) return false
    if (func instanceof GeneratorFunction)
        return false;
    // polyfilled AsyncGeneratorFunction === Function
    if (AsyncGeneratorFunction !== Function && func instanceof AsyncGeneratorFunction)
        return false;
    return true;
}
/** Merge two prototype chains while preserving descriptors from `proto1`. */
export function joinPrototype(proto1, proto2) {
    if (proto1 === Object.prototype)
        return proto2;
    const result = Object.create(joinPrototype(Object.getPrototypeOf(proto1), proto2));
    for (const key of Reflect.ownKeys(proto1)) {
        Object.defineProperty(result, key, Object.getOwnPropertyDescriptor(proto1, key));
    }
    return result;
}
/** Return true for non-null objects and functions. */
export function isObject(value) {
    return value && (typeof value === 'object' || typeof value === 'function');
}
/** Find a property descriptor by walking an object's prototype chain. */
export function getPropertyDescriptor(target, prop) {
    let proto = target;
    while (proto) {
        const desc = Reflect.getOwnPropertyDescriptor(proto, prop);
        if (desc)
            return desc;
        proto = Object.getPrototypeOf(proto);
    }
}
/** Wrap services/functions so method calls see the caller's active context. */
export function getTraceable(ctx, value) {
    if (!isObject(value))
        return value;
    if (Object.hasOwn(value, symbols.shadow)) {
        return Object.getPrototypeOf(value);
    }
    const tracker = value[symbols.tracker];
    if (!tracker)
        return value;
    return createTraceable(ctx, value, tracker);
}
/** Return a proxy that overlays readonly or writable properties onto a target. */
export function withProps(target, props) {
    if (!props)
        return target;
    return new Proxy(target, {
        get: (target, prop, receiver) => {
            if (prop in props && prop !== 'constructor')
                return Reflect.get(props, prop, receiver);
            return Reflect.get(target, prop, receiver);
        },
        set: (target, prop, value, receiver) => {
            if (prop in props && prop !== 'constructor')
                return Reflect.set(props, prop, value, receiver);
            return Reflect.set(target, prop, value, receiver);
        },
    });
}
function withProp(target, prop, value) {
    return withProps(target, Object.defineProperty(Object.create(null), prop, {
        value,
        writable: false,
    }));
}
function createShadow(ctx, target, property, receiver) {
    if (!property)
        return receiver;
    const origin = Reflect.getOwnPropertyDescriptor(target, property)?.value;
    if (!origin)
        return receiver;
    return withProp(receiver, property, ctx.extend({ [symbols.shadow]: origin }));
}
function createShadowMethod(ctx, value, outer, shadow) {
    return new Proxy(value, {
        apply: (target, thisArg, args) => {
            if (thisArg === outer)
                thisArg = shadow;
            return getTraceable(ctx, Reflect.apply(target, thisArg, args));
        },
    });
}
function createTraceable(ctx, value, tracker) {
    // noShadow services are identity-aware (e.g. logger uses the origin fiber to
    // derive its name): keep the shadow ctx so they can read [symbols.shadow]
    // and resolve the origin. Non-noShadow services strip — their side effects
    // bind to caller, not origin.
    if (ctx[symbols.shadow] && !tracker.noShadow) {
        ctx = Object.getPrototypeOf(ctx);
    }
    const proxy = new Proxy(value, {
        get: (target, prop, receiver) => {
            if (prop === symbols.original)
                return target;
            if (prop === tracker.property)
                return ctx;
            if (typeof prop === 'symbol') {
                return Reflect.get(target, prop, receiver);
            }
            if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) {
                return Reflect.get(ctx, `${tracker.associate}.${prop}`, withProp(ctx, symbols.receiver, receiver));
            }
            let shadow, innerValue;
            const desc = getPropertyDescriptor(target, prop);
            if (desc && 'value' in desc) {
                innerValue = desc.value;
            }
            else {
                shadow = createShadow(ctx, target, tracker.property, receiver);
                innerValue = Reflect.get(target, prop, shadow);
            }
            const innerTracker = innerValue?.[symbols.tracker];
            if (innerTracker) {
                return createTraceable(ctx, innerValue, innerTracker);
            }
            else if (!tracker.noShadow && typeof innerValue === 'function') {
                shadow ??= createShadow(ctx, target, tracker.property, receiver);
                return createShadowMethod(ctx, innerValue, receiver, shadow);
            }
            else {
                return innerValue;
            }
        },
        set: (target, prop, value, receiver) => {
            if (prop === symbols.original)
                return false;
            if (prop === tracker.property)
                return false;
            if (typeof prop === 'symbol') {
                return Reflect.set(target, prop, value, receiver);
            }
            if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) {
                return Reflect.set(ctx, `${tracker.associate}.${prop}`, value, withProp(ctx, symbols.receiver, receiver));
            }
            const shadow = createShadow(ctx, target, tracker.property, receiver);
            return Reflect.set(target, prop, value, shadow);
        },
        apply: (target, thisArg, args) => {
            return applyTraceable(proxy, target, thisArg, args);
        },
    });
    return proxy;
}
function applyTraceable(proxy, value, thisArg, args) {
    if (!value[symbols.invoke])
        return Reflect.apply(value, thisArg, args);
    return value[symbols.invoke].apply(proxy, args);
}
/** Create a callable service object that dispatches through `symbols.invoke`. */
export function createCallable(name, proto, tracker) {
    const self = function (...args) {
        const proxy = createTraceable(self['ctx'], self, tracker);
        return applyTraceable(proxy, self, this, args);
    };
    defineProperty(self, 'name', name);
    return Object.setPrototypeOf(self, proto);
}
function handleError(info, reason, getOuterStack) {
    const innerLines = info.error.stack.split('\n');
    // malformed error
    if (typeof reason?.stack !== 'string') {
        const outerError = new Error(reason);
        const lines = outerError.stack.split('\n');
        lines.splice(1, Infinity, ...getOuterStack());
        outerError.stack = lines.join('\n');
        throw outerError;
    }
    // long stack trace
    const lines = reason.stack.split('\n');
    let index = lines.indexOf(innerLines[2]);
    if (index === -1)
        throw reason;
    index -= info.offset;
    while (index > 0) {
        if (!lines[index - 1].endsWith(' (<anonymous>)'))
            break;
        index -= 1;
    }
    lines.splice(index, Infinity, ...getOuterStack());
    reason.stack = lines.join('\n');
    throw reason;
}
/** Run a callback and splice outer call-site frames into thrown async errors. */
export function composeError(callback, getOuterStack = buildOuterStack()) {
    const info = { offset: 1, error: new Error() };
    try {
        const result = callback(info);
        if (isObject(result) && 'then' in result) {
            return result.then(undefined, (reason) => handleError(info, reason, getOuterStack));
        }
        else {
            return result;
        }
    }
    catch (reason) {
        handleError(info, reason, getOuterStack);
    }
}
/** Capture a lazy stack-frame supplier for later error composition. */
export function buildOuterStack(offset = 0) {
    const outerError = new Error();
    return () => outerError.stack.split('\n').slice(3 + offset);
}
//# sourceMappingURL=utils.js.map