import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react';
import { buildRenderApp } from "./app.js";
/** Shell-owned pseudo entry id under which the host graph mounts this plugin. */
export const APP_SHELL_ID = '@deepseek-ai/dsh-client-app-shell';
/** Cordis plugin name. */
export const name = 'app-shell';
/** Services required before shell assembly. */
export const inject = ['slots', 'sessions', 'layout'];
/** Installs the React renderer and exposes the assembled application.
 * @param ctx - Plugin context.
 */
export function apply(ctx) {
    // The renderer install is shell territory (web-react is shell-bundled),
    // but ctx.slots exists only once the runtime entry is active — so it lands
    // here, on the entry whose inject set guarantees that ordering.
    ctx.slots.install(createSlotRenderer());
    // Assemble once on first render: the closure must be identity-stable
    // across AppRoot re-renders.
    let renderApp;
    ctx.reflect.provide('appShell', {
        renderApp: () => {
            renderApp ??= buildRenderApp({ ctx });
            return renderApp();
        },
    });
}
//# sourceMappingURL=app-shell.js.map