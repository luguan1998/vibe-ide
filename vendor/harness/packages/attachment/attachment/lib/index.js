// vendor/harness/packages/attachment/attachment/src/index.ts
import { Service } from "@deepseek-ai/cordis";

// vendor/harness/packages/attachment/attachment/src/error.ts
var IMAGE_ADMISSION_ERROR_CODES = [
  "TOO_MANY_IMAGES",
  "IMAGES_TOO_LARGE",
  "UNSUPPORTED_IMAGE_TYPE",
  "INVALID_IMAGE_BASE64",
  "INVALID_IMAGE",
  "IMAGE_TYPE_MISMATCH",
  "IMAGE_TOO_LARGE",
  "IMAGE_TOO_MANY_PIXELS"
];
var IMAGE_ADMISSION_ERROR_CODE_SET = new Set(IMAGE_ADMISSION_ERROR_CODES);
var AttachmentError = class extends Error {
  /** Stable machine-routing failure code. */
  code;
  /**
   * @param message - human-readable failure description without raw bytes or host paths.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  constructor(message, code, options) {
    super(message, options);
    this.name = "AttachmentError";
    this.code = code;
  }
};
function isImageAdmissionError(error) {
  return error instanceof Error && "code" in error && typeof error.code === "string" && IMAGE_ADMISSION_ERROR_CODE_SET.has(error.code);
}

// vendor/harness/packages/attachment/attachment/src/brand.ts
function AttachmentId(value) {
  return value;
}

// vendor/harness/packages/attachment/attachment/src/index.ts
var AttachmentStore = class extends Service {
  constructor(ctx) {
    super(ctx, "attachments");
  }
  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  async saveImages(inputs) {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits;
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError("Image batch exceeds the configured image-count limit.", "TOO_MANY_IMAGES");
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0);
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError("Image batch exceeds the configured aggregate image-byte limit.", "IMAGES_TOO_LARGE");
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, "UNSUPPORTED_IMAGE_TYPE");
      }
    }
    for (const input of inputs) await this.validateImage(input);
    const refs = [];
    for (const input of inputs) refs.push(await this.saveImage(input));
    return refs;
  }
};
var src_default = AttachmentStore;
export {
  AttachmentError,
  AttachmentId,
  AttachmentStore,
  src_default as default,
  isImageAdmissionError
};
