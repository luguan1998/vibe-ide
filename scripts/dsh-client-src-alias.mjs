import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

// dsh client-face packages ship lib/ as a ModuleLoader closure (browser
// bundle format), which rollup cannot consume. Redirect every reference to
// those packages (bare name or subpath) to their TS sources so Vite compiles
// them. Host-face packages (apiproxy/llm/settings/...) keep their ESM lib.
export function dshClientSrcAlias() {
  const root = join(process.cwd(), 'node_modules', '@deepseek-ai')
  const face = new Set()
  try {
    for (const name of readdirSync(root)) {
      try {
        const j = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf-8'))
        if (j.dsh?.client) face.add('@deepseek-ai/' + name)
      } catch {}
    }
  } catch {}
  // Client packages whose package.json lacks the dsh.client marker: their lib
  // closure bundles CSS in a way Vite cannot inject (Menu/Button/Modal styles
  // silently drop — portal menus render as unstyled static blocks). Redirect
  // them to src like the flagged ones.
  for (const extra of [
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-attachment',
    '@deepseek-ai/dsh-client-schema-form',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-web-react',
  ]) face.add(extra)
  const tryFile = (base) => {
    for (const ext of ['.ts', '.tsx']) if (existsSync(base + ext)) return base + ext
    if (existsSync(join(base, 'index.ts'))) return join(base, 'index.ts')
    return null
  }
  return {
    name: 'dsh-client-src-alias',
    enforce: 'pre',
    resolveId(id) {
      if (!id.startsWith('@deepseek-ai/')) return null
      for (const pkg of face) {
        if (id === pkg) {
          return tryFile(join(root, pkg.slice('@deepseek-ai/'.length), 'src', 'index')) ?? null
        }
        if (id.startsWith(pkg + '/')) {
          const sub = id.slice(pkg.length + 1)
          return tryFile(join(root, pkg.slice('@deepseek-ai/'.length), 'src', sub)) ?? null
        }
      }
      return null
    },
  }
}
