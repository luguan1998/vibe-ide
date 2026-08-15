import { SettingsScopeBinder } from "./settings-scope.js";
export { SettingsScopeController, SettingsScopeBinder } from "./settings-scope.js";
/**
 * Required services: none. The transport is resolved per caller through
 * `this.ctx` at `bind` time, so this plugin waits for nothing.
 */
export const inject = [];
/**
 * Provide the settings-namespace scope service.
 *
 * Constructing the service in this plugin's fiber keeps its traced methods
 * bound to each consuming plugin's context.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    new SettingsScopeBinder(ctx);
}
//# sourceMappingURL=index.js.map