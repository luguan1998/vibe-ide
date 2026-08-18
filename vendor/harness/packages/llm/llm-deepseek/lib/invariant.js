// vendor/harness/packages/llm/llm-deepseek/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-llm-deepseek";
var name = "llm-deepseek-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
