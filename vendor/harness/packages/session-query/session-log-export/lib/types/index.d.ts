/** Web Session-log download command over the host endpoint owned by ApiProxy. */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "session-log-download";
export declare const inject: string[];
/**
 * Register the Web-only `/export` command that the browser download plugin observes.
 * @param ctx - Host context carrying the human-command registry.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map