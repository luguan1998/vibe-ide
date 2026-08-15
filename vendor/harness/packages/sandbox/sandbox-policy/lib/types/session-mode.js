/**
 * Per-session sandbox-mode override: the session log as the store. A runtime
 * switch (a UI policy control or test scenario) is recorded as one
 * `sandbox/mode` event on the session it applies to;
 * `effective = fold(events) ?? the deployment default`, so an override
 * survives restart by replay, two sessions can never see each other's state,
 * and there is no external config store. The event is log-only (the
 * `approval/*` precedent): the policy owner projects the fold into each model
 * request, while enforcing tools report operation-specific boundary markers.
 * EXECUTION honors the same fold through `ctx.sandboxPolicy.resolve()` — it
 * stamps the mode together with the calling session's workspace root onto each
 * capability call, weakest-precedence beneath an escalation grant.
 *
 * The override is policy state shared by every enforcing family (bash and
 * filesystem alike), so it lives here in the policy package rather than in any
 * one capability's seam.
 *
 * @module dsh-sandbox-policy/session-mode
 */
/** Every {@link SandboxMode}, for option advertisement and runtime validation of untrusted mode strings. */
export const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];
/**
 * The session's sandbox-mode override: the last `sandbox/mode` event in the
 * log, or undefined when the session never switched (callers apply the
 * deployment default). The pure fold — resume needs no catch-up machinery
 * because replaying the log IS the state.
 * @param events - session events in log order (other event types are skipped).
 * @returns the mode of the last switch event, or undefined without one.
 */
export function effectiveSandboxMode(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === 'sandbox/mode')
            return event.data.mode;
    }
    return undefined;
}
/**
 * THE write path for a session's sandbox-mode override: appends exactly one
 * `sandbox/mode` event — the switch IS its event; nothing mutates mode state
 * out of band. Takes effect on the session's next confined call (bash or fs)
 * — the consumers fold on every read.
 * @param session - the session the override belongs to.
 * @param mode - the mode every subsequent confined call in this session runs
 *   under (until the next switch).
 */
export function setSandboxMode(session, mode) {
    session.append('sandbox/mode', { mode });
}
//# sourceMappingURL=session-mode.js.map