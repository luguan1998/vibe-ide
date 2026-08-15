// Collect the transitive @deepseek-ai/* dependency closure for the dsh client
// packages Vibe imports, resolving each package's location inside the dsh repo.
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'

const DSH_ROOT = 'E:/ai/claudeui/vendor/harness'
const packageJson = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))

// Seed packages: the ones Vibe's renderer imports directly (value imports).
const SEEDS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  '@deepseek-ai/dsh-client-ui-agent-preset',
  '@deepseek-ai/dsh-client-ui-trajectory',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-commands',
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

const nameToDir = new Map()
for (const dir of readdirSync(join(DSH_ROOT, 'packages'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const sub = join(DSH_ROOT, 'packages', dir.name)
  for (const entry of readdirSync(sub, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pj = join(sub, entry.name, 'package.json')
    if (!existsSync(pj)) continue
    const name = packageJson(sub + '/' + entry.name).name
    if (name?.startsWith('@deepseek-ai/')) nameToDir.set(name, `packages/${dir.name}/${entry.name}`)
  }
}
for (const dir of readdirSync(join(DSH_ROOT, 'vendor'))) {
  const pj = join(DSH_ROOT, 'vendor', dir, 'package.json')
  if (!existsSync(pj)) continue
  const name = packageJson(join(DSH_ROOT, 'vendor', dir)).name
  if (name?.startsWith('@deepseek-ai/')) nameToDir.set(name, `vendor/${dir}`)
}

const visited = new Set()
const queue = SEEDS.map(s => nameToDir.get(s))
const ordered = []
while (queue.length) {
  const rel = queue.shift()
  if (!rel) continue
  if (visited.has(rel)) continue
  visited.add(rel)
  const pj = packageJson(join(DSH_ROOT, rel))
  ordered.push({ rel, name: pj.name })
  const all = { ...(pj.dependencies || {}), ...(pj.peerDependencies || {}) }
  for (const dep of Object.keys(all)) {
    if (!dep.startsWith('@deepseek-ai/')) continue
    const depDir = nameToDir.get(dep)
    if (!depDir) {
      console.warn(`MISSING LOCATION: ${dep} (needed by ${pj.name})`)
      continue
    }
    if (!visited.has(depDir)) queue.push(depDir)
  }
}

const args = process.argv[2]
if (args === '--paths') {
  for (const p of ordered) console.log(p.rel)
} else if (args === '--npm') {
  const rels = ordered.map(p => p.rel)
  console.log(rels.map(r => `../deepseek-harness/${r}`).join(' '))
} else {
  console.log(`Total packages: ${ordered.length}`)
  for (const p of ordered) console.log(p.name, '=>', p.rel)
}
