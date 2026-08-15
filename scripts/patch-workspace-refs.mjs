// 把 vendor/harness 所有 package.json 中的 workspace:^ 依赖改写为 file: 相对路径，
// 使 npm 能解析 dsh 包间的互相引用（npm 不支持 workspace: 协议）
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = path.join(root, 'vendor', 'harness')

// name -> vendor/harness 相对目录
const nameToDir = new Map()
const walk = (d) => {
  for (const name of readdirSync(d)) {
    if (name === 'node_modules' || name === '.git') continue
    const full = path.join(d, name)
    try {
      if (!existsSync(path.join(full, 'package.json'))) {
        walk(full)
        continue
      }
      const j = JSON.parse(readFileSync(path.join(full, 'package.json'), 'utf-8'))
      if (j.name) nameToDir.set(j.name, path.relative(VENDOR, full).split(path.sep).join('/'))
      walk(full)
    } catch {}
  }
}
walk(VENDOR)

let patched = 0
for (const [name, rel] of nameToDir) {
  const pj = path.join(VENDOR, rel, 'package.json')
  const j = JSON.parse(readFileSync(pj, 'utf-8'))
  let changed = false
  for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const [dep, ver] of Object.entries(j[key] ?? {})) {
      if (!ver.startsWith('workspace:')) continue
      if (key === 'devDependencies') {
        // devDependencies 里的 workspace 测试工具包直接删除（vibe 不跑 harness 测试）
        delete j[key][dep]
        changed = true
        continue
      }
      const depRel = nameToDir.get(dep)
      if (!depRel) {
        console.warn(`[patch-workspace-refs] ${name} 引用未收录的 workspace 包: ${dep}`)
        continue
      }
      const fromDir = path.dirname(path.join(VENDOR, rel))
      const relPath = path.relative(fromDir, path.join(VENDOR, depRel)).split(path.sep).join('/')
      j[key][dep] = `file:${relPath}`
      changed = true
    }
  }
  if (changed) {
    writeFileSync(pj, JSON.stringify(j, null, 2) + '\n')
    patched++
  }
}
console.log(`[patch-workspace-refs] 改写 ${patched} 个包的 workspace: 引用`)
