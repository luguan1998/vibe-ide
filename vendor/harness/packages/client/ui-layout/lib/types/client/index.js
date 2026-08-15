import { AppFrame } from "./AppFrame.js";
import { createLayoutStore } from "./stores.js";
import { LayoutController } from "./service.js";
import { ThemePresenter } from "./theme-presenter.js";
// Contract exports only (export-convergence rule: cross-package consumers
// keep a symbol exported; test-only/package-internal symbols live off /src).
// ILayout: the ctx.layout face consumers and test fakes type against.
// OwnerShare contracts below are the render-side halves registrants compose
// against; the frame components and the store factory are package-internal.
export { LayoutController } from "./service.js";
/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'theme'];
/**
 * Client plugin body: provide ctx.layout, then one register() call — AppFrame
 * into 'root' with the four child-slot declarations, the layout store seat,
 * and the inject hook that hands the store's bound actions to the service.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    const layout = new LayoutController();
    ctx.effect(() => {
        const disposeService = ctx.reflect.provide('layout', layout);
        const disposeRegistration = ctx.slots.register({
            name: 'root',
            children: {
                'sidebar': { kind: 'single', scope: 'root' },
                'conversation': { kind: 'single', scope: 'session-maybe' },
                'details': { kind: 'single', scope: 'session' },
                'shell.overlay': { kind: 'list', scope: 'root' },
            },
            // Exclusive store: the factory itself — the framework instantiates per
            // entry and delivers useStore/actions to AppFrame as standard props.
            store: createLayoutStore,
            // The hook's only side effect connects the root store to ctx.layout;
            // conversation business actions belong to their registrants.
            inject: (actions) => {
                layout.attachPanels(actions);
                return {};
            },
        }, AppFrame);
        return () => {
            disposeRegistration();
            // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
            void disposeService();
        };
    }, 'ui-layout: service + root registration');
    // Theme presentation: pure DOM writes from resolved snapshots — initial
    // state through the getter once, then event-driven only; no React path.
    ctx.effect(() => {
        const presenter = new ThemePresenter();
        presenter.apply(ctx.theme.getTheme());
        const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot); });
        return () => {
            off();
            presenter.dispose();
        };
    }, 'ui-layout: theme presenter');
}
//# sourceMappingURL=index.js.map