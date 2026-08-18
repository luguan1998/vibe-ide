// vendor/harness/packages/host/apiproxy/src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-host-apiproxy";
var name = "host-apiproxy-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
