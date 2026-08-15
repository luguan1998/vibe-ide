import { CommandUiRuntime } from "./service.js";
import { PopupSelectView } from "./PopupSelectView.js";
import { en, zh } from "./locales.js";
export { CommandUiRuntime } from "./service.js";
export { CommandDirectory } from "./directory.js";
export { filterOptions, PopupSelectController } from "./popup.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'command';
/** Required services: the '/' source registry, session scopes, commands Remote, and locale registry. */
export const inject = ['inputTriggers', 'sessions', 'remote', 'remote.commands', 'locale'];
/**
 * Client plugin body: mount the service, then register the popupSelect shell
 * into the input overlay once its declarer is up.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-commands: dictionaries');
    ctx.plugin(CommandUiRuntime);
    ctx.inject(['slots', 'commandUi', 'sessions'], (scope) => {
        const command = scope.commandUi;
        const sessions = scope.sessions;
        scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
            name: 'conversation.input.overlay',
            id: 'command-popup',
            order: 1,
            locale: NS,
            inject: (sessionId) => {
                const actx = sessions.scope(sessionId);
                if (actx === undefined)
                    throw new Error(`ui-commands: session "${String(sessionId)}" resolved no scope`);
                return { popup: command.popupFor(actx) };
            },
        }, PopupSelectView));
    });
}
//# sourceMappingURL=index.js.map