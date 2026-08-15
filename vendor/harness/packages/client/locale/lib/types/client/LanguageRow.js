import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Language preference row registered into the General section item slot
 * (figma 501:30011 'Setting-Cell'): title + selector pill opening the locale
 * menu. Registered by this package — the locale feature owns its own
 * settings surface.
 */
import { useState } from 'react';
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './LanguageRow.module.css';
/**
 * Render the Language row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function LanguageRow({ t, setLocale, useStore }) {
    const active = useStore(s => s.active);
    const options = useStore(s => s.options);
    const [open, setOpen] = useState(false);
    const activeLabel = options.find(o => o.id === active)?.label ?? active;
    return (_jsxs("div", { className: css.row, children: [_jsx("div", { className: css.rowText, children: _jsx("div", { className: css.title, children: t('language.title') }) }), _jsx(Menu, { open: open, onClose: () => { setOpen(false); }, items: options.map(o => ({ id: o.id, label: o.label })), selectedId: active, onSelect: (id) => {
                    setLocale(id);
                    setOpen(false);
                }, align: "end", portal: true, anchor: (_jsxs("button", { type: "button", className: css.selector, "aria-haspopup": "menu", "aria-expanded": open, onClick: () => { setOpen(v => !v); }, children: [activeLabel, _jsx(IconChevronDownOutline14, { className: css.chevron })] })) })] }));
}
//# sourceMappingURL=LanguageRow.js.map