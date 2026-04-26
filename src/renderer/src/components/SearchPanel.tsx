import React, { useState, useCallback, useRef, useEffect } from 'react'
import { GrepMatch } from '@shared/types'

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

        {results.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-xs text-ide-text-muted border-b border-ide-border bg-ide-hover/30">
              {total} match{total !== 1 ? 'es' : ''}
              {truncated && <span className="text-ide-warning ml-1">(truncated)</span>}
            </div>

            {Object.entries(groupedResults).map(([file, fileMatches]) => (
              <div key={file} className="border-b border-ide-border/50">
                <div className="px-3 py-1 text-xs text-ide-accent bg-ide-bg font-mono truncate">
                  {file} ({fileMatches.length})
                </div>
                {fileMatches.map((match, idx) => (
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
            ))}
          </>
        )}
      </div>
    </div>
  )
}
