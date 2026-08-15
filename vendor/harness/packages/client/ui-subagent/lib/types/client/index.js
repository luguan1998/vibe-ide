import { SubagentCatalogAction } from "./SubagentCatalogAction.js";
import { SubagentReadOnlyComposer, } from "./SubagentReadOnlyComposer.js";
import { en, NS, zh } from "./locales.js";
/** Required services for references, conversation slots, and session navigation. */
export const inject = ['inputTriggers', 'sessions', 'slots', 'locale'];
/** Claim the composer for one-shot history or an unavailable continuation owner. */
function selectReadOnlySubagent(owner) {
    const subagent = owner.session?.subagent;
    if (subagent === undefined || subagent === null)
        return null;
    if (subagent.address.mode === 'one-shot')
        return { reason: 'one-shot' };
    if (subagent.parentAvailable)
        return null;
    // A RUNNING parent-offline continuable child keeps the default composer:
    // its input is disabled there, but the same primary Stop stays available so
    // the child can be interrupted. Once it stops, this takeover returns.
    return owner.session?.running === true ? null : { reason: 'parent-unavailable' };
}
/**
 * Client plugin body: register the '@' subagent source over the root session list.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-subagent: dictionaries');
    const sessions = ctx.sessions;
    // Child labels live on the session list (parentId lineage + displayTitle),
    // not the conversation snapshot — the list store is the zero-RPC candidate feed.
    const childLabels = (session, query) => {
        const { byId } = sessions.list.getSnapshot();
        return Object.values(byId)
            .filter(child => child.parentId === session.sessionId && child.running && child.displayTitle.includes(query))
            .map(child => child.displayTitle);
    };
    const source = {
        trigger: '@',
        name: 'subagent',
        candidates(session, { query }) {
            return Promise.resolve(childLabels(session, query).map(name => ({ name })));
        },
        lexicon(session) {
            // The list snapshot is always warm — the full running-children roster.
            return childLabels(session, '');
        },
        subscribeLexicon(_session, listener) {
            // The roll derives from the list snapshot, so its change feed IS the list's.
            return sessions.list.subscribe(listener);
        },
        onPick({ candidate }) {
            // Plain-text reference: the literal lands in the draft
            // and ships to the model verbatim (trailing space closes the token).
            return { text: `@${candidate.name} ` };
        },
        codec: {
            clipboardText: ref => `@${ref}`,
            // TODO: serialize returns the raw label until the '@' consumption
            // feature defines a model representation.
            serialize: ref => Promise.resolve(`@${ref}`),
        },
    };
    const inputTriggers = ctx.get('inputTriggers');
    ctx.effect(() => inputTriggers.registerSource(source), 'ui-subagent: @ source');
    const catalogActions = (_parentSessionId) => ({
        openChild(address) {
            sessions.openSubagent(address);
        },
        refresh(parentSessionId) {
            void sessions.refreshSubagents(parentSessionId);
        },
        setCatalogOpen(parentSessionId, open) {
            sessions.setSubagentCatalogOpen(parentSessionId, open);
        },
    });
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'subagent-catalog',
        order: 10,
        locale: NS,
        inject: catalogActions,
    }, SubagentCatalogAction));
    ctx.slots.inject('conversation.composer', () => ctx.slots.register({
        name: 'conversation.composer',
        priority: -10,
        locale: NS,
        select: selectReadOnlySubagent,
    }, SubagentReadOnlyComposer));
}
//# sourceMappingURL=index.js.map