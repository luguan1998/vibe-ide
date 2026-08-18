// vendor/harness/packages/core/tools/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-tools";
var name = "tools-invariant";
var inject = ["invariants"];
function validateResult(exec, result, fail) {
  if (!Object.isFrozen(exec)) fail("tools/result execution must be frozen before publication");
  if (!Object.isFrozen(result) || !Object.isFrozen(result.content)) {
    fail("tools/result outcome and content must be frozen before publication");
  }
  if (exec.name.length === 0 || String(exec.callId).length === 0) {
    fail("tools/result execution must carry non-empty name and callId");
  }
}
var install = Object.assign((ctx, fail) => {
  const stages = /* @__PURE__ */ new WeakMap();
  const openTurns = /* @__PURE__ */ new WeakMap();
  const dispatchRoots = /* @__PURE__ */ new WeakMap();
  const validateDispatch = (session, event) => {
    if (event.type !== "tool/code-dispatch-start" && event.type !== "tool/code-dispatch") return;
    const root = String(event.data.rootCallId);
    const parent = String(event.data.parentCallId);
    const child = String(event.data.subCallId);
    if (root.length === 0 || parent.length === 0 || child.length === 0) {
      fail(`${event.type} must carry non-empty rootCallId, parentCallId, and subCallId`);
      return;
    }
    const roots = dispatchRoots.get(session);
    const known = roots?.get(child);
    if (known !== void 0 && known !== root) fail(`${event.type} changed rootCallId for subCallId ${child}`);
    if (parent !== root && roots?.get(parent) !== root) {
      fail(`${event.type} parentCallId ${parent} does not belong to rootCallId ${root}`);
    }
  };
  const commitDispatch = (session, event) => {
    if (event.type !== "tool/code-dispatch-start" && event.type !== "tool/code-dispatch") return;
    const roots = dispatchRoots.get(session);
    roots.set(String(event.data.subCallId), String(event.data.rootCallId));
  };
  const seed = (session) => {
    let openTurn = null;
    dispatchRoots.set(session, /* @__PURE__ */ new Map());
    for (const event of session.events) {
      validateDispatch(session, event);
      commitDispatch(session, event);
      if (event.type === "turn/start") openTurn = event.data.turn;
      else if (event.type === "turn/end") openTurn = null;
      else if ((event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch") && openTurn === null) {
        fail(`${event.type} appended outside any open turn`);
      }
    }
    openTurns.set(session, openTurn);
    return openTurn;
  };
  const openTurnFor = (session) => openTurns.get(session) ?? seed(session);
  for (const session of ctx.sessions.list()) seed(session);
  ctx.on("session/created", (session) => {
    seed(session);
  }, { global: true });
  ctx.on("session/event", (session, event) => {
    validateDispatch(session, event);
    commitDispatch(session, event);
    if (event.type === "turn/start") openTurns.set(session, event.data.turn);
    else if (event.type === "turn/end") openTurns.set(session, null);
  }, { global: true });
  ctx.on("internal/dispatch", (_mode, eventName, args) => {
    if (eventName === "session/event") {
      const [session, event] = args;
      validateDispatch(session, event);
      if ((event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch") && openTurnFor(session) === null) {
        fail(`${event.type} appended outside any open turn`);
      }
      return;
    }
    if (eventName === "tools/pre-execute") {
      const exec2 = args[0];
      if (stages.has(exec2)) fail("tools/pre-execute repeated for one execution");
      stages.set(exec2, "pre");
      return;
    }
    if (eventName === "tools/execute") {
      const exec2 = args[0];
      if (stages.get(exec2) !== "pre") fail("tools/execute must follow tools/pre-execute");
      stages.set(exec2, "execute");
      return;
    }
    if (eventName === "tools/post-execute") {
      const exec2 = args[0];
      const previous = stages.get(exec2);
      if (previous !== "pre" && previous !== "execute") {
        fail("tools/post-execute must follow tools/pre-execute or tools/execute");
      }
      stages.set(exec2, "post");
      return;
    }
    if (eventName !== "tools/result") return;
    const [exec, result] = args;
    validateResult(exec, result, fail);
    stages.delete(exec);
  }, { global: true });
}, { inject: ["sessions"] });
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
