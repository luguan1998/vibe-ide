import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ListToolsResultSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
import { createHash } from "node:crypto";
import { z as z$1 } from "zod";
import { assertSupportedJsonSchema } from "@deepseek-ai/dsh-tools";
//#region lib/types/transport.js
/**
* Transport factory: creates the appropriate MCP transport based on the
* plugin's resolved config. Stdio spawns a child process (with credential
* scrubbing); Streamable HTTP connects to a URL.
*
* @module
*/
/**
* The subprocess seam's scrubbed parent env (credential-shaped and stale
* `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
* actual spawn, so this transport shares the scrub definition rather than the
* spawn path.
*/
function buildChildEnv(extra) {
	return {
		...scrubbedParentEnv(),
		...extra
	};
}
/**
* Create an MCP transport from the resolved plugin config.
*
* @param config - Resolved plugin config discriminated on `transport`.
* @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
*/
function createTransport(config) {
	switch (config.transport) {
		case "stdio": return new StdioClientTransport({
			command: config.command,
			args: config.args,
			env: buildChildEnv(config.env),
			cwd: config.cwd
		});
		case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
	}
}
//#endregion
//#region lib/types/tools.js
/**
* Tool bridge: discovers MCP tools, registers them on the harness ToolRuntime
* under deterministic server-qualified public names, and handles re-sync when
* the server's tool list changes.
*
* Naming contract (see the mcp-client Agent Note "Naming invariants"): every MCP tool
* has the stable identity `(serverName, rawName)`; the model-facing public name
* is `mcp__<serverName>__<rawName>`, normalized to the DeepSeek function-name
* constraints. The raw name is only ever sent on the wire (`tools/call`); the
* public name is never parsed to recover it.
*
* @module
*/
/**
* DeepSeek function-name contract: at most 64 characters. Wire-protocol
* constant, not configuration.
*/
const MAX_PUBLIC_NAME_LENGTH = 64;
/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;
/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12;
/** Raw result record: the bridge owns JSON-value validation after transport. */
const RawCallToolResultSchema = z$1.record(z$1.string(), z$1.unknown());
/** List without mutating the SDK's per-page output-validator cache. */
function listToolsUncached(client, cursor) {
	return client.request({
		method: "tools/list",
		...cursor === void 0 ? {} : { params: { cursor } }
	}, ListToolsResultSchema);
}
/** Call without the SDK pre-validating an output schema the bridge may not support. */
function callToolUncached(client, rawName, args, exec, opts) {
	return client.request({
		method: "tools/call",
		params: {
			name: rawName,
			arguments: args
		}
	}, RawCallToolResultSchema, {
		signal: exec.signal,
		timeout: opts.toolCallTimeoutMs
	});
}
/**
* Derive the model-facing public name for one MCP tool.
*
* Deterministic pure function of `(serverName, rawName)`: the clean case is
* `mcp__<serverName>__<rawName>` verbatim. When character replacement or
* truncation to the DeepSeek function-name contract (64 chars,
* `[A-Za-z0-9_-]`) changes the name, a 12-hex-char SHA-256 hash of the
* identity is appended so distinct MCP identities never collapse into the
* same public name.
*
* @param serverName - Stable local namespace from plugin config.
* @param rawName - The MCP server's own tool name.
* @returns The globally unique, model-facing ToolRuntime name.
*/
function publicToolName(serverName, rawName) {
	const joined = `mcp__${serverName}__${rawName}`;
	const normalized = joined.replace(INVALID_NAME_CHARS, "_");
	if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized;
	const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, HASH_LENGTH);
	return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`;
}
/**
* Sync the MCP server's tool list into the harness ToolRuntime.
*
* Two phases keep the swap safe:
*
* 1. Fetch: drain uncached `tools/list` pagination and build the full next
*    generation of `ToolDefinition`s under public names. Any failure here
*    (network error, duplicate raw name in the server's list) rejects and
*    leaves the previous generation registered untouched.
* 2. Swap: dispose the previous generation, register the new one. A registry
*    conflict here can only mean a foreign registration squats on this
*    server's `mcp__<serverName>__` namespace — the partial generation is
*    rolled back (zero tools from this server) and logged. Initial strict
*    synchronization may propagate the conflict so its parent transaction
*    rejects; ordinary clients and later re-syncs return an empty map.
*
* @param client - Connected MCP Client instance used to list and call tools.
* @param ctx - Cordis context providing the `tools` service for registration.
* @param opts - Bridge options: server namespace and per-call timeout.
* @param previous - Disposer map from the prior sync generation; disposed
*   during the swap phase (only after the fetch phase succeeded).
* @returns A map of registered public tool names to their unregister
*   disposers — the exact set of live registrations owned by this server.
*/
async function syncTools(client, ctx, opts, previous) {
	const definitions = /* @__PURE__ */ new Map();
	let cursor;
	do {
		const response = await listToolsUncached(client, cursor);
		for (const tool of response.tools) {
			const publicName = publicToolName(opts.serverName, tool.name);
			if (definitions.has(publicName)) throw new Error(`mcp-client(${opts.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`);
			definitions.set(publicName, {
				name: publicName,
				description: tool.description ?? "",
				parameters: tool.inputSchema,
				output: createOutput(tool.name, supportedOutputSchema(tool.outputSchema)),
				execute: createExecutor(client, tool.name, tool.execution?.taskSupport === "required", opts)
			});
		}
		cursor = response.nextCursor;
	} while (cursor);
	for (const dispose of previous.values()) dispose();
	const disposers = /* @__PURE__ */ new Map();
	try {
		for (const [publicName, definition] of definitions) disposers.set(publicName, ctx.tools.register(definition));
	} catch (error) {
		for (const dispose of disposers.values()) dispose();
		ctx.logger.error(`mcp-client(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`);
		if (opts.registrationFailure === "throw") throw error;
		return /* @__PURE__ */ new Map();
	}
	return disposers;
}
/** Keep a supported advertised schema; unsupported MCP vocabulary falls back to JsonValue. */
function supportedOutputSchema(candidate) {
	if (candidate === void 0) return void 0;
	try {
		assertSupportedJsonSchema(candidate);
		return candidate;
	} catch {
		return;
	}
}
/** Build the canonical result schema and existing Native text projection. */
function createOutput(rawName, structuredSchema) {
	return {
		schema: {
			type: "object",
			properties: {
				content: {
					type: "array",
					items: {}
				},
				structuredContent: structuredSchema ?? {}
			},
			required: structuredSchema === void 0 ? ["content"] : ["content", "structuredContent"],
			additionalProperties: false
		},
		render(_args, value) {
			return [{
				type: "text",
				text: extractText(value.content, rawName)
			}];
		}
	};
}
/**
* Create an execute function for one MCP tool. The executor closes over the
* raw MCP tool name and sends an uncached `tools/call` request with it (never
* the public name), with abort signal and timeout, then maps the result to
* harness ContentBlocks. Owning the raw request prevents the SDK's internal
* per-page schema cache from pre-validating a different contract.
*
* When the MCP server returns `isError: true`, the executor throws so that
* the ToolRuntime's catch path produces an `isError` result for the model.
*/
function createExecutor(client, rawName, taskRequired, opts) {
	return async (args, exec) => {
		if (taskRequired) throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`);
		const result = await callToolUncached(client, rawName, typeof args === "object" && args !== null ? args : {}, exec, opts);
		if (!Array.isArray(result.content)) {
			const rendered = "toolResult" in result ? JSON.stringify(result.toolResult) : "(no output)";
			const text = typeof rendered === "string" ? rendered : "(no output)";
			if (result.isError === true) throw new Error(text);
			return {
				content: [{
					type: "text",
					text
				}],
				...result.structuredContent !== void 0 ? { structuredContent: result.structuredContent } : {}
			};
		}
		const content = result.content;
		const text = extractText(content, rawName);
		if (result.isError === true) throw new Error(text);
		return {
			content,
			...result.structuredContent !== void 0 ? { structuredContent: result.structuredContent } : {}
		};
	};
}
/**
* Extract text from an MCP content array into a single string.
* - text blocks: join with '\n'
* - image/audio/resource blocks: replaced with a placeholder
*
* Defensive: fields that the MCP spec declares required (mimeType, text) are
* guarded with fallbacks because this is a network trust boundary.
*/
function extractText(mcpContent, toolName) {
	const parts = [];
	for (const value of mcpContent) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			parts.push("[unsupported content type: unknown]");
			continue;
		}
		const block = value;
		switch (block.type) {
			case "text":
				if (block.text !== void 0) parts.push(block.text);
				break;
			case "image":
				parts.push(`[image: ${block.mimeType ?? "unknown"}, content discarded]`);
				break;
			case "audio":
				parts.push(`[audio: ${block.mimeType ?? "unknown"}, content discarded]`);
				break;
			case "resource":
			case "resource_link":
				parts.push("[resource: content discarded]");
				break;
			default: parts.push(`[unsupported content type: ${block.type}]`);
		}
	}
	return parts.join("\n") || `(${toolName} returned no text content)`;
}
//#endregion
//#region lib/types/connection.js
/**
* Connection supervisor: owns the MCP client/transport generations for one
* plugin instance, keeps the harness tool registry in sync with the live
* generation, and — when the connection drops — restarts the configured
* server with bounded exponential backoff.
*
* One outage shares one attempt budget (`maxAttempts` consecutive failed
* attempts, delays doubling from `initialDelayMs` up to `maxDelayMs`). A
* connection that stays up past the stability window closes the outage, so
* the next disconnect starts a fresh budget while a crash-looping server —
* even one whose connects briefly succeed — still exhausts the cap instead of
* restarting forever. Exhaustion unregisters the server's tools and stops;
* disposal (including HMR) is the only way back from that state.
*
* @module
*/
/** Defaults shared by the Config schema and {@link resolveReconnectPolicy}. */
const RECONNECT_DEFAULTS = Object.freeze({
	enabled: true,
	initialDelayMs: 500,
	maxDelayMs: 3e4,
	maxAttempts: 10
});
const GENERATION_CLOSE_TIMEOUT_MS = 5e3;
/**
* The one explicit resolve step from raw reconnect config to the policy the
* supervisor runs. Programmatic construction may bypass Schemastery
* normalization, so every default and bound is re-judged here — misconfiguration
* fails the plugin instance at load.
*
* @param config - Raw `reconnect` config; omission uses the defaults.
* @param path - Diagnostic prefix naming the config location in thrown messages.
* @returns The frozen resolved policy.
*/
function resolveReconnectPolicy(config, path) {
	if (config !== void 0) {
		for (const key of Object.keys(config)) if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) throw new Error(`${path}.${key} is not a reconnect option`);
	}
	const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled;
	const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs;
	const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs;
	const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts;
	if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(`${path}.maxAttempts must be a positive integer`);
	return Object.freeze({
		enabled,
		initialDelayMs,
		maxDelayMs,
		maxAttempts
	});
}
/**
* Start the supervised connection for one MCP server and keep it alive per
* the reconnect policy.
*
* @param ctx - Cordis context providing the `tools` registry and logger.
* @param config - Resolved plugin config selecting the transport and server identity.
* @param policy - Resolved reconnect policy from {@link resolveReconnectPolicy}.
* @returns Handle with a `ready` promise for startup-await and a `dispose` for teardown.
*/
function startConnection(ctx, config, policy) {
	const label = `mcp-client(${config.serverName})`;
	const opts = {
		registrationFailure: "contain",
		serverName: config.serverName,
		toolCallTimeoutMs: config.toolCallTimeoutMs
	};
	const startupOpts = config.failOnStartupError ? {
		...opts,
		registrationFailure: "throw"
	} : opts;
	let disposed = false;
	/** Current generation: the connecting or connected client; undefined during backoff waits and after final failure. */
	let client;
	/** Close signal paired with {@link client}; captured by dispose before current ownership is cleared. */
	let clientClosed;
	/** Live tool registrations owned by this server; only {@link enqueueSync} and dispose swap it. */
	let disposers = /* @__PURE__ */ new Map();
	let reconnectTimer;
	/** Consecutive failed connection attempts within the current outage. */
	let failedAttempts = 0;
	/** When the current generation finished connect + initial sync; undefined while down. */
	let connectedAt;
	/** The real error from the first connection attempt, for startup-await diagnostics. */
	let firstAttemptError;
	/** A generation may act only while it is the current one on a live plugin. */
	const isCurrent = (generation) => !disposed && client === generation;
	/**
	* Serializes every syncTools call — initial syncs and notification re-syncs
	* across all generations — so two syncs can never interleave their
	* dispose-previous/register-next swap (which would double-dispose one
	* generation and leak another).
	*/
	let syncChain = Promise.resolve();
	function enqueueSync(generation, syncOpts = opts) {
		const run = syncChain.then(async () => {
			if (!isCurrent(generation)) return;
			disposers = await syncTools(generation, ctx, syncOpts, disposers);
		});
		syncChain = run.catch(() => {});
		return run;
	}
	/** One disconnect decision per generation: the isCurrent guard makes racing close/error signals idempotent. */
	function generationDown(generation) {
		if (!isCurrent(generation)) return;
		client = void 0;
		clientClosed = void 0;
		scheduleReconnect();
	}
	/** Wait for the transport-owned close signal without letting a broken transport wedge teardown forever. */
	function waitForClose(closed) {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				resolve(false);
			}, GENERATION_CLOSE_TIMEOUT_MS);
			timeout.unref();
			closed.then(() => {
				clearTimeout(timeout);
				resolve(true);
			});
		});
	}
	function scheduleReconnect() {
		const lostEstablishedConnection = connectedAt !== void 0;
		if (!policy.enabled) {
			const message = lostEstablishedConnection ? "connection lost and reconnect is disabled — registered tools will fail until an HMR reload or Host restart" : "connection failed and reconnect is disabled — no tools were registered; reload the plugin or restart the Host to connect";
			ctx.logger.error(`${label}: ${message}`);
			return;
		}
		if (connectedAt !== void 0 && Date.now() - connectedAt >= policy.maxDelayMs) failedAttempts = 0;
		connectedAt = void 0;
		failedAttempts += 1;
		if (failedAttempts > policy.maxAttempts) {
			syncChain = syncChain.then(() => {
				for (const dispose of disposers.values()) dispose();
				disposers = /* @__PURE__ */ new Map();
			});
			ctx.logger.error(`${label}: giving up after ${policy.maxAttempts} consecutive failed reconnect attempts — tools unregistered; reload the plugin or restart the Host to reconnect`);
			return;
		}
		const delayMs = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (failedAttempts - 1));
		const action = lostEstablishedConnection ? "connection lost; reconnecting" : "connection failed; retrying";
		ctx.logger.warn(`${label}: ${action} in ${delayMs}ms (attempt ${failedAttempts}/${policy.maxAttempts})`);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = void 0;
			settling = connectGeneration(false);
		}, delayMs);
		reconnectTimer.unref();
	}
	/**
	* One connection attempt: fresh transport + client (the MCP SDK binds a
	* Protocol to one transport for life), connect, then queue the initial tool
	* sync. The startup flag belongs to the attempt rather than the shared sync
	* queue, so an early notification cannot consume strict startup semantics.
	* Every failure funnels through {@link generationDown}; success arms the
	* onclose-driven disconnect path. Never rejects.
	*
	* @param startup - Whether this is the plugin's activation attempt.
	*/
	async function connectGeneration(startup) {
		const generation = new Client({
			name: "dsh-mcp-client",
			version: "0.0.1"
		}, { capabilities: {} });
		const closed = Promise.withResolvers();
		let attemptSettled = false;
		let closeObserved = false;
		const hasClosed = () => closeObserved;
		client = generation;
		clientClosed = closed.promise;
		generation.onclose = () => {
			closeObserved = true;
			closed.resolve();
			if (attemptSettled) generationDown(generation);
		};
		generation.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
			if (!isCurrent(generation)) return;
			ctx.logger.info(`${label}: tool list changed, re-syncing`);
			try {
				await enqueueSync(generation);
			} catch (error) {
				if (!disposed) ctx.logger.error(`${label}: tool re-sync failed: ${String(error)}`);
			}
		});
		try {
			await generation.connect(createTransport(config));
			if (hasClosed()) {
				attemptSettled = true;
				generationDown(generation);
				return;
			}
			await enqueueSync(generation, startup ? startupOpts : opts);
		} catch (error) {
			if (firstAttemptError === void 0) firstAttemptError = error;
			if (isCurrent(generation)) ctx.logger.warn(`${label}: connection attempt failed: ${String(error)}`);
			try {
				await generation.close();
			} catch {}
			const quiesced = hasClosed() || await waitForClose(closed.promise);
			attemptSettled = true;
			if (!isCurrent(generation)) return;
			if (!quiesced) {
				client = void 0;
				clientClosed = void 0;
				ctx.logger.error(`${label}: failed generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`);
				return;
			}
			generationDown(generation);
			return;
		}
		attemptSettled = true;
		if (hasClosed()) {
			generationDown(generation);
			return;
		}
		if (!isCurrent(generation)) return;
		connectedAt = Date.now();
		if (failedAttempts > 0) ctx.logger.info(`${label}: reconnected and re-synced tools (attempt ${failedAttempts}/${policy.maxAttempts})`);
	}
	/** The in-flight (or last settled) connection attempt; dispose awaits it for quiescence. */
	let settling = connectGeneration(true);
	return {
		ready: settling.then(() => {
			if (client !== void 0) return {};
			/* v8 ignore next -- defensive: firstAttemptError is always set when connect/sync fails */
			return { error: firstAttemptError ?? /* @__PURE__ */ new Error(`${label}: initial connection failed`) };
		}),
		async dispose() {
			disposed = true;
			if (reconnectTimer !== void 0) {
				clearTimeout(reconnectTimer);
				reconnectTimer = void 0;
			}
			const current = client;
			const currentClosed = clientClosed;
			client = void 0;
			clientClosed = void 0;
			if (current !== void 0) {
				try {
					await current.close();
				} catch {}
				if (currentClosed !== void 0 && !await waitForClose(currentClosed)) ctx.logger.error(`${label}: generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms during disposal — server shutdown may be incomplete`);
			}
			await settling;
			await syncChain;
			for (const dispose of disposers.values()) dispose();
			disposers = /* @__PURE__ */ new Map();
		}
	};
}
//#endregion
//#region lib/types/index.js
/**
* MCP client bridge plugin: connects to an external MCP server and registers
* its tools on `ctx.tools` under server-qualified public names
* (`mcp__<serverName>__<rawName>`). Each plugin instance connects to one MCP
* server; load multiple instances in `cordis.yml` for multiple servers.
*
* Namespace plugin (named exports, no default export). Lifecycle is
* effect-scoped: disposal disconnects from the server, unregisters all tools,
* and releases the `serverName` namespace reservation. HMR hot-swaps by
* disposing the old instance and creating a new one; identical `serverName`
* reproduces identical public tool names.
*
* @module @deepseek-ai/dsh-mcp-client
*/
/** Cordis plugin name used by loader diagnostics. */
const name = "mcp-client";
/** Services required by this plugin. */
const inject = ["tools"];
/** Default timeout for individual MCP tool calls (ms). */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 6e4;
/** Valid `serverName`, kept below the public tool-name budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/**
* Live `serverName` reservations per app, keyed off `ctx.root` (multiple apps
* in one process — tests — must not see each other's names). A duplicate
* namespace is a configuration error surfaced at plugin load, never silent
* shadowing.
*/
const activeServerNames = /* @__PURE__ */ new WeakMap();
const Reconnect = z.object({
	enabled: z.boolean().default(RECONNECT_DEFAULTS.enabled),
	initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.initialDelayMs),
	maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.maxDelayMs),
	maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(RECONNECT_DEFAULTS.maxAttempts)
});
const Config = z.union([z.object({
	transport: z.const("stdio"),
	serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
	command: z.string().required(),
	args: z.array(String).default([]),
	env: z.dict(String).default({}),
	cwd: z.string().default(""),
	toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
	failOnStartupError: z.boolean().default(false),
	reconnect: Reconnect
}), z.object({
	transport: z.const("streamable-http"),
	serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
	url: z.string().required(),
	headers: z.dict(String).default({}),
	toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
	failOnStartupError: z.boolean().default(false),
	reconnect: Reconnect
})]);
/**
* Connect one MCP server and publish its initial tool generation before activation.
* This entry remains explicitly `async`: Cordis treats a prototype-bearing
* ordinary function as a constructor, whose returned Promise is not startup work.
* @param ctx - plugin context carrying the tool registry.
* @param config - resolved transport and server namespace configuration.
* @returns startup readiness after connection and initial tool discovery settle.
*/
async function apply(ctx, config) {
	const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`);
	ctx.effect(() => {
		let names = activeServerNames.get(ctx.root);
		if (!names) {
			names = /* @__PURE__ */ new Set();
			activeServerNames.set(ctx.root, names);
		}
		if (names.has(config.serverName)) throw new Error(`mcp-client: serverName "${config.serverName}" is already in use by another mcp-client instance — pick a unique serverName in cordis.yml`);
		names.add(config.serverName);
		return () => void names.delete(config.serverName);
	}, "mcp-client.serverName");
	const connection = startConnection(ctx, config, reconnect);
	ctx.effect(() => {
		return () => connection.dispose();
	}, "mcp-client.connection");
	const outcome = await connection.ready;
	if (outcome.error !== void 0 && config.failOnStartupError) throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error });
}
//#endregion
export { Config, apply, inject, name };
