import { JobListAction } from "./JobListAction.js";
import { en, NS, zh } from "./locales.js";
/** Required services for locale registration and header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale'];
/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-job: dictionaries');
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'job-list',
        // After the subagent catalog: session lineage reads before process work.
        order: 20,
        locale: NS,
    }, JobListAction));
}
//# sourceMappingURL=index.js.map