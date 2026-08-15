/**
 * Persistent shell PTY backend over the subprocess terminal primitive, shared
 * sandbox policy, bounded output, and provider-owned session cleanup.
 * @module @deepseek-ai/dsh-terminal-bash
 */
import { TerminalBackendCleanupError } from '@deepseek-ai/dsh-terminal';
import { effectiveSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { validateConfig } from "./config.js";
import { LocalPtySession } from "./session.js";
import { CONTROLLED_PROMPT } from "./sanitize.js";
export { Config } from "./config.js";
/** Cordis plugin name. */
export const name = 'terminal-bash';
/** Required services: PTY registry, shared confinement policy, and process substrate. */
export const inject = ['terminals', 'sandboxPolicy', 'subprocess'];
const sandboxModeFences = new WeakMap();
function ensureSandboxModeFence(ctx, owner) {
    const existing = sandboxModeFences.get(owner);
    if (existing !== undefined) {
        existing.pty = ctx.terminals;
        existing.sandboxPolicy = ctx.sandboxPolicy;
        return;
    }
    const state = { pty: ctx.terminals, sandboxPolicy: ctx.sandboxPolicy };
    sandboxModeFences.set(owner, state);
    owner.ctx.on('internal/dispatch', (_mode, eventName, args) => {
        if (eventName !== 'session/event')
            return;
        const [session, event] = args;
        if (session !== owner.session || event.type !== 'sandbox/mode')
            return;
        const currentMode = effectiveSandboxMode(session.events) ?? state.sandboxPolicy.defaultMode;
        if (event.data.mode === currentMode || !state.pty.hasOwnerActivity(owner))
            return;
        throw new Error(`cannot change sandbox mode from "${currentMode}" to "${event.data.mode}" while persistent terminal sessions are open or being created; wait for creation to settle and close them first`);
    }, { global: true });
}
function childEnvironment(spec) {
    // The subprocess provider supplies its own scrubbed ambient base; these are
    // deliberate terminal-specific overrides layered after it.
    return {
        TERM: 'dumb',
        PAGER: 'cat',
        GIT_PAGER: 'cat',
        PS1: CONTROLLED_PROMPT,
        PROMPT_COMMAND: 'printf "\\033]133;D;%s\\007" "$?"',
        BASH_SILENCE_DEPRECATION_WARNING: '1',
        DSH_SHELL: '1',
        DSH_SESSION_ID: spec.owner.id,
        DSH_PTY_SESSION_ID: spec.sessionId,
    };
}
function spawnArgv(ctx, config, policy) {
    const argv = [config.shellPath, ...config.shellArgs];
    if (policy.mode === 'danger-full-access')
        return argv;
    const sandbox = ctx.get('sandbox');
    if (sandbox === undefined) {
        throw new Error(`terminal-bash: sandbox mode "${policy.mode}" requires a ctx.sandbox provider in the execution world`);
    }
    // Re-state the discriminant because object spread does not preserve its narrowed type.
    return sandbox.confine(argv, { ...policy, mode: policy.mode }).argv;
}
// TODO(pty-initialize-race-home): Fold this outer abort race into
// LocalPtySession.initialize when the send-state consolidation lands; the
// session already owns the send lifecycle the race protects.
async function initializeSession(session, signal) {
    if (signal === undefined) {
        await session.initialize(signal);
        return;
    }
    const aborted = Promise.withResolvers();
    const onAbort = () => { aborted.reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        signal.throwIfAborted();
        await Promise.race([session.initialize(signal), aborted.promise]);
    }
    finally {
        signal.removeEventListener('abort', onAbort);
    }
}
/** Local shell backend registered under the configured type. */
export class BashTerminalBackend {
    ctx;
    config;
    spawnTerminal;
    createSession;
    type;
    constructor(ctx, config, spawnTerminal = spec => ctx.subprocess.spawnTerminal(spec), createSession = (terminal, config) => new LocalPtySession(terminal, config)) {
        this.ctx = ctx;
        this.config = config;
        this.spawnTerminal = spawnTerminal;
        this.createSession = createSession;
        this.type = config.backendType;
    }
    async spawn(spec) {
        spec.signal?.throwIfAborted();
        ensureSandboxModeFence(this.ctx, spec.owner);
        const policy = this.ctx.sandboxPolicy.resolve({ session: spec.owner.session });
        const argv = spawnArgv(this.ctx, this.config, policy);
        if (argv[0] === undefined)
            throw new Error('terminal-bash: sandbox returned empty argv');
        const terminal = await this.spawnTerminal({
            argv,
            cwd: spec.cwd ?? policy.workspaceRoot,
            env: childEnvironment(spec),
            rows: this.config.rows,
            cols: this.config.cols,
            graceMs: this.config.disposeGraceMs,
            signal: spec.signal,
        });
        const session = this.createSession(terminal, this.config);
        try {
            await initializeSession(session, spec.signal);
            return session;
        }
        catch (error) {
            try {
                await session.close('PTY startup failed');
            }
            catch (closeError) {
                throw new TerminalBackendCleanupError(error, closeError);
            }
            throw error;
        }
    }
}
/** Register the local PTY backend. */
export function apply(ctx, config) {
    validateConfig(config);
    ctx.terminals.registerBackend(new BashTerminalBackend(ctx, config));
}
//# sourceMappingURL=index.js.map