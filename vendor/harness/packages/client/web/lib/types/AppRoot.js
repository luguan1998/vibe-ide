import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Shell root: boot loading page → (boot settled) → real UI in one switch.
 * Pure kernel component with zero plugin dependencies — before settled it may
 * only rely on itself (the fail-loud presentation must not depend on the
 * system whose failure it reports; the status/signal stores are kernel-own,
 * shell self-sufficiency rule); the real UI is produced by the
 * app-shell entry once every entry is active. A failed boot keeps the
 * loading page, lists the per-entry fiber states and the sweep report (fail
 * loud, no partial UI).
 */
import { useSyncExternalStore } from 'react';
import css from './AppRoot.module.css';
/** Boot gate: loading page until the boot settles; failures stay here. */
export function AppRoot(props) {
    const settled = useSyncExternalStore(props.settled.subscribe, props.settled.getSnapshot);
    const status = useSyncExternalStore(props.status.subscribe, props.status.getSnapshot);
    const error = useSyncExternalStore(props.error.subscribe, props.error.getSnapshot);
    const failed = Object.entries(status).filter(([, s]) => s === 'failed');
    if (settled)
        return _jsx(_Fragment, { children: props.renderApp() });
    const loud = error !== undefined || failed.length > 0;
    return (_jsx("div", { className: css.boot, children: _jsxs("div", { className: css.card, children: [_jsx("div", { className: css.wordmark, children: "HARNESS" }), !loud
                    ? (_jsxs(_Fragment, { children: [_jsx("div", { className: css.spinner }), _jsx("div", { className: css.hint, children: "Loading plugins\u2026" })] }))
                    : (_jsxs("div", { className: css.failed, children: [_jsx("div", { className: css.failedTitle, children: "Failed to load plugins" }), failed.map(([id]) => _jsx("div", { className: css.failedItem, children: id }, id)), error !== undefined && _jsx("div", { className: css.failedItem, children: error })] }))] }) }));
}
//# sourceMappingURL=AppRoot.js.map