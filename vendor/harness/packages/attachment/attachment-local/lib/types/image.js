/** Raster inspection: full decode at admission, header-only probe on verified reads. */
import sharp from 'sharp';
import { AttachmentError } from '@deepseek-ai/dsh-attachment';
const MEDIA_TYPES = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};
async function imageMetadata(image) {
    const metadata = await image.metadata();
    const mediaType = MEDIA_TYPES[metadata.format];
    if (mediaType === undefined) {
        throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE');
    }
    return { mediaType, width: metadata.width, height: metadata.height };
}
/**
 * Parse a supported raster's header and return its intrinsic metadata without
 * decoding pixels. Digest-verified reads use this: admission already proved
 * that these exact bytes decode completely, so the read path only re-derives
 * the reference fields instead of paying the full-raster decode again.
 * @param data - complete encoded image bytes.
 * @returns verified format and dimensions.
 */
export async function probeImage(data) {
    try {
        return await imageMetadata(sharp(data, { failOn: 'error', limitInputPixels: false }));
    }
    catch (error) {
        if (error instanceof AttachmentError)
            throw error;
        throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error });
    }
}
/**
 * Fully decode a supported raster and return its intrinsic metadata.
 * @param data - complete encoded image bytes.
 * @param maxPixels - decoded-pixel admission limit.
 * @returns verified format and dimensions.
 */
export async function detectImage(data, maxPixels) {
    try {
        const image = sharp(data, { failOn: 'error', limitInputPixels: false });
        const detected = await imageMetadata(image);
        if (maxPixels !== undefined && detected.width * detected.height > maxPixels) {
            throw new AttachmentError('Image exceeds the configured decoded-pixel limit.', 'IMAGE_TOO_MANY_PIXELS');
        }
        await image.raw().toBuffer();
        return detected;
    }
    catch (error) {
        if (error instanceof AttachmentError)
            throw error;
        throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error });
    }
}
//# sourceMappingURL=image.js.map