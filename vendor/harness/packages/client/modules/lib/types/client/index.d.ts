/**
 * Browser half (the standard `./client` export): the module-system class and
 * wire contract, plus the enrollment plugin face. The module system itself is
 * built by the shell kernel BEFORE cordis exists (the bootstrap exception —
 * the mechanism that loads plugins cannot arrive through
 * itself); the plugin face only enrolls that pre-existing instance by
 * providing it as `ctx.modules`. The kernel statically registers this module,
 * so the graph row for this package never triggers a real fetch — arrival is
 * a no-op against the already-registered entry.
 * @module @deepseek-ai/dsh-client-modules/client
 */
import type { Context } from '@deepseek-ai/cordis';
export { ClientModuleSystem } from './system.ts';
export { parseBootManifest } from './manifest.ts';
export type { BootManifest, BootModuleRow, BootPluginRow, ClientModuleLoader, ClientModuleRecord, ClientModuleSystemOptions, ClientPluginHandoff, DshWindow, WebBootEntry, WebBootGraph, } from './manifest.ts';
/**
 * Enroll the kernel-built module system as `ctx.modules`.
 * @param ctx - client root context.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map