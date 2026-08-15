import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/** Plugins settings section: localized tabs around feature-owned pages. */
import { useEffect, useId, useRef, useState } from 'react';
import css from './PluginsSettingsSection.module.css';
/** Render one Plugins page whose contents arrive from feature-owned tabs. */
export function PluginsSettingsSection({ t, renderSlot, useTabs }) {
    const tabsId = useId();
    const tabRefs = useRef([]);
    const rows = useTabs(value => value);
    const [activeId, setActiveId] = useState();
    const [visitedIds, setVisitedIds] = useState(() => new Set());
    const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id;
    // A tab mounts only when first selected, then stays mounted while hidden so
    // local drafts, disclosure state, search, and the inventory snapshot survive
    // switching between the two views.
    useEffect(() => {
        if (active === undefined)
            return;
        setVisitedIds((previous) => {
            if (previous.has(active))
                return previous;
            return new Set([...previous, active]);
        });
    }, [active]);
    return (_jsxs("div", { className: css.section, children: [_jsx("h2", { className: css.heading, children: t('title') }), _jsx("p", { className: css.intro, children: t('intro') }), rows.length === 0 ? _jsx("p", { className: css.empty, children: t('empty') }) : (_jsxs(_Fragment, { children: [_jsx("div", { className: css.tabs, role: "tablist", "aria-label": t('tabs'), children: rows.map((row, index) => {
                            const selected = row.id === active;
                            return (_jsx("button", { ref: (element) => { tabRefs.current[index] = element; }, id: `${tabsId}-tab-${row.id}`, type: "button", role: "tab", className: css.tab, "aria-selected": selected, "aria-controls": `${tabsId}-panel-${row.id}`, "data-active": selected ? 'true' : undefined, tabIndex: selected ? 0 : -1, onClick: () => { setActiveId(row.id); }, onKeyDown: (event) => {
                                    let nextIndex;
                                    switch (event.key) {
                                        case 'ArrowRight':
                                            nextIndex = (index + 1) % rows.length;
                                            break;
                                        case 'ArrowLeft':
                                            nextIndex = (index - 1 + rows.length) % rows.length;
                                            break;
                                        case 'Home':
                                            nextIndex = 0;
                                            break;
                                        case 'End':
                                            nextIndex = rows.length - 1;
                                            break;
                                        default: return;
                                    }
                                    event.preventDefault();
                                    const nextRow = rows[nextIndex];
                                    const nextTab = tabRefs.current[nextIndex];
                                    setActiveId(nextRow.id);
                                    nextTab.focus();
                                }, children: row.label }, row.id));
                        }) }), rows
                        .filter(row => row.id === active || visitedIds.has(row.id))
                        .map((row) => {
                        const selected = row.id === active;
                        return (_jsx("div", { id: `${tabsId}-panel-${row.id}`, className: css.panel, role: "tabpanel", "aria-labelledby": `${tabsId}-tab-${row.id}`, hidden: !selected, children: renderSlot('settings.plugins.tab', {}, { only: row.id }) }, row.id));
                    })] }))] }));
}
//# sourceMappingURL=PluginsSettingsSection.js.map