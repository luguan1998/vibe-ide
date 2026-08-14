import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = 'E:/ai/deepseek-harness'
const found = []
const scan = (dir) => {
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (!e.isDirectory()) continue
    const p = join(dir, e.name)
    const pj = join(p, 'package.json')
    try {
      const j = JSON.parse(readFileSync(pj, 'utf-8'))
      if (j.dsh?.client) found.push(j.name)
    } catch {}
    if (e.name !== 'node_modules') scan(p)
  }
}
scan(ROOT)
console.log(found.sort().join('\n'))
