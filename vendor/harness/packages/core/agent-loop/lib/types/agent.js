/**
 * Default Agent driver over queued turns and step-boundary input. Every request
 * is derived from the session log.
 * @module dsh-agent-loop/agent
 */
import { Inbox, agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent';
import { BlockAssembler, LlmError, createAssistantMessage, deepFreeze, errorChain, markAgentLoopRequest, } from '@deepseek-ai/dsh-llm';
import { createScope } from '@deepseek-ai/dsh-scope';
import { canonicalHeader, headerEquals } from '@deepseek-ai/dsh-session';
import { joinContextSections, renderContextSections, renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { RuntimeContextProjection } from "./runtime-context.js";
import { executeToolCalls } from "./tool-calls.js";
/** Remove adapter-derived values before plugins propose the next request config. */
function requestProposal(header) {
    if (header.adapterDefaults === undefined)
        return header.config;
    const proposal = { ...header.config };
    if (header.adapterDefaults.reasoningEffort === true)
        delete proposal.reasoningEffort;
    if (header.adapterDefaults.maxTokens === true)
        delete proposal.maxTokens;
    return proposal;
}
/** Drives one session through turn and step boundaries. */
export class ReactLoopAgent {
    loopCtx;
    id;
    options;
    session;
    inbox;
    phase;
    activityDone = Promise.resolve();
    /** The agent-scoped registration boundary; the lifecycle owner unwinds it after the driver exits. */
    scope;
    ctx;
    /** Fused dispatcher, built once in the constructor so hot-path dispatches never allocate. */
    dispatch;
    /** Whether this loop instance has appended its initial/resume request anchor. */
    requestHeaderLogged = false;
    runtimeContext;
    constructor(loopCtx, id, options, session) {
        this.loopCtx = loopCtx;
        this.id = id;
        this.options = options;
        this.session = session;
        this.dispatch = agentEvents(loopCtx, this);
        this.inbox = new Inbox(session, {
            inserted: (message) => { this.dispatch.emit('agent/inbox/inserted', { message }); },
            discarded: (message) => { this.dispatch.emit('agent/inbox/discarded', { message }); },
            claimed: (message, turn) => { this.dispatch.emit('agent/inbox/claimed', { message, turn }); },
        });
        const lastTurn = session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0;
        this.phase = { kind: 'idle', lastTurn };
        this.scope = createScope(loopCtx, this);
        this.ctx = this.scope.ctx.extend({ agent: this });
        this.runtimeContext = new RuntimeContextProjection(this.ctx, session);
    }
    get status() {
        return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running';
    }
    /** Commit a phase and publish its externally visible status transition. */
    setPhase(next) {
        const previousStatus = this.status;
        this.phase = next;
        const status = this.status;
        if (status !== previousStatus) {
            this.dispatch.emit('agent/status', { status });
        }
    }
    send(message, target, wakeup) {
        // Waking input cannot join an aborted activity, so it starts the next turn.
        // Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it.
        const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted;
        const resolvedTarget = wakingAfterAbort ? 'next-turn' : target;
        this.inbox.splice(resolvedTarget, Infinity, 0, [message]);
        if (wakeup)
            this.wakeDriver(wakingAfterAbort);
    }
    followup(input) {
        this.send(input, 'next-turn', true);
    }
    steer(input) {
        this.send(input, 'next-step', true);
    }
    inject(input) {
        this.send(input, 'next-step', false);
    }
    cancel(cause, options = {}) {
        if (!options.keepInbox) {
            this.inbox.clear();
            if (this.phase.kind !== 'idle')
                this.phase.wakeRequested = false;
        }
        if (this.phase.kind !== 'idle')
            this.phase.abort.abort(cause);
    }
    runMaintenance(job) {
        if (this.phase.kind !== 'idle')
            throw new Error(`agent "${this.id}" already has active work`);
        const done = Promise.withResolvers();
        const maintenance = {
            kind: 'maintenance',
            abort: new AbortController(),
            lastTurn: this.phase.lastTurn,
            wakeRequested: false,
        };
        this.setPhase(maintenance);
        this.activityDone = done.promise;
        return (async () => {
            try {
                return await job(maintenance.abort.signal);
            }
            finally {
                this.setPhase({ kind: 'idle', lastTurn: maintenance.lastTurn });
                if (maintenance.wakeRequested && this.inbox.hasPending)
                    this.wakeDriver();
                done.resolve();
            }
        })();
    }
    /**
     * Start one driver, or latch its wake behind maintenance or an aborted
     * activity. A wake sent while idle always opens its turn boundary, even
     * when its message was cleared; only a latched replay is suppressed when
     * the queue no longer holds the wake.
     * @param wakeAfterAbort - the {@link send} classification, captured before
     *   the inbox insertion so a reentrant cancel cannot reclassify it.
     */
    wakeDriver(wakeAfterAbort = false) {
        if (this.phase.kind !== 'idle') {
            // Maintenance and aborted drivers cannot deliver the wake: latch it for
            // replay at convergence. Live drivers claim queued work themselves;
            // disposal never latches, so teardown waits on no model turn.
            const reason = this.phase.abort.signal.reason;
            if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
                this.phase.wakeRequested = true;
            }
            return;
        }
        const driver = Promise.withResolvers();
        this.activityDone = driver.promise;
        this.setPhase({
            kind: 'running',
            abort: new AbortController(),
            turn: this.phase.lastTurn,
            step: 0,
            wakeRequested: false,
        });
        this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject);
    }
    async whenIdle() {
        let activity;
        do {
            await (activity = this.activityDone);
        } while (activity !== this.activityDone);
    }
    /** Report one failure at its live boundary, then preserve it for driver containment. */
    throwError(error) {
        const turn = this.phase.kind === 'running' ? this.phase.turn : this.phase.lastTurn;
        const step = this.phase.kind === 'running' ? this.phase.step : 0;
        this.dispatch.emit('agent/error', { turn, step, error });
        throw error;
    }
    async kick() {
        try {
            while (await this.turn()) { }
        }
        catch (_error) {
            // Reported failures and cancellation are contained at the driver boundary.
        }
        finally {
            /* v8 ignore next -- kick owns a running phase until this driver boundary */
            if (this.phase.kind === 'running') {
                const { turn, wakeRequested } = this.phase;
                this.setPhase({ kind: 'idle', lastTurn: turn });
                if (wakeRequested && this.inbox.hasPending)
                    this.wakeDriver();
            }
        }
    }
    async preStep(target, position) {
        /* v8 ignore next -- private callers establish the running phase before proposing a step */
        if (this.phase.kind !== 'running')
            throw new Error(`agent "${this.id}": pre-step outside running phase`);
        const signal = this.phase.abort.signal;
        const claimed = this.inbox.claim(target, position.turn);
        const assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal));
        signal.throwIfAborted();
        const sections = renderContextSections(assembly);
        const context = this.runtimeContext.project(joinContextSections(sections), sections);
        const decision = await this.dispatch.waterfall('agent/pre-step', { messages: claimed, ...position, signal }, () => Promise.resolve({
            kind: 'enter',
            messages: context === undefined ? claimed : [...claimed, context],
        }));
        signal.throwIfAborted();
        return decision.kind === 'reject' ? decision : { ...decision, assembly };
    }
    /** Open one turn before claiming its first proposed step. */
    async turn() {
        if (this.phase.kind !== 'running') {
            this.throwError(new Error(`agent "${this.id}": turn without driver reservation`));
        }
        const phase = this.phase;
        const { signal } = phase.abort;
        signal.throwIfAborted();
        const turn = phase.turn + 1;
        try {
            this.session.append('turn/start', { turn });
        }
        catch (error) {
            this.throwError(error);
        }
        phase.turn = turn;
        let turnEnds = null;
        let target = 'next-turn';
        try {
            while (true) {
                signal.throwIfAborted();
                const step = phase.step + 1;
                const decision = await this.preStep(target, { turn, step });
                if (decision.kind === 'reject') {
                    turnEnds = { kind: 'blocked' };
                    return false;
                }
                if (turnEnds && decision.messages.length === 0)
                    break;
                // A removed waking message or an enter decision rewritten to empty
                // still owns the initial turn boundary, but it spends no model call.
                if (phase.step === 0 && decision.messages.length === 0) {
                    turnEnds = { kind: 'completed' };
                    return false;
                }
                signal.throwIfAborted();
                this.session.append('step/start', { turn, step });
                phase.step = step;
                try {
                    for (const message of decision.messages) {
                        this.session.append('user/message', message, { surfaceOp: 'append' });
                    }
                    // max-tokens is sticky: once any step hits the ceiling, later steps
                    // that complete normally must not downgrade the turn outcome.
                    const stepEnd = await this.step(decision.assembly);
                    // max-tokens stays sticky: a later completed step must not
                    // downgrade the turn outcome.
                    if (turnEnds === null || turnEnds.kind !== 'max-tokens')
                        turnEnds = stepEnd;
                }
                finally {
                    this.session.append('step/end', { turn, step });
                }
                signal.throwIfAborted();
                if (turnEnds && this.inbox.nextStep.length === 0) {
                    await this.dispatch.serial('agent/turn-stopping', { turn, signal });
                    signal.throwIfAborted();
                }
                if (turnEnds && this.inbox.nextStep.length === 0)
                    break;
                target = 'next-step';
            }
        }
        catch (error) {
            if (signal.aborted) {
                turnEnds = { kind: 'aborted', reason: signal.reason };
                throw error;
            }
            // Every failure is structured: an `LlmError` keeps its facts, anything
            // else flattens to `errorChain` text under the `UNKNOWN` code.
            turnEnds = {
                kind: 'error',
                error: error instanceof LlmError
                    ? error.failure
                    : { message: errorChain(error), code: 'UNKNOWN' },
            };
            this.throwError(error);
        }
        finally {
            try {
                // oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending
                this.session.append('turn/end', { turn, reason: turnEnds });
            }
            catch (error) {
                this.throwError(error);
            }
        }
        if (!this.inbox.hasPending)
            return false;
        phase.abort = new AbortController();
        // A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
        phase.wakeRequested = false;
        phase.step = 0;
        return true;
    }
    async step(assembly) {
        /* v8 ignore next -- private callers establish the running phase before executing a step */
        if (this.phase.kind !== 'running')
            throw new Error(`agent "${this.id}": step outside running phase`);
        const { turn, step, abort: { signal } } = this.phase;
        signal.throwIfAborted();
        const system = renderPrompt(assembly);
        while (true) {
            const { request, preparedCall } = await this.buildRequest(turn, step, assembly.tools, system, this.session.deriveMessages(), signal);
            const assembler = new BlockAssembler();
            const chunkSeqs = [];
            const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request);
            signal.throwIfAborted();
            for await (const chunk of stream) {
                signal.throwIfAborted();
                chunkSeqs.push(this.session.append('assistant/chunk', { turn, step, chunk }).seq);
                assembler.push(chunk);
            }
            signal.throwIfAborted();
            const finish = assembler.finish;
            if (finish.kind === 'error' || finish.kind === 'aborted') {
                const action = await this.dispatch.waterfall('agent/request-error', {
                    turn,
                    step,
                    provider: request.provider,
                    failure: finish.failure,
                    retryPolicy: preparedCall?.retryPolicy,
                    signal,
                }, () => Promise.resolve(undefined));
                signal.throwIfAborted();
                if (action?.kind !== 'retry') {
                    throw new LlmError(finish.failure.message, finish.failure.code, finish.failure);
                }
                continue;
            }
            const message = createAssistantMessage({
                content: assembler.blocks(),
                source: {
                    provider: request.provider,
                    model: request.model,
                    ...assembler.replayState !== undefined ? { replayState: assembler.replayState } : {},
                },
            });
            this.session.append('assistant/message', {
                turn,
                step,
                message,
                ...assembler.usage === undefined ? {} : { usage: assembler.usage },
            }, { surfaceOp: 'append', sourceEventSeqs: chunkSeqs });
            if (finish.kind === 'max-tokens')
                return { kind: 'max-tokens' };
            const toolCalls = message.content.filter(block => block.type === 'tool-call');
            if (toolCalls.length === 0)
                return { kind: 'completed' };
            const { concluded } = await executeToolCalls(this.loopCtx, turn, step, toolCalls, signal, context => this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context]));
            return concluded ? { kind: 'completed' } : null;
        }
    }
    /**
     * Compose one frozen request and bind it to the adapter registration that
     * resolved its exact-model defaults.
     */
    async buildRequest(turn, step, tools, system, boundaryMessages, signal) {
        const { session } = this;
        // A loop instance starts from its declared route, restoring only an explicit
        // effort owned by that exact model. Later steps re-resolve marked defaults.
        const persistedHeader = session.requestHeader();
        const persistedConfig = persistedHeader?.config;
        const route = { provider: this.options.provider ?? '', model: this.options.model ?? '' };
        const reasoningEffort = persistedConfig?.provider === route.provider
            && persistedConfig.model === route.model
            && persistedHeader?.adapterDefaults?.reasoningEffort !== true
            ? persistedConfig.reasoningEffort
            : undefined;
        const maxTokens = this.options.maxTokens;
        const seedConfig = deepFreeze(structuredClone(this.requestHeaderLogged
            // oxlint-disable-next-line typescript/no-non-null-assertion -- the instance logged the header it now folds
            ? requestProposal(persistedHeader)
            : {
                ...route,
                ...reasoningEffort === undefined ? {} : { reasoningEffort },
                ...maxTokens === undefined ? {} : { maxTokens },
            }));
        const proposedConfig = await this.dispatch.waterfall('agent/request', { turn, step, signal }, () => Promise.resolve(seedConfig));
        signal.throwIfAborted();
        if (!proposedConfig.provider || !proposedConfig.model) {
            throw new Error(`agent "${this.id}" has no provider/model: set AgentOptions.provider and AgentOptions.model or supply both via the agent/request waterfall`);
        }
        let config;
        let preparedCall;
        try {
            preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal);
            config = preparedCall.config;
        }
        catch (error) {
            // Middleware may serve an unregistered route; terminal dispatch still requires an adapter.
            if (!(error instanceof LlmError) || error.code !== 'NO_ADAPTER')
                throw error;
            config = proposedConfig;
        }
        signal.throwIfAborted();
        const header = canonicalHeader({
            config,
            ...preparedCall === undefined ? {} : { adapterDefaults: preparedCall.adapterDefaults },
            ...system ? { system } : {},
            ...tools.length > 0 ? { tools } : {},
        });
        const baseline = this.session.requestHeader();
        if (!this.requestHeaderLogged) {
            this.session.append('request/header', { header, reason: baseline === undefined ? 'initial' : 'resume' });
            this.requestHeaderLogged = true;
        }
        else if (baseline === undefined || !headerEquals(baseline, header)) {
            this.session.append('request/header', { header, reason: 'change' });
        }
        const contextWindow = preparedCall?.context?.contextWindow;
        const requestContext = {
            provider: config.provider,
            model: config.model,
            ...contextWindow === undefined ? {} : { contextWindow },
        };
        const previousContext = session.requestContext();
        if (previousContext?.provider !== requestContext.provider
            || previousContext.model !== requestContext.model
            || previousContext.contextWindow !== requestContext.contextWindow) {
            session.append('request/context', requestContext);
        }
        signal.throwIfAborted();
        const request = markAgentLoopRequest(deepFreeze({
            ...header.config,
            messages: boundaryMessages,
            ...header.system !== undefined ? { system: header.system } : {},
            ...header.tools !== undefined ? { tools: header.tools } : {},
            sessionId: this.session.id,
            signal,
        }));
        return { request, ...preparedCall === undefined ? {} : { preparedCall } };
    }
}
//# sourceMappingURL=agent.js.map