/**
 * Windows ABI constants for the ACL-sandbox backend.
 *
 * Every value was verified against the actual MinGW Windows headers on this
 * machine (C:\Strawberry\c\x86_64-w64-mingw32\include\) and cross-checked at
 * runtime by verify/abi-probe.cpp (same numbers; static_asserts passed).
 * Regenerate the probe with:
 *   g++ -std=c++20 -municode -O2 -o abi-probe.exe abi-probe.cpp -ladvapi32 && .\abi-probe.exe
 *
 * The port intentionally excludes two pieces of the original POC
 * (github.com/huoyaoyuan/windows-acl-restrict-poc @ 10e4dfb), both verified
 * empirically on Windows 11 build 26200:
 *  - S-1-2-1 (console logon SID) in the restricting list: the POC created it
 *    via CreateWellKnownSid(WinLocalLogonSid) which fails here with
 *    ERROR_INVALID_PARAMETER (87), leaving a garbage SID that makes
 *    CreateRestrictedToken fail with ERROR_INVALID_SID (1337); using the
 *    correct WinConsoleLogonSid does produce a valid S-1-2-1, but the child
 *    then still dies with STATUS_DLL_INIT_FAILED (0xC0000142) whenever
 *    CREATE_NO_WINDOW / CREATE_NEW_CONSOLE is used.
 *  - Console isolation: under this restriction scheme a hidden console is not
 *    attainable, so children share the host console (stdio redirection is
 *    pipe-based and unaffected).
 * @module @deepseek-ai/dsh-sandbox-windows-acl/win32-abi
 */
/** TOKEN_ASSIGN_PRIMARY: required to create a process with the token (CreateProcessAsUser). */
export declare const TOKEN_ASSIGN_PRIMARY = 1;
/** TOKEN_DUPLICATE: required to duplicate a token (DuplicateTokenEx). */
export declare const TOKEN_DUPLICATE = 2;
/** TOKEN_QUERY: required to read token information (GetTokenInformation). */
export declare const TOKEN_QUERY = 8;
/** TOKEN_ADJUST_DEFAULT: required to change a token's default DACL. */
export declare const TOKEN_ADJUST_DEFAULT = 128;
/**
 * SE_GROUP_LOGON_ID: marks a token group SID as the logon SID (compared with
 * `>>> 0` — the flag's high bit makes it negative as a signed 32-bit number).
 */
export declare const SE_GROUP_LOGON_ID = 3221225472;
/** STANDARD_RIGHTS_WRITE (== READ_CONTROL): the standard-rights component of generic write access. */
export declare const STANDARD_RIGHTS_WRITE = 131072;
/** FILE_GENERIC_WRITE: every file-write permission bit plus SYNCHRONIZE. */
export declare const FILE_GENERIC_WRITE = 1179926;
/** DELETE: remove or rename the object (winnt.h line ~3009). */
export declare const DELETE = 65536;
/** FILE_DELETE_CHILD: remove or rename a directory's children (winnt.h line ~5907). */
export declare const FILE_DELETE_CHILD = 64;
/**
 * GRANT_MASK: FILE_GENERIC_WRITE minus READ_CONTROL plus DELETE and
 * FILE_DELETE_CHILD — the write+delete access mask the capability-SID ACEs grant
 * (displays as "Modify" in Explorer/icacls). WRITE_DAC/WRITE_OWNER are
 * deliberately excluded: they would let the confined child take ownership or
 * rewrite DACLs.
 */
export declare const GRANT_MASK: number;
/**
 * FILE_ALL_ACCESS (winnt.h line ~2789: STANDARD_RIGHTS_REQUIRED | SYNCHRONIZE
 * | 0x1FF): full file-object access. The mask of the ACE merged into the
 * restricted token's DEFAULT DACL — the token holder must keep full access to
 * every NEW object it creates (pipes included), and the ACE must name a
 * restricting SID so the write pass-2 check passes at creation.
 */
export declare const FILE_ALL_ACCESS = 2032127;
/** DISABLE_MAX_PRIVILEGE: strip the token's maximum-privilege elevation so the confined child cannot escalate. */
export declare const DISABLE_MAX_PRIVILEGE = 1;
/** LUA_TOKEN: produce a limited-user (filtered admin) token. */
export declare const LUA_TOKEN = 4;
/** WRITE_RESTRICTED: intersect write access with the restricting SIDs' ACL grants — the sandbox's core mechanism. */
export declare const WRITE_RESTRICTED = 8;
/** WinWorldSid: S-1-1-0 (Everyone) — the only well-known SID the restricted tokens use (keep-alive group; see token.ts). */
export declare const WinWorldSid = 1;
/** TokenGroups: GetTokenInformation class returning the token's group SIDs. */
export declare const TokenGroups = 2;
/** TokenDefaultDacl: the token's default DACL — the DACL every NEW object created without an explicit SD takes. */
export declare const TokenDefaultDacl = 6;
/** DACL_SECURITY_INFORMATION: read/write only the DACL of a security descriptor. */
export declare const DACL_SECURITY_INFORMATION = 4;
/** PROCESS_QUERY_INFORMATION: read exit status and times of a process handle. */
export declare const PROCESS_QUERY_INFORMATION = 1024;
/** SE_FILE_OBJECT: the trustee path names a filesystem object. */
export declare const SE_FILE_OBJECT = 1;
/** TRUSTEE_IS_UNKNOWN: TRUSTEE_TYPE unknown (TrusteeForm carries the shape). */
export declare const TRUSTEE_IS_UNKNOWN = 0;
/** TRUSTEE_IS_SID: TRUSTEE_FORM — Trustee.ptstrName is a SID pointer. */
export declare const TRUSTEE_IS_SID = 0;
/** NO_MULTIPLE_TRUSTEE: Trustee.pMultipleTrustee is null. */
export declare const NO_MULTIPLE_TRUSTEE = 0;
/** GRANT_ACCESS: SetEntriesInAclW adds the entry as an allow ACE. */
export declare const GRANT_ACCESS = 1;
/** REVOKE_ACCESS: SetEntriesInAclW removes the matching allow ACE. */
export declare const REVOKE_ACCESS = 4;
/**
 * SUB_CONTAINERS_AND_OBJECTS_INHERIT: the ACE applies to the directory, its
 * subdirectories, and files (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE).
 */
export declare const SUB_CONTAINERS_AND_OBJECTS_INHERIT = 3;
/**
 * STARTF_USESTDHANDLES: STARTUPINFOW dwFlags — the child uses the hStd*
 * handles, required because Node clears stdio inheritability at startup.
 */
export declare const STARTF_USESTDHANDLES = 256;
/** HANDLE_FLAG_INHERIT: SetHandleInformation flag re-enabling handle inheritance for the spawned child's stdio handles. */
export declare const HANDLE_FLAG_INHERIT = 1;
/** INFINITE: never-timeout wait value. */
export declare const INFINITE = 4294967295;
/** MAX_PATH: legacy path length bound. */
export declare const MAX_PATH = 260;
/** CREATE_SUSPENDED: create the child with its primary thread suspended until ResumeThread. */
export declare const CREATE_SUSPENDED = 4;
/** STD_INPUT_HANDLE: GetStdHandle selector for the standard input. */
export declare const STD_INPUT_HANDLE = -10;
/** STD_OUTPUT_HANDLE: GetStdHandle selector for the standard output. */
export declare const STD_OUTPUT_HANDLE = -11;
/** STD_ERROR_HANDLE: GetStdHandle selector for the standard error. */
export declare const STD_ERROR_HANDLE = -12;
/** FORMAT_MESSAGE_FROM_SYSTEM: format the message from the system message table. */
export declare const FORMAT_MESSAGE_FROM_SYSTEM = 4096;
/** FORMAT_MESSAGE_IGNORE_INSERTS: skip insert-sequence substitution. */
export declare const FORMAT_MESSAGE_IGNORE_INSERTS = 512;
/** ERROR_SUCCESS: the operation succeeded. */
export declare const ERROR_SUCCESS = 0;
/** ERROR_INSUFFICIENT_BUFFER: a size-probe call succeeded but needs a larger buffer. */
export declare const ERROR_INSUFFICIENT_BUFFER = 122;
/** ERROR_BROKEN_PIPE: the pipe's other end has closed. */
export declare const ERROR_BROKEN_PIPE = 109;
/** ERROR_NO_DATA: the pipe is being closed. */
export declare const ERROR_NO_DATA = 232;
/** ERROR_LOCK_VIOLATION: a byte-range lock conflicts with an existing lock (winerror.h line ~78). */
export declare const ERROR_LOCK_VIOLATION = 33;
/** GENERIC_READ: generic read access (winnt.h line ~3028). */
export declare const GENERIC_READ = 2147483648;
/** GENERIC_WRITE: generic write access (winnt.h line ~3029). */
export declare const GENERIC_WRITE = 1073741824;
/** FILE_SHARE_READ: other opens may read (winnt.h line ~5949). */
export declare const FILE_SHARE_READ = 1;
/** FILE_SHARE_WRITE: other opens may write (winnt.h line ~5950). */
export declare const FILE_SHARE_WRITE = 2;
/** FILE_SHARE_DELETE: other opens may delete (winnt.h line ~5951) — deliberately NOT used for lock files. */
export declare const FILE_SHARE_DELETE = 4;
/** OPEN_ALWAYS: create the lock file if absent, open it otherwise (fileapi.h line ~21). */
export declare const OPEN_ALWAYS = 4;
/** LOCKFILE_EXCLUSIVE_LOCK: request an exclusive byte-range lock. */
export declare const LOCKFILE_EXCLUSIVE_LOCK = 2;
/** LOCKFILE_FAIL_IMMEDIATELY: fail with ERROR_LOCK_VIOLATION instead of waiting. */
export declare const LOCKFILE_FAIL_IMMEDIATELY = 1;
/** ACCESS_ALLOWED_ACE_TYPE: an access-allowed ACE granting the mask to the trustee. */
export declare const ACCESS_ALLOWED_ACE_TYPE = 0;
/** SID_MAX_SUB_AUTHORITIES: the most subauthorities a SID may carry. */
export declare const SID_MAX_SUB_AUTHORITIES = 15;
/** INHERITED_ACE: the ACE was inherited from the parent object, not stored explicitly. */
export declare const INHERITED_ACE = 16;
/** JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: the child dies when the runner's last job handle closes — the orphan-child backstop. */
export declare const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 8192;
/** JobObjectExtendedLimitInformation: JOBOBJECTINFOCLASS for the extended limit structure. */
export declare const JobObjectExtendedLimitInformation = 9;
/** sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION), verified by abi-probe. */
export declare const JOBOBJECT_EXTENDED_LIMIT_SIZE = 144;
/**
 * LimitFlags offset inside JOBOBJECT_EXTENDED_LIMIT_INFORMATION
 * (BasicLimitInformation@0 + PerProcessUserTimeLimit@0 +
 * PerJobUserTimeLimit@8), verified by abi-probe.
 */
export declare const JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET = 16;
/** SECURITY_MAX_SID_SIZE: maximum SID byte size. */
export declare const SECURITY_MAX_SID_SIZE = 68;
/** SID_AND_ATTRIBUTES stride: { PSID Sid @0 (8); DWORD Attributes @8 (4) } + pad. */
export declare const SID_AND_ATTRIBUTES_SIZE = 16;
/** TOKEN_GROUPS.Groups[] starts at offset 8 (GroupCount @0 + alignment). */
export declare const TOKEN_GROUPS_OFFSET = 8;
/** sizeof(EXPLICIT_ACCESS_W): perms@0 mode@4 inheritance@8 Trustee@16. */
export declare const EXPLICIT_ACCESS_W_SIZE = 48;
/** Trustee offset inside EXPLICIT_ACCESS_W. */
export declare const TRUSTEE_W_OFFSET = 16;
/** ptstrName offset inside TRUSTEE_W (=> 40 inside EXPLICIT_ACCESS_W). */
export declare const TRUSTEE_W_PTSTRNAME_OFFSET = 24;
/** sizeof(STARTUPINFOW), verified by abi-probe. */
export declare const STARTUPINFOW_SIZE = 104;
/** sizeof(PROCESS_INFORMATION), verified by abi-probe. */
export declare const PROCESS_INFORMATION_SIZE = 24;
//# sourceMappingURL=win32-abi.d.ts.map