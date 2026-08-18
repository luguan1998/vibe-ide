// vendor/harness/packages/mcp/mcp-client/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-mcp-client";
var name = "mcp-client-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
