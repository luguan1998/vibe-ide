/** Pure replay-safe render intents for Cordis tools. */
/**
 * Render a runtime-inspection call.
 * @param args - requested runtime category and optional member name.
 * @returns replay-safe generic call presentation.
 */
export function presentRuntimeInspectCall(args) {
    const target = args.name === undefined ? args.what : `${args.what}: ${args.name}`;
    return { card: 'generic', kind: 'read', title: target === undefined ? 'Inspect Cordis runtime' : `Inspect Cordis runtime: ${target}` };
}
/**
 * Render provider-directory inspection.
 * @returns replay-safe generic call presentation.
 */
export function presentInspectListCall() {
    return { card: 'generic', kind: 'read', title: 'List Cordis Inspect Providers' };
}
/**
 * Render one provider query.
 * @param args - target platform, provider, and method.
 * @returns replay-safe generic call presentation.
 */
export function presentInspectQueryCall(args) {
    return { card: 'generic', kind: 'read', title: `Query Cordis ${args.platform} ${args.provider}.${args.method}` };
}
/**
 * Render layered self-inspection.
 * @param args - optional Plugin and Package identity.
 * @returns replay-safe generic call presentation.
 */
export function presentInspectSelfCall(args) {
    const target = args.pluginId === undefined
        ? 'dynamic Cordis Plugins'
        : args.packageId === undefined ? args.pluginId : `${args.pluginId}/${args.packageId}`;
    return { card: 'generic', kind: 'read', title: `Inspect ${target}` };
}
/**
 * Render an immutable Package source-inspection call.
 * @param args - exact Plugin and Package identity.
 * @returns replay-safe generic call presentation.
 */
export function presentPackageInspectCall(args) {
    return { card: 'generic', kind: 'read', title: `Inspect Cordis Package ${args.pluginId}/${args.packageId}` };
}
/**
 * Render a new or appended Package definition.
 * @param args - target Plugin, Package metadata, and source halves.
 * @returns replay-safe generic call presentation with source in raw input.
 */
export function presentDefineCall(args) {
    const target = args.plugin.kind === 'new' ? `new ${args.plugin.idPrefix}-*` : args.plugin.pluginId;
    return {
        card: 'generic',
        kind: 'execute',
        title: `Register Cordis Plugin "${args.name}" for ${target}: ${args.purpose}`,
        rawInput: args.code,
    };
}
/**
 * Render Plugin removal.
 * @param args - Plugin identity to remove.
 * @returns replay-safe generic call presentation.
 */
export function presentUndefineCall(args) {
    return { card: 'generic', kind: 'delete', title: `Remove Cordis Plugin ${args.pluginId}` };
}
/**
 * Render one exact Package activation.
 * @param args - Plugin, Package, and activation mode.
 * @returns replay-safe generic call presentation.
 */
export function presentRunCall(args) {
    return {
        card: 'generic',
        kind: 'execute',
        title: `${args.mode === 'update' ? 'Update' : 'Run'} Cordis Plugin ${args.pluginId} · ${args.packageId}`,
    };
}
/**
 * Render Plugin stop.
 * @param args - Plugin identity to stop.
 * @returns replay-safe generic call presentation.
 */
export function presentStopCall(args) {
    return { card: 'generic', kind: 'execute', title: `Stop Cordis Plugin ${args.pluginId}` };
}
//# sourceMappingURL=present.js.map