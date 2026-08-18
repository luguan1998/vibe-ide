// vendor/harness/packages/extensions/tool-cordis/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-tool-cordis";
var name = "tool-cordis-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
