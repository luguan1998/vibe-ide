import { isNullable } from "./misc.js";
/** Test values using `instanceof` with a `toStringTag` fallback. */
export function is(type, value) {
    if (arguments.length === 1)
        return (value) => is(type, value);
    return type in globalThis && value instanceof globalThis[type]
        || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
    return is('ArrayBuffer', value) || is('SharedArrayBuffer', value);
}
function isArrayBufferSource(value) {
    return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
export var Binary;
(function (Binary) {
    Binary.is = isArrayBufferLike;
    Binary.isSource = isArrayBufferSource;
    function fromSource(source) {
        if (ArrayBuffer.isView(source)) {
            // https://stackoverflow.com/questions/8609289/convert-a-binary-nodejs-buffer-to-javascript-arraybuffer#answer-31394257
            return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
        }
        else {
            return source;
        }
    }
    Binary.fromSource = fromSource;
    function toBase64(source) {
        source = fromSource(source);
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(source).toString('base64');
        }
        let binary = '';
        const bytes = new Uint8Array(source);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    Binary.toBase64 = toBase64;
    function fromBase64(source) {
        if (typeof Buffer !== 'undefined')
            return fromSource(Buffer.from(source, 'base64'));
        return Uint8Array.from(atob(source), c => c.charCodeAt(0));
    }
    Binary.fromBase64 = fromBase64;
    function toHex(source) {
        source = fromSource(source);
        if (typeof Buffer !== 'undefined')
            return Buffer.from(source).toString('hex');
        return Array.from(new Uint8Array(source), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    Binary.toHex = toHex;
    function fromHex(source) {
        if (typeof Buffer !== 'undefined')
            return fromSource(Buffer.from(source, 'hex'));
        const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
        const buffer = [];
        for (let i = 0; i < hex.length; i += 2) {
            buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
        }
        return Uint8Array.from(buffer).buffer;
    }
    Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
/** Decode a base64 string into binary data. */
export const base64ToArrayBuffer = Binary.fromBase64;
/** Encode binary data as base64. */
export const arrayBufferToBase64 = Binary.toBase64;
/** Decode a hex string into binary data. */
export const hexToArrayBuffer = Binary.fromHex;
/** Encode binary data as hex. */
export const arrayBufferToHex = Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
export function clone(source, refs = new Map()) {
    if (!source || typeof source !== 'object')
        return source;
    if (is('Date', source))
        return new Date(source.valueOf());
    if (is('RegExp', source))
        return new RegExp(source.source, source.flags);
    if (isArrayBufferLike(source))
        return source.slice(0);
    if (ArrayBuffer.isView(source))
        return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    const cached = refs.get(source);
    if (cached)
        return cached;
    if (Array.isArray(source)) {
        const result = [];
        refs.set(source, result);
        source.forEach((value, index) => {
            result[index] = Reflect.apply(clone, null, [value, refs]);
        });
        return result;
    }
    const result = Object.create(Object.getPrototypeOf(source));
    refs.set(source, result);
    for (const key of Reflect.ownKeys(source)) {
        const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
        if ('value' in descriptor) {
            descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
        }
        Reflect.defineProperty(result, key, descriptor);
    }
    return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
export function deepEqual(a, b, strict) {
    if (a === b)
        return true;
    if (!strict && isNullable(a) && isNullable(b))
        return true;
    if (typeof a !== typeof b)
        return false;
    if (typeof a !== 'object')
        return false;
    if (!a || !b)
        return false;
    function check(test, then) {
        return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : undefined;
    }
    return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index])))
        ?? check(is('Date'), (a, b) => a.valueOf() === b.valueOf())
        ?? check(is('RegExp'), (a, b) => a.source === b.source && a.flags === b.flags)
        ?? check(isArrayBufferLike, (a, b) => {
            if (a.byteLength !== b.byteLength)
                return false;
            const viewA = new Uint8Array(a);
            const viewB = new Uint8Array(b);
            for (let i = 0; i < viewA.length; i++) {
                if (viewA[i] !== viewB[i])
                    return false;
            }
            return true;
        })
        ?? Object.keys({ ...a, ...b }).every(key => deepEqual(a[key], b[key], strict));
}
//# sourceMappingURL=types.js.map