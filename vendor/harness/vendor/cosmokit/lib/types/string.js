/** Uppercase the first character of a string. */
export function capitalize(source) {
    return source.charAt(0).toUpperCase() + source.slice(1);
}
/** Lowercase the first character of a string. */
export function uncapitalize(source) {
    return source.charAt(0).toLowerCase() + source.slice(1);
}
/** Convert dash or underscore delimited text to camelCase. */
export function camelCase(source) {
    return source.replace(/[_-][a-z]/g, str => str.slice(1).toUpperCase());
}
function tokenize(source, delimiters, delimiter) {
    const output = [];
    let state = 0 /* State.DELIM */;
    for (let i = 0; i < source.length; i++) {
        const code = source.charCodeAt(i);
        if (code >= 65 && code <= 90) {
            if (state === 1 /* State.UPPER */) {
                const next = source.charCodeAt(i + 1);
                if (next >= 97 && next <= 122) {
                    output.push(delimiter);
                }
                output.push(code + 32);
            }
            else {
                if (state !== 0 /* State.DELIM */) {
                    output.push(delimiter);
                }
                output.push(code + 32);
            }
            state = 1 /* State.UPPER */;
        }
        else if (code >= 97 && code <= 122) {
            output.push(code);
            state = 2 /* State.LOWER */;
        }
        else if (delimiters.includes(code)) {
            if (state !== 0 /* State.DELIM */) {
                output.push(delimiter);
            }
            state = 0 /* State.DELIM */;
        }
        else {
            output.push(code);
        }
    }
    return String.fromCharCode(...output);
}
/** Convert text to dash-delimited parameter case. */
export function paramCase(source) {
    return tokenize(source, [45, 95], 45);
}
/** Convert text to underscore-delimited snake case. */
export function snakeCase(source) {
    return tokenize(source, [45, 95], 95);
}
/** Runtime alias for `camelCase`. */
export const camelize = camelCase;
/** Runtime alias for `paramCase`. */
export const hyphenate = paramCase;
/* eslint-enable @typescript-eslint/naming-convention */
/** Format a property key as a JavaScript member access suffix. */
export function formatProperty(key) {
    if (typeof key !== 'string')
        return `[${key.toString()}]`;
    return /^[a-z_$][\w$]*$/i.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
/** Remove one trailing slash from a path string. */
export function trimSlash(source) {
    return source.replace(/\/$/, '');
}
/** Ensure a path starts with `/` and has no trailing slash. */
export function sanitize(source) {
    if (!source.startsWith('/'))
        source = '/' + source;
    return trimSlash(source);
}
//# sourceMappingURL=string.js.map