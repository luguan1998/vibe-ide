/** Package-owned session-event invariants for sandbox policy. @module @deepseek-ai/dsh-sandbox-policy/invariant */
import { SANDBOX_MODES } from "./session-mode.js";
const PACKAGE_NAME = '@deepseek-ai/dsh-sandbox-policy';
/** Cordis companion plugin name. */
export const name = 'sandbox-policy-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event, fail) {
    if (event.type === 'sandbox/mode' && !SANDBOX_MODES.includes(event.data.mode)) {
        fail(`sandbox/mode carries unknown mode ${JSON.stringify(event.data.mode)}`);
    }
}
/** Install validation for loaded and newly appended sandbox modes. */
const install = Object.assign((ctx, fail) => {
    for (const session of ctx.sessions.list()) {
        for (const event of session.events)
            validateEvent(event, fail);
    }
    ctx.on('internal/dispatch', (_mode, eventName, args) => {
        if (eventName !== 'session/event')
            return;
        const event = args[1];
        validateEvent(event, fail);
    }, { global: true });
}, { inject: ['sessions'] });
/* jscpd:ignore-end */
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map