import React, { useState, useEffect, useCallback, useRef } from 'react'
const TerminalView = React.lazy(() => import('./TerminalView'))
import type { TerminalViewHandle } from './TerminalView'
import { AuxTerminalTab } from '@shared/types'
import { parseCommands, loadMdContent } from './DocTree'
import { useI18n } from '../i18n'

interface AuxTabProps {
  rightTerminalSessions: Record<string, AuxTerminalTab[]>
  activeSessionId: string | null
  effectiveGitPath: string | null
  worktreeNav: { originalPath: string; worktreePath: string; originalBranch: string } | null
  onCreateRightTerminal?: (sessionId: string, cwd?: string) => void
  onCloseAuxTerminal?: (sessionId: string, tabId: string) => void
  onSelectAuxTab?: (sessionId: string, index: number) => void
  onSplitAuxTerminal?: (sessionId: string, tabIndex: number) => void
  onResizeAuxSplit?: (sessionId: string, tabId: string, sizes: number[]) => void
  activeAuxIndex?: Record<string, number>
  onOpenFileFromRightTerminal?: (fullPath: string, lineNumber?: number) => void
  isActive?: boolean
  clearAuxBufferTrigger?: { sid: string; n: number }
}

export default function AuxTab({ rightTerminalSessions, activeSessionId, effectiveGitPath, worktreeNav, onCreateRightTerminal, onCloseAuxTerminal, onSelectAuxTab, onSplitAuxTerminal, onResizeAuxSplit, activeAuxIndex = {}, onOpenFileFromRightTerminal, isActive, clearAuxBufferTrigger }: AuxTabProps) {
  const [commands, setCommands] = useState<Array<{ command: string; comment: string }>>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState<number | null>(null)
  const pendingCommandRef = useRef<string | null>(null)
  const auxTerminalRefs = useRef<Record<string, TerminalViewHandle>>({})
  const selectedCommandIndexRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabIndex: number; tab: AuxTerminalTab } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const splitDragRef = useRef<{ sid: string; tabId: string; i: number; startY: number; startSizes: number[]; containerHeight: number } | null>(null)
  const focusedTermIdRef = useRef<string | null>(null)
  const onResizeAuxSplitRef = useRef(onResizeAuxSplit)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const { t } = useI18n()

  const activeArr = activeSessionId ? rightTerminalSessions[activeSessionId] : undefined
  const activeIdx = activeSessionId ? (activeAuxIndex[activeSessionId] ?? 0) : 0
  const activeTab = activeArr?.[activeIdx]
  const activeTerm = activeTab?.terminals?.[0]

  const handleLaunchOrAdd = useCallback(() => {
    if (!activeSessionId) return
    if (worktreeNav) {
      onCreateRightTerminal?.(activeSessionId, effectiveGitPath ?? undefined)
    } else {
      onCreateRightTerminal?.(activeSessionId)
    }
  }, [activeSessionId, worktreeNav, onCreateRightTerminal, effectiveGitPath])

  const handleRunCommand = useCallback((command: string) => {
    const trimmed = command.trim()
    if (/^https?:\/\//i.test(trimmed)) {
      (window as any).__vibeBrowse?.(trimmed)
      return
    }
    const target = activeTab?.terminals.find(t => t.id === focusedTermIdRef.current) ?? activeTerm
    if (target) {
      window.api.terminal.write(target.id, command + '\r')
    } else if (activeSessionId) {
      pendingCommandRef.current = command
      handleLaunchOrAdd()
    }
  }, [activeTab, activeTerm, activeSessionId, handleLaunchOrAdd])

  // 右侧终端打开文件的回调 - 触发中间终端切换到 edit
  const handleRightTerminalOpenFile = useCallback(async (fullPath: string, lineNumber?: number) => {
    if (onOpenFileFromRightTerminal) {
      onOpenFileFromRightTerminal(fullPath, lineNumber)
    }
  }, [onOpenFileFromRightTerminal])

  // Load CLAUDE.md (or AGENTS.md) commands（复用 GitTab pendingPathRef 防 stale 模式）
  const pendingPathRef = useRef<string | null>(null)

  const loadCommands = useCallback(async (targetPath: string | null) => {
    if (!targetPath) {
      if (pendingPathRef.current === targetPath) setCommands([])
      return
    }
    const content = await loadMdContent(targetPath)
    if (pendingPathRef.current !== targetPath) return
    if (!content) { setCommands([]); return }
    setCommands(parseCommands(content))
  }, [])

  useEffect(() => {
    const targetPath = effectiveGitPath
    pendingPathRef.current = targetPath
    setSelectedCommandIndex(null)
    hasAutoFocused.current = false
    loadCommands(targetPath)
  }, [effectiveGitPath, loadCommands])

  // 切 session 或切走 tab 时清除键盘导航高亮
  useEffect(() => { setSelectedCommandIndex(null) }, [activeSessionId])
  useEffect(() => { if (!isActive) { setSelectedCommandIndex(null); hasAutoFocused.current = false } }, [isActive])

  // 自动聚焦第一个命令
  const hasAutoFocused = useRef(false)
  useEffect(() => {
    if (!hasAutoFocused.current && commands.length > 0) {
      setSelectedCommandIndex(0)
      hasAutoFocused.current = true
    }
  }, [commands.length > 0])

  // 手动刷新：重新解析 CLAUDE.md 命令
  const handleRefreshCommands = useCallback(async () => {
    const targetPath = effectiveGitPath
    pendingPathRef.current = targetPath
    setSelectedCommandIndex(null)
    hasAutoFocused.current = false
    await loadCommands(targetPath)
  }, [effectiveGitPath, loadCommands])

  // Sync ref for keyboard handler (avoid re-registration on every index change)
  useEffect(() => { selectedCommandIndexRef.current = selectedCommandIndex }, [selectedCommandIndex])

  // Keyboard navigation in commands panel: ArrowUp/Down 选择，Enter 执行
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!isActiveRef.current) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (commands.length === 0) return
        e.preventDefault()
        const prev = selectedCommandIndexRef.current
        setSelectedCommandIndex(
          e.key === 'ArrowDown'
            ? (prev === null ? 0 : Math.min(prev + 1, commands.length - 1))
            : (prev === null ? commands.length - 1 : Math.max(prev - 1, 0))
        )
      } else if (e.key === 'Enter') {
        const idx = selectedCommandIndexRef.current
        if (idx !== null && idx < commands.length) {
          e.preventDefault()
          handleRunCommand(commands[idx].command)
        }
      } else if (e.key === 'Escape') {
        setSelectedCommandIndex(null)
      }
    }

    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [commands, handleRunCommand])

  // Execute pending command when aux terminal becomes ready
  useEffect(() => {
    if (activeTerm && pendingCommandRef.current) {
      const cmd = pendingCommandRef.current
      pendingCommandRef.current = null
      setTimeout(() => {
        window.api.terminal.write(activeTerm.id, cmd + '\r')
      }, 1200)
    }
  }, [activeTerm])

  // active index 超出数组长度时兜底修正（删除/外部变更后）
  useEffect(() => {
    if (!activeSessionId || !activeArr || activeArr.length === 0) return
    if (activeIdx >= activeArr.length) {
      onSelectAuxTab?.(activeSessionId, activeArr.length - 1)
    }
  }, [activeSessionId, activeArr, activeIdx, onSelectAuxTab])

  const updateArrows = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 0)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
  }, [])

  // tabs 增减/切 session 后更新左右箭头
  useEffect(() => {
    const id = setTimeout(updateArrows, 0)
    return () => clearTimeout(id)
  }, [activeArr, updateArrows])

  // panel resize 时更新箭头
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => updateArrows())
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateArrows])

  // 切 session 时聚焦新 active 的 aux 终端（primary）
  useEffect(() => {
    if (!isActive || !activeSessionId || !activeTerm) return
    focusedTermIdRef.current = activeTerm.id
    auxTerminalRefs.current[activeTerm.id]?.focus()
  }, [isActive, activeSessionId, activeTerm])

  useEffect(() => {
    if (!clearAuxBufferTrigger || clearAuxBufferTrigger.n === 0) return
    const sid = clearAuxBufferTrigger.sid
    const arr = rightTerminalSessions[sid]
    const idx = activeAuxIndex[sid] ?? 0
    const tab = arr?.[idx]
    if (tab) tab.terminals.forEach(t => auxTerminalRefs.current[t.id]?.clearBuffer())
  }, [clearAuxBufferTrigger])

  // 拖拽分隔条：实时改 sizes，TerminalView ResizeObserver 自动 re-fit
  useEffect(() => { onResizeAuxSplitRef.current = onResizeAuxSplit })

  const onSplitMouseMove = useCallback((e: MouseEvent) => {
    const d = splitDragRef.current
    if (!d) return
    const totalGrow = d.startSizes.reduce((s, n) => s + n, 0) || 1
    const deltaRatio = (e.clientY - d.startY) / d.containerHeight
    const growDelta = deltaRatio * totalGrow
    const newSizes = [...d.startSizes]
    newSizes[d.i] = Math.max(0.1, d.startSizes[d.i] + growDelta)
    newSizes[d.i + 1] = Math.max(0.1, d.startSizes[d.i + 1] - growDelta)
    onResizeAuxSplitRef.current?.(d.sid, d.tabId, newSizes)
  }, [])

  const onSplitMouseUp = useCallback(() => {
    splitDragRef.current = null
    window.removeEventListener('mousemove', onSplitMouseMove)
    window.removeEventListener('mouseup', onSplitMouseUp)
  }, [onSplitMouseMove])

  const startSplitDrag = useCallback((e: React.MouseEvent, sid: string, tab: AuxTerminalTab, i: number) => {
    e.preventDefault()
    e.stopPropagation()
    const container = (e.currentTarget as HTMLElement).parentElement
    const containerHeight = container?.clientHeight ?? 1
    splitDragRef.current = { sid, tabId: tab.id, i, startY: e.clientY, startSizes: [...tab.sizes], containerHeight }
    window.addEventListener('mousemove', onSplitMouseMove)
    window.addEventListener('mouseup', onSplitMouseUp)
  }, [onSplitMouseMove, onSplitMouseUp])

  // contextMenu：mousedown 外部关闭 + ESC
  useEffect(() => {
    if (!contextMenu) return
    const handle = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 0)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handle)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  const showTabBar = activeArr && activeArr.length > 0

  return (
    <div ref={containerRef} tabIndex={-1} className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none focus:ring-0">
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {Object.entries(rightTerminalSessions).flatMap(([sid, tabs]) =>
          tabs.map((tab, tabIndex) => {
            const tabActive = sid === activeSessionId && tabIndex === (activeAuxIndex[sid] ?? 0)
            return (
              <div key={tab.id} className="h-full flex flex-col overflow-hidden" style={{ display: tabActive ? 'flex' : 'none' }}>
                {tab.terminals.map((term, i) => (
                  <React.Fragment key={term.id}>
                    <div
                      style={{ flex: tab.sizes[i] ?? 1 }}
                      className="min-h-0 flex flex-col overflow-hidden"
                      onMouseDown={() => { focusedTermIdRef.current = term.id }}
                    >
                      <React.Suspense fallback={<div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">Loading...</div>}>
                        <TerminalView
                          ref={(node) => { if (node) auxTerminalRefs.current[term.id] = node }}
                          sessionId={term.id}
                          sessionName="Right Terminal"
                          sessionCwd={term.cwd}
                          onOpenFile={handleRightTerminalOpenFile}
                          showHeader={false}
                          fontSize={12}
                          isAux={true}
                          isActive={tabActive && isActive}
                        />
                      </React.Suspense>
                    </div>
                    {i < tab.terminals.length - 1 && (
                      <div
                        onMouseDown={(e) => startSplitDrag(e, sid, tab, i)}
                        className="shrink-0 h-1 cursor-ns-resize bg-ide-border hover:bg-ide-accent/60 transition-colors"
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>
            )
          })
        )}
        {(!activeArr || activeArr.length === 0) && (
          effectiveGitPath ? (
            <div className="h-full flex items-center justify-center">
              <button
                onClick={handleLaunchOrAdd}
                className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors aux-tab__launch-btn"
              >
                {t('Launch Terminal')}
              </button>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-ide-text-muted text-xs">
              {t('Please select a workspace first')}
            </div>
          )
        )}
      </div>
      {showTabBar && (
        <div className="shrink-0 flex items-end h-7 bg-ide-border/20 aux-tab__bar">
          {canLeft && (
            <button
              onClick={() => scrollRef.current?.scrollBy({ left: -120, behavior: 'smooth' })}
              className="shrink-0 w-5 h-6 flex items-center justify-center text-ide-text-muted hover:text-ide-text transition-colors"
              title={t('Scroll Left')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div ref={scrollRef} onScroll={updateArrows} className="flex-1 flex items-end overflow-x-auto aux-tab__scroll">
            {activeArr!.map((tab, i) => {
              const active = i === activeIdx
              const primary = tab.terminals[0]
              return (
                <div
                  key={tab.id}
                  className={`group relative flex items-center gap-1 pl-2.5 pr-1.5 text-xs cursor-pointer shrink-0 transition-colors aux-tab__term ${
                    active
                      ? 'bg-ide-sidebar rounded-t-md border-t border-x border-ide-border border-b-2 border-b-ide-accent h-7 text-ide-text'
                      : 'bg-ide-hover/30 rounded-t-md h-6 text-ide-text-muted hover:bg-ide-hover/50 hover:text-ide-text'
                  }`}
                  onClick={() => activeSessionId && onSelectAuxTab?.(activeSessionId, i)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, tabIndex: i, tab }) }}
                  title={`${primary?.name ?? ''} — ${primary?.cwd ?? ''}`}
                >
                  {tab.terminals.length > 1 ? (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-ide-accent/70">
                      <rect x="2" y="2" width="12" height="5" rx="1" />
                      <rect x="2" y="9" width="12" height="5" rx="1" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
                      <polyline points="3.5,4 7,8 3.5,12" />
                      <line x1="9" y1="12" x2="13" y2="12" />
                    </svg>
                  )}
                  <span className="font-mono truncate max-w-[80px]">{(primary?.cwd.split(/[\\/]/).filter(Boolean).pop() || primary?.cwd || '')} {i + 1}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); activeSessionId && onCloseAuxTerminal?.(activeSessionId, tab.id) }}
                    className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 text-ide-text-muted hover:bg-ide-hover hover:text-ide-text ${
                      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    title={t('Close')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
          {canRight && (
            <button
              onClick={() => scrollRef.current?.scrollBy({ left: 120, behavior: 'smooth' })}
              className="shrink-0 w-5 h-6 flex items-center justify-center text-ide-text-muted hover:text-ide-text transition-colors"
              title={t('Scroll Right')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
          <button
            onClick={handleLaunchOrAdd}
            className="w-5 h-6 flex items-center justify-center text-ide-text-muted hover:text-ide-text transition-colors shrink-0 aux-tab__add-btn"
            title={t('New Terminal')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      )}
      {commands.length > 0 && (
        <div className="shrink-0 border-t border-ide-border" style={{ maxHeight: '32%', overflowY: 'auto' }}>
          {!showTabBar && (
            <div className="px-2 py-1 group flex items-center justify-between sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm border-b border-ide-border">
              <span className="text-[10px] uppercase tracking-wider text-ide-accent">{t('Commands')}</span>
              <button
                onClick={handleRefreshCommands}
                className="w-4 h-4 mr-1 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-all"
                title={t('Refresh')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            </div>
          )}
          {commands.map((cmd, i) => (
            <div
              key={i}
              className={`px-2 py-0.5 flex items-center gap-1.5 hover:bg-ide-hover group ${
                selectedCommandIndex === i ? 'bg-ide-accent/10 text-ide-text' : ''
              }`}
            >
              <button
                onClick={() => handleRunCommand(cmd.command)}
                className="w-5 h-5 rounded text-ide-accent hover:bg-ide-accent/20 flex items-center justify-center shrink-0 transition-colors"
                title={`Run: ${cmd.command}`}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
                </svg>
              </button>
              <span className={`text-xs font-mono font-semibold shrink-0 w-[8.5rem] truncate ${/^https?:\/\//i.test(cmd.command.trim()) ? 'text-ide-accent underline' : 'text-ide-text'}`}>{cmd.command}</span>
              <span className="text-xs text-ide-text-muted/70 truncate">{cmd.comment}</span>
            </div>
          ))}
        </div>
      )}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{ position: 'fixed', left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.min(contextMenu.y, window.innerHeight - 120), zIndex: 100 }}
          className="bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[160px]"
        >
          <button
            disabled={contextMenu.tab.terminals.length >= 3}
            onClick={() => { activeSessionId && onSplitAuxTerminal?.(activeSessionId, contextMenu.tabIndex); setContextMenu(null) }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <rect x="2" y="2" width="12" height="5" rx="1" />
              <rect x="2" y="9" width="12" height="5" rx="1" />
            </svg>
            {t('Split Down')}
          </button>
          <button
            onClick={() => { activeSessionId && onCloseAuxTerminal?.(activeSessionId, contextMenu.tab.id); setContextMenu(null) }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {t('Close')}
          </button>
        </div>
      )}
    </div>
  )
}
