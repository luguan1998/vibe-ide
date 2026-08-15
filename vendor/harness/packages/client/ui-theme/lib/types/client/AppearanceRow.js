import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Appearance preference row registered into the General section item slot
 * (figma 501:30012 'Frame 2117131228'): title + three preference cubes.
 * Registered by this package — the theme feature owns its own settings
 * surface. Selection follows the persisted preference, never the resolved
 * active theme.
 */
import clsx from 'clsx';
import { IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './AppearanceRow.module.css';
/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES = [
    { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
    { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
    { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
];
/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, useStore }) {
    const preference = useStore(s => s.preference);
    return (_jsxs("div", { className: css.group, children: [_jsx("div", { className: css.title, children: t('appearance.title') }), _jsx("div", { className: css.cubeRow, children: CUBES.map(({ id, labelKey, Icon }) => (_jsxs("button", { type: "button", className: clsx(css.themeCube, preference === id && css.selected), "aria-pressed": preference === id, onClick: () => { setTheme(id); }, children: [_jsx(Icon, {}), t(labelKey)] }, id))) })] }));
}
//# sourceMappingURL=AppearanceRow.js.map