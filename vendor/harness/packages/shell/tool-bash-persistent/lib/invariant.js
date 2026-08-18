// vendor/harness/packages/shell/tool-bash-persistent/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-tool-bash-persistent";
var name = "tool-bash-persistent-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
