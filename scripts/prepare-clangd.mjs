import { existsSync, mkdirSync } from 'fs'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const archive = join(root, 'vendor', 'clangd-23.1.2.7z')
const target = join(root, 'vendor', 'clangd')
const exe = join(target, 'bin', process.platform === 'win32' ? 'clangd.exe' : 'clangd')

if (existsSync(exe) || !existsSync(archive)) process.exit(0)

mkdirSync(target, { recursive: true })
const r = spawnSync(require('7zip-bin').path7za, ['x', archive, `-o${target}`, '-y'], { stdio: 'inherit' })
if (r.status !== 0) {
  console.error('clangd: extraction failed')
  process.exit(r.status ?? 1)
}
