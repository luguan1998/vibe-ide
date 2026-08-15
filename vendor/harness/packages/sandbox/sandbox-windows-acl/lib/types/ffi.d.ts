/**
 * Lazy koffi bindings for the Win32 ACL-sandbox backend. Koffi loads lazily so
 * non-Windows processes never open Win32 libraries. Every function signature
 * below was verified against the MinGW Windows headers on this machine
 * (winnt.h / accctrl.h / aclapi.h / securitybaseapi.h / sddl.h /
 * processthreadsapi.h / fileapi.h / namedpipeapi.h / synchapi.h / winbase.h);
 * struct layouts are asserted at load time against verify/abi-probe.cpp.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/ffi
 */
/** Branded koffi 3 native pointer. Koffi 3 pointers are BigInt values; the brand keeps them out of numeric contexts. */
declare const nativePtr: unique symbol;
/** Koffi 3 native pointer (a BigInt address), branded so it cannot silently enter numeric contexts. */
export type NativePtr = bigint & {
    readonly [nativePtr]: true;
};
/**
 * True for NULL pointers, however koffi returns them (null or 0n).
 * @param value - a pointer as koffi may hand it back (pointer, null, or 0n).
 * @returns a type guard narrowing to the NULL shapes.
 */
export declare function isNullPtr(value: NativePtr | null | undefined): value is null | undefined;
/**
 * True for CreateFileW's INVALID_HANDLE_VALUE failure marker (-1, which
 * koffi hands back as the unsigned 64-bit all-ones pointer).
 * @param handle - the handle CreateFileW returned.
 * @returns whether the handle signals failure.
 */
export declare function isInvalidHandle(handle: NativePtr | null | undefined): boolean;
/** Field subset written into a zeroed STARTUPINFOW (layout verified: size 104). */
export interface StartupInfoInput {
    cb: number;
    dwFlags: number;
    hStdInput: NativePtr;
    hStdOutput: NativePtr;
    hStdError: NativePtr;
}
/** Decoded PROCESS_INFORMATION (layout verified: size 24). */
export interface ProcessInfoOutput {
    hProcess: NativePtr | null;
    hThread: NativePtr | null;
    dwProcessId: number;
    dwThreadId: number;
}
/** The lazy koffi binding table: every Win32 call the ACL backend uses, signature-verified against the real headers. */
export interface Win32Bindings {
    openProcess(desiredAccess: number, inheritHandle: number, pid: number): NativePtr;
    openProcessToken(process: NativePtr, desiredAccess: number, tokenHandle: NativePtr): number;
    closeHandle(handle: NativePtr): number;
    getLastError(): number;
    formatMessageW(flags: number, source: null, messageId: number, languageId: number, buffer: Buffer, size: number, args: null): number;
    localAlloc(flags: number, bytes: number): NativePtr;
    localFree(memory: NativePtr): NativePtr;
    convertStringSidToSidW(stringSid: string, sid: NativePtr): number;
    createWellKnownSid(type: number, domainSid: null, sid: NativePtr, size: NativePtr): number;
    isValidSid(sid: NativePtr): number;
    getLengthSid(sid: NativePtr): number;
    copySid(length: number, destination: NativePtr, source: NativePtr): number;
    getTokenInformation(token: NativePtr, cls: number, info: Buffer | null, length: number, needed: NativePtr): number;
    setTokenInformation(token: NativePtr, cls: number, info: Buffer, length: number): number;
    createRestrictedToken(existing: NativePtr, flags: number, disableCount: number, disableSids: null, deletePrivilegeCount: number, privilegesToDelete: null, restrictCount: number, restrictingSids: Buffer, newToken: NativePtr): number;
    setEntriesInAclW(count: number, entries: Buffer, oldAcl: NativePtr | null, newAcl: NativePtr): number;
    setNamedSecurityInfoW(path: string, objectType: number, information: number, owner: null, group: null, dacl: NativePtr | null, sacl: null): number;
    getNamedSecurityInfoW(path: string, objectType: number, information: number, owner: NativePtr, group: NativePtr, dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr): number;
    getTempPathW(length: number, buffer: Buffer): number;
    createFileW(fileName: string, desiredAccess: number, shareMode: number, attributes: null, creationDisposition: number, flagsAndAttributes: number, templateFile: null): NativePtr;
    lockFileEx(file: NativePtr, flags: number, reserved: number, bytesLow: number, bytesHigh: number, overlapped: NativePtr): number;
    unlockFileEx(file: NativePtr, reserved: number, bytesLow: number, bytesHigh: number, overlapped: NativePtr): number;
    createPipe(readHandle: NativePtr, writeHandle: NativePtr, attributes: null, size: number): number;
    setHandleInformation(handle: NativePtr, mask: number, flags: number): number;
    createProcessAsUserW(token: NativePtr, applicationName: null, commandLine: string, processAttributes: null, threadAttributes: null, inheritHandles: number, creationFlags: number, environment: null, currentDirectory: string | null, startupInfo: NativePtr, processInfo: NativePtr): number;
    setEnvironmentVariableW(name: string, value: string): number;
    readFile(file: NativePtr, buffer: Buffer, count: number, bytesRead: NativePtr, overlapped: null): number;
    peekNamedPipe(pipe: NativePtr, buffer: null, size: number, bytesRead: NativePtr, totalAvail: NativePtr, leftThisMessage: NativePtr): number;
    waitForSingleObject(handle: NativePtr, milliseconds: number): number;
    getExitCodeProcess(process: NativePtr, exitCode: NativePtr): number;
    resumeThread(thread: NativePtr): number;
    createJobObjectW(attributes: null, name: null): NativePtr;
    setInformationJobObject(job: NativePtr, cls: number, information: Buffer, length: number): number;
    assignProcessToJobObject(job: NativePtr, process: NativePtr): number;
    terminateProcess(process: NativePtr, exitCode: number): number;
    setConsoleCtrlHandler(handler: null, add: number): number;
    getStdHandle(stdHandle: number): NativePtr;
}
/** koffi STARTUPINFOW layout; its size is asserted against abi.STARTUPINFOW_SIZE at load. */
export declare const STARTUPINFOW: import("koffi").TypeObject;
/** koffi PROCESS_INFORMATION layout; its size is asserted against abi.PROCESS_INFORMATION_SIZE at load. */
export declare const PROCESS_INFORMATION: import("koffi").TypeObject;
/**
 * Allocate one pointer-sized slot (for `T **` out-parameters).
 * @returns the allocated slot pointer.
 */
export declare function allocPtrSlot(): NativePtr;
/**
 * Allocate one uint32 slot.
 * @returns the allocated slot pointer.
 */
export declare function allocUint32(): NativePtr;
/**
 * Write a uint32 value into a slot pointer.
 * @param slot - the slot allocated by {@link allocUint32}.
 * @param value - the uint32 to encode.
 */
export declare function encodeUint32(slot: NativePtr, value: number): void;
/**
 * Decode the pointer stored in a pointer-sized slot (NULL becomes null).
 * @param slot - the pointer-sized slot holding the out-parameter value.
 * @returns the decoded pointer, or null for NULL.
 */
export declare function decodePtr(slot: NativePtr): NativePtr | null;
/**
 * Decode a uint32 at a slot pointer.
 * @param slot - the uint32 slot holding the out-parameter value.
 * @returns the decoded uint32.
 */
export declare function decodeUint32(slot: NativePtr): number;
/**
 * Cast a koffi pointer to its numeric address (bigint, used for raw struct packing).
 * @param ptr - the koffi pointer.
 * @returns the pointer's numeric address.
 */
export declare function ptrAddress(ptr: NativePtr): bigint;
/**
 * Allocate a raw byte block (used for SID copies and variable-length arrays).
 * @param length - the block size in bytes.
 * @returns the allocated block pointer.
 */
export declare function allocBytes(length: number): NativePtr;
/**
 * Allocate one zeroed OVERLAPPED (32 bytes on x64: Internal@0, InternalHigh@8,
 * Offset@16, OffsetHigh@20, hEvent@24). LockFileEx/UnlockFileEx receive this
 * instead of a NULL lpOverlapped: koffi 3.1.1 crashes on NULL there, and a
 * zeroed OVERLAPPED on a synchronous file handle is the documented equivalent
 * (the byte range locks from offset 0, hEvent stays NULL).
 * @returns the zeroed block pointer.
 */
export declare function allocOverlapped(): NativePtr;
/**
 * Decode a pointer VALUE stored in memory at `buffer[offset]` (e.g. TOKEN_GROUPS entries).
 * @param buffer - the buffer holding the pointer value.
 * @param offset - byte offset of the pointer inside the buffer.
 * @returns the decoded pointer, or null for NULL.
 */
export declare function decodePtrAt(buffer: Buffer, offset: number): NativePtr | null;
/**
 * Decode a uint8 at a native pointer plus byte offset — the ACL walk's
 * field-read primitive (koffi.decode with an offset, no memcpy, no pointer
 * arithmetic).
 * @param ptr - the native pointer to read from.
 * @param offset - byte offset from the pointer.
 * @returns the decoded uint8.
 */
export declare function decodeUint8At(ptr: NativePtr, offset: number): number;
/**
 * Decode a uint16 at a native pointer plus byte offset (see {@link decodeUint8At}).
 * @param ptr - the native pointer to read from.
 * @param offset - byte offset from the pointer.
 * @returns the decoded uint16.
 */
export declare function decodeUint16At(ptr: NativePtr, offset: number): number;
/**
 * Decode a uint32 at a native pointer plus byte offset (see {@link decodeUint8At}).
 * @param ptr - the native pointer to read from.
 * @param offset - byte offset from the pointer.
 * @returns the decoded uint32.
 */
export declare function decodeUint32At(ptr: NativePtr, offset: number): number;
/**
 * Compare two SIDs field-by-field via BOUNDED offset reads (revision, count,
 * identifier authority, subauthorities up to the count) — never a fixed-size
 * struct decode, which would read past a short SID allocation (a SID with
 * fewer than 8 subauthorities is smaller than `SID_STRUCT`). An implausible
 * subauthority count reads as unequal.
 * @param left - pointer to one SID (offset 0).
 * @param leftOffset - byte offset of the SID structure within `left`.
 * @param right - pointer to the other SID.
 * @param rightOffset - byte offset of the SID structure within `right`.
 * @returns whether the SIDs are identical.
 */
export declare function sameSidAt(left: NativePtr, leftOffset: number, right: NativePtr, rightOffset: number): boolean;
/**
 * Allocate a zeroed STARTUPINFOW.
 * @returns the allocated struct pointer.
 */
export declare function allocStartupInfo(): NativePtr;
/**
 * Write the stdio-relevant fields into a zeroed STARTUPINFOW (others stay default-initialized).
 * @param startupInfo - the allocated STARTUPINFOW to encode into.
 * @param fields - the field subset to write.
 */
export declare function encodeStartupInfo(startupInfo: NativePtr, fields: StartupInfoInput): void;
/**
 * Allocate a zeroed PROCESS_INFORMATION.
 * @returns the allocated struct pointer.
 */
export declare function allocProcessInfo(): NativePtr;
/**
 * Decode a PROCESS_INFORMATION after CreateProcessAsUserW.
 * @param processInfo - the PROCESS_INFORMATION filled by the spawn call.
 * @returns the decoded handle/id fields.
 */
export declare function decodeProcessInfo(processInfo: NativePtr): ProcessInfoOutput;
/**
 * Resolve the lazy Win32 bindings (throws the first binding failure, fail-closed).
 * @returns the cached binding table.
 */
export declare function win32(): Promise<Win32Bindings>;
/**
 * Resolve the lazy Win32 bindings SYNCHRONOUSLY — the sandbox seam's
 * server-side per-session grant materializes ACEs inside the synchronous
 * `confine()` call, which cannot await. Same cached table as {@link win32}
 * (the underlying koffi loads are synchronous; the async wrapper exists for
 * the runner's await-shaped call sites).
 * @returns the cached binding table.
 */
export declare function win32Sync(): Win32Bindings;
/**
 * Turn a Win32 error code into readable text via FormatMessageW.
 * @param api - the binding table.
 * @param win32Code - the error code to format.
 * @returns the formatted message text, or '' when formatting fails.
 */
export declare function errorText(api: Win32Bindings, win32Code: number): string;
/**
 * Read the process temp directory via GetTempPathW (fileapi.h line ~188).
 * Defensive against an overlong system temp path: GetTempPathW reports the
 * REQUIRED length (including NUL) without writing the buffer when it is too
 * small, so a reported length beyond the buffer's capacity means the buffer
 * was never filled and must not be decoded.
 * @param api - the binding table.
 * @returns the NUL-terminated temp path decoded as a string.
 */
export declare function getTempPath(api: Win32Bindings): string;
/**
 * Throw a Win32Error for a BOOL-style API failure. MUST be called immediately
 * after the failed call so GetLastError is not clobbered by other Win32 calls.
 * @param api - the binding table.
 * @param name - the failed API's name for the error message.
 * @param detail - optional detail overriding the formatted system message.
 * @returns never — always throws.
 */
export declare function throwLastError(api: Win32Bindings, name: string, detail?: string): never;
/**
 * Throw a Win32Error for an HRESULT-style API return value (the value IS the error code).
 * @param api - the binding table.
 * @param name - the failed API's name for the error message.
 * @param win32Code - the API's returned error code.
 * @param detail - optional detail overriding the formatted system message.
 * @returns never — always throws.
 */
export declare function throwWin32(api: Win32Bindings, name: string, win32Code: number, detail?: string): never;
export {};
//# sourceMappingURL=ffi.d.ts.map