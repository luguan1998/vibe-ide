/**
 * Error vocabulary for the storage hub and its backends.
 * @module @deepseek-ai/dsh-storage/src/error
 */
/**
 * Error thrown by the hub and by backend implementations. The `code` is the
 * stable contract consumers may switch on; `message` is diagnostic prose.
 */
export class StorageError extends Error {
    code;
    name = 'StorageError';
    /**
     * @param code - Stable discriminant for the failure class.
     * @param message - Human-readable diagnostic detail.
     * @param options - Standard error options (`cause`).
     */
    constructor(code, message, options) {
        super(message, options);
        this.code = code;
    }
}
//# sourceMappingURL=error.js.map