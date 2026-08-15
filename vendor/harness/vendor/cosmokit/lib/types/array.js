import { isNullable } from "./misc.js";
/** Return true when every item in `array2` is present in `array1`. */
export function contain(array1, array2) {
    return array2.every(item => array1.includes(item));
}
/** Return items that appear in both arrays. */
export function intersection(array1, array2) {
    return array1.filter(item => array2.includes(item));
}
/** Return items from `array1` that do not appear in `array2`. */
export function difference(array1, array2) {
    return array1.filter(item => !array2.includes(item));
}
/** Return the set-union of two arrays while preserving first occurrence order. */
export function union(array1, array2) {
    return Array.from(new Set([...array1, ...array2]));
}
/** Remove duplicate values while preserving first occurrence order. */
export function deduplicate(array) {
    return [...new Set(array)];
}
/** Remove one item from an array and report whether it was found. */
export function remove(list, item) {
    const index = list?.indexOf(item);
    if (index >= 0) {
        list.splice(index, 1);
        return true;
    }
    else {
        return false;
    }
}
/** Normalize nullish, scalar, or array input to an array. */
export function makeArray(source) {
    return Array.isArray(source) ? source : isNullable(source) ? [] : [source];
}
//# sourceMappingURL=array.js.map