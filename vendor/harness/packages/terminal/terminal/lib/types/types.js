/**
 * Types shared by PTY backends, the owner-scoped registry, and tool consumers.
 * Runtime service code lives in `./index.ts`.
 * @module @deepseek-ai/dsh-terminal/types
 */
/**
 * Backend-reported failure to clean partial resources after unpublished setup failed.
 * @param spawnError - original setup or cancellation failure.
 * @param cleanupError - failure that may leave backend-owned resources alive.
 */
export class TerminalBackendCleanupError extends AggregateError {
    spawnError;
    cleanupError;
    constructor(spawnError, cleanupError) {
        super([spawnError, cleanupError], 'PTY backend startup and cleanup both failed');
        this.spawnError = spawnError;
        this.cleanupError = cleanupError;
        this.name = 'TerminalBackendCleanupError';
    }
}
//# sourceMappingURL=types.js.map