import React, { useState, useEffect, useRef, useCallback } from 'react'
import { CodeSymbol } from '@shared/types'
import { useI18n } from '../i18n'

const AGENT_TARGETS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'opencode', label: 'opencode' },
  { id: 'hermes', label: 'Hermes Agent' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'kiro', label: 'Kiro' },
] as const

const KIND_COLORS: Record<string, string> = {
  function: '#facc15', method: '#facc15',
  class: '#60a5fa', interface: '#4ade80',
  variable: '#c084fc', constant: '#fb923c',
  type: '#2dd4bf', component: '#f472b6',
}
function getKindColor(kind: string): string { return KIND_COLORS[kind] || '#888' }

const KIND_OPTIONS = [
  { kind: 'function', label: 'Fn' },
  { kind: 'method', label: 'Me' },
  { kind: 'class', label: 'Cl' },
  { kind: 'interface', label: 'If' },
  { kind: 'component', label: 'Co' },
  { kind: 'variable', label: 'Va' },
  { kind: 'constant', label: 'Ct' },
  { kind: 'type_alias', label: 'Ty' },
]
const KINDS_KEY = 'vibe-ide-codegraph-kinds'
const DEFAULT_KINDS = KIND_OPTIONS.map(o => o.kind)

function loadKinds(): string[] {
  try { const raw = localStorage.getItem(KINDS_KEY); return raw ? JSON.parse(raw) : DEFAULT_KINDS } catch { return DEFAULT_KINDS }
}
function saveKinds(kinds: string[]) {
  try { localStorage.setItem(KINDS_KEY, JSON.stringify(kinds)) } catch {}
}

interface RecentEntry { node: CodeSymbol; workspace: string }
const recentCache: RecentEntry[] = []

function addRecent(node: CodeSymbol, workspace: string) {
  const idx = recentCache.findIndex(n => n.node.id === node.id)
  if (idx >= 0) recentCache.splice(idx, 1)
  recentCache.unshift({ node, workspace })
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
  onActivated?: () => void
  focusTrigger?: number
}

type Status = 'loading' | 'not-initialized' | 'indexing' | 'ready' | 'error'

function CodeGraphSearch({ workspacePath, onClose, onSelectNode, onActivated, focusTrigger }: Props) {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CodeSymbol[]>([])
  const [searching, setSearching] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null)
  const [stats, setStats] = useState<any>(null)
  const [filters, setFilters] = useState<string[]>(loadFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [selectedKinds, setSelectedKinds] = useState<string[]>(loadKinds)
  const [activated, setActivated] = useState(false)
  const [recentNodes, setRecentNodes] = useState<RecentEntry[]>(() => [])
  const [showMcpConfig, setShowMcpConfig] = useState(false)
  const [mcpTargets, setMcpTargets] = useState<string[]>(['claude'])
  const [mcpInstalling, setMcpInstalling] = useState(false)
  const [mcpResult, setMcpResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [initting, setInitting] = useState(false)
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
    setActivated(false)
    setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind)))

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

  // Focus triggered externally (e.g. Alt+K shortcut) → activate and show recent
  useEffect(() => {
    if (focusTrigger !== undefined && focusTrigger > 0) {
      setActivated(true)
      if (workspacePath) setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind)))
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [focusTrigger, workspacePath])

  // Progress listener during init
  const handleInit = useCallback(async () => {
    if (!workspacePath) return
    setStatus('loading')
    setInitting(true)
    setProgress(null)
    const progressHandler = window.api.code.onProgress((p: any) => setProgress(p))
    try {
      const r = await window.api.code.init(workspacePath)
      if (r.error === 'cancelled') { setStatus('not-initialized'); setInitting(false); setProgress(null); return }
      if (r.error) { setStatus('error'); setError(r.error); setInitting(false); return }
      setStatus('ready')
      setInitting(false)
      try {
        const s = await window.api.code.getStats()
        if (!s.error) setStats(s)
      } catch {}
    } catch (err: any) { setStatus('error'); setError(err.message); setInitting(false) }
    window.api.code.removeProgressListener(progressHandler)
    setProgress(null)
  }, [workspacePath])

  const handleCancelInit = useCallback(async () => {
    await window.api.code.cancelInit()
    setStatus('not-initialized')
    setInitting(false)
    setProgress(null)
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || status !== 'ready') { setResults([]); return }
    setSearching(true)
    try {
      const r = await window.api.code.searchNodes(q.trim(), { limit: 50, excludePatterns: filters, kinds: selectedKinds })
      setResults(r.error ? [] : r.nodes || [])
    } catch { setResults([]) }
    setSearching(false)
  }, [status, filters, selectedKinds])

  const handleChange = useCallback((v: string) => {
    setQuery(v)
    if (status !== 'ready') return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(v), 250)
  }, [doSearch, status])

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  const applyFilters = useCallback(() => {
    const list = filterText.split(',').map(s => s.trim()).filter(Boolean)
    setFilters(list)
    saveFilters(list)
    setShowFilters(false)
  }, [filterText])

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <>
      {/* Full-screen lock overlay during init */}
      {initting && (
        <div className="fixed inset-0 z-[60] bg-ide-bg/70 flex items-center justify-center">
          <div className="bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl p-6 flex flex-col items-center gap-4" style={{ minWidth: 360, maxWidth: 440 }}>
            <div className="text-sm font-semibold text-ide-text">{t('Initializing CodeGraph...')}</div>
            {progress && (
              <>
                <div className="w-full">
                  <div className="flex items-center justify-between text-[10px] text-ide-text-muted/60 mb-1.5">
                    <span>{progress.phase || 'indexing'}</span>
                    <span>{progress.current}/{progress.total}</span>
                  </div>
                  <div className="h-2 bg-ide-hover rounded-full overflow-hidden">
                    <div className="h-full bg-ide-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </>
            )}
            {!progress && (
              <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />
            )}
            <button onClick={handleCancelInit}
              className="text-xs px-3 py-1.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
              {t('Cancel Init')}
            </button>
            <div className="text-[10px] text-ide-text-muted/40 text-center leading-relaxed max-w-[320px]">
              {t('Slow? Add folders like {ex1}, {ex2}, {ex3} to your {ignore} or {gitignore} to skip indexing them.')
                .replace('{ex1}', 'tests/**').replace('{ex2}', 'docs/**').replace('{ex3}', 'vendor/**').replace('{ignore}', '.codegraphignore').replace('{gitignore}', '.gitignore')}
            </div>
          </div>
        </div>
      )}
    <div className="fixed inset-x-0 top-[8%] z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center" style={{ minWidth: 480, maxWidth: 680, width: '46vw' }}>
        <div className="w-full bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl overflow-hidden">
          {/* Search row */}
          <div className="flex items-center gap-2 px-3 h-10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-text-muted/50 shrink-0">
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
            <input ref={inputRef} type="text" value={query} onChange={e => handleChange(e.target.value)}
              onFocus={() => {
                  if (!activated) {
                    setActivated(true)
                    if (workspacePath) setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind)))
                  }
                  onActivated?.()
                }}
              placeholder={status === 'not-initialized' ? t('Not initialized — click Init') : status === 'indexing' ? t('Indexing...') : status === 'loading' ? t('Loading...') : t('Search symbols...')}
              className={`flex-1 bg-transparent text-sm outline-none focus:outline-none ring-0 focus:ring-0 placeholder:text-ide-text-muted/30 ${status !== 'ready' ? 'text-ide-text-muted/40' : 'text-ide-text'}`} />
            {searching && <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin shrink-0" />}
            {status === 'not-initialized' && (
              <button onClick={() => { onActivated?.(); handleInit() }} className="text-[11px] px-2 py-0.5 rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 shrink-0">{t('Init')}</button>
            )}
            <button onClick={() => { setShowFilters(!showFilters); if (!showFilters) setFilterText(filters.join(', ')) }}
              className="text-ide-text-muted/30 hover:text-ide-text-muted/60 transition-colors shrink-0" title="Filters">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 2h13l-5 5.5V12l-3 1.5V7.5L1.5 2z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
            </button>
            <button onClick={() => { setShowMcpConfig(!showMcpConfig); setShowFilters(false); setMcpResult(null) }}
              className={`text-ide-text-muted/30 hover:text-ide-text-muted/60 transition-colors shrink-0 ${showMcpConfig ? 'text-ide-accent' : ''}`} title={t('Configure MCP')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 0 9-9"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>

          {/* Kind filter row */}
          <div className="border-t border-ide-border/50 px-3 py-1 flex items-center gap-1">
            {KIND_OPTIONS.map(o => {
              const active = selectedKinds.includes(o.kind)
              return (
                <button key={o.kind}
                  onClick={() => {
                    const next = active ? selectedKinds.filter(k => k !== o.kind) : [...selectedKinds, o.kind]
                    setSelectedKinds(next)
                    saveKinds(next)
                  }}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${active ? 'text-ide-text font-bold' : 'text-ide-text-muted/30 hover:text-ide-text-muted/60'}`}
                  style={{ backgroundColor: active ? getKindColor(o.kind) + '20' : 'transparent' }}>
                  <span style={{ color: active ? getKindColor(o.kind) : undefined }}>{o.label}</span>
                </button>
              )
            })}
          </div>
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
              <div className="text-[10px] text-ide-text-muted/50 mb-1.5">{t('Exclude patterns (glob, comma-separated)')}</div>
              <div className="flex gap-1.5">
                <input value={filterText} onChange={e => setFilterText(e.target.value)}
                  className="flex-1 bg-ide-bg border border-ide-border rounded px-2 py-1 text-xs text-ide-text outline-none focus:border-ide-accent"
                  onKeyDown={e => { if (e.key === 'Enter') applyFilters() }} />
                <button onClick={applyFilters} className="text-[11px] px-2 py-0.5 rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25">{t('Apply')}</button>
              </div>
            </div>
          )}

          {/* MCP agent config */}
          {showMcpConfig && (
            <div className="border-t border-ide-border px-3 py-2">
              <div className="text-[10px] text-ide-text-muted/50 mb-1.5">{t('Configure CodeGraph MCP for agents')}</div>
              <div className="flex flex-wrap gap-x-2 gap-y-1 mb-2">
                {AGENT_TARGETS.map(t => {
                  const checked = mcpTargets.includes(t.id)
                  return (
                    <label key={t.id} className="flex items-center gap-1 cursor-pointer text-[11px] text-ide-text-muted hover:text-ide-text">
                      <input type="checkbox" checked={checked} onChange={() => {
                        setMcpTargets(prev => checked ? prev.filter(id => id !== t.id) : [...prev, t.id])
                        setMcpResult(null)
                      }} className="accent-ide-accent w-3 h-3" />
                      {t.label}
                    </label>
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <button disabled={mcpInstalling || mcpTargets.length === 0}
                  onClick={async () => {
                    setMcpInstalling(true); setMcpResult(null)
                    try {
                      const r = await window.api.code.installMcp(mcpTargets, workspacePath || '')
                      setMcpResult(r)
                    } catch (err: any) { setMcpResult({ success: false, error: err.message }) }
                    setMcpInstalling(false)
                  }}
                  className={`text-[11px] px-2 py-0.5 rounded shrink-0 ${mcpInstalling || mcpTargets.length === 0 ? 'bg-ide-accent/10 text-ide-accent/40 cursor-not-allowed' : 'bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25'}`}>
                  {mcpInstalling ? t('Installing...') : t('Install')}
                </button>
                {mcpResult && (
                  <span className={`text-[10px] ${mcpResult.success ? 'text-ide-accent' : 'text-ide-danger'}`}>
                    {mcpResult.success ? t('Done') : mcpResult.error}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Stats bar */}
          {stats && status === 'ready' && (
            <div className="border-t border-ide-border/50 px-3 py-1 flex items-center gap-3 text-[10px] text-ide-text-muted/30">
              {stats.totalNodes != null && <span>{stats.totalNodes.toLocaleString()} {t('symbols')}</span>}
              {stats.totalEdges != null && <span>{stats.totalEdges.toLocaleString()} {t('edges')}</span>}
              {stats.totalFiles != null && <span>{stats.totalFiles.toLocaleString()} {t('files')}</span>}
              {filters.length > 0 && <span className="ml-auto">{filters.length} {t('filters')}</span>}
            </div>
          )}

          {/* Recent nodes (when input empty and activated) */}
          {activated && recentNodes.length > 0 && !query.trim() && (
            <div className="border-t border-ide-border max-h-64 overflow-y-auto">
              <div className="px-3 py-1 text-[10px] text-ide-text-muted/40">{t('Recent')}</div>
              {recentNodes.map((entry, i) => (
                <div key={entry.node.id || i}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ide-hover transition-colors"
                  onClick={() => { addRecent(entry.node, entry.workspace); setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind))); onSelectNode(entry.node); onClose() }}>
                  <span className="text-[10px] font-bold uppercase w-12 shrink-0" style={{ color: getKindColor(entry.node.kind) }}>{entry.node.kind}</span>
                  <span className="text-sm text-ide-text truncate">{entry.node.name}</span>
                  <span className="text-[10px] text-ide-text-muted/40 truncate ml-auto">{entry.node.filePath.replace(/^.*[/\\]/, '')}:{entry.node.line}</span>
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
                  onClick={() => { addRecent(node, workspacePath || ''); setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind))); onSelectNode(node); onClose() }}>
                  <span className="text-[10px] font-bold uppercase w-12 shrink-0" style={{ color: getKindColor(node.kind) }}>{node.kind}</span>
                  <span className="text-sm text-ide-text truncate">{node.name}</span>
                  <span className="text-[10px] text-ide-text-muted/40 truncate ml-auto">{node.filePath.replace(/^.*[/\\]/, '')}:{node.line}</span>
                </div>
              ))}
            </div>
          )}
          {query.trim() && !searching && results.length === 0 && status === 'ready' && (
            <div className="border-t border-ide-border px-3 py-3 text-xs text-ide-text-muted/40 text-center">{t('No symbols found')}</div>
          )}
          {error && <div className="border-t border-ide-border px-3 py-2 text-xs text-ide-danger/80">{error}</div>}
        </div>
      </div>
    </div>
    </>
  )
}

export { CodeGraphSearch }
