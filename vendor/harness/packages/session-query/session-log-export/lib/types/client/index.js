/** Browser plugin owning Session export download state and its shared modal. */
import { SessionLogDownloadController } from "./controller.js";
import { SessionLogDownloadHeaderAction } from "./HeaderAction.js";
import { en, NS, zh } from "./locales.js";
export const inject = ['slots', 'locale'];
/**
 * Provide the download controller and mount its modal into the Session Header.
 * @param ctx - browser context carrying slots and locale services.
 */
export function apply(ctx) {
    const controller = new SessionLogDownloadController();
    ctx.provide('sessionLogDownload', controller);
    ctx.effect(() => async () => { await controller.dispose(); }, 'session-log-download: browser download lifecycle');
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-log-download: browser dictionaries');
    ctx.on('command/executed', (sessionId, commandName, result) => {
        if (commandName === 'export' && result.kind === 'success')
            void controller.download(sessionId);
    });
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'session-log-download',
        locale: NS,
        inject: () => ({
            hooks: { sessionLogDownload: controller.store },
            request: (sessionId) => controller.download(sessionId),
            dismiss: (sessionId) => { controller.dismiss(sessionId); },
        }),
    }, SessionLogDownloadHeaderAction));
}
//# sourceMappingURL=index.js.map