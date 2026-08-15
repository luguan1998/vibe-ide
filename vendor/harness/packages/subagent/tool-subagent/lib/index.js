import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { assertSubagentMaxDepth, settleRun } from "@deepseek-ai/dsh-subagent";
//#region lib/types/index.js
/**
* Model-facing delegation through one configured `ctx.subagents` provider.
* Provider lifecycle controls tool registration and context-sensitive schema
* wording. Foreground calls always dispose the run after collection.
* Background policy is selected by this plugin's configuration: one-shot
* calls own a plain Task, while continuable calls use
* `ctx.subagents.startContinuable()`.
* @module @deepseek-ai/dsh-tool-subagent
*/
const name = "tool-subagent";
const inject = [
	"tools",
	"subagents",
	"systemPrompt"
];
/** Prompt order after bounded delegation policy and before child reporting. */
const SUBAGENT_SECTION_ORDER = 116.5;
const Config = z.object({
	provider: z.string().required(),
	toolName: z.string().default("subagent"),
	enableRunInBackground: z.boolean().default(true),
	backgroundMode: z.union(["one-shot", "continuable"]).default("one-shot"),
	agentOptions: z.object({
		provider: z.string(),
		model: z.string(),
		maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
	}).default(void 0),
	persona: z.string(),
	toolFilter: z.object({
		allow: z.array(z.string()).default(void 0),
		deny: z.array(z.string()).default(void 0)
	}).default(void 0),
	maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const("provider-managed")]).default(3)
});
/** Render text blocks from the canonical JSON block array without trusting arbitrary values. */
function outputValueText(values) {
	return values.filter((value) => typeof value === "object" && value !== null && !Array.isArray(value) && value.type === "text" && typeof value.text === "string").map((value) => value.text).join("");
}
/** Settle pending startup without rejecting the task producer contract. */
async function settleStart(start, signal) {
	try {
		return await settleRun(await start);
	} catch (error) {
		return signal.aborted ? { status: "killed" } : {
			status: "failed",
			detail: String(error)
		};
	}
}
/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result) {
	switch (result.stopReason) {
		case "completed": return;
		case "aborted": return "subagent run was cancelled";
		case "error": return "subagent run failed";
		case "max-tokens": return "subagent run hit its token limit before finishing";
		case "refusal": return "subagent declined the task";
		default: return `subagent run ended abnormally (${String(result.stopReason)})`;
	}
}
/**
* Append the child's preserved partial answer to a stop-reason error so a
* truncated or cancelled child's real text still reaches the parent model.
* @param error - the stop-reason headline.
* @param output - the child's selected output (`SubagentResult.output`).
* @returns the headline, extended with the partial text when any exists.
*/
function withPartialText(error, output) {
	const text = output.filter((block) => block.type === "text").map((block) => block.text).join("");
	return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`;
}
/**
* Collect and release one foreground run without letting disposal replace an
* independent result failure.
*/
async function settleForegroundRun(run) {
	const [execution] = await Promise.allSettled([run.result.then((result) => {
		const error = stopReasonError(result);
		if (error !== void 0) throw new Error(withPartialText(error, result.output));
		return {
			kind: "foreground",
			runId: run.id,
			output: result.output
		};
	})]);
	const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())]);
	if (execution.status === "rejected") {
		if (disposal.status === "rejected") throw new AggregateError([execution.reason, disposal.reason], `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`);
		throw execution.reason;
	}
	if (disposal.status === "rejected") throw disposal.reason;
	return execution.value;
}
/**
* Model-facing wording from the provider's conversation-history descriptor
* ({@link SubagentProvider.inheritsParentContext}).
* A fresh child needs a standalone prompt; a forked child already sees the
* conversation's completed turns — telling the model to restate everything
* (or, worse, that the child "does not see this conversation") would be false
* for a fork.
* @param inheritsConversation - whether the child's conversation is seeded
*   with the parent's completed turns; this says nothing about tool, service,
*   scope, or authority inheritance.
* @returns the tool `description` and the `prompt` parameter description.
*/
function providerWording(inheritsConversation) {
	if (inheritsConversation) return {
		description: "Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn). Use this when the subtask builds on this conversation's context — a follow-up analysis, a review, a continuation — without consuming this conversation's context for the work itself. You receive its result, not its intermediate steps.",
		promptDescription: "The task for the subagent. It already sees this conversation's completed turns, so build on them freely and state only what is new."
	};
	return {
		description: "Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation's context. The subagent returns its result, not its intermediate steps. Give it a complete, standalone prompt: it does not see this conversation.",
		promptDescription: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs."
	};
}
/** Resolve the model's optional scheduling request into one execution route. */
function resolveDelegationRun(request, options) {
	if (!options.backgroundEnabled) {
		if (request.run_in_background === true) throw new Error("run_in_background is disabled for this tool instance (enableRunInBackground: false)");
		return { runInBackground: false };
	}
	return { runInBackground: request.run_in_background ?? options.continuable };
}
function apply(ctx, config) {
	if (config.maxDepth !== "provider-managed") assertSubagentMaxDepth(config.maxDepth);
	if (config.toolFilter !== void 0 && config.toolFilter.allow === void 0 && config.toolFilter.deny === void 0) throw new Error("tool-subagent: `toolFilter` is configured but names neither `allow` nor `deny` — remove the key or fill the filter");
	const backgroundEnabled = config.enableRunInBackground !== false;
	const continuable = (config.backgroundMode ?? "one-shot") === "continuable";
	const toolName = config.toolName ?? "subagent";
	let disposeTool;
	const mount = (provider) => {
		if (typeof config.maxDepth === "number" && !provider.capabilities.depthLimit) throw new Error(`tool-subagent: provider "${provider.name}" cannot enforce maxDepth (no depthLimit capability) — set maxDepth: 'provider-managed' to leave the recursion budget to the provider`);
		const wording = providerWording(provider.inheritsParentContext);
		if (continuable && provider.prepareContinuable === void 0) throw new Error(`tool-subagent: provider "${provider.name}" does not support \`backgroundMode: continuable\``);
		disposeTool = ctx.tools.register(defineTool({
			name: toolName,
			description: wording.description + (backgroundEnabled ? continuable ? " This tool runs in the background by default, immediately returns a durable subagent id, and keeps the child conversation available for later turns. When that run settles, the runtime sends the parent a notice containing its outcome and any final assistant message; `send_message` starts a later turn in the same child conversation. Set `run_in_background: false` only when your next action depends on receiving the result." : " This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`." : " This call waits for the subagent and returns its result."),
			parameters: {
				description: {
					type: "string",
					required: true,
					description: "A short (3-5 word) description of the delegated task, for display."
				},
				prompt: {
					type: "string",
					required: true,
					description: wording.promptDescription
				},
				...backgroundEnabled ? { run_in_background: {
					type: "boolean",
					description: continuable ? "Whether to run in the background and return a durable subagent id immediately. Defaults to true. Set false to wait for the result when your next action depends on it." : "Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill."
				} } : {}
			},
			output: {
				schema: { oneOf: [
					{
						type: "object",
						additionalProperties: false,
						properties: {
							kind: {
								type: "string",
								required: true,
								const: "background"
							},
							jobId: {
								type: "string",
								required: true
							}
						}
					},
					{
						type: "object",
						additionalProperties: false,
						properties: {
							kind: {
								type: "string",
								required: true,
								const: "continuable"
							},
							subagentId: {
								type: "string",
								required: true
							}
						}
					},
					{
						type: "object",
						additionalProperties: false,
						properties: {
							kind: {
								type: "string",
								required: true,
								const: "foreground"
							},
							runId: {
								type: "string",
								required: true
							},
							output: {
								type: "array",
								required: true,
								items: { type: "json" }
							}
						}
					}
				] },
				render: (_args, value) => [{
					type: "text",
					text: value.kind === "background" ? `started background subagent task ${value.jobId}` : value.kind === "continuable" ? `started subagent ${value.subagentId}` : outputValueText(value.output)
				}]
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const parent = exec.agent;
				if (!parent) throw new Error("subagent tool requires a calling agent (exec.agent was undefined)");
				const maxDepth = typeof config.maxDepth === "number" ? config.maxDepth : void 0;
				const request = {
					label: args.description,
					prompt: [{
						type: "text",
						text: args.prompt
					}],
					parent,
					...config.agentOptions !== void 0 ? { agentOptions: config.agentOptions } : {},
					...config.persona !== void 0 ? { persona: config.persona } : {},
					...config.toolFilter !== void 0 ? { toolFilter: config.toolFilter } : {},
					...maxDepth !== void 0 ? { maxDepth } : {}
				};
				if (resolveDelegationRun(args, {
					backgroundEnabled,
					continuable
				}).runInBackground) {
					if (continuable) return {
						kind: "continuable",
						subagentId: (await ctx.subagents.startContinuable({
							provider: config.provider,
							label: args.description,
							request,
							signal: exec.signal
						})).childId
					};
					const jobs = ctx.get("jobs");
					if (jobs === void 0) throw new Error("background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs");
					return {
						kind: "background",
						jobId: jobs.start({
							kind: "subagent",
							label: args.description,
							owner: parent,
							run: () => {
								const controller = new AbortController();
								return {
									cancel: (reason) => {
										controller.abort(reason ?? "background subagent task killed");
									},
									done: settleStart(ctx.subagents.start(config.provider, {
										...request,
										signal: controller.signal
									}), controller.signal)
								};
							}
						})
					};
				}
				return settleForegroundRun(await ctx.subagents.start(config.provider, {
					...request,
					signal: exec.signal
				}));
			}
		}));
	};
	ctx.on("subagent/provider-added", (provider) => {
		if (provider.name === config.provider && disposeTool === void 0) mount(provider);
	});
	ctx.on("subagent/provider-removed", (name) => {
		if (name !== config.provider || disposeTool === void 0) return;
		disposeTool();
		disposeTool = void 0;
	});
	const present = ctx.subagents.getProvider(config.provider);
	if (present !== void 0) mount(present);
	else ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${config.toolName ?? "subagent"}" tool will register when it appears`);
	if (backgroundEnabled && continuable) ctx.systemPrompt.section({
		name: `tool:${toolName}`,
		order: SUBAGENT_SECTION_ORDER,
		text: (context) => disposeTool === void 0 || ctx.tools.get(toolName, context.scope) === void 0 ? "" : `Use ${toolName} in the background by default. Start independent delegations together in one assistant message and continue useful work while they run. Set \`run_in_background: false\` only when your next action depends on that subagent's result. When a background run settles, the runtime sends you a notice containing its outcome and any final assistant message.`
	});
}
//#endregion
export { Config, apply, inject, name };
