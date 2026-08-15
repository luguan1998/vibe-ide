import { QuestionComposer } from "./QuestionComposer.js";
import { en, zh } from "./locales.js";
export { PendingQuestion } from "./contract/slots.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'question';
/** Required services: the slot registry and the question composer's copy. */
export const inject = ['slots', 'locale'];
/** Chain routing: claim the composer while a question wait is pending (pure — owner props only). */
function selectQuestion({ interactions }) {
    return interactions.find((i) => i.kind === 'question') ?? null;
}
/**
 * Client plugin body: register the `question` dictionaries and the question
 * composer into the composer chain. Zero business face — data and verbs live
 * on the matched carrier; t rides the standard locale seat.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-user-questions: dictionaries');
    ctx.slots.inject('conversation.composer', () => ctx.slots.register({ name: 'conversation.composer', select: selectQuestion, locale: NS }, QuestionComposer));
}
//# sourceMappingURL=index.js.map