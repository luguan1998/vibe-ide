// vendor/harness/packages/client/ui-settings-plugins/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-client-ui-settings-plugins";
var name = "client-ui-settings-plugins-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
