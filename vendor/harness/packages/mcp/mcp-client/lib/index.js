// vendor/harness/packages/mcp/mcp-client/src/index.ts
import z2 from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS as MAX_TIMER_DELAY_MS2 } from "@deepseek-ai/dsh-timeout";

// vendor/harness/packages/mcp/mcp-client/src/connection.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";

// vendor/harness/packages/mcp/mcp-client/src/transport.ts
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
function buildChildEnv(extra) {
  return { ...scrubbedParentEnv(), ...extra };
}
function createTransport(config) {
  switch (config.transport) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd
      });
    case "streamable-http":
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } }
      );
  }
}

// vendor/harness/packages/mcp/mcp-client/src/tools.ts
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isImageAdmissionError } from "@deepseek-ai/dsh-attachment";
import { assertSupportedJsonSchema } from "@deepseek-ai/dsh-tools";
var MAX_PUBLIC_NAME_LENGTH = 64;
var INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;
var HASH_LENGTH = 12;
var RawCallToolResultSchema = z.record(z.string(), z.unknown());
var IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
];
var CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
function listToolsUncached(client, cursor) {
  return client.request(
    { method: "tools/list", ...cursor === void 0 ? {} : { params: { cursor } } },
    ListToolsResultSchema
  );
}
function callToolUncached(client, rawName, args, exec, opts) {
  return client.request(
    { method: "tools/call", params: { name: rawName, arguments: args } },
    RawCallToolResultSchema,
    {
      signal: exec.signal,
      timeout: opts.toolCallTimeoutMs
    }
  );
}
function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(INVALID_NAME_CHARS, "_");
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized;
  const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, HASH_LENGTH);
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`;
}
async function syncTools(client, ctx, opts, previous) {
  const definitions = /* @__PURE__ */ new Map();
  let cursor;
  do {
    const response = await listToolsUncached(client, cursor);
    for (const tool of response.tools) {
      const publicName = publicToolName(opts.serverName, tool.name);
      if (definitions.has(publicName)) {
        throw new Error(
          `mcp-client(${opts.serverName}): server listed tool "${tool.name}" more than once \u2014 invalid tool list`
        );
      }
      definitions.set(publicName, createDefinition(
        client,
        ctx,
        publicName,
        tool.name,
        tool.description ?? "",
        tool.inputSchema,
        supportedOutputSchema(tool.outputSchema),
        tool.execution?.taskSupport === "required",
        opts
      ));
    }
    cursor = response.nextCursor;
  } while (cursor);
  for (const dispose of previous.values()) dispose();
  const disposers = /* @__PURE__ */ new Map();
  try {
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, ctx.tools.register(definition));
    }
  } catch (error) {
    for (const dispose of disposers.values()) dispose();
    ctx.logger.error(`mcp-client(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`);
    if (opts.registrationFailure === "throw") throw error;
    return /* @__PURE__ */ new Map();
  }
  return disposers;
}
function supportedOutputSchema(candidate) {
  if (candidate === void 0) return void 0;
  try {
    assertSupportedJsonSchema(candidate);
    return candidate;
  } catch {
    return void 0;
  }
}
function createDefinition(client, ctx, publicName, rawName, description, parameters, structuredSchema, taskRequired, opts) {
  const projections = /* @__PURE__ */ new WeakMap();
  return {
    name: publicName,
    description,
    parameters,
    output: createOutput(rawName, structuredSchema),
    execute: createExecutor(client, ctx, rawName, taskRequired, opts, projections),
    finalizeContent(exec, result) {
      const projection = projections.get(exec);
      if (projection === void 0) return void 0;
      projections.delete(exec);
      if (result.isError) return void 0;
      if (!isDeepStrictEqual(result.value, projection.value)) return void 0;
      if (!isDeepStrictEqual(result.content, projection.fallback)) return void 0;
      return projection.content;
    }
  };
}
function createOutput(rawName, structuredSchema) {
  return {
    schema: {
      type: "object",
      properties: {
        content: { type: "array", items: {} },
        structuredContent: structuredSchema ?? {}
      },
      required: structuredSchema === void 0 ? ["content"] : ["content", "structuredContent"],
      additionalProperties: false
    },
    render(_args, value) {
      const result = value;
      return [{ type: "text", text: extractText(result.content, rawName) }];
    }
  };
}
function createExecutor(client, ctx, rawName, taskRequired, opts, projections) {
  return async (args, exec) => {
    if (taskRequired) {
      throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`);
    }
    const argsObj = typeof args === "object" && args !== null ? args : {};
    const result = await callToolUncached(client, rawName, argsObj, exec, opts);
    if (!Array.isArray(result.content)) {
      const rendered = "toolResult" in result ? JSON.stringify(result.toolResult) : "(no output)";
      const text2 = typeof rendered === "string" ? rendered : "(no output)";
      if (result.isError === true) throw new Error(text2);
      return {
        content: [{ type: "text", text: text2 }],
        ...result.structuredContent !== void 0 ? { structuredContent: result.structuredContent } : {}
      };
    }
    const content = result.content;
    const text = extractText(content, rawName);
    if (result.isError === true) {
      throw new Error(text);
    }
    const value = {
      content,
      ...result.structuredContent !== void 0 ? { structuredContent: result.structuredContent } : {}
    };
    if (containsImage(content)) {
      const fallback = [{ type: "text", text: extractText(content, rawName) }];
      const projected = await prepareImageProjection(ctx, exec, content, rawName);
      projections.set(exec, { value, fallback, content: projected });
    }
    return value;
  };
}
function containsImage(content) {
  return content.some((value) => isRecord(value) && value.type === "image");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isImageMediaType(value) {
  return IMAGE_MEDIA_TYPES.includes(value);
}
function decodeImage(block) {
  if (block.mimeType === void 0 || !isImageMediaType(block.mimeType)) {
    throw new Error("the declared media type is not PNG, JPEG, WebP, or GIF");
  }
  if (block.data === void 0 || !CANONICAL_BASE64.test(block.data)) {
    throw new Error("the image data is not canonical base64");
  }
  const data = Buffer.from(block.data, "base64");
  if (data.toString("base64") !== block.data) {
    throw new Error("the image data is not canonical base64");
  }
  return { data, mediaType: block.mimeType };
}
async function resolveImageAdmission(ctx, exec) {
  const attachments = ctx.get("attachments");
  if (attachments === void 0) throw new Error("no attachment store is mounted");
  const routed = exec.agent?.session.requestHeader()?.config;
  const provider = routed?.provider ?? exec.agent?.options.provider;
  const model = routed?.model ?? exec.agent?.options.model;
  const llm = ctx.get("llm");
  if (provider === void 0 || model === void 0 || llm === void 0) {
    throw new Error("the current model route could not be resolved");
  }
  let info;
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal);
  } catch {
    throw new Error("the current model route could not be verified");
  }
  if (info.inputModalities === void 0 || !info.inputModalities.includes("image")) {
    throw new Error(`model "${model}" does not declare image input`);
  }
  if (exec.signal.aborted) throw new Error("the tool call was canceled before image storage");
  return attachments;
}
function imageDiagnostic(block, reason) {
  const mediaType = block.mimeType ?? "unknown media type";
  return `[image unavailable: ${mediaType}; ${reason}; raw image data remains available to programmatic callers]`;
}
async function prepareImageProjection(ctx, exec, content, toolName) {
  const decoded = [];
  const validationErrors = /* @__PURE__ */ new Map();
  const imageIndexes = [];
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== "image") continue;
    imageIndexes.push(index);
    try {
      decoded.push(decodeImage(value));
    } catch (error) {
      validationErrors.set(index, error.message);
    }
  }
  if (validationErrors.size > 0) {
    return projectContent(content, toolName, (block, index) => ({
      type: "text",
      text: imageDiagnostic(
        block,
        validationErrors.get(index) ?? "another image in the same result was invalid"
      )
    }));
  }
  let attachments;
  try {
    attachments = await resolveImageAdmission(ctx, exec);
  } catch (error) {
    const reason = error.message;
    return projectContent(content, toolName, (block) => ({ type: "text", text: imageDiagnostic(block, reason) }));
  }
  try {
    const refs = await attachments.saveImages(decoded);
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset]]));
    return projectContent(content, toolName, (_block, index) => ({
      type: "image",
      attachment: byIndex.get(index)
    }));
  } catch (error) {
    const reason = isImageAdmissionError(error) ? `image admission rejected the result: ${error.message}` : "durable image storage rejected the result";
    return projectContent(content, toolName, (block) => ({
      type: "text",
      text: imageDiagnostic(block, reason)
    }));
  }
}
function extractText(mcpContent, toolName) {
  const content = projectContent(mcpContent, toolName);
  return content.map((block) => block.text).join("\n");
}
function projectContent(mcpContent, toolName, image = (block) => ({
  type: "text",
  text: imageDiagnostic(block, "this result was not admitted to durable model context")
})) {
  const projected = [];
  const text = [];
  const flushText = () => {
    if (text.length === 0) return;
    projected.push({ type: "text", text: text.splice(0).join("\n") });
  };
  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push("[unsupported MCP content block: expected an object]");
      continue;
    }
    const block = value;
    switch (block.type) {
      case "text":
        if (block.text !== void 0) text.push(block.text);
        break;
      case "image":
        flushText();
        projected.push(image(block, index));
        break;
      case "resource_link":
        if (block.name === void 0 || block.uri === void 0) {
          text.push("[resource link unavailable: the MCP block is missing its name or URI]");
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`);
        }
        break;
      case "audio":
        text.push(`[audio result unsupported: ${block.mimeType ?? "unknown media type"}; raw audio data remains available to programmatic callers]`);
        break;
      case "resource":
        text.push("[embedded resource unsupported; raw resource data remains available to programmatic callers]");
        break;
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`);
    }
  }
  flushText();
  return projected.length > 0 ? projected : [{ type: "text", text: `(${toolName} returned no model-visible content)` }];
}

// vendor/harness/packages/mcp/mcp-client/src/connection.ts
var RECONNECT_DEFAULTS = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 3e4,
  maxAttempts: 10
});
var GENERATION_CLOSE_TIMEOUT_MS = 5e3;
function resolveReconnectPolicy(config, path) {
  if (config !== void 0) {
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) throw new Error(`${path}.${key} is not a reconnect option`);
    }
  }
  const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled;
  const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs;
  const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs;
  const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts;
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`${path}.maxAttempts must be a positive integer`);
  }
  return Object.freeze({ enabled, initialDelayMs, maxDelayMs, maxAttempts });
}
function startConnection(ctx, config, policy) {
  const label = `mcp-client(${config.serverName})`;
  const opts = {
    registrationFailure: "contain",
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs
  };
  const startupOpts = config.failOnStartupError ? { ...opts, registrationFailure: "throw" } : opts;
  let disposed = false;
  let client;
  let clientClosed;
  let disposers = /* @__PURE__ */ new Map();
  let reconnectTimer;
  let failedAttempts = 0;
  let connectedAt;
  let firstAttemptError;
  const isCurrent = (generation) => !disposed && client === generation;
  let syncChain = Promise.resolve();
  function enqueueSync(generation, syncOpts = opts) {
    const run = syncChain.then(async () => {
      if (!isCurrent(generation)) return;
      disposers = await syncTools(generation, ctx, syncOpts, disposers);
    });
    syncChain = run.catch(() => {
    });
    return run;
  }
  function generationDown(generation) {
    if (!isCurrent(generation)) return;
    client = void 0;
    clientClosed = void 0;
    scheduleReconnect();
  }
  function waitForClose(closed) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, GENERATION_CLOSE_TIMEOUT_MS);
      timeout.unref();
      void closed.then(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }
  function scheduleReconnect() {
    const lostEstablishedConnection = connectedAt !== void 0;
    if (!policy.enabled) {
      const message = lostEstablishedConnection ? "connection lost and reconnect is disabled \u2014 registered tools will fail until an HMR reload or Host restart" : "connection failed and reconnect is disabled \u2014 no tools were registered; reload the plugin or restart the Host to connect";
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
      ctx.logger.error(`${label}: giving up after ${policy.maxAttempts} consecutive failed reconnect attempts \u2014 tools unregistered; reload the plugin or restart the Host to reconnect`);
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
  async function connectGeneration(startup) {
    const generation = new Client(
      { name: "dsh-mcp-client", version: "0.0.1" },
      { capabilities: {} }
    );
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
    generation.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        if (!isCurrent(generation)) return;
        ctx.logger.info(`${label}: tool list changed, re-syncing`);
        try {
          await enqueueSync(generation);
        } catch (error) {
          if (!disposed) ctx.logger.error(`${label}: tool re-sync failed: ${String(error)}`);
        }
      }
    );
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
      } catch {
      }
      const quiesced = hasClosed() || await waitForClose(closed.promise);
      attemptSettled = true;
      if (!isCurrent(generation)) return;
      if (!quiesced) {
        client = void 0;
        clientClosed = void 0;
        ctx.logger.error(`${label}: failed generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms \u2014 reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`);
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
  let settling = connectGeneration(true);
  const ready = settling.then(() => {
    if (client !== void 0) return {};
    return { error: firstAttemptError ?? new Error(`${label}: initial connection failed`) };
  });
  return {
    ready,
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
        } catch {
        }
        if (currentClosed !== void 0 && !await waitForClose(currentClosed)) {
          ctx.logger.error(`${label}: generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms during disposal \u2014 server shutdown may be incomplete`);
        }
      }
      await settling;
      await syncChain;
      for (const dispose of disposers.values()) dispose();
      disposers = /* @__PURE__ */ new Map();
    }
  };
}

// vendor/harness/packages/mcp/mcp-client/src/index.ts
var name = "mcp-client";
var inject = ["tools"];
var DEFAULT_TOOL_CALL_TIMEOUT_MS = 6e4;
var SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
var activeServerNames = /* @__PURE__ */ new WeakMap();
var Reconnect = z2.object({
  enabled: z2.boolean().default(RECONNECT_DEFAULTS.enabled),
  initialDelayMs: z2.number().min(1).max(MAX_TIMER_DELAY_MS2).default(RECONNECT_DEFAULTS.initialDelayMs),
  maxDelayMs: z2.number().min(1).max(MAX_TIMER_DELAY_MS2).default(RECONNECT_DEFAULTS.maxDelayMs),
  maxAttempts: z2.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(RECONNECT_DEFAULTS.maxAttempts)
});
var Config = z2.union([
  z2.object({
    transport: z2.const("stdio"),
    serverName: z2.string().required().pattern(SERVER_NAME_PATTERN),
    command: z2.string().required(),
    args: z2.array(String).default([]),
    env: z2.dict(String).default({}),
    cwd: z2.string().default(""),
    toolCallTimeoutMs: z2.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z2.boolean().default(false),
    reconnect: Reconnect
  }),
  z2.object({
    transport: z2.const("streamable-http"),
    serverName: z2.string().required().pattern(SERVER_NAME_PATTERN),
    url: z2.string().required(),
    headers: z2.dict(String).default({}),
    toolCallTimeoutMs: z2.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z2.boolean().default(false),
    reconnect: Reconnect
  })
]);
async function apply(ctx, config) {
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`);
  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root);
    if (!names) {
      names = /* @__PURE__ */ new Set();
      activeServerNames.set(ctx.root, names);
    }
    if (names.has(config.serverName)) {
      throw new Error(
        `mcp-client: serverName "${config.serverName}" is already in use by another mcp-client instance \u2014 pick a unique serverName in cordis.yml`
      );
    }
    names.add(config.serverName);
    return () => void names.delete(config.serverName);
  }, "mcp-client.serverName");
  const connection = startConnection(ctx, config, reconnect);
  ctx.effect(() => {
    return () => connection.dispose();
  }, "mcp-client.connection");
  const outcome = await connection.ready;
  if (outcome.error !== void 0 && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error });
  }
}
export {
  Config,
  apply,
  inject,
  name
};
