import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react';
import { DocumentTitle } from "./DocumentTitle.js";
/**
 * Build the renderApp factory the app-shell plugin provides to AppRoot.
 * @param deps - assembly inputs.
 * @returns factory producing the real UI tree (called once per AppRoot render after settled).
 */
export function buildRenderApp(deps) {
    const { ctx } = deps;
    const sessions = ctx.get('sessions');
    if (sessions === undefined)
        throw new Error('shell assembly: sessions service unavailable');
    const useSessions = bindSnapshotSelector(sessions.list);
    const SessionDocumentTitle = () => {
        const title = useSessions((state) => {
            const id = state.current;
            return id === undefined ? undefined : state.byId[id]?.title;
        });
        return _jsx(DocumentTitle, { ...title === undefined ? {} : { title } });
    };
    return () => (_jsxs(_Fragment, { children: [_jsx(SessionDocumentTitle, {}), ctx.slots.renderSlot('root', {})] }));
}
//# sourceMappingURL=app.js.map