import { SkillRow } from "./SkillRow.js";
import { en, NS, zh } from "./locales.js";
/** Required services: reference source faces plus the tool-row and locale registries. */
export const inject = ['inputTriggers', 'connection', 'sessions', 'slots', 'locale', 'remote'];
/**
 * Client plugin body: register the '/' source, dictionaries, and keyed tool row.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill: dictionaries');
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'skill', locale: NS }, SkillRow));
    const skills = ctx.get('connection').api.skills;
    const sessions = ctx.get('sessions');
    // Session-keyed catalog cache; single-flight per key. Plugin-closure state:
    // the fiber effect below is its teardown boundary.
    const fetches = new Map();
    // Per-session lexicon invalidation listeners (subscribeLexicon consumers).
    const lexiconListeners = new Map();
    const notifyLexicon = (sessionId) => {
        for (const listener of [...(lexiconListeners.get(sessionId) ?? [])]) {
            try {
                listener();
            }
            catch (error) {
                // Contain listener failures: settlement notifies from an ignored
                // promise chain (a throw would surface as an unhandled rejection)
                // and one faulty consumer must not starve the others.
                console.error('[ui-skill] lexicon listener failed:', error);
            }
        }
    };
    const fetchCatalog = (sessionId) => {
        if (sessions.subagentAddress(sessionId) !== undefined)
            return Promise.resolve([]);
        const existing = fetches.get(sessionId);
        if (existing !== undefined)
            return existing.promise;
        const abort = new AbortController();
        const promise = (async () => {
            const { result } = await skills.list({ sessionId }, abort.signal);
            if (!result.ok)
                throw new Error(`skill.list failed: ${result.error.code}: ${result.error.message}`);
            return result.value.skills;
        })();
        const entry = { promise, abort };
        fetches.set(sessionId, entry);
        promise.then(
        // Settled snapshot backs the synchronous lexicon reads.
        (skills) => {
            entry.settled = skills;
            notifyLexicon(sessionId);
        }, 
        // A failed fetch must not poison the key: the next consumer retries.
        () => {
            if (fetches.get(sessionId) === entry)
                fetches.delete(sessionId);
        });
        return promise;
    };
    const invalidate = (key) => {
        const entry = fetches.get(key);
        if (entry === undefined)
            return;
        fetches.delete(key);
        entry.abort.abort();
        notifyLexicon(key);
    };
    const clearAll = () => {
        for (const key of [...fetches.keys()])
            invalidate(key);
    };
    // The bound translate resolves against the registered dictionaries with the
    // locale service's own fallback ladder; candidate-time reads stay plain text.
    const t = ctx.locale.bind(NS);
    const source = {
        trigger: '/',
        name: 'skill',
        order: 2,
        async candidates(session, { query, signal }) {
            const skills = await fetchCatalog(session.sessionId);
            // Superseded keystroke: the shared fetch stays warm, this caller yields.
            if (signal.aborted)
                return [];
            return skills
                .filter(skill => skill.name.startsWith(query))
                .map(skill => ({
                name: skill.name,
                // The user-only marker rides the description (the menu's only
                // secondary text); `hint` is the claim-state ghost text, not a badge.
                description: skill.modelInvocable ? skill.description : `${t('menu.userOnly')} · ${skill.description}`,
            }));
        },
        warm(session) {
            // Fire-and-forget scope-birth prewarm; the shared fetch reports
            // through candidates.
            fetchCatalog(session.sessionId).catch(() => { });
        },
        lexicon(session) {
            return fetches.get(session.sessionId)?.settled?.map(skill => skill.name);
        },
        subscribeLexicon(session, listener) {
            const key = session.sessionId;
            const listeners = lexiconListeners.get(key) ?? new Set();
            listeners.add(listener);
            lexiconListeners.set(key, listeners);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0)
                    lexiconListeners.delete(key);
            };
        },
        onPick({ candidate }) {
            // Plain-text-reference decision (web-input-machine note): the pick
            // lands plain text and the prompt ships the same
            // literal. Determinism lives host-side — the host's
            // pre-step boundary (dsh-tool-skill) recognizes the leading /name and
            // injects the rendered body for every entry point. A name shared with a
            // host command still resolves to the command: adjudication claims the
            // line client-side before it ever becomes a prompt.
            return { text: `/${candidate.name} ` };
        },
    };
    const inputTriggers = ctx.get('inputTriggers');
    // A preset decides which skill providers an agent reads, so a switched
    // session's cached catalog belongs to the composition it no longer runs.
    ctx.remote.$on('agent-preset/selected', invalidate);
    ctx.on('connection/reset', clearAll);
    ctx.effect(() => {
        const unregister = inputTriggers.registerSource(source);
        return () => {
            unregister();
            clearAll();
        };
    }, 'ui-skill: source');
}
//# sourceMappingURL=index.js.map