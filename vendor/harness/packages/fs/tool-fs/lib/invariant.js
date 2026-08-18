// vendor/harness/packages/fs/tool-fs/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-tool-fs";
var name = "tool-fs-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
