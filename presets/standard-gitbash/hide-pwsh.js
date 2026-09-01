// Preset-attached plugin: hide the host's global `pwsh` tool from agents on
// this preset. `tools.restrict()` is the documented mechanism ("Agent-scoped
// tool restrictions can remove the definition for that agent"), and its layer
// lives on the standing scope, so every agent parented under the preset stops
// seeing pwsh — without it the win32 host row would still surface through the
// global layer.
//
// Import-free on purpose: the Loader resolves entry modules through Node's ESM
// resolver, which cannot see TypeScript sources. This file must stay next to
// agent.cordis.yml (relative row names resolve from the preset directory).
export const name = 'hide-pwsh'
export const inject = ['tools']

export function apply(ctx) {
  if (process.platform !== 'win32') return
  // restrict() throws on names unknown to the visible surface; pwsh exists on
  // win32 today, but the guard keeps a future host composition from breaking
  // the whole preset mount.
  if (ctx.tools.get('pwsh') === undefined) return
  ctx.effect(() => ctx.tools.restrict({ deny: ['pwsh'] }))
}