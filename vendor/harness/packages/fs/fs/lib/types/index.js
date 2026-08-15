/**
 * Filesystem Service Definition for one execution world. Backends own stable target
 * identity, process paths and file URIs, containment, text reads, decoding,
 * binary rejection, and atomic mutations. Read windows and
 * observed-state policy stay in consumer and policy plugins; `editText`
 * remains here so version check, literal match, and rewrite share one critical
 * section.
 * @module @deepseek-ai/dsh-fs
 */
import { Service } from '@deepseek-ai/cordis';
export { FsError, FsTargetKey, FsVersion, } from "./types.js";
/**
 * Abstract filesystem provider. Targets must preserve identity across aliases;
 * reads expose regular UTF-8 text or typed errors, listings are stable and
 * content-free, and mutations are atomic. Optional guards add stale protection
 * without changing the unguarded provider contract.
 */
export class FileSystem extends Service {
    constructor(ctx) {
        super(ctx, 'fs');
    }
    /**
     * The sandbox mode this backend enforces on mutations BY DEFAULT, or
     * `undefined` when it does not confine at all — the capability fact the tool
     * layer reads to advertise the escalation fields honestly (mirrors
     * `ShellExecutor.sandboxMode`). The base class and the bare local backend
     * report `undefined`; a sandboxing backend (`@deepseek-ai/dsh-fs-sandbox`)
     * overrides it with the deployment default. A session override may make the
     * effective mode narrower or wider, so strict escalation widening is checked
     * per call rather than encoded in this default-relative fact.
     * @returns the configured default mode of a sandboxing backend; `undefined`
     *   for a backend that never confines.
     */
    get sandboxMode() {
        return undefined;
    }
}
export default FileSystem;
//# sourceMappingURL=index.js.map