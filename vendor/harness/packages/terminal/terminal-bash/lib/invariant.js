// vendor/harness/packages/terminal/terminal-bash/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-terminal-bash";
var name = "terminal-bash-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
