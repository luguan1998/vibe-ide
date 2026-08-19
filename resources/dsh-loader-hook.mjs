// ESM resolve hook for the packaged dsh runtime: bare imports that fail to
// resolve from their own location (e.g. an out-of-tree plugin's import of a
// host @deepseek-ai/* package from $DSH_HOME/profiles) fall back to the
// installation's own node_modules — inside app.asar when packaged, the
// project root in dev. Runs under ELECTRON_RUN_AS_NODE so fs can read asar.
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const RESOLVERS = []
// 玩家插件装到 ~/.dsh/profiles/<profile>/node_modules，但 loader.internal 在
// ELECTRON_RUN_AS_NODE 下拿不到（见 patch-dsh-hmr），EntryTree.import 走 fallback
// import(name)（parentURL=caller=asar），bare specifier 解析不到 profile 装的插件 → host 崩。兜底 profile。
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileArg = process.argv.indexOf('--profile')
const profileName = profileArg >= 0 ? process.argv[profileArg + 1] : ''
if (profileName) {
  const profilePkg = join(dshHome, 'profiles', profileName, 'package.json')
  if (existsSync(profilePkg)) RESOLVERS.push(createRequire(profilePkg))
}

// hook 与 app.asar 同在 resources/（打包）；dev 时 hook 在项目 resources/，node_modules 在项目根
for (const anchor of [
  fileURLToPath(new URL('./app.asar/package.json', import.meta.url)),
  fileURLToPath(new URL('../package.json', import.meta.url)),
]) {
  if (existsSync(anchor)) RESOLVERS.push(createRequire(anchor))
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    if (specifier.startsWith('.') || specifier.startsWith('node:') || specifier.startsWith('file:')) throw error
    for (const req of RESOLVERS) {
      try {
        return { url: pathToFileURL(req.resolve(specifier)).href, shortCircuit: true }
      } catch {}
    }
    throw error
  }
}
