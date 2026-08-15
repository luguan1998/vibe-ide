import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './ImageLightbox.module.css';
/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, onClose }) {
    const closeRef = useRef(null);
    const restoreRef = useRef(null);
    useEffect(() => {
        restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus();
        const onKeyDown = (event) => {
            if (event.key === 'Escape')
                onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            restoreRef.current?.focus();
        };
    }, [onClose]);
    return createPortal(_jsxs("div", { className: css.backdrop, role: "dialog", "aria-modal": "true", "aria-label": labels.dialog, children: [_jsx("div", { className: css.mask, "aria-hidden": "true", onMouseDown: onClose }), _jsx("img", { className: css.image, src: src, alt: alt }), _jsx("button", { ref: closeRef, type: "button", className: css.close, "aria-label": labels.close, onClick: onClose, children: _jsx(IconCloseOutline16, { size: 16 }) })] }), document.body);
}
//# sourceMappingURL=ImageLightbox.js.map