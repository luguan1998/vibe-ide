/** Register the Tool call tree, details renderer, and built-in atomic views. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required service: the slot registry that owns both Tool render seats. */
export declare const inject: string[];
/**
 * Mount the whole-Tool renderers and built-in atomic Tool registrations.
 * @param ctx - Client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=apply.d.ts.map