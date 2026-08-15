/** Public configuration and typed failures for the combined session-query service. */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** Default maximum `before`/`after` raw-event window. */
export const SESSION_QUERY_READ_WINDOW_MAX = 50;
/** Default maximum number of concurrent persisted-log inspections in one batch read. */
export const SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY = 4;
/** Typed session-query failure whose `code` is one closed taxonomy member. */
export class SessionQueryError extends HarnessError {
    // The base stores the value; this signature narrows its open string code.
    // oxlint-disable-next-line typescript/no-useless-constructor
    constructor(message, code, options) {
        super(message, code, options);
    }
}
//# sourceMappingURL=config.js.map