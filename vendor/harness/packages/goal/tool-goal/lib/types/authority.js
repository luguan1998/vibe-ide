/** Execution-time authority checks for the model-facing goal tools. */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** Throw one structured tool-policy failure. */
function reject(message, code = 'GOAL_TOOL_AUTHORITY_REQUIRED') {
    throw new HarnessError(message, code);
}
/** Locate the open turn enclosing a model tool call. */
function openTurn(agent) {
    const events = agent.session.events;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const boundary = events[index];
        if (boundary?.type === 'turn/end') {
            reject('goal tools require an open model turn', 'GOAL_TOOL_DRIVER_REQUIRED');
        }
        if (boundary?.type === 'turn/start') {
            return { start: boundary, events: events.slice(index + 1) };
        }
    }
    return reject('goal tools require an open model turn', 'GOAL_TOOL_DRIVER_REQUIRED');
}
/**
 * Resolve and authenticate the calling agent and its driver boundary.
 * @param ctx - Context carrying the live agent registry.
 * @param exec - Tool execution metadata supplied by the registry.
 * @returns The authenticated agent and its current turn window.
 */
export function goalToolExecution(ctx, exec) {
    const agent = exec.agent;
    if (agent === undefined) {
        return reject('goal tools require a calling agent', 'GOAL_TOOL_AGENT_REQUIRED');
    }
    if (ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
        || ctx.agents.currentInitiator() !== agent) {
        return reject('goal tools require the exact live calling agent inside its active driver', 'GOAL_TOOL_DRIVER_REQUIRED');
    }
    return { agent, ...openTurn(agent) };
}
/**
 * Whether host-attested human input appears in the current root-agent turn.
 * An omitted `Agent.followup()` / `steer()` source resolves to `user`, so non-human
 * producers must supply their own source rather than inheriting this authority.
 */
function hasDirectHumanInput(ctx, execution) {
    if (!ctx.agents.roots().includes(execution.agent))
        return false;
    return execution.events.some(event => event.type === 'user/message' && event.data.source.kind === 'user');
}
/** Whether this turn is the current goal's exact admitted round. */
function isMatchingGoalRound(execution, goal) {
    return execution.events.some(event => event.type === 'user/message'
        && event.data.source.kind === 'goal'
        && event.data.source.goalId === goal.id
        && event.data.source.revision === goal.revision
        && event.data.source.round === goal.roundsStarted);
}
/**
 * Require authority originating in a human message accepted by a runtime root.
 * @param ctx - Context carrying the live agent graph.
 * @param execution - Authenticated current tool execution.
 */
export function requireDirectHuman(ctx, execution) {
    if (hasDirectHumanInput(ctx, execution))
        return;
    reject('this goal operation requires a direct human turn on a top-level agent');
}
/**
 * Resolve completion authority from either direct human input or the exact goal round.
 * @param ctx - Context carrying live agents and goal state.
 * @param execution - Authenticated current tool execution.
 * @returns The direct-human or exact-goal-round authority grant.
 */
export function completionAuthority(ctx, execution) {
    if (hasDirectHumanInput(ctx, execution))
        return { kind: 'direct-human' };
    const goal = ctx.goals.get(execution.agent);
    if (goal !== undefined && isMatchingGoalRound(execution, goal)) {
        return { kind: 'goal-round', goal };
    }
    return reject('complete and blocked require a direct human turn or the current goal round');
}
//# sourceMappingURL=authority.js.map