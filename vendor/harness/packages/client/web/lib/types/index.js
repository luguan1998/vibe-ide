/**
 * Web shell library entry. The shell's product is {@link AppWebEntry} —
 * apps/web's vite entry runs it against #root; everything else (AppRoot
 * gate, app-shell assembly entry, module-table staticModules, platform constants) is
 * internal to the boot chain. PLATFORM_MODULES is re-exported as the
 * single source of truth for the tsdown client externals projection.
 * @module @deepseek-ai/dsh-client-web
 */
export { AppWebEntry } from "./boot.js";
export { AppRoot } from "./AppRoot.js";
export { buildRenderApp } from "./app.js";
export { DocumentTitle } from "./DocumentTitle.js";
export { APP_SHELL_ID } from "./app-shell.js";
export { getStaticModules } from "./seed.js";
export { PLATFORM_MODULES } from "./platform.js";
export { STATE_LABELS, FIBER_STATE, createSignal, createLoaderStatusStore, } from "./loader-status.js";
//# sourceMappingURL=index.js.map