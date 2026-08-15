import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useI18n } from '../i18n'
import { readAiCliConfig } from '../aiStore'
import { buildHistoryTurns, formatBytes } from '../historyUtils'
import type { HistoryTurn } from '../historyUtils'
import type { AiSessionSummary, AiSessionSearchGroup } from '@shared/types'
import { ArrowLeft, ChevronDown, Filter, FolderOpen, Loader2, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { fetchDshSessions, type DshHistorySession } from '../dsh/history'
import { ClaudeLogoIcon } from './ClaudeLogoIcon'
import { DeepSeekLogoIcon } from './DeepSeekLogoIcon'

interface HistoryViewProps {
  onBack: () => void
  workspacePath: string | null
  onResumeClaudeHistory: (historySessionId: string, cwd: string, name: string, mode: 'tui' | 'gui') => void
  onResumeDshHistory?: (dshSessionId: string, cwd: string, name: string) => void
}

type HistoryMode = 'tui' | 'gui' | 'dsh'

function highlightParts(text: string, query: string, caseSensitive: boolean): React.ReactNode[] {
  if (!query) return [text]
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, caseSensitive ? 'g' : 'gi')
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<mark key={key++} className="bg-ide-accent/30 text-ide-text rounded-sm px-0.5">{m[0]}</mark>)
    last = m.index + m[0].length
    if (m.index === re.lastIndex) re.lastIndex++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function TurnRow({ turn }: { turn: HistoryTurn }) {
  const { t } = useI18n()
  return (
    <div className="flex items-start gap-1 text-[11px] leading-snug" title={turn.text}>
      <span className={`shrink-0 w-4 text-center select-none rounded ${turn.role === 'user' ? 'text-ide-accent' : 'text-ide-success'}`}>
        {turn.role === 'user' ? t('User') : t('Assistant')}
      </span>
      <span className="min-w-0 flex-1 truncate text-ide-text-muted/80">
        {turn.text.length > 60 ? `${turn.text.slice(0, 60)}…` : turn.text}
      </span>
    </div>
  )
}

export default function HistoryView({ onBack, workspacePath, onResumeClaudeHistory, onResumeDshHistory }: HistoryViewProps) {
  const { t } = useI18n()
  const [sessions, setSessions] = useState<AiSessionSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [turnsById, setTurnsById] = useState<Record<string, { turns: HistoryTurn[]; loading: boolean }>>({})
  const [mode, setMode] = useState<HistoryMode>('tui')
  const [dshSessions, setDshSessions] = useState<DshHistorySession[]>([])
  const [dshLoading, setDshLoading] = useState(false)
  const [dshError, setDshError] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<AiSessionSearchGroup[] | null>(null)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [onlyCurrent, setOnlyCurrent] = useState(false)
  const fetchReqIdRef = useRef(0)

  const fetchSessions = useCallback(async () => {
    const reqId = ++fetchReqIdRef.current
    setListLoading(true)
    setListError('')
    try {
      const { configDir } = readAiCliConfig()
      const r = await window.api.ai.listAllSessions(configDir, workspacePath || undefined)
      if (fetchReqIdRef.current !== reqId) return
      setSessions(r.sessions || [])
      // 非当前项目默认收缩
      setCollapsedProjects(prev => {
        const next = new Set(prev)
        for (const s of r.sessions || []) {
          if (!s.inCurrentProject) next.add(s.projectDirName)
        }
        return next
      })
    } catch (e: any) {
      if (fetchReqIdRef.current !== reqId) return
      setListError(e?.message || t('No history sessions'))
    } finally {
      if (fetchReqIdRef.current === reqId) setListLoading(false)
    }
  }, [workspacePath, t])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const fetchDshList = useCallback(async () => {
    setDshLoading(true)
    setDshError('')
    try {
      const list = await fetchDshSessions(workspacePath || undefined)
      setDshSessions(list)
    } catch (e: any) {
      setDshError(e?.message || '加载失败')
    } finally {
      setDshLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    if (mode === 'dsh') void fetchDshList()
  }, [mode, fetchDshList])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults(null)
      setSearchTruncated(false)
      setSearching(false)
      setSearchError('')
      return
    }
    const reqId = ++fetchReqIdRef.current
    setSearching(true)
    setSearchError('')
    const { configDir } = readAiCliConfig()
    window.api.ai.searchSessions(debouncedQuery, { configDir, currentCwd: workspacePath || undefined })
      .then((r: any) => {
        if (fetchReqIdRef.current !== reqId) return
        setSearchResults(r?.sessions || [])
        setSearchTruncated(!!r?.truncated)
      })
      .catch((e: any) => {
        if (fetchReqIdRef.current !== reqId) return
        setSearchError(e?.message || '搜索失败')
      })
      .finally(() => {
        if (fetchReqIdRef.current === reqId) setSearching(false)
      })
  }, [debouncedQuery])

  const toggleExpand = useCallback(async (s: AiSessionSummary) => {
    const id = s.session_id
    if (expanded.has(id)) {
      setExpanded(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      return
    }
    setExpanded(prev => new Set(prev).add(id))
    if (turnsById[id]) return
    setTurnsById(prev => ({ ...prev, [id]: { turns: [], loading: true } }))
    try {
      const { configDir } = readAiCliConfig()
      const r = await window.api.ai.loadSessionMessagesByDir(id, s.projectDir, configDir)
      const turns = buildHistoryTurns(r?.messages)
      setTurnsById(prev => prev[id]?.loading ? { ...prev, [id]: { turns, loading: false } } : prev)
    } catch (e: any) {
      setTurnsById(prev => prev[id]?.loading ? { ...prev, [id]: { turns: [{ role: 'assistant', text: e?.message || '加载失败' }], loading: false } } : prev)
    }
  }, [expanded, turnsById])

  const toggleSearchCollapse = useCallback((s: AiSessionSummary) => {
    const id = s.session_id
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const deleteSession = useCallback(async (s: AiSessionSummary) => {
    const id = s.session_id
    try {
      const { configDir } = readAiCliConfig()
      const r = await window.api.ai.deleteSessionByDir(id, s.projectDir, configDir)
      if (r?.success) {
        setSessions(prev => prev.filter(x => x.session_id !== id))
        setSearchResults(prev => prev ? prev.filter(x => x.session_id !== id) : prev)
        setTurnsById(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setExpanded(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      } else {
        setListError(r?.error || '删除失败')
      }
    } catch (e: any) {
      setListError(e?.message || '删除失败')
    }
  }, [])

  const toggleGroup = useCallback((dirName: string) => {
    setCollapsedProjects(prev => {
      const next = new Set(prev)
      if (next.has(dirName)) next.delete(dirName)
      else next.add(dirName)
      return next
    })
  }, [])

  const resume = useCallback((s: AiSessionSummary) => {
    const cwd = s.cwd || (s.inCurrentProject && workspacePath ? workspacePath : s.projectDir)
    if (!cwd) return
    const name = s.name && s.name !== s.session_id ? s.name : ''
    // dsh 模式下 claude 列表不可见，mode 此时只能是 'tui' | 'gui'
    onResumeClaudeHistory(s.session_id, cwd, name, mode as 'tui' | 'gui')
  }, [workspacePath, mode, onResumeClaudeHistory])

  const resumeDsh = useCallback((s: DshHistorySession) => {
    const cwd = s.cwd || workspacePath || ''
    onResumeDshHistory?.(s.id, cwd, s.title && s.title !== s.id ? s.title : '')
  }, [workspacePath, onResumeDshHistory])

  const deleteDsh = useCallback(async (s: DshHistorySession) => {
    try {
      const r = await window.api.dsh.deleteSession(s.id, s.cwd)
      if (r?.ok) {
        setDshSessions(prev => prev.filter(x => x.id !== s.id))
      } else {
        setDshError(r?.error || '删除失败')
      }
    } catch (e: any) {
      setDshError(e?.message || '删除失败')
    }
  }, [])

  const groups = useMemo(() => {
    const map = new Map<string, AiSessionSummary[]>()
    for (const s of sessions) {
      const arr = map.get(s.projectDirName) ?? []
      arr.push(s)
      map.set(s.projectDirName, arr)
    }
    return [...map.entries()]
  }, [sessions])

  const visibleGroups = useMemo(() => {
    return onlyCurrent ? groups.filter(([, list]) => list[0]?.inCurrentProject) : groups
  }, [groups, onlyCurrent])

  const visibleSearchResults = useMemo(() => {
    if (!searchResults) return null
    return onlyCurrent ? searchResults.filter(g => g.inCurrentProject) : searchResults
  }, [searchResults, onlyCurrent])

  const renderTurns = (s: AiSessionSummary) => {
    const item = turnsById[s.session_id]
    if (!item) return null
    return (
      <div className="border-t border-ide-border/50 max-h-40 overflow-y-auto px-2.5 py-1.5 space-y-0.5">
        {item.loading ? (
          <div className="flex items-center gap-1.5 text-[11px] text-ide-text-muted py-0.5">
            <Loader2 size={11} className="animate-spin" /><span>{t('Loading...')}</span>
          </div>
        ) : (
          item.turns.map((tr, ti) => <TurnRow key={ti} turn={tr} />)
        )}
      </div>
    )
  }

  const renderSessionHead = (s: AiSessionSummary, opts?: { searchMode?: boolean }) => {
    const isExpanded = expanded.has(s.session_id)
    const searchMode = opts?.searchMode
    // 搜索模式语义反转：默认展开显示 matches，点击收起
    const arrowDown = searchMode ? !isExpanded : isExpanded
    const canResume = !!workspacePath && (s.inCurrentProject || !!s.projectDir)
    return (
      <div
        className="px-2.5 py-2 flex items-center gap-2 cursor-pointer hover:bg-ide-hover transition-colors group"
        onClick={searchMode ? () => toggleSearchCollapse(s) : () => toggleExpand(s)}
      >
        <button
          className={`w-5 h-5 shrink-0 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-transform ${arrowDown ? '' : '-rotate-90'}`}
          title={t('Expand')}
        >
          <ChevronDown size={12} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="truncate text-xs text-ide-text">{s.name || s.session_id}</div>
          <div className="text-[10px] text-ide-text-muted/60 truncate">
            {s.cwd ? <span className="text-ide-text/70">{s.cwd}</span> : null}
            {s.cwd ? ' · ' : ''}
            {s.timestamp ? new Date(s.timestamp).toLocaleString() : ''}
            {s.model ? ` · ${s.model}` : ''}
            {s.sizeBytes > 0 ? ` · ${formatBytes(s.sizeBytes)}` : ''}
          </div>
        </div>
        {canResume && (
          <button
            onClick={(e) => { e.stopPropagation(); resume(s) }}
            className="shrink-0 px-2 py-0.5 text-[10px] rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 transition-colors"
            title={t('Resume')}
          >
            {t('Resume')}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); deleteSession(s) }}
          className="shrink-0 w-5 h-5 rounded text-ide-text-muted opacity-0 group-hover:opacity-100 hover:text-ide-danger hover:bg-ide-hover flex items-center justify-center transition-all"
          title={t('Delete')}
        >
          <Trash2 size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none">
      <div className="px-2 py-1.5 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none space-y-1.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onBack}
            className="w-5 h-5 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors"
            title={t('Back')}
          >
            <ArrowLeft size={13} />
          </button>
          <span className="text-xs font-bold text-ide-text-muted uppercase tracking-wider truncate">{t('Session History')}</span>
          <div className="flex items-center rounded bg-ide-sidebar border border-ide-border p-0.5">
            <button
              onClick={() => setMode('tui')}
              className={`w-6 h-5 rounded flex items-center justify-center transition-colors ${mode === 'tui' ? 'bg-ide-accent/15 text-ide-accent' : 'text-ide-accent hover:bg-ide-accent/20'}`}
              title="cc tui"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => setMode('gui')}
              className={`w-6 h-5 rounded flex items-center justify-center transition-colors ${mode === 'gui' ? 'bg-ide-accent/15' : 'text-ide-text-muted hover:text-ide-text'}`}
              title="cc gui"
            >
              <ClaudeLogoIcon size={13} />
            </button>
            <button
              onClick={() => setMode('dsh')}
              className={`w-6 h-5 rounded flex items-center justify-center transition-colors ${mode === 'dsh' ? 'bg-ide-accent/15' : 'text-ide-text-muted hover:text-ide-text'}`}
              title="dsh"
            >
              <DeepSeekLogoIcon size={13} />
            </button>
          </div>
          <div className="flex-1" />
          <button
            onClick={fetchSessions}
            disabled={listLoading}
            className="w-5 h-5 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('Refresh')}
          >
            <RotateCcw size={13} className={listLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setOnlyCurrent(v => !v)}
            className={`flex items-center gap-1 h-5 px-2 rounded text-[11px] transition-colors ${onlyCurrent ? 'bg-ide-accent/15 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            title={t('Current project only')}
          >
            <Filter size={11} />
            <span>{t('Current project only')}</span>
          </button>
        </div>
        {mode === 'dsh' && (
          <button
            onClick={fetchDshList}
            disabled={dshLoading}
            className="flex items-center gap-1 h-5 px-2 rounded text-[11px] text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={11} className={dshLoading ? 'animate-spin' : ''} />
            <span>{t('Refresh')}</span>
          </button>
        )}
        <div className="relative" style={{ display: mode === 'dsh' ? 'none' : undefined }}>
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ide-text-muted/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search Claude sessions...')}
            className="w-full bg-ide-sidebar border border-ide-border rounded pl-7 pr-6 py-1.5 text-xs text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/50"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded text-ide-text-muted hover:text-ide-text flex items-center justify-center transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {mode === 'dsh' ? (
          dshLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-ide-text-muted">
              <Loader2 size={14} className="animate-spin" /><span>{t('Loading...')}</span>
            </div>
          ) : dshError ? (
            <div className="py-8 text-center text-xs text-ide-danger px-4">{dshError}</div>
          ) : dshSessions.length === 0 ? (
            <div className="py-8 text-center text-xs text-ide-text-muted px-4">{t('No history sessions')}</div>
          ) : (
            dshSessions.map((s) => (
              <div key={s.id} className="rounded-lg bg-ide-sidebar border border-ide-border overflow-hidden group">
                <div className="px-2.5 py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-xs text-ide-text">{s.title}</div>
                    <div className="text-[10px] text-ide-text-muted/60 truncate">
                      {s.cwd ? <span className="text-ide-text/70">{s.cwd}</span> : null}
                      {s.cwd ? ' · ' : ''}
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ''}
                    </div>
                  </div>
                  {!!onResumeDshHistory && (
                    <button
                      onClick={() => resumeDsh(s)}
                      className="shrink-0 px-2 py-0.5 text-[10px] rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 transition-colors"
                      title={t('Resume')}
                    >
                      {t('Resume')}
                    </button>
                  )}
                  {!s.running && (
                    <button
                      onClick={() => void deleteDsh(s)}
                      className="shrink-0 w-5 h-5 rounded text-ide-text-muted opacity-0 group-hover:opacity-100 hover:text-ide-danger hover:bg-ide-hover flex items-center justify-center transition-all"
                      title={t('Delete')}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )
        ) : debouncedQuery || !!query ? (
          searching || (!!query && !debouncedQuery) ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-ide-text-muted">
              <Loader2 size={14} className="animate-spin" /><span>{t('Searching...')}</span>
            </div>
          ) : searchError ? (
            <div className="py-8 text-center text-xs text-ide-danger px-4">{searchError}</div>
          ) : visibleSearchResults && visibleSearchResults.length === 0 ? (
            <div className="py-8 text-center text-xs text-ide-text-muted px-4">{t('No matching sessions')}</div>
          ) : (
            <>
              {searchTruncated && (
                <div className="text-[10px] text-ide-text-muted px-1">{t('Results truncated')}</div>
              )}
              {(visibleSearchResults || []).map((g) => (
                <div key={g.session_id} className="rounded-lg bg-ide-sidebar border border-ide-border overflow-hidden">
                  {renderSessionHead(g, { searchMode: true })}
                  {!expanded.has(g.session_id) && (
                    g.matches.map((m, mi) => (
                      <div key={mi} className="px-2.5 py-1 border-t border-ide-border/50 flex items-start gap-1 text-[11px] leading-snug">
                        <span className={`shrink-0 w-4 text-center select-none rounded ${m.role === 'user' ? 'text-ide-accent' : 'text-ide-success'}`}>
                          {m.role === 'user' ? t('User') : t('Assistant')}
                        </span>
                        <span className="min-w-0 flex-1 text-ide-text-muted/80 break-words">{highlightParts(m.text, debouncedQuery, false)}</span>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </>
          )
        ) : listLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-ide-text-muted">
            <Loader2 size={14} className="animate-spin" /><span>{t('Loading...')}</span>
          </div>
        ) : listError ? (
          <div className="py-8 text-center text-xs text-ide-danger px-4">{listError}</div>
        ) : visibleGroups.length === 0 ? (
          <div className="py-8 text-center text-xs text-ide-text-muted px-4">{t('No history sessions')}</div>
        ) : (
          visibleGroups.map(([dirName, list]) => {
            const isCollapsed = collapsedProjects.has(dirName)
            return (
              <div key={dirName}>
                <div
                  className={`flex items-center gap-1 px-1 pt-1 pb-1.5 cursor-pointer select-none rounded hover:bg-ide-hover/50 transition-colors ${isCollapsed ? 'bg-ide-hover/40' : ''}`}
                  onClick={() => toggleGroup(dirName)}
                >
                  <ChevronDown size={11} className={`text-ide-text-muted shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                  <span className="text-[10px] font-bold flex-1 min-w-0 flex items-center gap-1">
                    <FolderOpen size={11} className="text-ide-accent/70 shrink-0" />
                    <span className="truncate font-mono text-ide-text/80">{list[0]?.cwd || dirName}</span>
                  </span>
                  <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-ide-hover text-ide-text-muted">{list.length}</span>
                  {list[0]?.inCurrentProject && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-ide-accent/15 text-ide-accent">{t('Current project')}</span>
                  )}
                </div>
                {!isCollapsed && (
                  <div className="space-y-1">
                    {list.map((s) => (
                      <div key={s.session_id} className="rounded-lg bg-ide-sidebar border border-ide-border overflow-hidden">
                        {renderSessionHead(s)}
                        {expanded.has(s.session_id) && renderTurns(s)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
