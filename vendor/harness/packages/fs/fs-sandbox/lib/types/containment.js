/**
 * Path-containment mechanics for the filesystem sandbox. Canonical spellings
 * take the fast lexical path; filesystem identity supplies the conservative
 * fallback for alias-equivalent roots such as Windows 8.3 names and casing.
 * @module @deepseek-ai/dsh-fs-sandbox/containment
 */
import { stat } from 'node:fs/promises';
import { dirname, sep } from 'node:path';
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);
function isMissing(error) {
    const code = error.code;
    return MISSING_CODES.has(code);
}
function comparablePath(path, caseSensitive) {
    return caseSensitive ? path : path.toLowerCase();
}
function isLexicallyUnder(path, root, caseSensitive) {
    const comparableTarget = comparablePath(path, caseSensitive);
    const comparableRoot = comparablePath(root, caseSensitive);
    if (comparableTarget === comparableRoot)
        return true;
    const prefix = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    return comparableTarget.startsWith(prefix);
}
async function statIfPresent(path) {
    try {
        return await stat(path, { bigint: true });
    }
    catch (error) {
        /* v8 ignore else -- a non-missing stat failure requires a host permission or I/O fault after resolve reached this ancestor. */
        if (isMissing(error))
            return undefined;
        /* v8 ignore next -- requires a host permission or I/O fault after resolve already reached this ancestor. */
        throw error;
    }
}
function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}
/**
 * Determine whether a canonical target is a writable root or lies beneath it.
 * The lexical fast path handles normal canonical spellings. When spellings
 * differ, walk the target's existing ancestors and compare filesystem identity
 * with the root; this recognizes Windows long-name/8.3 aliases and casing
 * without weakening containment to a textual approximation.
 * @param path - canonical target key, which may end in a missing suffix.
 * @param root - canonical writable root.
 * @param caseSensitive - whether lexical comparison preserves case; defaults
 *   to the host filesystem convention used by supported platforms.
 * @returns whether the target is the root or a descendant of it.
 */
export async function isPathUnder(path, root, caseSensitive = process.platform !== 'win32') {
    if (isLexicallyUnder(path, root, caseSensitive))
        return true;
    const rootInfo = await statIfPresent(root);
    if (!rootInfo)
        return false;
    let ancestor = path;
    while (true) {
        const ancestorInfo = await statIfPresent(ancestor);
        if (ancestorInfo && sameIdentity(ancestorInfo, rootInfo))
            return true;
        const parent = dirname(ancestor);
        if (parent === ancestor)
            return false;
        ancestor = parent;
    }
}
//# sourceMappingURL=containment.js.map