/** Package invariant companion for `@deepseek-ai/dsh-session-log-export`. */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-log-export';
export const name = 'session-export-invariant';
export const inject = ['invariants'];
/** No runtime invariant: the command registry owns lifecycle pairing and ApiProxy owns ZIP integrity. */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Host context carrying the invariant registry.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map