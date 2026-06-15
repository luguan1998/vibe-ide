import { ipcMain, BrowserWindow } from 'electron'
import { spawn, execSync } from 'child_process'
import { join, dirname } from 'path'
import * as fs from 'fs'
import { IPC_CHANNELS } from '../shared/types'
import * as jsoncParser from 'jsonc-parser'
import { onChanged } from './watcher'

let cg: any = null
let currentWorkspace: string | null = null
let cgEnabled = true
let CodeGraphClass: any = null
let initProc: any = null
let initCancelled = false
let initWorkspace: string | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null
let unsubWatcher: (() => void) | null = null
let isRebuilding = false
let pendingRebuild = false
let rebuildCooldownUntil = 0
let _moduleDirCache: string | null | undefined = undefined

const CODEGRAPH_REQUIRED_VERSION = '1.0.1'
const CODEGRAPH_INSTALL_CMD = `npm install -g @colbymchenry/codegraph@${CODEGRAPH_REQUIRED_VERSION}`

/** Check if codegraph CLI is available in PATH */
function isCodegraphCliAvailable(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where codegraph' : 'which codegraph'
    execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
    return true
  } catch { return false }
}

/** Find the codegraph npm package directory for in-process library loading.
 *  Searches: require.resolve, CLI binary location, npm global root, common paths.
 *  The package entry is npm-sdk.js (which internally resolves the platform bundle). */
function findCodegraphModuleDir(): string | null {
  if (_moduleDirCache !== undefined) return _moduleDirCache

  const sdkMarker = 'npm-sdk.js' // file that identifies a valid codegraph package

  // 1. require.resolve — works in dev mode with local install
  for (const pkgName of ['@colbymchenry/codegraph', 'codegraph']) {
    try {
      const pkgJsonPath = require.resolve(`${pkgName}/package.json`)
      const dir = dirname(pkgJsonPath)
      if (fs.existsSync(join(dir, sdkMarker))) {
        _moduleDirCache = dir
        return dir
      }
    } catch {}
  }

  // 2. Find from CLI binary path
  try {
    const cmd = process.platform === 'win32' ? 'where codegraph' : 'which codegraph'
    const cliPath = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0].trim()

    if (process.platform === 'win32') {
      // codegraph.cmd at <npm-global-bin>/codegraph.cmd
      // Package at <npm-global-bin>/node_modules/<pkgName>
      const binDir = dirname(cliPath)
      for (const pkgName of ['@colbymchenry/codegraph', 'codegraph']) {
        const pkgDir = join(binDir, 'node_modules', pkgName)
        if (fs.existsSync(join(pkgDir, sdkMarker))) {
          _moduleDirCache = pkgDir
          return pkgDir
        }
      }
    } else {
      // Resolve symlink on Unix to find actual package location
      try {
        const realPath = fs.realpathSync(cliPath)
        // e.g. /usr/local/lib/node_modules/codegraph/npm-shim.js → package root is dirname(realPath)
        const pkgDir = dirname(dirname(realPath))
        if (fs.existsSync(join(pkgDir, sdkMarker))) {
          _moduleDirCache = pkgDir
          return pkgDir
        }
      } catch {}

      // Fallback: common relative paths from bin dir
      const binDir = dirname(cliPath)
      const possibleRoots = [
        join(binDir, '..', 'lib', 'node_modules'),
        join(binDir, '..', 'node_modules'),
      ]
      for (const root of possibleRoots) {
        for (const pkgName of ['@colbymchenry/codegraph', 'codegraph']) {
          const pkgDir = join(root, pkgName)
          if (fs.existsSync(join(pkgDir, sdkMarker))) {
            _moduleDirCache = pkgDir
            return pkgDir
          }
        }
      }
    }
  } catch {}

  // 3. Try npm root -g
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8', timeout: 5000 }).trim()
    for (const pkgName of ['@colbymchenry/codegraph', 'codegraph']) {
      const pkgDir = join(globalRoot, pkgName)
      if (fs.existsSync(join(pkgDir, sdkMarker))) {
        _moduleDirCache = pkgDir
        return pkgDir
      }
    }
  } catch {}

  _moduleDirCache = null
  return null
}

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
    const moduleDir = findCodegraphModuleDir()
    if (!moduleDir) throw new Error(`CodeGraph module not found. Install: ${CODEGRAPH_INSTALL_CMD}`)
    const sdkJs = join(moduleDir, 'npm-sdk.js')
    try {
      // npm-sdk.js internally resolves the per-platform bundle and re-exports CodeGraph
      const mod = require(sdkJs)
      CodeGraphClass = mod.CodeGraph ?? mod.default?.CodeGraph ?? mod.default
    } catch (err: any) {
      console.error('[codegraph] Failed to load module from', sdkJs, err.message)
      throw err
    }
  }
  return CodeGraphClass
}

function runCodeGraphCli(args: string[], onProgress?: (p: any) => void, cwd?: string, isInit?: boolean): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('codegraph', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      shell: process.platform === 'win32',
    })
    if (isInit) initProc = proc
    let stderr = ''
    let stdout = ''
    let outBuf = ''
    proc.stdout?.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stdout += chunk
      outBuf += chunk
      const lines = outBuf.split('\n')
      outBuf = lines.pop() || ''
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
      else {
        const detail = stderr || stdout || `exit ${code}`
        console.error(`[codegraph] CLI stderr:`, stderr)
        resolve({ success: false, error: detail })
      }
    })
    proc.on('error', (err) => {
      if (isInit) initProc = null
      resolve({ success: false, error: err.message })
    })
  })
}

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

function startCodeGraphWatcher(root: string): void {
  stopCodeGraphWatcher()
  const DEBOUNCE_MS = 3000
  unsubWatcher = onChanged(() => {
    if (Date.now() < rebuildCooldownUntil) return
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      if (isRebuilding) { pendingRebuild = true; return }
      if (!cgEnabled || !cg) return
      rebuildViaCli(root)
    }, DEBOUNCE_MS)
  })
}

function stopCodeGraphWatcher(): void {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
  if (unsubWatcher) { unsubWatcher(); unsubWatcher = null }
  pendingRebuild = false
}

async function rebuildViaCli(root: string): Promise<void> {
  if (isRebuilding || !cgEnabled || initProc) return
  isRebuilding = true
  stopCodeGraphWatcher()
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
  let result = await runCodeGraphCli(['sync', root])
  if (!result.success) {
    result = await runCodeGraphCli(['index', root, '--verbose'])
  }
  if (result.success) {
    try {
      const CG = await getCodeGraph()
      cg = await CG.open(root)
      currentWorkspace = root
      startCodeGraphWatcher(root)
      rebuildCooldownUntil = Date.now() + 10_000
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
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.CODE_PROGRESS, { phase: 'auto-sync-done' })
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
  if (!isCodegraphCliAvailable()) return { success: false, error: 'NOT_INSTALLED' }
  if (isRebuilding) return { success: false, error: 'REBUILDING' }
  try {
    if (cg && currentWorkspace === root) return { success: true }
    stopCodeGraphWatcher()
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
    startCodeGraphWatcher(root)
    return { success: true }
  } catch (err: any) {
    stopCodeGraphWatcher()
    cleanupCodeGraphDir(root)
    cg = null
    currentWorkspace = null
    return { success: false, error: err.message }
  }
}

export function registerCodeGraphHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CODE_CHECK_AVAILABLE, async () => {
    const cliAvailable = isCodegraphCliAvailable()
    const moduleDir = findCodegraphModuleDir()
    return {
      cliAvailable,
      moduleAvailable: moduleDir !== null,
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_SET_WORKSPACE, async (_event, root: string) => {
    if (typeof root !== 'string' || !root) return { error: 'Invalid workspace path' }
    return await ensureOpen(root)
  })

  ipcMain.handle(IPC_CHANNELS.CODE_SET_ENABLED, async (_event, enabled: boolean) => {
    cgEnabled = enabled
    if (!enabled) {
      stopCodeGraphWatcher()
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
      if (!isCodegraphCliAvailable()) return { initialized: false, error: 'NOT_INSTALLED' }
      const CG = await getCodeGraph()
      return { initialized: CG.isInitialized(root) }
    } catch (err: any) {
      return { initialized: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_INIT, async (event, root: string) => {
    try {
      if (!isCodegraphCliAvailable()) return { error: `CodeGraph CLI not found. Install: ${CODEGRAPH_INSTALL_CMD}` }
      stopCodeGraphWatcher()
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
      const CG = await getCodeGraph()
      cg = await CG.open(root)
      currentWorkspace = root
      initWorkspace = null
      startCodeGraphWatcher(root)
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
        if (process.platform === 'win32' && initProc.pid) {
          spawn('taskkill', ['/pid', String(initProc.pid), '/f', '/t'], { stdio: 'ignore' })
        } else {
          initProc.kill('SIGKILL')
        }
      } catch {}
      initProc = null
    }
    stopCodeGraphWatcher()
    if (cg) {
      try { cg.close() } catch {}
      cg = null
      currentWorkspace = null
    }
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
      if (!isCodegraphCliAvailable()) return { success: false, error: 'CodeGraph CLI not found' }
      const claudeConfig = {
        type: 'stdio',
        command: 'codegraph',
        args: ['serve', '--mcp'],
      }
      const opencodeConfig = {
        type: 'local',
        command: ['codegraph', 'serve', '--mcp'],
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
          const edits = jsoncParser.modify(text, ['mcp', 'codegraph'], opencodeConfig, {
            formattingOptions: { tabSize: 2, insertSpaces: true, eol: '\n' },
          })
          text = jsoncParser.applyEdits(text, edits)
          const config = jsoncParser.parse(text, undefined, { allowTrailingComma: true })
          if (!config.$schema) {
            const schemaEdits = jsoncParser.modify(text, ['$schema'], 'https://opencode.ai/config.json', {
              formattingOptions: { tabSize: 2, insertSpaces: true, eol: '\n' },
            })
            text = jsoncParser.applyEdits(text, schemaEdits)
          }
          fs.writeFileSync(file, text)
        } else {
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

  ipcMain.handle(IPC_CHANNELS.CODE_EXPLORE, async (_event, query: string, opts?: { maxFiles?: number }) => {
    if (isRebuilding) return { error: 'rebuilding', content: '' }
    if (!cg) return { error: 'Not initialized', content: '' }
    try {
      const moduleDir = findCodegraphModuleDir()
      if (!moduleDir) return { error: 'CodeGraph module not found', content: '' }
      // npm-sdk.js resolves the platform bundle; the tools module lives inside it.
      // Try to find tools.js in the nested platform bundle.
      const platformPkg = `@colbymchenry/codegraph-${process.platform}-${process.arch}`
      const toolsPaths = [
        join(moduleDir, 'node_modules', platformPkg, 'lib/dist/mcp/tools.js'),
        join(moduleDir, 'dist/mcp/tools.js'),
      ]
      let toolsPath: string | null = null
      for (const p of toolsPaths) {
        if (fs.existsSync(p)) { toolsPath = p; break }
      }
      if (!toolsPath) return { error: 'CodeGraph MCP tools module not found', content: '' }
      const { ToolHandler } = require(toolsPath)
      const handler = new ToolHandler(cg)
      const result = await handler.handleExplore({ query, maxFiles: opts?.maxFiles ?? 12 })
      const text = result.content?.[0]?.text || ''
      const marker = '... (output truncated to budget; the source above is complete and verbatim'
      const clean = text.includes(marker) ? text.slice(0, text.indexOf(marker)).trimEnd() : text
      return { content: clean }
    } catch (err: any) {
      return { error: err.message, content: '' }
    }
  })
}

export function closeCodeGraph(): void {
  stopCodeGraphWatcher()
  isRebuilding = false
  if (cg) {
    try { cg.close() } catch {}
    cg = null
    currentWorkspace = null
  }
}
