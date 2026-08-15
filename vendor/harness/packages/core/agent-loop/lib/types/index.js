/**
 * Concrete agent-loop plugin: creates scoped ReactLoopAgents, publishes them
 * through the agent/session registries, and owns their ordered teardown.
 *
 * @module @deepseek-ai/dsh-agent-loop
 */
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { Service } from '@deepseek-ai/cordis';
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { emitAgentEvent } from '@deepseek-ai/dsh-agent';
import { errorChain } from '@deepseek-ai/dsh-llm';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { SessionId, SessionPreparation } from '@deepseek-ai/dsh-session';
import { ReactLoopAgent } from "./agent.js";
import { DEFAULT_MAX_PARALLEL_TOOL_CALLS } from "./constants.js";
/** Fiber states that cannot own or serve a new lifecycle. */
const INACTIVE_STATES = new Set([
    5 /* FiberState.UNLOADING */,
    4 /* FiberState.DISPOSED */,
    3 /* FiberState.FAILED */,
]);
/** Factory-level ownership: live agent teardowns plus config startup work. */
class FactoryOwnership {
    fiber;
    accepting = true;
    teardown = new AbortController();
    inactive = Promise.withResolvers();
    liveAgents = new Set();
    startupTasks = new Set();
    constructor(fiber) {
        this.fiber = fiber;
    }
    /** Aborts (reason: `agent loop is not active` error) when factory teardown begins. */
    get signal() {
        return this.teardown.signal;
    }
    isActive() {
        return this.accepting && !INACTIVE_STATES.has(this.fiber.state);
    }
    /** Track one live agent's shared teardown until it has run. */
    track(dispose) {
        this.liveAgents.add(dispose);
        return () => { this.liveAgents.delete(dispose); };
    }
    /** Join config startup work that begins before an agent exists. */
    trackStartup(job) {
        this.startupTasks.add(job);
        const forget = () => { this.startupTasks.delete(job); };
        void job.then(forget, forget);
    }
    /** Join one public create/resume continuation; factory dispose awaits its settlement. */
    trackWrapper(job) {
        this.trackStartup(job.then(() => undefined, () => undefined));
    }
    /** Resolve `task`, or stop waiting when factory teardown begins. */
    async waitWhileActive(job) {
        await Promise.race([job, this.inactive.promise]);
    }
    async dispose() {
        this.accepting = false;
        this.teardown.abort(new Error('agent loop is not active'));
        this.inactive.resolve();
        await Promise.all([
            ...[...this.liveAgents].map(dispose => dispose()),
            ...this.startupTasks,
        ]);
    }
}
/** Await `operation`, or throw the signal's reason as soon as it aborts. */
async function raceAbort(operation, signal, id) {
    const toAbortError = () => signal.reason instanceof Error
        ? signal.reason
        : new Error(`agent "${id}" creation aborted`, { cause: signal.reason });
    if (signal.aborted)
        throw toAbortError();
    const aborted = Promise.withResolvers();
    const listener = () => { aborted.reject(toAbortError()); };
    signal.addEventListener('abort', listener, { once: true });
    try {
        return await Promise.race([Promise.resolve(operation), aborted.promise]);
    }
    finally {
        signal.removeEventListener('abort', listener);
    }
}
/** Start an abortable operation and release a value that arrives after cancellation. */
async function raceAbortCall(operation, signal, id, releaseAbandoned) {
    if (signal.aborted) {
        throw signal.reason instanceof Error
            ? signal.reason
            : new Error(`agent "${id}" creation aborted`, { cause: signal.reason });
    }
    const pending = Promise.resolve().then(operation);
    try {
        return await raceAbort(pending, signal, id);
    }
    catch (error) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the operation is awaited.
        if (signal.aborted && releaseAbandoned !== undefined) {
            void pending.then(releaseAbandoned, () => undefined);
        }
        throw error;
    }
}
/** Resolve the deployment-wide scheduler cap at the owning config boundary. */
function resolveMaxParallelToolCalls(value) {
    const maxParallelToolCalls = value ?? DEFAULT_MAX_PARALLEL_TOOL_CALLS;
    if (!Number.isInteger(maxParallelToolCalls) || maxParallelToolCalls < 1) {
        throw new Error('maxParallelToolCalls must be a positive integer');
    }
    return maxParallelToolCalls;
}
/** Reject an output-token cap that cannot be represented exactly on the request wire. */
function assertAgentOptions(options) {
    if (options.maxTokens !== undefined
        && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0)) {
        throw new TypeError('agent maxTokens must be a positive safe integer');
    }
}
export { DEFAULT_MAX_PARALLEL_TOOL_CALLS };
/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(CONFIGURED_AGENT_IDENTITIES_KEY, identities)`) to fix
 * configured agents' session identities without a config key, so an overlay
 * repointing the row's model route cannot drop them.
 */
export const CONFIGURED_AGENT_IDENTITIES_KEY = 'configuredAgentIdentities';
/**
 * Apply launcher-owned identities over the configured agents, replacing both
 * identity keys for every entry the launcher named so a config-supplied
 * identity can never survive alongside a launcher-supplied one.
 * @param agents - the configured agent entries.
 * @param identities - launcher identities keyed by configured agent `id`, or `undefined`.
 * @returns the entries with launcher-owned identities applied.
 */
function applyLauncherIdentities(agents, identities) {
    if (identities === undefined)
        return agents;
    return agents.map((agent) => {
        const identity = identities[agent.id];
        if (identity === undefined)
            return agent;
        const { sessionId: _sessionId, resumeSessionId: _resumeSessionId, ...rest } = agent;
        return identity.resume
            ? { ...rest, resumeSessionId: identity.id }
            : { ...rest, sessionId: identity.id };
    });
}
/** Settings namespace carrying the tool-call parallelism a user owns. */
export const AGENT_LOOP_SETTINGS_NAMESPACE = settingsNamespace('agent-loop');
/** Schema of the agent-loop settings section. */
export const AGENT_LOOP_SETTINGS_SCHEMA = z.object({
    maxParallelToolCalls: z.number().step(1).min(1).default(DEFAULT_MAX_PARALLEL_TOOL_CALLS),
});
/** Reject self-contained identity conflicts before any configured agent starts. */
function validateConfiguredAgents(agents) {
    const exactIdentities = new Map();
    for (const { id, sessionId, resumeSessionId } of agents) {
        const hasResumeId = resumeSessionId !== undefined && resumeSessionId !== '';
        if (sessionId !== undefined && hasResumeId) {
            throw new Error(`agent "${id}": sessionId and resumeSessionId are mutually exclusive`);
        }
        const exactIdentity = hasResumeId ? resumeSessionId : sessionId;
        if (exactIdentity === undefined)
            continue;
        const firstId = exactIdentities.get(exactIdentity);
        if (firstId !== undefined) {
            throw new Error(`agents "${firstId}" and "${id}" use duplicate exact session identity "${exactIdentity}"`);
        }
        exactIdentities.set(exactIdentity, id);
    }
}
/** Concrete agent factory and driver service. */
export class AgentLoop extends Service {
    static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt'];
    /** Runtime schema for declarative agents. */
    static Config = z.object({
        maxParallelToolCalls: z.number().step(1).min(1).default(DEFAULT_MAX_PARALLEL_TOOL_CALLS),
        agents: z.array(z.object({
            id: z.string().required(),
            sessionId: z.string().min(1),
            provider: z.string(),
            model: z.string(),
            maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
            cwd: z.string(),
            resumeSessionId: z.string(),
        })).default([]),
    });
    /** Validated configuration owned by the agent-loop service. */
    config;
    ownership;
    /** Plain holder prevents Cordis from re-tracing the factory's dependency context through a caller shadow. */
    runtime;
    constructor(ctx, config) {
        super(ctx, 'agentLoop');
        const entry = {
            maxParallelToolCalls: resolveMaxParallelToolCalls(config.maxParallelToolCalls),
        };
        let source = () => entry;
        this.config = {
            ...config,
            agents: applyLauncherIdentities(config.agents, ctx.get(CONFIGURED_AGENT_IDENTITIES_KEY)),
            // Read through on every scheduler decision: `tool-calls.ts` destructures
            // this at the start of each group, so a committed change caps the next
            // group without disturbing the one in flight.
            get maxParallelToolCalls() {
                return source().maxParallelToolCalls;
            },
        };
        installSettingsSection(ctx, AGENT_LOOP_SETTINGS_NAMESPACE, AGENT_LOOP_SETTINGS_SCHEMA, entry, {
            // The schema admits any integer above zero; `resolveMaxParallelToolCalls`
            // owns the whole rule, so refusing here keeps the running scheduler on
            // its last good cap instead of failing at the next tool group.
            validate: value => void resolveMaxParallelToolCalls(value.maxParallelToolCalls),
            setSource: (current) => {
                source = current;
            },
            // Nothing is derived from the cap: the getter above is the only reader.
            onChange: () => { },
        });
        validateConfiguredAgents(this.config.agents);
        this.ownership = new FactoryOwnership(ctx.fiber);
        this.runtime = { ctx };
        ctx.effect(() => () => this.ownership.dispose(), 'agentLoop.transactions()');
        ctx.effect(() => ctx.agents.setFactory(this), 'agentLoop.setFactory()');
        ctx.systemPrompt.variable('provider', context => context.agent?.options.provider);
        ctx.systemPrompt.variable('model', context => context.agent?.options.model);
        ctx.systemPrompt.variable('cwd', context => context.agent?.session.header.cwd);
        for (const { id, sessionId, cwd, resumeSessionId, ...options } of this.config.agents) {
            const meta = cwd === undefined ? {} : { cwd };
            if (resumeSessionId === undefined || resumeSessionId === '') {
                const configuredId = sessionId ?? SessionId(`${id}-session-${randomUUID()}`);
                const persistence = sessionId === undefined ? undefined : ctx.get('sessionPersistence');
                if (persistence === undefined) {
                    this.create(configuredId, options, meta);
                }
                else {
                    const startup = this.restoreOrCreateConfigured(ctx, persistence, configuredId, options, meta).catch((error) => {
                        this.reportConfiguredStartupFailure(id, 'restore', configuredId, error);
                    });
                    this.ownership.trackStartup(startup);
                }
                continue;
            }
            ctx.effect(() => {
                const fiber = ctx.inject(['sessionPersistence'], (childCtx) => {
                    void this.resumeWith(ctx, childCtx.sessionPersistence, {
                        resumeSessionId,
                        agentOptions: options,
                    }).catch((error) => {
                        this.reportConfiguredStartupFailure(id, 'resume', resumeSessionId, error);
                    });
                });
                return fiber.dispose;
            }, `agentLoop.resume(${id})`);
        }
    }
    /** Report a contained declarative-start failure to identity-bound consumers. */
    reportConfiguredStartupFailure(configId, action, sessionId, error) {
        if (!this.ownership.isActive())
            return;
        this.ctx.logger.warn(`agent "${configId}": config-driven ${action} of "${sessionId}" failed: ${errorChain(error)}`);
        const args = ['agent-loop/config-start-failed', { sessionId, error }];
        for (const callback of this.ctx.events.dispatch('emit', args)) {
            try {
                const returned = callback(...args);
                void Promise.resolve(returned).catch((listenerError) => {
                    this.ctx.logger.warn(`agent "${configId}": config-start-failed listener rejected: ${errorChain(listenerError)}`);
                });
            }
            catch (listenerError) {
                this.ctx.logger.warn(`agent "${configId}": config-start-failed listener threw: ${errorChain(listenerError)}`);
            }
        }
    }
    /** Restore a materialized exact config identity on remount, or create it on first use. */
    async restoreOrCreateConfigured(ownerCtx, persistence, sessionId, agentOptions, meta) {
        await this.waitForDrainingConfiguredIdentity(ownerCtx, sessionId);
        if (!this.ownership.isActive())
            return;
        try {
            await this.resumeWith(ownerCtx, persistence, { resumeSessionId: sessionId, agentOptions });
            return;
        }
        catch (error) {
            if (!this.ownership.isActive())
                return;
            // A load is the per-id serialization barrier for eager write-behind and
            // lifecycle retirement. Only a genuinely absent artifact falls back to
            // first creation; corruption and backend failures stay loud.
            const exists = (await persistence.list()).some(header => header.id === sessionId);
            if (exists)
                throw error;
        }
        this.create(sessionId, agentOptions, meta);
    }
    /** Wait for a draining same-id lifecycle to finish registry teardown. */
    async waitForDrainingConfiguredIdentity(ownerCtx, sessionId) {
        // Only an id still occupying a registry needs waiting for; a live healthy
        // occupant is a collision the create/resume below will surface itself.
        if (ownerCtx.agents.get(sessionId) === undefined && ownerCtx.sessions.get(sessionId) === undefined)
            return;
        const released = Promise.withResolvers();
        const checkReleased = () => {
            if (ownerCtx.agents.get(sessionId) === undefined && ownerCtx.sessions.get(sessionId) === undefined) {
                released.resolve();
            }
        };
        const disposeAgentListener = ownerCtx.on('agent/disposed', () => { checkReleased(); });
        const disposeSessionListener = ownerCtx.on('session/disposed', checkReleased);
        try {
            checkReleased();
            await this.ownership.waitWhileActive(released.promise);
        }
        finally {
            disposeAgentListener();
            disposeSessionListener();
        }
    }
    /**
     * Construct the driver, scope, and one memoized reverse teardown for a new
     * agent. The teardown is registered with the factory and the owner fiber
     * BEFORE publication, so a mid-setup unload rolls everything back; `signal`
     * fuses caller cancellation with lifecycle teardown for setup awaits.
     */
    prepare(ownerCtx, id, options, session, callerSignal) {
        assertAgentOptions(options);
        ownerCtx.fiber.assertActive();
        // Every caller reaches prepare() synchronously from a service method
        // whose Cordis dispatch already requires the live factory fiber, or
        // re-checks ownership itself after its awaits (resume's load barrier).
        /* v8 ignore next -- unreachable backstop, see above */
        if (!this.ownership.isActive())
            throw new Error('agent loop is not active');
        if (callerSignal?.aborted) {
            throw callerSignal.reason instanceof Error
                ? callerSignal.reason
                : new Error(`agent "${id}" creation aborted`, { cause: callerSignal.reason });
        }
        const loopCtx = this.runtime.ctx;
        // Deactivation fuses three owners, each with its own reason: the caller's
        // cancellation signal, the owner fiber's unload, and factory teardown.
        // It is registered BEFORE any resource exists, over mutable slots, so an
        // unload arriving while the scope is still minting finds a working
        // disposer instead of a leak.
        const abort = new AbortController();
        const onCallerAbort = () => {
            abort.abort(callerSignal?.reason instanceof Error
                ? callerSignal.reason
                : new Error(`agent "${id}" creation aborted`, { cause: callerSignal?.reason }));
        };
        const onFactoryTeardown = () => { abort.abort(this.ownership.signal.reason); };
        callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
        this.ownership.signal.addEventListener('abort', onFactoryTeardown, { once: true });
        let machine;
        let detachSession;
        let detachAgent;
        let disposing;
        const machineReady = Promise.withResolvers();
        // Reverse teardown, memoized so every racing owner awaits one quiescence:
        // stop the machine, leave the registries, unwind the scope, release
        // bookkeeping.
        const dispose = (ownerTriggered = false) => (disposing ??= (async () => {
            abort.abort(new Error(`agent "${id}" lifecycle disposed`));
            callerSignal?.removeEventListener('abort', onCallerAbort);
            this.ownership.signal.removeEventListener('abort', onFactoryTeardown);
            try {
                // Disposal IS a disposed-cause cancel followed by quiescence. New work
                // sent after this point is the sender's bug — the registries are about
                // to drop the agent, so nothing should still hold it.
                if (machine === undefined)
                    await machineReady.promise;
                if (machine !== undefined) {
                    machine.cancel({ kind: 'disposed' });
                    await machine.whenIdle();
                    await machine.scope.dispose();
                }
            }
            finally {
                try {
                    detachAgent?.();
                    detachSession?.();
                }
                finally {
                    untrack();
                    if (!ownerTriggered)
                        await unfollowOwner();
                }
            }
        })());
        const untrack = this.ownership.track(dispose);
        let unfollowOwner;
        try {
            unfollowOwner = ownerCtx.effect(() => () => {
                // Owner disposal owns the same quiescence boundary. Its teardown skips
                // unregistering this already-running owner effect from inside itself.
                if (disposing !== undefined)
                    return;
                abort.abort(new Error(`agent "${id}" setup aborted: owner disposed during setup`));
                return dispose(true);
            }, `agentLoop.lifecycle(${id})`);
            /* v8 ignore start -- ctx.effect throws only on an inactive fiber, which assertActive() above already rejected */
        }
        catch (error) {
            untrack();
            callerSignal?.removeEventListener('abort', onCallerAbort);
            this.ownership.signal.removeEventListener('abort', onFactoryTeardown);
            throw error;
        }
        /* v8 ignore stop */
        const assertLive = () => {
            if (!abort.signal.aborted)
                return;
            // Every fused abort source carries an Error reason: onCallerAbort and
            // raceAbort wrap non-Error caller reasons, and the factory/lifecycle
            // owners abort with constructed Errors.
            /* v8 ignore next -- unreachable String() arm, see above */
            throw abort.signal.reason instanceof Error ? abort.signal.reason : new Error(String(abort.signal.reason));
        };
        try {
            const agent = machine = new ReactLoopAgent(loopCtx, id, options, session);
            machineReady.resolve();
            assertLive();
            return {
                agent,
                signal: abort.signal,
                publish: (source) => {
                    assertLive();
                    detachSession = agent.ctx.sessions.enter(session);
                    detachAgent = loopCtx.agents.enter(agent, ownerCtx.agent);
                    agent.ctx.sessions.announce(session);
                    assertLive();
                    loopCtx.agents.announce(agent);
                    assertLive();
                    // A synchronous announce/session-start listener may have started
                    // teardown; the machine is already live (delivery works from the
                    // session-start extension point), so only the liveness recheck is owed.
                    emitAgentEvent(loopCtx, agent, 'agent/session-start', { source });
                    assertLive();
                    return { agent, dispose };
                },
                dispose,
            };
        }
        catch (error) {
            machineReady.resolve();
            void dispose();
            throw error;
        }
    }
    /**
     * Create an agent and session under one caller-supplied identity, owned by
     * the accessing fiber. Constructor-driven config calls mint a fresh combined
     * id before entering this boundary.
     * @param id - shared agent/session identity.
     * @param options - concrete loop options.
     * @param meta - optional fresh-session workspace metadata.
     * @returns the published running agent.
     */
    create(id, options = {}, meta = {}) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const preparation = __addDisposableResource(env_1, SessionPreparation.create(this.runtime.ctx.sessions.prepare(id, { meta })), false);
            const prepared = this.prepare(this.ctx, id, options, preparation.session);
            try {
                return prepared.publish('startup').agent;
            }
            catch (error) {
                void prepared.dispose();
                throw error;
            }
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
    /**
     * Create an owned agent on a caller-supplied session id.
     * @param ownerCtx - caller context that structurally owns the lifecycle.
     * @param options - identities, session seed/metadata, loop options, setup, and cancellation.
     * @returns the published handle.
     */
    async createAgent(ownerCtx, options) {
        const preparation = SessionPreparation.create(this.runtime.ctx.sessions.prepare(options.sessionId, {
            ...options.seed === undefined ? {} : { seed: options.seed },
            ...options.meta === undefined ? {} : { meta: options.meta },
        }));
        const published = this.setupAndPublish(ownerCtx, options.sessionId, preparation, options.agentOptions ?? {}, options.setup, options.signal, 'startup');
        this.ownership.trackWrapper(published);
        return published;
    }
    /** Prepare one Agent around an acquired Session, run setup, and publish it. */
    async setupAndPublish(ownerCtx, id, preparation, agentOptions, setup, signal, source) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            const ownedPreparation = __addDisposableResource(env_2, preparation, false);
            const session = ownedPreparation.session;
            const prepared = this.prepare(ownerCtx, id, agentOptions, session, signal);
            try {
                const setupCommit = await raceAbort(setup?.(prepared.agent.ctx), prepared.signal, id);
                setupCommit?.commit();
                return prepared.publish(source);
            }
            catch (error) {
                await prepared.dispose();
                throw error;
            }
        }
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    /**
     * Resume an owned agent from the configured persistence service.
     * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
     * @param options - persisted identity, loop options, setup, and cancellation.
     * @returns the published handle.
     */
    async resume(ownerCtx, options) {
        const persistence = this.runtime.ctx.get('sessionPersistence');
        if (persistence === undefined) {
            throw new Error('cannot resume: session persistence is not configured (load a dsh-session-persistence backend)');
        }
        return this.resumeWith(ownerCtx, persistence, options);
    }
    /** Resume through an explicit persistence handle used by the deferred config path. */
    resumeWith(ownerCtx, persistence, options) {
        const id = options.resumeSessionId;
        const published = (async () => {
            // The load may outlive its owner: race it against caller cancellation,
            // owner-fiber unload, and factory teardown so a never-settling backend
            // cannot pin the identity.
            const ownerAbort = new AbortController();
            const unfollowOwner = ownerCtx.effect(() => () => {
                ownerAbort.abort(new Error(`agent "${id}" setup aborted: owner disposed during setup`));
            }, `agentLoop.resume-load(${id})`);
            const fused = AbortSignal.any([
                ...options.signal === undefined ? [] : [options.signal],
                ownerAbort.signal,
                this.ownership.signal,
            ]);
            let preparation;
            try {
                try {
                    preparation = await raceAbortCall(() => persistence.prepare(id, fused), fused, id, (abandoned) => { abandoned[Symbol.dispose](); });
                }
                finally {
                    await unfollowOwner();
                }
                ownerCtx.fiber.assertActive();
                if (!this.ownership.isActive())
                    throw new Error('agent loop is not active');
                return await this.setupAndPublish(ownerCtx, id, preparation, options.agentOptions ?? {}, options.setup, options.signal, 'resume');
            }
            finally {
                preparation?.[Symbol.dispose]();
            }
        })();
        this.ownership.trackWrapper(published);
        return published;
    }
}
export default AgentLoop;
//# sourceMappingURL=index.js.map