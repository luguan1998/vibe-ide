import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { CodeSymbol } from '@shared/types'

interface CodeTabProps {
  workspacePath: string | null
  isActive?: boolean
  onNavigateToFile?: (filePath: string) => void
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
}

type CodeTabStatus = 'loading' | 'not-initialized' | 'indexing' | 'ready' | 'error'

const KIND_COLORS: Record<string, string> = {
  function: 'text-yellow-400',
  method: 'text-yellow-400',
  class: 'text-blue-400',
  interface: 'text-green-400',
  variable: 'text-purple-400',
  constant: 'text-orange-400',
  type: 'text-teal-400',
  component: 'text-pink-400',
}

function getKindColor(kind: string): string {
  return KIND_COLORS[kind] || 'text-ide-text-muted'
}

function CodeTab({ workspacePath, isActive, onNavigateToFile, onOpenFile }: CodeTabProps) {
  const [status, setStatus] = useState<CodeTabStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CodeSymbol[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedNode, setSelectedNode] = useState<CodeSymbol | null>(null)
  const [detailNodes, setDetailNodes] = useState<{ callers: any[]; callees: any[] }>({ callers: [], callees: [] })
  const [loadingDetail, setLoadingDetail] = useState(false)
  const pendingPathRef = useRef<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-dismiss error after 5s
  useEffect(() => {
    if (error) {
      if (errorTimer.current) clearTimeout(errorTimer.current)
      errorTimer.current = setTimeout(() => setError(null), 5000)
    }
    return () => { if (errorTimer.current) clearTimeout(errorTimer.current) }
  }, [error])

  // Initialize on workspace change
  useEffect(() => {
    if (!workspacePath || pendingPathRef.current === workspacePath) return
    pendingPathRef.current = workspacePath

    setStatus('loading')
    setQuery('')
    setSearchResults([])
    setSelectedNode(null)
    setError(null)

    const init = async () => {
      const targetPath = workspacePath
      try {
        const initResult = await window.api.code.isInitialized(targetPath)
        if (pendingPathRef.current !== targetPath) return
        if (initResult.error) { setStatus('error'); setError(initResult.error); return }
        if (!initResult.initialized) { setStatus('not-initialized'); return }

        const openResult = await window.api.code.setWorkspace(targetPath)
        if (pendingPathRef.current !== targetPath) return
        if (openResult.error) { setStatus('error'); setError(openResult.error); return }

        const idxResult = await window.api.code.isIndexing()
        if (pendingPathRef.current !== targetPath) return
        if (idxResult.error) { setStatus('error'); setError(idxResult.error); return }
        setStatus(idxResult.isIndexing ? 'indexing' : 'ready')
      } catch (err: any) {
        if (pendingPathRef.current !== targetPath) return
        setStatus('error')
        setError(err.message || 'Failed to initialize CodeGraph')
      }
    }
    init()
  }, [workspacePath])

  // Poll indexing status
  useEffect(() => {
    if (status !== 'indexing') return
    const id = setInterval(async () => {
      try {
        const result = await window.api.code.isIndexing()
        if (result.error) { setStatus('error'); setError(result.error); return }
        if (!result.isIndexing) setStatus('ready')
      } catch { /* retry next tick */ }
    }, 2000)
    return () => clearInterval(id)
  }, [status])

  // Focus input when tab becomes active
  useEffect(() => {
    if (isActive && status === 'ready') {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isActive, status])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || status !== 'ready') { setSearchResults([]); return }
    setSearching(true)
    setError(null)
    try {
      const result = await window.api.code.searchNodes(q.trim(), { limit: 200 })
      if (result.error) { setError(result.error); setSearchResults([]) }
      else { setSearchResults(result.nodes || []) }
    } catch (err: any) {
      setError(err.message)
      setSearchResults([])
    }
    setSearching(false)
  }, [status])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setSelectedNode(null)
    setDetailNodes({ callers: [], callees: [] })
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(value), 300)
  }, [doSearch])

  useEffect(() => {
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [])

  const handleNodeSelect = useCallback(async (node: CodeSymbol) => {
    setSelectedNode(node)
    setLoadingDetail(true)
    try {
      const [callersRes, calleesRes] = await Promise.all([
        window.api.code.getCallers(node.id, 1),
        window.api.code.getCallees(node.id, 1)
      ])
      setDetailNodes({
        callers: (callersRes.nodes || []).slice(0, 50),
        callees: (calleesRes.nodes || []).slice(0, 50)
      })
    } catch { /* individual IPC errors handled by error state */ }
    setLoadingDetail(false)
  }, [])

  const handleJumpToDefinition = useCallback((node: CodeSymbol) => {
    if (onNavigateToFile) {
      onNavigateToFile(node.filePath)
    }
    if (onOpenFile && workspacePath) {
      const fullPath = node.filePath.startsWith('/') || node.filePath.includes(':')
        ? node.filePath
        : workspacePath.replace(/\\/g, '/') + '/' + node.filePath
      onOpenFile(fullPath, node.line)
    }
  }, [onNavigateToFile, onOpenFile, workspacePath])

  const handleInit = useCallback(async () => {
    if (!workspacePath) return
    setStatus('loading')
    setError(null)
    try {
      const result = await window.api.code.init(workspacePath)
      if (result.error) { setStatus('error'); setError(result.error); return }
      setStatus('indexing')
    } catch (err: any) {
      setStatus('error')
      setError(err.message)
    }
  }, [workspacePath])

  const groupedResults = useMemo(() => {
    const groups: Record<string, CodeSymbol[]> = {}
    for (const node of searchResults) {
      const file = node.filePath
      if (!groups[file]) groups[file] = []
      groups[file].push(node)
    }
    for (const file of Object.keys(groups)) {
      groups[file].sort((a, b) => a.line - b.line)
    }
    return groups
  }, [searchResults])

  const fileList = useMemo(() => {
    return Object.keys(groupedResults).sort()
  }, [groupedResults])

  // ── Render helpers ──

  const renderStatusMessage = (icon: React.ReactNode, title: string, subtitle?: string, action?: React.ReactNode) => (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="text-ide-text-muted/50">{icon}</div>
      <div className="text-sm text-ide-text-muted">{title}</div>
      {subtitle && <div className="text-xs text-ide-text-muted/60">{subtitle}</div>}
      {action}
    </div>
  )

  if (status === 'loading') {
    return renderStatusMessage(
      <div className="w-6 h-6 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />,
      'Loading...'
    )
  }

  if (status === 'not-initialized') {
    return renderStatusMessage(
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>,
      'Symbol index not found',
      'Initialize CodeGraph to enable symbol search',
      <button
        onClick={handleInit}
        className="mt-1 px-4 py-1.5 text-xs rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 transition-colors"
      >
        Initialize Symbol Index
      </button>
    )
  }

  if (status === 'indexing') {
    return renderStatusMessage(
      <div className="w-6 h-6 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />,
      'Indexing symbols...',
      'This may take a few seconds'
    )
  }

  if (status === 'error' && !workspacePath) {
    return renderStatusMessage(
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>,
      'No active session'
    )
  }

  // ── Detail panel when a node is selected ──
  if (selectedNode) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <button
          onClick={() => {
            setSelectedNode(null)
            setDetailNodes({ callers: [], callees: [] })
          }}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b border-ide-border shrink-0 transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M10.5 3.5L6 8l4.5 4.5" /></svg>
          Back to results
        </button>

        <div className="px-3 py-2.5 border-b border-ide-border shrink-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold uppercase ${getKindColor(selectedNode.kind)}`}>{selectedNode.kind}</span>
            <span className="text-sm font-semibold text-ide-text">{selectedNode.name}</span>
          </div>
          <div className="text-xs text-ide-text-muted mt-1.5 truncate font-mono">
            {selectedNode.filePath}:{selectedNode.line}
          </div>
          {selectedNode.signature && (
            <div className="text-xs text-ide-text-muted/70 mt-0.5 truncate font-mono">{selectedNode.signature}</div>
          )}
          <button
            onClick={() => handleJumpToDefinition(selectedNode)}
            className="mt-2 text-xs px-2 py-1 rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 transition-colors w-full"
          >
            Jump to Definition
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingDetail ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-4 h-4 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {detailNodes.callers.length > 0 && (
                <div className="border-b border-ide-border">
                  <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ide-text-muted/70 flex items-center gap-1.5">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M8 1L2 7h4v5h4V7h4L8 1z" /></svg>
                    Callers ({detailNodes.callers.length})
                  </div>
                  {detailNodes.callers.slice(0, 30).map((item: any, i: number) => {
                    const node = item.node || item
                    return (
                      <div
                        key={`caller-${node.id || i}`}
                        className="px-5 py-1.5 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-2 transition-colors"
                        onClick={() => handleNodeSelect(node)}
                      >
                        <span className={`font-bold uppercase text-[10px] w-12 shrink-0 ${getKindColor(node.kind)}`}>{node.kind}</span>
                        <span className="text-ide-text truncate">{node.name}</span>
                        <span className="text-ide-text-muted/50 text-[10px] truncate ml-auto">{node.filePath}:{node.line}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {detailNodes.callees.length > 0 && (
                <div className="border-b border-ide-border">
                  <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ide-text-muted/70 flex items-center gap-1.5">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M8 15l6-6h-4V4H6v5H2l6 6z" /></svg>
                    Callees ({detailNodes.callees.length})
                  </div>
                  {detailNodes.callees.slice(0, 30).map((item: any, i: number) => {
                    const node = item.node || item
                    return (
                      <div
                        key={`callee-${node.id || i}`}
                        className="px-5 py-1.5 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-2 transition-colors"
                        onClick={() => handleNodeSelect(node)}
                      >
                        <span className={`font-bold uppercase text-[10px] w-12 shrink-0 ${getKindColor(node.kind)}`}>{node.kind}</span>
                        <span className="text-ide-text truncate">{node.name}</span>
                        <span className="text-ide-text-muted/50 text-[10px] truncate ml-auto">{node.filePath}:{node.line}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {detailNodes.callers.length === 0 && detailNodes.callees.length === 0 && (
                <div className="px-3 py-8 text-center text-xs text-ide-text-muted">
                  No callers or callees found
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Main search view ──
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="p-2 border-b border-ide-border shrink-0">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search symbols..."
            className="w-full text-sm bg-ide-bg border border-ide-border rounded px-2 py-1.5 pr-8 text-ide-text focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50"
          />
          {searching && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 text-xs text-ide-danger bg-ide-danger/10">
            {error}
          </div>
        )}

        {!query && status === 'ready' && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            Type to search symbols
          </div>
        )}

        {query && !searching && searchResults.length === 0 && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            No symbols found
          </div>
        )}

        {fileList.map(file => (
          <div key={file} className="border-b border-ide-border/50 last:border-b-0">
            <div className="px-3 py-1.5 text-xs text-ide-text-muted/70 font-mono truncate bg-ide-bg/50">
              {file}
            </div>
            {groupedResults[file].map((node, i) => (
              <div
                key={`${node.id || i}`}
                className="px-5 py-1.5 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-2 transition-colors"
                onClick={() => handleNodeSelect(node)}
              >
                <span className={`font-bold uppercase text-[10px] w-12 shrink-0 ${getKindColor(node.kind)}`}>{node.kind}</span>
                <span className="text-ide-text truncate">{node.name}</span>
                <span className="text-ide-text-muted/50 text-[10px] ml-auto shrink-0">:{node.line}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default CodeTab
