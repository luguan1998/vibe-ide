import React, { useState, useEffect, useRef, useCallback } from 'react'
import { CodeSymbol } from '@shared/types'

const KIND_COLORS: Record<string, string> = {
  function: '#facc15', method: '#facc15',
  class: '#60a5fa', interface: '#4ade80',
  variable: '#c084fc', constant: '#fb923c',
  type: '#2dd4bf', component: '#f472b6',
}
function getKindColor(kind: string): string { return KIND_COLORS[kind] || '#888' }

const recentCache: CodeSymbol[] = []

function addRecent(node: CodeSymbol) {
  const idx = recentCache.findIndex(n => n.id === node.id)
  if (idx >= 0) recentCache.splice(idx, 1)
  recentCache.unshift(node)
  if (recentCache.length > 10) recentCache.length = 10
}

const FILTERS_KEY = 'vibe-ide-codegraph-filters'

function loadFilters(): string[] {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    return raw ? JSON.parse(raw) : ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**']
  } catch { return [] }
}
function saveFilters(filters: string[]) {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)) } catch {}
}

interface Props {
  workspacePath: string | null
  onClose: () => void
  onSelectNode: (node: CodeSymbol) => void
}

type Status = 'loading' | 'not-initialized' | 'indexing' | 'ready' | 'error'

function CodeGraphSearch({ workspacePath, onClose, onSelectNode }: Props) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CodeSymbol[]>([])
  const [searching, setSearching] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const interactedRef = useRef(false)
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null)
  const [stats, setStats] = useState<any>(null)
  const [filters, setFilters] = useState<string[]>(loadFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [recentNodes, setRecentNodes] = useState<CodeSymbol[]>(() => recentCache.filter(Boolean))
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPathRef = useRef<string | null>(null)

  // Init on workspace change
  useEffect(() => {
    if (!workspacePath || pendingPathRef.current === workspacePath) return
    pendingPathRef.current = workspacePath
    setStatus('loading')
    setQuery('')
    setResults([])
    setError(null)
    setProgress(null)
    setStats(null)

    const init = async () => {
      const target = workspacePath
      try {
        const r = await window.api.code.isInitialized(target)
        if (pendingPathRef.current !== target) return
        if (r.error) { setStatus('error'); setError(r.error); return }
        if (!r.initialized) { setStatus('not-initialized'); return }

        const o = await window.api.code.setWorkspace(target)
        if (pendingPathRef.current !== target) return
        if (o.error) { setStatus('error'); setError(o.error); return }

        const idx = await window.api.code.isIndexing()
        if (pendingPathRef.current !== target) return
        if (idx.error) { setStatus('error'); setError(idx.error); return }

        // Load stats
        try {
          const s = await window.api.code.getStats()
          if (!s.error) setStats(s)
        } catch {}

        setStatus(idx.isIndexing ? 'indexing' : 'ready')
      } catch (err: any) { if (pendingPathRef.current === target) { setStatus('error'); setError(err.message) } }
    }
    init()
  }, [workspacePath])

  // Poll indexing
  useEffect(() => {
    if (status !== 'indexing') return
    const id = setInterval(async () => {
      try {
        const r = await window.api.code.isIndexing()
        if (r.error) { setStatus('error'); setError(r.error); return }
        if (!r.isIndexing) setStatus('ready')
      } catch {}
    }, 2000)
    return () => clearInterval(id)
  }, [status])

  // Auto-focus
  useEffect(() => { if (status === 'ready') setTimeout(() => inputRef.current?.focus(), 50) }, [status])

  // Progress listener during init
  const handleInit = useCallback(async () => {
    if (!workspacePath) return
    setStatus('loading')
    setProgress(null)
    const progressHandler = window.api.code.onProgress((p: any) => setProgress(p))
    try {
      const r = await window.api.code.init(workspacePath)
      if (r.error) { setStatus('error'); setError(r.error); return }
      setStatus('ready')
      try {
        const s = await window.api.code.getStats()
        if (!s.error) setStats(s)
      } catch {}
    } catch (err: any) { setStatus('error'); setError(err.message) }
    window.api.code.removeProgressListener(progressHandler)
    setProgress(null)
  }, [workspacePath])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || status !== 'ready') { setResults([]); return }
    setSearching(true)
    try {
      const r = await window.api.code.searchNodes(q.trim(), { limit: 50, excludePatterns: filters })
      setResults(r.error ? [] : r.nodes || [])
    } catch { setResults([]) }
    setSearching(false)
  }, [status, filters])

  const handleChange = useCallback((v: string) => {
    setQuery(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(v), 250)
  }, [doSearch])

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  // Alt release: close only if not interacted and not focused
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !interactedRef.current && !isFocused) onClose()
    }
    window.addEventListener('keyup', h)
    return () => window.removeEventListener('keyup', h)
  }, [onClose, isFocused])

  const applyFilters = useCallback(() => {
    const list = filterText.split(',').map(s => s.trim()).filter(Boolean)
    setFilters(list)
    saveFilters(list)
    setShowFilters(false)
  }, [filterText])

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="fixed inset-x-0 top-[8%] z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center" style={{ minWidth: 480, maxWidth: 680, width: '46vw' }}>
        <div className="w-full bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl overflow-hidden">
          {/* Search row */}
          <div className="flex items-center gap-2 px-3 h-10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-text-muted/50 shrink-0">
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
            <input ref={inputRef} type="text" value={query} onChange={e => { interactedRef.current = true; handleChange(e.target.value) }}
              onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)}
              placeholder={status === 'not-initialized' ? 'Not initialized — click Init' : status === 'indexing' ? 'Indexing...' : status === 'loading' ? 'Loading...' : 'Search symbols...'}
              disabled={status !== 'ready'}
              className="flex-1 bg-transparent text-sm text-ide-text outline-none focus:outline-none ring-0 focus:ring-0 placeholder:text-ide-text-muted/30" />
            {searching && <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin shrink-0" />}
            {status === 'not-initialized' && (
              <button onClick={() => { interactedRef.current = true; handleInit() }} className="text-[11px] px-2 py-0.5 rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 shrink-0">Init</button>
            )}
            <button onClick={() => { setShowFilters(!showFilters); if (!showFilters) setFilterText(filters.join(', ')) }}
              className="text-ide-text-muted/30 hover:text-ide-text-muted/60 transition-colors shrink-0" title="Filters">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 2h13l-5 5.5V12l-3 1.5V7.5L1.5 2z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
            </button>
          </div>

          {/* Progress bar */}
          {progress && (
            <div className="border-t border-ide-border px-3 py-1.5">
              <div className="flex items-center gap-2 text-[10px] text-ide-text-muted/60 mb-1">
                <span>{progress.phase || 'indexing'}</span>
                <span className="ml-auto">{progress.current}/{progress.total}</span>
              </div>
              <div className="h-1 bg-ide-hover rounded-full overflow-hidden">
                <div className="h-full bg-ide-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {/* Filter config */}
          {showFilters && (
            <div className="border-t border-ide-border px-3 py-2">
              <div className="text-[10px] text-ide-text-muted/50 mb-1.5">Exclude patterns (glob, comma-separated)</div>
              <div className="flex gap-1.5">
                <input value={filterText} onChange={e => setFilterText(e.target.value)}
                  className="flex-1 bg-ide-bg border border-ide-border rounded px-2 py-1 text-xs text-ide-text outline-none focus:border-ide-accent"
                  onKeyDown={e => { if (e.key === 'Enter') applyFilters() }} />
                <button onClick={applyFilters} className="text-[11px] px-2 py-0.5 rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25">Apply</button>
              </div>
            </div>
          )}

          {/* Stats bar */}
          {stats && status === 'ready' && (
            <div className="border-t border-ide-border/50 px-3 py-1 flex items-center gap-3 text-[10px] text-ide-text-muted/30">
              {stats.totalNodes != null && <span>{stats.totalNodes.toLocaleString()} symbols</span>}
              {stats.totalEdges != null && <span>{stats.totalEdges.toLocaleString()} edges</span>}
              {stats.totalFiles != null && <span>{stats.totalFiles.toLocaleString()} files</span>}
              {filters.length > 0 && <span className="ml-auto">{filters.length} filters</span>}
            </div>
          )}

          {/* Recent nodes (when input empty) */}
          {recentNodes.length > 0 && !query.trim() && (
            <div className="border-t border-ide-border max-h-64 overflow-y-auto">
              <div className="px-3 py-1 text-[10px] text-ide-text-muted/40">Recent</div>
              {recentNodes.map((node, i) => (
                <div key={node.id || i}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ide-hover transition-colors"
                  onClick={() => { addRecent(node); setRecentNodes([...recentCache]); onSelectNode(node); onClose() }}>
                  <span className="text-[10px] font-bold uppercase w-12 shrink-0" style={{ color: getKindColor(node.kind) }}>{node.kind}</span>
                  <span className="text-sm text-ide-text truncate">{node.name}</span>
                  <span className="text-[10px] text-ide-text-muted/40 truncate ml-auto">{node.filePath.replace(/^.*[/\\]/, '')}:{node.line}</span>
                </div>
              ))}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && query.trim() && (
            <div className="border-t border-ide-border max-h-64 overflow-y-auto">
              {results.map((node, i) => (
                <div key={node.id || i}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ide-hover transition-colors"
                  onClick={() => { addRecent(node); setRecentNodes([...recentCache]); onSelectNode(node); onClose() }}>
                  <span className="text-[10px] font-bold uppercase w-12 shrink-0" style={{ color: getKindColor(node.kind) }}>{node.kind}</span>
                  <span className="text-sm text-ide-text truncate">{node.name}</span>
                  <span className="text-[10px] text-ide-text-muted/40 truncate ml-auto">{node.filePath.replace(/^.*[/\\]/, '')}:{node.line}</span>
                </div>
              ))}
            </div>
          )}
          {query.trim() && !searching && results.length === 0 && status === 'ready' && (
            <div className="border-t border-ide-border px-3 py-3 text-xs text-ide-text-muted/40 text-center">No symbols found</div>
          )}
          {error && <div className="border-t border-ide-border px-3 py-2 text-xs text-ide-danger/80">{error}</div>}
        </div>
      </div>
    </div>
  )
}

export { CodeGraphSearch, KIND_COLORS, getKindColor }
