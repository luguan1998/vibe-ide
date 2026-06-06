import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import { CodeGraph } from '@colbymchenry/codegraph'

let cg: CodeGraph | null = null
let currentWorkspace: string | null = null

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
    parentName: n.parentName,
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

  ipcMain.handle(IPC_CHANNELS.CODE_INIT, async (_event, root: string) => {
    try {
      if (cg) { cg.close(); cg = null; currentWorkspace = null }
      cg = await CodeGraph.init(root, { index: true })
      currentWorkspace = root
      try { cg.watch() } catch { /* watcher may not be available */ }
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

  ipcMain.handle(IPC_CHANNELS.CODE_GET_NODE, async (_event, id: string) => {
    if (!cg) return { error: 'CodeGraph not initialized' }
    try {
      const node = cg.getNode(id)
      return { node: normalizeNode(node) }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODE_GET_NODES_IN_FILE, async (_event, filePath: string) => {
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [] }
    try {
      const nodes = cg.getNodesInFile(filePath)
      return { nodes: (nodes || []).map(normalizeNode) }
    } catch (err: any) {
      return { error: err.message, nodes: [] }
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

  ipcMain.handle(IPC_CHANNELS.CODE_FIND_USAGES, async (_event, id: string) => {
    if (!cg) return { error: 'CodeGraph not initialized', nodes: [] }
    try {
      const usages = cg.findUsages(id)
      return { nodes: (usages || []).map((item: any) => ({ ...item, node: normalizeNode(item.node) })) }
    } catch (err: any) {
      return { error: err.message, nodes: [] }
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

  ipcMain.handle(IPC_CHANNELS.CODE_CLOSE, async () => {
    if (cg) {
      cg.close()
      cg = null
      currentWorkspace = null
    }
    return { success: true }
  })
}

export function closeCodeGraph(): void {
  if (cg) {
    cg.close()
    cg = null
    currentWorkspace = null
  }
}
