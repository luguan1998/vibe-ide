/**
 * Cordis-free storage mechanics for the local spill backend: private
 * session-scoped directory selection, safe-name derivation, path-traversal
 * protection, and the exclusive owner-only write. Kept out of the service class
 * (like `dsh-bash-local`'s `run.ts`) so the filesystem behavior is unit-testable
 * without a `ctx` and without the OS temp dir.
 *
 * @module @deepseek-ai/dsh-spill-local/store
 */
/**
 * The default spill root: a private (0700) per-process directory under the OS
 * tmpdir, created lazily. Predictable world-readable paths would let other
 * local users read spilled tool output or pre-create symlinks; `mkdtemp` gives
 * an unpredictable suffix and 0700 semantics.
 *
 * @returns The lazily-created private spill root.
 */
export declare function privateRoot(): string;
/**
 * Encode an arbitrary string as one safe path segment, injectively over ALL JS
 * (UTF-16) strings. A session id / suggested name is untrusted input, so this
 * neutralizes `../`, absolute paths, NUL, and separators before any filesystem
 * use. Each code unit is kept literal (`[A-Za-z0-9._-]`, minus `~`) or escaped
 * as `~XXXX`; `~` is itself escaped, so the mapping is reversible and distinct
 * inputs never collide. The whole-segment tokens `.`/`..` are escaped so they
 * can never traverse. An empty string encodes to `~` (never an empty segment).
 * (Mirrors the JSONL persistence backend's `encodeSegment`.)
 *
 * @param raw The untrusted string to encode as one safe path segment.
 * @returns An injective, filesystem-safe single path segment.
 */
export declare function encodeSegment(raw: string): string;
/**
 * The session-scoped directory: `<root>/session-<hash(sessionId)>`, a short stable hash.
 *
 * @param root The spill root directory.
 * @param sessionId The owning session id to hash into a stable directory name.
 * @returns The absolute session-scoped spill directory path.
 */
export declare function sessionDir(root: string, sessionId: string): string;
/** Options for {@link saveTextFile} — the resolved root and the request fields the store needs. */
export interface SaveTextOptions {
    /** The spill root directory (configured or the lazy private default). */
    root: string;
    /** The owning session id (scopes the directory). */
    sessionId: string;
    /** Caller-suggested base name; sanitized to one safe segment before use. */
    suggestedName: string;
    /** The full text to persist. */
    content: string;
}
/** A written spill file. */
export interface SavedText {
    path: string;
    bytes: number;
}
/**
 * Write `content` to a fresh file under the session-scoped directory and return
 * its path + byte length. The filename is a random hex prefix plus the
 * sanitized `suggestedName`, so it is unpredictable (defeats symlink planting in
 * a shared root) AND stays readable. The open is exclusive + owner-only
 * (`'wx', 0o600`): it fails on any existing path — symlink or not — so a
 * pre-planted target cannot redirect the write.
 *
 * @param options The resolved root and request fields required to save the file.
 * @returns The written file path and UTF-8 byte length.
 */
export declare function saveTextFile(options: SaveTextOptions): Promise<SavedText>;
//# sourceMappingURL=store.d.ts.map