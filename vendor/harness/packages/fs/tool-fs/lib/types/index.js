/**
 * Model-facing read, read_image, write, and edit tools over `ctx.fs`. This package owns schemas, validation,
 * read windows, formatting, and observation events, never a concrete provider. An optional
 * event policy supplies mutation guards; without one the tools use unconditional provider calls.
 * @module @deepseek-ai/dsh-tool-fs
 */
import z from '@deepseek-ai/schemastery';
import { applyReadTool, READ_LIMIT, STREAM_MIN_SIZE } from "./read.js";
import { applyWriteTool } from "./write.js";
import { applyEditTool } from "./edit.js";
import { applyReadImageTool } from "./read-image.js";
import { READ_MAX_BYTES, READ_MAX_LINE_LENGTH } from "./read-render.js";
import { FsSandboxController } from "./sandbox.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs';
/** Services required by the filesystem tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt'];
export const Config = z.object({
    readLimit: z.number().default(READ_LIMIT),
    readMaxLineLength: z.number().default(READ_MAX_LINE_LENGTH),
    readMaxBytes: z.number().default(READ_MAX_BYTES),
    readStreamMinSize: z.number().default(STREAM_MIN_SIZE),
});
/** Every read cap counts lines/chars/bytes — a positive integer, or windowing arithmetic misbehaves silently. */
function assertPositiveInteger(name, value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`tool-fs: ${name} must be a positive integer`);
    }
}
/** Register the full `read`/`write`/`edit` filesystem tool suite, plus `read_image` while `attachments` is mounted. */
export function apply(ctx, config) {
    // schemastery (Config) has already filled every defaulted field.
    const resolved = config;
    assertPositiveInteger('readLimit', resolved.readLimit);
    assertPositiveInteger('readMaxLineLength', resolved.readMaxLineLength);
    assertPositiveInteger('readMaxBytes', resolved.readMaxBytes);
    assertPositiveInteger('readStreamMinSize', resolved.readStreamMinSize);
    applyReadTool(ctx, {
        limit: resolved.readLimit,
        maxLineLength: resolved.readMaxLineLength,
        maxBytes: resolved.readMaxBytes,
        streamMinSize: resolved.readStreamMinSize,
    });
    // read_image is composition-conditional: without a mounted attachment store
    // the deployment cannot durably commit image bytes, so the tool never
    // registers; the execute body keeps a defensive re-check for direct callers.
    ctx.inject(['attachments'], (imageCtx) => {
        applyReadImageTool(imageCtx);
    });
    // One escalation API shared by both mutating tools: advertisement gating,
    // per-call policy resolution, and denial-marker mapping, all keyed off whether
    // the mounted ctx.fs confines (ctx.fs.sandboxMode).
    const sandbox = new FsSandboxController(ctx);
    applyWriteTool(ctx, sandbox);
    applyEditTool(ctx, sandbox);
}
//# sourceMappingURL=index.js.map