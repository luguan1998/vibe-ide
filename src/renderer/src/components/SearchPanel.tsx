import React, { useState, useCallback, useRef, useEffect } from 'react'
import { GrepMatch } from '@shared/types'
import { useI18n } from '../i18n'

interface SearchPanelProps {
  cwd: string | null
  onOpenFile: (fullPath: string, lineNumber?: number) => void
  focusTrigger?: number
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

function highlightMatches(text: string, query: string, regex: boolean, caseSensitive: boolean): React.ReactNode {
  if (!query || !text) return text

  let pattern: RegExp
  try {
    if (regex) {
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi')
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi')
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

export default function SearchPanel({ cwd, onOpenFile, focusTrigger }: SearchPanelProps) {
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
  const [replacement, setReplacement] = useState('')
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const [replaceResult, setReplaceResult] = useState<{ filesModified: number; totalReplacements: number; errors: string[] } | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(new Set())
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
  }, [cwd, regex, caseSensitive, includePattern])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(value), 300)
  }, [doSearch])

  // Re-search when options change
  useEffect(() => {
    if (query.trim()) {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchTimer.current = setTimeout(() => doSearch(query), 100)
    }
  }, [regex, caseSensitive, includePattern, cwd, query, doSearch])

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
        include: includePattern || undefined,
        excludeFiles: excludedFiles.size > 0 ? Array.from(excludedFiles) : undefined
      })
      setReplaceResult(result)
      doSearch(query)
    } catch (err: any) {
      setReplaceResult({ filesModified: 0, totalReplacements: 0, errors: [err.message || 'Replace failed'] })
    }
    setReplacing(false)
  }, [query, replacement, cwd, regex, caseSensitive, includePattern, visibleTotal, excludedFiles, doSearch])

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
            placeholder={t('Search in project...')}
            className="w-full text-sm bg-ide-bg border border-ide-border rounded px-2 py-1.5 pr-8 text-ide-text focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch(query)
            }}
          />
          {searching && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Options */}
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
          <input
            type="text"
            value={includePattern}
            onChange={(e) => setIncludePattern(e.target.value)}
            placeholder="*.ts"
            className="flex-1 text-xs bg-ide-bg border border-ide-border rounded px-1.5 py-0.5 text-ide-text-muted focus:border-ide-accent focus:outline-none"
          />
        </div>

        {/* Replace */}
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

        {query && !searching && results.length === 0 && !error && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            {t('No results found')}
          </div>
        )}

        {!query && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            {t('Type to search files by content')}
          </div>
        )}

        {results.length > 0 && (() => {
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
                            {highlightMatches(trimmed, query, regex, caseSensitive)}
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
