/**
 * The model-facing `read_image` tool: reads a PNG/JPEG/WebP/GIF file, durably
 * commits its bytes through the attachment service (the same lifecycle as a
 * user-uploaded image), and returns an image block so the image enters model
 * context from the next request onward.
 *
 * The route gate is deliberately stricter than the host upload preflight: a
 * tool result enters durable session history, so emitting an image on a route
 * that cannot carry it would break that route's continuation. Unknown
 * capability therefore refuses instead of relying on the adapter guard.
 * @module @deepseek-ai/dsh-tool-fs/src/read-image
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
/** The canonical outcome declared by the `read_image` output schema. */
export interface ImageReadValue {
    path: string;
    image: {
        attachmentId: string;
        mediaType: ImageMediaType;
        bytes: number;
        width: number;
        height: number;
        name?: string;
    };
}
/**
 * Map a model-supplied path to its declared image media type by extension.
 * @param filePath - the raw `file_path` argument (not yet resolved).
 * @returns the declared media type, or undefined when the path does not claim an image.
 */
export declare function imageMediaTypeForPath(filePath: string): ImageMediaType | undefined;
/**
 * Enforce the strict image-capability gate for the calling route. Resolves the
 * session's latest routed provider/model (request header config, then agent
 * options) and requires the exact resolved route to declare `image` input explicitly.
 * @param ctx - the plugin context used to resolve the optional `llm` service.
 * @param exec - the tool-execution context supplying the calling agent.
 * @param requestedPath - the raw, not-yet-resolved path rendered in refusal messages.
 */
export declare function assertImageCapableRoute(ctx: Context, exec: ToolExecution, requestedPath: string): Promise<void>;
/**
 * Re-brand a canonical image outcome into the durable attachment reference an
 * `ImageBlock` carries.
 * @param image - the canonical image metadata from the output schema.
 * @returns the branded attachment reference.
 */
export declare function imageRefFromValue(image: ImageReadValue['image']): ImageAttachmentRef;
/**
 * Format an image read as the model-facing envelope beside its image block.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param image - the canonical image metadata to summarize.
 * @returns the model-facing envelope; the image itself rides the adjacent image block.
 */
export declare function formatImageReadOutput(displayPath: string, image: ImageReadValue['image']): string;
/**
 * Register the `read_image` tool into the given context. The composing plugin
 * owns the attachments gate: `src/index.ts` calls this inside
 * `ctx.inject(['attachments'], …)` so the tool exists only while a durable
 * store is mounted. Execution still re-checks `ctx.get('attachments')` for
 * direct callers and gates on the calling route's declared image input.
 * @param ctx - the registration scope; execution uses its `fs` service plus
 *   the optional `attachments`/`llm` services.
 */
export declare function applyReadImageTool(ctx: Context): void;
//# sourceMappingURL=read-image.d.ts.map