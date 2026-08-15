import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Sidebar shell: column geometry only. Collapse is a slide plus crossfade:
 * content freezes at its expanded width (inline style) and fades out in place
 * while the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts and the four upper
 * controls enter the 56px rail from the same horizontal offset (one icon each,
 * same top-down order) on one fade that ends with the slide. The bottom-pinned
 * settings control only fades. The workspace/session browsing region between
 * the New Session button and the foot is the `sidebar.workspaces` registrant's,
 * and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell
 * hands them the wide flag (plus an expand request callback for the browser).
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { BrandWordmark, FishLogo, IconNewChatOutline16, IconPanelLeftOutline16, Tooltip, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './SidebarRoot.module.css';
/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150;
/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000;
/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({ collapsed, width, startSession, toggleSidebar, t, renderSlot, }) {
    // Wide content stays mounted while the collapse animates (fading via
    // .collapsed .wide), unmounts at settle, and remounts right away on expand.
    const [settled, setSettled] = useState(collapsed);
    useEffect(() => {
        if (!collapsed) {
            setSettled(false);
            return;
        }
        const timer = window.setTimeout(() => { setSettled(true); }, COLLAPSE_SETTLE_MS);
        return () => { window.clearTimeout(timer); };
    }, [collapsed]);
    const wide = !collapsed || !settled;
    // Freeze the content at its expanded width while it fades out (collapsed
    // && wide): the sliding column then clips it instead of reflowing it. The
    // rail layout (.collapsed styles) only applies once the fade settles.
    const lastWideWidth = useRef(width);
    if (!collapsed)
        lastWideWidth.current = width;
    // Rail-in only crossfades a live collapse: a refresh straight into the
    // collapsed state renders the rail statically (no delay-hidden icons).
    const everWide = useRef(!collapsed);
    if (!collapsed)
        everWide.current = true;
    // Scrollbars in the column follow the pointer (.quietBars rebinds them
    // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
    // leaves. A pointer that returns within that window cancels the pending
    // hide rather than restarting from a hidden bar.
    const column = useRef(null);
    const [pointerInside, setPointerInside] = useState(false);
    const lingerTimer = useRef(undefined);
    const armLinger = () => {
        if (lingerTimer.current !== undefined)
            return;
        lingerTimer.current = window.setTimeout(() => {
            lingerTimer.current = undefined;
            setPointerInside(false);
        }, SCROLLBAR_LINGER_MS);
    };
    const cancelLinger = () => {
        window.clearTimeout(lingerTimer.current);
        lingerTimer.current = undefined;
    };
    // Leaving is decided by the column's BOX, not by DOM containment, and only
    // while the bars are drawn. ui-settings renders its full-viewport panel as a
    // fixed-position DESCENDANT of this column, so a pointer moved onto that
    // panel — or onto the conversation once it closes — fires no `pointerleave`
    // here, and the bars would stay drawn over a column nobody is pointing at.
    // The element's own leave stays as the one signal geometry cannot give: a
    // pointer that leaves the window emits no further moves.
    useEffect(() => {
        if (!pointerInside)
            return;
        const onMove = (event) => {
            const rect = column.current?.getBoundingClientRect();
            /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
            if (rect === undefined)
                return;
            const inside = event.clientX >= rect.left && event.clientX < rect.right
                && event.clientY >= rect.top && event.clientY < rect.bottom;
            if (inside)
                cancelLinger();
            else
                armLinger();
        };
        document.addEventListener('pointermove', onMove);
        return () => {
            document.removeEventListener('pointermove', onMove);
            cancelLinger();
        };
    }, [pointerInside]);
    return (_jsxs("div", { ref: column, className: clsx(css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn, collapsed && wide && css.fading, !pointerInside && css.quietBars), style: wide ? { width: collapsed ? lastWideWidth.current : width } : undefined, onPointerEnter: () => {
            cancelLinger();
            setPointerInside(true);
        }, onPointerLeave: () => { armLinger(); }, children: [_jsxs("div", { className: css.logoRow, children: [wide && (_jsx("button", { type: "button", className: clsx(css.brand, css.wide), "aria-label": t('session.new.label'), onClick: () => { startSession(); }, children: _jsx(BrandWordmark, {}) })), _jsx(Tooltip, { label: collapsed ? t('toggle.open') : t('toggle.collapse'), delayMs: 500, children: _jsxs("button", { type: "button", className: clsx(css.iconButton, css.toggle), "aria-label": collapsed ? t('toggle.open') : t('toggle.collapse'), onClick: () => { toggleSidebar(); }, children: [!wide && _jsx(FishLogo, { className: css.railFish, size: 24 }), _jsx(IconPanelLeftOutline16, { className: css.panelIcon, size: wide ? 16 : 18 })] }) })] }), _jsx(Tooltip, { label: t('session.new.label'), delayMs: 500, disabled: wide, children: _jsxs("button", { type: "button", className: css.newSession, "aria-label": t('session.new.label'), onClick: () => { startSession(); }, children: [_jsx(IconNewChatOutline16, { size: wide ? 14 : 18 }), wide && _jsx("span", { className: clsx(css.newSessionLabel, css.wide), children: t('session.new') })] }) }), _jsx("div", { className: css.regionArea, children: renderSlot('sidebar.workspaces', {
                    wide,
                    expandSidebar: () => { if (collapsed)
                        toggleSidebar(); },
                }) }), _jsxs("div", { className: css.footArea, children: [_jsx("div", { className: css.footerActions, children: renderSlot('sidebar.footer.action', { wide }) }), _jsx("div", { className: css.settingsArea, children: renderSlot('sidebar.settings', { wide }) })] })] }));
}
//# sourceMappingURL=SidebarRoot.js.map