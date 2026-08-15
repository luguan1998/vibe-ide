import { NativeDirectoryFlow } from "./flow.js";
/** Required services (cordis fiber inject): the slot registry and the wire-facing workspace service. */
export const inject = ['slots', 'workspaces'];
/**
 * Client plugin body: register the renderless native flow into both
 * directory-flow holes through `slots.inject()` because the ui-workspace
 * entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    const injected = () => ({ pick: () => ctx.workspaces.pickDirectory() });
    // Both declaration lifetimes must be live before the pair installs; the
    // generator makes the two registrations one transactional effect. The
    // outer/inner nesting order is arbitrary; neither hole has precedence.
    ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
        yield ctx.slots.register({
            name: 'conversation.hero.workspace.directoryFlow', inject: injected,
        }, NativeDirectoryFlow);
        yield ctx.slots.register({
            name: 'sidebar.workspaces.directoryFlow', inject: injected,
        }, NativeDirectoryFlow);
    }));
}
//# sourceMappingURL=index.js.map