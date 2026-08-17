// Rebuild the two vendored harness artifacts that are NOT committed to git:
//   1. landlock-run/packages/entry/lib/   (landlock-run/.gitignore: packages/*/lib/)
//   2. apps/web/dist/                     (never committed)
// Missing either one makes the dsh subprocess fail to boot with
// ERR_MODULE_NOT_FOUND, which src/main/dsh.ts waitForPort then surfaces as a
// misleading "dsh server start timeout" (it waits the full 30s for the ready
// line instead of reporting the immediate crash). Run automatically by
// postinstall so a fresh `npm ci` on any machine yields a working dsh.
//
// Idempotent: skips an artifact that already exists.
// Vendored packages use file: specs (patched by patch-workspace-refs.mjs for
// npm) — use npm, NOT pnpm (pnpm rejects file: in peerDependencies).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url).href)
const tsc = join(root, 'node_modules/typescript/bin/tsc')

const landlockTsconfig = join(root, 'vendor/harness/native/landlock-run/packages/entry/tsconfig.json')
const landlockLib = join(root, 'vendor/harness/native/landlock-run/packages/entry/lib/index.js')

const webDir = join(root, 'vendor/harness/apps/web')
const webDist = join(webDir, 'dist/index.html')

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error(`[build-vendored-dsh] failed: ${cmd} ${args.join(' ')} (exit ${r.status})`)
    process.exit(r.status ?? 1)
  }
}

// 1. landlock-run lib/ — pure-JS seam; Windows doesn't use landlock at runtime,
//    but dsh-sandbox-local imports the module unconditionally at boot.
if (existsSync(landlockTsconfig) && !existsSync(landlockLib)) {
  console.log('[build-vendored-dsh] building landlock-run lib (tsc -b)...')
  run('node', [tsc, '-b', landlockTsconfig])
} else {
  console.log('[build-vendored-dsh] landlock-run lib already present, skip')
}

// 2. apps/web dist/ — dsh web frontend (vite build compiles vendored client
//    src/ directly; no build:lib needed — client src is committed, lib is not
//    used by the browser bundle).
if (existsSync(join(webDir, 'package.json')) && !existsSync(webDist)) {
  console.log('[build-vendored-dsh] installing apps/web deps (npm install --ignore-scripts)...')
  run('npm', ['install', '--prefix', webDir, '--ignore-scripts', '--no-audit', '--no-fund'])
  console.log('[build-vendored-dsh] building apps/web dist (vite build)...')
  run('npm', ['run', '--prefix', webDir, 'build'])
} else {
  console.log('[build-vendored-dsh] apps/web dist already present, skip')
}

console.log('[build-vendored-dsh] done')
