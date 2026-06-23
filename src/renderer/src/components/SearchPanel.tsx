import React, { useState, useCallback, useRef, useEffect } from 'react'
import { GrepMatch, CodeSymbol } from '@shared/types'
import { useI18n } from '../i18n'
import { getKindStyle } from '../utils/kindColors'

const MODE_KEY = 'vibe-ide-search-mode'
function loadMode(): 'grep' | 'smart' { try { return (localStorage.getItem(MODE_KEY) || 'grep') as 'grep' | 'smart' } catch { return 'grep' } }
function saveMode(m: string) { try { localStorage.setItem(MODE_KEY, m) } catch {} }

interface SearchPanelProps {
  cwd: string | null
  onOpenFile: (fullPath: string, lineNumber?: number) => void
  focusTrigger?: number
  onExploreNode?: (node: CodeSymbol) => void
}

function trimToMatch(content: string, column: number): { text: string; head: boolean; tail: boolean } {
  const MATCH_BEFORE = 30
  const MAX_LEN = 150

  const matchIdx = column - 1
  const start = Math.max(0, matchIdx - MATCH_BEFORE)
  const end = Math.min(content.length, start + MAX_LEN)

  return {
    text: content.slice(start, end),
    head: start > 0,
    tail: end < content.length
  }
}

function highlightMatches(text: string, query: string, regex: boolean, caseSensitive: boolean, wholeWord: boolean): React.ReactNode {
  if (!query || !text) return text

  let pattern: RegExp
  try {
    if (regex) {
      const src = wholeWord ? `\\b(?:${query})\\b` : query
      pattern = new RegExp(src, caseSensitive ? 'g' : 'gi')
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const src = wholeWord ? `\\b${escaped}\\b` : escaped
      pattern = new RegExp(src, caseSensitive ? 'g' : 'gi')
    }
  } catch {
    return text
  }

  const result: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  pattern.lastIndex = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }
    result.push(
      <mark key={match.index} className="bg-ide-accent/25 text-ide-text rounded-sm">
        {match[0]}
      </mark>
    )
    lastIndex = match.index + match[0].length
    if (match[0].length === 0) pattern.lastIndex++
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result.length > 0 ? <>{result}</> : text
}

interface ReplaceConfirmModalProps {
  query: string
  replacement: string
  total: number
  uniqueFiles: number
  onConfirm: () => void
  onClose: () => void
}

function ReplaceConfirmModal({ query, replacement, total, uniqueFiles, onConfirm, onClose }: ReplaceConfirmModalProps) {
  const { t } = useI18n()

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
      if (e.key === 'Enter') {
        e.stopImmediatePropagation()
        onConfirm()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [onClose, onConfirm])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div className="bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl p-5 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-ide-text mb-1 font-medium">{t('Confirm Replace')}</p>
        <p className="text-xs text-ide-text-muted mb-4">
          {t('Replace')} <span className="text-ide-accent font-mono">{query}</span> → <span className="text-ide-accent font-mono">{replacement}</span>
          <br />
          {total} {t('matches in')} {uniqueFiles} {t('files')}.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded bg-ide-hover text-ide-text hover:bg-ide-border transition-colors"
            onClick={onClose}
          >
            {t('Cancel')}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded bg-ide-accent text-white hover:brightness-110 transition-colors"
            onClick={onConfirm}
          >
            {t('Replace All')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SearchPanel({ cwd, onOpenFile, focusTrigger, onExploreNode }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GrepMatch[]>([])
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const { t } = useI18n()
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [includePattern, setIncludePattern] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const [replaceResult, setReplaceResult] = useState<{ filesModified: number; totalReplacements: number; errors: string[] } | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'grep' | 'smart'>(loadMode)
  const [cgReady, setCgReady] = useState(false)
  const [smartResults, setSmartResults] = useState<CodeSymbol[]>([])
  const [smartRoots, setSmartRoots] = useState<Set<string>>(new Set())
  const [smartConfidence, setSmartConfidence] = useState<'high' | 'low' | undefined>(undefined)
  const [smartCtxMenu, setSmartCtxMenu] = useState<{ x: number; y: number; node: CodeSymbol } | null>(null)
  const smartCtxMenuRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Smart context menu dismiss
  useEffect(() => {
    if (!smartCtxMenu) return
    const mm = (e: MouseEvent) => {
      if (smartCtxMenuRef.current && !smartCtxMenuRef.current.contains(e.target as Node)) setSmartCtxMenu(null)
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', mm), 0)
    const kh = (e: KeyboardEvent) => { if (e.key === 'Escape') setSmartCtxMenu(null) }
    window.addEventListener('keydown', kh)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', mm); window.removeEventListener('keydown', kh) }
  }, [smartCtxMenu])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  // Focus input when triggered by Ctrl+F
  useEffect(() => {
    if (focusTrigger !== undefined && focusTrigger > 0 && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [focusTrigger])

  // Check if CodeGraph is initialized for this workspace
  useEffect(() => {
    if (!cwd) { setCgReady(false); return }
    window.api.code.isInitialized(cwd).then(r => {
      if (r.initialized && !r.error) {
        window.api.code.setWorkspace(cwd).then(o => {
          setCgReady(!o.error)
        })
      } else {
        setCgReady(false)
      }
    }).catch(() => setCgReady(false))
  }, [cwd])

  // Smart mode search using findRelevantContext
  const doSmartSearch = useCallback(async (q: string) => {
    if (!q.trim() || !cwd) {
      setSmartResults([]); setSmartRoots(new Set()); setSmartConfidence(undefined); return
    }
    setSearching(true); setError(null)
    try {
      const r = await window.api.code.findRelevantContext(q.trim(), { searchLimit: 10, traversalDepth: 2, maxNodes: 30 })
      if (r.error) { setSmartResults([]); setSmartRoots(new Set()); setSmartConfidence(undefined); setError(r.error) }
      else {
        const rootSet = new Set(r.roots || [])
        const sorted = (r.nodes || []).sort((a: any, b: any) =>
          (rootSet.has(a.id) ? 0 : 1) - (rootSet.has(b.id) ? 0 : 1)
        )
        setSmartResults(sorted); setSmartRoots(rootSet); setSmartConfidence(r.confidence)
      }
    } catch { setSmartResults([]); setSmartRoots(new Set()); setSmartConfidence(undefined) }
    setSearching(false)
  }, [cwd])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !cwd) {
      setResults([])
      setTotal(0)
      setTruncated(false)
      return
    }

    setSearching(true)
    setError(null)
    setReplaceResult(null)
    setExcludedFiles(new Set())
    try {
      const result = await window.api.search.grep({
        query: q,
        cwd,
        regex,
        caseSensitive,
        wholeWord,
        include: includePattern || undefined
      })
      setResults(result.matches)
      setTotal(result.total)
      setTruncated(result.truncated)
    } catch (err: any) {
      setError(err.message || 'Search failed')
      setResults([])
      setTotal(0)
    }
    setSearching(false)
  }, [cwd, regex, caseSensitive, wholeWord, includePattern])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    // Smart mode: only search on Enter, not on keystroke
    if (mode === 'grep') {
      searchTimer.current = setTimeout(() => doSearch(value), 300)
    }
  }, [doSearch, mode])

  // Re-search when options change
  useEffect(() => {
    if (query.trim()) {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchTimer.current = setTimeout(() => doSearch(query), 100)
    }
  }, [regex, caseSensitive, wholeWord, includePattern, cwd, query, doSearch])

  const handleResultClick = useCallback((match: GrepMatch) => {
    onOpenFile(match.fullPath, match.line)
  }, [onOpenFile])

  // Group results by file (excluding excluded files)
  const groupedResults = React.useMemo(() => {
    const groups: Record<string, GrepMatch[]> = {}
    for (const m of results) {
      if (excludedFiles.has(m.fullPath)) continue
      if (!groups[m.file]) groups[m.file] = []
      groups[m.file].push(m)
    }
    return groups
  }, [results, excludedFiles])

  // Total visible matches (excluding excluded files)
  const visibleTotal = React.useMemo(() => {
    return results.filter(m => !excludedFiles.has(m.fullPath)).length
  }, [results, excludedFiles])

  const handleReplaceAll = useCallback(async () => {
    if (!query.trim() || !cwd || visibleTotal === 0) return

    setShowReplaceConfirm(false)
    setReplacing(true)
    setReplaceResult(null)
    try {
      const result = await window.api.search.replace({
        query,
        replacement,
        cwd,
        regex,
        caseSensitive,
        wholeWord,
        include: includePattern || undefined,
        excludeFiles: excludedFiles.size > 0 ? Array.from(excludedFiles) : undefined
      })
      setReplaceResult(result)
      doSearch(query)
    } catch (err: any) {
      setReplaceResult({ filesModified: 0, totalReplacements: 0, errors: [err.message || 'Replace failed'] })
    }
    setReplacing(false)
  }, [query, replacement, cwd, regex, caseSensitive, wholeWord, includePattern, visibleTotal, excludedFiles, doSearch])

  if (!cwd) {
    return (
      <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm">
        {t('No active session')}
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Search input */}
      <div className="p-2 border-b border-ide-border shrink-0">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={mode === 'smart' ? t('描述后按 Enter 搜索...') : t('Search in project...')}
            onContextMenu={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              const el = e.currentTarget as HTMLInputElement
              el.focus()
              if (document.execCommand('paste')) return
              try {
                const text = await navigator.clipboard.readText()
                if (text) el.setRangeText(text, el.selectionStart || 0, el.selectionEnd || 0, 'end')
              } catch {}
              el.dispatchEvent(new Event('input', { bubbles: true }))
            }}
            className={`w-full text-sm bg-ide-bg border border-ide-border rounded px-2 py-1.5 text-ide-text focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50 ${cgReady ? 'pr-16' : 'pr-8'}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (mode === 'smart') doSmartSearch(query)
                else doSearch(query)
              }
            }}
          />
          {searching && (
            <div className={`absolute top-1/2 -translate-y-1/2 ${cgReady ? 'right-8' : 'right-2'}`}>
              <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {cgReady && (
            <button
              onClick={() => {
                if (mode === 'smart') { setMode('grep'); saveMode('grep'); setSmartResults([]); setSmartRoots(new Set()); setSmartConfidence(undefined) }
                else { setMode('smart'); saveMode('smart') }
              }}
              className={`absolute right-2 top-1/2 -translate-y-1/2 shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors ${mode === 'smart' ? 'text-ide-accent bg-ide-accent/15' : 'text-ide-text-muted/30 hover:text-ide-text-muted/60'}`}
              title={mode === 'smart' ? t('智能模式（点击切换为文本搜索）') : t('文本搜索（点击切换为智能模式）')}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M8 1a4.5 4.5 0 0 0-3 7.83V11a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8.83A4.5 4.5 0 0 0 8 1zM5.5 7.42A3 3 0 1 1 10.5 7.42l-.5.41V10H6V7.83l-.5-.41zM6 12h4v1H6z"/>
              </svg>
            </button>
          )}
        </div>

        {mode === 'grep' && (
        <div className="flex gap-2 mt-1.5 items-center">
          <label className="flex items-center gap-1 text-xs text-ide-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={regex}
              onChange={(e) => setRegex(e.target.checked)}
              className="accent-ide-accent w-3 h-3"
            />
            .*
          </label>
          <label className="flex items-center gap-1 text-xs text-ide-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="accent-ide-accent w-3 h-3"
            />
            Aa
          </label>
          <label className="flex items-center gap-1 text-xs text-ide-text-muted cursor-pointer" title={t('全词匹配')}>
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
              className="accent-ide-accent w-3 h-3"
            />
            <span className="underline">ab</span>
          </label>
          <input
            type="text"
            value={includePattern}
            onChange={(e) => setIncludePattern(e.target.value)}
            placeholder="*.ts"
            className="flex-1 text-xs bg-ide-bg border border-ide-border rounded px-1.5 py-0.5 text-ide-text focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50"
          />
        </div>
        )}

        {mode === 'grep' && (
        <div className="flex gap-2 mt-1.5 items-center">
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={t('Replace with...')}
            className="flex-1 text-xs bg-ide-bg border border-ide-border rounded px-1.5 py-0.5 text-ide-text focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visibleTotal > 0 && replacement) {
                setShowReplaceConfirm(true)
              }
            }}
          />
          <button
            className="text-xs px-2 py-0.5 rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            disabled={!query.trim() || visibleTotal === 0 || !replacement || replacing}
            onClick={() => setShowReplaceConfirm(true)}
          >
            {replacing ? (
              <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin mx-1" />
            ) : (
              t('Replace All')
            )}
          </button>
        </div>
        )}
      </div>

      {/* Replace confirmation modal */}
      {showReplaceConfirm && (
        <ReplaceConfirmModal
          query={query}
          replacement={replacement}
          total={visibleTotal}
          uniqueFiles={Object.keys(groupedResults).length}
          onConfirm={handleReplaceAll}
          onClose={() => setShowReplaceConfirm(false)}
        />
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 text-sm text-ide-danger bg-ide-danger/10">{error}</div>
        )}

        {replaceResult && (
          <div className={`px-3 py-2 text-sm border-b border-ide-border ${
            replaceResult.errors.length > 0 ? 'text-ide-warning bg-ide-warning/10' : 'text-ide-accent bg-ide-accent/10'
          }`}>
            {replaceResult.filesModified > 0
              ? t('Replaced {n} occurrences in {m} files').replace('{n}', String(replaceResult.totalReplacements)).replace('{m}', String(replaceResult.filesModified))
              : t('No results found')}
            {replaceResult.errors.length > 0 && (
              <div className="text-xs mt-1 text-ide-danger">
                {replaceResult.errors.map((err, i) => <div key={i}>{err}</div>)}
              </div>
            )}
          </div>
        )}

        {mode === 'grep' && query && !searching && results.length === 0 && !error && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            {t('No results found')}
          </div>
        )}

        {mode === 'smart' && query && !searching && smartResults.length === 0 && !error && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            {t('未找到相关上下文')}
          </div>
        )}

        {mode === 'grep' && !query && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            {t('Type to search files by content')}
          </div>
        )}

        {mode === 'smart' && !query && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            {t('描述后按 Enter 搜索')}
          </div>
        )}

        {/* Smart mode results */}
        {mode === 'smart' && smartResults.length > 0 && query.trim() && (() => {
          return (
            <>
              <div className="px-3 py-1.5 text-xs text-ide-text-muted border-b border-ide-border bg-ide-hover/30 flex items-center justify-between">
                <span>{smartResults.length} {t('symbols')}</span>
                {smartConfidence === 'high' && <span className="text-ide-accent/70">{t('高置信度')}</span>}
                {smartConfidence === 'low' && <span className="text-ide-warning">{t('低置信度')}</span>}
              </div>
              {smartResults.map((node, i) => {
                const isRoot = smartRoots.has(node.id)
                return (
                  <div key={node.id || i}
                    className="px-3 py-1.5 text-sm cursor-pointer hover:bg-ide-hover transition-colors flex items-center gap-2"
                    onClick={() => {
                      const cwdVal = cwd || ''
                      const sep = cwdVal.includes('\\') ? '\\' : '/'
                      const absPath = node.filePath.startsWith('/') || node.filePath.includes(':')
                        ? node.filePath
                        : cwdVal + sep + node.filePath.replace(/\//g, sep)
                      onOpenFile(absPath, node.line)
                    }}
                    onContextMenu={(e) => {
                      if (!onExploreNode) return
                      e.preventDefault()
                      setSmartCtxMenu({ x: e.clientX, y: e.clientY, node })
                    }}>
                    <span className="text-[10px] font-bold uppercase w-10 shrink-0" style={{ color: getKindStyle(node.kind).color }}>{node.kind.slice(0, 2)}</span>
                    <span className="text-ide-text truncate">{node.name}</span>
                    {isRoot && <span className="text-[9px] px-1 py-px rounded bg-ide-accent/10 text-ide-accent/70 shrink-0">root</span>}
                    <span className="text-xs text-ide-text-muted/40 truncate ml-auto">{node.filePath.replace(/^.*[/\\]/, '')}:{node.line}</span>
                  </div>
                )
              })}
              {smartCtxMenu && (
                <div ref={smartCtxMenuRef}
                  style={{ position: 'fixed', left: Math.min(smartCtxMenu.x, window.innerWidth - 160), top: Math.min(smartCtxMenu.y, window.innerHeight - 50), zIndex: 100 }}
                  className="bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[120px]">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-accent hover:bg-ide-hover transition-colors"
                    onClick={() => { onExploreNode?.(smartCtxMenu.node); setSmartCtxMenu(null) }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0">
                      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                    </svg>
                    {t('展开')}
                  </button>
                </div>
              )}
            </>
          )
        })()}

        {/* Grep mode results */}
        {mode === 'grep' && results.length > 0 && (() => {
          const allFiles = Object.keys(groupedResults)
          const allCollapsed = allFiles.length > 0 && allFiles.every(f => collapsedFiles.has(f))
          const handleCollapseAll = () => setCollapsedFiles(new Set(allFiles))
          const handleExpandAll = () => setCollapsedFiles(new Set())
          const toggleFile = (file: string) => {
            setCollapsedFiles(prev => {
              const next = new Set(prev)
              if (next.has(file)) next.delete(file)
              else next.add(file)
              return next
            })
          }

          return (
          <>
            <div className="px-3 py-1.5 text-xs text-ide-text-muted border-b border-ide-border bg-ide-hover/30 flex items-center justify-between">
              <span>
                {visibleTotal} {t('matches')}
                {excludedFiles.size > 0 && <span className="text-ide-text-muted/50 ml-1">({t('from')} {total} {t('total')})</span>}
                {truncated && <span className="text-ide-warning ml-1">({t('truncated')})</span>}
              </span>
              <span className="flex gap-1">
                <button
                  className="hover:text-ide-text hover:bg-ide-hover px-1 rounded transition-colors"
                  onClick={handleExpandAll}
                  title={t('Expand All')}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                    <path fillRule="evenodd" d="M2 2.75A.75.75 0 0 1 2.75 2h9.5a.75.75 0 0 1 0 1.5h-9.5A.75.75 0 0 1 2 2.75ZM2 6.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 2 6.25Zm0 3.5A.75.75 0 0 1 2.75 9h3.5a.75.75 0 0 1 0 1.5h-3.5A.75.75 0 0 1 2 9.75ZM14.78 11.47a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 1 1 1.06-1.06l.97.97V6.75a.75.75 0 0 1 1.5 0v5.69l.97-.97a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  className="hover:text-ide-text hover:bg-ide-hover px-1 rounded transition-colors"
                  onClick={handleCollapseAll}
                  title={t('Collapse All')}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                    <path fillRule="evenodd" d="M2 2.75A.75.75 0 0 1 2.75 2h9.5a.75.75 0 0 1 0 1.5h-9.5A.75.75 0 0 1 2 2.75ZM2 6.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 2 6.25Zm0 3.5A.75.75 0 0 1 2.75 9h3.5a.75.75 0 0 1 0 1.5h-3.5A.75.75 0 0 1 2 9.75ZM9.22 9.53a.75.75 0 0 1 0-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1-1.06 1.06l-.97-.97v5.69a.75.75 0 0 1-1.5 0V8.56l-.97.97a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
                  </svg>
                </button>
              </span>
            </div>

            {Object.entries(groupedResults).map(([file, fileMatches]) => {
              const collapsed = collapsedFiles.has(file)
              return (
              <div key={file} className="border-b border-ide-border/50">
                <div
                  className="px-3 py-1 text-xs text-ide-accent bg-ide-bg font-mono truncate cursor-pointer hover:bg-ide-hover flex items-center gap-1"
                  onClick={() => toggleFile(file)}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 shrink-0 transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}>
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                  {file} ({fileMatches.length})
                  <button
                    className="ml-auto w-4 h-4 flex items-center justify-center rounded hover:bg-ide-danger/20 hover:text-ide-danger text-ide-text-muted/50 shrink-0 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      setExcludedFiles(prev => {
                        const next = new Set(prev)
                        next.add(fileMatches[0]?.fullPath || file)
                        return next
                      })
                    }}
                    title={t('Exclude from replace')}
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                      <path fillRule="evenodd" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {!collapsed && fileMatches.map((match, idx) => (
                  <div
                    key={`${match.file}-${match.line}-${match.column}-${idx}`}
                    className="px-3 py-1 text-sm cursor-pointer hover:bg-ide-hover flex gap-2 items-start"
                    onClick={() => handleResultClick(match)}
                  >
                    <span className="text-xs text-ide-text-muted font-mono shrink-0 mt-0.5">
                      {match.line}
                    </span>
                    <span className="text-ide-text font-mono text-xs overflow-hidden whitespace-nowrap">
                      {(() => {
                        const { text: trimmed, head, tail } = trimToMatch(match.content, match.column)
                        return (
                          <>
                            {head && <span className="text-ide-text-muted/50">...</span>}
                            {highlightMatches(trimmed, query, regex, caseSensitive, wholeWord)}
                            {tail && <span className="text-ide-text-muted/50">...</span>}
                          </>
                        )
                      })()}
                    </span>
                  </div>
                ))}
              </div>
            )})}
          </>
        )})()}
      </div>
    </div>
  )
}
