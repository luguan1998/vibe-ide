/**
 * App-shell assembly plugin. Its pseudo package id exists only in the host
 * graph and shell registry; there is no npm package behind it.
 */
import type { ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
/** Shell-owned pseudo entry id under which the host graph mounts this plugin. */
export declare const APP_SHELL_ID = "@deepseek-ai/dsh-client-app-shell";
/** The assembled-UI face AppRoot renders once the boot settles. */
export interface AppShellService {
    /** Build (once) and render the real UI tree. */
    renderApp: () => ReactNode;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** The shell assembly face, provided by the app-shell entry once its inject set is active. */
        appShell: AppShellService;
    }
}
/** Cordis plugin name. */
export declare const name = "app-shell";
/** Services required before shell assembly. */
export declare const inject: string[];
/** Installs the React renderer and exposes the assembled application.
 * @param ctx - Plugin context.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=app-shell.d.ts.map