/**
 * Error vocabulary of the domain data form.
 * @module @deepseek-ai/dsh-storage-domain/src/error
 */
/**
 * Error thrown by the domain layer. The `code` is the stable contract
 * consumers may switch on; `message` is diagnostic prose. Backend failures
 * (`backend-not-found`, `version-mismatch`, …) pass through as
 * `StorageError` — the domain layer does not rewrap them.
 */
export class DomainError extends Error {
    code;
    name = 'DomainError';
    /** Present exactly when `code` is `invalid-record`. */
    detail;
    /**
     * @param code - Stable discriminant for the failure class.
     * @param message - Human-readable diagnostic detail.
     * @param options - Standard error options plus the `invalid-record` location.
     */
    constructor(code, message, options) {
        super(message, options);
        this.code = code;
        if (options?.detail)
            this.detail = options.detail;
    }
}
//# sourceMappingURL=error.js.map