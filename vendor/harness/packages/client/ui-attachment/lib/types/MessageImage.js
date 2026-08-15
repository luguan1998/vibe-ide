import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageLightbox } from "./ImageLightbox.js";
import css from './MessageImage.module.css';
/** Display box for a lone image (DeepSeek Chat rule): long edge 240px with
 * the rendered aspect ratio clamped to [0.25, 4] — the overflow is cropped by
 * `object-fit: cover` — and never upscaled past the image's natural size. The
 * crop anchor keeps the top of very tall images and the left of very wide
 * ones, where the informative content usually starts. */
function singleFit(attachment) {
    const natural = attachment.width / attachment.height;
    const ratio = Math.min(4, Math.max(0.25, natural));
    const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 };
    const scale = Math.min(1, attachment.width / box.width, attachment.height / box.height);
    return {
        width: Math.max(1, Math.round(box.width * scale)),
        height: Math.max(1, Math.round(box.height * scale)),
        objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
    };
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
export function MessageImage({ attachment, load, variant, labels }) {
    const [src, setSrc] = useState(null);
    const [error, setError] = useState(false);
    const [open, setOpen] = useState(false);
    // Retry re-arms the one load effect below, so every attempt — first load or
    // retry — runs under the same liveness guard and the same reset.
    const [attempt, setAttempt] = useState(0);
    const request = useCallback(() => { setAttempt(a => a + 1); }, []);
    const close = useCallback(() => { setOpen(false); }, []);
    const fit = useMemo(() => (variant === 'single' ? singleFit(attachment) : undefined), [attachment, variant]);
    useEffect(() => {
        let live = true;
        setError(false);
        setSrc(null);
        void load(attachment).then((url) => { if (live)
            setSrc(url); }).catch(() => { if (live)
            setError(true); });
        return () => { live = false; };
    }, [attachment, load, attempt]);
    const label = attachment.name ?? labels.image;
    if (error)
        return _jsx("button", { type: "button", className: css.error, "data-variant": variant, onClick: request, children: labels.loadFailed });
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: css.frame, "data-variant": variant, style: fit === undefined ? undefined : { width: fit.width, height: fit.height }, title: labels.open, "aria-label": labels.openNamed(label), onClick: () => { if (src !== null)
                    setOpen(true); }, children: src === null
                    ? _jsx("span", { className: css.loading, children: labels.loading })
                    : _jsx("img", { src: src, alt: label, style: fit === undefined ? undefined : { objectPosition: fit.objectPosition } }) }), open && src !== null && _jsx(ImageLightbox, { src: src, alt: label, labels: labels.lightbox, onClose: close })] }));
}
/** Wrapping image group shared by user and assistant history: a lone image
 * renders large, several render as 64px square tiles (DeepSeek Chat rule). */
export function ImageGallery({ images, load, align, labels }) {
    if (images.length === 0)
        return null;
    const variant = images.length === 1 ? 'single' : 'tile';
    return (_jsx("div", { className: css.gallery, "data-align": align, children: images.map((image, index) => (_jsx(MessageImage, { ...image, load: load, variant: variant, labels: labels }, `${image.attachment.attachmentId}:${index}`))) }));
}
//# sourceMappingURL=MessageImage.js.map