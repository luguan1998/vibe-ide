/**
 * Lazy koffi bindings for the Win32 ACL-sandbox backend. Koffi loads lazily so
 * non-Windows processes never open Win32 libraries. Every function signature
 * below was verified against the MinGW Windows headers on this machine
 * (winnt.h / accctrl.h / aclapi.h / securitybaseapi.h / sddl.h /
 * processthreadsapi.h / fileapi.h / namedpipeapi.h / synchapi.h / winbase.h);
 * struct layouts are asserted at load time against verify/abi-probe.cpp.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/ffi
 */
import koffi from 'koffi';
import { Win32Error } from "./errors.js";
import * as abi from "./win32-abi.js";
/**
 * True for NULL pointers, however koffi returns them (null or 0n).
 * @param value - a pointer as koffi may hand it back (pointer, null, or 0n).
 * @returns a type guard narrowing to the NULL shapes.
 */
export function isNullPtr(value) {
    return value === null || value === undefined || value === 0n;
}
/**
 * True for CreateFileW's INVALID_HANDLE_VALUE failure marker (-1, which
 * koffi hands back as the unsigned 64-bit all-ones pointer).
 * @param handle - the handle CreateFileW returned.
 * @returns whether the handle signals failure.
 */
export function isInvalidHandle(handle) {
    if (isNullPtr(handle))
        return true;
    return handle === 0xffffffffffffffffn || handle === -1n;
}
const PVOID = koffi.pointer('void');
const PPVOID = koffi.pointer(PVOID);
/** koffi STARTUPINFOW layout; its size is asserted against abi.STARTUPINFOW_SIZE at load. */
export const STARTUPINFOW = koffi.struct('STARTUPINFOW', {
    cb: 'uint32',
    lpReserved: 'str16',
    lpDesktop: 'str16',
    lpTitle: 'str16',
    dwX: 'uint32',
    dwY: 'uint32',
    dwXSize: 'uint32',
    dwYSize: 'uint32',
    dwXCountChars: 'uint32',
    dwYCountChars: 'uint32',
    dwFillAttribute: 'uint32',
    dwFlags: 'uint32',
    wShowWindow: 'uint16',
    cbReserved2: 'uint16',
    lpReserved2: koffi.pointer('uint8'),
    hStdInput: PVOID,
    hStdOutput: PVOID,
    hStdError: PVOID,
});
/** koffi PROCESS_INFORMATION layout; its size is asserted against abi.PROCESS_INFORMATION_SIZE at load. */
export const PROCESS_INFORMATION = koffi.struct('PROCESS_INFORMATION', {
    hProcess: PVOID,
    hThread: PVOID,
    dwProcessId: 'uint32',
    dwThreadId: 'uint32',
});
/* v8 ignore start -- layout-mismatch guards fire only on ABI breakage; verify/abi-probe.cpp pins both sizes. */
if (STARTUPINFOW.size !== abi.STARTUPINFOW_SIZE) {
    throw new Error(`STARTUPINFOW layout mismatch: koffi computed ${STARTUPINFOW.size}, header probe says ${abi.STARTUPINFOW_SIZE}`);
}
if (PROCESS_INFORMATION.size !== abi.PROCESS_INFORMATION_SIZE) {
    throw new Error(`PROCESS_INFORMATION layout mismatch: koffi computed ${PROCESS_INFORMATION.size}, header probe says ${abi.PROCESS_INFORMATION_SIZE}`);
}
/* v8 ignore stop */
/**
 * Allocate one pointer-sized slot (for `T **` out-parameters).
 * @returns the allocated slot pointer.
 */
export function allocPtrSlot() {
    const value = koffi.alloc(PVOID, 1);
    return value;
}
/**
 * Allocate one uint32 slot.
 * @returns the allocated slot pointer.
 */
export function allocUint32() {
    const value = koffi.alloc('uint32', 1);
    return value;
}
/**
 * Write a uint32 value into a slot pointer.
 * @param slot - the slot allocated by {@link allocUint32}.
 * @param value - the uint32 to encode.
 */
export function encodeUint32(slot, value) {
    koffi.encode(slot, 'uint32', value);
}
/**
 * Decode the pointer stored in a pointer-sized slot (NULL becomes null).
 * @param slot - the pointer-sized slot holding the out-parameter value.
 * @returns the decoded pointer, or null for NULL.
 */
export function decodePtr(slot) {
    const value = koffi.decode(slot, PVOID);
    if (isNullPtr(value))
        return null;
    return value;
}
/**
 * Decode a uint32 at a slot pointer.
 * @param slot - the uint32 slot holding the out-parameter value.
 * @returns the decoded uint32.
 */
export function decodeUint32(slot) {
    const value = koffi.decode(slot, 'uint32');
    return value;
}
/**
 * Cast a koffi pointer to its numeric address (bigint, used for raw struct packing).
 * @param ptr - the koffi pointer.
 * @returns the pointer's numeric address.
 */
export function ptrAddress(ptr) {
    return koffi.address(ptr);
}
/**
 * Allocate a raw byte block (used for SID copies and variable-length arrays).
 * @param length - the block size in bytes.
 * @returns the allocated block pointer.
 */
export function allocBytes(length) {
    const value = koffi.alloc('uint8', length);
    return value;
}
/**
 * Allocate one zeroed OVERLAPPED (32 bytes on x64: Internal@0, InternalHigh@8,
 * Offset@16, OffsetHigh@20, hEvent@24). LockFileEx/UnlockFileEx receive this
 * instead of a NULL lpOverlapped: koffi 3.1.1 crashes on NULL there, and a
 * zeroed OVERLAPPED on a synchronous file handle is the documented equivalent
 * (the byte range locks from offset 0, hEvent stays NULL).
 * @returns the zeroed block pointer.
 */
export function allocOverlapped() {
    return allocBytes(32);
}
/**
 * Decode a pointer VALUE stored in memory at `buffer[offset]` (e.g. TOKEN_GROUPS entries).
 * @param buffer - the buffer holding the pointer value.
 * @param offset - byte offset of the pointer inside the buffer.
 * @returns the decoded pointer, or null for NULL.
 */
export function decodePtrAt(buffer, offset) {
    const value = koffi.decode(buffer, offset, PVOID);
    if (isNullPtr(value))
        return null;
    return value;
}
/**
 * Decode a uint8 at a native pointer plus byte offset — the ACL walk's
 * field-read primitive (koffi.decode with an offset, no memcpy, no pointer
 * arithmetic).
 * @param ptr - the native pointer to read from.
 * @param offset - byte offset from the pointer.
 * @returns the decoded uint8.
 */
export function decodeUint8At(ptr, offset) {
    const value = koffi.decode(ptr, offset, 'uint8');
    return value;
}
/**
 * Decode a uint16 at a native pointer plus byte offset (see {@link decodeUint8At}).
 * @param ptr - the native pointer to read from.
 * @param offset - byte offset from the pointer.
 * @returns the decoded uint16.
 */
export function decodeUint16At(ptr, offset) {
    const value = koffi.decode(ptr, offset, 'uint16');
    return value;
}
/**
 * Decode a uint32 at a native pointer plus byte offset (see {@link decodeUint8At}).
 * @param ptr - the native pointer to read from.
 * @param offset - byte offset from the pointer.
 * @returns the decoded uint32.
 */
export function decodeUint32At(ptr, offset) {
    const value = koffi.decode(ptr, offset, 'uint32');
    return value;
}
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
export function sameSidAt(left, leftOffset, right, rightOffset) {
    const leftRevision = decodeUint8At(left, leftOffset);
    const rightRevision = decodeUint8At(right, rightOffset);
    if (leftRevision !== rightRevision)
        return false;
    const leftCount = decodeUint8At(left, leftOffset + 1);
    const rightCount = decodeUint8At(right, rightOffset + 1);
    if (leftCount !== rightCount || leftCount > abi.SID_MAX_SUB_AUTHORITIES)
        return false;
    for (let index = 0; index < 6; index++) {
        if (decodeUint8At(left, leftOffset + 2 + index) !== decodeUint8At(right, rightOffset + 2 + index))
            return false;
    }
    for (let index = 0; index < leftCount; index++) {
        if (decodeUint32At(left, leftOffset + 8 + index * 4) !== decodeUint32At(right, rightOffset + 8 + index * 4))
            return false;
    }
    return true;
}
/**
 * Allocate a zeroed STARTUPINFOW.
 * @returns the allocated struct pointer.
 */
export function allocStartupInfo() {
    const value = koffi.alloc(STARTUPINFOW, 1);
    return value;
}
/**
 * Write the stdio-relevant fields into a zeroed STARTUPINFOW (others stay default-initialized).
 * @param startupInfo - the allocated STARTUPINFOW to encode into.
 * @param fields - the field subset to write.
 */
export function encodeStartupInfo(startupInfo, fields) {
    koffi.encode(startupInfo, STARTUPINFOW, fields);
}
/**
 * Allocate a zeroed PROCESS_INFORMATION.
 * @returns the allocated struct pointer.
 */
export function allocProcessInfo() {
    const value = koffi.alloc(PROCESS_INFORMATION, 1);
    return value;
}
/**
 * Decode a PROCESS_INFORMATION after CreateProcessAsUserW.
 * @param processInfo - the PROCESS_INFORMATION filled by the spawn call.
 * @returns the decoded handle/id fields.
 */
export function decodeProcessInfo(processInfo) {
    const value = koffi.decode(processInfo, PROCESS_INFORMATION);
    return value;
}
let cached;
function bindings() {
    if (cached !== undefined)
        return cached;
    const kernel32 = koffi.load('kernel32.dll');
    const advapi32 = koffi.load('advapi32.dll');
    // Each binding shape is verified by verify/abi-probe.cpp against the real
    // Windows headers and exercised end-to-end by tests/probe.spec.ts; the
    // single cast keeps the per-binding noise out of this table.
    const bind = (lib, name, result, args) => lib.func('__stdcall', name, result, args);
    cached = {
        openProcess: bind(kernel32, 'OpenProcess', PVOID, ['uint32', 'int', 'uint32']),
        openProcessToken: bind(advapi32, 'OpenProcessToken', 'int', [PVOID, 'uint32', PPVOID]),
        closeHandle: bind(kernel32, 'CloseHandle', 'int', [PVOID]),
        getLastError: bind(kernel32, 'GetLastError', 'uint32', []),
        formatMessageW: bind(kernel32, 'FormatMessageW', 'uint32', ['uint32', PVOID, 'uint32', 'uint32', PVOID, 'uint32', PVOID]),
        localAlloc: bind(kernel32, 'LocalAlloc', PVOID, ['uint32', 'size_t']),
        localFree: bind(kernel32, 'LocalFree', PVOID, [PVOID]),
        convertStringSidToSidW: bind(advapi32, 'ConvertStringSidToSidW', 'int', ['str16', PPVOID]),
        createWellKnownSid: bind(advapi32, 'CreateWellKnownSid', 'int', ['int', PVOID, PVOID, koffi.pointer('uint32')]),
        isValidSid: bind(advapi32, 'IsValidSid', 'int', [PVOID]),
        getLengthSid: bind(advapi32, 'GetLengthSid', 'uint32', [PVOID]),
        copySid: bind(advapi32, 'CopySid', 'int', ['uint32', PVOID, PVOID]),
        getTokenInformation: bind(advapi32, 'GetTokenInformation', 'int', [PVOID, 'int', PVOID, 'uint32', koffi.pointer('uint32')]),
        setTokenInformation: bind(advapi32, 'SetTokenInformation', 'int', [PVOID, 'int', PVOID, 'uint32']),
        createRestrictedToken: bind(advapi32, 'CreateRestrictedToken', 'int', [PVOID, 'uint32', 'uint32', PVOID, 'uint32', PVOID, 'uint32', PVOID, PPVOID]),
        setEntriesInAclW: bind(advapi32, 'SetEntriesInAclW', 'uint32', ['uint32', PVOID, PVOID, PPVOID]),
        setNamedSecurityInfoW: bind(advapi32, 'SetNamedSecurityInfoW', 'uint32', ['str16', 'int', 'uint32', PVOID, PVOID, PVOID, PVOID]),
        getNamedSecurityInfoW: bind(advapi32, 'GetNamedSecurityInfoW', 'uint32', ['str16', 'int', 'uint32', PPVOID, PPVOID, PPVOID, PPVOID, PPVOID]),
        getTempPathW: bind(kernel32, 'GetTempPathW', 'uint32', ['uint32', PVOID]),
        // fileapi.h line ~64: HANDLE CreateFileW(LPCWSTR, DWORD, DWORD,
        // LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE).
        createFileW: bind(kernel32, 'CreateFileW', PVOID, ['str16', 'uint32', 'uint32', PVOID, 'uint32', 'uint32', PVOID]),
        // fileapi.h lines ~177/~185: BOOL LockFileEx(HANDLE, DWORD, DWORD, DWORD,
        // DWORD, LPOVERLAPPED); BOOL UnlockFileEx(HANDLE, DWORD, DWORD, DWORD,
        // LPOVERLAPPED). lpOverlapped is NULL for synchronous locking.
        lockFileEx: bind(kernel32, 'LockFileEx', 'int', [PVOID, 'uint32', 'uint32', 'uint32', 'uint32', PVOID]),
        unlockFileEx: bind(kernel32, 'UnlockFileEx', 'int', [PVOID, 'uint32', 'uint32', 'uint32', PVOID]),
        createPipe: bind(kernel32, 'CreatePipe', 'int', [PPVOID, PPVOID, PVOID, 'uint32']),
        setHandleInformation: bind(kernel32, 'SetHandleInformation', 'int', [PVOID, 'uint32', 'uint32']),
        createProcessAsUserW: bind(advapi32, 'CreateProcessAsUserW', 'int', [
            PVOID, 'str16', 'str16', PVOID, PVOID, 'int', 'uint32', PVOID, 'str16',
            koffi.pointer(STARTUPINFOW), koffi.pointer(PROCESS_INFORMATION),
        ]),
        setEnvironmentVariableW: bind(kernel32, 'SetEnvironmentVariableW', 'int', ['str16', 'str16']),
        readFile: bind(kernel32, 'ReadFile', 'int', [PVOID, PVOID, 'uint32', koffi.pointer('uint32'), PVOID]),
        peekNamedPipe: bind(kernel32, 'PeekNamedPipe', 'int', [PVOID, PVOID, 'uint32', koffi.pointer('uint32'), koffi.pointer('uint32'), koffi.pointer('uint32')]),
        waitForSingleObject: bind(kernel32, 'WaitForSingleObject', 'uint32', [PVOID, 'uint32']),
        getExitCodeProcess: bind(kernel32, 'GetExitCodeProcess', 'int', [PVOID, koffi.pointer('uint32')]),
        resumeThread: bind(kernel32, 'ResumeThread', 'uint32', [PVOID]),
        createJobObjectW: bind(kernel32, 'CreateJobObjectW', PVOID, [PVOID, 'str16']),
        setInformationJobObject: bind(kernel32, 'SetInformationJobObject', 'int', [PVOID, 'int', PVOID, 'uint32']),
        assignProcessToJobObject: bind(kernel32, 'AssignProcessToJobObject', 'int', [PVOID, PVOID]),
        terminateProcess: bind(kernel32, 'TerminateProcess', 'int', [PVOID, 'uint32']),
        setConsoleCtrlHandler: bind(kernel32, 'SetConsoleCtrlHandler', 'int', [PVOID, 'int']),
        getStdHandle: bind(kernel32, 'GetStdHandle', PVOID, ['int']),
    };
    return cached;
}
/**
 * Resolve the lazy Win32 bindings (throws the first binding failure, fail-closed).
 * @returns the cached binding table.
 */
export function win32() {
    return Promise.resolve(bindings());
}
/**
 * Resolve the lazy Win32 bindings SYNCHRONOUSLY — the sandbox seam's
 * server-side per-session grant materializes ACEs inside the synchronous
 * `confine()` call, which cannot await. Same cached table as {@link win32}
 * (the underlying koffi loads are synchronous; the async wrapper exists for
 * the runner's await-shaped call sites).
 * @returns the cached binding table.
 */
export function win32Sync() {
    return bindings();
}
/**
 * Turn a Win32 error code into readable text via FormatMessageW.
 * @param api - the binding table.
 * @param win32Code - the error code to format.
 * @returns the formatted message text, or '' when formatting fails.
 */
export function errorText(api, win32Code) {
    const buffer = Buffer.alloc(1024);
    const length = api.formatMessageW(abi.FORMAT_MESSAGE_FROM_SYSTEM | abi.FORMAT_MESSAGE_IGNORE_INSERTS, null, win32Code, 0, buffer, buffer.length / 2, null);
    if (length === 0)
        return '';
    return buffer.subarray(0, length * 2).toString('utf16le').trim();
}
/**
 * Read the process temp directory via GetTempPathW (fileapi.h line ~188).
 * Defensive against an overlong system temp path: GetTempPathW reports the
 * REQUIRED length (including NUL) without writing the buffer when it is too
 * small, so a reported length beyond the buffer's capacity means the buffer
 * was never filled and must not be decoded.
 * @param api - the binding table.
 * @returns the NUL-terminated temp path decoded as a string.
 */
export function getTempPath(api) {
    const buffer = Buffer.alloc((abi.MAX_PATH + 1) * 2);
    const length = api.getTempPathW(buffer.length / 2, buffer);
    if (length === 0)
        throwLastError(api, 'GetTempPathW');
    if (length > buffer.length / 2) {
        throw new Win32Error('GetTempPathW', abi.ERROR_INSUFFICIENT_BUFFER, `required ${length} chars exceed the ${buffer.length / 2}-char buffer; nothing was written`);
    }
    return buffer.subarray(0, length * 2).toString('utf16le');
}
/**
 * Throw a Win32Error for a BOOL-style API failure. MUST be called immediately
 * after the failed call so GetLastError is not clobbered by other Win32 calls.
 * @param api - the binding table.
 * @param name - the failed API's name for the error message.
 * @param detail - optional detail overriding the formatted system message.
 * @returns never — always throws.
 */
export function throwLastError(api, name, detail) {
    const win32Code = api.getLastError();
    throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
/**
 * Throw a Win32Error for an HRESULT-style API return value (the value IS the error code).
 * @param api - the binding table.
 * @param name - the failed API's name for the error message.
 * @param win32Code - the API's returned error code.
 * @param detail - optional detail overriding the formatted system message.
 * @returns never — always throws.
 */
export function throwWin32(api, name, win32Code, detail) {
    throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
//# sourceMappingURL=ffi.js.map