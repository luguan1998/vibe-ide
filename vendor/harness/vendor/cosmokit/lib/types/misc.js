/** No-op callback returning `undefined` at runtime and `any` at type level. */
export function noop() { }
/** Return true when a value is `null` or `undefined`. */
export function isNullable(value) {
    return value === null || value === undefined;
}
/** Return true when a value is neither `null` nor `undefined`. */
export function isNonNullable(value) {
    return !isNullable(value);
}
/** Return true for non-array object values. */
export function isPlainObject(data) {
    return data && typeof data === 'object' && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
export function filterKeys(object, filter) {
    return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
export function mapValues(object, transform) {
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Alias for `mapValues`. */
export { mapValues as valueMap };
/** Pick selected keys from an object, optionally including `undefined` values. */
export function pick(source, keys, forced) {
    if (!keys)
        return { ...source };
    const result = {};
    for (const key of keys) {
        if (forced || source[key] !== undefined)
            result[key] = source[key];
    }
    return result;
}
/** Omit selected keys from a shallow object copy. */
export function omit(source, keys) {
    if (!keys)
        return { ...source };
    const result = { ...source };
    for (const key of keys) {
        Reflect.deleteProperty(result, key);
    }
    return result;
}
/** Define a non-enumerable writable property and return the object. */
export function defineProperty(object, key, value) {
    return Object.defineProperty(object, key, { writable: true, value, enumerable: false });
}
//# sourceMappingURL=misc.js.map