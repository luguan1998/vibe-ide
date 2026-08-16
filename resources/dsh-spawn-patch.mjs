// dsh 子进程 spawn 路径重写：RUN_AS_NODE 下 Electron 不会把 app.asar 内的
// 可执行文件自动重定向到 app.asar.unpacked（完整模式下才有），而 Windows
// CreateProcess 无法执行 asar 单文件内的 exe —— @vscode/ripgrep 的 rg.exe
// 已由 electron-builder asarUnpack 解包到 app.asar.unpacked，这里把
// `app.asar/...` 前缀的 file 参数重写到 unpacked 真实路径（存在才重写）。
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const cp = require('node:child_process')

const ASAR_RE = /^(.*app\.asar)([\\/].*)$/i

function toUnpacked(file) {
  if (typeof file !== 'string') return file
  const m = ASAR_RE.exec(file)
  if (!m) return file
  const unpacked = `${m[1]}.unpacked${m[2]}`
  return existsSync(unpacked) ? unpacked : file
}

const wrap = (fn) => function (file, ...rest) {
  return fn.call(this, toUnpacked(file), ...rest)
}

cp.spawn = wrap(cp.spawn)
cp.spawnSync = wrap(cp.spawnSync)
cp.execFile = wrap(cp.execFile)
cp.execFileSync = wrap(cp.execFileSync)
