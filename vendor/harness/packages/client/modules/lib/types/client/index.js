export { ClientModuleSystem } from "./system.js";
export { parseBootManifest } from "./manifest.js";
/**
 * Enroll the kernel-built module system as `ctx.modules`.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    const modules = globalThis.__DSH_MODULES__;
    // The kernel writes the slot right after constructing the instance, before
    // any cordis entry exists — a missing slot means the kernel sequencing broke.
    if (modules === undefined) {
        throw new Error('client-modules: window.__DSH_MODULES__ missing — the shell kernel must construct the module system before plugin boot');
    }
    ctx.reflect.provide('modules', modules);
}
//# sourceMappingURL=index.js.map