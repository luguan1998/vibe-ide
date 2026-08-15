/**
 * Generated scoped-event routing-subject resolvers for dsh-scope invariants.
 * Do not edit by hand; run `pnpm run gen-scoped-events`.
 *
 * @module @deepseek-ai/dsh-scope/scoped-events.generated
 */
const scopedSubjectResolvers = Object.freeze({
    'agent/created': args => args[0]['agent'],
    'agent/disposed': args => args[0]['agent'],
    'agent/error': args => args[0]['agent'],
    'agent/inbox/claimed': args => args[0]['agent'],
    'agent/inbox/discarded': args => args[0]['agent'],
    'agent/inbox/inserted': args => args[0]['agent'],
    'agent/pre-step': args => args[0]['agent'],
    'agent/request': args => args[0]['agent'],
    'agent/request-error': args => args[0]['agent'],
    'agent/session-start': args => args[0]['agent'],
    'agent/status': args => args[0]['agent'],
    'agent/turn-stopping': args => args[0]['agent'],
    'approval/request': args => args[0]['agent'],
    'goal/changed': args => args[0]['agent'],
    'session/created': null,
    'session/disposed': null,
    'session/event': null,
    'session/flush': null,
    'subagent/end': null,
    'subagent/start': null,
    'system-prompt/assemble': args => args[1]['scope'],
    'tools/code-dispatch-log': args => args[0]['agent'],
    'tools/execute': args => args[0]['agent'],
    'tools/post-execute': args => args[0]['agent'],
    'tools/pre-execute': args => args[0]['agent'],
    'tools/result': args => args[0]['agent'],
});
/**
 * Resolve the routing key named by one scoped event payload. A null
 * resolver means the payload cannot expose its external routing key, so the
 * invariant checks carrier presence only.
 * @param event - runtime Cordis event name.
 * @returns the generated subject resolver, null for presence-only,
 *   or undefined when the event is not scope-filtered.
 */
export function scopedSubjectResolverFor(event) {
    return scopedSubjectResolvers[event];
}
//# sourceMappingURL=scoped-events.generated.js.map