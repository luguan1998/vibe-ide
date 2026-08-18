// vendor/harness/packages/client/ui-user-questions/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-client-ui-user-questions";
var name = "client-ui-user-questions-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
