import { SidebarRoot } from "./SidebarRoot.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin (shell controls copy). */
const NS = 'sidebar';
/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'locale'];
/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar: dictionaries');
    const injectProps = () => ({
        // The shell's New Session button rides the runtime's shared action
        // (current Session Workspace, then recent Workspace).
        startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId); },
        toggleSidebar: () => { ctx.layout.toggleSidebar(); },
    });
    ctx.effect(() => ctx.slots.register({
        name: 'sidebar',
        locale: NS,
        // The shell owns geometry; ui-workspace registers the whole browsing
        // region (header, search, session list, workspace dialogs), ui-settings
        // registers the foot trigger + settings panel.
        children: {
            'sidebar.workspaces': { kind: 'single', scope: 'root' },
            'sidebar.settings': { kind: 'single', scope: 'root' },
            'sidebar.footer.action': { kind: 'list', scope: 'root' },
        },
        inject: injectProps,
    }, SidebarRoot), 'ui-sidebar: slot registration');
}
//# sourceMappingURL=index.js.map