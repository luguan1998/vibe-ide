/**
 * Harness request-history conversion into pi-ai's Context vocabulary.
 *
 * @module dsh-llm-pi-ai/context
 */
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { Context as PiContext } from '@earendil-works/pi-ai';
/**
 * Convert text-only harness history to a synchronous pi-ai Context. Tool
 * result names are recovered from preceding assistant tool calls.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @returns the pi-ai context; `tools` is omitted when the request declares none.
 */
export declare function toPiContext(options: GenerateOptions): PiContext;
/**
 * Convert harness history to a pi-ai Context while resolving durable images.
 * Tool result names are recovered from preceding assistant tool calls.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @param attachments - durable byte resolver for image references.
 * @returns the asynchronously resolved pi-ai context.
 */
export declare function toPiContext(options: GenerateOptions, attachments: AttachmentStore): Promise<PiContext>;
//# sourceMappingURL=context.d.ts.map