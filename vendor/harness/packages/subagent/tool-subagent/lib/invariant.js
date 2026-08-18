// vendor/harness/packages/subagent/tool-subagent/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-tool-subagent";
var name = "tool-subagent-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
