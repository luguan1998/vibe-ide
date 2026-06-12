import { ipcMain, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import * as fs from 'fs'
import { IPC_CHANNELS } from '../shared/types'
import * as jsoncParser from 'jsonc-parser'

let cg: any = null
let currentWorkspace: string | null = null
let initWorkspace: string | null = null
let cgEnabled = true
let CodeGraphClass: any = null
let initProc: any = null
let initCancelled = false
let customWatcher: fs.FSWatcher | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null
let isRebuilding = false
let pendingRebuild = false

/** Delete the .codegraph directory to clean up partial/corrupted index data */
function cleanupCodeGraphDir(root: string): void {
  const dir = join(root, '.codegraph')
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      console.log('[codegraph] cleaned up partial index:', dir)
    }
  } catch (err: any) {
    console.error('[codegraph] cleanup failed:', err.message)
  }
}

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

/** Start custom fs.watch watcher. Replaces cg.watch() to avoid in-process sync blocking the main event loop.
 *  On file change, debounce 3s then trigger rebuildViaCli (CLI subprocess, non-blocking). */
function startCustomWatcher(root: string): void {
  stopCustomWatcher()
  const DEBOUNCE_MS = 3000
  try {
    customWatcher = fs.watch(root, { recursive: true }, () => {
      if (syncTimer) clearTimeout(syncTimer)
      syncTimer = setTimeout(() => {
        syncTimer = null
        if (isRebuilding) { pendingRebuild = true; return }
        if (!cgEnabled || !cg) return
        rebuildViaCli(root)
      }, DEBOUNCE_MS)
    })
  } catch (err: any) {
    console.error('[codegraph] watcher start failed:', err.message)
  }
}

function stopCustomWatcher(): void {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
  if (customWatcher) { try { customWatcher.close() } catch {} ; customWatcher = null }
  pendingRebuild = false
}

/** Rebuild via CLI subprocess (non-blocking). Closes in-process instance, runs sync/index in subprocess, then reopens for queries. */
async function rebuildViaCli(root: string): Promise<void> {
  if (isRebuilding || !cgEnabled || initProc) return
  isRebuilding = true
  stopCustomWatcher()
  if (cg) {
    try { cg.close() } catch {}
    cg = null
    currentWorkspace = null
  }
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.CODE_PROGRESS, { phase: 'auto-sync', current: 0, total: 0 })
    }
  } catch {}
  let result = await runCodeGraphCli(['sync', root, '--verbose'])
  if (!result.success) {
    result = await runCodeGraphCli(['index', root, '--verbose'])
  }
  if (result.success) {
    try {
      const CG = await getCodeGraph()
      cg = await CG.open(root)
      currentWorkspace = root
      startCustomWatcher(root)
    } catch (err: any) {
      console.error('[codegraph] reopen after sync failed:', err.message)
      cg = null
      currentWorkspace = null
    }
  } else {
    console.error('[codegraph] CLI rebuild failed:', result.error)
  }
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.CODE_PROGRESS, null)
    }
  } catch {}
  isRebuilding = false
  if (pendingRebuild && cg && currentWorkspace === root) {
    pendingRebuild = false
    setTimeout(() => rebuildViaCli(root), 2000)
  } else {
    pendingRebuild = false
  }
}

async function ensureOpen(root: string): Promise<{ success: boolean; error?: string }> {
  if (!cgEnabled) return { success: false, error: 'DISABLED' }
  if (isRebuilding) return { success: false, error: 'REBUILDING' }
  try {
    if (cg && currentWorkspace === root) return { success: true }
    stopCustomWatcher()
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
    startCustomWatcher(root)
    return { success: true }
  } catch (err: any) {
    stopCustomWatcher()
    cleanupCodeGraphDir(root)
    cg = null
    currentWorkspace = null
    return { success: false, error: err.message }
  }
}

export function registerCodeGraphHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CODE_SET_WORKSPACE, async (_event, root: string) => {
    if (typeof root !== 'string' || !root) return { error: 'Invalid workspace path' }
    return await ensureOpen(root)
  })

  ipcMain.handle(IPC_CHANNELS.CODE_SET_ENABLED, async (_event, enabled: boolean) => {
    cgEnabled = enabled
    if (!enabled) {
      stopCustomWatcher()
      if (cg) {
        try { cg.close() } catch {}
        cg = null
        currentWorkspace = null
      }
    }
    return { enabled: cgEnabled }
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
      stopCustomWatcher()
      if (cg) { cg.close(); cg = null; currentWorkspace = null }
      initCancelled = false
      initWorkspace = root
      initProc = null
      const push = (p: any) => { try { event.sender.send(IPC_CHANNELS.CODE_PROGRESS, p) } catch {} }
      const r1 = await runCodeGraphCli(['init', root, '--verbose'], push, undefined, true)
      if (initCancelled) { cleanupCodeGraphDir(root); initWorkspace = null; return { error: 'cancelled' } }
      if (!r1.success) { cleanupCodeGraphDir(root); initWorkspace = null; return { error: r1.error || 'init failed' } }
      const r2 = await runCodeGraphCli(['index', root, '--verbose'], push, undefined, true)
      if (initCancelled) { cleanupCodeGraphDir(root); initWorkspace = null; return { error: 'cancelled' } }
      if (!r2.success) { cleanupCodeGraphDir(root); initWorkspace = null; return { error: r2.error || 'index failed' } }
      // Open in-process for subsequent queries
      const CG = await getCodeGraph()
      cg = await CG.open(root)
      currentWorkspace = root
      initWorkspace = null
      startCustomWatcher(root)
      return { success: true }
    } catch (err: any) {
      cleanupCodeGraphDir(root)
      initWorkspace = null
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_CANCEL_INIT, async () => {
    if (initProc) {
      initCancelled = true
      try {
        // On Windows, force-kill the entire process tree (CLI may spawn tree-sitter workers)
        if (process.platform === 'win32' && initProc.pid) {
          spawn('taskkill', ['/pid', String(initProc.pid), '/f', '/t'], { stdio: 'ignore' })
        } else {
          initProc.kill('SIGKILL')
        }
      } catch {}
      initProc = null
    }
    stopCustomWatcher()
    // Reset in-process state
    if (cg) {
      try { cg.close() } catch {}
      cg = null
      currentWorkspace = null
    }
    // Clean up partial index data so next attempt starts fresh
    const ws = initWorkspace || currentWorkspace
    if (ws) cleanupCodeGraphDir(ws)
    initWorkspace = null
    return { cancelled: true }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_SEARCH_NODES, async (_event, query: string, opts?: { limit?: number; kinds?: string[]; excludePatterns?: string[]; filePath?: string }) => {
    if (isRebuilding) return { error: 'rebuilding', nodes: [], total: 0 }
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [], total: 0 }
    try {
      const searchOpts = { ...opts }
      if (opts?.filePath) delete searchOpts.filePath
      const results = cg.searchNodes(query, searchOpts)
      let nodes = (results || []).slice(0, opts?.limit || 200).map((r: any) => normalizeNode(r.node || r))
      if (opts?.filePath) {
        nodes = nodes.filter(n => n.filePath === opts.filePath)
      }
      return { nodes, total: nodes.length }
    } catch (err: any) {
      return { error: err.message, nodes: [], total: 0 }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_CALLERS, async (_event, id: string, maxDepth?: number) => {
    if (isRebuilding) return { error: 'rebuilding', nodes: [] }
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [] }
    try {
      const callers = cg.getCallers(id, maxDepth || 1)
      return { nodes: (callers || []).map((item: any) => ({ ...item, node: normalizeNode(item.node) })) }
    } catch (err: any) {
      return { error: err.message, nodes: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_CALLEES, async (_event, id: string, maxDepth?: number) => {
    if (isRebuilding) return { error: 'rebuilding', nodes: [] }
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [] }
    try {
      const callees = cg.getCallees(id, maxDepth || 1)
      return { nodes: (callees || []).map((item: any) => ({ ...item, node: normalizeNode(item.node) })) }
    } catch (err: any) {
      return { error: err.message, nodes: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_CALL_GRAPH, async (_event, id: string, depth?: number) => {
    if (isRebuilding) return { error: 'rebuilding', nodes: [], edges: [] }
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [], edges: [] }
    try {
      const sub = cg.getCallGraph(id, depth || 4)
      const nodes: any[] = []
      if (sub.nodes) {
        sub.nodes.forEach((n: any) => nodes.push(normalizeNode(n)))
      }
      const edges = (sub.edges || []).map((e: any) => ({
        source: e.source, target: e.target, kind: e.kind
      }))
      return { nodes, edges }
    } catch (err: any) {
      return { error: err.message, nodes: [], edges: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_IS_INDEXING, async () => {
    if (isRebuilding) return { isIndexing: true }
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
      const fs = require('fs')
      const bundleDir = resolvePlatformBundle()
      const bundledNode = join(bundleDir, process.platform === 'win32' ? 'node.exe' : 'bin/node')
      const cliEntry = join(bundleDir, 'lib/dist/bin/codegraph.js')
      // Claude Code config: { type: 'stdio', command: node, args: [...] }
      const claudeConfig = {
        type: 'stdio',
        command: bundledNode,
        args: ['--liftoff-only', cliEntry, 'serve', '--mcp'],
      }
      // Opencode config: { type: 'local', command: [...], enabled: true }
      const opencodeConfig = {
        type: 'local',
        command: [bundledNode, '--liftoff-only', cliEntry, 'serve', '--mcp'],
        enabled: true,
      }
      const errors: string[] = []

      for (const target of targets) {
        if (target === 'claude') {
          const file = join(workspacePath, '.mcp.json')
          let existing: any = {}
          if (fs.existsSync(file)) {
            try { existing = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { existing = {} }
          }
          if (!existing.mcpServers) existing.mcpServers = {}
          existing.mcpServers.codegraph = claudeConfig
          fs.writeFileSync(file, JSON.stringify(existing, null, 2))
        } else if (target === 'opencode') {
          // local config file: opencode.json or opencode.jsonc
          const jsoncPath = join(workspacePath, 'opencode.jsonc')
          const jsonPath = join(workspacePath, 'opencode.json')
          let file = fs.existsSync(jsoncPath) ? jsoncPath : (fs.existsSync(jsonPath) ? jsonPath : jsoncPath)
          let text = ''
          if (fs.existsSync(file)) {
            text = fs.readFileSync(file, 'utf-8')
          }
          if (!text.trim()) {
            text = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
          }
          // Use jsonc-parser to preserve comments and formatting
          const edits = jsoncParser.modify(text, ['mcp', 'codegraph'], opencodeConfig, {
            formattingOptions: { tabSize: 2, insertSpaces: true, eol: '\n' },
          })
          text = jsoncParser.applyEdits(text, edits)
          // Ensure $schema exists
          const config = jsoncParser.parse(text, undefined, { allowTrailingComma: true })
          if (!config.$schema) {
            const schemaEdits = jsoncParser.modify(text, ['$schema'], 'https://opencode.ai/config.json', {
              formattingOptions: { tabSize: 2, insertSpaces: true, eol: '\n' },
            })
            text = jsoncParser.applyEdits(text, schemaEdits)
          }
          fs.writeFileSync(file, text)
        } else {
          // Other targets: still use CLI install (they may need global install or different format)
          const r = await runCodeGraphCli(['install', '--target', target, '--location', 'local', '--yes'], undefined, workspacePath)
          if (!r.success) errors.push(`${target}: ${r.error || 'install mcp failed'}`)
        }
      }

      if (errors.length > 0) return { success: false, error: errors.join('; ') }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_FIND_RELEVANT_CONTEXT, async (_event, query: string, opts?: any) => {
    if (isRebuilding) return { error: 'rebuilding', nodes: [], edges: [], roots: [], confidence: undefined }
    if (!cg) return { error: 'Not initialized', nodes: [], edges: [], roots: [], confidence: undefined }
    try {
      const subgraph = await cg.findRelevantContext(query, {
        searchLimit: opts?.searchLimit ?? 10,
        traversalDepth: opts?.traversalDepth ?? 2,
        maxNodes: opts?.maxNodes ?? 30,
      })
      const nodes: any[] = []
      if (subgraph.nodes) subgraph.nodes.forEach((n: any) => nodes.push(normalizeNode(n)))
      const edges = (subgraph.edges || []).map((e: any) => ({
        source: e.source, target: e.target, kind: e.kind,
        provenance: e.provenance, line: e.line, column: e.column,
      }))
      return { nodes, edges, roots: subgraph.roots || [], confidence: subgraph.confidence }
    } catch (err: any) {
      return { error: err.message, nodes: [], edges: [], roots: [], confidence: undefined }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_NODE_CODE, async (_event, nodeId: string) => {
    if (isRebuilding) return { error: 'rebuilding', code: null }
    if (!cg) return { error: 'Not initialized', code: null }
    try {
      const code = await cg.getCode(nodeId)
      return { code }
    } catch (err: any) {
      return { error: err.message, code: null }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_EXPLORE, async (_event, query: string, opts?: { maxFiles?: number }) => {
    if (isRebuilding) return { error: 'rebuilding', content: '' }
    if (!cg) return { error: 'Not initialized', content: '' }
    try {
      const bundleDir = resolvePlatformBundle()
      const { ToolHandler } = require(join(bundleDir, 'lib/dist/mcp/tools.js'))
      const handler = new ToolHandler(cg)
      const result = await handler.handleExplore({ query, maxFiles: opts?.maxFiles ?? 12 })
      const text = result.content?.[0]?.text || ''
      // 去掉 MCP 截断提示（IDE 浮窗不受 25K inline 限制）
      const marker = '... (output truncated to budget; the source above is complete and verbatim'
      const clean = text.includes(marker) ? text.slice(0, text.indexOf(marker)).trimEnd() : text
      return { content: clean }
    } catch (err: any) {
      return { error: err.message, content: '' }
    }
  })

}

export function closeCodeGraph(): void {
  stopCustomWatcher()
  isRebuilding = false
  if (cg) {
    try { cg.close() } catch {}
    cg = null
    currentWorkspace = null
  }
}
