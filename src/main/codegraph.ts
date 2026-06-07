import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { IPC_CHANNELS } from '../shared/types'
import { CodeGraph } from '@colbymchenry/codegraph'

let cg: CodeGraph | null = null
let currentWorkspace: string | null = null

// Paths to the platform bundle's bundled Node 24 + CLI entry
// Using the bundled Node avoids Electron's V8 Zone OOM during indexing
const platformTarget = process.platform + '-' + process.arch
const bundleDir = join(__dirname, '../../node_modules/@colbymchenry/codegraph-' + platformTarget)
const bundledNode = join(bundleDir, process.platform === 'win32' ? 'node.exe' : 'bin/node')
const cliEntry = join(bundleDir, 'lib/dist/bin/codegraph.js')

function runCodeGraphCli(args: string[], onProgress?: (p: any) => void): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bundledNode, ['--liftoff-only', cliEntry, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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
      if (code === 0) resolve({ success: true })
      else resolve({ success: false, error: stderr || `exit ${code}` })
    })
    proc.on('error', (err) => resolve({ success: false, error: err.message }))
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
    if (!CodeGraph.isInitialized(root)) {
      return { success: false, error: 'NOT_INITIALIZED' }
    }
    cg = await CodeGraph.open(root)
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
      return { initialized: CodeGraph.isInitialized(root) }
    } catch (err: any) {
      return { initialized: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_INIT, async (event, root: string) => {
    try {
      if (cg) { cg.close(); cg = null; currentWorkspace = null }
      // Use the bundled Node 24 CLI to init + index — avoids Electron V8 Zone OOM
      const push = (p: any) => { try { event.sender.send(IPC_CHANNELS.CODE_PROGRESS, p) } catch {} }
      const r1 = await runCodeGraphCli(['init', root, '--verbose'], push)
      if (!r1.success) return { error: r1.error || 'init failed' }
      const r2 = await runCodeGraphCli(['index', root, '--verbose'], push)
      if (!r2.success) return { error: r2.error || 'index failed' }
      // Open in-process for subsequent queries
      cg = await CodeGraph.open(root)
      currentWorkspace = root
      try { cg.watch() } catch {}
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
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

}

export function closeCodeGraph(): void {
  if (cg) {
    cg.close()
    cg = null
    currentWorkspace = null
  }
}
