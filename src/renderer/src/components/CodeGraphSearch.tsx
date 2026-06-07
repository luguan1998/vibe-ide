import React, { useState, useEffect, useRef, useCallback } from 'react'
import { CodeSymbol } from '@shared/types'

const KIND_COLORS: Record<string, string> = {
  function: '#facc15', method: '#facc15',
  class: '#60a5fa', interface: '#4ade80',
  variable: '#c084fc', constant: '#fb923c',
  type: '#2dd4bf', component: '#f472b6',
}
function getKindColor(kind: string): string { return KIND_COLORS[kind] || '#888' }

interface Props {
  workspacePath: string | null
  onClose: () => void
  onSelectNode: (node: CodeSymbol) => void
  onFocusChange?: (focused: boolean) => void
}

type Status = 'loading' | 'not-initialized' | 'indexing' | 'ready' | 'error'

function CodeGraphSearch({ workspacePath, onClose, onSelectNode, onFocusChange: onFocusChangeProp }: Props) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CodeSymbol[]>([])
  const [searching, setSearching] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPathRef = useRef<string | null>(null)

  // Initialize CodeGraph on workspace change
  useEffect(() => {
    if (!workspacePath || pendingPathRef.current === workspacePath) return
    pendingPathRef.current = workspacePath
    setStatus('loading')
    setQuery('')
    setResults([])
    setError(null)

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
      } catch { /* retry */ }
    }, 2000)
    return () => clearInterval(id)
  }, [status])

  // Auto-focus input
  useEffect(() => {
    if (status === 'ready') setTimeout(() => inputRef.current?.focus(), 50)
  }, [status])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || status !== 'ready') { setResults([]); return }
    setSearching(true)
    try {
      const r = await window.api.code.searchNodes(q.trim(), { limit: 50 })
      setResults(r.error ? [] : r.nodes || [])
    } catch { setResults([]) }
    setSearching(false)
  }, [status])

  const handleChange = useCallback((v: string) => {
    setQuery(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(v), 250)
  }, [doSearch])

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  const handleInit = useCallback(async () => {
    if (!workspacePath) return
    setStatus('loading')
    try {
      const r = await window.api.code.init(workspacePath)
      if (r.error) { setStatus('error'); setError(r.error); return }
      setStatus('indexing')
    } catch (err: any) { setStatus('error'); setError(err.message) }
  }, [workspacePath])

  // Notify parent about focus state (so Alt release doesn't dismiss)
  const onFocusChange = useCallback((focused: boolean) => {
    setIsFocused(focused)
    onFocusChangeProp?.(focused)
  }, [onFocusChangeProp])

  // ESC handler
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
    }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  return (
    <div className="fixed inset-x-0 top-[8%] z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center" style={{ minWidth: 480, maxWidth: 640, width: '42vw' }}>
        {/* Search input */}
        <div className="w-full bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-text-muted/50 shrink-0">
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => handleChange(e.target.value)}
              onFocus={() => onFocusChange(true)}
              onBlur={() => onFocusChange(false)}
              placeholder={status === 'not-initialized' ? 'CodeGraph not initialized' : status === 'indexing' ? 'Indexing symbols...' : 'Search symbols...'}
              disabled={status !== 'ready'}
              className="flex-1 bg-transparent text-sm text-ide-text outline-none placeholder:text-ide-text-muted/30"
            />
            {searching && <div className="w-3 h-3 border-2 border-ide-accent border-t-transparent rounded-full animate-spin shrink-0" />}
            {status === 'not-initialized' && (
              <button onClick={handleInit} className="text-[11px] px-2 py-0.5 rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 shrink-0">
                Init
              </button>
            )}
            {status === 'indexing' && (
              <span className="text-[11px] text-ide-text-muted/50 shrink-0">indexing…</span>
            )}
          </div>

          {/* Results */}
          {results.length > 0 && query.trim() && (
            <div className="border-t border-ide-border max-h-64 overflow-y-auto">
              {results.map((node, i) => (
                <div
                  key={node.id || i}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ide-hover transition-colors"
                  onClick={() => { onSelectNode(node); onClose() }}
                >
                  <span className="text-[10px] font-bold uppercase w-12 shrink-0" style={{ color: getKindColor(node.kind) }}>
                    {node.kind}
                  </span>
                  <span className="text-sm text-ide-text truncate">{node.name}</span>
                  <span className="text-[10px] text-ide-text-muted/40 truncate ml-auto">{node.filePath.replace(/^.*[/\\]/, '')}:{node.line}</span>
                </div>
              ))}
            </div>
          )}

          {query.trim() && !searching && results.length === 0 && status === 'ready' && (
            <div className="border-t border-ide-border px-3 py-3 text-xs text-ide-text-muted/40 text-center">
              No symbols found
            </div>
          )}

          {error && (
            <div className="border-t border-ide-border px-3 py-2 text-xs text-ide-danger/80">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { CodeGraphSearch, KIND_COLORS, getKindColor }
