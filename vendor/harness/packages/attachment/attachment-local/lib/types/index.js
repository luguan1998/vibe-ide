/** Local durable attachment backend rooted below `DSH_HOME`. @module @deepseek-ai/dsh-attachment-local */
import { join, resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { readImageFile, saveImageFile, validateImageFile } from "./store.js";
export { detectImage } from "./image.js";
export { readImageFile, saveImageFile, validateImageFile } from "./store.js";
/** Default maximum encoded bytes for one image. */
export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Default maximum images in one prompt. */
export const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20;
/** Default maximum aggregate image bytes in one prompt. */
export const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 100 * 1024 * 1024;
/** Default maximum intrinsic pixels for one image. */
export const DEFAULT_MAX_IMAGE_PIXELS = 40_000_000;
/** Persistent content-addressed local attachment store. */
export class LocalAttachmentStore extends AttachmentStore {
    static Config = z.object({
        dshHome: z.string(),
        maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
        maxImagesPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_MESSAGE),
        maxMessageImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_IMAGE_BYTES),
        maxImagePixels: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_PIXELS),
    });
    /** Absolute versioned storage root. */
    root;
    imageLimits;
    constructor(ctx, config) {
        super(ctx);
        this.root = resolve(join(resolveDshHome(config.dshHome), 'attachments', 'v1'));
        this.imageLimits = Object.freeze({
            maxImageBytes: config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
            maxImagesPerMessage: config.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES_PER_MESSAGE,
            maxMessageImageBytes: config.maxMessageImageBytes ?? DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
            maxImagePixels: config.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS,
            mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
        });
    }
    async validateImage(input) {
        await validateImageFile(input, this.imageLimits);
    }
    async saveImage(input) {
        return saveImageFile(this.root, input, this.imageLimits);
    }
    async readImage(ref, signal) {
        return readImageFile(this.root, ref, signal);
    }
}
export default LocalAttachmentStore;
//# sourceMappingURL=index.js.map