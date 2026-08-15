import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Draft-attachment thumbnail rail: scrollbar-less horizontal overflow paged
 * by edge arrows, hover-revealed per-item remove, single-click open. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseFill14, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './AttachmentRail.module.css';
/** Approximate pixels per wheel step for `deltaMode` LINE deltas (Firefox
 * notch wheels report lines, not pixels). */
const WHEEL_LINE_PX = 16;
/** Smooth paging unless the user asked for reduced motion. */
function pageBehavior() {
    // jsdom (the unit lane) implements no matchMedia despite lib.dom's
    // non-optional typing; the optional call keeps that lane on the default.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
/**
 * Horizontal thumbnail rail over the caller's draft attachments.
 *
 * The rail scrolls with its scrollbar hidden; overflow is announced by edge
 * arrows recomputed from scroll geometry on scroll, item-count changes, and
 * rail size changes (a ResizeObserver on the rail element, so sidebar or
 * panel resizes count, not only window resizes). A vertical wheel pans the
 * rail horizontally and is consumed exclusively (non-passive listener), a
 * newly added item is revealed at the rail's end while a rail that mounts
 * over an existing draft keeps its start position, and each thumbnail opens
 * on a single click while its remove control sits inside the card and
 * reveals on hover or focus. The owner decides mounting; it renders the rail
 * only while items exist.
 *
 * @param props.items - resolved thumbnails in draft order.
 * @param props.labels - rail-level strings (group name, open tooltip, arrows).
 * @param props.onOpen - single-click open of one item's original image.
 * @param props.onRemove - remove one item from the draft.
 * @returns the rail group with its paging arrows.
 */
export function AttachmentRail({ items, labels, onOpen, onRemove }) {
    const railRef = useRef(null);
    // null marks the first layout pass: a rail that MOUNTS over an existing
    // draft (session switch back to held images) is initial display, not
    // growth, and must not jump to the end.
    const countRef = useRef(null);
    const [edges, setEdges] = useState({ left: false, right: false });
    const updateEdges = useCallback(() => {
        const el = railRef.current;
        /* v8 ignore next -- defensive: every caller runs while the rail element is mounted. */
        if (el === null)
            return;
        // 1px slack: engines report fractional scroll positions at the edges.
        const left = el.scrollLeft > 1;
        const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
        setEdges(prev => prev.left === left && prev.right === right ? prev : { left, right });
    }, []);
    useLayoutEffect(() => {
        const grew = countRef.current !== null && items.length > countRef.current;
        countRef.current = items.length;
        const el = railRef.current;
        /* v8 ignore next -- defensive: the rail div renders unconditionally, so the layout effect always finds it. */
        if (el === null)
            return;
        // A newly added attachment lands at the rail's end: reveal it.
        if (grew)
            el.scrollLeft = el.scrollWidth - el.clientWidth;
        updateEdges();
    }, [items.length, updateEdges]);
    useEffect(() => {
        const el = railRef.current;
        /* v8 ignore next -- defensive: the rail div renders unconditionally, so the mount effect always finds it. */
        if (el === null)
            return;
        // The rail's width follows the composer, which resizes with sidebars and
        // panels, not only the window — observe the element itself. jsdom (the
        // unit lane) implements no ResizeObserver; every browser gets the
        // subscription.
        let disconnect = () => { };
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(updateEdges);
            observer.observe(el);
            disconnect = () => { observer.disconnect(); };
        }
        // The rail scrolls horizontally ONLY: any wheel tick with a vertical
        // component is consumed — without preventDefault it would also scroll the
        // conversation behind the composer, and React's root wheel listener is
        // passive, so the exclusion needs this manually attached non-passive
        // listener. A diagonal trackpad pan keeps its horizontal intent; a pure
        // vertical wheel converts to a horizontal step, with LINE and PAGE deltas
        // (Firefox notch wheels) normalized to pixels before the per-tick clamp
        // that keeps a fast wheel followable. A purely horizontal pan stays
        // native.
        const onWheel = (event) => {
            if (event.deltaY === 0)
                return;
            const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? WHEEL_LINE_PX
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? el.clientWidth : 1;
            event.preventDefault();
            el.scrollBy({
                left: event.deltaX !== 0
                    ? event.deltaX * scale
                    : Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * scale, 60),
                behavior: 'auto',
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            disconnect();
            el.removeEventListener('wheel', onWheel);
        };
    }, [updateEdges]);
    const page = (direction) => {
        const el = railRef.current;
        /* v8 ignore next -- defensive: the arrows render only while the rail is mounted, so a click cannot find a null ref. */
        if (el === null)
            return;
        // One viewport minus a card keeps the last visible thumbnail as context;
        // the floor keeps narrow rails paging a useful distance.
        el.scrollBy({ left: direction * Math.max(el.clientWidth - 64, 200), behavior: pageBehavior() });
    };
    return (_jsxs("div", { className: css.root, children: [edges.left && (_jsx("button", { type: "button", className: clsx(css.arrow, css.arrowLeft), "aria-label": labels.scrollLeft, onClick: () => { page(-1); }, children: _jsx(IconChevronLeftOutline14, {}) })), _jsx("div", { ref: railRef, className: css.rail, role: "group", "aria-label": labels.group, onScroll: updateEdges, children: items.map(item => (_jsxs("div", { className: css.item, children: [_jsx("button", { type: "button", className: css.thumbnail, title: labels.open, onClick: () => { onOpen(item); }, children: _jsx("img", { src: item.previewUrl, alt: item.alt }) }), _jsx("button", { type: "button", className: css.remove, "aria-label": item.removeLabel, onClick: () => { onRemove(item); }, children: _jsx(IconCloseFill14, { size: 12 }) })] }, item.id))) }), edges.right && (_jsx("button", { type: "button", className: clsx(css.arrow, css.arrowRight), "aria-label": labels.scrollRight, onClick: () => { page(1); }, children: _jsx(IconChevronRightOutline14, {}) }))] }));
}
//# sourceMappingURL=AttachmentRail.js.map