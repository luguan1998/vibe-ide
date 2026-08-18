var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) dispose = value[__knownSymbol("dispose")];
    if (typeof dispose !== "function") __typeError("Object not disposable");
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// vendor/harness/packages/shell/tool-bash-persistent/src/index.ts
import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { deadline, timeoutOf } from "@deepseek-ai/dsh-timeout";
import { defineTool } from "@deepseek-ai/dsh-tools";
var TRUNCATED_MESSAGE = "<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>";
var LOST_PREFIX_MESSAGE = "<response clipped><NOTE>The beginning of this command output was dropped by the terminal scrollback limit. The following text is the earliest retained output.</NOTE>\n";
var SHELL_RESET_MESSAGE = "The persistent bash shell was reset; the next bash call starts from the workspace with a fresh current directory and environment.";
var TIMEOUT_CODE = "PERSISTENT_BASH_TIMEOUT";
var SCROLLBACK_PAGE_LINES = 1e3;
var POLL_INTERVAL_MS = 25;
var DEFAULT_DESCRIPTION = "Run commands in a persistent bash shell. State, including the current directory and exported environment variables, persists across calls for this agent.";
function maybeTruncate(content, maxOutputChars, incomplete = false) {
  if (content.length <= maxOutputChars && !incomplete) return content;
  return content.length <= maxOutputChars ? content + TRUNCATED_MESSAGE : content.slice(0, maxOutputChars) + TRUNCATED_MESSAGE;
}
function markers() {
  const nonce = randomUUID();
  return {
    start: `__DSH_PERSISTENT_BASH_START_${nonce}__`,
    end: `__DSH_PERSISTENT_BASH_END_${nonce}:`
  };
}
function quoteForBash(value) {
  return `$'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\r", "\\r").replaceAll("\n", "\\n")}'`;
}
function wrapCommand(command, marker) {
  return `printf '%s\\n' ${quoteForBash(marker.start)}; eval -- ${quoteForBash(command)}; __dsh_persistent_bash_status=$?; printf '%s%s\\n' ${quoteForBash(marker.end)} "$__dsh_persistent_bash_status"`;
}
function trimTrailingNewline(text) {
  return text.replace(/\r?\n$/, "");
}
function commandOutput(snapshot, marker) {
  const text = snapshot.text;
  const end = text.lastIndexOf(marker.end);
  const status = /^(\d+)\r?\n/.exec(text.slice(end + marker.end.length))?.[1];
  if (status === void 0) return void 0;
  const startMarker = text.lastIndexOf(marker.start, end);
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length;
  return {
    text: trimTrailingNewline(text.slice(start, end).replace(/^\r?\n/, "")),
    incomplete: startMarker < 0,
    exitCode: Number(status)
  };
}
function partialOutput(snapshot, marker, fallback, fallbackTruncated = false) {
  const startMarker = snapshot.text.lastIndexOf(marker.start);
  if (startMarker >= 0) {
    return {
      text: trimTrailingNewline(snapshot.text.slice(startMarker + marker.start.length).replace(/^\r?\n/, "")),
      incomplete: false
    };
  }
  const fallbackStart = fallback.lastIndexOf(marker.start);
  const afterStart = fallbackStart < 0 ? fallback : fallback.slice(fallbackStart + marker.start.length).replace(/^\r?\n/, "");
  const fallbackEnd = afterStart.lastIndexOf(marker.end);
  const beforeEnd = fallbackEnd < 0 ? afterStart : afterStart.slice(0, fallbackEnd);
  return {
    text: trimTrailingNewline(beforeEnd),
    incomplete: fallbackTruncated || fallbackStart < 0
  };
}
async function pause() {
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
function nextScrollbackOffset(page, offset) {
  if (page.text.length === 0 || page.lineEnd <= offset) return void 0;
  return page.lineEnd;
}
function retainedScrollback(ctx, owner, id, latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES })) {
  const pages = latest.text.length === 0 ? [] : [latest.text];
  let offset = latest.lineEnd;
  let truncated = latest.truncated;
  while (true) {
    if (offset >= latest.totalLines) break;
    const page = ctx.terminals.read(owner, id, { offset, count: SCROLLBACK_PAGE_LINES });
    truncated ||= page.truncated;
    if (page.text.length > 0) pages.unshift(page.text);
    const next = nextScrollbackOffset(page, offset);
    if (next === void 0 || next >= page.totalLines) break;
    offset = next;
  }
  return { text: pages.join("\n"), truncated };
}
function renderCaptured(output, maxOutputChars) {
  const rendered = maybeTruncate(output.text, maxOutputChars, output.incomplete);
  const withPrefix = output.incomplete && output.text.length > 0 ? LOST_PREFIX_MESSAGE + rendered : rendered;
  const marker = output.exitCode !== void 0 && output.exitCode !== 0 ? `[exit code: ${output.exitCode}]` : void 0;
  return appendStatusMarker(withPrefix, marker);
}
function appendStatusMarker(content, marker) {
  if (marker === void 0) return content;
  return content.length === 0 ? marker : `${content}
${marker}`;
}
function renderShellExitStatus(content, exitCode, signal) {
  const marker = signal !== null ? `[shell killed by signal: ${signal}]` : exitCode !== null ? `[shell exited: code ${exitCode}]` : "[shell exited]";
  return appendStatusMarker(content, marker);
}
function persistentShells(ctx, config) {
  const pending = /* @__PURE__ */ new WeakMap();
  const live = /* @__PURE__ */ new Map();
  const creating = /* @__PURE__ */ new Set();
  const ownerCleanupInstalled = /* @__PURE__ */ new WeakSet();
  const lifecycle = new AbortController();
  const close = async (owner, id, reason) => {
    if (!ctx.terminals.list(owner).some((snapshot) => snapshot.sessionId === id)) return;
    await ctx.terminals.kill(owner, id, reason);
  };
  ctx.effect(() => async () => {
    lifecycle.abort(new Error("tool-bash-persistent disposed during shell creation"));
    await Promise.allSettled([...creating]);
    const closing = [...live].map(async ([owner, id]) => {
      await close(owner, id, "tool-bash-persistent disposed");
    });
    await Promise.all(closing);
    live.clear();
  }, "tool-bash-persistent shell cleanup");
  const reset = async (owner, reason) => {
    pending.delete(owner);
    const id = live.get(owner);
    live.delete(owner);
    if (id !== void 0) await close(owner, id, reason);
  };
  const get = (owner, signal) => {
    const existing = pending.get(owner);
    if (existing !== void 0) return existing;
    const combinedSignal = AbortSignal.any([signal, lifecycle.signal]);
    const creation = (async () => {
      try {
        const cwd = owner.session.header.cwd;
        const spawned = await ctx.terminals.spawn(owner, {
          type: config.backendType,
          ...cwd === void 0 ? {} : { cwd }
        }, combinedSignal);
        live.set(owner, spawned.sessionId);
        if (!ownerCleanupInstalled.has(owner)) {
          ownerCleanupInstalled.add(owner);
          owner.ctx.effect(() => () => {
            pending.delete(owner);
            live.delete(owner);
          }, "tool-bash-persistent owner cache cleanup");
        }
        const setup = ctx.terminals.startSend(owner, spawned.sessionId, {
          text: "stty -echo",
          submit: true,
          signal: combinedSignal
        });
        const result = await setup.done;
        if (result.sessionStatus.kind === "exited" || result.waitReason === "timeout") {
          throw new Error("persistent bash shell did not accept initialization");
        }
        return spawned.sessionId;
      } catch (error) {
        await reset(owner, "persistent bash initialization failed");
        throw error;
      }
    })();
    const tracked = creation.finally(() => {
      creating.delete(tracked);
    });
    creating.add(tracked);
    pending.set(owner, tracked);
    return tracked;
  };
  return { get, reset };
}
async function executeCommand(ctx, shells, owner, command, config, upstream) {
  var _stack = [];
  try {
    const commandDeadline = __using(_stack, deadline(upstream, config.timeoutMs, TIMEOUT_CODE));
    const id = await shells.get(owner, commandDeadline.signal);
    const marker = markers();
    const wrapped = wrapCommand(command, marker);
    let first = true;
    let fallback = "";
    let fallbackTruncated = false;
    while (true) {
      let operation;
      let result;
      try {
        operation = ctx.terminals.startSend(owner, id, {
          text: first ? wrapped : "",
          submit: first,
          signal: commandDeadline.signal
        });
        first = false;
        result = await operation.done;
      } catch (error) {
        await shells.reset(owner, "persistent bash send failed");
        throw error;
      }
      const incremental = operation.readOutput();
      fallback = incremental.delta.length > 0 ? fallback + incremental.delta : result.viewport;
      fallbackTruncated ||= incremental.truncated || result.truncated;
      const latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES });
      const timedOut = timeoutOf(commandDeadline.signal, TIMEOUT_CODE);
      if (timedOut !== void 0) {
        const snapshot = retainedScrollback(ctx, owner, id, latest);
        const partial = renderCaptured(
          partialOutput(snapshot, marker, fallback, fallbackTruncated),
          config.maxOutputChars
        );
        await shells.reset(owner, "persistent bash command timed out");
        return [
          // TODO: Report a timeout only; this signal does not establish an OOM.
          `Your command timed out after ${Math.round(timedOut.timeoutMs / 1e3)} seconds or experienced an OOM error. Below is partial output:`,
          partial,
          SHELL_RESET_MESSAGE
        ].join("\n");
      }
      if (commandDeadline.signal.aborted) {
        await shells.reset(owner, "persistent bash command aborted");
        commandDeadline.signal.throwIfAborted();
      }
      if (latest.text.includes(marker.end)) {
        const complete = commandOutput(retainedScrollback(ctx, owner, id, latest), marker);
        if (complete !== void 0) return renderCaptured(complete, config.maxOutputChars);
      }
      if (result.sessionStatus.kind === "exited") {
        const snapshot = retainedScrollback(ctx, owner, id, latest);
        await shells.reset(owner, "persistent bash shell exited");
        return [
          renderShellExitStatus(
            renderCaptured(partialOutput(snapshot, marker, fallback, fallbackTruncated), config.maxOutputChars),
            result.sessionStatus.exitCode,
            result.sessionStatus.signal
          ),
          SHELL_RESET_MESSAGE
        ].filter((part) => part.length > 0).join("\n");
      }
      if (result.waitReason === "stdin_read") {
        const snapshot = retainedScrollback(ctx, owner, id, latest);
        return renderCaptured(
          partialOutput(snapshot, marker, fallback, fallbackTruncated),
          config.maxOutputChars
        );
      }
      await pause();
    }
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}
function registerPersistentBash(ctx, config) {
  const shells = persistentShells(ctx, config);
  const queues = /* @__PURE__ */ new WeakMap();
  const serialized = async (owner, operation) => {
    const prior = queues.get(owner) ?? Promise.resolve();
    const run = prior.then(operation, operation);
    const tail = run.then(() => void 0, () => void 0);
    queues.set(owner, tail);
    try {
      return await run;
    } finally {
      if (queues.get(owner) === tail) queues.delete(owner);
    }
  };
  ctx.tools.register(defineTool({
    name: "bash",
    description: config.description,
    parameters: {
      command: {
        type: "string",
        required: true,
        description: "The bash command to run. Relative path is preferred in the command."
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }]
    },
    async execute(args, exec) {
      if (args.command.trim().length === 0) throw new Error("command must be a non-empty string");
      const owner = exec.agent;
      if (owner === void 0) throw new Error("bash requires an owning agent session");
      return serialized(owner, async () => {
        exec.signal.throwIfAborted();
        return executeCommand(ctx, shells, owner, args.command, config, exec.signal);
      });
    },
    presentCall: (args) => ({ card: "terminal", title: args.command })
  }));
}
var name = "tool-bash-persistent";
var inject = ["tools", "terminals"];
var Config = z.object({
  backendType: z.string().default("shell"),
  timeoutMs: z.number().default(3e5),
  maxOutputChars: z.number().default(16e3),
  description: z.string().default(DEFAULT_DESCRIPTION)
});
function apply(ctx, config) {
  const resolved = {
    backendType: config.backendType ?? "shell",
    timeoutMs: config.timeoutMs ?? 3e5,
    maxOutputChars: config.maxOutputChars ?? 16e3,
    description: config.description ?? DEFAULT_DESCRIPTION
  };
  if (resolved.backendType.trim().length === 0) {
    throw new Error("tool-bash-persistent: backendType must be non-empty");
  }
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new Error("tool-bash-persistent: timeoutMs must be a positive safe integer");
  }
  if (!Number.isSafeInteger(resolved.maxOutputChars) || resolved.maxOutputChars <= 0) {
    throw new Error("tool-bash-persistent: maxOutputChars must be a positive safe integer");
  }
  if (resolved.description.trim().length === 0) {
    throw new Error("tool-bash-persistent: description must be non-empty");
  }
  registerPersistentBash(ctx, resolved);
}
export {
  Config,
  apply,
  inject,
  name
};
