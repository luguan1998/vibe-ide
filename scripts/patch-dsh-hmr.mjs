// Idempotent patch of the cordis HMR service for packaged runtime:
// under Electron RUN_AS_NODE (Node 22, no --expose-internals) the internal
// loader is unavailable; HMR is a dev-only watcher, so register a dormant
// service instead of failing the whole dsh boot.
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const FILE = join(process.cwd(), 'vendor', 'harness', 'vendor', 'hmr', 'lib', 'index.js')
const MARKER = 'INACTIVE_EFFECT'

const CTOR_OLD = 'if (!this.ctx.loader.internal) throw new Error("--expose-internals is required for HMR service");'
const CTOR_NEW = 'if (!this.ctx.loader.internal) {\r\n\t\tthis.internal = void 0;\r\n\t\tthis.baseDir = fileURLToPath(new URL(config.base || ".", ctx.baseUrl));\r\n\t\treturn;\r\n\t}'

const REG_OLD = 'if (!this.watcher) throw new Error("HMR is not active");'
const REG_NEW = 'if (!this.watcher) throw Object.assign(new Error("HMR is not active"), { code: "INACTIVE_EFFECT" });'

const INIT_OLD = 'async *[Service.init]() {\r\n\t\tyield async () => {'
const INIT_NEW = 'async *[Service.init]() {\r\n\t\tif (!this.internal) return;\r\n\t\tyield async () => {'

function apply(search, replacement, marker) {
  const src = readFileSync(FILE, 'utf-8')
  if (src.includes(marker)) return
  if (!src.includes(search)) throw new Error(`patch-dsh-hmr: pattern not found in ${FILE}`)
  writeFileSync(FILE, src.replace(search, replacement))
  console.log(`[patch-dsh-hmr] patched ${FILE}`)
}

apply(CTOR_OLD, CTOR_NEW, 'this.internal = void 0')
apply(REG_OLD, REG_NEW, MARKER)
apply(INIT_OLD, INIT_NEW, 'if (!this.internal) return;')
