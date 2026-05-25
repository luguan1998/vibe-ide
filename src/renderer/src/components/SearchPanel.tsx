import React, { useState, useCallback, useRef, useEffect } from 'react'
import { GrepMatch } from '@shared/types'
import { useI18n } from '../i18n'

interface SearchPanelProps {
  cwd: string | null
  onOpenFile: (fullPath: string, lineNumber?: number) => void
  focusTrigger?: number
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

  // Auto-focus on mount — 切 Tab 进入时组件重新挂载，自动聚焦
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

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

  // Group results by file
  const groupedResults = React.useMemo(() => {
    const groups: Record<string, GrepMatch[]> = {}
    for (const m of results) {
      if (!groups[m.file]) groups[m.file] = []
      groups[m.file].push(m)
    }
    return groups
  }, [results])

  if (!cwd) {
    return (
      <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm">
        No active session
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
            placeholder="Search in project..."
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
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 text-sm text-ide-danger bg-ide-danger/10">{error}</div>
        )}

        {query && !searching && results.length === 0 && !error && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            No results found
          </div>
        )}

        {!query && (
          <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
            Type to search files by content
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
                {total} match{total !== 1 ? 'es' : ''}
                {truncated && <span className="text-ide-warning ml-1">(truncated)</span>}
              </span>
              <span className="flex gap-1">
                <button
                  className="hover:text-ide-text hover:bg-ide-hover px-1 rounded transition-colors"
                  onClick={handleExpandAll}
                  title={t('Expand All')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                    <path fillRule="evenodd" d="M2 2.75A.75.75 0 0 1 2.75 2h9.5a.75.75 0 0 1 0 1.5h-9.5A.75.75 0 0 1 2 2.75ZM2 6.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 2 6.25Zm0 3.5A.75.75 0 0 1 2.75 9h3.5a.75.75 0 0 1 0 1.5h-3.5A.75.75 0 0 1 2 9.75ZM14.78 11.47a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 1 1 1.06-1.06l.97.97V6.75a.75.75 0 0 1 1.5 0v5.69l.97-.97a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  className="hover:text-ide-text hover:bg-ide-hover px-1 rounded transition-colors"
                  onClick={handleCollapseAll}
                  title={t('Collapse All')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
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
                    <span className="text-ide-text font-mono text-xs truncate">
                      {match.content}
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
