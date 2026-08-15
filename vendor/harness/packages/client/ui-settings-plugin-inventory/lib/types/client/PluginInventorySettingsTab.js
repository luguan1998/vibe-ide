import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useMemo, useState } from 'react';
import { IconChevronDownOutline14, IconSearchOutline16, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './PluginInventorySettingsTab.module.css';
const PHASE_KEYS = {
    pending: 'pending',
    loading: 'loadingPhase',
    active: 'active',
    failed: 'failed',
    unloading: 'unloading',
};
/** Localized accessible label for one root Fiber phase. */
function phaseLabel(phase, t) {
    return phase === null ? t('unobserved') : t(PHASE_KEYS[phase]);
}
/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName) {
    const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName;
    return unscoped
        .replace(/^cordis:/, '')
        .replace(/^cordis-plugin-/, '')
        .replace(/^dsh-(?:host-|client-)?/, '');
}
/** Whether an inventory row matches the local catalog query. */
function matches(entry, normalizedQuery) {
    if (normalizedQuery.length === 0)
        return true;
    return [entry.moduleName, entry.entryId]
        .some(value => value.toLocaleLowerCase().includes(normalizedQuery));
}
/** Render the read-only current Loader inventory. */
export function PluginInventorySettingsTab({ list, t }) {
    const catalogId = useId();
    const [request, setRequest] = useState(0);
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState(null);
    const [state, setState] = useState({ status: 'loading' });
    useEffect(() => {
        let current = true;
        void Promise.resolve().then(() => list()).then((snapshot) => { if (current)
            setState({ status: 'ready', snapshot }); }, () => { if (current)
            setState({ status: 'error' }); });
        return () => { current = false; };
    }, [list, request]);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredEntries = useMemo(() => state.status === 'ready'
        ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
        : [], [normalizedQuery, state]);
    useEffect(() => {
        if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
            setExpanded(null);
        }
    }, [expanded, filteredEntries]);
    const retry = () => {
        setState({ status: 'loading' });
        setRequest(value => value + 1);
    };
    return (_jsxs("div", { className: css.section, "aria-busy": state.status === 'loading', children: [state.status === 'loading' ? _jsx("p", { className: css.status, children: t('loading') }) : null, state.status === 'error' ? (_jsxs("div", { className: css.failure, children: [_jsx("p", { role: "alert", children: t('error') }), _jsx("button", { type: "button", onClick: retry, children: t('retry') })] })) : null, state.status === 'ready' ? (_jsxs("div", { className: css.catalog, children: [_jsxs("label", { className: css.search, children: [_jsx(IconSearchOutline16, { "aria-hidden": "true" }), _jsx("span", { className: css.visuallyHidden, children: t('search') }), _jsx("input", { type: "search", value: query, placeholder: t('search'), "aria-label": t('search'), onChange: (event) => { setQuery(event.currentTarget.value); } })] }), _jsxs("div", { className: css.catalogHeading, children: [_jsx("h3", { children: t('catalog') }), _jsx("span", { "data-plugin-count": filteredEntries.length, children: filteredEntries.length })] }), state.snapshot.entries.length === 0 ? _jsx("p", { className: css.status, children: t('empty') }) : null, state.snapshot.entries.length > 0 && filteredEntries.length === 0
                        ? _jsx("p", { className: css.status, children: t('emptySearch') })
                        : null, filteredEntries.length > 0 ? (_jsx("ul", { className: css.cards, children: filteredEntries.map((entry) => {
                            const status = phaseLabel(entry.fiberPhase, t);
                            const title = moduleShortName(entry.moduleName);
                            const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag');
                            const open = expanded === entry.entryId;
                            const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`;
                            return (_jsxs("li", { className: css.card, "data-plugin-entry": entry.entryId, "data-open": open ? 'true' : undefined, children: [_jsxs("button", { className: css.cardContent, type: "button", "aria-expanded": open, "aria-controls": detailId, "aria-label": entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`, onClick: () => {
                                            setExpanded(current => current === entry.entryId ? null : entry.entryId);
                                        }, children: [_jsx("strong", { className: css.cardTitle, title: entry.moduleName, children: title }), _jsxs("span", { className: css.cardTrailing, children: [entry.enabled ? (_jsx("span", { className: css.statusDot, "data-phase": entry.fiberPhase ?? 'unobserved', role: "img", "aria-label": status, title: status })) : null, _jsx("span", { className: css.configTag, "data-enabled": entry.enabled ? 'true' : 'false', children: configuration }), _jsx(IconChevronDownOutline14, { className: css.chevron, size: 12, "aria-hidden": "true" })] })] }), open ? (_jsxs("div", { className: css.cardDetails, id: detailId, children: [_jsx("code", { className: css.entryValue, "data-loader-entry": true, children: entry.entryId }), _jsxs("dl", { className: css.details, children: [_jsxs("div", { children: [_jsx("dt", { children: t('configuration') }), _jsx("dd", { children: configuration })] }), entry.enabled ? (_jsxs("div", { children: [_jsx("dt", { children: t('cordis') }), _jsx("dd", { children: status })] })) : null] })] })) : null] }, entry.entryId));
                        }) })) : null] })) : null] }));
}
//# sourceMappingURL=PluginInventorySettingsTab.js.map