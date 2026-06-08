import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { IPC_CHANNELS } from '../shared/types'

let cg: any = null
let currentWorkspace: string | null = null
let CodeGraphClass: any = null
let initProc: any = null
let initCancelled = false

async function getCodeGraph(): Promise<any> {
  if (!CodeGraphClass) {
    try {
      const mod = await import('@colbymchenry/codegraph')
      // CJS re-export via module.exports = require(...) may place named exports
      // under .default in the ESM namespace, depending on Node version / asar env
      CodeGraphClass = mod.CodeGraph ?? mod.default?.CodeGraph ?? mod.default
    } catch (err: any) {
      console.error('Failed to load @colbymchenry/codegraph:', err.message)
      throw err
    }
  }
  return CodeGraphClass
}

// Resolve the platform bundle directory. In dev, the bundle is at the top-level
// node_modules (npm hoisted). In the packaged app, electron-builder nests it
// inside the parent codegraph package's node_modules/.
// When asarUnpack is used, files live in app.asar.unpacked/ — __dirname still
// resolves to app.asar/..., so we must check the .unpacked equivalent first.
function resolvePlatformBundle(): string {
  const pkgName = 'codegraph-' + process.platform + '-' + process.arch
  const fs = require('fs')

  // Helper: if a path is inside app.asar, also check app.asar.unpacked
  function tryPath(dir: string): boolean {
    if (fs.existsSync(dir)) return true
    const unpacked = dir.replace('app.asar', 'app.asar.unpacked')
    return unpacked !== dir && fs.existsSync(unpacked)
  }
  function resolvePath(dir: string): string {
    const unpacked = dir.replace('app.asar', 'app.asar.unpacked')
    if (unpacked !== dir && fs.existsSync(unpacked)) return unpacked
    return dir
  }

  // Try top-level layout first (dev mode)
  const flatDir = join(__dirname, '../../node_modules/@colbymchenry', pkgName)
  if (tryPath(flatDir)) return resolvePath(flatDir)

  // Try nested layout (packaged app)
  const nestedDir = join(__dirname, '../../node_modules/@colbymchenry/codegraph/node_modules/@colbymchenry', pkgName)
  if (tryPath(nestedDir)) return resolvePath(nestedDir)

  // Last resort: use require.resolve from within the @colbymchenry/codegraph context
  try {
    const codegraphMain = require.resolve('@colbymchenry/codegraph/package.json')
    const nested = join(dirname(codegraphMain), 'node_modules/@colbymchenry', pkgName)
    if (tryPath(nested)) return resolvePath(nested)
  } catch {}

  return flatDir // fall back to dev layout even if it doesn't exist
}

let cliDepsRestored = false

/** Ensure ESM deps (web-tree-sitter etc) are physically present under lib/node_modules/.
 *  NODE_PATH is useless for ESM imports, so the deps must be on disk where the
 *  import resolver can walk up from the CLI entry and find them. */
function ensureCliDeps(bundleDir: string): void {
  if (cliDepsRestored) return
  const libNM = join(bundleDir, 'lib', 'node_modules')
  const fs = require('fs')
  // Already present — nothing to do
  if (fs.existsSync(join(libNM, 'web-tree-sitter'))) { cliDepsRestored = true; return }
  // Packaged app: copy from extraResources/codegraph-platform-deps
  try {
    const src = join(process.resourcesPath, 'codegraph-platform-deps')
    if (fs.existsSync(src) && fs.existsSync(join(src, 'web-tree-sitter'))) {
      fs.mkdirSync(libNM, { recursive: true })
      for (const entry of fs.readdirSync(src)) {
        if (!fs.existsSync(join(libNM, entry))) {
          fs.cpSync(join(src, entry), join(libNM, entry), { recursive: true })
        }
      }
      cliDepsRestored = true
    }
  } catch { /* dev mode — resourcesPath not available */ }
}

function runCodeGraphCli(args: string[], onProgress?: (p: any) => void, cwd?: string, isInit?: boolean): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const bundleDir = resolvePlatformBundle()
    const bundledNode = join(bundleDir, process.platform === 'win32' ? 'node.exe' : 'bin/node')
    const cliEntry = join(bundleDir, 'lib/dist/bin/codegraph.js')
    ensureCliDeps(bundleDir)
    const proc = spawn(bundledNode, ['--liftoff-only', cliEntry, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    })
    if (isInit) initProc = proc
    let stderr = ''
    let outBuf = ''
    proc.stdout?.on('data', (d: Buffer) => {
      outBuf += d.toString()
      // Parse verbose progress lines: "[Xs] Phase: name" or "[Xs]   current/total (pct%)"
      const lines = outBuf.split('\n')
      outBuf = lines.pop() || '' // keep incomplete last line
      for (const line of lines) {
        const phaseMatch = line.match(/^\[\d+\.?\d*s\]\s+Phase:\s+(.+)$/)
        if (phaseMatch) { onProgress?.({ phase: phaseMatch[1], current: 0, total: 0 }); continue }
        const progMatch = line.match(/^\[\d+\.?\d*s\]\s+(\d+)\/(\d+)\s+\((\d+)%\)/)
        if (progMatch) { onProgress?.({ phase: '', current: parseInt(progMatch[1]), total: parseInt(progMatch[2]) }); continue }
        const scanMatch = line.match(/^\[\d+\.?\d*s\]\s+(.+)\s+files found$/)
        if (scanMatch) { onProgress?.({ phase: 'scanning', current: 0, total: 0 }); continue }
      }
    })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (isInit) initProc = null
      if (initCancelled) resolve({ success: false, error: 'cancelled' })
      else if (code === 0) resolve({ success: true })
      else resolve({ success: false, error: stderr || `exit ${code}` })
    })
    proc.on('error', (err) => { if (isInit) initProc = null; resolve({ success: false, error: err.message }) })
  })
}

/** Normalize a Node from CodeGraph to the serializable format the renderer expects */
function normalizeNode(n: any): any {
  if (!n) return n
  return {
    id: n.id,
    name: n.name,
    kind: n.kind,
    filePath: n.filePath,
    line: n.startLine ?? n.line,
    column: n.startColumn ?? n.column,
    endLine: n.endLine,
    endColumn: n.endColumn,
    signature: n.signature,
    language: n.language,
    visibility: n.visibility,
    isExported: n.isExported,
  }
}

async function ensureOpen(root: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (cg && currentWorkspace === root) return { success: true }
    if (cg) {
      cg.close()
      cg = null
      currentWorkspace = null
    }
    const CG = await getCodeGraph()
    if (!CG.isInitialized(root)) {
      return { success: false, error: 'NOT_INITIALIZED' }
    }
    cg = await CG.open(root)
    currentWorkspace = root
    try { cg.watch() } catch { /* watcher may not be available */ }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export function registerCodeGraphHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CODE_SET_WORKSPACE, async (_event, root: string) => {
    if (typeof root !== 'string' || !root) return { error: 'Invalid workspace path' }
    return await ensureOpen(root)
  })

  ipcMain.handle(IPC_CHANNELS.CODE_IS_INITIALIZED, async (_event, root: string) => {
    try {
      const CG = await getCodeGraph()
      return { initialized: CG.isInitialized(root) }
    } catch (err: any) {
      return { initialized: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_INIT, async (event, root: string) => {
    try {
      if (cg) { cg.close(); cg = null; currentWorkspace = null }
      initCancelled = false
      initProc = null
      const push = (p: any) => { try { event.sender.send(IPC_CHANNELS.CODE_PROGRESS, p) } catch {} }
      const r1 = await runCodeGraphCli(['init', root, '--verbose'], push, undefined, true)
      if (initCancelled) return { error: 'cancelled' }
      if (!r1.success) return { error: r1.error || 'init failed' }
      const r2 = await runCodeGraphCli(['index', root, '--verbose'], push, undefined, true)
      if (initCancelled) return { error: 'cancelled' }
      if (!r2.success) return { error: r2.error || 'index failed' }
      // Open in-process for subsequent queries
      const CG = await getCodeGraph()
      cg = await CG.open(root)
      currentWorkspace = root
      try { cg.watch() } catch {}
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_CANCEL_INIT, async () => {
    if (initProc) {
      initCancelled = true
      try { initProc.kill() } catch {}
      initProc = null
    }
    return { cancelled: true }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_SEARCH_NODES, async (_event, query: string, opts?: { limit?: number; kinds?: string[]; excludePatterns?: string[] }) => {
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [], total: 0 }
    try {
      const results = cg.searchNodes(query, opts)
      const nodes = (results || []).slice(0, opts?.limit || 200).map((r: any) => normalizeNode(r.node || r))
      return { nodes, total: nodes.length }
    } catch (err: any) {
      return { error: err.message, nodes: [], total: 0 }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_CALLERS, async (_event, id: string, maxDepth?: number) => {
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [] }
    try {
      const callers = cg.getCallers(id, maxDepth || 1)
      return { nodes: (callers || []).map((item: any) => ({ ...item, node: normalizeNode(item.node) })) }
    } catch (err: any) {
      return { error: err.message, nodes: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_CALLEES, async (_event, id: string, maxDepth?: number) => {
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [] }
    try {
      const callees = cg.getCallees(id, maxDepth || 1)
      return { nodes: (callees || []).map((item: any) => ({ ...item, node: normalizeNode(item.node) })) }
    } catch (err: any) {
      return { error: err.message, nodes: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_CALL_GRAPH, async (_event, id: string, depth?: number) => {
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [], edges: [] }
    try {
      const sub = cg.getCallGraph(id, depth || 4)
      const nodes: any[] = []
      if (sub.nodes) {
        sub.nodes.forEach((n: any) => nodes.push(normalizeNode(n)))
      }
      const edges = (sub.edges || []).map((e: any) => ({
        fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, kind: e.kind
      }))
      return { nodes, edges }
    } catch (err: any) {
      return { error: err.message, nodes: [], edges: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_IS_INDEXING, async () => {
    if (!cg) return { isIndexing: false }
    try {
      return { isIndexing: cg.isIndexing() }
    } catch (err: any) {
      return { isIndexing: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_STATS, async () => {
    if (!cg) return { error: 'CodeGraph not initialized' }
    try {
      return cg.getStats()
    } catch (err: any) {
      return { error: err.message }
    }
  })

ipcMain.handle(IPC_CHANNELS.CODE_INSTALL_MCP, async (_event, targets: string[], workspacePath: string) => {
    try {
      const targetFlag = targets.length > 0 ? targets.join(',') : 'none'
      const r = await runCodeGraphCli(['install', '--target', targetFlag, '--location', 'local', '--yes'], undefined, workspacePath)
      if (!r.success) return { success: false, error: r.error || 'install mcp failed' }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

}

export function closeCodeGraph(): void {
  if (cg) {
    cg.close()
    cg = null
    currentWorkspace = null
  }
}
