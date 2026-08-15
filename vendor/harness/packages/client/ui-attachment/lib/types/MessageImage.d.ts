import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ImageLightboxLabels } from './ImageLightbox.tsx';
/** Loads a session-authorized durable image URL. */
export type ImageLoader = (attachment: ImageAttachmentRef) => Promise<string>;
/** Message-image strings the owner resolves from its own locale namespace. */
export interface MessageImageLabels {
    /** Fallback display name for an unnamed image. */
    image: string;
    /** Thumbnail tooltip inviting the original-image preview. */
    open: string;
    /** Accessible thumbnail label; receives the image's display name. */
    openNamed: (label: string) => string;
    /** Loading placeholder shown until bytes resolve. */
    loading: string;
    /** Retry-control label shown when the load fails. */
    loadFailed: string;
    /** Lightbox strings forwarded to the opened preview. */
    lightbox: ImageLightboxLabels;
}
/**
 * Compact history renderer with retryable loading and click-to-open original
 * preview. A lone image renders at its `singleFit` size; an image among
 * several renders as a fixed 64px square tile.
 *
 * @param props.attachment - the durable image reference to load and bound.
 * @param props.load - session-authorized URL loader.
 * @param props.variant - `single` for a message's lone image, `tile` otherwise.
 * @param props.labels - resolved strings (tooltip, loading, retry, lightbox).
 * @returns the bounded thumbnail button, or the retry control on failure.
 */
export declare function MessageImage({ attachment, load, variant, labels }: {
    attachment: ImageAttachmentRef;
    load: ImageLoader;
    variant: 'single' | 'tile';
    labels: MessageImageLabels;
}): import("react").JSX.Element;
/** Wrapping image group shared by user and assistant history: a lone image
 * renders large, several render as 64px square tiles (DeepSeek Chat rule). */
export declare function ImageGallery({ images, load, align, labels }: {
    images: readonly {
        attachment: ImageAttachmentRef;
    }[];
    load: ImageLoader;
    align: 'start' | 'end';
    labels: MessageImageLabels;
}): import("react").JSX.Element | null;
//# sourceMappingURL=MessageImage.d.ts.map