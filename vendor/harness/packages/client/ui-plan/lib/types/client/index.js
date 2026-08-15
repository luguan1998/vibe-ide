import { PlanChip } from "./PlanModeControl.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'plan';
/** Required services: the seat's slot registry, commands Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale'];
/**
 * Client plugin body: register the plan chip over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plan: dictionaries');
    ctx.slots.inject('conversation.input.plan', () => ctx.slots.register({
        name: 'conversation.input.plan',
        locale: NS,
        inject: (sessionId) => ({
            // Failure strings stay English (error-surface policy: not localized).
            exitPlanMode: async () => {
                const result = await ctx.remote.commands.execute(sessionId, '/plan off');
                if (!result.ok)
                    return `${result.error.message} (${result.error.code})`;
                if (result.value === undefined)
                    return 'unknown command: /plan off';
                return null;
            },
        }),
    }, PlanChip));
}
//# sourceMappingURL=index.js.map