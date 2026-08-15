/**
 * Windows ACL write-restriction sandbox backend for the DeepSeek Harness
 * sandbox seam. Mirrors the mechanism of github.com/huoyaoyuan/
 * windows-acl-restrict-poc @ 10e4dfb (the fixed revision): a WRITE_RESTRICTED
 * token whose restricting SIDs include distinct workspace and temp write
 * SIDs that this sandbox adds to their owning directories' DACLs — the
 * intersection check then allows writes exactly where either capability has
 * a Write ACE, and nowhere else those SIDs are concerned (the check ALSO
 * inherits the ambient write ACEs of the other restricting SIDs — the
 * keep-alive group logon SID + Everyone; Authenticated Users, INTERACTIVE,
 * and LOCAL are absent from both lists — see the seam's dual-list contract
 * in `packages/sandbox/sandbox-local` and the package README's Modes section
 * for the complete boundary). The write SID is the per-WORKSPACE identity
 * ({@link workspaceWriteSid}): deterministic from the canonical workspace
 * path, so the workspace-root ACE materializes once per workspace per
 * machine and every later provision hits the exact-ACE skip — the
 * grant-reuse story the per-session random SID paid a full tree propagation
 * per session for. Each private temp directory instead receives its own SID,
 * so sibling sessions sharing a workspace cannot enter one another's temp
 * trees. Unlike the POC, every API failure throws with the API
 * name and exact Win32 code; a child is NEVER spawned unrestricted.
 *
 * Known boundaries (inherent to restricted tokens, not this port):
 *  - writes are restricted; reads, network, and process visibility are NOT
 *    (WRITE_RESTRICTED intersects only write accesses);
 *  - console isolation is unavailable — children share the host console
 *    (CREATE_NO_WINDOW / CREATE_NEW_CONSOLE children die with
 *    STATUS_DLL_INIT_FAILED under the restriction);
 *  - the private temp directory and every writable directory must be owned by the
 *    caller (owner-implicit WRITE_DAC);
 *  - grants are standing ACE mutations on real directories. WORKSPACE grants
 *    are deliberately never revoked — the ACE is the cross-session reuse
 *    cache (revoking would force the next session to re-propagate the whole
 *    tree). TEMP grants are revocable: dispose() removes them so a standing
 *    inheritable ACE never outlives its session's temp directory. The
 *    ambient temp root is never granted implicitly. With `manageDacls: false`
 *    the CALLER owns the DACLs (the sandbox seam's grant reuse):
 *    init()/dispose() skip grant/revoke entirely and the caller must not
 *    revoke under live children.
 * @module @deepseek-ai/dsh-sandbox-windows-acl
 */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { grantWrite, revokeWrite } from "./acl.js";
import { Win32Error } from "./errors.js";
import { allocPtrSlot, decodePtr, isNullPtr, throwLastError, win32 } from "./ffi.js";
import { assertPrivateTempDisjoint } from "./path-boundary.js";
import { drainPipe, spawnSandboxed, spawnSandboxedInherited, waitForExit } from "./spawn.js";
import { createRestrictedToken, findLogonSid, makeWellKnownSid, openCurrentProcessToken, setTokenDefaultDaclGrant } from "./token.js";
import * as abi from "./win32-abi.js";
export { quoteArg } from "./spawn.js";
export { AclWriteGrant } from "./grant.js";
export { assertTempRootOutsideWorkspace } from "./path-boundary.js";
export { tempWriteSid, workspaceWriteSid } from "./workspace-sid.js";
export { Win32Error } from "./errors.js";
/** Free one optional SID while retaining a failure for best-effort sibling cleanup. */
function freeSidBestEffort(api, sidPtr, label, failures) {
    if (sidPtr === undefined)
        return;
    try {
        const freed = api.localFree(sidPtr);
        if (!isNullPtr(freed))
            throwLastError(api, 'LocalFree', label);
    }
    catch (error) {
        failures.push(error);
    }
}
/**
 * One write-restricted sandbox instance: token + write-SID grants + spawn.
 * `init()` is fail-closed — any Win32 failure revokes the revocable (temp)
 * grants and throws; `dispose()` revokes the temp grants, leaves the
 * standing workspace ACEs in place (the cross-instance reuse cache), frees
 * every allocation, and reports every cleanup failure. With
 * `manageDacls: false` the caller owns the grants (the sandbox seam's grant
 * reuse): init() applies none and dispose() revokes none.
 */
export class AclSandbox {
    /** Absolute writable directories (constructor-validated). */
    writableDirs;
    /** The workspace SID string whose ACEs form the workspace allowlist. */
    writeSid;
    /** The private temp directory's write SID (workspace-write with temp only). */
    tempWriteSid;
    /** The file-effect mode — the restricted token's restricting-SID list selection. */
    mode;
    tempDirOption;
    manageDacls;
    tempDirResolved;
    api;
    token;
    writeSidPtr;
    tempWriteSidPtr;
    /** The well-known/logon SID allocations init() makes; freed by dispose() alongside the write SIDs. */
    sidAllocations = [];
    grantedPaths = [];
    constructor(options) {
        this.mode = options.mode;
        this.manageDacls = options.manageDacls ?? true;
        this.writableDirs = options.writableDirs.map((directory) => {
            const absolute = resolve(directory);
            if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
                throw new Error(`AclSandbox writable dir does not exist or is not a directory: ${absolute}`);
            }
            return absolute;
        });
        this.tempDirOption = options.tempDir;
        this.writeSid = options.writeSid;
        this.tempWriteSid = options.tempWriteSid;
        if (this.mode === 'workspace-write' && this.writeSid === undefined) {
            throw new Error('AclSandbox workspace-write requires a write SID — derive it from the workspace via workspaceWriteSid()');
        }
        if (this.mode === 'workspace-write' && this.tempDirOption === undefined) {
            throw new Error('AclSandbox workspace-write requires an explicit private temp directory or null');
        }
        if (this.mode === 'read-only' && this.tempDirOption !== undefined && this.tempDirOption !== null) {
            throw new Error('AclSandbox read-only does not accept a temp directory');
        }
        if (this.mode === 'read-only' && (this.writeSid !== undefined || this.tempWriteSid !== undefined)) {
            throw new Error('AclSandbox read-only does not accept write SIDs');
        }
        if (this.mode === 'workspace-write' && this.tempDirOption !== null && this.tempWriteSid === undefined) {
            throw new Error('AclSandbox workspace-write with temp requires a temp write SID — derive it via tempWriteSid()');
        }
        if (this.tempDirOption === null && this.tempWriteSid !== undefined) {
            throw new Error('AclSandbox temp write SID requires a temp directory');
        }
        if (this.writeSid !== undefined && this.tempWriteSid === this.writeSid) {
            throw new Error('AclSandbox workspace and temp write SIDs must be distinct');
        }
    }
    /** Resolved temp directory (available after init; null when temp grants are disabled). */
    get tempDir() {
        return this.tempDirResolved;
    }
    /** Create the restricted token and apply the capability-SID grants. Idempotent-unsafe: once per instance. */
    async init() {
        if (this.api !== undefined)
            throw new Error('AclSandbox is already initialized');
        const api = await win32();
        const currentToken = openCurrentProcessToken(api);
        let currentTokenOpen = true;
        let restrictedToken;
        try {
            const parseSid = (sid) => {
                const sidSlot = allocPtrSlot();
                if (api.convertStringSidToSidW(sid, sidSlot) === 0) {
                    throwLastError(api, 'ConvertStringSidToSidW', sid);
                }
                const parsedSid = decodePtr(sidSlot);
                if (parsedSid === null)
                    throw new Win32Error('ConvertStringSidToSidW', api.getLastError(), sid);
                return parsedSid;
            };
            this.writeSidPtr = this.writeSid === undefined ? undefined : parseSid(this.writeSid);
            this.tempWriteSidPtr = this.tempWriteSid === undefined ? undefined : parseSid(this.tempWriteSid);
            const tempDir = this.mode === 'read-only' || this.tempDirOption === null ? null : this.tempDirOption;
            /* v8 ignore next -- constructor validation requires workspace-write to supply
               an explicit temp directory or null; the other branches normalize to null. */
            if (tempDir === undefined)
                throw new Error('AclSandbox workspace-write temp directory was not resolved');
            if (tempDir !== null) {
                if (!existsSync(tempDir) || !statSync(tempDir).isDirectory()) {
                    throw new Error(`AclSandbox temp dir does not exist or is not a directory: ${tempDir}`);
                }
                assertPrivateTempDisjoint(this.writableDirs, tempDir);
            }
            this.tempDirResolved = tempDir;
            // manageDacls: false — the caller (the sandbox seam's grant) already
            // materialized the ACEs; this instance must neither add nor remove any.
            // When this instance owns the DACLs, writableDir ACEs are STANDING (the
            // per-workspace reuse cache — dispose() never revokes them, or the next
            // provision would re-propagate the whole tree) and the temp ACE is
            // REVOCABLE (dispose() removes it before the private directory is
            // deleted; the ambient temp root is never granted).
            if (this.manageDacls) {
                if (this.writeSidPtr !== undefined) {
                    for (const path of this.writableDirs) {
                        grantWrite(api, path, this.writeSidPtr);
                    }
                    if (tempDir !== null && this.tempWriteSidPtr !== undefined) {
                        // Record BEFORE granting: grantWrite can throw after a successful
                        // apply (a LocalFree failure), and the fail-closed catch must still
                        // revoke that path (revoking an ungranted path is a no-op merge).
                        this.grantedPaths.push({ path: tempDir, sidPtr: this.tempWriteSidPtr });
                        grantWrite(api, tempDir, this.tempWriteSidPtr);
                    }
                }
            }
            const logonSid = findLogonSid(api, currentToken);
            this.sidAllocations.push(logonSid);
            const worldSid = makeWellKnownSid(api, abi.WinWorldSid);
            this.sidAllocations.push(worldSid);
            const writeSids = [this.writeSidPtr, this.tempWriteSidPtr].filter((sid) => sid !== undefined);
            restrictedToken = createRestrictedToken(api, currentToken, logonSid, writeSids, { world: worldSid }, this.mode);
            this.token = restrictedToken;
            // The restricted token's default DACL still names only the user's
            // ambient SIDs — none of the restricting SIDs. Every NEW object the
            // confined process creates (anonymous stdio pipes, sync objects) takes
            // its DACL from that default, so the write pass-2 check would deny
            // pipe creation (ERROR_ACCESS_DENIED; Node EPERM) and break every
            // piped-stdio grandchild spawn. Merge a full-access ACE for a
            // restricting SID (the PRIVATE temp SID when present, otherwise the
            // workspace SID, or Everyone under read-only): new-object creation
            // stays gated by the parent object's DACL, while the new object's own
            // DACL passes pass-2. Choosing the temp SID prevents default-DACL
            // objects in one session's temp tree from acquiring the shared
            // workspace capability.
            setTokenDefaultDaclGrant(api, restrictedToken, this.tempWriteSidPtr ?? this.writeSidPtr ?? worldSid);
            if (api.closeHandle(currentToken) === 0)
                throwLastError(api, 'CloseHandle', 'current process token');
            currentTokenOpen = false;
            this.api = api;
        }
        catch (error) {
            // Fail-closed cleanup: never leave a revocable (temp) grant or SID
            // allocation behind a failed init. Standing workspace ACEs are NOT
            // revoked — they are the intended end state (the reuse cache), not an
            // error artifact.
            const cleanupFailures = [];
            if (currentTokenOpen && api.closeHandle(currentToken) === 0) {
                cleanupFailures.push(new Win32Error('CloseHandle', api.getLastError(), 'current process token after init failure'));
            }
            if (restrictedToken !== undefined && api.closeHandle(restrictedToken) === 0) {
                cleanupFailures.push(new Win32Error('CloseHandle', api.getLastError(), 'restricted token after init failure'));
            }
            for (const grant of this.grantedPaths) {
                try {
                    revokeWrite(api, grant.path, grant.sidPtr);
                }
                catch (cleanupError) {
                    cleanupFailures.push(cleanupError);
                }
            }
            for (const [label, sidPtr] of [['workspace write SID', this.writeSidPtr], ['temp write SID', this.tempWriteSidPtr]]) {
                freeSidBestEffort(api, sidPtr, label, cleanupFailures);
            }
            for (const sidPtr of this.sidAllocations.splice(0)) {
                freeSidBestEffort(api, sidPtr, 'init SID allocation', cleanupFailures);
            }
            this.token = undefined;
            this.writeSidPtr = undefined;
            this.tempWriteSidPtr = undefined;
            this.tempDirResolved = undefined;
            this.grantedPaths = [];
            if (cleanupFailures.length > 0) {
                throw new AggregateError([error, ...cleanupFailures], `AclSandbox init failed and ${cleanupFailures.length} cleanup operation(s) also failed`);
            }
            throw error;
        }
    }
    /**
     * Spawn a process under the restricted token. Fails closed: throws on every
     * Win32 failure; the child is never created unrestricted. With
     * `stdio: 'inherit'` the child shares the caller's stdio directly and is
     * placed in a kill-on-close job (dies with the caller). Call dispose() only
     * after all children have exited — revoking grants under a live child
     * removes its remaining write allowance.
     * @param options - the program, argv/cwd, and stdio shape.
     * @returns the running child.
     */
    spawn(options) {
        const api = this.api;
        const token = this.token;
        if (api === undefined || token === undefined)
            throw new Error('AclSandbox is not initialized: call init() first');
        const args = options.args ?? [];
        const cwd = options.cwd ?? process.cwd();
        if (options.stdio === 'inherit') {
            const native = spawnSandboxedInherited(api, token, { command: options.command, args, cwd });
            let exitCodePromise;
            return {
                pid: native.pid,
                wait: async () => {
                    exitCodePromise ??= Promise.resolve(waitForExit(api, native.process));
                    const exitCode = await exitCodePromise;
                    if (api.closeHandle(native.job) === 0)
                        throwLastError(api, 'CloseHandle', 'kill-on-close job');
                    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode };
                },
            };
        }
        const native = spawnSandboxed(api, token, { command: options.command, args, cwd });
        const stdout = drainPipe(api, native.stdoutRead);
        const stderr = drainPipe(api, native.stderrRead);
        // waitForExit is deliberately NOT started here: WaitForSingleObject blocks
        // the thread and would starve the drains while the child is still running
        // (pipe-buffer deadlock). The drains resolve only after the child closed
        // its pipe ends — by then the wait returns immediately.
        let exitCodePromise;
        return {
            pid: native.pid,
            wait: async () => {
                const stdoutBuffer = await stdout;
                const stderrBuffer = await stderr;
                exitCodePromise ??= Promise.resolve(waitForExit(api, native.process));
                return { stdout: stdoutBuffer, stderr: stderrBuffer, exitCode: await exitCodePromise };
            },
        };
    }
    /**
     * Revoke the revocable (temp) grants, free the SID, close the token; the
     * standing workspace ACEs stay (the reuse cache). Reports every cleanup
     * failure.
     */
    dispose() {
        const api = this.api;
        if (api === undefined)
            return;
        const failures = [];
        if (this.manageDacls) {
            for (const grant of this.grantedPaths) {
                try {
                    revokeWrite(api, grant.path, grant.sidPtr);
                }
                catch (error) {
                    failures.push(error);
                }
            }
        }
        for (const [label, sidPtr] of [['workspace write SID', this.writeSidPtr], ['temp write SID', this.tempWriteSidPtr]]) {
            freeSidBestEffort(api, sidPtr, label, failures);
        }
        const token = this.token;
        /* v8 ignore next -- init assigns this.api only after this.token, so an initialized instance always
           has its token; the guard mirrors the write-SID guard. */
        if (token !== undefined) {
            try {
                if (api.closeHandle(token) === 0)
                    throwLastError(api, 'CloseHandle', 'restricted token');
            }
            catch (error) {
                failures.push(error);
            }
        }
        for (const sidPtr of this.sidAllocations.splice(0)) {
            freeSidBestEffort(api, sidPtr, 'init SID allocation', failures);
        }
        this.api = undefined;
        this.token = undefined;
        this.writeSidPtr = undefined;
        this.tempWriteSidPtr = undefined;
        this.grantedPaths = [];
        if (failures.length > 0) {
            throw new AggregateError(failures, `AclSandbox dispose completed with ${failures.length} cleanup failure(s)`);
        }
    }
}
//# sourceMappingURL=index.js.map