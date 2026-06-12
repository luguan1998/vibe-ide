import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { CodeSymbol } from '@shared/types'
import { useI18n } from '../i18n'
import { getKindStyle } from '../utils/kindColors'

const AGENT_TARGETS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'opencode', label: 'opencode' },
  { id: 'hermes', label: 'Hermes Agent' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'kiro', label: 'Kiro' },
] as const

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

const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', 'build', '.next', 'out', '.vscode', '__pycache__', 'target', '.cache']

async function readGitignoreExcludedFolders(workspacePath: string): Promise<string[]> {
  try {
    const content = await window.api.file.read(`${workspacePath}/.gitignore`)
    if (typeof content !== 'string') return DEFAULT_EXCLUDES
    const lines = content.split(/\r?\n/)
    const folders: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      // Match patterns like "folderName/", "folderName/**", "/folderName"
      const folderMatch = trimmed.replace(/^\/+/, '').replace(/\/$/, '').replace(/\*+$/, '')
      if (folderMatch && !folderMatch.includes('/')) folders.push(folderMatch)
    }
    // Merge with defaults
    const merged = [...DEFAULT_EXCLUDES]
    for (const f of folders) {
      if (!merged.includes(f)) merged.push(f)
    }
    return merged
  } catch { return DEFAULT_EXCLUDES }
}

async function writeGitignoreExcludeFolder(workspacePath: string, folderName: string) {
  try {
    const r = await window.api.file.read(`${workspacePath}/.gitignore`)
    if (typeof r !== 'string') return // file doesn't exist or read failed — don't create/overwrite
    const content = r
    // Only add if not already present (any form)
    if (content.split(/\r?\n/).some(l => {
      const t = l.trim()
      return t === `${folderName}/` || t === `${folderName}/**` || t === folderName || t === `/${folderName}/` || t === `/${folderName}`
    })) return
    // Append with marker comment so we can identify our own lines on restore
    const appended = content + `\n# vibe-ide-codegraph\n${folderName}/\n`
    await window.api.file.write(`${workspacePath}/.gitignore`, appended)
  } catch {}
}

async function writeGitignoreRestoreFolder(workspacePath: string, folderName: string) {
  try {
    const r = await window.api.file.read(`${workspacePath}/.gitignore`)
    if (typeof r !== 'string') return
    const content = r
    // Remove only our own marker block: "# vibe-ide-codegraph" followed by the folder line(s)
    const lines = content.split(/\r?\n/)
    const result: string[] = []
    let skipBlock = false
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '# vibe-ide-codegraph') {
        // Check if the next non-empty line matches this folder
        let j = i + 1
        while (j < lines.length && lines[j].trim() === '') j++
        if (j < lines.length) {
          const nextTrimmed = lines[j].trim()
          if (nextTrimmed === `${folderName}/` || nextTrimmed === `${folderName}/**` || nextTrimmed === folderName || nextTrimmed === `/${folderName}/` || nextTrimmed === `/${folderName}`) {
            skipBlock = true
            result.push(lines[i]) // keep marker, might have other folders below
            continue
          }
        }
      }
      if (skipBlock) {
        const trimmed = lines[i].trim()
        if (trimmed === `${folderName}/` || trimmed === `${folderName}/**` || trimmed === folderName || trimmed === `/${folderName}/` || trimmed === `/${folderName}`) {
          continue // skip this folder's line
        }
        // If we hit another non-folder line, the block for this folder is done
        skipBlock = false
      }
      result.push(lines[i])
    }
    // Clean up: remove marker line if no folder lines remain after it
    const final: string[] = []
    for (let i = 0; i < result.length; i++) {
      if (result[i].trim() === '# vibe-ide-codegraph') {
        // Check if next non-empty line is a folder pattern we added
        let j = i + 1
        while (j < result.length && result[j].trim() === '') j++
        if (j >= result.length || result[j].trim() === '' || result[j].trim().startsWith('#')) {
          continue // remove orphan marker
        }
      }
      final.push(result[i])
    }
    await window.api.file.write(`${workspacePath}/.gitignore`, final.join('\n'))
  } catch {}
}

interface Props {
  workspacePath: string | null
  onClose: () => void
  onSelectNode: (node: CodeSymbol) => void
  onJumpTo: (node: CodeSymbol) => void
  onActivated?: () => void
  onExploreResult?: (result: { query: string; content: string }) => void
  focusTrigger?: number
}

type Status = 'loading' | 'not-initialized' | 'indexing' | 'ready' | 'error'

function CodeGraphSearch({ workspacePath, onClose, onSelectNode, onJumpTo, onActivated, onExploreResult, focusTrigger }: Props) {
  const { t } = useI18n()
  const [exploreLoading, setExploreLoading] = useState(false)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CodeSymbol[]>([])
  const [searching, setSearching] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null)
  const [stats, setStats] = useState<any>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [excludedFolders, setExcludedFolders] = useState<string[]>(DEFAULT_EXCLUDES)
  const [showFolderFilter, setShowFolderFilter] = useState(false)
  const [selectedKinds, setSelectedKinds] = useState<string[]>(loadKinds)
  const [activated, setActivated] = useState(false)
  const [recentNodes, setRecentNodes] = useState<RecentEntry[]>(() => [])
  const [showMcpConfig, setShowMcpConfig] = useState(false)
  const [mcpTargets, setMcpTargets] = useState<string[]>(['claude'])
  const [mcpInstalling, setMcpInstalling] = useState(false)
  const [mcpResult, setMcpResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [initting, setInitting] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPathRef = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filters = useMemo(() => excludedFolders.map(f => `**/${f}/**`), [excludedFolders])
  const selectableItems = query.trim() ? results : recentNodes.map(e => e.node)
  const selectedItem = selectedIndex >= 0 && selectedIndex < selectableItems.length ? selectableItems[selectedIndex] : null

  const activate = useCallback(() => {
    if (activated) return
    setActivated(true)
    onActivated?.()
    if (workspacePath) setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind)))
    // Two-frame delay: first frame lets React commit DOM, second frame ensures xterm.js won't steal focus
    requestAnimationFrame(() => requestAnimationFrame(() => inputRef.current?.focus()))
  }, [activated, workspacePath, selectedKinds, onActivated])

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
        // Load folder list and excluded folders from .gitignore
        const listResult = await window.api.file.list(target)
        if (pendingPathRef.current !== target) return
        if (!listResult.error) {
          const dirNames = (listResult as Array<{ name: string; path: string; type: string }>)
            .filter(e => e.type === 'directory' && !DEFAULT_EXCLUDES.includes(e.name))
            .map(e => e.name)
          setFolders(dirNames)
        }
        const excluded = await readGitignoreExcludedFolders(target)
        if (pendingPathRef.current !== target) return
        setExcludedFolders(excluded)

        const r = await window.api.code.isInitialized(target)
        if (pendingPathRef.current !== target) return
        if (r.error) { setStatus('error'); setError(r.error); return }
        if (!r.initialized) { setStatus('not-initialized'); return }

        const o = await window.api.code.setWorkspace(target)
        if (pendingPathRef.current !== target) return
        if (o.error) {
          if (o.error === 'REBUILDING') { setStatus('indexing'); return }
          setStatus('error'); setError(o.error); return
        }

        const idx = await window.api.code.isIndexing()
        if (pendingPathRef.current !== target) return
        if (idx.error) { setStatus('error'); setError(idx.error); return }

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

  // Focus triggered externally (Alt+K) → activate
  useEffect(() => {
    if (focusTrigger !== undefined && focusTrigger > 0) activate()
  }, [focusTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!q.trim() || status !== 'ready') { setResults([]); setSelectedIndex(-1); return }
    setSearching(true)
    setSelectedIndex(-1)
    try {
      const r = await window.api.code.searchNodes(q.trim(), { limit: 50, excludePatterns: filters, kinds: selectedKinds })
      setResults(r.error ? [] : r.nodes || [])
    } catch { setResults([]) }
    setSearching(false)
  }, [status, filters, selectedKinds])

  const handleChange = useCallback((v: string) => {
    setQuery(v)
    setSelectedIndex(-1)
    if (status !== 'ready') return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(v), 250)
  }, [doSearch, status])

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll('[data-idx]')
    const el = items[selectedIndex] as HTMLElement | undefined
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  // Init overlay (shared between peek & activated)
  const initOverlay = initting && (
    <div className="fixed inset-0 z-[60] bg-ide-bg/70 flex items-center justify-center">
      <div className="bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl p-6 flex flex-col items-center gap-4" style={{ minWidth: 360, maxWidth: 440 }}>
        <div className="text-sm font-semibold text-ide-text">{t('Initializing CodeGraph...')}</div>
        {progress && (
          <div className="w-full">
            <div className="flex items-center justify-between text-[10px] text-ide-text-muted/60 mb-1.5">
              <span>{progress.phase || 'indexing'}</span>
              <span>{progress.current}/{progress.total}</span>
            </div>
            <div className="h-2 bg-ide-hover rounded-full overflow-hidden">
              <div className="h-full bg-ide-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {!progress && <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />}
        <button onClick={handleCancelInit} className="text-xs px-3 py-1.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">{t('Cancel Init')}</button>
        <div className="text-[10px] text-ide-text-muted/80 text-center leading-relaxed max-w-[320px]">
          {t('Slow? Add folders like {ex1}, {ex2}, {ex3} to your {gitignore} to skip indexing them.')
            .replace('{ex1}', 'tests/**').replace('{ex2}', 'docs/**').replace('{ex3}', 'vendor/**').replace('{gitignore}', '.gitignore')}
        </div>
      </div>
    </div>
  )

  const panelWrapper = (inner: React.ReactNode) => (
    <div className="fixed inset-x-0 top-[8%] z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center" style={{ minWidth: 480, maxWidth: 680, width: '46vw' }}>
        {inner}
      </div>
    </div>
  )

  // ── Peek mode ──
  if (!activated) return (
    <>
      {initOverlay}
      {panelWrapper(
        <div className="w-full bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl overflow-hidden"
          onClick={activate} style={{ opacity: 0.7 }}>
          <div className="flex items-center gap-2 px-3 h-10">
            <input readOnly placeholder={t('Hold Alt to peek, click or Alt+K to search')}
              className="flex-1 bg-transparent text-sm outline-none text-ide-text placeholder:text-ide-text/50" />
            {status === 'not-initialized' && (
              <button onClick={() => { activate(); handleInit() }} className="text-[11px] px-2 py-0.5 rounded bg-ide-accent/25 text-ide-accent hover:bg-ide-accent/40 shrink-0">{t('Init')}</button>
            )}
          </div>
        </div>
      )}
    </>
  )

  // ── Activated mode ──
  const placeholder = status === 'not-initialized'
    ? t('Not initialized — click Init')
    : status === 'indexing'
      ? t('Indexing...')
      : status === 'loading'
        ? t('Loading...')
        : t('Search symbols... (Enter to jump)')

  return (
    <>
      {initOverlay}
      {panelWrapper(
        <div className="w-full bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl overflow-hidden">
          {/* Search row */}
          <div className="flex items-center gap-2 px-3 h-10">
            <input ref={inputRef} type="text" value={query} onChange={e => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSelectedIndex(prev => prev < selectableItems.length - 1 ? prev + 1 : prev)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelectedIndex(prev => prev > 0 ? prev - 1 : -1)
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (selectedItem) {
                    addRecent(selectedItem, workspacePath || '')
                    setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind)))
                    onJumpTo(selectedItem)
                    onClose()
                    return
                  }
                  if (query.trim() && status === 'ready') {
                    setExploreLoading(true)
                    window.api.code.explore(query.trim(), { maxFiles: 12 }).then((r: any) => {
                      setExploreLoading(false)
                      if (r.error) { setError(r.error); return }
                      if (r.content && onExploreResult) {
                        onExploreResult({ query: query.trim(), content: r.content })
                      }
                    }).catch((err: any) => {
                      setExploreLoading(false)
                      setError(err.message)
                    })
                  }
                }
              }}
              placeholder={placeholder}
              className={`flex-1 bg-transparent text-sm outline-none focus:outline-none ring-0 focus:ring-0 placeholder:text-ide-text/50 ${status !== 'ready' ? 'text-ide-text/60' : 'text-ide-text'}`} />
            {(searching || exploreLoading) && <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin shrink-0" />}
            {status === 'not-initialized' && (
              <button onClick={handleInit} className="text-[11px] px-2 py-0.5 rounded bg-ide-accent/25 text-ide-accent hover:bg-ide-accent/40 shrink-0">{t('Init')}</button>
            )}
            <button onClick={() => setShowFolderFilter(!showFolderFilter)}
              className={`text-ide-text/50 hover:text-ide-text transition-colors shrink-0 ${showFolderFilter ? 'text-ide-accent' : ''}`} title={t('Exclude folders')}>
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 2h13l-5 5.5V12l-3 1.5V7.5L1.5 2z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
            </button>
                        <button onClick={() => { setShowMcpConfig(!showMcpConfig); setShowFolderFilter(false); setMcpResult(null) }}
              className={`text-ide-text/50 hover:text-ide-text transition-colors shrink-0 ${showMcpConfig ? 'text-ide-accent' : ''}`} title={t('Configure MCP')}>
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
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${active ? 'text-ide-text font-bold' : 'text-ide-text/50 hover:text-ide-text'}`}
                  style={{ backgroundColor: active ? getKindStyle(o.kind).backgroundColor : 'transparent' }}>
                  <span style={{ color: active ? getKindStyle(o.kind).color : undefined }}>{o.label}</span>
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

          {/* Folder exclude chips */}
          {showFolderFilter && (
            <div className="border-t border-ide-border px-3 py-2">
              <div className="text-[10px] text-ide-text-muted/80 mb-1.5">{t('Exclude folders')}</div>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_EXCLUDES.filter(f => f !== '.git').map(folder => {
                  const excluded = excludedFolders.includes(folder)
                  return (
                    <button key={folder}
                      onClick={() => {
                        if (excluded) return
                        const next = [...excludedFolders, folder]
                        setExcludedFolders(next)
                        if (workspacePath) writeGitignoreExcludeFolder(workspacePath, folder)
                      }}
                      className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${excluded ? 'text-ide-text-muted/40 border-ide-border/30 opacity-40 line-through cursor-default' : 'text-ide-text-muted/70 border-ide-border/50 hover:border-ide-accent/50 hover:text-ide-text'}`}
                      style={{ textDecoration: excluded ? 'line-through' : undefined }}
                      disabled={excluded}
                    >{folder}</button>
                  )
                })}
                {folders.map(folder => {
                  const excluded = excludedFolders.includes(folder)
                  return (
                    <button key={folder}
                      onClick={() => {
                        if (excluded) {
                          const next = excludedFolders.filter(f => f !== folder)
                          setExcludedFolders(next)
                          if (workspacePath) writeGitignoreRestoreFolder(workspacePath, folder)
                        } else {
                          const next = [...excludedFolders, folder]
                          setExcludedFolders(next)
                          if (workspacePath) writeGitignoreExcludeFolder(workspacePath, folder)
                        }
                      }}
                      className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${excluded ? 'text-ide-text-muted/40 border-ide-border/30 line-through' : 'text-ide-text-muted/70 border-ide-border/50 hover:border-ide-accent/50 hover:text-ide-text'}`}
                      style={{ textDecoration: excluded ? 'line-through' : undefined }}
                    >
                      {folder}
                      {excluded ? (
                        <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 ml-0.5 inline-block opacity-60"><path d="M3 2.5L9.5 9M9.5 2.5L3 9" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
                      ) : (
                        <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 ml-0.5 inline-block opacity-40 hover:opacity-80"><path d="M3 2.5L9.5 9M9.5 2.5L3 9" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* MCP agent config */}
          {showMcpConfig && (
            <div className="border-t border-ide-border px-3 py-2">
              <div className="text-[10px] text-ide-text-muted/80 mb-1.5">{t('Configure CodeGraph MCP for agents')}</div>
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

          {/* Recent nodes (when input empty) */}
          {recentNodes.length > 0 && !query.trim() && (
            <div ref={listRef} className="border-t border-ide-border max-h-64 overflow-y-auto">
              <div className="px-3 py-1 text-[10px] text-ide-text-muted/40">{t('Recent')}</div>
              {recentNodes.map((entry, i) => (
                <div key={entry.node.id || i} data-idx={i}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ide-hover transition-colors ${selectedIndex === i ? 'bg-ide-hover' : ''}`}
                  onClick={() => { addRecent(entry.node, entry.workspace); setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind))); onJumpTo(entry.node); onClose() }}>
                  <span className="text-[10px] font-bold uppercase w-12 shrink-0" style={{ color: getKindStyle(entry.node.kind).color }}>{entry.node.kind}</span>
                  <span className="text-sm text-ide-text truncate">{entry.node.name}</span>
                  <span className="text-[10px] text-ide-text-muted/40 truncate">{entry.node.filePath.replace(/^.*[/\\]/, '')}:{entry.node.line}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); addRecent(entry.node, entry.workspace); setRecentNodes(recentCache.filter(e2 => e2.workspace === workspacePath && selectedKinds.includes(e2.node.kind))); onSelectNode(entry.node); onClose() }}
                    className="ml-auto shrink-0 p-1 rounded text-ide-accent/60 hover:text-ide-accent hover:bg-ide-accent/10 transition-colors" title={t('Call Graph')}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                      <circle cx="8" cy="8" r="2.5" />
                      <line x1="8" y1="1" x2="8" y2="5.5" />
                      <line x1="8" y1="10.5" x2="8" y2="15" />
                      <line x1="1" y1="5" x2="5.5" y2="8" />
                      <line x1="10.5" y1="8" x2="15" y2="5" />
                      <line x1="1" y1="11" x2="5.5" y2="8" />
                      <line x1="10.5" y1="8" x2="15" y2="11" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && query.trim() && (
            <div ref={listRef} className="border-t border-ide-border max-h-64 overflow-y-auto">
              {results.map((node, i) => (
                <div key={node.id || i} data-idx={i}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ide-hover transition-colors ${selectedIndex === i ? 'bg-ide-hover' : ''}`}
                  onClick={() => { addRecent(node, workspacePath || ''); setRecentNodes(recentCache.filter(e => e.workspace === workspacePath && selectedKinds.includes(e.node.kind))); onJumpTo(node); onClose() }}>
                  <span className="text-[10px] font-bold uppercase w-12 shrink-0" style={{ color: getKindStyle(node.kind).color }}>{node.kind}</span>
                  <span className="text-sm text-ide-text truncate">{node.name}</span>
                  <span className="text-[10px] text-ide-text-muted/40 truncate">{node.filePath.replace(/^.*[/\\]/, '')}:{node.line}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); addRecent(node, workspacePath || ''); setRecentNodes(recentCache.filter(e2 => e2.workspace === workspacePath && selectedKinds.includes(e2.node.kind))); onSelectNode(node); onClose() }}
                    className="ml-auto shrink-0 p-1 rounded text-ide-accent/60 hover:text-ide-accent hover:bg-ide-accent/10 transition-colors" title={t('Call Graph')}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                      <circle cx="8" cy="8" r="2.5" />
                      <line x1="8" y1="1" x2="8" y2="5.5" />
                      <line x1="8" y1="10.5" x2="8" y2="15" />
                      <line x1="1" y1="5" x2="5.5" y2="8" />
                      <line x1="10.5" y1="8" x2="15" y2="5" />
                      <line x1="1" y1="11" x2="5.5" y2="8" />
                      <line x1="10.5" y1="8" x2="15" y2="11" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {query.trim() && !searching && results.length === 0 && status === 'ready' && (
            <div className="border-t border-ide-border px-3 py-3 text-xs text-ide-text-muted/40 text-center">{t('No symbols found')}</div>
          )}
          {error && <div className="border-t border-ide-border px-3 py-2 text-xs text-ide-danger/80">{error}</div>}
        </div>
      )}
    </>
  )
}

export { CodeGraphSearch }