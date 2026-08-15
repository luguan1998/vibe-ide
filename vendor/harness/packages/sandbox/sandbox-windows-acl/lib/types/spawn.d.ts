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
import type { NativePtr, Win32Bindings } from './ffi.ts';
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
export declare function quoteArg(argument: string): string;
/**
 * Build the single command line CreateProcess parses from program + argv.
 * @param program - the executable (argv[0]).
 * @param args - the remaining argv entries.
 * @returns the joined, quoted command line.
 */
export declare function buildCommandLine(program: string, args: readonly string[]): string;
/** A confined child spawned with piped stdio: process handle plus the pipe read ends to drain. */
export interface SpawnedNative {
    pid: number;
    process: NativePtr;
    stdoutRead: NativePtr;
    stderrRead: NativePtr;
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
export declare function spawnSandboxed(api: Win32Bindings, token: NativePtr, options: {
    command: string;
    args: readonly string[];
    cwd: string;
}): SpawnedNative;
/**
 * Drain one pipe read end to a Buffer via non-blocking PeekNamedPipe polling.
 * @param api - the binding table.
 * @param handle - the pipe read end to drain (closed when done).
 * @returns the complete pipe contents.
 */
export declare function drainPipe(api: Win32Bindings, handle: NativePtr): Promise<Buffer>;
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
export declare function waitForExit(api: Win32Bindings, process: NativePtr): number;
/** A confined child spawned with inherited stdio: process handle plus its kill-on-close job. */
export interface SpawnedInherited {
    pid: number;
    process: NativePtr;
    /** Kill-on-close job the child was placed in; caller closes it after the child exits. */
    job: NativePtr;
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
export declare function spawnSandboxedInherited(api: Win32Bindings, token: NativePtr, options: {
    command: string;
    args: readonly string[];
    cwd: string;
}): SpawnedInherited;
//# sourceMappingURL=spawn.d.ts.map