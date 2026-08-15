// 一次性迁移：把 deepseek-harness 中 Vibe 用到的 @deepseek-ai/* 闭包源码复制进 vendor/harness/，
// 使项目不依赖外部绝对路径（换电脑 clone 即可用）。
// 闭包种子 = package.json 现有 file: 依赖 + apps/cli 的依赖；BFS 递归收集传递依赖。
// 第三方依赖（非 @deepseek-ai）收集到 vendor-harness-third-party.json，由 npm install 从 registry 安装。
import { readFileSync, readdirSync, existsSync, cpSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = 'E:/ai/deepseek-harness'
const VENDOR = path.join(root, 'vendor', 'harness')

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'))

// 定位 @deepseek-ai 包在 harness 中的目录（扫描 vendor/ 和 packages/ 下所有 package.json）
const locate = new Map()
for (const base of ['vendor', 'packages']) {
  const dir = path.join(HARNESS, base)
  if (!existsSync(dir)) continue
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name === '.git') continue
      const full = path.join(d, name)
      try {
        if (!existsSync(path.join(full, 'package.json'))) {
          if (lstatSync(full).isDirectory()) walk(full)
          continue
        }
      } catch {
        continue
      }
      try {
        const j = JSON.parse(readFileSync(path.join(full, 'package.json'), 'utf-8'))
        if (j.name?.startsWith('@deepseek-ai/')) {
          locate.set(j.name, { dir: full, rel: path.relative(HARNESS, full) })
        }
      } catch {}
    }
  }
  walk(dir)
}

// BFS 收集闭包
const seeds = new Set()
for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (spec.startsWith('file:') && name.startsWith('@deepseek-ai/')) seeds.add(name)
}
const cliPkg = path.join(HARNESS, 'apps', 'cli', 'package.json')
for (const name of Object.keys(JSON.parse(readFileSync(cliPkg, 'utf-8')).dependencies ?? {})) {
  if (name.startsWith('@deepseek-ai/')) seeds.add(name)
}

const queue = [...seeds]
const seen = new Set()
const thirdParty = new Map() // name -> version
const closure = []
while (queue.length > 0) {
  const name = queue.pop()
  if (seen.has(name)) continue
  seen.add(name)
  const info = locate.get(name)
  if (!info) {
    console.warn(`[vendor-harness] 未在 harness 中找到: ${name}`)
    continue
  }
  closure.push(info)
  const j = JSON.parse(readFileSync(path.join(info.dir, 'package.json'), 'utf-8'))
  for (const key of ['dependencies', 'peerDependencies']) {
    for (const [dep, ver] of Object.entries(j[key] ?? {})) {
      if (dep.startsWith('@deepseek-ai/')) {
        if (!seen.has(dep)) queue.push(dep)
      } else if (!ver.startsWith('workspace:') && !thirdParty.has(dep)) {
        // peer 依赖由宿主提供，跳过；实际版本从 harness 安装目录读取
        if (key === 'dependencies') thirdParty.set(dep, ver)
      }
    }
  }
}

// 复制源码到 vendor/harness（排除包内 node_modules / .git / tests 大件）
mkdirSync(VENDOR, { recursive: true })
let copied = 0
for (const { dir, rel } of closure) {
  const dest = path.join(VENDOR, rel)
  if (existsSync(dest)) continue
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(dir, dest, {
    recursive: true,
    filter: (s) => {
      const base = path.basename(s)
      return base !== 'node_modules' && base !== '.git' && base !== '.svn' && base !== '.hg'
    },
  })
  copied++
}

// 复制 apps/cli（node_modules 交由顶层解析，跳过）
const cliSrc = path.join(HARNESS, 'apps', 'cli')
const cliDest = path.join(VENDOR, 'apps', 'cli')
if (!existsSync(cliDest)) {
  cpSync(cliSrc, cliDest, {
    recursive: true,
    filter: (s) => {
      const base = path.basename(s)
      return base !== 'node_modules' && base !== '.git' && base !== 'tests'
    },
  })
  copied++
}

// 从 harness 实际安装目录读取第三方依赖真实版本（pnpm 布局）
for (const dep of thirdParty.keys()) {
  if (dep.startsWith('@deepseek-ai/')) continue
  for (const [, src] of locate) {
    const cand = path.join(src.dir, 'node_modules', dep)
    if (existsSync(cand)) {
      try {
        const j = JSON.parse(readFileSync(path.join(cand, 'package.json'), 'utf-8'))
        if (j.version) {
          thirdParty.set(dep, `^${j.version}`)
          break
        }
      } catch {}
    }
  }
}

writeFileSync(
  path.join(root, 'vendor-harness-third-party.json'),
  JSON.stringify(Object.fromEntries(thirdParty), null, 2),
)
console.log(`[vendor-harness] 闭包 ${seen.size} 个包，复制 ${copied} 个，第三方 ${thirdParty.size} 个`)
