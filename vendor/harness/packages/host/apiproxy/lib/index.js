// vendor/harness/packages/host/apiproxy/src/index.ts
import { Service } from "@deepseek-ai/cordis";
import z17 from "@deepseek-ai/schemastery";

// vendor/harness/packages/host/apiproxy/src/api-proxy.ts
import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { AttachmentError } from "@deepseek-ai/dsh-attachment";
import { contentHasImage, createUserMessage, freezeMessage, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { errorChain } from "@deepseek-ai/dsh-llm";
import { isAppendSurfaceEvent, isJsonValue } from "@deepseek-ai/dsh-session";
import { SessionQueryError } from "@deepseek-ai/dsh-session-query";
import { SubagentError } from "@deepseek-ai/dsh-subagent";
import { isUserInvocable } from "@deepseek-ai/dsh-skill";
import {
  workspaceDomainState,
  workspaceRecord,
  WorkspaceId as brandWorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceUnknownSessionError
} from "@deepseek-ai/dsh-workspace";
import {
  InvalidPresetIdError,
  PresetExistsError,
  PresetMountError,
  PresetNotWritableError,
  resolveSessionPreset,
  UnknownPresetError
} from "@deepseek-ai/dsh-agent-presets";

// vendor/harness/packages/host/apiproxy/src/session-export.ts
import { Zip, ZipDeflate } from "fflate";
var DEFAULT_SESSION_LOG_COMPRESSION_LEVEL = 6;
function sessionLogExportDeps(ctx) {
  return {
    sessionQuery: ctx.get("sessionQuery"),
    sessionPersistence: ctx.get("sessionPersistence"),
    attachments: ctx.get("attachments"),
    sessions: ctx.get("sessions")
  };
}
async function flushLiveSessionLog(deps, id, signal) {
  signal?.throwIfAborted();
  const sessions = deps.sessions;
  if (sessions === void 0) return;
  const session = sessions.get(id);
  if (session === void 0) return;
  await sessions.flush(session);
  signal?.throwIfAborted();
}
var MEDIA_TYPE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};
function mediaEntryPath(ref) {
  return `media/${String(ref.attachmentId)}.${MEDIA_TYPE_EXTENSIONS[ref.mediaType]}`;
}
function collectImageRefs(content, refs) {
  if (!Array.isArray(content)) return;
  const pending = [];
  for (const item of content) pending.push(item);
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const block = value;
    if (block.type === "image" && typeof block.attachment === "object" && block.attachment !== null) {
      const ref = block.attachment;
      refs.set(String(ref.attachmentId), ref);
    }
    if (Array.isArray(block.content)) {
      for (const item of block.content) pending.push(item);
    }
  }
}
function collectEventImageRefs(event, refs) {
  const data = event.data;
  if (typeof data !== "object" || data === null) return;
  const carrier = data;
  collectImageRefs(carrier.content, refs);
  if (carrier.message !== void 0) collectImageRefs(carrier.message.content, refs);
  if (carrier.inserted !== void 0) {
    for (const message of carrier.inserted) collectImageRefs(message.content, refs);
  }
  if (carrier.chunk?.type === "block-end") collectImageRefs([carrier.chunk.block], refs);
}
function imageRefsInArtifact(content) {
  const refs = /* @__PURE__ */ new Map();
  for (const line of content.split("\n")) {
    if (line === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    collectEventImageRefs(event, refs);
  }
  return refs;
}
function safeSessionIdSegment(id) {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}
function sessionLogZipFilename(sessionId) {
  return `dsh-session-${safeSessionIdSegment(sessionId)}.zip`;
}
async function* sessionLogZipEntries(deps, root, sessionId, includeDescendants, signal) {
  const media = /* @__PURE__ */ new Map();
  const rememberMedia = (content) => {
    for (const [id, ref] of imageRefsInArtifact(content)) media.set(id, ref);
  };
  rememberMedia(root.content);
  yield { path: root.filename, content: root.content };
  if (includeDescendants) {
    const seen = /* @__PURE__ */ new Set([sessionId]);
    const collect = async function* (nodes) {
      for (const node of nodes) {
        signal?.throwIfAborted();
        const id = node.session.header.id;
        if (seen.has(id)) continue;
        seen.add(id);
        await flushLiveSessionLog(deps, id, signal);
        const raw = await deps.sessionPersistence.readRaw(id, signal);
        signal?.throwIfAborted();
        if (raw === void 0) {
          throw new Error(`subagent "${id}" has no stored log artifact`);
        }
        rememberMedia(raw.content);
        yield {
          path: `subagents/${safeSessionIdSegment(id)}/${raw.filename}`,
          content: raw.content
        };
        yield* collect(node.descendants);
      }
    };
    const lineage = await deps.sessionQuery.traceSession(sessionId, signal);
    signal?.throwIfAborted();
    yield* collect(lineage.descendants);
  }
  for (const ref of media.values()) {
    signal?.throwIfAborted();
    const stored = await deps.attachments.readImage(ref, signal);
    signal?.throwIfAborted();
    yield { path: mediaEntryPath(ref), data: stored.data };
  }
}
var PUSH_CHUNK_CODE_UNITS = 1 << 16;
var PUSH_CHUNK_BYTES = 1 << 16;
var RESPONSE_HIGH_WATER_MARK_BYTES = 1 << 16;
var ResponseCapacityGate = class {
  releasePending;
  /**
   * Wait until the response queue has positive byte capacity or cancellation wins.
   * @param controller - response controller whose desired size owns capacity.
   * @param signal - combined request/consumer cancellation.
   */
  async wait(controller, signal) {
    signal.throwIfAborted();
    if (controller.desiredSize === null || controller.desiredSize > 0) return;
    await new Promise((resolve) => {
      const release = () => {
        this.releasePending = void 0;
        signal.removeEventListener("abort", release);
        resolve();
      };
      this.releasePending = release;
      signal.addEventListener("abort", release, { once: true });
    });
    signal.throwIfAborted();
  }
  /** Release the current producer waiter after a consumer pull. */
  pulled() {
    this.releasePending?.();
  }
};
async function pushBinaryChunks(deflate, data, controller, capacity, signal) {
  let offset = 0;
  do {
    signal.throwIfAborted();
    const end = Math.min(offset + PUSH_CHUNK_BYTES, data.byteLength);
    const finalChunk = end >= data.byteLength;
    deflate.push(data.subarray(offset, end), finalChunk);
    offset = end;
    await capacity.wait(controller, signal);
  } while (offset < data.byteLength);
}
async function pushArtifactChunks(deflate, content, controller, capacity, signal) {
  const encoder = new TextEncoder();
  let offset = 0;
  let finalChunk;
  do {
    signal.throwIfAborted();
    let end = Math.min(offset + PUSH_CHUNK_CODE_UNITS, content.length);
    if (end < content.length && end - offset > 1) {
      const last = content.charCodeAt(end - 1);
      if (last >= 55296 && last <= 56319) end -= 1;
    }
    finalChunk = end >= content.length;
    deflate.push(encoder.encode(content.slice(offset, end)), finalChunk);
    offset = end;
    await capacity.wait(controller, signal);
  } while (!finalChunk);
}
function streamSessionLogZip(deps, root, sessionId, includeDescendants, compressionLevel, signal) {
  const consumerAbort = new AbortController();
  const producerSignal = AbortSignal.any([signal, consumerAbort.signal]);
  let zip;
  let zipTerminated = false;
  const capacity = new ResponseCapacityGate();
  const terminateZip = () => {
    if (zip === void 0 || zipTerminated) return;
    zipTerminated = true;
    zip.terminate();
  };
  return new ReadableStream({
    start(controller) {
      const archive = new Zip((error, data, final) => {
        if (error) {
          controller.error(error);
          return;
        }
        if (data.byteLength > 0) controller.enqueue(data);
        if (final) controller.close();
      });
      zip = archive;
      void (async () => {
        try {
          for await (const entry of sessionLogZipEntries(deps, root, sessionId, includeDescendants, producerSignal)) {
            const deflate = new ZipDeflate(entry.path, { level: compressionLevel });
            archive.add(deflate);
            if ("content" in entry) {
              await pushArtifactChunks(deflate, entry.content, controller, capacity, producerSignal);
            } else {
              await pushBinaryChunks(deflate, entry.data, controller, capacity, producerSignal);
            }
          }
          archive.end();
        } catch (error) {
          terminateZip();
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    },
    pull() {
      capacity.pulled();
    },
    cancel(reason) {
      consumerAbort.abort(
        reason instanceof Error ? reason : new Error("session log export stream cancelled")
      );
      terminateZip();
    }
  }, {
    highWaterMark: RESPONSE_HIGH_WATER_MARK_BYTES,
    size: (chunk) => chunk.byteLength
  });
}

// vendor/harness/packages/host/apiproxy/src/api/session-search.ts
var SESSION_SEARCH_RESULT_LIMIT = 20;
var SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240;
function truncateUnicodeCodePoints(value, maximum) {
  let count = 0;
  let end = 0;
  for (const codePoint of value) {
    if (count === maximum) return value.slice(0, end);
    count++;
    end += codePoint.length;
  }
  return value;
}

// vendor/harness/packages/host/apiproxy/src/api-proxy.ts
import { GoalError } from "@deepseek-ai/dsh-goal";
import { SettingsConflictError, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { SessionTitleInvalidError } from "@deepseek-ai/dsh-session-title";

// vendor/harness/packages/host/apiproxy/src/api/approvals.schema.ts
import { z as z2 } from "zod";

// vendor/harness/packages/host/apiproxy/src/api/sessions.schema.ts
import { z } from "zod";
var sessionIdSchema = z.string().min(1);
var messageIdSchema = z.string().min(1);
var workspaceIdSchema = z.string().min(1);
var sessionEventSchema = z.object({
  type: z.string(),
  seq: z.number().int().nonnegative(),
  time: z.number(),
  data: z.unknown(),
  sourceEventSeqs: z.array(z.number()).optional(),
  surfaceOp: z.unknown().optional(),
  ignorable: z.literal(true).optional()
});
var sessionSummarySchema = z.object({
  sessionId: sessionIdSchema,
  updatedAt: z.number(),
  running: z.boolean(),
  blank: z.boolean(),
  parentSessionId: sessionIdSchema.optional(),
  origin: z.literal("subagent").optional(),
  cwd: z.string().optional(),
  agentPreset: z.string().optional(),
  projections: z.lazy(() => sessionProjectionsBlockSchema).optional()
});
var sessionListRequestSchema = z.object({
  cursor: z.string().optional()
});
var sessionListValueSchema = z.object({
  items: z.array(sessionSummarySchema)
});
var SESSION_SEARCH_QUERY_MAX_CHARS = 500;
var sessionSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(SESSION_SEARCH_QUERY_MAX_CHARS).refine((query) => !query.includes("\0"), { message: "search query must not contain NUL" })
});
var sessionSearchItemSchema = z.object({
  sessionId: sessionIdSchema,
  snippet: z.string().refine(
    (snippet) => truncateUnicodeCodePoints(
      snippet,
      SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS
    ) === snippet,
    { message: `search snippet must contain at most ${SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS} Unicode code points` }
  )
});
var sessionSearchValueSchema = z.object({
  items: z.array(sessionSearchItemSchema).max(SESSION_SEARCH_RESULT_LIMIT),
  hasMore: z.boolean()
});
var sessionCreateRequestSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  cwd: z.string().optional(),
  sessionId: sessionIdSchema.optional(),
  agentPreset: z.string().optional()
}).refine(
  (payload) => payload.workspaceId === void 0 || payload.cwd === void 0,
  { message: "session.create accepts workspaceId or cwd, not both" }
);
var sessionCreateValueSchema = z.object({
  sessionId: sessionIdSchema,
  agentPreset: z.string().optional()
});
var sessionRenameRequestSchema = z.object({
  sessionId: sessionIdSchema,
  title: z.string()
});
var sessionRenameValueSchema = z.object({
  title: z.string().min(1),
  seq: z.number().int().nonnegative()
});
var sessionForkRequestSchema = z.object({
  sessionId: sessionIdSchema,
  atSeq: z.number().int().nonnegative().optional()
});
var sessionForkValueSchema = z.object({
  sessionId: sessionIdSchema
});
var sessionHistoryRequestSchema = z.object({
  sessionId: sessionIdSchema,
  beforeSeq: z.number().int().nonnegative().optional(),
  maxMessages: z.number().int().positive().optional()
});
var modelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional()
});
var modelReasoningEffortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional()
});
var modelReasoningSchema = z.object({
  efforts: z.array(modelReasoningEffortSchema).min(1),
  defaultEffort: z.string().min(1).optional()
});
var modelCatalogModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  reasoning: modelReasoningSchema.optional()
});
var modelProviderGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  models: z.array(modelCatalogModelSchema)
});
var modelCatalogFailureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  message: z.string()
});
var toolEventViewSchema = z.discriminatedUnion("for", [
  z.object({ for: z.literal("call"), view: z.looseObject({ card: z.string() }) }),
  z.object({ for: z.literal("result"), view: z.looseObject({ card: z.string() }) })
]);
var historyEntrySchema = z.object({
  event: sessionEventSchema,
  view: toolEventViewSchema.optional()
});
var sessionProjectionsBlockSchema = z.object({
  // -1 = empty log (the lastSeq convention of session/subscribed).
  asOfSeq: z.number().int().min(-1),
  values: z.record(z.string(), z.unknown())
});
var sessionListMetadataProjectionSchema = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable()
});
var imageLimitsProjectionSchema = z.object({
  maxImageBytes: z.number().int().positive(),
  maxImagesPerMessage: z.number().int().positive(),
  maxMessageImageBytes: z.number().int().positive(),
  maxImagePixels: z.number().int().positive(),
  mediaTypes: z.array(z.string())
});
var sessionHistoryValueSchema = z.object({
  events: z.array(historyEntrySchema),
  hasMore: z.boolean(),
  projections: sessionProjectionsBlockSchema.optional()
});
var sessionModelsRequestSchema = z.object({
  sessionId: sessionIdSchema
});
var sessionModelsValueSchema = z.object({
  current: modelSelectionSchema,
  routable: z.boolean(),
  groups: z.array(modelProviderGroupSchema),
  failures: z.array(modelCatalogFailureSchema)
});
var sessionSelectModelRequestSchema = z.object({
  sessionId: sessionIdSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional()
});
var sessionSelectModelValueSchema = z.object({
  selected: modelSelectionSchema
});
var contentBlockSchema = z.looseObject({ type: z.string() });
var imageMediaTypeSchema = z.union([
  z.literal("image/png"),
  z.literal("image/jpeg"),
  z.literal("image/webp"),
  z.literal("image/gif")
]);
var promptContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), mediaType: imageMediaTypeSchema, data: z.string(), name: z.string().optional() })
]);
var sessionPromptRequestSchema = z.object({
  sessionId: sessionIdSchema,
  mode: z.union([z.literal("queue"), z.literal("steer")]),
  content: z.array(promptContentPartSchema),
  clientTimeZone: z.string().optional()
});
var sessionPromptValueSchema = z.object({
  accepted: z.literal(true),
  command: z.object({
    kind: z.literal("success"),
    text: z.string().optional()
  }).optional()
});
var attachmentIdSchema = z.string().min(1);
var imageAttachmentRefSchema = z.object({
  attachmentId: attachmentIdSchema,
  mediaType: imageMediaTypeSchema,
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string().optional()
});
var sessionAttachmentRequestSchema = z.object({
  sessionId: sessionIdSchema,
  attachmentId: attachmentIdSchema
});
var sessionAttachmentValueSchema = z.object({
  attachment: imageAttachmentRefSchema,
  data: z.string()
});
var sessionUpdateQueueRequestSchema = z.object({
  sessionId: sessionIdSchema,
  itemId: messageIdSchema,
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("edit"), content: z.array(contentBlockSchema) }),
    z.object({ kind: z.literal("remove") }),
    z.object({ kind: z.literal("steer") })
  ])
});
var sessionUpdateQueueValueSchema = z.object({
  accepted: z.literal(true)
});
var sessionCancelRequestSchema = z.object({
  sessionId: sessionIdSchema
});
var sessionCancelValueSchema = z.object({
  accepted: z.literal(true)
});

// vendor/harness/packages/host/apiproxy/src/api/approvals.schema.ts
var approvalRequestIdSchema = z2.string().min(1);
var approvalResponsePayloadSchema = z2.object({
  sessionId: sessionIdSchema,
  approvalId: approvalRequestIdSchema,
  outcome: z2.union([z2.literal("allowed-once"), z2.literal("rejected")])
});

// vendor/harness/packages/host/apiproxy/src/api/questions.schema.ts
import { z as z3 } from "zod";
var askUserQuestionAnswerSchema = z3.object({
  answers: z3.array(z3.object({
    id: z3.string(),
    selected: z3.array(z3.string()),
    custom: z3.string().optional()
  }))
});
var questionResponsePayloadSchema = z3.object({
  sessionId: sessionIdSchema,
  answer: askUserQuestionAnswerSchema
});

// vendor/harness/packages/host/apiproxy/src/api/rpc.ts
function RpcId(id) {
  return id;
}

// vendor/harness/packages/host/apiproxy/src/api-proxy.ts
import { UserQuestionError } from "@deepseek-ai/dsh-user-questions";
import { DirectoryPickerError } from "@deepseek-ai/dsh-host-directory-picker";
import {
  ApiRemoteSessionNotFound as SessionNotFound,
  ApiRemoteSubagentSessionOwnership as SubagentSessionOwnership,
  API_REMOTE_FORWARDED_EVENTS,
  apiRemoteSubagentOwnershipError,
  createApiRemoteAgentResolver,
  hasApiRemoteSubagentOwner,
  inspectApiRemoteSession
} from "@deepseek-ai/dsh-api-remotes";

// vendor/harness/packages/host/apiproxy/src/native-path-opener.ts
import { release as osRelease } from "node:os";
import { extname } from "node:path";
import { runNativeCommand } from "@deepseek-ai/dsh-native-command";
var BROWSER_DOCUMENTS = /* @__PURE__ */ new Set([".html", ".htm", ".xhtml", ".svg"]);
function macBundleForHttps(plist) {
  const stripped = plist.replace(/LSHandlerPreferredVersions\s*=\s*\{[^}]*\};/g, "");
  const block = /\{[^{}]*LSHandlerURLScheme\s*=\s*"?https"?;[^{}]*\}/.exec(stripped)?.[0];
  if (block === void 0) return void 0;
  return /LSHandlerRoleAll\s*=\s*"?([\w.-]+)"?;/.exec(block)?.[1];
}
async function openInBrowser(path, signal, platform, run, env) {
  if (platform === "darwin") {
    let bundle;
    try {
      const { stdout } = await run(
        "defaults",
        ["read", "com.apple.LaunchServices/com.apple.launchservices.secure"],
        signal
      );
      bundle = macBundleForHttps(stdout);
    } catch {
      return false;
    }
    if (bundle === void 0) return false;
    await run("open", ["-b", bundle, path], signal);
    return true;
  }
  if (platform === "linux") {
    const browser = env.BROWSER;
    if (browser === void 0 || browser === "") return false;
    await run(browser, [path], signal);
    return true;
  }
  return false;
}
function powershellLiteral(path) {
  return `'${path.replace(/'/g, "''")}'`;
}
function present(value) {
  return value !== void 0 && value !== "";
}
function isWsl(internals) {
  const env = internals.env ?? process.env;
  if (present(env.WSL_DISTRO_NAME) || present(env.WSL_INTEROP)) return true;
  return (internals.osRelease ?? osRelease()).toLowerCase().includes("microsoft");
}
async function openWindowsPath(path, signal, run) {
  await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Invoke-Item -LiteralPath ${powershellLiteral(path)}`
  ], signal);
}
async function openWslPath(path, signal, run) {
  const translated = await run("wslpath", ["-w", path], signal);
  signal.throwIfAborted();
  const windowsPath = translated.stdout.replace(/[\r\n]+$/, "");
  if (windowsPath === "") throw new Error("wslpath returned no Windows path");
  await openWindowsPath(windowsPath, signal, run);
}
async function openNativePathWithIntent(path, signal, intent, internals = {}) {
  const platform = internals.platform ?? process.platform;
  const run = internals.run ?? runNativeCommand;
  const env = internals.env ?? process.env;
  const wsl = platform === "linux" && isWsl(internals);
  if (!wsl && intent === "default" && BROWSER_DOCUMENTS.has(extname(path).toLowerCase()) && await openInBrowser(path, signal, platform, run, env)) return;
  if (platform === "darwin") {
    await run("open", intent === "text-editor" ? ["-t", path] : [path], signal);
    return;
  }
  if (platform === "win32") {
    await openWindowsPath(path, signal, run);
    return;
  }
  if (platform === "linux") {
    if (wsl) {
      await openWslPath(path, signal, run);
      return;
    }
    await run("xdg-open", [path], signal);
    return;
  }
  throw new Error(`native path opener is unsupported on ${platform}`);
}
function canOpenNativePath(internals = {}) {
  const platform = internals.platform ?? process.platform;
  if (platform === "darwin" || platform === "win32") return true;
  if (platform !== "linux") return false;
  const env = internals.env ?? process.env;
  return isWsl(internals) || present(env.DISPLAY) || present(env.WAYLAND_DISPLAY);
}
function openNativePath(path, signal, internals = {}) {
  return openNativePathWithIntent(path, signal, "default", internals);
}
function openNativeTextFile(path, signal, internals = {}) {
  return openNativePathWithIntent(path, signal, "text-editor", internals);
}

// vendor/harness/packages/host/apiproxy/src/api-proxy.ts
var DEFAULT_MAX_MESSAGES = 50;
var SESSION_SEARCH_PROVIDER_CALL_LIMIT = 100;
var COLD_SUMMARY_BATCH_SIZE = 16;
var DEFAULT_COLD_BLANK_PROBE_MAX_BYTES = 1024;
var MESSAGE_TYPES = /* @__PURE__ */ new Set(["user/message", "assistant/message"]);
function decodeBase64(data) {
  const decoded = Buffer.from(data, "base64");
  if (data.length === 0 || decoded.toString("base64") !== data) {
    throw new AttachmentError("Image upload is not canonical base64.", "INVALID_IMAGE_BASE64");
  }
  return new Uint8Array(decoded);
}
async function durablePromptContent(ctx, content) {
  if (content.every((part) => part.type === "text")) {
    return content.map((part) => ({ type: "text", text: part.text }));
  }
  const prepared = content.map((part) => part.type === "text" ? part : { part, data: decodeBase64(part.data) });
  const images = prepared.filter((part) => "data" in part);
  const refs = await ctx.attachments.saveImages(images.map((image) => ({
    data: image.data,
    mediaType: image.part.mediaType,
    ...image.part.name === void 0 ? {} : { name: image.part.name }
  })));
  const blocks = [];
  let imageIndex = 0;
  for (const item of prepared) {
    if (!("data" in item)) {
      blocks.push({ type: "text", text: item.text });
      continue;
    }
    const attachment = refs[imageIndex++];
    if (attachment === void 0) throw new Error("attachment batch result did not preserve input cardinality");
    blocks.push({ type: "image", attachment });
  }
  return blocks;
}
function imageBlockIn(content, match) {
  if (!Array.isArray(content)) return void 0;
  for (const value of content) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const block = value;
    if (block.type === "image" && typeof block.attachment === "object" && block.attachment !== null) {
      const ref = block.attachment;
      if (match(ref)) return ref;
    }
    if (block.type === "tool-result") {
      const nested = imageBlockIn(block.content, match);
      if (nested !== void 0) return nested;
    }
  }
  return void 0;
}
function imageInEvent(event, match) {
  const data = event.data;
  const direct = imageBlockIn(data.content, match);
  if (direct !== void 0) return direct;
  if (data.message !== void 0) {
    const wrapped = imageBlockIn(data.message.content, match);
    if (wrapped !== void 0) return wrapped;
  }
  if (data.inserted !== void 0) {
    for (const message of data.inserted) {
      const inserted = imageBlockIn(message.content, match);
      if (inserted !== void 0) return inserted;
    }
  }
  if (event.type === "assistant/chunk" && data.chunk?.type === "block-end") {
    return imageBlockIn([data.chunk.block], match);
  }
  return void 0;
}
function messagesHaveImage(messages) {
  return messages.some((message) => contentHasImage(message.content));
}
function referencedImage(events, attachmentId) {
  for (const event of events) {
    const found = imageInEvent(event, (ref) => String(ref.attachmentId) === attachmentId);
    if (found !== void 0) return found;
  }
  return void 0;
}
var IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/;
function canonicalClientTimeZone(value) {
  if (value.length === 0 || value.trim() !== value || value !== "UTC" && !IANA_TIME_ZONE.test(value)) return void 0;
  try {
    const canonical = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
    if (canonical !== "UTC" && !IANA_TIME_ZONE.test(canonical)) return void 0;
    return canonical;
  } catch {
    return void 0;
  }
}
function isAborted(signal) {
  return signal.aborted;
}
function paginate(events, beforeSeq, maxMessages) {
  const window = beforeSeq === void 0 ? [...events] : events.filter((event) => event.seq < beforeSeq);
  let count = 0;
  let cut = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    const event = window[i];
    if (!MESSAGE_TYPES.has(event.type) || !isAppendSurfaceEvent(event)) continue;
    count++;
    const sources = event.sourceEventSeqs;
    const groupStart = sources !== void 0 && sources.length > 0 ? Math.min(event.seq, ...sources) : event.seq;
    if (count >= maxMessages) {
      cut = groupStart;
      break;
    }
  }
  const page = window.filter((event) => event.seq >= cut);
  return { events: page, hasMore: cut > 0 };
}
function ok(request, value) {
  return { rpcId: request.rpcId, result: { ok: true, value } };
}
async function buildModelCatalog(ctx) {
  const catalog = await Promise.all(ctx.llm.listProviders().map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id);
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id);
        const reasoning = resolved.reasoning === void 0 ? void 0 : {
          efforts: resolved.reasoning.efforts.map((effort) => ({
            id: effort.id,
            name: effort.name,
            ...effort.description === void 0 ? {} : { description: effort.description }
          })),
          ...resolved.reasoning.defaultEffort === void 0 ? {} : { defaultEffort: resolved.reasoning.defaultEffort }
        };
        return {
          id: model.id,
          name: model.name,
          ...model.description === void 0 ? {} : { description: model.description },
          ...reasoning === void 0 ? {} : { reasoning }
        };
      }));
      const group = {
        id: provider.id,
        name: provider.name,
        models: entries
      };
      return { kind: "group", group };
    } catch (error) {
      const failure = {
        id: provider.id,
        name: provider.name,
        message: error instanceof Error ? error.message : String(error)
      };
      return { kind: "failure", failure };
    }
  }));
  return {
    groups: catalog.flatMap((item) => item.kind === "group" ? [item.group] : []).filter((group) => group.models.length > 0),
    failures: catalog.flatMap((item) => item.kind === "failure" ? [item.failure] : [])
  };
}
function err(request, error) {
  return { rpcId: request.rpcId, result: { ok: false, error } };
}
function presetFailure(request, error) {
  if (error instanceof UnknownPresetError) {
    return err(request, {
      code: "agent-preset-not-found",
      message: error.message,
      details: { agentPreset: error.presetId, available: [...error.available] }
    });
  }
  if (error instanceof PresetMountError) {
    return err(request, {
      code: "agent-preset-invalid",
      message: error.message,
      details: { agentPreset: error.presetId, reason: error.reason }
    });
  }
  return void 0;
}
var FrameQueue = class {
  buffer = [];
  waiter;
  done = false;
  push(item) {
    if (this.done) return;
    this.buffer.push(item);
    this.waiter?.();
  }
  end() {
    this.done = true;
    this.waiter?.();
  }
  async *iterate(signal, cleanup) {
    const onAbort = () => {
      this.end();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (true) {
        while (this.buffer.length > 0) yield this.buffer.shift();
        if (this.done || signal.aborted) return;
        await new Promise((resolve) => {
          this.waiter = resolve;
        });
        this.waiter = void 0;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      cleanup();
    }
  }
};
function frame(payload) {
  return { rpcId: RpcId(randomUUID()), payload };
}
function assertJsonArgs(event, args) {
  for (const [index, arg] of args.entries()) {
    if (!isJsonValue(arg)) {
      throw new Error(`forwarded host event "${event}" argument ${index} is not lossless JSON data`);
    }
  }
  return args;
}
function subscribeSession(queue, session) {
  queue.push(frame({ type: "session/subscribed", sessionId: session.id, lastSeq: session.seq - 1 }));
}
function jobViews(snapshots) {
  return snapshots.map((job) => ({
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...job.detail === void 0 ? {} : { detail: job.detail },
    startedAt: job.startedAt,
    ...job.finishedAt === void 0 ? {} : { finishedAt: job.finishedAt }
  }));
}
function sessionBlank(session) {
  return !session.events.some((event) => event.type === "turn/start");
}
function applySessionListMetadata(state, event) {
  const blank = state.blank && event.type !== "turn/start";
  const lastPromptAt = event.type === "user/message" && event.data.source.kind === "user" ? event.time : state.lastPromptAt;
  return blank === state.blank && lastPromptAt === state.lastPromptAt ? state : { blank, lastPromptAt };
}
function sessionListMetadata(events) {
  let state = { blank: true, lastPromptAt: null };
  for (const event of events) state = applySessionListMetadata(state, event);
  return state;
}
function sessionListUpdatedAt(header, metadata) {
  return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0);
}
function sessionListFields(header, events = []) {
  const agentPreset = resolveSessionPreset({ header, events });
  return {
    ...header.parentSession === void 0 ? {} : { parentSessionId: header.parentSession },
    ...header.origin === void 0 ? {} : { origin: header.origin },
    ...header.cwd === void 0 ? {} : { cwd: header.cwd },
    ...agentPreset === void 0 ? {} : { agentPreset }
  };
}
function summarize(session, running) {
  const metadata = sessionListMetadata(session.events);
  return {
    sessionId: session.id,
    updatedAt: sessionListUpdatedAt(session.header, metadata),
    running,
    blank: metadata.blank,
    ...sessionListFields(session.header, session.events)
  };
}
async function probeColdSessionMetadata(ctx, persistence, meta, maxBytes, signal) {
  if (maxBytes === 0) return void 0;
  signal?.throwIfAborted();
  const location = persistence.locate(meta);
  if (location === void 0) return void 0;
  signal?.throwIfAborted();
  let size;
  try {
    size = (await stat(location.path)).size;
  } catch {
    signal?.throwIfAborted();
    return void 0;
  }
  if (size > maxBytes) return void 0;
  try {
    const { events } = await persistence.readFrom(meta.id, 0, signal);
    signal?.throwIfAborted();
    return sessionListMetadata(events);
  } catch (error) {
    signal?.throwIfAborted();
    ctx.logger.warn(`session.list: blank probe for "${meta.id}" failed (serving it as visible): ${String(error)}`);
    return void 0;
  }
}
async function summarizeCold(ctx, persistence, meta, metadata, blankProbeMaxBytes, signal) {
  const probed = metadata?.blank === false ? void 0 : await probeColdSessionMetadata(ctx, persistence, meta, blankProbeMaxBytes, signal);
  return {
    sessionId: meta.id,
    updatedAt: sessionListUpdatedAt(meta, probed ?? metadata),
    running: false,
    blank: metadata?.blank === false ? false : probed?.blank ?? false,
    // Header-only: reading the log for a blank-window preset switch would
    // defeat the same index read, and attaching the session replaces this row
    // with `summarize()`, which resolves the switch from the events.
    ...sessionListFields(meta)
  };
}
function directoryError(error) {
  if (error instanceof DirectoryPickerError) {
    return { code: error.code, message: error.message, details: { path: error.path } };
  }
  return { code: "internal", message: error instanceof Error ? error.message : String(error), details: {} };
}
function requestedFrame(pending) {
  return {
    rpcId: pending.rpcId,
    payload: {
      type: "approval/requested",
      sessionId: pending.sessionId,
      approvalId: pending.approvalId,
      toolName: pending.toolName,
      ...pending.callId === void 0 ? {} : { callId: pending.callId },
      ...pending.reason === void 0 ? {} : { reason: pending.reason }
    }
  };
}
function matchesQuestions(payload, pending) {
  if (payload.sessionId !== pending.sessionId) return false;
  const answers = payload.answer.answers;
  if (answers.length !== pending.questions.length) return false;
  return answers.every((answer, index) => {
    const question = pending.questions[index];
    if (answer.id !== question.id) return false;
    if (new Set(answer.selected).size !== answer.selected.length) return false;
    const custom = answer.custom?.trim();
    if (custom !== void 0 && custom === "") return false;
    if (question.multiSelect !== true) {
      if (custom !== void 0 && answer.selected.length > 0) return false;
      if (answer.selected.length > 1) return false;
    }
    const labels = new Set(question.options?.map((option) => option.label) ?? []);
    return answer.selected.every((label) => labels.has(label));
  });
}
function viewFor(ctx, event, argsFor, scope) {
  try {
    if (event.type === "tool/call") {
      const { name, arguments: raw } = event.data;
      const view = ctx.tools.get(name, scope)?.presentCall?.(JSON.parse(raw));
      return view === void 0 ? void 0 : { for: "call", view };
    }
    if (event.type === "tool/result") {
      const { message, meta } = event.data;
      const [result] = message.content;
      const callId = message.source.callId;
      const call = argsFor(callId);
      if (call === void 0) return void 0;
      const view = ctx.tools.get(call.name, scope)?.presentResult?.(call.args, {
        content: result.content,
        isError: result.isError === true,
        ...meta === void 0 ? {} : { meta }
      });
      return view === void 0 ? void 0 : { for: "result", view };
    }
  } catch (error) {
    console.error(`api-proxy: presenter failed for ${event.type}, falling back to generic: ${String(error)}`);
  }
  return void 0;
}
function backscanArgs(events, callId) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== "tool/call") continue;
    const data = event.data;
    if (data.callId !== callId) continue;
    try {
      return { name: data.name, args: JSON.parse(data.arguments) };
    } catch {
      return void 0;
    }
  }
  return void 0;
}
function historyPage(ctx, events, beforeSeq, maxMessages, scope) {
  const page = paginate(events, beforeSeq, maxMessages ?? DEFAULT_MAX_MESSAGES);
  return {
    events: page.events.map((event) => {
      const view = viewFor(ctx, event, (callId) => backscanArgs(page.events, callId), scope);
      return { event, ...view === void 0 ? {} : { view } };
    }),
    hasMore: page.hasMore
  };
}
function projectionsFor(ctx, session) {
  const registry = ctx.get("sessionProjections");
  if (registry === void 0) return void 0;
  return registry.snapshot(session);
}
function listProjectionsFor(ctx, meta, session) {
  try {
    const block = session !== void 0 ? ctx.get("sessionProjections")?.snapshot(session) : ctx.get("sessionProjectionCache")?.cachedSnapshot(meta);
    return block !== void 0 && Object.keys(block.values).length > 0 ? block : void 0;
  } catch (error) {
    ctx.logger.warn(`session.list: projection column for "${meta.id}" failed (serving the row without it): ${String(error)}`);
    return void 0;
  }
}
function detachedProjectionsFor(ctx, events) {
  const registry = ctx.get("sessionProjections");
  if (registry === void 0) return void 0;
  return registry.restore({}, events, 0).snapshot;
}
function subagentHistoryProjections(ctx, childSessionId, compute) {
  try {
    return compute();
  } catch (error) {
    ctx.logger.warn(`subagent.history: projections for "${childSessionId}" failed (serving the page without them): ${String(error)}`);
    return void 0;
  }
}
function subagentPromptError(request, error, signal) {
  const childSessionId = request.payload.childSessionId;
  if (signal.aborted) {
    return err(request, { code: "cancelled", message: "subagent prompt was cancelled", details: {} });
  }
  if (error instanceof SubagentError) {
    switch (error.code) {
      case "NOT_RESUMABLE":
        return err(request, {
          code: "subagent-not-resumable",
          message: "subagent cannot be resumed",
          details: { childSessionId }
        });
      case "UNAUTHORIZED":
        return err(request, {
          code: "subagent-unauthorized",
          message: "subagent does not belong to this parent",
          details: { childSessionId }
        });
      case "DRAINING":
      case "ACTIVATION_CLOSING":
      case "CONTINUATION_UNAVAILABLE":
      case "PERSISTENCE_UNAVAILABLE":
        return err(request, {
          code: "subagent-delivery-unavailable",
          message: "subagent follow-up is temporarily unavailable",
          details: { childSessionId }
        });
      default:
        break;
    }
  }
  return err(request, { code: "internal", message: "subagent prompt failed", details: {} });
}
function projectionsUnavailableError() {
  return {
    code: "internal",
    message: "subagent catalog is unavailable: this deployment does not mount the sessionProjections registry (load @deepseek-ai/dsh-session-projection)",
    details: {}
  };
}
async function catalogChild(ctx, address, signal) {
  const { parentSessionId, childSessionId, mode } = address;
  try {
    const entries = await ctx.subagents.listChildren(parentSessionId, signal);
    const entry = entries.find((candidate) => candidate.id === childSessionId);
    if (entry === void 0 || entry.kind === "child" && entry.mode !== mode) {
      return {
        error: {
          code: "subagent-not-found",
          message: `session "${childSessionId}" is not a ${mode} direct child of "${parentSessionId}"`,
          details: { parentSessionId, childSessionId }
        }
      };
    }
    if (entry.kind === "diagnostic") {
      return {
        error: {
          code: "subagent-catalog-diagnostic",
          message: `subagent "${childSessionId}" is ${entry.reason}`,
          details: { parentSessionId, childSessionId, reason: entry.reason }
        }
      };
    }
    return { entry };
  } catch (error) {
    if (signal?.aborted || error instanceof SubagentError && error.code === "CANCELLED") {
      return { error: { code: "cancelled", message: "subagent catalog read was cancelled", details: {} } };
    }
    if (error instanceof SubagentError && error.code === "SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE") {
      return { error: projectionsUnavailableError() };
    }
    return { error: { code: "internal", message: "subagent catalog read failed", details: {} } };
  }
}
function noRoster(agentPreset) {
  return {
    code: "agent-preset-not-found",
    message: "this deployment composes no agent presets",
    details: { agentPreset, available: [] }
  };
}
function presetError(agentPreset, error) {
  if (error instanceof UnknownPresetError) {
    return {
      code: "agent-preset-not-found",
      message: error.message,
      details: { agentPreset: error.presetId, available: [...error.available] }
    };
  }
  if (error instanceof PresetNotWritableError) {
    return { code: "agent-preset-read-only", message: error.message, details: { agentPreset, reason: error.message } };
  }
  if (error instanceof InvalidPresetIdError || error instanceof PresetExistsError) {
    return { code: "agent-preset-invalid", message: error.message, details: { agentPreset, reason: error.message } };
  }
  return { code: "internal", message: `agent preset "${agentPreset}": ${String(error)}`, details: {} };
}
var AgentPresetConflict = class extends Error {
  constructor(sessionId, requestedPreset, existingPreset) {
    super(
      existingPreset === void 0 ? `session "${sessionId}" records no agent preset, so it cannot be adopted under one; a deployment composing no roster records none on any session \u2014 ` : `session "${sessionId}" already runs agent preset ${JSON.stringify(existingPreset)}; requested ${JSON.stringify(requestedPreset)}. A session's preset is fixed at creation.`
    );
    this.sessionId = sessionId;
    this.requestedPreset = requestedPreset;
    this.existingPreset = existingPreset;
  }
};
var SessionCwdConflict = class extends Error {
  constructor(sessionId, requestedCwd, existingCwd) {
    super(
      `session "${sessionId}" already exists with cwd ${JSON.stringify(existingCwd)}; requested ${JSON.stringify(requestedCwd)}`
    );
    this.sessionId = sessionId;
    this.requestedCwd = requestedCwd;
    this.existingCwd = existingCwd;
  }
};
var WorkspaceNameConflictError = class extends Error {
  constructor(workspaceName) {
    super(`workspace name '${workspaceName}' is already in use`);
    this.workspaceName = workspaceName;
    this.name = "WorkspaceNameConflictError";
  }
};
function workspaceNotFound(request, workspaceId) {
  return err(request, {
    code: "workspace-not-found",
    message: `workspace "${workspaceId}" not found`,
    details: { workspaceId }
  });
}
function workspaceView(workspace) {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  };
}
function changedWorkspaceView(workspaceId, value) {
  const record = workspaceRecord.parse(value);
  return {
    workspaceId,
    path: record.path,
    title: record.title,
    sessionIds: [...record.sessionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}
function createApiProxy(ctx, defaults) {
  const sessionExportCompressionLevel = defaults.sessionExportCompressionLevel ?? DEFAULT_SESSION_LOG_COMPRESSION_LEVEL;
  const coldBlankProbeMaxBytes = defaults.coldBlankProbeMaxBytes ?? DEFAULT_COLD_BLANK_PROBE_MAX_BYTES;
  const agentOptions = () => {
    const { provider, model } = defaults.defaultModelSelection();
    return { provider, model };
  };
  const selections = /* @__PURE__ */ new WeakMap();
  const presetSwitches = /* @__PURE__ */ new Map();
  const sessionCreations = /* @__PURE__ */ new Map();
  let workspaceCreationChain = Promise.resolve();
  const pendingQuestions = /* @__PURE__ */ new Map();
  const pendingApprovals = /* @__PURE__ */ new Map();
  const muxQueues = /* @__PURE__ */ new Set();
  const imageAdmissionChains = /* @__PURE__ */ new WeakMap();
  function serializeImageAdmission(agent, operation) {
    const result = (imageAdmissionChains.get(agent) ?? Promise.resolve()).then(operation);
    imageAdmissionChains.set(agent, result.then(() => void 0, () => void 0));
    return result;
  }
  function selectionFor(agent) {
    const installed = selections.get(agent);
    if (installed !== void 0) return installed;
    let picked;
    const selection = {
      get current() {
        if (picked !== void 0) return picked;
        const logged = agent.session.requestHeader()?.config;
        if (logged === void 0) return defaults.defaultModelSelection();
        return {
          provider: logged.provider,
          model: logged.model,
          ...logged.reasoningEffort === void 0 ? {} : { reasoningEffort: logged.reasoningEffort }
        };
      },
      set current(next) {
        picked = next;
      },
      assembled: void 0
    };
    installModelSelection(agent.ctx, selection);
    selections.set(agent, selection);
    return selection;
  }
  function installSelection(agentCtx) {
    const agent = agentCtx.agent;
    if (agent === void 0) throw new Error("api-proxy: agent setup has no scoped agent");
    selectionFor(agent);
  }
  function assertPresetUnchanged(sessionId, requested, existing) {
    if (requested === void 0 || requested === existing) return;
    throw new AgentPresetConflict(sessionId, requested, existing);
  }
  async function composeAgent(presetId) {
    const presets = ctx.get("agentPresets");
    if (presets === void 0) {
      return {
        setup: (agentCtx) => {
          installSelection(agentCtx);
          return Promise.resolve();
        }
      };
    }
    const resolvedId = (await presets.resolve(presetId)).id;
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx) => {
        installSelection(agentCtx);
        await presets.mount(agentCtx, resolvedId);
      }
    };
  }
  const hasSubagentOwner = (session, agent) => hasApiRemoteSubagentOwner(ctx, session, agent);
  const subagentOwnershipError = (sessionId) => apiRemoteSubagentOwnershipError(sessionId);
  const inspectServable = (sessionId) => inspectApiRemoteSession(ctx, sessionId);
  const agentFor = createApiRemoteAgentResolver(ctx, {
    agentOptions,
    setup: async ({ meta, events }) => (await composeAgent(resolveSessionPreset({ header: meta, events }))).setup
  });
  function broadcast(payload) {
    const envelope = frame(payload);
    for (const queue of muxQueues) queue.push(envelope);
  }
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.onChanged((session, key, value, seq) => {
      broadcast({ type: "session/projection", sessionId: session.id, key, value, seq });
    });
  });
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: "sessionListMetadata",
      schema: sessionListMetadataProjectionSchema,
      init: () => ({ blank: true, lastPromptAt: null }),
      apply: applySessionListMetadata,
      view: (state) => state,
      stateVersion: 1
    });
  });
  ctx.inject(["sessionProjections", "attachments"], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: "imageLimits",
      schema: imageLimitsProjectionSchema,
      init: () => null,
      apply: (state) => state,
      view: () => projectionCtx.attachments.imageLimits,
      stateVersion: 1
    });
  });
  const queueItems = (agent, splice) => {
    const project = (target) => {
      const messages = target === "next-turn" ? agent.inbox.nextTurn : agent.inbox.nextStep;
      return splice?.target === target ? messages.toSpliced(splice.start, splice.removedCount ?? 0, ...splice.inserted) : messages;
    };
    return [
      ...project("next-turn").map((message) => ({ id: message.id, placement: "queued", message })),
      ...project("next-step").map((message) => ({
        id: message.id,
        // Only user-origin messages are steering; injected context (approval
        // notices, task completion, attached snapshots) is not a user action
        // and must not render as a pending steering bubble.
        placement: message.source.kind === "user" ? "steering" : "context",
        message
      }))
    ];
  };
  ctx.on("session/event", (session, event) => {
    if (event.type !== "agent/inbox/spliced") return;
    const agent = ctx.agents.get(session.id);
    if (agent?.session !== session) return;
    broadcast({ type: "session/queue", sessionId: session.id, items: queueItems(agent, event.data) });
  });
  function claimQuestion(pending, outcome) {
    pendingQuestions.delete(pending.rpcId);
    if (pending.signal !== void 0 && pending.onAbort !== void 0) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    broadcast({
      type: "question/resolved",
      sessionId: pending.sessionId,
      questionRpcId: pending.rpcId,
      outcome
    });
  }
  const disposeProvider = ctx.userQuestions.registerProvider({
    ask(request) {
      const sessionId = request.agent?.id;
      if (sessionId === void 0) {
        return Promise.reject(new UserQuestionError(
          "web user interaction requires an agent-owned session",
          "ASK_MISSING_AGENT"
        ));
      }
      return new Promise((resolve, reject) => {
        const rpcId = RpcId(randomUUID());
        const pending = {
          rpcId,
          sessionId,
          questions: request.questions,
          resolve,
          reject,
          ...request.signal === void 0 ? {} : { signal: request.signal }
        };
        const onAbort = () => {
          claimQuestion(pending, "cancelled");
          reject(new UserQuestionError(
            "ask_user_question was aborted before the user answered",
            "ASK_ABORTED"
          ));
        };
        pending.onAbort = onAbort;
        pendingQuestions.set(rpcId, pending);
        request.signal?.addEventListener("abort", onAbort, { once: true });
        const envelope = {
          rpcId,
          payload: { type: "question/requested", sessionId, questions: request.questions }
        };
        for (const queue of muxQueues) queue.push(envelope);
      });
    }
  });
  ctx.effect(() => () => {
    disposeProvider();
    for (const pending of [...pendingQuestions.values()]) {
      claimQuestion(pending, "cancelled");
      pending.reject(new UserQuestionError(
        "web user-questions provider was disposed",
        "ASK_ABORTED"
      ));
    }
  }, "api-proxy: user-questions provider");
  if (ctx.get("approval") !== void 0) {
    ctx.effect(() => () => {
      for (const pending of [...pendingApprovals.values()]) pending.resolve("cancelled");
    }, "api-proxy: approval registry teardown");
    ctx.on("approval/request", (req, next) => {
      if (req.signal?.aborted === true) return Promise.resolve("cancelled");
      const events = req.agent.session.events;
      const claimed = /* @__PURE__ */ new Set();
      for (const entry of pendingApprovals.values()) claimed.add(entry.approvalId);
      const decided = /* @__PURE__ */ new Set();
      let approvalId;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event.type === "approval/decided") {
          decided.add(event.data.id);
        } else if (event.type === "approval/asked") {
          if (decided.has(event.data.id) || claimed.has(event.data.id)) continue;
          if ((req.callId ?? null) !== (event.data.callId ?? null)) continue;
          approvalId = event.data.id;
          break;
        }
      }
      if (approvalId === void 0) return next();
      const id = approvalId;
      return new Promise((resolve) => {
        const settle = (outcome) => {
          if (!pendingApprovals.delete(pending.rpcId)) return;
          req.signal?.removeEventListener("abort", onAbort);
          broadcast({ type: "approval/resolved", sessionId: pending.sessionId, approvalId: id, outcome });
          resolve(outcome);
        };
        const onAbort = () => {
          settle("cancelled");
        };
        const pending = {
          rpcId: RpcId(randomUUID()),
          sessionId: req.agent.session.id,
          approvalId: id,
          toolName: req.toolName,
          ...req.callId === void 0 ? {} : { callId: req.callId },
          ...req.reason === void 0 ? {} : { reason: req.reason },
          resolve: settle
        };
        pendingApprovals.set(pending.rpcId, pending);
        req.signal?.addEventListener("abort", onAbort, { once: true });
        const envelope = requestedFrame(pending);
        for (const queue of muxQueues) queue.push(envelope);
      });
    });
  }
  async function readSessionState(sessionId) {
    const attached = ctx.sessions.get(sessionId);
    if (attached !== void 0) {
      return {
        id: attached.id,
        header: attached.header,
        events: [...attached.events]
      };
    }
    const inspected = await inspectServable(sessionId);
    return { id: inspected.meta.id, header: inspected.meta, events: inspected.events };
  }
  async function forkWorkspace(source) {
    const workspaces = ctx.workspaceRegistry.list();
    const direct = workspaces.find((workspace) => workspace.sessionIds.includes(source.id));
    if (direct !== void 0 || source.header.origin !== "subagent") return direct;
    const lineage = await ctx.sessionQuery.traceSession(source.id);
    for (const ancestor of lineage.ancestors) {
      const workspace = workspaces.find((candidate) => candidate.sessionIds.includes(ancestor.header.id));
      if (workspace !== void 0) return workspace;
    }
    return void 0;
  }
  async function historySourceFor(sessionId) {
    const attached = ctx.sessions.get(sessionId);
    if (attached !== void 0) return { kind: "attached", session: attached };
    const inspected = await inspectServable(sessionId);
    return { kind: "detached", header: inspected.meta, events: inspected.events };
  }
  function sourceSession(source) {
    if (source.kind === "detached") return { header: source.header, events: source.events };
    return { header: source.session.header, events: source.session.events };
  }
  function historyCutOf(source, includeProjections) {
    if (source.kind === "detached") {
      const projections2 = includeProjections ? detachedProjectionsFor(ctx, source.events) : void 0;
      return { events: source.events, ...projections2 === void 0 ? {} : { projections: projections2 } };
    }
    const events = [...source.session.events];
    const projections = includeProjections ? projectionsFor(ctx, source.session) : void 0;
    return { events, ...projections === void 0 ? {} : { projections } };
  }
  async function presenterScopeFor(sessionId, session) {
    const live = ctx.get("agents")?.get(sessionId);
    if (live !== void 0) return live;
    const presets = ctx.get("agentPresets");
    if (presets === void 0) return void 0;
    try {
      return await presets.standingKeyFor(resolveSessionPreset(session));
    } catch {
      return void 0;
    }
  }
  async function ensureSession(sessionId, cwd, checkPersistedIdentity, presetId) {
    let creation = sessionCreations.get(sessionId);
    if (creation === void 0) {
      creation = (async () => {
        const attached = ctx.sessions.get(sessionId);
        const live = ctx.agents.get(sessionId);
        if (attached !== void 0 && hasSubagentOwner(attached, live)) {
          throw new SubagentSessionOwnership(sessionId);
        }
        if (live !== void 0) return live;
        const persistence = checkPersistedIdentity ? ctx.get("sessionPersistence") : void 0;
        const stored = persistence === void 0 ? void 0 : (await persistence.list()).find((header) => header.id === sessionId);
        if (persistence !== void 0 && stored !== void 0) {
          const inspected = await persistence.inspect(sessionId);
          if (hasSubagentOwner({ header: inspected.meta }, void 0)) {
            throw new SubagentSessionOwnership(sessionId);
          }
          if (inspected.meta.cwd !== cwd) {
            throw new SessionCwdConflict(sessionId, cwd, inspected.meta.cwd);
          }
          const storedPreset = resolveSessionPreset({ header: inspected.meta, events: inspected.events });
          assertPresetUnchanged(sessionId, presetId, storedPreset);
          return (await ctx.agents.resume({
            resumeSessionId: sessionId,
            agentOptions: agentOptions(),
            setup: (await composeAgent(storedPreset)).setup
          })).agent;
        }
        try {
          await mkdir(cwd, { recursive: true });
        } catch (error) {
          throw new Error(`failed to ensure project directory "${cwd}": ${String(error)}`, { cause: error });
        }
        const composition = await composeAgent(presetId);
        return (await ctx.agents.create({
          sessionId,
          agentOptions: agentOptions(),
          meta: {
            cwd,
            ...composition.agentPreset === void 0 ? {} : { agentPreset: composition.agentPreset }
          },
          setup: composition.setup
        })).agent;
      })().catch((error) => {
        const live = ctx.agents.get(sessionId);
        if (live !== void 0) {
          if (hasSubagentOwner(live.session, live)) throw new SubagentSessionOwnership(sessionId);
          return live;
        }
        const attached = ctx.sessions.get(sessionId);
        if (attached !== void 0 && hasSubagentOwner(attached, void 0)) {
          throw new SubagentSessionOwnership(sessionId);
        }
        throw error;
      }).finally(() => {
        sessionCreations.delete(sessionId);
      });
      sessionCreations.set(sessionId, creation);
    }
    const agent = await creation;
    if (hasSubagentOwner(agent.session, agent)) throw new SubagentSessionOwnership(sessionId);
    assertPresetUnchanged(sessionId, presetId, resolveSessionPreset(agent.session));
    if (agent.session.header.cwd !== cwd) {
      throw new SessionCwdConflict(sessionId, cwd, agent.session.header.cwd);
    }
    return agent;
  }
  function ensureWorkspace(path) {
    const operation = workspaceCreationChain.then(async () => {
      const existing = await ctx.workspaceRegistry.resolveByPath(path);
      if (existing !== void 0) return { workspace: existing, created: false };
      return { workspace: await ctx.workspaceRegistry.create(path), created: true };
    });
    workspaceCreationChain = operation.then(() => void 0, () => void 0);
    return operation;
  }
  async function listVisibleSessionSummaries(signal) {
    signal?.throwIfAborted();
    const summarizeAttached = (session) => {
      const agent = ctx.agents.get(session.id);
      const projections = listProjectionsFor(ctx, session.header, session);
      return {
        ...summarize(session, agent?.status === "running"),
        ...projections === void 0 ? {} : { projections }
      };
    };
    const items = ctx.sessions.list().map(summarizeAttached);
    signal?.throwIfAborted();
    const attached = new Set(items.map((item) => item.sessionId));
    const persistence = ctx.get("sessionPersistence");
    if (persistence !== void 0) {
      const cold = (await persistence.list(signal)).filter((meta) => !attached.has(meta.id) && meta.cwd !== void 0);
      signal?.throwIfAborted();
      for (let offset = 0; offset < cold.length; offset += COLD_SUMMARY_BATCH_SIZE) {
        signal?.throwIfAborted();
        const batch = cold.slice(offset, offset + COLD_SUMMARY_BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map(async (meta) => {
            const projections = listProjectionsFor(ctx, meta, void 0);
            const summary = await summarizeCold(
              ctx,
              persistence,
              meta,
              projections?.values.sessionListMetadata,
              coldBlankProbeMaxBytes,
              signal
            );
            const attachedSession = ctx.sessions.get(meta.id);
            if (attachedSession !== void 0) return summarizeAttached(attachedSession);
            return {
              ...summary,
              ...projections === void 0 ? {} : { projections }
            };
          })
        );
        const summaries = [];
        let rejected = false;
        let failure;
        for (const result of settled) {
          if (result.status === "fulfilled") {
            summaries.push(result.value);
          } else if (!rejected) {
            rejected = true;
            failure = result.reason;
          }
        }
        if (rejected) throw failure;
        signal?.throwIfAborted();
        items.push(...summaries);
      }
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return items;
  }
  function goalServiceFor(agent) {
    const presets = ctx.get("agentPresets");
    const goals = presets?.serviceFor(agent, "goals") ?? ctx.get("goals");
    if (goals === void 0) {
      return { error: { code: "internal", message: "goal service is absent: neither this session's agent preset nor the host composition mounts @deepseek-ai/dsh-goal", details: {} } };
    }
    return goals;
  }
  function goalError(request, error) {
    const details = error instanceof GoalError ? { goalCode: error.code } : {};
    return err(request, { code: "internal", message: String(error), details });
  }
  async function mutateGoal(request, mutation) {
    const found = await agentFor(request.payload.sessionId);
    if ("error" in found) return err(request, found.error);
    const goals = goalServiceFor(found.agent);
    if ("error" in goals) return err(request, goals.error);
    try {
      const ref = mutation(goals, found.agent);
      return ok(request, { ref: { id: ref.id, revision: ref.revision } });
    } catch (error) {
      return goalError(request, error);
    }
  }
  function routeServed(provider) {
    const llm = ctx.get("llm");
    return llm === void 0 || llm.listProviders().some((entry) => entry.id === provider);
  }
  async function turnAgentFor(request, sessionId) {
    const found = await agentFor(sessionId);
    if ("error" in found) return { refused: err(request, found.error) };
    const agent = found.agent;
    const selection = selectionFor(agent).current;
    if (!routeServed(selection.provider)) {
      return {
        refused: err(request, {
          code: "model-unavailable",
          message: `no adapter serves provider "${selection.provider}"; select a model for this session`,
          details: { provider: selection.provider, model: selection.model }
        })
      };
    }
    return { agent };
  }
  function settingsAbsent() {
    return { code: "internal", message: "settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) in its composition", details: {} };
  }
  async function openTarget(request, path, signal, open) {
    try {
      await open(path, signal);
      return ok(request, { opened: true });
    } catch (error) {
      if (signal.aborted) {
        return err(request, {
          code: "cancelled",
          message: "path open was aborted",
          details: {}
        });
      }
      return err(request, {
        code: "internal",
        message: `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        details: {}
      });
    }
  }
  function openPath(request, path, signal) {
    const open = defaults.openPath ?? ((target, openSignal) => openNativePath(target, openSignal));
    return openTarget(request, path, signal, open);
  }
  function openTextFile(request, path, signal) {
    const open = defaults.openTextFile ?? ((target, openSignal) => openNativeTextFile(target, openSignal));
    return openTarget(request, path, signal, open);
  }
  function canOpenPaths() {
    if (defaults.canOpenPath !== void 0) return defaults.canOpenPath();
    return defaults.openPath !== void 0 || canOpenNativePath();
  }
  function credentialsAbsent() {
    return { code: "internal", message: "credentials service is absent: this deployment does not mount a credential provider (e.g. @deepseek-ai/dsh-credentials-local) in its composition", details: {} };
  }
  function namespaceView(descriptor) {
    return {
      ns: String(descriptor.ns),
      schema: descriptor.schema,
      value: descriptor.value,
      ...descriptor.base === void 0 ? {} : { base: descriptor.base },
      ...descriptor.user === void 0 ? {} : { user: descriptor.user },
      applies: descriptor.applies,
      secrets: (descriptor.secrets ?? []).map((secret) => ({ path: [...secret.path], set: secret.set })),
      revision: descriptor.revision
    };
  }
  async function settingsWrite(request, ns, mode, section, expectedRevision) {
    const settings = ctx.get("settings");
    if (settings === void 0) return err(request, settingsAbsent());
    const rejected = (error) => {
      if (error instanceof SettingsConflictError) {
        return err(request, {
          code: "settings-conflict",
          message: error.message,
          details: { ns, expected: error.expected, actual: error.actual }
        });
      }
      return err(request, {
        code: "settings-rejected",
        message: error instanceof Error ? error.message : String(error),
        details: { ns }
      });
    };
    let branded;
    try {
      branded = settingsNamespace(ns);
    } catch (error) {
      return rejected(error);
    }
    try {
      if (mode === "update") await settings.update(branded, section, expectedRevision);
      else if (mode === "replace") await settings.replace(branded, section, expectedRevision);
      else await settings.mutate(branded, section, expectedRevision);
    } catch (error) {
      return rejected(error);
    }
    const descriptor = settings.describe({ redactSecrets: true }).find((candidate) => candidate.ns === branded);
    if (descriptor === void 0) {
      return err(request, { code: "internal", message: `settings namespace "${ns}" was disposed after the ${mode}`, details: {} });
    }
    return ok(request, namespaceView(descriptor));
  }
  return {
    sessions: {
      // Attached sessions summarize from memory; persisted-but-unattached (cold)
      // sessions merge in from the persistence store so history survives restarts.
      // Logs without a cwd are not served; every session records its project
      // at create time.
      async list(request) {
        return ok(request, { items: await listVisibleSessionSummaries() });
      },
      async search(request, signal) {
        const cancelled = () => err(request, {
          code: "cancelled",
          message: "session search was aborted",
          details: {}
        });
        if (isAborted(signal)) return cancelled();
        const sessionQuery = ctx.get("sessionQuery");
        if (sessionQuery === void 0) {
          return err(request, {
            code: "internal",
            message: "session search is unavailable: this deployment does not mount @deepseek-ai/dsh-session-query",
            details: {}
          });
        }
        try {
          const visible = await listVisibleSessionSummaries(signal);
          if (isAborted(signal)) return cancelled();
          if (visible.length === 0) return ok(request, { items: [], hasMore: false });
          const visibleIds = new Set(visible.map((item) => item.sessionId));
          const authorized = [];
          const acceptedIds = /* @__PURE__ */ new Set();
          const seenCursors = /* @__PURE__ */ new Set();
          let cursor;
          let providerCallCount = 0;
          let providerPageLimit = SESSION_SEARCH_RESULT_LIMIT;
          while (authorized.length <= SESSION_SEARCH_RESULT_LIMIT) {
            if (isAborted(signal)) return cancelled();
            if (providerCallCount >= SESSION_SEARCH_PROVIDER_CALL_LIMIT) {
              throw new Error(
                `session search provider exceeded the ${SESSION_SEARCH_PROVIDER_CALL_LIMIT}-call work budget`
              );
            }
            providerCallCount++;
            const requestedCursor = cursor;
            const requestedPageLimit = providerPageLimit;
            let page;
            try {
              page = await sessionQuery.searchSessions({
                query: request.payload.query,
                eventFilters: [
                  { kind: "type", values: ["user/message", "assistant/message"] },
                  { kind: "surface", values: ["current"] }
                ],
                limit: requestedPageLimit,
                ...requestedCursor === void 0 ? {} : { cursor: requestedCursor }
              }, { signal });
            } catch (error) {
              if (isAborted(signal)) return cancelled();
              if (requestedCursor === void 0 && error instanceof SessionQueryError && error.code === "SESSION_QUERY_INVALID_LIMIT" && requestedPageLimit > 1) {
                providerPageLimit = Math.max(1, Math.floor(requestedPageLimit / 2));
                continue;
              }
              if (requestedCursor !== void 0 && error instanceof SessionQueryError && error.code === "SESSION_QUERY_STALE_CURSOR") {
                authorized.length = 0;
                acceptedIds.clear();
                seenCursors.clear();
                cursor = void 0;
                continue;
              }
              throw error;
            }
            if (isAborted(signal)) return cancelled();
            const providerItemCount = page.items.length;
            if (providerItemCount > requestedPageLimit) {
              throw new Error(
                `session search provider returned ${providerItemCount} items; maximum is ${requestedPageLimit}`
              );
            }
            for (const hit of page.items) {
              if (authorized.length > SESSION_SEARCH_RESULT_LIMIT) continue;
              if (!visibleIds.has(hit.header.id) || hit.bestMatch.sessionId !== hit.header.id || hit.bestMatch.surface !== "current" || !MESSAGE_TYPES.has(hit.bestMatch.type) || acceptedIds.has(hit.header.id)) continue;
              const snippet = truncateUnicodeCodePoints(
                hit.bestMatch.snippet,
                SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS
              );
              acceptedIds.add(hit.header.id);
              authorized.push({
                sessionId: hit.header.id,
                snippet
              });
            }
            const nextCursor = page.nextCursor;
            if (nextCursor !== void 0) {
              if (seenCursors.has(nextCursor)) {
                throw new Error("session search provider repeated a continuation cursor");
              }
              seenCursors.add(nextCursor);
            }
            if (authorized.length > SESSION_SEARCH_RESULT_LIMIT || nextCursor === void 0) break;
            cursor = nextCursor;
          }
          return ok(request, {
            items: authorized.slice(0, SESSION_SEARCH_RESULT_LIMIT),
            hasMore: authorized.length > SESSION_SEARCH_RESULT_LIMIT
          });
        } catch (error) {
          if (isAborted(signal) || error instanceof SessionQueryError && error.code === "SESSION_QUERY_ABORTED") return cancelled();
          return err(request, {
            code: "internal",
            message: `session search failed: ${String(error)}`,
            details: {}
          });
        }
      },
      async create(request) {
        const sessionId = request.payload.sessionId ?? `session-${randomUUID()}`;
        let workspace;
        if (request.payload.workspaceId !== void 0) {
          workspace = ctx.workspaceRegistry.get(brandWorkspaceId(request.payload.workspaceId));
          if (workspace === void 0) {
            return err(request, {
              code: "workspace-not-found",
              message: `workspace "${request.payload.workspaceId}" not found`,
              details: { workspaceId: request.payload.workspaceId }
            });
          }
        }
        const cwd = workspace?.path ?? request.payload.cwd ?? defaults.cwd;
        const requestedPreset = request.payload.agentPreset;
        try {
          await ensureSession(sessionId, cwd, request.payload.sessionId !== void 0, requestedPreset);
        } catch (error) {
          if (error instanceof AgentPresetConflict) {
            return err(request, {
              code: "agent-preset-conflict",
              message: error.message,
              details: {
                sessionId: error.sessionId,
                requestedPreset: error.requestedPreset,
                ...error.existingPreset === void 0 ? {} : { existingPreset: error.existingPreset }
              }
            });
          }
          const refused = presetFailure(request, error);
          if (refused !== void 0) return refused;
          if (error instanceof SessionCwdConflict) {
            return err(request, {
              code: "session-conflict",
              message: error.message,
              details: {
                sessionId: error.sessionId,
                requestedCwd: error.requestedCwd,
                ...error.existingCwd === void 0 ? {} : { existingCwd: error.existingCwd }
              }
            });
          }
          if (error instanceof SubagentSessionOwnership) {
            return err(request, subagentOwnershipError(error.sessionId));
          }
          return err(request, {
            code: "internal",
            message: `failed to create session "${sessionId}": ${String(error)}`,
            details: {}
          });
        }
        if (workspace !== void 0) {
          try {
            await workspace.attachSession(sessionId);
          } catch (error) {
            return err(request, {
              code: "workspace-attach-failed",
              message: `session "${sessionId}" was created but could not attach to workspace "${workspace.id}": ${String(error)}`,
              details: { sessionId, workspaceId: workspace.id }
            });
          }
        }
        const created = ctx.agents.get(sessionId);
        const createdPreset = created === void 0 ? void 0 : resolveSessionPreset(created.session);
        return ok(request, { sessionId, ...createdPreset === void 0 ? {} : { agentPreset: createdPreset } });
      },
      async history(request) {
        const { sessionId, beforeSeq, maxMessages } = request.payload;
        try {
          const source = await historySourceFor(sessionId);
          const scope = await presenterScopeFor(sessionId, sourceSession(source));
          const cut = historyCutOf(source, beforeSeq === void 0);
          const page = historyPage(ctx, cut.events, beforeSeq, maxMessages, scope);
          return ok(request, {
            events: page.events,
            hasMore: page.hasMore,
            ...cut.projections === void 0 ? {} : { projections: cut.projections }
          });
        } catch (error) {
          if (error instanceof SessionNotFound) {
            return err(request, { code: "session-not-found", message: error.message, details: { sessionId } });
          }
          return err(request, {
            code: "internal",
            message: `history unavailable for session "${sessionId}": ${String(error)}`,
            details: {}
          });
        }
      },
      async models(request) {
        const { sessionId } = request.payload;
        const found = await agentFor(sessionId);
        if ("error" in found) return err(request, found.error);
        const current = selectionFor(found.agent).current;
        const { groups, failures } = await buildModelCatalog(ctx);
        const routable = routeServed(current.provider);
        return ok(request, { current: { ...current }, routable, groups, failures });
      },
      async selectModel(request) {
        const { sessionId, provider, model, reasoningEffort } = request.payload;
        const found = await agentFor(sessionId);
        if ("error" in found) return err(request, found.error);
        return serializeImageAdmission(found.agent, async () => {
          try {
            const resolved = await ctx.llm.resolveCallConfig({
              provider,
              model,
              ...reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) }
            });
            const pendingImage = [...found.agent.inbox.nextTurn, ...found.agent.inbox.nextStep].some((message) => contentHasImage(message.content));
            if (pendingImage || messagesHaveImage(found.agent.session.deriveMessages())) {
              const info = await ctx.llm.resolveModelInfo(resolved.provider, resolved.model);
              if (info.inputModalities !== void 0 && !info.inputModalities.includes("image")) {
                return err(request, {
                  code: "model-unavailable",
                  message: `Model "${resolved.model}" does not accept image input, but this session already contains images; select an image-capable model.`,
                  details: { provider, model }
                });
              }
            }
            const selected = {
              provider: resolved.provider,
              model: resolved.model,
              ...resolved.reasoningEffort === void 0 ? {} : { reasoningEffort: resolved.reasoningEffort }
            };
            selectionFor(found.agent).current = selected;
            try {
              await defaults.saveDefaultModelSelection?.(selected);
            } catch (error) {
              ctx.logger.warn(
                `api-proxy: the model switch applies to this session but was not saved as the default: ${String(error)}`
              );
            }
            return ok(request, { selected: { ...selected } });
          } catch (error) {
            return err(request, {
              code: "model-unavailable",
              message: error instanceof Error ? error.message : String(error),
              details: { provider, model }
            });
          }
        });
      },
      async rename(request) {
        const { sessionId, title } = request.payload;
        const found = await agentFor(sessionId);
        if ("error" in found) return err(request, found.error);
        const titles = ctx.get("sessionTitle");
        if (titles === void 0) {
          return err(request, { code: "internal", message: "renaming is unavailable: this deployment mounts no session-title service", details: {} });
        }
        try {
          const accepted = titles.rename(found.agent.session, title);
          return ok(request, { title: accepted.title, seq: accepted.eventSeq });
        } catch (error) {
          if (error instanceof SessionTitleInvalidError) {
            return err(request, {
              code: "title-invalid",
              message: error.message,
              details: { sessionId }
            });
          }
          return err(request, {
            code: "internal",
            message: `failed to rename session "${sessionId}": ${String(error)}`,
            details: {}
          });
        }
      },
      async fork(request) {
        const { sessionId, atSeq } = request.payload;
        let source;
        try {
          source = await readSessionState(sessionId);
        } catch (error) {
          if (error instanceof SessionNotFound) {
            return err(request, { code: "session-not-found", message: error.message, details: { sessionId } });
          }
          return err(request, {
            code: "internal",
            message: `fork source unavailable for session "${sessionId}": ${String(error)}`,
            details: {}
          });
        }
        const events = source.events;
        const lastSeq = events.at(-1)?.seq ?? -1;
        const anchoredBoundary = atSeq === void 0 ? void 0 : events.find((e) => e.type === "turn/end" && e.seq >= atSeq);
        const boundary = anchoredBoundary ?? (atSeq === void 0 || atSeq > lastSeq ? events.findLast((e) => e.type === "turn/end") : void 0);
        if (boundary === void 0) {
          return err(request, {
            code: "fork-unavailable",
            message: atSeq !== void 0 && atSeq <= lastSeq ? `session "${sessionId}" has not completed the turn containing event ${String(atSeq)}` : `session "${sessionId}" has no completed turn to fork from`,
            details: { sessionId }
          });
        }
        let cut = boundary.seq + 1;
        while (cut < events.length && events[cut]?.type !== "turn/start") cut++;
        let workspace;
        try {
          workspace = await forkWorkspace(source);
        } catch (error) {
          return err(request, {
            code: "internal",
            message: `failed to resolve fork workspace for session "${sessionId}": ${String(error)}`,
            details: {}
          });
        }
        const childId = `session-${randomUUID()}`;
        const forkComposition = await composeAgent(resolveSessionPreset(source));
        try {
          await ctx.agents.create({
            sessionId: childId,
            seed: events.slice(0, cut),
            meta: {
              ...source.header.cwd === void 0 ? {} : { cwd: source.header.cwd },
              parentSession: source.id,
              seedLength: cut,
              ...forkComposition.agentPreset === void 0 ? {} : { agentPreset: forkComposition.agentPreset }
            },
            agentOptions: agentOptions(),
            setup: forkComposition.setup
          });
        } catch (error) {
          return err(request, {
            code: "internal",
            message: `failed to fork session "${sessionId}": ${String(error)}`,
            details: {}
          });
        }
        if (workspace !== void 0) {
          try {
            await workspace.attachSession(childId);
          } catch (error) {
            return err(request, {
              code: "workspace-attach-failed",
              message: `session "${childId}" was forked but could not attach to workspace "${workspace.id}": ${String(error)}`,
              details: { sessionId: childId, workspaceId: workspace.id }
            });
          }
        }
        return ok(request, { sessionId: childId });
      },
      async prompt(request) {
        const { sessionId, mode, content, clientTimeZone } = request.payload;
        const canonicalTimeZone = clientTimeZone === void 0 ? void 0 : canonicalClientTimeZone(clientTimeZone);
        if (clientTimeZone !== void 0 && canonicalTimeZone === void 0) {
          return err(request, {
            code: "invalid-time-zone",
            message: "clientTimeZone must be UTC or a valid IANA Area/Location name",
            details: { value: clientTimeZone }
          });
        }
        const resolved = await turnAgentFor(request, sessionId);
        if ("refused" in resolved) return resolved.refused;
        const agent = resolved.agent;
        const source = {
          kind: "user",
          rpcId: request.rpcId,
          ...canonicalTimeZone === void 0 ? {} : { clientTimeZone: canonicalTimeZone }
        };
        const hasImage = content.some((part) => part.type === "image");
        const admit = async () => {
          try {
            if (hasImage) {
              const current = selectionFor(agent).current;
              const modelInfo = await ctx.llm.resolveModelInfo(current.provider, current.model);
              if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) {
                return err(request, {
                  code: "attachment-error",
                  message: `Model "${current.model}" does not support image input.`,
                  details: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }
                });
              }
            }
            const durable = await durablePromptContent(ctx, content);
            const message = createUserMessage({ content: durable, source });
            if (mode === "steer") agent.steer(message);
            else agent.followup(message);
          } catch (error) {
            if (error instanceof AttachmentError) {
              return err(request, {
                code: "attachment-error",
                message: error.message,
                details: { reason: error.code }
              });
            }
            return err(request, {
              code: "agent-busy",
              message: "prompt rejected",
              details: { reason: String(error) }
            });
          }
          return ok(request, { accepted: true });
        };
        return hasImage ? serializeImageAdmission(agent, admit) : admit();
      },
      async attachment(request) {
        const { sessionId, attachmentId } = request.payload;
        let state;
        try {
          state = await readSessionState(sessionId);
        } catch (error) {
          if (error instanceof SessionNotFound) {
            return err(request, {
              code: "session-not-found",
              message: error.message,
              details: { sessionId }
            });
          }
          return err(request, {
            code: "internal",
            message: `attachment authorization unavailable for session "${sessionId}": ${String(error)}`,
            details: {}
          });
        }
        const ref = referencedImage(state.events, String(attachmentId));
        if (ref === void 0) {
          return err(request, {
            code: "attachment-error",
            message: "Image is not referenced by this session.",
            details: { reason: "ATTACHMENT_NOT_REFERENCED" }
          });
        }
        try {
          const stored = await ctx.attachments.readImage(ref);
          return ok(request, {
            attachment: stored.ref,
            data: Buffer.from(stored.data).toString("base64")
          });
        } catch (error) {
          if (error instanceof AttachmentError) {
            return err(request, {
              code: "attachment-error",
              message: error.message,
              details: { reason: error.code }
            });
          }
          return err(request, {
            code: "internal",
            message: "Unable to read image attachment.",
            details: {}
          });
        }
      },
      updateQueue(request) {
        const { sessionId, itemId, action } = request.payload;
        if (action.kind === "edit" && action.content.some((block) => block.type !== "text")) {
          return Promise.resolve(err(request, {
            code: "attachment-error",
            message: "queue edits accept text content only",
            details: { reason: "QUEUE_EDIT_NON_TEXT" }
          }));
        }
        const agent = ctx.agents.get(sessionId);
        if (agent !== void 0 && hasSubagentOwner(agent.session, agent)) {
          return Promise.resolve(err(request, subagentOwnershipError(sessionId)));
        }
        if (agent === void 0) {
          return Promise.resolve(err(request, {
            code: "queue-item-not-found",
            message: "queued item is no longer pending",
            details: { itemId }
          }));
        }
        const target = agent.inbox.nextTurn.some((message2) => message2.id === itemId) ? "next-turn" : agent.inbox.nextStep.some((message2) => message2.id === itemId) ? "next-step" : void 0;
        const message = target === void 0 ? void 0 : (target === "next-turn" ? agent.inbox.nextTurn : agent.inbox.nextStep).find((candidate) => candidate.id === itemId);
        if (target === void 0 || message === void 0) {
          return Promise.resolve(err(request, {
            code: "queue-item-not-found",
            message: "queued item is no longer pending",
            details: { itemId }
          }));
        }
        if (action.kind === "steer" && (target !== "next-turn" || agent.status !== "running")) {
          return Promise.resolve(err(request, {
            code: "steer-unavailable",
            message: "current turn no longer accepts steering",
            details: { itemId }
          }));
        }
        if (action.kind === "edit") {
          agent.inbox.replace(itemId, freezeMessage({ ...message, content: action.content }));
        } else {
          agent.inbox.remove(itemId);
          if (action.kind === "steer") agent.steer(message);
        }
        return Promise.resolve(ok(request, { accepted: true }));
      },
      cancel(request) {
        const { sessionId } = request.payload;
        const agent = ctx.agents.get(sessionId);
        if (agent === void 0) {
          return Promise.resolve(err(request, {
            code: "session-not-found",
            message: `session "${sessionId}" not found (not attached)`,
            details: { sessionId }
          }));
        }
        if (hasSubagentOwner(agent.session, agent)) {
          return Promise.resolve(err(request, subagentOwnershipError(sessionId)));
        }
        agent.cancel({ kind: "user" }, { keepInbox: true });
        return Promise.resolve(ok(request, { accepted: true }));
      }
    },
    subagents: {
      async list(request, signal) {
        try {
          const entries = await ctx.subagents.listChildren(request.payload.parentSessionId, signal);
          return ok(request, {
            entries: entries.map((entry) => entry.kind === "child" ? {
              ...entry,
              activity: ctx.agents.get(entry.id)?.status === "running" ? "running" : "inactive"
            } : entry),
            parentAvailable: ctx.agents.get(request.payload.parentSessionId) !== void 0
          });
        } catch (error) {
          if (signal?.aborted || error instanceof SubagentError && error.code === "CANCELLED") {
            return err(request, {
              code: "cancelled",
              message: "subagent catalog read was cancelled",
              details: {}
            });
          }
          if (error instanceof SubagentError && error.code === "SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE") {
            return err(request, projectionsUnavailableError());
          }
          return err(request, {
            code: "internal",
            message: "subagent catalog read failed",
            details: {}
          });
        }
      },
      async history(request, signal) {
        const {
          parentSessionId,
          childSessionId,
          mode,
          beforeSeq,
          maxMessages
        } = request.payload;
        const verified = await catalogChild(ctx, {
          parentSessionId,
          childSessionId,
          mode
        }, signal);
        if (verified.error !== void 0) return err(request, verified.error);
        let header;
        let events;
        let projections;
        const attached = ctx.sessions.get(childSessionId);
        if (attached !== void 0) {
          header = attached.header;
          events = [...attached.events];
          projections = beforeSeq === void 0 ? subagentHistoryProjections(ctx, childSessionId, () => projectionsFor(ctx, attached)) : void 0;
        } else {
          try {
            const inspected = await inspectServable(childSessionId);
            header = inspected.meta;
            events = inspected.events;
            projections = beforeSeq === void 0 ? subagentHistoryProjections(ctx, childSessionId, () => detachedProjectionsFor(ctx, inspected.events)) : void 0;
          } catch (error) {
            if (signal?.aborted) {
              return err(request, {
                code: "cancelled",
                message: "subagent history read was cancelled",
                details: {}
              });
            }
            if (error instanceof SessionNotFound) {
              return err(request, {
                code: "subagent-not-found",
                message: "subagent disappeared during history read",
                details: { parentSessionId, childSessionId }
              });
            }
            return err(request, {
              code: "internal",
              message: "subagent history read failed",
              details: {}
            });
          }
        }
        if (signal?.aborted) {
          return err(request, {
            code: "cancelled",
            message: "subagent history read was cancelled",
            details: {}
          });
        }
        if (header.parentSession !== parentSessionId) {
          return err(request, {
            code: "subagent-unauthorized",
            message: "subagent parent changed during history read",
            details: { childSessionId }
          });
        }
        const page = historyPage(ctx, events, beforeSeq, maxMessages);
        return ok(request, { ...page, ...projections === void 0 ? {} : { projections } });
      },
      async prompt(request, signal) {
        const { parentSessionId, childSessionId, content, clientTimeZone } = request.payload;
        const canonicalTimeZone = clientTimeZone === void 0 ? void 0 : canonicalClientTimeZone(clientTimeZone);
        if (clientTimeZone !== void 0 && canonicalTimeZone === void 0) {
          return err(request, {
            code: "invalid-time-zone",
            message: "clientTimeZone must be UTC or a valid IANA Area/Location name",
            details: { value: clientTimeZone }
          });
        }
        const parent = ctx.agents.get(parentSessionId);
        if (parent === void 0) {
          return err(request, {
            code: "subagent-parent-unavailable",
            message: `parent session "${parentSessionId}" is not live`,
            details: { parentSessionId }
          });
        }
        const verified = await catalogChild(ctx, {
          parentSessionId,
          childSessionId,
          mode: "continuable"
        }, signal);
        if (verified.error !== void 0) return err(request, verified.error);
        try {
          const messageId = await ctx.subagents.followup(parent, childSessionId, content, {
            source: {
              kind: "user",
              rpcId: request.rpcId,
              ...canonicalTimeZone === void 0 ? {} : { clientTimeZone: canonicalTimeZone }
            },
            signal
          });
          return ok(request, { messageId });
        } catch (error) {
          return subagentPromptError(request, error, signal);
        }
      },
      // Deliberately no catalog, history, persistence, or parent Agent lookup:
      // the core primitive alone authorizes the durable address against the
      // live Activation, which is what keeps a live child interruptible while
      // its parent Agent is offline. Absent targets are accepted no-ops there.
      interrupt(request) {
        const { parentSessionId, childSessionId } = request.payload;
        try {
          ctx.subagents.interrupt(childSessionId, { kind: "user", parentSessionId });
        } catch (error) {
          if (error instanceof SubagentError && error.code === "UNAUTHORIZED") {
            return Promise.resolve(err(request, {
              code: "subagent-unauthorized",
              message: "subagent does not belong to this parent",
              details: { childSessionId }
            }));
          }
          return Promise.resolve(err(request, {
            code: "internal",
            message: "subagent interrupt failed",
            details: {}
          }));
        }
        return Promise.resolve(ok(request, { accepted: true }));
      }
    },
    workspace: {
      list(request) {
        return Promise.resolve(ok(request, {
          items: ctx.workspaceRegistry.list().map(workspaceView),
          archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds]
        }));
      },
      async create(request) {
        const { path } = request.payload;
        try {
          const { workspace, created } = await ensureWorkspace(path);
          return ok(request, { workspace: workspaceView(workspace), created });
        } catch (error) {
          return err(request, {
            code: "workspace-invalid-path",
            message: `cannot create a workspace at "${path}": ${error instanceof Error ? error.message : String(error)}`,
            details: { path }
          });
        }
      },
      async rename(request) {
        const { payload } = request;
        const workspace = ctx.workspaceRegistry.get(brandWorkspaceId(payload.workspaceId));
        if (workspace === void 0) return workspaceNotFound(request, payload.workspaceId);
        const title = payload.title.trim();
        const operation = workspaceCreationChain.then(async () => {
          if (title === workspace.title) return;
          if (ctx.workspaceRegistry.list().some((other) => other.id !== workspace.id && other.title === title)) {
            throw new WorkspaceNameConflictError(title);
          }
          await workspace.setTitle(title);
        });
        workspaceCreationChain = operation.then(() => void 0, () => void 0);
        try {
          await operation;
        } catch (error) {
          if (error instanceof WorkspaceNameConflictError) {
            return err(request, {
              code: "workspace-name-conflict",
              message: error.message,
              details: { name: error.workspaceName }
            });
          }
          throw error;
        }
        return ok(request, { workspace: workspaceView(workspace) });
      },
      async delete(request) {
        const { workspaceId } = request.payload;
        const operation = workspaceCreationChain.then(() => ctx.workspaceRegistry.delete(brandWorkspaceId(workspaceId)));
        workspaceCreationChain = operation.then(() => void 0, () => void 0);
        if (!await operation) return workspaceNotFound(request, workspaceId);
        return ok(request, { deleted: true });
      },
      async insertBefore(request) {
        const { workspaceId, beforeWorkspaceId } = request.payload;
        try {
          const workspaceIds = await ctx.workspaceRegistry.insertBefore(
            brandWorkspaceId(workspaceId),
            beforeWorkspaceId === void 0 ? void 0 : brandWorkspaceId(beforeWorkspaceId)
          );
          return ok(request, { workspaceIds: [...workspaceIds] });
        } catch (error) {
          if (!(error instanceof WorkspaceOrderInvalidError)) throw error;
          return workspaceNotFound(request, error.workspaceId);
        }
      },
      async insertSessionBefore(request) {
        const { payload } = request;
        const workspace = ctx.workspaceRegistry.get(brandWorkspaceId(payload.workspaceId));
        if (workspace === void 0) return workspaceNotFound(request, payload.workspaceId);
        try {
          await workspace.insertSessionBefore(payload.sessionId, payload.beforeSessionId);
        } catch (error) {
          if (!(error instanceof WorkspaceMoveInvalidError)) throw error;
          return err(request, {
            code: "workspace-move-invalid",
            message: error.message,
            details: {
              workspaceId: payload.workspaceId,
              sessionId: payload.sessionId,
              ...payload.beforeSessionId === void 0 ? {} : { beforeSessionId: payload.beforeSessionId }
            }
          });
        }
        return ok(request, { workspace: workspaceView(workspace) });
      },
      async archiveSession(request) {
        const { sessionId } = request.payload;
        try {
          await ctx.workspaceRegistry.archiveSession(sessionId);
        } catch (error) {
          if (!(error instanceof WorkspaceUnknownSessionError)) throw error;
          return err(request, {
            code: "session-not-found",
            message: error.message,
            details: { sessionId }
          });
        }
        return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] });
      }
    },
    host: {
      describe(request) {
        const selection = defaults.defaultModelSelection();
        return Promise.resolve(ok(request, {
          version: "0.0.1",
          // Same source as session.create's fallback: the UI's default project
          // must match where an unspecified-cwd session actually lands.
          cwd: defaults.cwd,
          // Read live for the same reason: this is what the NEXT session will
          // start from, so a saved default has to be what it reports.
          provider: selection.provider,
          model: selection.model,
          attachedSessions: ctx.agents.list().length,
          canOpenPath: canOpenPaths()
        }));
      },
      async pickDirectory(request, signal) {
        const capability = ctx.directoryPicker.capability();
        if (capability.kind !== "native") {
          return err(request, {
            code: "directory-picker-unavailable",
            message: `host.pickDirectory needs the native capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind }
          });
        }
        try {
          const path = await capability.pick(signal);
          return ok(request, { path });
        } catch (error) {
          if (signal.aborted) {
            return err(request, {
              code: "cancelled",
              message: "directory picker was aborted",
              details: {}
            });
          }
          return err(request, {
            code: "internal",
            message: `directory picker failed: ${error instanceof Error ? error.message : String(error)}`,
            details: {}
          });
        }
      },
      async listDirectory(request, signal) {
        const capability = ctx.directoryPicker.capability();
        if (capability.kind !== "browse") {
          return err(request, {
            code: "directory-picker-unavailable",
            message: `host.listDirectory needs the browse capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind }
          });
        }
        try {
          return ok(request, await capability.list(request.payload.path, signal));
        } catch (error) {
          if (signal.aborted) {
            return err(request, { code: "cancelled", message: "directory listing was aborted", details: {} });
          }
          return err(request, directoryError(error));
        }
      },
      async createDirectory(request) {
        const capability = ctx.directoryPicker.capability();
        if (capability.kind !== "browse") {
          return err(request, {
            code: "directory-picker-unavailable",
            message: `host.createDirectory needs the browse capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind }
          });
        }
        try {
          return ok(request, { path: await capability.createDirectory(request.payload.path, request.payload.name) });
        } catch (error) {
          return err(request, directoryError(error));
        }
      },
      async openPath(request, signal) {
        return openPath(request, request.payload.path, signal);
      }
    },
    goals: {
      // Mutations only — the read side is the 'goal' session projection.
      // Every verb resolves the session's agent (agentFor: implicit cold
      // resume, the command.* precedent) and acknowledges with the new CAS
      // ref; the committed goal/change event carries the whole value to every
      // client through the projection frames.
      async create(request) {
        const { objective, maxGoalRounds } = request.payload;
        return mutateGoal(request, (goals, agent) => goals.create(agent, {
          objective,
          ...maxGoalRounds !== void 0 ? { maxGoalRounds } : {}
        }));
      },
      async edit(request) {
        const { ref, objective, maxGoalRounds } = request.payload;
        return mutateGoal(request, (goals, agent) => goals.edit(agent, ref, {
          ...objective !== void 0 ? { objective } : {},
          ...maxGoalRounds !== void 0 ? { maxGoalRounds } : {}
        }));
      },
      async pause(request) {
        return mutateGoal(request, (goals, agent) => goals.pause(agent, request.payload.ref));
      },
      async resume(request) {
        return mutateGoal(request, (goals, agent) => goals.resume(agent, request.payload.ref));
      },
      async complete(request) {
        return mutateGoal(request, (goals, agent) => goals.complete(agent, request.payload.ref));
      },
      async clear(request) {
        const found = await agentFor(request.payload.sessionId);
        if ("error" in found) return err(request, found.error);
        const goals = goalServiceFor(found.agent);
        if ("error" in goals) return err(request, goals.error);
        try {
          goals.clear(found.agent, request.payload.ref);
          return ok(request, { cleared: true });
        } catch (error) {
          return goalError(request, error);
        }
      }
    },
    agentPresets: {
      // A deployment with no roster answers with an empty list rather than an
      // error: composing no presets is a valid deployment, and the browser
      // simply offers no choice.
      async list(request) {
        const presets = ctx.get("agentPresets");
        if (presets === void 0) return ok(request, { presets: [], authorable: false, hasDocument: false });
        const defaultId = presets.defaultId;
        return ok(request, {
          presets: (await presets.list()).map((preset) => ({
            id: preset.id,
            trust: preset.trust,
            isDefault: preset.id === defaultId,
            ...preset.name === void 0 ? {} : { name: preset.name },
            ...preset.description === void 0 ? {} : { description: preset.description },
            ...preset.broken === void 0 ? {} : { broken: preset.broken }
          })),
          authorable: presets.authorable,
          hasDocument: canOpenPaths()
        });
      },
      // Recomposing is limited to a blank session because a started
      // conversation's history was produced under its preset's tools; the
      // agent and the session survive, only the composition is swapped.
      async select(request) {
        const { sessionId, agentPreset } = request.payload;
        const presets = ctx.get("agentPresets");
        if (presets === void 0) {
          return err(request, {
            code: "agent-preset-not-found",
            message: "this deployment composes no agent presets",
            details: { agentPreset, available: [] }
          });
        }
        const found = await agentFor(sessionId);
        if ("error" in found) return err(request, found.error);
        const { agent } = found;
        const swap = async () => {
          if (!sessionBlank(agent.session)) {
            return err(request, {
              code: "agent-preset-locked",
              message: `session "${sessionId}" has already started; its agent preset is fixed`,
              details: { sessionId, agentPreset }
            });
          }
          try {
            const preset = await presets.recompose(agent.ctx, agentPreset);
            agent.session.append("agent-preset/selected", { agentPreset: preset.id });
            return ok(request, { agentPreset: preset.id });
          } catch (error) {
            const refused = presetFailure(request, error);
            if (refused !== void 0) return refused;
            return err(request, {
              code: "internal",
              message: `failed to select agent preset "${agentPreset}": ${String(error)}`,
              details: {}
            });
          }
        };
        const queued = presetSwitches.get(sessionId) ?? Promise.resolve();
        const turn = queued.then(swap);
        presetSwitches.set(sessionId, turn.catch(() => void 0));
        try {
          return await turn;
        } finally {
          if (presetSwitches.get(sessionId) === turn) presetSwitches.delete(sessionId);
        }
      },
      // Authoring is privileged (see PRIVILEGED_METHODS in dsh-client-connection):
      // a composition names the plugins a session runs, so reading one is
      // reconnaissance, and copy/remove/openDocument manage the roster and
      // drive the host desktop.
      async read(request) {
        const { agentPreset } = request.payload;
        const presets = ctx.get("agentPresets");
        if (presets === void 0) return err(request, noRoster(agentPreset));
        try {
          const preset = await presets.resolve(agentPreset);
          return ok(request, {
            agentPreset: preset.id,
            trust: preset.trust,
            content: await presets.read(preset.id),
            ...preset.name === void 0 ? {} : { name: preset.name },
            ...preset.description === void 0 ? {} : { description: preset.description }
          });
        } catch (error) {
          return err(request, presetError(agentPreset, error));
        }
      },
      async copy(request) {
        const { from, agentPreset, name } = request.payload;
        const presets = ctx.get("agentPresets");
        if (presets === void 0) return err(request, noRoster(agentPreset));
        try {
          await presets.copy(from, agentPreset, name);
          return ok(request, { agentPreset });
        } catch (error) {
          return err(request, presetError(agentPreset, error));
        }
      },
      async openDocument(request, signal) {
        const { agentPreset } = request.payload;
        const presets = ctx.get("agentPresets");
        if (presets === void 0) return err(request, noRoster(agentPreset));
        try {
          const preset = await presets.resolve(agentPreset);
          if (preset.trust !== "user") {
            throw new PresetNotWritableError(preset.id, "it ships with the deployment");
          }
          const directory = dirname(preset.path);
          if (!canOpenPaths()) return ok(request, { opened: false, path: directory });
          return await openPath(request, directory, signal);
        } catch (error) {
          return err(request, presetError(agentPreset, error));
        }
      },
      async remove(request) {
        const { agentPreset } = request.payload;
        const presets = ctx.get("agentPresets");
        if (presets === void 0) return err(request, noRoster(agentPreset));
        try {
          await presets.remove(agentPreset);
          return ok(request, {});
        } catch (error) {
          return err(request, presetError(agentPreset, error));
        }
      }
    },
    skills: {
      // Skill lookup never creates or resumes an agent: the session address
      // resolves to a canonical cwd from the host-resident session header, and
      // the view scope is the live agent or the preset's standing key.
      async list(request) {
        const { sessionId } = request.payload;
        const session = ctx.sessions.get(sessionId);
        if (session === void 0) {
          return err(request, {
            code: "session-not-found",
            message: `session "${sessionId}" not found (not attached)`,
            details: { sessionId }
          });
        }
        if (session.header.cwd === void 0) {
          return err(request, { code: "internal", message: `session "${sessionId}" has no project cwd`, details: {} });
        }
        const cwd = session.header.cwd;
        const live = ctx.agents.get(sessionId);
        const presets = ctx.get("agentPresets");
        const scoped = live === void 0 ? void 0 : presets?.serviceFor(live, "skills");
        const skillRegistry = scoped ?? ctx.get("skills");
        if (skillRegistry === void 0) {
          return err(request, { code: "internal", message: "skill registry is absent: neither this session's agent preset nor the host composition mounts @deepseek-ai/dsh-skill", details: {} });
        }
        const scope = await presenterScopeFor(sessionId, session);
        try {
          const skills = (await skillRegistry.list({ cwd, scope })).filter(isUserInvocable);
          return ok(request, {
            skills: skills.map((skill) => ({
              name: skill.name,
              description: skill.description,
              ...skill.whenToUse === void 0 ? {} : { whenToUse: skill.whenToUse },
              modelInvocable: skill.invocation.modelInvocable
            }))
          });
        } catch (error) {
          return err(request, { code: "internal", message: `skill listing failed: ${String(error)}`, details: {} });
        }
      }
    },
    settings: {
      describe(request) {
        const settings = ctx.get("settings");
        if (settings === void 0) return Promise.resolve(err(request, settingsAbsent()));
        return Promise.resolve(ok(request, {
          writable: settings.writable,
          hasDocument: settings.documentPath !== void 0,
          namespaces: settings.describe({ redactSecrets: true }).map(namespaceView)
        }));
      },
      async openDocument(request, signal) {
        const settings = ctx.get("settings");
        if (settings === void 0) return err(request, settingsAbsent());
        if (isAborted(signal)) {
          return err(request, {
            code: "cancelled",
            message: "settings document open was aborted",
            details: {}
          });
        }
        let path;
        try {
          path = await settings.prepareDocument();
        } catch (error) {
          if (isAborted(signal)) {
            return err(request, {
              code: "cancelled",
              message: "settings document preparation was aborted",
              details: {}
            });
          }
          return err(request, {
            code: "internal",
            message: `settings document preparation failed: ${error instanceof Error ? error.message : String(error)}`,
            details: {}
          });
        }
        if (path === void 0) {
          return err(request, {
            code: "internal",
            message: "settings provider has no local document to open",
            details: {}
          });
        }
        if (isAborted(signal)) {
          return err(request, {
            code: "cancelled",
            message: "settings document open was aborted",
            details: {}
          });
        }
        return openTextFile(request, path, signal);
      },
      update: (request) => settingsWrite(request, request.payload.ns, "update", request.payload.patch, request.payload.expectedRevision),
      replace: (request) => settingsWrite(request, request.payload.ns, "replace", request.payload.section, request.payload.expectedRevision),
      mutate: (request) => settingsWrite(request, request.payload.ns, "mutate", request.payload.ops, request.payload.expectedRevision)
    },
    credentials: {
      async describe(request) {
        const credentials = ctx.get("credentials");
        if (credentials === void 0) return err(request, credentialsAbsent());
        const entries = await Promise.all(request.payload.refs.map(async (ref) => {
          const info = await credentials.describe(credentialRef(ref));
          const view = {
            configured: info.configured,
            ...info.source === void 0 ? {} : { source: info.source },
            writable: info.writable
          };
          return [ref, view];
        }));
        return ok(request, { credentials: Object.fromEntries(entries) });
      },
      async set(request) {
        const credentials = ctx.get("credentials");
        if (credentials === void 0) return err(request, credentialsAbsent());
        const { ref, value } = request.payload;
        try {
          await credentials.set(credentialRef(ref), value);
        } catch (error) {
          return err(request, {
            code: "credential-rejected",
            message: error instanceof Error ? error.message : String(error),
            details: { ref }
          });
        }
        return ok(request, {});
      },
      async unset(request) {
        const credentials = ctx.get("credentials");
        if (credentials === void 0) return err(request, credentialsAbsent());
        const { ref } = request.payload;
        try {
          await credentials.unset(credentialRef(ref));
        } catch (error) {
          return err(request, {
            code: "credential-rejected",
            message: error instanceof Error ? error.message : String(error),
            details: { ref }
          });
        }
        return ok(request, {});
      }
    },
    llm: {
      providers(request) {
        const registered = ctx.llm.listProviders();
        const active = new Set(registered.map((provider) => provider.id));
        const directory = ctx.llm.listConfigurableProviders();
        const declared = new Set(directory.map((entry) => entry.provider));
        const views = directory.map((entry) => ({
          provider: entry.provider,
          displayName: entry.displayName,
          settingsNs: entry.settingsNs,
          settingsPath: [...entry.settingsPath],
          active: active.has(entry.provider),
          ...entry.declared === void 0 ? {} : { declared: entry.declared }
        }));
        for (const provider of registered) {
          if (declared.has(provider.id)) continue;
          views.push({
            provider: provider.id,
            displayName: provider.name,
            settingsNs: "",
            settingsPath: [],
            active: true
          });
        }
        return Promise.resolve(ok(request, { providers: views }));
      },
      async models(request) {
        return ok(request, await buildModelCatalog(ctx));
      },
      async discoverModels(request, signal) {
        const { settingsNs, provider, baseURL, api, apiKey } = request.payload;
        try {
          const models = await ctx.llm.discoverModels(settingsNs, {
            ...provider === void 0 ? {} : { provider },
            ...baseURL === void 0 ? {} : { baseURL },
            ...api === void 0 ? {} : { api },
            ...apiKey === void 0 ? {} : { apiKey },
            ...signal === void 0 ? {} : { signal }
          });
          return ok(request, { models });
        } catch (error) {
          return err(request, {
            code: "model-discovery-failed",
            message: error instanceof Error ? error.message : String(error),
            details: { settingsNs, ...baseURL === void 0 ? {} : { baseURL } }
          });
        }
      }
    },
    events: {
      mux(_request, signal) {
        const queue = new FrameQueue();
        muxQueues.add(queue);
        for (const session of ctx.sessions.list()) {
          subscribeSession(queue, session);
        }
        for (const pending of pendingQuestions.values()) {
          queue.push({
            rpcId: pending.rpcId,
            payload: {
              type: "question/requested",
              sessionId: pending.sessionId,
              questions: pending.questions
            }
          });
        }
        for (const pending of pendingApprovals.values()) queue.push(requestedFrame(pending));
        for (const session of ctx.sessions.list()) {
          const agent = ctx.agents.get(session.id);
          if (agent?.session === session && agent.inbox.hasPending) {
            queue.push(frame({ type: "session/queue", sessionId: session.id, items: queueItems(agent) }));
          }
        }
        const jobs = ctx.get("jobs");
        if (jobs !== void 0) {
          for (const session of ctx.sessions.list()) {
            const views = jobViews(jobs.list(ctx.agents.get(session.id)));
            if (views.length > 0) {
              queue.push(frame({ type: "session/jobs", sessionId: session.id, jobs: views }));
            }
          }
        }
        const openCalls = /* @__PURE__ */ new Map();
        const disposers = [
          ctx.on("session/event", (session, event) => {
            if (event.type === "tool/call") {
              const data = event.data;
              try {
                let table = openCalls.get(session.id);
                if (table === void 0) openCalls.set(session.id, table = /* @__PURE__ */ new Map());
                table.set(data.callId, { name: data.name, args: JSON.parse(data.arguments) });
              } catch {
              }
            } else if (event.type === "turn/end") {
              openCalls.delete(session.id);
            }
            const view = viewFor(
              ctx,
              event,
              (callId) => openCalls.get(session.id)?.get(callId) ?? backscanArgs(session.events, callId),
              ctx.agents.get(session.id)
            );
            queue.push(frame({ type: "session/event", sessionId: session.id, event, ...view === void 0 ? {} : { view } }));
          }),
          ctx.on("session/created", (session) => {
            subscribeSession(queue, session);
            const views = jobs === void 0 ? [] : jobViews(jobs.list(ctx.agents.get(session.id)));
            if (views.length > 0) {
              queue.push(frame({ type: "session/jobs", sessionId: session.id, jobs: views }));
            }
          }),
          ctx.on("session/disposed", (session) => {
            openCalls.delete(session.id);
          }),
          ...jobs === void 0 ? [] : [jobs.onJobsChanged((owner) => {
            if (owner !== void 0) {
              queue.push(frame({ type: "session/jobs", sessionId: owner.id, jobs: jobViews(jobs.list(owner)) }));
              return;
            }
            for (const session of ctx.sessions.list()) {
              queue.push(frame({
                type: "session/jobs",
                sessionId: session.id,
                jobs: jobViews(jobs.list(ctx.agents.get(session.id)))
              }));
            }
          })]
        ];
        return queue.iterate(signal, () => {
          muxQueues.delete(queue);
          for (const dispose of disposers) dispose();
        });
      },
      host(_request, signal) {
        const queue = new FrameQueue();
        const committedWorkspaces = ctx.workspaceRegistry.list();
        const committedWorkspaceIds = new Set(
          committedWorkspaces.map((workspace) => String(workspace.id))
        );
        let committedWorkspaceOrder = committedWorkspaces.map((workspace) => workspace.id);
        let archivedSessionIds = ctx.workspaceRegistry.archivedSessionIds;
        const disposers = [
          ctx.on("session/created", (session) => {
            queue.push(frame({
              type: "host/session-added",
              sessionId: session.id,
              // Derived at frame time like summarize(); a just-created session
              // has run no turn yet, so this is constantly true in practice.
              blank: sessionBlank(session),
              // Including cwd lets the client group the new session without refreshing the list.
              ...sessionListFields(session.header, session.events)
            }));
          }),
          ctx.on("session/disposed", (session) => {
            queue.push(frame({ type: "host/session-removed", sessionId: session.id }));
          }),
          ctx.on("agent/status", ({ agent, status }) => {
            queue.push(frame({ type: "host/session-status", sessionId: agent.id, running: status === "running" }));
          }),
          ctx.on("agent/error", ({ agent, error }) => {
            queue.push(frame({ type: "host/agent-error", sessionId: agent.id, message: errorChain(error) }));
          }),
          ctx.on("domain/changed", (change) => {
            if (change.domain !== "workspace") return;
            if (change.table === "") {
              if (change.operation !== "put") return;
              const state = workspaceDomainState.parse(change.value);
              const orderChanged = state.workspaceIds.length === committedWorkspaceOrder.length && state.workspaceIds.every((workspaceId) => committedWorkspaceIds.has(String(workspaceId))) && state.workspaceIds.some((workspaceId, index) => workspaceId !== committedWorkspaceOrder[index]);
              for (const workspaceId of state.workspaceIds) {
                if (committedWorkspaceIds.has(workspaceId)) continue;
                const workspace = ctx.workspaceRegistry.get(workspaceId);
                if (workspace === void 0) {
                  throw new Error(`committed workspace registry references missing workspace "${workspaceId}"`);
                }
                committedWorkspaceIds.add(workspaceId);
                queue.push(frame({ type: "host/workspace-changed", workspace: workspaceView(workspace) }));
              }
              committedWorkspaceOrder = [...state.workspaceIds];
              if (orderChanged) {
                queue.push(frame({
                  type: "host/workspace-order-changed",
                  workspaceIds: [...state.workspaceIds]
                }));
              }
              if (state.archivedSessionIds.length !== archivedSessionIds.length || state.archivedSessionIds.some((id, index) => id !== archivedSessionIds[index])) {
                archivedSessionIds = state.archivedSessionIds;
                queue.push(frame({
                  type: "host/archived-sessions-changed",
                  archivedSessionIds: [...state.archivedSessionIds]
                }));
              }
              return;
            }
            if (change.table !== "workspaces") return;
            if (change.operation === "deleted") {
              if (!committedWorkspaceIds.delete(change.key)) return;
              queue.push(frame({
                type: "host/workspace-removed",
                workspaceId: change.key
              }));
              return;
            }
            if (!committedWorkspaceIds.has(change.key)) return;
            queue.push(frame({
              type: "host/workspace-changed",
              workspace: changedWorkspaceView(change.key, change.value)
            }));
          }),
          // Allowlisted host events ride one verbatim wrapper frame each. The
          // allowlist is api-remotes', and `ctx.remote.$on` is the consumer
          // face; nothing here projects, redacts, or renames.
          ...API_REMOTE_FORWARDED_EVENTS.map((name) => ctx.on(
            name,
            // The allowlist's shape assertion proves each name is a real,
            // non-scoped, void-returning event, so the rest-parameter handler
            // satisfies every member of the union `on` accepts here;
            // assertJsonArgs proves the payload is JSON-safe before it queues.
            (...args) => {
              queue.push(frame({
                type: "host/remote-event",
                event: name,
                args: assertJsonArgs(name, args)
              }));
            }
          ))
        ];
        return queue.iterate(signal, () => {
          for (const dispose of disposers) dispose();
        });
      }
    },
    downloads: {
      async sessionLog(request, signal) {
        const deps = sessionLogExportDeps(ctx);
        if (deps.sessionQuery === void 0 || deps.sessionPersistence === void 0 || deps.attachments === void 0) {
          return new Response(
            "session log export is unavailable: missing session-query, session-persistence, or attachments service",
            { status: 500 }
          );
        }
        if (!deps.sessionPersistence.supportsRawArtifacts) {
          return new Response(
            "session log export is unavailable: the persistence backend does not expose per-session raw artifacts",
            { status: 501 }
          );
        }
        const ready = {
          sessionQuery: deps.sessionQuery,
          sessionPersistence: deps.sessionPersistence,
          attachments: deps.attachments,
          sessions: deps.sessions
        };
        let root;
        try {
          await flushLiveSessionLog(deps, request.sessionId, signal);
          root = await deps.sessionPersistence.readRaw(request.sessionId, signal);
          signal.throwIfAborted();
        } catch {
          signal.throwIfAborted();
          return new Response("session log export failed to prepare the stored artifact", { status: 500 });
        }
        if (root === void 0) {
          return new Response("session not found", { status: 404 });
        }
        return new Response(
          streamSessionLogZip(
            ready,
            root,
            request.sessionId,
            request.includeDescendants === true,
            sessionExportCompressionLevel,
            signal
          ),
          {
            headers: {
              "content-type": "application/zip",
              "content-disposition": `attachment; filename="${sessionLogZipFilename(request.sessionId)}"`
            }
          }
        );
      }
    },
    respond(message) {
      const approval = pendingApprovals.get(message.rpcId);
      if (approval !== void 0) {
        if (!message.result.ok) return Promise.resolve({ accepted: false, reason: "bad-response" });
        const parsed2 = approvalResponsePayloadSchema.safeParse(message.result.value);
        if (!parsed2.success || parsed2.data.approvalId !== approval.approvalId || parsed2.data.sessionId !== approval.sessionId) {
          return Promise.resolve({ accepted: false, reason: "bad-response" });
        }
        approval.resolve(parsed2.data.outcome);
        return Promise.resolve({ accepted: true });
      }
      const pending = pendingQuestions.get(message.rpcId);
      if (pending === void 0) return Promise.resolve({ accepted: false, reason: "not-pending" });
      if (!message.result.ok) {
        if (message.result.error.code !== "cancelled") {
          return Promise.resolve({ accepted: false, reason: "bad-response" });
        }
        claimQuestion(pending, "cancelled");
        pending.reject(new UserQuestionError(
          "the user cancelled ask_user_question",
          "ASK_CANCELLED"
        ));
        return Promise.resolve({ accepted: true });
      }
      const parsed = questionResponsePayloadSchema.safeParse(message.result.value);
      if (!parsed.success) {
        return Promise.resolve({ accepted: false, reason: "bad-response" });
      }
      const payload = {
        sessionId: parsed.data.sessionId,
        answer: {
          answers: parsed.data.answer.answers.map((answer) => ({
            id: answer.id,
            selected: answer.selected,
            ...answer.custom === void 0 ? {} : { custom: answer.custom }
          }))
        }
      };
      if (!matchesQuestions(payload, pending)) {
        return Promise.resolve({ accepted: false, reason: "bad-response" });
      }
      claimQuestion(pending, "answered");
      pending.resolve(payload.answer);
      return Promise.resolve({ accepted: true });
    }
  };
}

// vendor/harness/packages/host/apiproxy/src/fetch/handler.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// vendor/harness/packages/host/apiproxy/src/api/downloads.schema.ts
import { z as z4 } from "zod";
var sessionLogQuerySchema = z4.object({
  sessionId: sessionIdSchema,
  includeDescendants: z4.union([z4.literal("true"), z4.literal("false")]).optional()
}).transform((query) => ({
  sessionId: query.sessionId,
  ...query.includeDescendants === "true" ? { includeDescendants: true } : {}
}));

// vendor/harness/packages/host/apiproxy/src/api/rpc.schema.ts
import { z as z5 } from "zod";
var rpcIdSchema = z5.string();
var rpcErrorSchema = z5.discriminatedUnion("code", [
  z5.object({ code: z5.literal("bad-request"), message: z5.string(), details: z5.object({ issues: z5.array(z5.custom()) }) }),
  z5.object({ code: z5.literal("cancelled"), message: z5.string(), details: z5.object({}) }),
  z5.object({ code: z5.literal("session-not-found"), message: z5.string(), details: z5.object({ sessionId: z5.string() }) }),
  z5.object({ code: z5.literal("model-unavailable"), message: z5.string(), details: z5.object({ provider: z5.string(), model: z5.string() }) }),
  z5.object({ code: z5.literal("session-conflict"), message: z5.string(), details: z5.object({ sessionId: z5.string(), requestedCwd: z5.string(), existingCwd: z5.string().optional() }) }),
  z5.object({ code: z5.literal("invalid-time-zone"), message: z5.string(), details: z5.object({ value: z5.string() }) }),
  z5.object({ code: z5.literal("workspace-attach-failed"), message: z5.string(), details: z5.object({ sessionId: z5.string(), workspaceId: z5.string() }) }),
  z5.object({ code: z5.literal("workspace-not-found"), message: z5.string(), details: z5.object({ workspaceId: z5.string() }) }),
  z5.object({ code: z5.literal("workspace-invalid-path"), message: z5.string(), details: z5.object({ path: z5.string() }) }),
  z5.object({ code: z5.literal("workspace-name-conflict"), message: z5.string(), details: z5.object({ name: z5.string() }) }),
  z5.object({ code: z5.literal("workspace-move-invalid"), message: z5.string(), details: z5.object({ workspaceId: z5.string(), sessionId: z5.string(), beforeSessionId: z5.string().optional() }) }),
  z5.object({ code: z5.literal("directory-unreadable"), message: z5.string(), details: z5.object({ path: z5.string() }) }),
  z5.object({ code: z5.literal("directory-exists"), message: z5.string(), details: z5.object({ path: z5.string() }) }),
  z5.object({ code: z5.literal("directory-create-failed"), message: z5.string(), details: z5.object({ path: z5.string() }) }),
  z5.object({ code: z5.literal("directory-picker-unavailable"), message: z5.string(), details: z5.object({ capability: z5.string() }) }),
  z5.object({ code: z5.literal("agent-preset-read-only"), message: z5.string(), details: z5.object({ agentPreset: z5.string(), reason: z5.string() }) }),
  z5.object({ code: z5.literal("agent-preset-locked"), message: z5.string(), details: z5.object({ sessionId: z5.string(), agentPreset: z5.string() }) }),
  z5.object({ code: z5.literal("agent-preset-conflict"), message: z5.string(), details: z5.object({ sessionId: z5.string(), requestedPreset: z5.string(), existingPreset: z5.string().optional() }) }),
  z5.object({ code: z5.literal("agent-preset-not-found"), message: z5.string(), details: z5.object({ agentPreset: z5.string(), available: z5.array(z5.string()) }) }),
  z5.object({ code: z5.literal("agent-preset-invalid"), message: z5.string(), details: z5.object({ agentPreset: z5.string(), reason: z5.string() }) }),
  z5.object({ code: z5.literal("agent-busy"), message: z5.string(), details: z5.object({ reason: z5.string() }) }),
  z5.object({ code: z5.literal("attachment-error"), message: z5.string(), details: z5.object({ reason: z5.string() }) }),
  z5.object({ code: z5.literal("queue-item-not-found"), message: z5.string(), details: z5.object({ itemId: z5.string() }) }),
  z5.object({ code: z5.literal("steer-unavailable"), message: z5.string(), details: z5.object({ itemId: z5.string() }) }),
  z5.object({ code: z5.literal("command-error"), message: z5.string(), details: z5.object({}) }),
  z5.object({ code: z5.literal("unknown-command"), message: z5.string(), details: z5.object({}) }),
  z5.object({ code: z5.literal("settings-rejected"), message: z5.string(), details: z5.object({ ns: z5.string() }) }),
  z5.object({ code: z5.literal("settings-conflict"), message: z5.string(), details: z5.object({ ns: z5.string(), expected: z5.number(), actual: z5.number() }) }),
  z5.object({ code: z5.literal("credential-rejected"), message: z5.string(), details: z5.object({ ref: z5.string() }) }),
  z5.object({ code: z5.literal("model-discovery-failed"), message: z5.string(), details: z5.object({ settingsNs: z5.string(), baseURL: z5.string().optional() }) }),
  z5.object({ code: z5.literal("title-invalid"), message: z5.string(), details: z5.object({ sessionId: z5.string() }) }),
  z5.object({ code: z5.literal("fork-unavailable"), message: z5.string(), details: z5.object({ sessionId: z5.string() }) }),
  z5.object({ code: z5.literal("subagent-parent-unavailable"), message: z5.string(), details: z5.object({ parentSessionId: z5.string() }) }),
  z5.object({ code: z5.literal("subagent-not-found"), message: z5.string(), details: z5.object({ parentSessionId: z5.string(), childSessionId: z5.string() }) }),
  z5.object({ code: z5.literal("subagent-catalog-diagnostic"), message: z5.string(), details: z5.object({
    parentSessionId: z5.string(),
    childSessionId: z5.string(),
    reason: z5.union([z5.literal("corrupt"), z5.literal("unsupported"), z5.literal("unavailable")])
  }) }),
  z5.object({ code: z5.literal("subagent-not-resumable"), message: z5.string(), details: z5.object({ childSessionId: z5.string() }) }),
  z5.object({ code: z5.literal("subagent-unauthorized"), message: z5.string(), details: z5.object({ childSessionId: z5.string() }) }),
  z5.object({ code: z5.literal("subagent-delivery-unavailable"), message: z5.string(), details: z5.object({ childSessionId: z5.string() }) }),
  z5.object({ code: z5.literal("internal"), message: z5.string(), details: z5.object({}) })
]);
function rpcResultSchema(value) {
  return z5.union([
    z5.object({ ok: z5.literal(true), value }),
    z5.object({ ok: z5.literal(false), error: rpcErrorSchema })
  ]);
}
var clientRequestSchema = z5.object({
  type: z5.literal("client-request"),
  rpcId: rpcIdSchema,
  method: z5.string(),
  payload: z5.unknown()
});
var serverResponseSchema = z5.object({
  type: z5.literal("server-response"),
  rpcId: rpcIdSchema,
  result: rpcResultSchema(z5.unknown().optional())
});
var serverRequestSchema = z5.object({
  type: z5.literal("server-request"),
  rpcId: rpcIdSchema,
  method: z5.string(),
  payload: z5.unknown()
});
var clientResponseSchema = z5.object({
  type: z5.literal("client-response"),
  rpcId: rpcIdSchema,
  result: rpcResultSchema(z5.unknown().optional())
});
var rpcMessageSchema = z5.discriminatedUnion("type", [
  clientRequestSchema,
  serverResponseSchema,
  serverRequestSchema,
  clientResponseSchema
]);
var rpcReceiptSchema = z5.union([
  z5.object({ accepted: z5.literal(true) }),
  z5.object({ accepted: z5.literal(false), reason: z5.union([z5.literal("not-pending"), z5.literal("bad-response")]) })
]);

// vendor/harness/packages/host/apiproxy/src/api/host.schema.ts
import { z as z6 } from "zod";
var hostDescribeRequestSchema = z6.object({});
var hostDescribeValueSchema = z6.object({
  version: z6.string(),
  cwd: z6.string(),
  provider: z6.string().optional(),
  model: z6.string().optional(),
  attachedSessions: z6.number().int().nonnegative(),
  canOpenPath: z6.boolean()
});
var hostPickDirectoryRequestSchema = z6.object({});
var hostPickDirectoryValueSchema = z6.object({
  path: z6.string().nullable()
});
var directoryEntrySchema = z6.object({
  name: z6.string(),
  path: z6.string(),
  hidden: z6.boolean()
});
var hostListDirectoryRequestSchema = z6.object({
  path: z6.string().optional()
});
var hostListDirectoryValueSchema = z6.object({
  path: z6.string(),
  home: z6.string(),
  crumbs: z6.array(directoryEntrySchema),
  entries: z6.array(directoryEntrySchema),
  truncated: z6.boolean()
});
var hostCreateDirectoryRequestSchema = z6.object({
  path: z6.string(),
  name: z6.string()
}).refine(
  (payload) => payload.name.trim() !== "" && payload.name !== "." && payload.name !== ".." && !/[/\\]/.test(payload.name),
  { message: "host.createDirectory requires a single non-blank path segment name" }
);
var hostCreateDirectoryValueSchema = z6.object({
  path: z6.string()
});
var hostOpenPathRequestSchema = z6.object({
  path: z6.string().min(1)
});
var hostOpenPathValueSchema = z6.object({
  opened: z6.literal(true)
});

// vendor/harness/packages/host/apiproxy/src/api/workspace.schema.ts
import { z as z7 } from "zod";
var workspaceViewSchema = z7.object({
  workspaceId: workspaceIdSchema,
  path: z7.string(),
  title: z7.string(),
  sessionIds: z7.array(sessionIdSchema),
  createdAt: z7.string(),
  updatedAt: z7.string()
});
var workspaceListRequestSchema = z7.object({});
var workspaceListValueSchema = z7.object({
  items: z7.array(workspaceViewSchema),
  archivedSessionIds: z7.array(sessionIdSchema)
});
var workspaceCreateRequestSchema = z7.object({
  path: z7.string()
});
var workspaceCreateValueSchema = z7.object({
  workspace: workspaceViewSchema,
  created: z7.boolean()
});
var workspaceRenameRequestSchema = z7.object({
  workspaceId: workspaceIdSchema,
  title: z7.string()
}).refine(
  (payload) => payload.title.trim() !== "",
  { message: "workspace.rename requires a non-blank title" }
);
var workspaceRenameValueSchema = z7.object({
  workspace: workspaceViewSchema
});
var workspaceDeleteRequestSchema = z7.object({
  workspaceId: workspaceIdSchema
});
var workspaceDeleteValueSchema = z7.object({
  deleted: z7.literal(true)
});
var workspaceInsertBeforeRequestSchema = z7.object({
  workspaceId: workspaceIdSchema,
  beforeWorkspaceId: workspaceIdSchema.optional()
});
var workspaceInsertBeforeValueSchema = z7.object({
  workspaceIds: z7.array(workspaceIdSchema)
});
var workspaceInsertSessionBeforeRequestSchema = z7.object({
  workspaceId: workspaceIdSchema,
  sessionId: sessionIdSchema,
  beforeSessionId: sessionIdSchema.optional()
});
var workspaceInsertSessionBeforeValueSchema = z7.object({
  workspace: workspaceViewSchema
});
var workspaceArchiveSessionRequestSchema = z7.object({
  sessionId: sessionIdSchema
});
var workspaceArchiveSessionValueSchema = z7.object({
  archivedSessionIds: z7.array(sessionIdSchema)
});

// vendor/harness/packages/host/apiproxy/src/api/skills.schema.ts
import { z as z8 } from "zod";
var skillEntrySchema = z8.object({
  name: z8.string().min(1),
  description: z8.string(),
  whenToUse: z8.string().optional(),
  modelInvocable: z8.boolean()
});
var skillListRequestSchema = z8.object({
  sessionId: sessionIdSchema
});
var skillListValueSchema = z8.object({
  skills: z8.array(skillEntrySchema)
});

// vendor/harness/packages/host/apiproxy/src/api/agent-presets.schema.ts
import { z as z9 } from "zod";
var agentPresetEntrySchema = z9.object({
  id: z9.string().min(1),
  trust: z9.union([z9.literal("system"), z9.literal("user")]),
  isDefault: z9.boolean(),
  name: z9.string().optional(),
  description: z9.string().optional(),
  broken: z9.string().min(1).optional()
});
var agentPresetListRequestSchema = z9.object({});
var agentPresetListValueSchema = z9.object({
  presets: z9.array(agentPresetEntrySchema),
  authorable: z9.boolean(),
  hasDocument: z9.boolean()
});
var agentPresetSelectRequestSchema = z9.object({
  sessionId: sessionIdSchema,
  agentPreset: z9.string().min(1)
});
var agentPresetSelectValueSchema = z9.object({
  agentPreset: z9.string()
});
var agentPresetReadRequestSchema = z9.object({
  agentPreset: z9.string().min(1)
});
var agentPresetReadValueSchema = z9.object({
  agentPreset: z9.string(),
  trust: z9.union([z9.literal("system"), z9.literal("user")]),
  content: z9.string(),
  name: z9.string().optional(),
  description: z9.string().optional()
});
var agentPresetCopyRequestSchema = z9.object({
  from: z9.string().min(1),
  agentPreset: z9.string().min(1),
  name: z9.string().optional()
});
var agentPresetCopyValueSchema = z9.object({
  agentPreset: z9.string()
});
var agentPresetOpenDocumentRequestSchema = z9.object({
  agentPreset: z9.string().min(1)
});
var agentPresetOpenDocumentValueSchema = z9.union([
  z9.object({ opened: z9.literal(true) }),
  z9.object({ opened: z9.literal(false), path: z9.string() })
]);
var agentPresetRemoveRequestSchema = z9.object({
  agentPreset: z9.string().min(1)
});
var agentPresetRemoveValueSchema = z9.object({});

// vendor/harness/packages/host/apiproxy/src/api/goals.schema.ts
import { z as z10 } from "zod";
var goalRefSchema = z10.object({
  id: z10.string(),
  revision: z10.number().int().positive()
});
var goalRefValueSchema = z10.object({ ref: goalRefSchema });
var goalCreateRequestSchema = z10.object({
  sessionId: z10.string(),
  objective: z10.string().min(1),
  maxGoalRounds: z10.number().int().positive().optional()
});
var goalCreateValueSchema = goalRefValueSchema;
var goalEditRequestSchema = z10.object({
  sessionId: z10.string(),
  ref: goalRefSchema,
  objective: z10.string().min(1).optional(),
  maxGoalRounds: z10.number().int().positive().optional()
}).refine((value) => value.objective !== void 0 || value.maxGoalRounds !== void 0, {
  message: "goal.edit requires objective or maxGoalRounds"
});
var goalEditValueSchema = goalRefValueSchema;
var goalPauseRequestSchema = z10.object({
  sessionId: z10.string(),
  ref: goalRefSchema
});
var goalPauseValueSchema = goalRefValueSchema;
var goalResumeRequestSchema = z10.object({
  sessionId: z10.string(),
  ref: goalRefSchema
});
var goalResumeValueSchema = goalRefValueSchema;
var goalCompleteRequestSchema = z10.object({
  sessionId: z10.string(),
  ref: goalRefSchema
});
var goalCompleteValueSchema = goalRefValueSchema;
var goalClearRequestSchema = z10.object({
  sessionId: z10.string(),
  ref: goalRefSchema
});
var goalClearValueSchema = z10.object({
  cleared: z10.literal(true)
});

// vendor/harness/packages/host/apiproxy/src/api/settings.schema.ts
import { z as z11 } from "zod";
var settingsSecretViewSchema = z11.object({
  path: z11.array(z11.string()),
  set: z11.boolean()
});
var settingsNamespaceViewSchema = z11.object({
  ns: z11.string().min(1),
  schema: z11.unknown(),
  value: z11.unknown(),
  base: z11.unknown().optional(),
  user: z11.unknown().optional(),
  applies: z11.union([z11.literal("live"), z11.literal("restart")]),
  secrets: z11.array(settingsSecretViewSchema),
  revision: z11.number()
});
var settingsDescribeRequestSchema = z11.object({});
var settingsDescribeValueSchema = z11.object({
  writable: z11.boolean(),
  hasDocument: z11.boolean(),
  namespaces: z11.array(settingsNamespaceViewSchema)
});
var settingsOpenDocumentRequestSchema = z11.object({});
var settingsOpenDocumentValueSchema = z11.object({
  opened: z11.literal(true)
});
var settingsUpdateRequestSchema = z11.object({
  ns: z11.string().min(1),
  patch: z11.record(z11.string(), z11.unknown()),
  expectedRevision: z11.number().optional()
});
var settingsUpdateValueSchema = settingsNamespaceViewSchema;
var settingsReplaceRequestSchema = z11.object({
  ns: z11.string().min(1),
  section: z11.record(z11.string(), z11.unknown()),
  expectedRevision: z11.number().optional()
});
var settingsPathOpSchema = z11.discriminatedUnion("op", [
  z11.object({ op: z11.literal("set"), path: z11.array(z11.string()), value: z11.unknown() }),
  z11.object({ op: z11.literal("unset"), path: z11.array(z11.string()) })
]);
var settingsMutateRequestSchema = z11.object({
  ns: z11.string().min(1),
  ops: z11.array(settingsPathOpSchema),
  expectedRevision: z11.number().optional()
});
var settingsMutateValueSchema = settingsNamespaceViewSchema;
var settingsReplaceValueSchema = settingsNamespaceViewSchema;

// vendor/harness/packages/host/apiproxy/src/api/credentials.schema.ts
import { z as z12 } from "zod";
var credentialRefNameSchema = z12.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
var credentialViewSchema = z12.object({
  configured: z12.boolean(),
  source: z12.string().optional(),
  writable: z12.boolean()
});
var credentialsDescribeRequestSchema = z12.object({
  refs: z12.array(credentialRefNameSchema).max(64)
});
var credentialsDescribeValueSchema = z12.object({
  credentials: z12.record(z12.string(), credentialViewSchema)
});
var credentialsSetRequestSchema = z12.object({
  ref: credentialRefNameSchema,
  value: z12.string().min(1)
});
var credentialsSetValueSchema = z12.object({});
var credentialsUnsetRequestSchema = z12.object({
  ref: credentialRefNameSchema
});
var credentialsUnsetValueSchema = z12.object({});

// vendor/harness/packages/host/apiproxy/src/api/llm.schema.ts
import { z as z13 } from "zod";
var configurableProviderViewSchema = z13.object({
  provider: z13.string().min(1),
  displayName: z13.string().min(1),
  settingsNs: z13.string(),
  settingsPath: z13.array(z13.string()),
  active: z13.boolean(),
  declared: z13.boolean().optional()
});
var llmProvidersRequestSchema = z13.object({});
var llmProvidersValueSchema = z13.object({
  providers: z13.array(configurableProviderViewSchema)
});
var llmModelsRequestSchema = z13.object({});
var llmModelsValueSchema = z13.object({
  groups: z13.array(modelProviderGroupSchema),
  failures: z13.array(modelCatalogFailureSchema)
});
var discoveredModelViewSchema = z13.object({
  id: z13.string().min(1),
  name: z13.string().min(1).optional(),
  contextWindow: z13.number().int().positive().optional(),
  maxTokens: z13.number().int().positive().optional()
});
var llmDiscoverModelsRequestSchema = z13.object({
  settingsNs: z13.string().min(1),
  provider: z13.string().min(1).optional(),
  baseURL: z13.string().min(1).optional(),
  api: z13.string().min(1).optional(),
  // Write-only at the host: used for this one interrogation, never stored and
  // never returned. It does ride the client's outgoing envelope like every
  // other secret-bearing payload (`credentials.set`, `settings.update`), which
  // `subscribeEnvelopes()` observers can see — redacting that tap is a
  // configuration-plane-wide change, not this method's to make alone.
  apiKey: z13.string().min(1).optional()
});
var llmDiscoverModelsValueSchema = z13.object({
  models: z13.array(discoveredModelViewSchema)
});

// vendor/harness/packages/host/apiproxy/src/api/subagents.schema.ts
import { z as z14 } from "zod";
var subagentListEntrySchema = z14.union([
  z14.object({
    kind: z14.literal("child"),
    id: sessionIdSchema,
    mode: z14.literal("one-shot"),
    activity: z14.union([z14.literal("running"), z14.literal("inactive")]),
    hasChildren: z14.boolean(),
    label: z14.string().optional()
  }),
  z14.object({
    kind: z14.literal("child"),
    id: sessionIdSchema,
    mode: z14.literal("continuable"),
    activity: z14.union([z14.literal("running"), z14.literal("inactive")]),
    hasChildren: z14.boolean(),
    label: z14.string()
  }),
  z14.object({
    kind: z14.literal("diagnostic"),
    id: sessionIdSchema,
    reason: z14.union([z14.literal("corrupt"), z14.literal("unsupported"), z14.literal("unavailable")])
  })
]);
var subagentListRequestSchema = z14.object({
  parentSessionId: sessionIdSchema
});
var subagentListValueSchema = z14.object({
  entries: z14.array(subagentListEntrySchema),
  parentAvailable: z14.boolean()
});
var subagentHistoryRequestSchema = z14.object({
  parentSessionId: sessionIdSchema,
  childSessionId: sessionIdSchema,
  mode: z14.union([z14.literal("one-shot"), z14.literal("continuable")]),
  beforeSeq: z14.number().int().nonnegative().optional(),
  maxMessages: z14.number().int().positive().optional()
});
var subagentHistoryValueSchema = z14.object({
  events: z14.array(historyEntrySchema),
  hasMore: z14.boolean(),
  projections: sessionProjectionsBlockSchema.optional()
});
var subagentPromptRequestSchema = z14.object({
  parentSessionId: sessionIdSchema,
  childSessionId: sessionIdSchema,
  mode: z14.literal("continuable"),
  content: z14.array(contentBlockSchema),
  clientTimeZone: z14.string().optional()
});
var subagentInterruptRequestSchema = z14.object({
  parentSessionId: sessionIdSchema,
  childSessionId: sessionIdSchema,
  mode: z14.literal("continuable")
});
var subagentInterruptValueSchema = z14.object({
  accepted: z14.literal(true)
});
var messageIdSchema2 = z14.string();
var subagentPromptValueSchema = z14.object({
  messageId: messageIdSchema2
});

// vendor/harness/packages/host/apiproxy/src/fetch/handler.ts
var UNARY_ROUTES = {
  "session.list": { schema: sessionListRequestSchema, invoke: (api, r) => api.sessions.list(r) },
  "session.search": { schema: sessionSearchRequestSchema, invoke: (api, r, signal) => api.sessions.search(r, signal) },
  "session.create": { schema: sessionCreateRequestSchema, invoke: (api, r) => api.sessions.create(r) },
  "session.history": { schema: sessionHistoryRequestSchema, invoke: (api, r) => api.sessions.history(r) },
  "session.models": { schema: sessionModelsRequestSchema, invoke: (api, r) => api.sessions.models(r) },
  "session.selectModel": { schema: sessionSelectModelRequestSchema, invoke: (api, r) => api.sessions.selectModel(r) },
  "session.rename": { schema: sessionRenameRequestSchema, invoke: (api, r) => api.sessions.rename(r) },
  "session.fork": { schema: sessionForkRequestSchema, invoke: (api, r) => api.sessions.fork(r) },
  "session.prompt": { schema: sessionPromptRequestSchema, invoke: (api, r) => api.sessions.prompt(r) },
  "session.attachment": { schema: sessionAttachmentRequestSchema, invoke: (api, r) => api.sessions.attachment(r) },
  "session.updateQueue": { schema: sessionUpdateQueueRequestSchema, invoke: (api, r) => api.sessions.updateQueue(r) },
  "session.cancel": { schema: sessionCancelRequestSchema, invoke: (api, r) => api.sessions.cancel(r) },
  "subagent.list": { schema: subagentListRequestSchema, invoke: (api, r, signal) => api.subagents.list(r, signal) },
  "subagent.history": { schema: subagentHistoryRequestSchema, invoke: (api, r, signal) => api.subagents.history(r, signal) },
  "subagent.prompt": { schema: subagentPromptRequestSchema, invoke: (api, r, signal) => api.subagents.prompt(r, signal) },
  "subagent.interrupt": { schema: subagentInterruptRequestSchema, invoke: (api, r) => api.subagents.interrupt(r) },
  "host.describe": { schema: hostDescribeRequestSchema, invoke: (api, r) => api.host.describe(r) },
  "host.pickDirectory": { schema: hostPickDirectoryRequestSchema, invoke: (api, r, signal) => api.host.pickDirectory(r, signal) },
  "host.listDirectory": { schema: hostListDirectoryRequestSchema, invoke: (api, r, signal) => api.host.listDirectory(r, signal) },
  "host.createDirectory": { schema: hostCreateDirectoryRequestSchema, invoke: (api, r) => api.host.createDirectory(r) },
  "host.openPath": { schema: hostOpenPathRequestSchema, invoke: (api, r, signal) => api.host.openPath(r, signal) },
  "workspace.list": { schema: workspaceListRequestSchema, invoke: (api, r) => api.workspace.list(r) },
  "workspace.create": { schema: workspaceCreateRequestSchema, invoke: (api, r) => api.workspace.create(r) },
  "workspace.rename": { schema: workspaceRenameRequestSchema, invoke: (api, r) => api.workspace.rename(r) },
  "workspace.delete": { schema: workspaceDeleteRequestSchema, invoke: (api, r) => api.workspace.delete(r) },
  "workspace.insertBefore": { schema: workspaceInsertBeforeRequestSchema, invoke: (api, r) => api.workspace.insertBefore(r) },
  "workspace.insertSessionBefore": { schema: workspaceInsertSessionBeforeRequestSchema, invoke: (api, r) => api.workspace.insertSessionBefore(r) },
  "workspace.archiveSession": { schema: workspaceArchiveSessionRequestSchema, invoke: (api, r) => api.workspace.archiveSession(r) },
  "skill.list": { schema: skillListRequestSchema, invoke: (api, r) => api.skills.list(r) },
  "agentPreset.list": { schema: agentPresetListRequestSchema, invoke: (api, r) => api.agentPresets.list(r) },
  "agentPreset.select": { schema: agentPresetSelectRequestSchema, invoke: (api, r) => api.agentPresets.select(r) },
  "agentPreset.read": { schema: agentPresetReadRequestSchema, invoke: (api, r) => api.agentPresets.read(r) },
  "agentPreset.copy": { schema: agentPresetCopyRequestSchema, invoke: (api, r) => api.agentPresets.copy(r) },
  "agentPreset.openDocument": { schema: agentPresetOpenDocumentRequestSchema, invoke: (api, r, signal) => api.agentPresets.openDocument(r, signal) },
  "agentPreset.remove": { schema: agentPresetRemoveRequestSchema, invoke: (api, r) => api.agentPresets.remove(r) },
  "goal.create": { schema: goalCreateRequestSchema, invoke: (api, r) => api.goals.create(r) },
  "goal.edit": { schema: goalEditRequestSchema, invoke: (api, r) => api.goals.edit(r) },
  "goal.pause": { schema: goalPauseRequestSchema, invoke: (api, r) => api.goals.pause(r) },
  "goal.resume": { schema: goalResumeRequestSchema, invoke: (api, r) => api.goals.resume(r) },
  "goal.complete": { schema: goalCompleteRequestSchema, invoke: (api, r) => api.goals.complete(r) },
  "goal.clear": { schema: goalClearRequestSchema, invoke: (api, r) => api.goals.clear(r) },
  "settings.describe": { schema: settingsDescribeRequestSchema, invoke: (api, r) => api.settings.describe(r) },
  "settings.openDocument": { schema: settingsOpenDocumentRequestSchema, invoke: (api, r, signal) => api.settings.openDocument(r, signal) },
  "settings.update": { schema: settingsUpdateRequestSchema, invoke: (api, r) => api.settings.update(r) },
  "settings.replace": { schema: settingsReplaceRequestSchema, invoke: (api, r) => api.settings.replace(r) },
  "settings.mutate": { schema: settingsMutateRequestSchema, invoke: (api, r) => api.settings.mutate(r) },
  "credentials.describe": { schema: credentialsDescribeRequestSchema, invoke: (api, r) => api.credentials.describe(r) },
  "credentials.set": { schema: credentialsSetRequestSchema, invoke: (api, r) => api.credentials.set(r) },
  "credentials.unset": { schema: credentialsUnsetRequestSchema, invoke: (api, r) => api.credentials.unset(r) },
  "llm.providers": { schema: llmProvidersRequestSchema, invoke: (api, r) => api.llm.providers(r) },
  "llm.models": { schema: llmModelsRequestSchema, invoke: (api, r) => api.llm.models(r) },
  "llm.discoverModels": { schema: llmDiscoverModelsRequestSchema, invoke: (api, r, signal) => api.llm.discoverModels(r, signal) }
};
function methodFor(path) {
  return Object.hasOwn(UNARY_ROUTES, path) ? path : void 0;
}
var INVALID_REQUEST_RPC_ID = RpcId("invalid-request");
function errorResponse(rpcId, error) {
  const body = { type: "server-response", rpcId, result: { ok: false, error } };
  return Response.json(body);
}
function fullResponse(narrow) {
  const body = { type: "server-response", rpcId: narrow.rpcId, result: narrow.result };
  return Response.json(body);
}
async function handleUnary(api, method, message, signal) {
  const route = UNARY_ROUTES[method];
  const payload = route.schema.safeParse(message.payload);
  if (!payload.success) {
    return errorResponse(message.rpcId, { code: "bad-request", message: `invalid payload for ${method}`, details: { issues: payload.error.issues } });
  }
  try {
    return fullResponse(await route.invoke(api, { rpcId: message.rpcId, payload: payload.data }, signal));
  } catch (error) {
    return new Response(`handler failure: ${String(error)}`, { status: 500 });
  }
}
function fullFrame(narrow) {
  return { type: "server-request", rpcId: narrow.rpcId, method: narrow.payload.type, payload: narrow.payload };
}
function sseResponse(frames) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(": connected\n\n"));
        for await (const narrow of frames) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame(narrow))}

`));
        }
      } catch (error) {
        const failure = { type: "stream/error", error: { code: "internal", message: String(error), details: {} } };
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame({ rpcId: RpcId(randomUUID2()), payload: failure }))}

`));
        } catch {
        }
      } finally {
        try {
          controller.close();
        } catch {
        }
      }
    }
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }
  });
}
function toFetchHandler(api) {
  return {
    // Signature matches global fetch: the isomorphic point hands this function to InProcessApiClient as its transport aspect,
    // Clients call in (url, init) form — normalize to Request before handling.
    async fetch(input, init) {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === "/api/events.mux" && req.method === "GET") {
        return sseResponse(api.events.mux({ rpcId: RpcId(randomUUID2()), payload: {} }, req.signal));
      }
      if (path === "/api/events.host" && req.method === "GET") {
        return sseResponse(api.events.host({ rpcId: RpcId(randomUUID2()), payload: {} }, req.signal));
      }
      if (path === "/api/session.export" && (req.method === "GET" || req.method === "HEAD")) {
        const parsed = sessionLogQuerySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) {
          return new Response("missing or invalid sessionId query parameter", { status: 400 });
        }
        const response = await api.downloads.sessionLog(parsed.data, req.signal);
        if (req.method === "GET") return response;
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: response.headers });
      }
      if (req.method !== "POST" || !path.startsWith("/api/")) {
        return new Response("not found", { status: 404 });
      }
      const mediaType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType !== "application/json") {
        return new Response("content type must be application/json", { status: 415 });
      }
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response("body is not JSON", { status: 400 });
      }
      if (path === "/api/respond") {
        const parsed = clientResponseSchema.safeParse(body);
        if (!parsed.success) return Response.json({ accepted: false, reason: "bad-response" });
        return Response.json(await api.respond(parsed.data));
      }
      const method = methodFor(path.slice("/api/".length));
      if (method === void 0) return new Response("not found", { status: 404 });
      const envelope = clientRequestSchema.safeParse(body);
      if (!envelope.success) {
        const rawId = body?.rpcId;
        const rpcId = typeof rawId === "string" ? RpcId(rawId) : INVALID_REQUEST_RPC_ID;
        return errorResponse(rpcId, { code: "bad-request", message: "invalid client-request message", details: { issues: envelope.error.issues } });
      }
      const message = envelope.data;
      if (message.method !== method) {
        return errorResponse(message.rpcId, { code: "bad-request", message: `method "${message.method}" does not match path "${method}"`, details: { issues: [] } });
      }
      return handleUnary(api, method, message, req.signal);
    }
  };
}

// vendor/harness/packages/host/apiproxy/src/api/events.schema.ts
import { z as z16 } from "zod";

// vendor/harness/packages/host/apiproxy/src/api/jobs.schema.ts
import { z as z15 } from "zod";
var taskIdSchema = z15.string().min(1);
var taskViewSchema = z15.object({
  id: taskIdSchema,
  kind: z15.string().min(1),
  label: z15.string().min(1),
  status: z15.union([
    z15.literal("running"),
    z15.literal("stopping"),
    z15.literal("completed"),
    z15.literal("killed"),
    z15.literal("failed")
  ]),
  detail: z15.string().optional(),
  startedAt: z15.number().int().nonnegative(),
  finishedAt: z15.number().int().nonnegative().optional()
});

// vendor/harness/packages/host/apiproxy/src/api/events.schema.ts
var askUserQuestionItemSchema = z16.object({
  id: z16.string(),
  question: z16.string(),
  header: z16.string().optional(),
  detail: z16.string().optional(),
  options: z16.array(z16.object({ label: z16.string(), description: z16.string().optional() })).optional(),
  multiSelect: z16.boolean().optional(),
  // Presentation intent: a tagged union on the wire, so an unknown tag is a
  // rejected frame rather than a silently generic render.
  intent: z16.discriminatedUnion("kind", [
    z16.object({ kind: z16.literal("plan-review"), approve: z16.string() })
  ]).optional()
});
var messageSchema = z16.object({
  id: z16.string().min(1),
  role: z16.union([z16.literal("system"), z16.literal("user"), z16.literal("assistant")]),
  content: z16.array(contentBlockSchema),
  source: z16.looseObject({ kind: z16.string() })
});
var muxFrameSchema = z16.discriminatedUnion("type", [
  z16.object({ type: z16.literal("session/event"), sessionId: sessionIdSchema, event: sessionEventSchema, view: toolEventViewSchema.optional() }),
  z16.object({ type: z16.literal("session/subscribed"), sessionId: sessionIdSchema, lastSeq: z16.number().int() }),
  z16.object({ type: z16.literal("approval/requested"), sessionId: sessionIdSchema, approvalId: approvalRequestIdSchema, toolName: z16.string(), callId: z16.string().optional(), reason: z16.string().optional() }),
  z16.object({ type: z16.literal("approval/resolved"), sessionId: sessionIdSchema, approvalId: approvalRequestIdSchema, outcome: z16.union([z16.literal("allowed-once"), z16.literal("rejected"), z16.literal("cancelled"), z16.literal("unavailable")]) }),
  // Non-empty by wire contract: the user-questions service rejects empty
  // batches at ask() (EMPTY_QUESTIONS), so an empty frame is host breakage
  // and must fail loud here, not reach the composer.
  z16.object({ type: z16.literal("question/requested"), sessionId: sessionIdSchema, questions: z16.array(askUserQuestionItemSchema).min(1) }),
  z16.object({ type: z16.literal("question/resolved"), sessionId: sessionIdSchema, questionRpcId: rpcIdSchema, outcome: z16.union([z16.literal("answered"), z16.literal("cancelled")]) }),
  z16.object({
    type: z16.literal("session/queue"),
    sessionId: sessionIdSchema,
    items: z16.array(z16.object({
      id: messageIdSchema,
      placement: z16.union([z16.literal("queued"), z16.literal("steering"), z16.literal("context")]),
      message: messageSchema
    }))
  }),
  z16.object({ type: z16.literal("session/jobs"), sessionId: sessionIdSchema, jobs: z16.array(taskViewSchema) }),
  // value stays wide: it already passed its unit's own schema on the host,
  // and deep-validating here would import every domain's schema into the carrier.
  z16.object({ type: z16.literal("session/projection"), sessionId: sessionIdSchema, key: z16.string().min(1), value: z16.unknown(), seq: z16.number().int().nonnegative() }),
  z16.object({ type: z16.literal("stream/error"), error: rpcErrorSchema })
]);
var hostFrameSchema = z16.discriminatedUnion("type", [
  z16.object({
    type: z16.literal("host/session-added"),
    sessionId: sessionIdSchema,
    blank: z16.boolean(),
    parentSessionId: sessionIdSchema.optional(),
    origin: z16.literal("subagent").optional(),
    cwd: z16.string().optional(),
    agentPreset: z16.string().optional()
  }),
  z16.object({ type: z16.literal("host/session-removed"), sessionId: sessionIdSchema }),
  z16.object({ type: z16.literal("host/session-status"), sessionId: sessionIdSchema, running: z16.boolean() }),
  z16.object({ type: z16.literal("host/agent-error"), sessionId: sessionIdSchema, message: z16.string() }),
  z16.object({ type: z16.literal("host/workspace-changed"), workspace: workspaceViewSchema }),
  z16.object({ type: z16.literal("host/workspace-removed"), workspaceId: workspaceIdSchema }),
  z16.object({ type: z16.literal("host/workspace-order-changed"), workspaceIds: z16.array(workspaceIdSchema) }),
  z16.object({ type: z16.literal("host/archived-sessions-changed"), archivedSessionIds: z16.array(sessionIdSchema) }),
  // args stays wide, the same posture as session/projection's value: the frame
  // arrives from JSON.parse, so every element is already a JSON value, and the
  // structural contract belongs to the owner package's cordis `Events`
  // declaration — the host validated JSON-safety before forwarding.
  z16.object({ type: z16.literal("host/remote-event"), event: z16.string().min(1), args: z16.array(z16.unknown()) }),
  z16.object({ type: z16.literal("stream/error"), error: rpcErrorSchema })
]);

// vendor/harness/packages/host/apiproxy/src/fetch/client.ts
var UNARY_VALUE_SCHEMAS = {
  "session.list": sessionListValueSchema,
  "session.search": sessionSearchValueSchema,
  "session.create": sessionCreateValueSchema,
  "session.history": sessionHistoryValueSchema,
  "session.models": sessionModelsValueSchema,
  "session.selectModel": sessionSelectModelValueSchema,
  "session.rename": sessionRenameValueSchema,
  "session.fork": sessionForkValueSchema,
  "session.prompt": sessionPromptValueSchema,
  "session.attachment": sessionAttachmentValueSchema,
  "session.updateQueue": sessionUpdateQueueValueSchema,
  "session.cancel": sessionCancelValueSchema,
  "subagent.list": subagentListValueSchema,
  "subagent.history": subagentHistoryValueSchema,
  "subagent.prompt": subagentPromptValueSchema,
  "subagent.interrupt": subagentInterruptValueSchema,
  "host.describe": hostDescribeValueSchema,
  "host.pickDirectory": hostPickDirectoryValueSchema,
  "host.listDirectory": hostListDirectoryValueSchema,
  "host.createDirectory": hostCreateDirectoryValueSchema,
  "host.openPath": hostOpenPathValueSchema,
  "workspace.list": workspaceListValueSchema,
  "workspace.create": workspaceCreateValueSchema,
  "workspace.rename": workspaceRenameValueSchema,
  "workspace.delete": workspaceDeleteValueSchema,
  "workspace.insertBefore": workspaceInsertBeforeValueSchema,
  "workspace.insertSessionBefore": workspaceInsertSessionBeforeValueSchema,
  "workspace.archiveSession": workspaceArchiveSessionValueSchema,
  "skill.list": skillListValueSchema,
  "agentPreset.list": agentPresetListValueSchema,
  "agentPreset.select": agentPresetSelectValueSchema,
  "agentPreset.read": agentPresetReadValueSchema,
  "agentPreset.copy": agentPresetCopyValueSchema,
  "agentPreset.openDocument": agentPresetOpenDocumentValueSchema,
  "agentPreset.remove": agentPresetRemoveValueSchema,
  "goal.create": goalCreateValueSchema,
  "goal.edit": goalEditValueSchema,
  "goal.pause": goalPauseValueSchema,
  "goal.resume": goalResumeValueSchema,
  "goal.complete": goalCompleteValueSchema,
  "goal.clear": goalClearValueSchema,
  "settings.describe": settingsDescribeValueSchema,
  "settings.openDocument": settingsOpenDocumentValueSchema,
  "settings.update": settingsUpdateValueSchema,
  "settings.replace": settingsReplaceValueSchema,
  "settings.mutate": settingsMutateValueSchema,
  "credentials.describe": credentialsDescribeValueSchema,
  "credentials.set": credentialsSetValueSchema,
  "credentials.unset": credentialsUnsetValueSchema,
  "llm.providers": llmProvidersValueSchema,
  "llm.models": llmModelsValueSchema,
  "llm.discoverModels": llmDiscoverModelsValueSchema
};
var DEFAULT_TIMEOUT_MS = 3e4;
var INTERNAL_BASE = "http://dsh.internal";
var AbstractApiClient = class {
  /** @param timeoutMs - timeout for bounded unary calls; user-paced calls and streams do not use it. */
  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }
  /** Instance-owned observation buffer (module-level state would leak across instances/tests). */
  envelopeBatch = [];
  flushScheduled = false;
  envelopeListeners = /* @__PURE__ */ new Set();
  /**
   * Subscribe to batched envelope observation (diagnostics/logging consumers).
   * Batches follow microtask boundaries; a listener throw is isolated (observation
   * must never break the carrier).
   * @param listener - receives each flushed batch in arrival order.
   * @returns unsubscribe function.
   */
  subscribeEnvelopes(listener) {
    this.envelopeListeners.add(listener);
    return () => {
      this.envelopeListeners.delete(listener);
    };
  }
  /** Per-message tap: feeds the instance buffer. Subclasses may override to observe unbatched (call super to keep batching). */
  onEnvelope(message) {
    if (this.envelopeListeners.size === 0) return;
    this.envelopeBatch.push(message);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      const batch = this.envelopeBatch;
      this.envelopeBatch = [];
      for (const notify of this.envelopeListeners) {
        try {
          notify(batch);
        } catch (error) {
          console.error("[apiproxy] envelope listener threw:", error);
        }
      }
    });
  }
  /** Browser = same-origin (a fake authority would fail DNS on real requests); no-location env (Node) = fake authority. */
  resolveBase() {
    const loc = globalThis.location;
    return loc?.origin !== void 0 && loc.origin !== "null" ? loc.origin : INTERNAL_BASE;
  }
  mintRpcId() {
    return RpcId(crypto.randomUUID());
  }
  /**
   * Shared POST leg of both C→S carriers (callUnary/respond): JSON body,
   * optional default timeout merged with the caller's external signal, non-2xx → transport throw.
   */
  async postJson(path, body, signal, timeoutPolicy = "default") {
    const requestSignal = timeoutPolicy === "default" ? signal === void 0 ? AbortSignal.timeout(this.timeoutMs) : AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal]) : signal;
    const response = await this.doFetch(new URL(path, this.resolveBase()), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...requestSignal === void 0 ? {} : { signal: requestSignal }
    });
    if (!response.ok) throw new Error(`transport failure for ${path}: HTTP ${response.status}`);
    return response;
  }
  /**
   * Unary protocol path: mint → tap → POST full form → envelope parse → verify
   * echo → value parse → tap → narrow. Virtual so a fake carrier (fixture) can
   * override transport at this layer.
   */
  async callUnary(method, payload, signal, timeoutPolicy = "default") {
    const message = { type: "client-request", rpcId: this.mintRpcId(), method, payload };
    this.onEnvelope(message);
    const response = await this.postJson(`/api/${method}`, message, signal, timeoutPolicy);
    const full = serverResponseSchema.parse(await response.json());
    this.onEnvelope(full);
    if (full.rpcId !== message.rpcId) throw new Error(`rpcId mismatch for ${method}: sent ${message.rpcId}, got ${full.rpcId}`);
    if (!full.result.ok) return { rpcId: full.rpcId, result: full.result };
    const value = UNARY_VALUE_SCHEMAS[method].parse(full.result.value);
    return { rpcId: full.rpcId, result: { ok: true, value } };
  }
  /** Mux stream opener; virtual for the same override reason as callUnary. */
  openMux(_payload, signal, onOpen) {
    return this.readSse("/api/events.mux", signal, muxFrameSchema, onOpen);
  }
  /** Host stream opener; virtual. */
  openHost(_payload, signal, onOpen) {
    return this.readSse("/api/events.host", signal, hostFrameSchema, onOpen);
  }
  /**
   * SSE protocol path: streaming fetch (not EventSource), '\n\n' framing, ServerRequest envelope +
   * frame-schema parse, tap, narrow yield. onOpen fires once the response headers are in and the
   * body is readable — the stream-established signal, before any frame arrives. A frame that fails
   * either parse level is reported and skipped (one corrupt frame must not kill the stream; the
   * client's gap detection covers whatever the frame carried).
   */
  async *readSse(path, signal, frameSchema, onOpen) {
    const response = await this.doFetch(new URL(path, this.resolveBase()), { signal });
    if (!response.ok || response.body === null) throw new Error(`transport failure for ${path}: HTTP ${response.status}`);
    onOpen?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = chunk.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("");
          if (data === "") continue;
          let full;
          let frame2;
          try {
            full = serverRequestSchema.parse(JSON.parse(data));
            frame2 = frameSchema.parse(full.payload);
          } catch (error) {
            console.error(`[apiproxy] dropping malformed SSE frame on ${path}:`, error);
            continue;
          }
          this.onEnvelope(full);
          yield { rpcId: full.rpcId, payload: frame2 };
        }
      }
    } finally {
      await reader.cancel().catch(() => void 0);
    }
  }
  // ---- IApiClient API (arrow properties so destructured/passed references stay bound) ----
  sessions = {
    list: (payload, signal) => this.callUnary("session.list", payload, signal),
    search: (payload, signal) => this.callUnary("session.search", payload, signal),
    create: (payload, signal) => this.callUnary("session.create", payload, signal),
    history: (payload, signal) => this.callUnary("session.history", payload, signal),
    models: (payload, signal) => this.callUnary("session.models", payload, signal),
    selectModel: (payload, signal) => this.callUnary("session.selectModel", payload, signal),
    rename: (payload, signal) => this.callUnary("session.rename", payload, signal),
    fork: (payload, signal) => this.callUnary("session.fork", payload, signal),
    prompt: (payload, signal) => this.callUnary("session.prompt", payload, signal),
    attachment: (payload, signal) => this.callUnary("session.attachment", payload, signal),
    updateQueue: (payload, signal) => this.callUnary("session.updateQueue", payload, signal),
    cancel: (payload, signal) => this.callUnary("session.cancel", payload, signal)
  };
  subagents = {
    list: (payload, signal) => this.callUnary("subagent.list", payload, signal),
    history: (payload, signal) => this.callUnary("subagent.history", payload, signal),
    prompt: (payload, signal) => this.callUnary("subagent.prompt", payload, signal),
    interrupt: (payload, signal) => this.callUnary("subagent.interrupt", payload, signal)
  };
  host = {
    describe: (payload, signal) => this.callUnary("host.describe", payload, signal),
    // A native system dialog is user-paced and may legitimately stay open
    // longer than the normal unary deadline. Caller/connection aborts remain.
    pickDirectory: (payload, signal) => this.callUnary(
      "host.pickDirectory",
      payload,
      signal,
      "caller-signal-only"
    ),
    listDirectory: (payload, signal) => this.callUnary("host.listDirectory", payload, signal),
    createDirectory: (payload, signal) => this.callUnary("host.createDirectory", payload, signal),
    openPath: (payload, signal) => this.callUnary("host.openPath", payload, signal)
  };
  workspace = {
    list: (payload, signal) => this.callUnary("workspace.list", payload, signal),
    create: (payload, signal) => this.callUnary("workspace.create", payload, signal),
    rename: (payload, signal) => this.callUnary("workspace.rename", payload, signal),
    delete: (payload, signal) => this.callUnary("workspace.delete", payload, signal),
    insertBefore: (payload, signal) => this.callUnary("workspace.insertBefore", payload, signal),
    insertSessionBefore: (payload, signal) => this.callUnary("workspace.insertSessionBefore", payload, signal),
    archiveSession: (payload, signal) => this.callUnary("workspace.archiveSession", payload, signal)
  };
  skills = {
    list: (payload, signal) => this.callUnary("skill.list", payload, signal)
  };
  // Annotated like every sibling, and load-bearing rather than cosmetic:
  // inferring this member inlines `AgentPresetEntry` into the emitted
  // declaration by the specifier TS picks — the host `index.ts` — which drags
  // the whole gateway, and with it the host `Context` merges, into every
  // Client program that imports this carrier.
  agentPresets = {
    list: (payload, signal) => this.callUnary("agentPreset.list", payload, signal),
    select: (payload, signal) => this.callUnary("agentPreset.select", payload, signal),
    read: (payload, signal) => this.callUnary("agentPreset.read", payload, signal),
    copy: (payload, signal) => this.callUnary("agentPreset.copy", payload, signal),
    openDocument: (payload, signal) => this.callUnary("agentPreset.openDocument", payload, signal),
    remove: (payload, signal) => this.callUnary("agentPreset.remove", payload, signal)
  };
  goals = {
    create: (payload, signal) => this.callUnary("goal.create", payload, signal),
    edit: (payload, signal) => this.callUnary("goal.edit", payload, signal),
    pause: (payload, signal) => this.callUnary("goal.pause", payload, signal),
    resume: (payload, signal) => this.callUnary("goal.resume", payload, signal),
    complete: (payload, signal) => this.callUnary("goal.complete", payload, signal),
    clear: (payload, signal) => this.callUnary("goal.clear", payload, signal)
  };
  settings = {
    describe: (payload, signal) => this.callUnary("settings.describe", payload, signal),
    openDocument: (payload, signal) => this.callUnary("settings.openDocument", payload, signal),
    update: (payload, signal) => this.callUnary("settings.update", payload, signal),
    replace: (payload, signal) => this.callUnary("settings.replace", payload, signal),
    mutate: (payload, signal) => this.callUnary("settings.mutate", payload, signal)
  };
  credentials = {
    describe: (payload, signal) => this.callUnary("credentials.describe", payload, signal),
    set: (payload, signal) => this.callUnary("credentials.set", payload, signal),
    unset: (payload, signal) => this.callUnary("credentials.unset", payload, signal)
  };
  llm = {
    providers: (payload, signal) => this.callUnary("llm.providers", payload, signal),
    models: (payload, signal) => this.callUnary("llm.models", payload, signal),
    discoverModels: (payload, signal) => this.callUnary("llm.discoverModels", payload, signal)
  };
  events = {
    mux: (payload, signal, onOpen) => this.openMux(payload, signal, onOpen),
    host: (payload, signal, onOpen) => this.openHost(payload, signal, onOpen)
  };
  async respond(message, signal) {
    this.onEnvelope(message);
    const response = await this.postJson("/api/respond", message, signal);
    return rpcReceiptSchema.parse(await response.json());
  }
};
var InProcessApiClient = class extends AbstractApiClient {
  constructor(handler, timeoutMs) {
    super(timeoutMs);
    this.handler = handler;
  }
  /**
   * Faithful to real fetch: reject on signal abort even when the in-process
   * handler ignores the signal (a hung impl must not defeat timeout/cancel).
   */
  doFetch(input, init) {
    const signal = init?.signal ?? void 0;
    if (signal === void 0) return this.handler.fetch(input, init);
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(abortError(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.handler.fetch(input, init).then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });
  }
};
function abortError(signal) {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === "string") return new Error(reason);
  return new Error("This operation was aborted");
}

// vendor/harness/packages/host/apiproxy/src/index.ts
var ApiProxyService = class extends Service {
  static inject = [
    "agentDefaultModel",
    "agents",
    "attachments",
    "directoryPicker",
    "llm",
    "sessions",
    "subagents",
    "sessionQuery",
    "tools",
    "userQuestions",
    "workspaceRegistry"
  ];
  static Config = z17.object({
    nativeOpen: z17.boolean(),
    sessionExportCompressionLevel: z17.number().step(1).min(0).max(9).default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL),
    coldBlankProbeMaxBytes: z17.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES)
  });
  sessions;
  subagents;
  workspace;
  host;
  goals;
  skills;
  agentPresets;
  settings;
  credentials;
  llm;
  events;
  downloads;
  respond;
  constructor(ctx, config) {
    super(ctx, "apiProxy");
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      saveDefaultModelSelection: (selection) => ctx.agentDefaultModel.saveSelection(selection),
      cwd: process.cwd(),
      ...config.nativeOpen === void 0 ? {} : { canOpenPath: () => config.nativeOpen },
      ...config.sessionExportCompressionLevel === void 0 ? {} : { sessionExportCompressionLevel: config.sessionExportCompressionLevel },
      ...config.coldBlankProbeMaxBytes === void 0 ? {} : { coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes }
    });
    this.sessions = api.sessions;
    this.subagents = api.subagents;
    this.workspace = api.workspace;
    this.host = api.host;
    this.goals = api.goals;
    this.skills = api.skills;
    this.agentPresets = api.agentPresets;
    this.settings = api.settings;
    this.credentials = api.credentials;
    this.llm = api.llm;
    this.events = api.events;
    this.downloads = api.downloads;
    this.respond = api.respond.bind(api);
  }
};
var src_default = ApiProxyService;
export {
  AbstractApiClient,
  ApiProxyService,
  InProcessApiClient,
  RpcId,
  createApiProxy,
  src_default as default,
  toFetchHandler
};
