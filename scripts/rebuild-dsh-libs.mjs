import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 重建 vendor/harness 受改包的 lib/{index,invariant}.js。上游用 tsdown，vibe 无 tsdown，
// 用 esbuild --bundle 从 src 打包成 ESM。
// 陷阱(必踩): node_modules/@deepseek-ai/* 是 junction(realpath 在 node_modules 外)，
// 单用 packages:'external' esbuild 会判定非包而内联(cosmokit 实测被打入)，
// 必须显式 external '@deepseek-ai/*' + 'node:*'。防呆: build 后 grep cosmokit 不得出现。
const root = fileURLToPath(new URL('..', import.meta.url).href)
const V = join(root, 'vendor', 'harness')

const PKGS = [
  'packages/terminal/terminal-bash',
  'packages/shell/tool-bash-persistent',
  'packages/llm/llm-deepseek',
  'packages/subagent/tool-subagent',
  'packages/client/ui-settings-plugins',
  'packages/host/apiproxy',
  'packages/attachment/attachment',
  'packages/core/tools',
  'packages/fs/tool-fs',
  'packages/mcp/mcp-client',
  'packages/extensions/tool-cordis',
  'packages/client/ui-user-questions',
]

let ok = 0, skip = 0, fail = 0
for (const rel of PKGS) {
  const dir = join(V, rel)
  for (const entry of ['index', 'invariant']) {
    const src = join(dir, 'src', `${entry}.ts`)
    if (!existsSync(src)) { skip++; continue }
    const out = join(dir, 'lib', `${entry}.js`)
    try {
      await build({
        entryPoints: [src],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'es2022',
        packages: 'external',
        external: ['@deepseek-ai/*', 'node:*'],
        outfile: out,
        logLevel: 'warning',
      })
      ok++
    } catch (e) {
      console.error(`[rebuild] FAIL ${rel} src/${entry}.ts: ${e.message ?? e}`)
      fail++
    }
  }
}
console.log(`[rebuild-dsh-libs] ok=${ok} skip=${skip} fail=${fail}`)
if (fail > 0) process.exit(1)
