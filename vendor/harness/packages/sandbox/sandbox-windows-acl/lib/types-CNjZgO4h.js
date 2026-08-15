import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import koffi from "koffi";
//#region lib/types/errors.js
/**
* Fail-closed Win32 error type. Every backend API failure raises this with the
* API name and the exact Win32 code; the original POC silently ignored every
* failed call and would run children UNRESTRICTED (fail-open) — that is the
* failure mode this class exists to prevent.
* @module @deepseek-ai/dsh-sandbox-windows-acl/errors
*/
var Win32Error = class extends Error {
	/** The failing Win32 API name, e.g. `CreateRestrictedToken`. */
	api;
	/** The Win32 error code (`GetLastError` for BOOL APIs, the HRESULT-style return for ACL APIs). */
	win32Code;
	constructor(api, win32Code, detail) {
		super(`${api} failed (Win32 ${win32Code})${detail === void 0 ? "" : `: ${detail}`}`);
		this.name = "Win32Error";
		this.api = api;
		this.win32Code = win32Code;
	}
};
/**
* SE_GROUP_LOGON_ID: marks a token group SID as the logon SID (compared with
* `>>> 0` — the flag's high bit makes it negative as a signed 32-bit number).
*/
const SE_GROUP_LOGON_ID = 3221225472;
/**
* GRANT_MASK: FILE_GENERIC_WRITE minus READ_CONTROL plus DELETE and
* FILE_DELETE_CHILD — the write+delete access mask the capability-SID ACEs grant
* (displays as "Modify" in Explorer/icacls). WRITE_DAC/WRITE_OWNER are
* deliberately excluded: they would let the confined child take ownership or
* rewrite DACLs.
*/
const GRANT_MASK = 1114454;
/**
* FILE_ALL_ACCESS (winnt.h line ~2789: STANDARD_RIGHTS_REQUIRED | SYNCHRONIZE
* | 0x1FF): full file-object access. The mask of the ACE merged into the
* restricted token's DEFAULT DACL — the token holder must keep full access to
* every NEW object it creates (pipes included), and the ACE must name a
* restricting SID so the write pass-2 check passes at creation.
*/
const FILE_ALL_ACCESS = 2032127;
/** PROCESS_QUERY_INFORMATION: read exit status and times of a process handle. */
const PROCESS_QUERY_INFORMATION = 1024;
/** JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: the child dies when the runner's last job handle closes — the orphan-child backstop. */
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 8192;
//#endregion
//#region lib/types/ffi.js
/**
* Lazy koffi bindings for the Win32 ACL-sandbox backend. Koffi loads lazily so
* non-Windows processes never open Win32 libraries. Every function signature
* below was verified against the MinGW Windows headers on this machine
* (winnt.h / accctrl.h / aclapi.h / securitybaseapi.h / sddl.h /
* processthreadsapi.h / fileapi.h / namedpipeapi.h / synchapi.h / winbase.h);
* struct layouts are asserted at load time against verify/abi-probe.cpp.
* @module @deepseek-ai/dsh-sandbox-windows-acl/ffi
*/
/**
* True for NULL pointers, however koffi returns them (null or 0n).
* @param value - a pointer as koffi may hand it back (pointer, null, or 0n).
* @returns a type guard narrowing to the NULL shapes.
*/
function isNullPtr(value) {
	return value === null || value === void 0 || value === 0n;
}
/**
* True for CreateFileW's INVALID_HANDLE_VALUE failure marker (-1, which
* koffi hands back as the unsigned 64-bit all-ones pointer).
* @param handle - the handle CreateFileW returned.
* @returns whether the handle signals failure.
*/
function isInvalidHandle(handle) {
	if (isNullPtr(handle)) return true;
	return handle === 18446744073709551615n || handle === -1n;
}
const PVOID = koffi.pointer("void");
const PPVOID = koffi.pointer(PVOID);
/** koffi STARTUPINFOW layout; its size is asserted against abi.STARTUPINFOW_SIZE at load. */
const STARTUPINFOW = koffi.struct("STARTUPINFOW", {
	cb: "uint32",
	lpReserved: "str16",
	lpDesktop: "str16",
	lpTitle: "str16",
	dwX: "uint32",
	dwY: "uint32",
	dwXSize: "uint32",
	dwYSize: "uint32",
	dwXCountChars: "uint32",
	dwYCountChars: "uint32",
	dwFillAttribute: "uint32",
	dwFlags: "uint32",
	wShowWindow: "uint16",
	cbReserved2: "uint16",
	lpReserved2: koffi.pointer("uint8"),
	hStdInput: PVOID,
	hStdOutput: PVOID,
	hStdError: PVOID
});
/** koffi PROCESS_INFORMATION layout; its size is asserted against abi.PROCESS_INFORMATION_SIZE at load. */
const PROCESS_INFORMATION = koffi.struct("PROCESS_INFORMATION", {
	hProcess: PVOID,
	hThread: PVOID,
	dwProcessId: "uint32",
	dwThreadId: "uint32"
});
/* v8 ignore start -- layout-mismatch guards fire only on ABI breakage; verify/abi-probe.cpp pins both sizes. */
if (STARTUPINFOW.size !== 104) throw new Error(`STARTUPINFOW layout mismatch: koffi computed ${STARTUPINFOW.size}, header probe says 104`);
if (PROCESS_INFORMATION.size !== 24) throw new Error(`PROCESS_INFORMATION layout mismatch: koffi computed ${PROCESS_INFORMATION.size}, header probe says 24`);
/* v8 ignore stop */
/**
* Allocate one pointer-sized slot (for `T **` out-parameters).
* @returns the allocated slot pointer.
*/
function allocPtrSlot() {
	return koffi.alloc(PVOID, 1);
}
/**
* Allocate one uint32 slot.
* @returns the allocated slot pointer.
*/
function allocUint32() {
	return koffi.alloc("uint32", 1);
}
/**
* Write a uint32 value into a slot pointer.
* @param slot - the slot allocated by {@link allocUint32}.
* @param value - the uint32 to encode.
*/
function encodeUint32(slot, value) {
	koffi.encode(slot, "uint32", value);
}
/**
* Decode the pointer stored in a pointer-sized slot (NULL becomes null).
* @param slot - the pointer-sized slot holding the out-parameter value.
* @returns the decoded pointer, or null for NULL.
*/
function decodePtr(slot) {
	const value = koffi.decode(slot, PVOID);
	if (isNullPtr(value)) return null;
	return value;
}
/**
* Decode a uint32 at a slot pointer.
* @param slot - the uint32 slot holding the out-parameter value.
* @returns the decoded uint32.
*/
function decodeUint32(slot) {
	return koffi.decode(slot, "uint32");
}
/**
* Cast a koffi pointer to its numeric address (bigint, used for raw struct packing).
* @param ptr - the koffi pointer.
* @returns the pointer's numeric address.
*/
function ptrAddress(ptr) {
	return koffi.address(ptr);
}
/**
* Allocate a raw byte block (used for SID copies and variable-length arrays).
* @param length - the block size in bytes.
* @returns the allocated block pointer.
*/
function allocBytes(length) {
	return koffi.alloc("uint8", length);
}
/**
* Allocate one zeroed OVERLAPPED (32 bytes on x64: Internal@0, InternalHigh@8,
* Offset@16, OffsetHigh@20, hEvent@24). LockFileEx/UnlockFileEx receive this
* instead of a NULL lpOverlapped: koffi 3.1.1 crashes on NULL there, and a
* zeroed OVERLAPPED on a synchronous file handle is the documented equivalent
* (the byte range locks from offset 0, hEvent stays NULL).
* @returns the zeroed block pointer.
*/
function allocOverlapped() {
	return allocBytes(32);
}
/**
* Decode a pointer VALUE stored in memory at `buffer[offset]` (e.g. TOKEN_GROUPS entries).
* @param buffer - the buffer holding the pointer value.
* @param offset - byte offset of the pointer inside the buffer.
* @returns the decoded pointer, or null for NULL.
*/
function decodePtrAt(buffer, offset) {
	const value = koffi.decode(buffer, offset, PVOID);
	if (isNullPtr(value)) return null;
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
function decodeUint8At(ptr, offset) {
	return koffi.decode(ptr, offset, "uint8");
}
/**
* Decode a uint16 at a native pointer plus byte offset (see {@link decodeUint8At}).
* @param ptr - the native pointer to read from.
* @param offset - byte offset from the pointer.
* @returns the decoded uint16.
*/
function decodeUint16At(ptr, offset) {
	return koffi.decode(ptr, offset, "uint16");
}
/**
* Decode a uint32 at a native pointer plus byte offset (see {@link decodeUint8At}).
* @param ptr - the native pointer to read from.
* @param offset - byte offset from the pointer.
* @returns the decoded uint32.
*/
function decodeUint32At(ptr, offset) {
	return koffi.decode(ptr, offset, "uint32");
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
function sameSidAt(left, leftOffset, right, rightOffset) {
	if (decodeUint8At(left, leftOffset) !== decodeUint8At(right, rightOffset)) return false;
	const leftCount = decodeUint8At(left, leftOffset + 1);
	if (leftCount !== decodeUint8At(right, rightOffset + 1) || leftCount > 15) return false;
	for (let index = 0; index < 6; index++) if (decodeUint8At(left, leftOffset + 2 + index) !== decodeUint8At(right, rightOffset + 2 + index)) return false;
	for (let index = 0; index < leftCount; index++) if (decodeUint32At(left, leftOffset + 8 + index * 4) !== decodeUint32At(right, rightOffset + 8 + index * 4)) return false;
	return true;
}
/**
* Allocate a zeroed STARTUPINFOW.
* @returns the allocated struct pointer.
*/
function allocStartupInfo() {
	return koffi.alloc(STARTUPINFOW, 1);
}
/**
* Write the stdio-relevant fields into a zeroed STARTUPINFOW (others stay default-initialized).
* @param startupInfo - the allocated STARTUPINFOW to encode into.
* @param fields - the field subset to write.
*/
function encodeStartupInfo(startupInfo, fields) {
	koffi.encode(startupInfo, STARTUPINFOW, fields);
}
/**
* Allocate a zeroed PROCESS_INFORMATION.
* @returns the allocated struct pointer.
*/
function allocProcessInfo() {
	return koffi.alloc(PROCESS_INFORMATION, 1);
}
/**
* Decode a PROCESS_INFORMATION after CreateProcessAsUserW.
* @param processInfo - the PROCESS_INFORMATION filled by the spawn call.
* @returns the decoded handle/id fields.
*/
function decodeProcessInfo(processInfo) {
	return koffi.decode(processInfo, PROCESS_INFORMATION);
}
let cached;
function bindings() {
	if (cached !== void 0) return cached;
	const kernel32 = koffi.load("kernel32.dll");
	const advapi32 = koffi.load("advapi32.dll");
	const bind = (lib, name, result, args) => lib.func("__stdcall", name, result, args);
	cached = {
		openProcess: bind(kernel32, "OpenProcess", PVOID, [
			"uint32",
			"int",
			"uint32"
		]),
		openProcessToken: bind(advapi32, "OpenProcessToken", "int", [
			PVOID,
			"uint32",
			PPVOID
		]),
		closeHandle: bind(kernel32, "CloseHandle", "int", [PVOID]),
		getLastError: bind(kernel32, "GetLastError", "uint32", []),
		formatMessageW: bind(kernel32, "FormatMessageW", "uint32", [
			"uint32",
			PVOID,
			"uint32",
			"uint32",
			PVOID,
			"uint32",
			PVOID
		]),
		localAlloc: bind(kernel32, "LocalAlloc", PVOID, ["uint32", "size_t"]),
		localFree: bind(kernel32, "LocalFree", PVOID, [PVOID]),
		convertStringSidToSidW: bind(advapi32, "ConvertStringSidToSidW", "int", ["str16", PPVOID]),
		createWellKnownSid: bind(advapi32, "CreateWellKnownSid", "int", [
			"int",
			PVOID,
			PVOID,
			koffi.pointer("uint32")
		]),
		isValidSid: bind(advapi32, "IsValidSid", "int", [PVOID]),
		getLengthSid: bind(advapi32, "GetLengthSid", "uint32", [PVOID]),
		copySid: bind(advapi32, "CopySid", "int", [
			"uint32",
			PVOID,
			PVOID
		]),
		getTokenInformation: bind(advapi32, "GetTokenInformation", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32",
			koffi.pointer("uint32")
		]),
		setTokenInformation: bind(advapi32, "SetTokenInformation", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32"
		]),
		createRestrictedToken: bind(advapi32, "CreateRestrictedToken", "int", [
			PVOID,
			"uint32",
			"uint32",
			PVOID,
			"uint32",
			PVOID,
			"uint32",
			PVOID,
			PPVOID
		]),
		setEntriesInAclW: bind(advapi32, "SetEntriesInAclW", "uint32", [
			"uint32",
			PVOID,
			PVOID,
			PPVOID
		]),
		setNamedSecurityInfoW: bind(advapi32, "SetNamedSecurityInfoW", "uint32", [
			"str16",
			"int",
			"uint32",
			PVOID,
			PVOID,
			PVOID,
			PVOID
		]),
		getNamedSecurityInfoW: bind(advapi32, "GetNamedSecurityInfoW", "uint32", [
			"str16",
			"int",
			"uint32",
			PPVOID,
			PPVOID,
			PPVOID,
			PPVOID,
			PPVOID
		]),
		getTempPathW: bind(kernel32, "GetTempPathW", "uint32", ["uint32", PVOID]),
		createFileW: bind(kernel32, "CreateFileW", PVOID, [
			"str16",
			"uint32",
			"uint32",
			PVOID,
			"uint32",
			"uint32",
			PVOID
		]),
		lockFileEx: bind(kernel32, "LockFileEx", "int", [
			PVOID,
			"uint32",
			"uint32",
			"uint32",
			"uint32",
			PVOID
		]),
		unlockFileEx: bind(kernel32, "UnlockFileEx", "int", [
			PVOID,
			"uint32",
			"uint32",
			"uint32",
			PVOID
		]),
		createPipe: bind(kernel32, "CreatePipe", "int", [
			PPVOID,
			PPVOID,
			PVOID,
			"uint32"
		]),
		setHandleInformation: bind(kernel32, "SetHandleInformation", "int", [
			PVOID,
			"uint32",
			"uint32"
		]),
		createProcessAsUserW: bind(advapi32, "CreateProcessAsUserW", "int", [
			PVOID,
			"str16",
			"str16",
			PVOID,
			PVOID,
			"int",
			"uint32",
			PVOID,
			"str16",
			koffi.pointer(STARTUPINFOW),
			koffi.pointer(PROCESS_INFORMATION)
		]),
		setEnvironmentVariableW: bind(kernel32, "SetEnvironmentVariableW", "int", ["str16", "str16"]),
		readFile: bind(kernel32, "ReadFile", "int", [
			PVOID,
			PVOID,
			"uint32",
			koffi.pointer("uint32"),
			PVOID
		]),
		peekNamedPipe: bind(kernel32, "PeekNamedPipe", "int", [
			PVOID,
			PVOID,
			"uint32",
			koffi.pointer("uint32"),
			koffi.pointer("uint32"),
			koffi.pointer("uint32")
		]),
		waitForSingleObject: bind(kernel32, "WaitForSingleObject", "uint32", [PVOID, "uint32"]),
		getExitCodeProcess: bind(kernel32, "GetExitCodeProcess", "int", [PVOID, koffi.pointer("uint32")]),
		resumeThread: bind(kernel32, "ResumeThread", "uint32", [PVOID]),
		createJobObjectW: bind(kernel32, "CreateJobObjectW", PVOID, [PVOID, "str16"]),
		setInformationJobObject: bind(kernel32, "SetInformationJobObject", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32"
		]),
		assignProcessToJobObject: bind(kernel32, "AssignProcessToJobObject", "int", [PVOID, PVOID]),
		terminateProcess: bind(kernel32, "TerminateProcess", "int", [PVOID, "uint32"]),
		setConsoleCtrlHandler: bind(kernel32, "SetConsoleCtrlHandler", "int", [PVOID, "int"]),
		getStdHandle: bind(kernel32, "GetStdHandle", PVOID, ["int"])
	};
	return cached;
}
/**
* Resolve the lazy Win32 bindings (throws the first binding failure, fail-closed).
* @returns the cached binding table.
*/
function win32() {
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
function win32Sync() {
	return bindings();
}
/**
* Turn a Win32 error code into readable text via FormatMessageW.
* @param api - the binding table.
* @param win32Code - the error code to format.
* @returns the formatted message text, or '' when formatting fails.
*/
function errorText(api, win32Code) {
	const buffer = Buffer.alloc(1024);
	const length = api.formatMessageW(4608, null, win32Code, 0, buffer, buffer.length / 2, null);
	if (length === 0) return "";
	return buffer.subarray(0, length * 2).toString("utf16le").trim();
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
function getTempPath(api) {
	const buffer = Buffer.alloc(261 * 2);
	const length = api.getTempPathW(buffer.length / 2, buffer);
	if (length === 0) throwLastError(api, "GetTempPathW");
	if (length > buffer.length / 2) throw new Win32Error("GetTempPathW", 122, `required ${length} chars exceed the ${buffer.length / 2}-char buffer; nothing was written`);
	return buffer.subarray(0, length * 2).toString("utf16le");
}
/**
* Throw a Win32Error for a BOOL-style API failure. MUST be called immediately
* after the failed call so GetLastError is not clobbered by other Win32 calls.
* @param api - the binding table.
* @param name - the failed API's name for the error message.
* @param detail - optional detail overriding the formatted system message.
* @returns never — always throws.
*/
function throwLastError(api, name, detail) {
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
function throwWin32(api, name, win32Code, detail) {
	throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
//#endregion
//#region lib/types/acl.js
/**
* ACL editing helpers: grant/revoke a capability SID on a directory via
* SetEntriesInAclW + SetNamedSecurityInfoW (the same calls the POC uses, with
* the failure handling the POC lacks). Every API call is checked and every
* failure is reported with the API name, the exact Win32 code, the formatted
* system text, and the affected path.
*
* Concurrency: grants are read-merge-write against the directory's CURRENT
* DACL, and the whole get-merge-set sequence runs under a per-path exclusive
* LockFileEx lock (see {@link withPathLock}) so concurrent sandbox instances
* cannot clobber each other's ACEs.
* @module @deepseek-ai/dsh-sandbox-windows-acl/acl
*/
/**
* Pack one EXPLICIT_ACCESS_W (48 bytes, layout verified by abi-probe.cpp):
* perms@0, mode@4, inheritance@8, Trustee@16 { pMultipleTrustee@16,
* MultipleTrusteeOperation@24, TrusteeForm@28, TrusteeType@32, ptstrName@40 }.
* `permissions` is the access mask; the POC passes 0 for REVOKE_ACCESS, which
* removes every ACE for the trustee.
* @param sidPtr - the trustee SID the entry names.
* @param mode - the access mode (GRANT_ACCESS or REVOKE_ACCESS).
* @param permissions - the access mask to grant (0 for REVOKE_ACCESS).
* @returns the packed entry buffer.
*/
function buildExplicitAccess(sidPtr, mode, permissions) {
	const entry = Buffer.alloc(48);
	entry.writeUInt32LE(permissions, 0);
	entry.writeUInt32LE(mode, 4);
	entry.writeUInt32LE(3, 8);
	entry.writeUInt32LE(0, 24);
	entry.writeUInt32LE(0, 28);
	entry.writeUInt32LE(0, 32);
	entry.writeBigUInt64LE(ptrAddress(sidPtr), 40);
	return entry;
}
/**
* One lock file per protected path: `<GetTempPathW()>\dsh-acl-locks\<first 16
* hex of sha256(lowercased path)>.lock`. The lock root derives from
* GetTempPathW (never from runner argv or DSH_HOME), and the lowercasing
* maps Windows's case-insensitive path spellings onto one lock.
* @param api - the binding table.
* @param path - the protected directory (absolute).
* @returns the lock file path for that directory.
*/
function lockFilePath(api, path) {
	const digest = createHash("sha256").update(path.toLowerCase()).digest("hex").slice(0, 16);
	return join(getTempPath(api), "dsh-acl-locks", `${digest}.lock`);
}
/**
* Run `action` holding the per-path exclusive lock: CreateFileW
* (OPEN_ALWAYS, shared read/write but NOT delete — a deletable lock file
* could be removed and recreated under the holder, letting two processes
* hold "the same" lock), then a one-byte LockFileEx
* (LOCKFILE_EXCLUSIVE_LOCK, zeroed OVERLAPPED = lock from offset 0 on the
* synchronous handle — see allocOverlapped for why not NULL), then
* UnlockFileEx + CloseHandle. Fail-closed: open/lock/unlock/close failures
* throw like every other Win32 call in this package; an `action` failure
* still unlocks (best-effort) and rethrows the original error.
* @param api - the binding table.
* @param path - the protected directory (absolute).
* @param action - the get-merge-set sequence to serialize.
* @returns the action's result.
*/
function withPathLock(api, path, action) {
	const lockPath = lockFilePath(api, path);
	mkdirSync(dirname(lockPath), { recursive: true });
	const handle = api.createFileW(lockPath, -1073741824, 3, null, 4, 0, null);
	if (isInvalidHandle(handle)) throwLastError(api, "CreateFileW", lockPath);
	const overlapped = allocOverlapped();
	if (api.lockFileEx(handle, 2, 0, 1, 0, overlapped) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(handle);
		throwWin32(api, "LockFileEx", win32Code, lockPath);
	}
	let result;
	try {
		result = action();
	} catch (error) {
		api.unlockFileEx(handle, 0, 1, 0, overlapped);
		api.closeHandle(handle);
		throw error;
	}
	if (api.unlockFileEx(handle, 0, 1, 0, overlapped) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(handle);
		throwWin32(api, "UnlockFileEx", win32Code, lockPath);
	}
	if (api.closeHandle(handle) === 0) throwLastError(api, "CloseHandle", `lock file ${lockPath}`);
	return result;
}
/**
* Read the directory's current explicit DACL via GetNamedSecurityInfoW.
* Allocation contract (the POC's RevokeAccess, minus its missing checks): the
* returned ACL pointer sits INSIDE the security descriptor allocation — only
* the descriptor may be LocalFree'd, and it must not be freed before
* SetEntriesInAclW has consumed the ACL. Freeing the ACL pointer itself
* corrupts the heap (verified the hard way).
* @param api - the binding table.
* @param path - the directory whose DACL is read.
* @returns the current explicit DACL (null when the directory carries none) and its owning descriptor.
*/
function readCurrentDacl(api, path) {
	const ownerSlot = allocPtrSlot();
	const groupSlot = allocPtrSlot();
	const daclSlot = allocPtrSlot();
	const saclSlot = allocPtrSlot();
	const descriptorSlot = allocPtrSlot();
	const readResult = api.getNamedSecurityInfoW(path, 1, 4, ownerSlot, groupSlot, daclSlot, saclSlot, descriptorSlot);
	if (readResult !== 0) throwWin32(api, "GetNamedSecurityInfoW", readResult, path);
	return {
		oldAcl: decodePtr(daclSlot),
		descriptor: decodePtr(descriptorSlot)
	};
}
/**
* Shared tail of grantWrite and revokeWrite: merge `entry` into `oldAcl`
* (null = no explicit DACL yet; SetEntriesInAclW builds one from scratch),
* free the descriptor before applying the merged ACL, apply it, then free the
* merged ACL — checking every call and reporting with the caller's label.
* @param api - the binding table.
* @param path - the directory the DACL edit applies to.
* @param entry - the EXPLICIT_ACCESS_W to merge (grant or revoke).
* @param oldAcl - the current explicit DACL (from {@link readCurrentDacl}).
* @param descriptor - the descriptor allocation owning `oldAcl`.
* @param label - the caller's name for error details.
*/
function mergeAndApply(api, path, entry, oldAcl, descriptor, label) {
	const newAclSlot = allocPtrSlot();
	const mergeResult = api.setEntriesInAclW(1, entry, oldAcl, newAclSlot);
	if (mergeResult !== 0) {
		if (descriptor !== null) api.localFree(descriptor);
		throwWin32(api, "SetEntriesInAclW", mergeResult, `${label}(${path})`);
	}
	const newAcl = decodePtr(newAclSlot);
	if (newAcl === null) {
		if (descriptor !== null) api.localFree(descriptor);
		throwWin32(api, "SetEntriesInAclW", api.getLastError(), `${label}(${path}): null new ACL`);
	}
	const freedDescriptor = descriptor !== null ? api.localFree(descriptor) : null;
	const applyResult = api.setNamedSecurityInfoW(path, 1, 4, null, null, newAcl, null);
	const freedNew = api.localFree(newAcl);
	if (applyResult !== 0) throwWin32(api, "SetNamedSecurityInfoW", applyResult, `${label}(${path})`);
	if (freedDescriptor !== null && !isNullPtr(freedDescriptor)) throwLastError(api, "LocalFree", `${label}(${path}) descriptor`);
	if (!isNullPtr(freedNew)) throwLastError(api, "LocalFree", `${label}(${path}) new ACL`);
}
/**
* True when the explicit DACL already carries the EXACT write grant this
* module would add (Allow ACE, OI|CI inheritance, {@link abi.GRANT_MASK}, the
* capability SID). Every field is read through koffi.decode at pointer offsets —
* no memcpy, no pointer arithmetic. The ACE's SID is INLINE (embedded in the
* ACE after the 4-byte mask — there is no pointer to read; reading one
* yields garbage addresses and crashed EqualSid, verified by gdb), so it is
* compared field-by-field against the capability SID through bounded offset
* reads ({@link sameSidAt}). A malformed header reads as "no exact grant"
* so the caller falls back to the merge-apply path, which owns the robust
* failure handling.
* @param oldAcl - the current explicit DACL pointer (from {@link readCurrentDacl}).
* @param sidPtr - the capability SID to match.
* @returns whether the exact grant ACE is already present.
*/
function hasExactGrant(oldAcl, sidPtr) {
	const aclSize = decodeUint16At(oldAcl, 2);
	const aceCount = decodeUint16At(oldAcl, 4);
	if (aclSize < 8 || aclSize > 1048576) return false;
	let offset = 8;
	for (let index = 0; index < aceCount; index++) {
		const aceSize = decodeUint16At(oldAcl, offset + 2);
		if (aceSize < 8 || offset + aceSize > aclSize) return false;
		if (decodeUint8At(oldAcl, offset) === 0 && decodeUint8At(oldAcl, offset + 1) === 3 && decodeUint32At(oldAcl, offset + 4) === 1114454 && sameSidAt(oldAcl, offset + 8, sidPtr, 0)) return true;
		offset += aceSize;
	}
	return false;
}
/**
* Grant `GRANT_MASK` (Write+Delete, displays as "Modify") to the capability SID
* on `path`, inheriting to subcontainers and objects. Idempotent: when the
* directory's current explicit DACL already carries the exact ACE (the
* per-session grant surviving from a previous server lifetime), the
* SetNamedSecurityInfoW apply is SKIPPED — it would otherwise re-propagate
* the identical ACE across the whole tree (eager inheritance; minutes on
* large workspaces). Otherwise read-merge-write: the new ACE merges into the
* directory's CURRENT explicit DACL (same shape as {@link revokeWrite}), so
* pre-existing explicit ACEs survive. Runs under the per-path lock. The
* directory must be owned by the caller (owner implicit WRITE_DAC) — same
* precondition as the POC.
* @param api - the binding table.
* @param path - the directory whose DACL gains the grant (the workspace or temp root).
* @param sidPtr - the capability SID the ACE names.
*/
function grantWrite(api, path, sidPtr) {
	withPathLock(api, path, () => {
		const { oldAcl, descriptor } = readCurrentDacl(api, path);
		if (oldAcl !== null && hasExactGrant(oldAcl, sidPtr)) {
			if (descriptor !== null) {
				if (!isNullPtr(api.localFree(descriptor))) throwLastError(api, "LocalFree", `grantWrite(${path}) descriptor`);
			}
			return;
		}
		mergeAndApply(api, path, buildExplicitAccess(sidPtr, 1, GRANT_MASK), oldAcl, descriptor, "grantWrite");
	});
}
/**
* Remove every ACE for the capability SID from the directory DACL (REVOKE_ACCESS
* merge — other entries are preserved). Returns whether an ACE removal was
* attempted (false when the directory carries no DACL at all).
*
* Runs under the per-path lock (the whole get-merge-set sequence); the
* descriptor/ACL allocation contract lives on {@link readCurrentDacl}.
* @param api - the binding table.
* @param path - the directory whose DACL loses the capability-SID ACEs.
* @param sidPtr - the capability SID whose ACEs are removed.
* @returns whether an ACE removal was attempted (false when the directory carries no DACL at all).
*/
function revokeWrite(api, path, sidPtr) {
	return withPathLock(api, path, () => {
		const { oldAcl, descriptor } = readCurrentDacl(api, path);
		if (oldAcl === null) {
			if (descriptor !== null) {
				if (!isNullPtr(api.localFree(descriptor))) throwLastError(api, "LocalFree", `revokeWrite(${path}) descriptor`);
			}
			return false;
		}
		mergeAndApply(api, path, buildExplicitAccess(sidPtr, 4, 0), oldAcl, descriptor, "revokeWrite");
		return true;
	});
}
//#endregion
//#region lib/types/path-boundary.js
/**
* Canonical directory-boundary checks for the Windows ACL workspace and
* private-temp capabilities.
* @module @deepseek-ai/dsh-sandbox-windows-acl/path-boundary
*/
/** Whether `root` is the same canonical directory as `candidate` or contains it. */
function containsDirectory(root, candidate) {
	const relation = relative(realpathSync.native(root), realpathSync.native(candidate));
	return relation === "" || !isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`);
}
/**
* Reject a temp parent that is inside the workspace: every child created
* below it would inherit the standing workspace capability.
* @param workspaceRoot - the canonical workspace root that receives the standing ACE.
* @param tempRoot - the existing parent beneath which a private temp child would be created.
*/
function assertTempRootOutsideWorkspace(workspaceRoot, tempRoot) {
	if (containsDirectory(workspaceRoot, tempRoot)) throw new Error(`Windows ACL temp root must be outside the workspace: workspace=${workspaceRoot}; temp=${tempRoot}`);
}
/**
* Reject overlap between an actual private temp directory and any writable
* directory: either inheritance direction would merge the two capabilities.
* @param writableDirs - directories carrying the standing workspace capability.
* @param tempDir - the existing directory carrying the revocable temp capability.
*/
function assertPrivateTempDisjoint(writableDirs, tempDir) {
	for (const writableDir of writableDirs) if (containsDirectory(writableDir, tempDir) || containsDirectory(tempDir, writableDir)) throw new Error(`AclSandbox private temp directory must be disjoint from writable directories: writable=${writableDir}; temp=${tempDir}`);
}
//#endregion
//#region lib/types/spawn.js
/**
* Restricted-process spawning: anonymous pipes for stdio, STARTUPINFOW with
* STARTF_USESTDHANDLES, CreateProcessAsUserW under the restricted token, then
* asynchronous pipe draining and exit waiting. Console isolation
* (CREATE_NO_WINDOW / CREATE_NEW_CONSOLE) is intentionally absent: under this
* restriction scheme hidden-console children die with STATUS_DLL_INIT_FAILED
* (0xC0000142) — verified empirically, see win32-abi.ts. Stdio redirection is
* pipe-based and unaffected; the child shares the host console.
* @module @deepseek-ai/dsh-sandbox-windows-acl/spawn
*/
/**
* Quote one argument per the CommandLineToArgvW parsing rules: backslashes
* are doubled only before a quote character — including the closing quote
* this function appends, so a trailing backslash run is doubled as well
* (otherwise an odd run would escape the closing quote into a literal
* character and corrupt the rest of the command line). Mirrors the CRT
* ArgvQuote behavior Microsoft documents for command-line arguments.
* @param argument - one argv entry to quote.
* @returns the quoted entry (bare when quoting is unnecessary).
*/
function quoteArg(argument) {
	if (argument === "") return "\"\"";
	if (!/[\s"]/u.test(argument)) return argument;
	let quoted = "\"";
	for (let index = 0; index < argument.length; index++) {
		let backslashes = 0;
		while (index < argument.length && argument.charAt(index) === "\\") {
			backslashes++;
			index++;
		}
		if (index === argument.length) quoted += "\\".repeat(backslashes * 2);
		else if (argument.charAt(index) === "\"") quoted += "\\".repeat(backslashes * 2 + 1) + "\"";
		else quoted += "\\".repeat(backslashes) + argument.charAt(index);
	}
	return quoted + "\"";
}
/**
* Build the single command line CreateProcess parses from program + argv.
* @param program - the executable (argv[0]).
* @param args - the remaining argv entries.
* @returns the joined, quoted command line.
*/
function buildCommandLine(program, args) {
	return [program, ...args].map(quoteArg).join(" ");
}
function createPipe(api) {
	const readSlot = allocPtrSlot();
	const writeSlot = allocPtrSlot();
	if (api.createPipe(readSlot, writeSlot, null, 0) === 0) throwLastError(api, "CreatePipe");
	const read = decodePtr(readSlot);
	const write = decodePtr(writeSlot);
	if (read === null || write === null) throwLastError(api, "CreatePipe", "null pipe handle");
	return {
		read,
		write
	};
}
function setInheritable(api, handle, label) {
	if (api.setHandleInformation(handle, 1, 1) === 0) throwLastError(api, "SetHandleInformation", label);
}
/**
* Create a process under the restricted token with piped stdio. The child's
* stdin is closed immediately (EOF), matching the POC; stdout/stderr read ends
* are returned for draining. The child inherits the caller's environment block
* (lpEnvironment NULL); the caller rewrites entries through
* SetEnvironmentVariableW before spawning (the runner's per-session temp
* contract) — passing an explicit block through koffi trips
* ERROR_INVALID_PARAMETER in CreateProcessAsUserW (verified empirically).
* @param api - the binding table.
* @param token - the restricted token the child runs under.
* @param options - command, args, and working directory.
* @returns the spawned child's handles.
*/
function spawnSandboxed(api, token, options) {
	const stdIn = createPipe(api);
	const stdOut = createPipe(api);
	const stdErr = createPipe(api);
	setInheritable(api, stdIn.read, "stdin read end");
	setInheritable(api, stdOut.write, "stdout write end");
	setInheritable(api, stdErr.write, "stderr write end");
	const startupInfo = allocStartupInfo();
	encodeStartupInfo(startupInfo, {
		cb: 104,
		dwFlags: 256,
		hStdInput: stdIn.read,
		hStdOutput: stdOut.write,
		hStdError: stdErr.write
	});
	const processInfo = allocProcessInfo();
	const commandLine = buildCommandLine(options.command, options.args);
	if (api.createProcessAsUserW(token, null, commandLine, null, null, 1, 0, null, options.cwd, startupInfo, processInfo) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(stdIn.read);
		api.closeHandle(stdIn.write);
		api.closeHandle(stdOut.read);
		api.closeHandle(stdOut.write);
		api.closeHandle(stdErr.read);
		api.closeHandle(stdErr.write);
		throwWin32(api, "CreateProcessAsUserW", win32Code, `command: ${options.command}, cwd: ${options.cwd}`);
	}
	const info = decodeProcessInfo(processInfo);
	const processHandle = info.hProcess;
	const threadHandle = info.hThread;
	if (processHandle === null || threadHandle === null) throw new Error(`CreateProcessAsUserW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`);
	api.closeHandle(stdIn.read);
	api.closeHandle(stdOut.write);
	api.closeHandle(stdErr.write);
	api.closeHandle(stdIn.write);
	api.closeHandle(threadHandle);
	return {
		pid: info.dwProcessId,
		process: processHandle,
		stdoutRead: stdOut.read,
		stderrRead: stdErr.read
	};
}
/**
* Drain one pipe read end to a Buffer via non-blocking PeekNamedPipe polling.
* @param api - the binding table.
* @param handle - the pipe read end to drain (closed when done).
* @returns the complete pipe contents.
*/
async function drainPipe(api, handle) {
	const chunks = [];
	for (;;) {
		const bytesReadSlot = allocUint32();
		const totalAvailSlot = allocUint32();
		const leftThisMessageSlot = allocUint32();
		if (api.peekNamedPipe(handle, null, 0, bytesReadSlot, totalAvailSlot, leftThisMessageSlot) === 0) {
			const win32Code = api.getLastError();
			if (win32Code === 109 || win32Code === 232) break;
			throwLastError(api, "PeekNamedPipe", `drain failure after ${chunks.length} chunk(s)`);
		}
		const available = decodeUint32(totalAvailSlot);
		if (available > 0) {
			const chunk = Buffer.alloc(available);
			const readSlot = allocUint32();
			if (api.readFile(handle, chunk, chunk.length, readSlot, null) === 0) throwLastError(api, "ReadFile", `drain failure after ${chunks.length} chunk(s)`);
			chunks.push(chunk.subarray(0, decodeUint32(readSlot)));
		}
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	api.closeHandle(handle);
	return Buffer.concat(chunks);
}
/**
* Wait for process exit and return its exit code. Call only after both drains
* have resolved — the drains finish when the child closed its pipe ends, i.e.
* the child has already exited, so this wait returns immediately. Calling it
* earlier would block the event loop and starve the drains (the pipe-buffer
* deadlock the POC comments warn about).
* @param api - the binding table.
* @param process - the child process handle (closed when done).
* @returns the child's exit code.
*/
function waitForExit(api, process) {
	if (api.waitForSingleObject(process, 4294967295) === 4294967295) throwLastError(api, "WaitForSingleObject");
	const exitCodeSlot = allocUint32();
	if (api.getExitCodeProcess(process, exitCodeSlot) === 0) throwLastError(api, "GetExitCodeProcess");
	api.closeHandle(process);
	return decodeUint32(exitCodeSlot);
}
/**
* Create a kill-on-close job object (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE at
* LimitFlags offset 16 of JOBOBJECT_EXTENDED_LIMIT_INFORMATION, layout
* verified by abi-probe.cpp). When the caller dies with the job handle open,
* Windows terminates every process in the job — the orphan-child backstop.
* The caller keeps the returned handle open for the child's lifetime.
*/
function createKillOnCloseJob(api) {
	const job = api.createJobObjectW(null, null);
	if (isNullPtr(job)) throwLastError(api, "CreateJobObjectW");
	const information = Buffer.alloc(144);
	information.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 16);
	if (api.setInformationJobObject(job, 9, information, information.length) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(job);
		throwWin32(api, "SetInformationJobObject", win32Code);
	}
	return job;
}
/**
* Create a process under the restricted token whose stdio passes straight
* through to the caller's pipes. This is the runner shape: the harness spawns
* the runner with piped stdio, and the runner's confined child writes to
* those same pipes.
*
* Node clears the inheritability of its stdio handles at startup
* (uv_disable_stdio_inheritance), so raw spawns must re-enable the inherit
* bit around the call (libuv instead duplicates the handles; re-enabling is
* equivalent here and cheaper) and pass them explicitly via
* STARTF_USESTDHANDLES — otherwise the child receives INVALID std handles
* ("The handle is invalid", verified the hard way). The child starts
* suspended so it can be assigned to a kill-on-close job before it runs.
* @param api - the binding table.
* @param token - the restricted token the child runs under.
* @param options - command, args, and working directory.
* @returns the spawned child's handles and job.
*/
function spawnSandboxedInherited(api, token, options) {
	const job = createKillOnCloseJob(api);
	const stdIn = api.getStdHandle(-10);
	const stdOut = api.getStdHandle(-11);
	const stdErr = api.getStdHandle(-12);
	if (isNullPtr(stdIn) || isNullPtr(stdOut) || isNullPtr(stdErr)) {
		api.closeHandle(job);
		throwLastError(api, "GetStdHandle", "null standard handle");
	}
	const makeInheritable = (handle, label) => {
		if (api.setHandleInformation(handle, 1, 1) === 0) throwLastError(api, "SetHandleInformation", `${label} (enable inherit)`);
	};
	const restoreInherit = (handle) => {
		api.setHandleInformation(handle, 1, 0);
	};
	makeInheritable(stdIn, "stdin");
	makeInheritable(stdOut, "stdout");
	makeInheritable(stdErr, "stderr");
	const startupInfo = allocStartupInfo();
	encodeStartupInfo(startupInfo, {
		cb: 104,
		dwFlags: 256,
		hStdInput: stdIn,
		hStdOutput: stdOut,
		hStdError: stdErr
	});
	const processInfo = allocProcessInfo();
	const commandLine = buildCommandLine(options.command, options.args);
	const created = api.createProcessAsUserW(token, null, commandLine, null, null, 1, 4, null, options.cwd, startupInfo, processInfo);
	restoreInherit(stdIn);
	restoreInherit(stdOut);
	restoreInherit(stdErr);
	if (created === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(job);
		throwWin32(api, "CreateProcessAsUserW", win32Code, `command: ${options.command}, cwd: ${options.cwd}`);
	}
	const info = decodeProcessInfo(processInfo);
	const processHandle = info.hProcess;
	const threadHandle = info.hThread;
	if (processHandle === null || threadHandle === null) {
		api.closeHandle(job);
		throw new Error(`CreateProcessAsUserW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`);
	}
	if (api.assignProcessToJobObject(job, processHandle) === 0) {
		const win32Code = api.getLastError();
		api.terminateProcess(processHandle, 1);
		api.closeHandle(threadHandle);
		api.closeHandle(processHandle);
		api.closeHandle(job);
		throwWin32(api, "AssignProcessToJobObject", win32Code, `pid ${info.dwProcessId}`);
	}
	if (api.resumeThread(threadHandle) === 4294967295) {
		const win32Code = api.getLastError();
		api.closeHandle(threadHandle);
		api.closeHandle(processHandle);
		api.closeHandle(job);
		throwWin32(api, "ResumeThread", win32Code, `pid ${info.dwProcessId}`);
	}
	api.closeHandle(threadHandle);
	return {
		pid: info.dwProcessId,
		process: processHandle,
		job
	};
}
//#endregion
//#region lib/types/token.js
/**
* Restricted-token construction: open the current process token, extract its
* logon SID, build the well-known SIDs, and call CreateRestrictedToken with
* the POC's restricting-SID allowlist. Every API call is checked; any failure
* throws with the API name and the exact Win32 code — the original POC ignored
* all of these and silently ran children with the FULL, unrestricted token.
* @module @deepseek-ai/dsh-sandbox-windows-acl/token
*/
/**
* Open the current process's access token with the rights
* CreateRestrictedToken requires (the POC's OpenProcessToken call; the token
* handle is obtained through a real OpenProcess handle because the
* GetCurrentProcess() pseudo-handle is not addressable through koffi).
* @param api - the binding table.
* @returns the opened token handle.
*/
function openCurrentProcessToken(api) {
	const processHandle = api.openProcess(PROCESS_QUERY_INFORMATION, 0, process.pid);
	if (isNullPtr(processHandle)) throwLastError(api, "OpenProcess", `pid ${process.pid}`);
	const tokenSlot = allocPtrSlot();
	if (api.openProcessToken(processHandle, 139, tokenSlot) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(processHandle);
		throwWin32(api, "OpenProcessToken", win32Code, `pid ${process.pid}`);
	}
	if (api.closeHandle(processHandle) === 0) throwLastError(api, "CloseHandle", "OpenProcess process handle");
	const token = decodePtr(tokenSlot);
	if (token === null) throwWin32(api, "OpenProcessToken", api.getLastError(), "null token handle");
	return token;
}
/**
* Find and copy the token's logon session SID (S-1-5-5-x-y, attribute
* SE_GROUP_LOGON_ID). The restricted token needs it for WinSta0/desktop and
* other per-logon objects; the POC extracts it the same way.
* @param api - the binding table.
* @param token - the token whose groups are scanned.
* @returns a copied logon SID (thrown when the token carries none).
*/
function findLogonSid(api, token) {
	const neededSlot = allocUint32();
	api.getTokenInformation(token, 2, null, 0, neededSlot);
	const needed = decodeUint32(neededSlot);
	if (needed === 0) throwLastError(api, "GetTokenInformation", "TokenGroups size query");
	if (needed < 8) throwWin32(api, "GetTokenInformation", api.getLastError(), `implausible TokenGroups size ${needed}`);
	const groups = Buffer.alloc(needed);
	if (api.getTokenInformation(token, 2, groups, groups.length, neededSlot) === 0) throwLastError(api, "GetTokenInformation", "TokenGroups");
	const groupCount = groups.readUInt32LE(0);
	for (let index = 0; index < groupCount; index++) {
		const sidPtr = decodePtrAt(groups, 8 + index * 16);
		const isLogonId = (groups.readUInt32LE(8 + index * 16 + 8) & SE_GROUP_LOGON_ID) >>> 0 === SE_GROUP_LOGON_ID >>> 0;
		if (sidPtr === null || !isLogonId) continue;
		const sidLength = api.getLengthSid(sidPtr);
		if (sidLength === 0) throwLastError(api, "GetLengthSid", `logon SID group ${index}`);
		const copy = allocBytes(sidLength);
		if (api.copySid(sidLength, copy, sidPtr) === 0) throwLastError(api, "CopySid", `logon SID group ${index}`);
		return copy;
	}
	throw new Error(`CreateRestrictedToken prerequisite failed: no logon SID found among ${groupCount} token groups`);
}
/**
* Create one well-known SID (68-byte buffer) and assert its validity.
* @param api - the binding table.
* @param type - the WELL_KNOWN_SID_TYPE to create.
* @returns the created SID pointer.
*/
function makeWellKnownSid(api, type) {
	const sid = allocBytes(68);
	const sizeSlot = allocUint32();
	encodeUint32(sizeSlot, 68);
	if (api.createWellKnownSid(type, null, sid, sizeSlot) === 0) throwLastError(api, "CreateWellKnownSid", `type ${type}`);
	if (api.isValidSid(sid) === 0) throwLastError(api, "IsValidSid", `CreateWellKnownSid type ${type}`);
	return sid;
}
/**
* Merge one full-access allow ACE for `sidPtr` into the token's DEFAULT DACL
* — the DACL every NEW object the token holder creates (without an explicit
* security descriptor) takes. The restricted token inherits the user's
* default DACL verbatim, which names no restricting SID: a new anonymous pipe
* (child stdio) therefore fails the write pass-2 check at creation
* (ERROR_ACCESS_DENIED; Node surfaces it as spawn EPERM), breaking every
* piped-stdio grandchild spawn. The merged ACE names a RESTRICTING SID (the
* write SID under workspace-write, Everyone under read-only), so each new
* object's own DACL passes pass-2 while object creation itself stays gated by
* the parent container's DACL (files outside the granted trees remain
* uncreatable). Fails closed: any Win32 failure throws before the spawn.
* @param api - the binding table.
* @param token - the restricted token to adjust (requires TOKEN_ADJUST_DEFAULT).
* @param sidPtr - the restricting SID whose full-access ACE joins the default DACL.
*/
function setTokenDefaultDaclGrant(api, token, sidPtr) {
	const neededSlot = allocUint32();
	api.getTokenInformation(token, 6, null, 0, neededSlot);
	const needed = decodeUint32(neededSlot);
	if (needed === 0) throwLastError(api, "GetTokenInformation", "TokenDefaultDacl size query");
	const buffer = Buffer.alloc(needed);
	if (api.getTokenInformation(token, 6, buffer, buffer.length, neededSlot) === 0) throwLastError(api, "GetTokenInformation", "TokenDefaultDacl");
	const currentDacl = decodePtrAt(buffer, 0);
	if (currentDacl === null) throw new Error("setTokenDefaultDaclGrant: the token carries no default DACL to extend");
	const newDaclSlot = allocPtrSlot();
	const result = api.setEntriesInAclW(1, buildExplicitAccess(sidPtr, 1, FILE_ALL_ACCESS), currentDacl, newDaclSlot);
	if (result !== 0) throwWin32(api, "SetEntriesInAclW", result, "default DACL merge");
	const newDacl = decodePtr(newDaclSlot);
	if (newDacl === null) throwWin32(api, "SetEntriesInAclW", result, "null merged default DACL");
	const info = Buffer.alloc(8);
	info.writeBigUInt64LE(newDacl, 0);
	if (api.setTokenInformation(token, 6, info, info.length) === 0) {
		const win32Code = api.getLastError();
		api.localFree(newDacl);
		throwWin32(api, "SetTokenInformation", win32Code, "TokenDefaultDacl");
	}
	api.localFree(newDacl);
}
/** Pack `SID_AND_ATTRIBUTES[count]` (16-byte stride; Attributes stay 0). */
function buildRestrictingSids(sids) {
	const buffer = Buffer.alloc(16 * sids.length);
	sids.forEach((sid, index) => {
		buffer.writeBigUInt64LE(ptrAddress(sid), 16 * index);
	});
	return buffer;
}
/**
* Create the write-restricted token with the mode-selected restricting list
* (verified on Win11 26200, see the POC-worktree restrict-variant harness):
*  - read-only:       [logon SID, EVERYONE]
*  - workspace-write: [logon SID, EVERYONE, workspace SID, optional temp SID]
*
* The logon SID + EVERYONE keep-alive group is shared by both modes: early
* DLL init dies with 0xC0000142 and CNG (`\Device\CNG` write trustee —
* pwsh crashes 0xE0434352) fails without them. The write SIDs join ONLY
* workspace-write — read-only carries no write SID, so a standing grant ACE
* from an earlier workspace-write period (a `/permission` mode downgrade, or
* a crash-resumed session) stays INERT under read-only: the WRITE_RESTRICTED
* pass-2 check grants only what the restricting list carries, keeping that
* workspace grant inert under read-only while the unrevoked ACE keeps the
* re-upgrade free (the grant's exact-ACE skip — no re-propagation).
* Everyone's own ambient grants remain the documented partial boundary.
* Authenticated Users is absent from BOTH lists: the WMI
* namespace security check fails (0x80041003), so CIM is unavailable in
* every confined mode, and the C:\-root tree-creation escape (standing
* `AU:(AD)` + `AU:(OI)(CI)(IO)(M)` ACEs) is closed in both — documented in
* README. INTERACTIVE/LOCAL are absent from BOTH lists too — the host's
* Public tree grants write to INTERACTIVE, so removing it closes that
* escape. S-1-2-1 (console logon) is intentionally absent: see win32-abi.ts
* for the verified failure modes. FAILS CLOSED: any failure throws — never
* spawn unrestricted.
* @param api - the binding table.
* @param currentToken - the process token to restrict.
* @param logonSid - the copied logon session SID.
* @param writeSids - the distinct write SIDs forming the workspace and
* optional temp allowlists (workspace-write only; empty under read-only).
* @param known - the well-known SIDs entering the restricting list.
* @param mode - selects the restricting list (workspace-write adds the capability SIDs).
* @returns the restricted token handle.
*/
function createRestrictedToken(api, currentToken, logonSid, writeSids, known, mode) {
	const restrictingSids = buildRestrictingSids(mode === "read-only" ? [logonSid, known.world] : writeSids.length === 0 ? (() => {
		throw new Error("createRestrictedToken: workspace-write restricting list requires at least one write SID");
	})() : [
		logonSid,
		known.world,
		...writeSids
	]);
	const tokenSlot = allocPtrSlot();
	if (api.createRestrictedToken(currentToken, 13, 0, null, 0, null, restrictingSids.length / 16, restrictingSids, tokenSlot) === 0) throwLastError(api, "CreateRestrictedToken", `restricting SIDs: ${restrictingSids.length / 16}`);
	const token = decodePtr(tokenSlot);
	if (token === null) throwWin32(api, "CreateRestrictedToken", api.getLastError(), "null token handle");
	return token;
}
//#endregion
//#region lib/types/grant.js
/**
* Server-side write-grant materialization. The sandbox seam holds one
* standing workspace grant per workspace and one revocable temp grant per
* live session/workspace pair. Workspace identities survive by deterministic
* derivation and their standing ACE; temp identities derive from random
* private paths and are deliberately new after a restart.
*
* Fail-closed: `add` throws on any grant failure and the caller disposes the
* instance (revoking every path granted so far); `dispose` revokes every
* standing grant and reports every cleanup failure.
* @module @deepseek-ai/dsh-sandbox-windows-acl/grant
*/
/**
* One write SID's provider-lifetime grant materialization: the parsed SID
* pointer plus every directory whose DACL currently carries its ACE.
* Workspace paths are added STANDING (their ACEs are the cross-session reuse
* cache and outlive the grant — dispose() skips revoking them, or the next
* provision would re-propagate the whole tree); temp paths are revocable
* (dispose() revokes them — an inheritable ACE must not outlive its
* session's temp directory). Create with {@link AclWriteGrant.create};
* dispose revokes the revocable paths and frees the SID.
*/
var AclWriteGrant = class AclWriteGrant {
	/** The write SID in SDDL string form. */
	writeSid;
	api;
	sidPtr;
	revocablePaths = [];
	standingPaths = [];
	constructor(api, sidPtr, writeSid) {
		this.api = api;
		this.sidPtr = sidPtr;
		this.writeSid = writeSid;
	}
	/**
	* Parse the SID string and open the binding table (lazily, once per
	* server). Fail-closed: any failure throws — nothing is granted yet.
	* @param writeSid - the workspace (`S-1-4-x-y`) or temp (`S-1-4-x-y-1`) capability SID string.
	* @param api - optional already-resolved bindings (tests).
	* @returns the ready grant (no ACEs yet).
	*/
	static create(writeSid, api) {
		const bindings = api ?? win32Sync();
		const sidSlot = allocPtrSlot();
		if (bindings.convertStringSidToSidW(writeSid, sidSlot) === 0) throwLastError(bindings, "ConvertStringSidToSidW", writeSid);
		const sidPtr = decodePtr(sidSlot);
		if (sidPtr === null) throwLastError(bindings, "ConvertStringSidToSidW", `null SID for ${writeSid}`);
		return new AclWriteGrant(bindings, sidPtr, writeSid);
	}
	/**
	* Grant the write ACE on one directory (idempotent: an already-standing
	* exact ACE skips the eager full-tree re-propagation — see
	* {@link grantWrite}) and record the path for {@link dispose} unless it is
	* standing. The path is recorded BEFORE the grant: a post-apply throw (a
	* LocalFree failure after SetNamedSecurityInfoW succeeded) must still
	* revoke it, and revoking an ungranted path is a no-op merge. Callers
	* treat a throw as a failed materialization and dispose the instance to
	* revoke the paths granted so far.
	* @param path - the directory whose DACL gains the grant.
	* @param standing - the ACE outlives this grant (the workspace reuse
	*   cache; dispose() skips revoking it). Default false (revoked on
	*   dispose — the temp-directory lifecycle).
	*/
	add(path, standing = false) {
		(standing ? this.standingPaths : this.revocablePaths).push(path);
		grantWrite(this.api, path, this.sidPtr);
	}
	/** Every directory currently carrying the grant, in grant order. */
	get paths() {
		return [...this.standingPaths, ...this.revocablePaths];
	}
	/** Revoke every revocable grant (standing ACEs stay) and free the SID; reports every cleanup failure. */
	dispose() {
		const failures = [];
		for (const path of this.revocablePaths) try {
			revokeWrite(this.api, path, this.sidPtr);
		} catch (error) {
			failures.push(error);
		}
		try {
			if (!isNullPtr(this.api.localFree(this.sidPtr))) throwLastError(this.api, "LocalFree", "write SID");
		} catch (error) {
			failures.push(error);
		}
		if (failures.length > 0) throw new AggregateError(failures, `AclWriteGrant dispose completed with ${failures.length} cleanup failure(s)`);
	}
};
//#endregion
//#region lib/types/workspace-sid.js
/**
* The per-workspace write identity: a deterministic `S-1-4-x-y` SID derived
* from the canonical workspace path, whose ACEs form that workspace's write
* allowlist. Every confined execution of the same workspace — across
* sessions, server restarts, and calls — carries the SAME write SID, so the
* workspace-root ACE materializes once per workspace per machine (the
* grant's exact-ACE skip then makes every later provision O(1)) instead of
* once per session. The SID's power is defined solely by the ACEs that name
* it (which exist only on the workspace tree and the session's private temp
* directory), and only tokens minted for that workspace carry it — the SID
* string itself is not a secret. Temporary directories use a separate,
* per-directory identity from {@link tempWriteSid}; sharing the workspace
* identity with temp would let sibling sessions write one another's temp
* trees.
*
* The input MUST be the canonical workspace path (`realpathSync.native` on
* Windows — the sandbox-policy `resolveWorkspaceRoot` already applies it):
* canonicalization converges case/alias spellings, so two spellings of one
* workspace derive one SID; an as-spelled fallback path would mint a second
* identity for the same directory (self-healing, at the cost of one extra
* tree propagation). Renaming the workspace directory derives a new SID —
* the old standing ACEs are inert residue, and the next session re-propagates
* once.
* @module @deepseek-ai/dsh-sandbox-windows-acl/workspace-sid
*/
/**
* Derive the workspace's write SID (`S-1-4-x-y`; subauthorities 30-bit,
* matching the workspace-capability shape the token and ACE layers carry).
* @param workspaceRoot - the canonical workspace path.
* @returns the SDDL string form.
*/
function workspaceWriteSid(workspaceRoot) {
	const digest = createHash("sha256").update(workspaceRoot, "utf8").digest();
	return `S-1-4-${digest.readUInt32LE(0) % (2 ** 30 - 1) + 1}-${digest.readUInt32LE(4) % (2 ** 30 - 1) + 1}`;
}
/**
* Derive one private temp directory's write SID. The random directory path
* is the capability identity; a fixed third subauthority domain-separates
* the result from every two-subauthority workspace SID.
* @param tempDir - the private temp directory's absolute path.
* @returns the SDDL string form.
*/
function tempWriteSid(tempDir) {
	const digest = createHash("sha256").update("temp\0", "utf8").update(tempDir, "utf8").digest();
	return `S-1-4-${digest.readUInt32LE(0) % (2 ** 30 - 1) + 1}-${digest.readUInt32LE(4) % (2 ** 30 - 1) + 1}-1`;
}
//#endregion
//#region lib/types/index.js
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
/** Free one optional SID while retaining a failure for best-effort sibling cleanup. */
function freeSidBestEffort(api, sidPtr, label, failures) {
	if (sidPtr === void 0) return;
	try {
		if (!isNullPtr(api.localFree(sidPtr))) throwLastError(api, "LocalFree", label);
	} catch (error) {
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
var AclSandbox = class {
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
			if (!existsSync(absolute) || !statSync(absolute).isDirectory()) throw new Error(`AclSandbox writable dir does not exist or is not a directory: ${absolute}`);
			return absolute;
		});
		this.tempDirOption = options.tempDir;
		this.writeSid = options.writeSid;
		this.tempWriteSid = options.tempWriteSid;
		if (this.mode === "workspace-write" && this.writeSid === void 0) throw new Error("AclSandbox workspace-write requires a write SID — derive it from the workspace via workspaceWriteSid()");
		if (this.mode === "workspace-write" && this.tempDirOption === void 0) throw new Error("AclSandbox workspace-write requires an explicit private temp directory or null");
		if (this.mode === "read-only" && this.tempDirOption !== void 0 && this.tempDirOption !== null) throw new Error("AclSandbox read-only does not accept a temp directory");
		if (this.mode === "read-only" && (this.writeSid !== void 0 || this.tempWriteSid !== void 0)) throw new Error("AclSandbox read-only does not accept write SIDs");
		if (this.mode === "workspace-write" && this.tempDirOption !== null && this.tempWriteSid === void 0) throw new Error("AclSandbox workspace-write with temp requires a temp write SID — derive it via tempWriteSid()");
		if (this.tempDirOption === null && this.tempWriteSid !== void 0) throw new Error("AclSandbox temp write SID requires a temp directory");
		if (this.writeSid !== void 0 && this.tempWriteSid === this.writeSid) throw new Error("AclSandbox workspace and temp write SIDs must be distinct");
	}
	/** Resolved temp directory (available after init; null when temp grants are disabled). */
	get tempDir() {
		return this.tempDirResolved;
	}
	/** Create the restricted token and apply the capability-SID grants. Idempotent-unsafe: once per instance. */
	async init() {
		if (this.api !== void 0) throw new Error("AclSandbox is already initialized");
		const api = await win32();
		const currentToken = openCurrentProcessToken(api);
		let currentTokenOpen = true;
		let restrictedToken;
		try {
			const parseSid = (sid) => {
				const sidSlot = allocPtrSlot();
				if (api.convertStringSidToSidW(sid, sidSlot) === 0) throwLastError(api, "ConvertStringSidToSidW", sid);
				const parsedSid = decodePtr(sidSlot);
				if (parsedSid === null) throw new Win32Error("ConvertStringSidToSidW", api.getLastError(), sid);
				return parsedSid;
			};
			this.writeSidPtr = this.writeSid === void 0 ? void 0 : parseSid(this.writeSid);
			this.tempWriteSidPtr = this.tempWriteSid === void 0 ? void 0 : parseSid(this.tempWriteSid);
			const tempDir = this.mode === "read-only" || this.tempDirOption === null ? null : this.tempDirOption;
			/* v8 ignore next -- constructor validation requires workspace-write to supply
			an explicit temp directory or null; the other branches normalize to null. */
			if (tempDir === void 0) throw new Error("AclSandbox workspace-write temp directory was not resolved");
			if (tempDir !== null) {
				if (!existsSync(tempDir) || !statSync(tempDir).isDirectory()) throw new Error(`AclSandbox temp dir does not exist or is not a directory: ${tempDir}`);
				assertPrivateTempDisjoint(this.writableDirs, tempDir);
			}
			this.tempDirResolved = tempDir;
			if (this.manageDacls) {
				if (this.writeSidPtr !== void 0) {
					for (const path of this.writableDirs) grantWrite(api, path, this.writeSidPtr);
					if (tempDir !== null && this.tempWriteSidPtr !== void 0) {
						this.grantedPaths.push({
							path: tempDir,
							sidPtr: this.tempWriteSidPtr
						});
						grantWrite(api, tempDir, this.tempWriteSidPtr);
					}
				}
			}
			const logonSid = findLogonSid(api, currentToken);
			this.sidAllocations.push(logonSid);
			const worldSid = makeWellKnownSid(api, 1);
			this.sidAllocations.push(worldSid);
			restrictedToken = createRestrictedToken(api, currentToken, logonSid, [this.writeSidPtr, this.tempWriteSidPtr].filter((sid) => sid !== void 0), { world: worldSid }, this.mode);
			this.token = restrictedToken;
			setTokenDefaultDaclGrant(api, restrictedToken, this.tempWriteSidPtr ?? this.writeSidPtr ?? worldSid);
			if (api.closeHandle(currentToken) === 0) throwLastError(api, "CloseHandle", "current process token");
			currentTokenOpen = false;
			this.api = api;
		} catch (error) {
			const cleanupFailures = [];
			if (currentTokenOpen && api.closeHandle(currentToken) === 0) cleanupFailures.push(new Win32Error("CloseHandle", api.getLastError(), "current process token after init failure"));
			if (restrictedToken !== void 0 && api.closeHandle(restrictedToken) === 0) cleanupFailures.push(new Win32Error("CloseHandle", api.getLastError(), "restricted token after init failure"));
			for (const grant of this.grantedPaths) try {
				revokeWrite(api, grant.path, grant.sidPtr);
			} catch (cleanupError) {
				cleanupFailures.push(cleanupError);
			}
			for (const [label, sidPtr] of [["workspace write SID", this.writeSidPtr], ["temp write SID", this.tempWriteSidPtr]]) freeSidBestEffort(api, sidPtr, label, cleanupFailures);
			for (const sidPtr of this.sidAllocations.splice(0)) freeSidBestEffort(api, sidPtr, "init SID allocation", cleanupFailures);
			this.token = void 0;
			this.writeSidPtr = void 0;
			this.tempWriteSidPtr = void 0;
			this.tempDirResolved = void 0;
			this.grantedPaths = [];
			if (cleanupFailures.length > 0) throw new AggregateError([error, ...cleanupFailures], `AclSandbox init failed and ${cleanupFailures.length} cleanup operation(s) also failed`);
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
		if (api === void 0 || token === void 0) throw new Error("AclSandbox is not initialized: call init() first");
		const args = options.args ?? [];
		const cwd = options.cwd ?? process.cwd();
		if (options.stdio === "inherit") {
			const native = spawnSandboxedInherited(api, token, {
				command: options.command,
				args,
				cwd
			});
			let exitCodePromise;
			return {
				pid: native.pid,
				wait: async () => {
					exitCodePromise ??= Promise.resolve(waitForExit(api, native.process));
					const exitCode = await exitCodePromise;
					if (api.closeHandle(native.job) === 0) throwLastError(api, "CloseHandle", "kill-on-close job");
					return {
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
						exitCode
					};
				}
			};
		}
		const native = spawnSandboxed(api, token, {
			command: options.command,
			args,
			cwd
		});
		const stdout = drainPipe(api, native.stdoutRead);
		const stderr = drainPipe(api, native.stderrRead);
		let exitCodePromise;
		return {
			pid: native.pid,
			wait: async () => {
				const stdoutBuffer = await stdout;
				const stderrBuffer = await stderr;
				exitCodePromise ??= Promise.resolve(waitForExit(api, native.process));
				return {
					stdout: stdoutBuffer,
					stderr: stderrBuffer,
					exitCode: await exitCodePromise
				};
			}
		};
	}
	/**
	* Revoke the revocable (temp) grants, free the SID, close the token; the
	* standing workspace ACEs stay (the reuse cache). Reports every cleanup
	* failure.
	*/
	dispose() {
		const api = this.api;
		if (api === void 0) return;
		const failures = [];
		if (this.manageDacls) for (const grant of this.grantedPaths) try {
			revokeWrite(api, grant.path, grant.sidPtr);
		} catch (error) {
			failures.push(error);
		}
		for (const [label, sidPtr] of [["workspace write SID", this.writeSidPtr], ["temp write SID", this.tempWriteSidPtr]]) freeSidBestEffort(api, sidPtr, label, failures);
		const token = this.token;
		/* v8 ignore next -- init assigns this.api only after this.token, so an initialized instance always
		has its token; the guard mirrors the write-SID guard. */
		if (token !== void 0) try {
			if (api.closeHandle(token) === 0) throwLastError(api, "CloseHandle", "restricted token");
		} catch (error) {
			failures.push(error);
		}
		for (const sidPtr of this.sidAllocations.splice(0)) freeSidBestEffort(api, sidPtr, "init SID allocation", failures);
		this.api = void 0;
		this.token = void 0;
		this.writeSidPtr = void 0;
		this.tempWriteSidPtr = void 0;
		this.grantedPaths = [];
		if (failures.length > 0) throw new AggregateError(failures, `AclSandbox dispose completed with ${failures.length} cleanup failure(s)`);
	}
};
//#endregion
export { quoteArg as a, Win32Error as c, AclWriteGrant as i, tempWriteSid as n, assertTempRootOutsideWorkspace as o, workspaceWriteSid as r, win32 as s, AclSandbox as t };
