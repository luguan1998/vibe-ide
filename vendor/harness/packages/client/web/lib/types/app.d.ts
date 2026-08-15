/**
 * Real-UI assembly closure, invoked by the app-shell plugin once its inject
 * set is active: the whole layout tree hangs off the built-in 'root' slot
 * (ui-layout registers AppFrame there and renders the child slots
 * internally) — the shell's render is the one ctx-level renderSlot call in
 * the program.
 */
import type { ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
/** Assembly inputs: the active app-shell plugin ctx (slots/sessions/layout services provided). */
export interface AssemblyDeps {
    /** Client context with the assembly's inject set active. */
    ctx: Context;
}
/**
 * Build the renderApp factory the app-shell plugin provides to AppRoot.
 * @param deps - assembly inputs.
 * @returns factory producing the real UI tree (called once per AppRoot render after settled).
 */
export declare function buildRenderApp(deps: AssemblyDeps): () => ReactNode;
//# sourceMappingURL=app.d.ts.map