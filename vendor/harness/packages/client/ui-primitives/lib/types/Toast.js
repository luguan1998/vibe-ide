import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import css from './Toast.module.css';
/** Full-opacity hold before the fade starts. Must agree with the stylesheet's
 * toast-fade delay (Toast.module.css) or the banner unmounts mid-fade. */
const HOLD_MS = 3000;
/** Fade duration. Must agree with the stylesheet's toast-fade duration. */
const FADE_MS = 1000;
/**
 * Transient top-center banner: slides in, holds at full opacity, fades out,
 * then reports done so the owner can unmount it. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 *
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon).
 * @param props.anchor - optional element whose horizontal center the banner
 * follows (e.g. the composer card, so the banner centers over the chat column
 * rather than the whole window); omitted, it centers on the viewport.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @returns the floating banner.
 */
export function Toast({ text, icon, anchor, onDone }) {
    useEffect(() => {
        const timer = setTimeout(onDone, HOLD_MS + FADE_MS);
        return () => { clearTimeout(timer); };
    }, [onDone]);
    // Anchor-centered placement re-measures on window resizes; the banner lives
    // four seconds, so sub-window layout drift within that span stays out of
    // scope.
    const [left, setLeft] = useState(null);
    useLayoutEffect(() => {
        if (anchor == null)
            return;
        const measure = () => {
            const rect = anchor.getBoundingClientRect();
            setLeft(rect.left + rect.width / 2);
        };
        measure();
        window.addEventListener('resize', measure);
        return () => { window.removeEventListener('resize', measure); };
    }, [anchor]);
    return createPortal(_jsxs("div", { className: css.toast, role: "alert", style: left === null ? undefined : { left }, children: [icon !== undefined && _jsx("span", { className: css.icon, "aria-hidden": true, children: icon }), _jsx("span", { className: css.text, children: text })] }), document.body);
}
//# sourceMappingURL=Toast.js.map