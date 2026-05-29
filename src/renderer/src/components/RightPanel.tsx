import React, { useState, useEffect, useCallback, useRef } from 'react'
import { RotateCw } from 'lucide-react'
import SearchPanel from './SearchPanel'
import GitTab from './GitTab'
import AuxTab from './AuxTab'
import FileTab from './FileTab'
import { getShortcuts, eventMatchesBinding } from '../shortcuts'
import { TerminalSession } from '@shared/types'

interface RightPanelProps {
  workspacePath: string | null
  onFileSelect?: (filePath: string, diffContent: string, isStaged: boolean, commitHash?: string, fullPath?: string) => void
  refreshKey?: number
  onOpenFileFromRightTerminal?: (fullPath: string, lineNumber?: number) => void
  onOpenFileFromSearch?: (fullPath: string, lineNumber?: number) => void
  rightTerminalSession?: TerminalSession | null
  activeSessionId?: string | null
  onCreateRightTerminal?: (sessionId: string, cwd?: string) => void
  onCloseRightTerminal?: (sessionId: string) => void
  searchFocusTrigger?: number

  onOpenFileFromExplorer?: (fullPath: string) => void
  fileTreeDepth?: number
  onDiffScroll?: (delta: number) => void
  onToggleCollapse?: () => void
}

type GitSection = 'git' | 'terminal' | 'search' | 'file'

const ALL_SECTIONS: GitSection[] = ['git', 'terminal', 'file', 'search']

const TAB_DEFS: Record<GitSection, { label: string; icon: React.ReactNode }> = {
  git: {
    label: 'Git',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M6 21V9a9 9 0 0 0 9 9" />
        <path d="M18 3v12" />
      </svg>
    ),
  },
  terminal: {
    label: 'Aux',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  file: {
    label: 'File',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
    ),
  },
  search: {
    label: 'Find',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
}

// ── localStorage helpers ──

function loadTabOrder(): GitSection[] {
  try {
    const raw = localStorage.getItem('vibe-ide-right-tab-order')
    if (raw) {
      const arr = JSON.parse(raw) as GitSection[]
      if (Array.isArray(arr) && arr.length === 4 && ALL_SECTIONS.every(s => arr.includes(s))) return arr
    }
  } catch {}
  return [...ALL_SECTIONS]
}

function saveTabOrder(order: GitSection[]) {
  try { localStorage.setItem('vibe-ide-right-tab-order', JSON.stringify(order)) } catch {}
}

function loadVisibleTabs(): Record<GitSection, boolean> {
  try {
    const raw = localStorage.getItem('vibe-ide-right-tab-visible')
    if (raw) {
      const obj = JSON.parse(raw)
      const result = {} as Record<GitSection, boolean>
      for (const s of ALL_SECTIONS) {
        result[s] = typeof obj[s] === 'boolean' ? obj[s] : true
      }
      // 至少保留一个可见
      if (!Object.values(result).some(Boolean)) result['git'] = true
      return result
    }
  } catch {}
  return { git: true, terminal: true, file: true, search: true }
}

function saveVisibleTabs(v: Record<GitSection, boolean>) {
  try { localStorage.setItem('vibe-ide-right-tab-visible', JSON.stringify(v)) } catch {}
}

// ── Context Menu ──

function ContextMenu({
  x, y, visibleTabs, onToggle, onClose
}: {
  x: number; y: number;
  visibleTabs: Record<GitSection, boolean>;
  onToggle: (s: GitSection) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // delay so the right-click that opened it doesn't immediately close it
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handle)
    }
  }, [onClose])

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [onClose])

  // clamp to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 180),
    top: Math.min(y, window.innerHeight - 180),
    zIndex: 100,
  }

  return (
    <div
      ref={ref}
      style={style}
      className="bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[160px]"
    >
      {(() => {
        const visibleCount = Object.values(visibleTabs).filter(Boolean).length
        return ALL_SECTIONS.map(s => {
          const visible = visibleTabs[s]
          const def = TAB_DEFS[s]
          const isLast = visible && visibleCount === 1
          return (
          <button
            key={s}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors"
            onClick={() => {
              if (isLast) return
              onToggle(s)
            }}
          >
            <span className={`w-4 h-4 flex items-center justify-center ${visible ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
              {visible ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 opacity-30" />
              )}
            </span>
            <span className="text-ide-text-muted">{def.icon}</span>
            <span>{def.label}</span>
          </button>
        )
      })})()}
    </div>
  )
}

// ── Tab Bar ──

function TabBar({
  tabs,
  activeSection,
  onSelect,
  visibleTabs,
  onReorder,
  onToggleVisibility,
  onToggleCollapse,
  onRefreshFile,
}: {
  tabs: GitSection[]
  activeSection: GitSection
  onSelect: (s: GitSection) => void
  visibleTabs: Record<GitSection, boolean>
  onReorder: (fromSection: GitSection, toSection: GitSection) => void
  onToggleVisibility: (s: GitSection) => void
  onToggleCollapse?: () => void
  onRefreshFile?: () => void
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [dragOverSection, setDragOverSection] = useState<GitSection | null>(null)
  const dragSection = useRef<GitSection | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, section: GitSection) => {
    dragSection.current = section
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', section)
    // 拖拽时降低透明度
    const el = e.currentTarget as HTMLElement
    requestAnimationFrame(() => { el.style.opacity = '0.4' })
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '1'
    dragSection.current = null
    setDragOverSection(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, section: GitSection) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragSection.current && dragSection.current !== section) {
      setDragOverSection(section)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 只在真正离开按钮时清除高亮
    const target = e.currentTarget as HTMLElement
    if (!target.contains(e.relatedTarget as Node)) {
      setDragOverSection(prev => prev === (target as any).__section ? null : prev)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetSection: GitSection) => {
    e.preventDefault()
    const sourceSection = dragSection.current
    setDragOverSection(null)
    dragSection.current = null
    if (!sourceSection || sourceSection === targetSection) return
    onReorder(sourceSection, targetSection)
  }, [onReorder])

  return (
    <div className="h-10 flex items-center shrink-0 px-3 border-b border-ide-border" onContextMenu={handleContextMenu}>
      <span className="text-xs font-semibold text-ide-text tracking-wide uppercase select-none">
        {TAB_DEFS[activeSection].label}
      </span>
      {activeSection === 'file' && onRefreshFile && (
        <button
          className="ml-1.5 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
          onClick={onRefreshFile}
          title="Refresh file tree"
        >
          <RotateCw size={12} />
        </button>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        {tabs.map(section => {
          const active = section === activeSection
          return (
            <button
              key={section}
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                active ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
              } ${dragOverSection === section ? 'ring-1 ring-ide-accent bg-ide-accent/10' : ''}`}
              onClick={() => onSelect(section)}
              title={TAB_DEFS[section].label}
              draggable
              onDragStart={(e) => handleDragStart(e, section)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, section)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, section)}
              // 给 DOM 打标记，用于 dragLeave 判断
              ref={(el) => { if (el) (el as any).__section = section }}
            >
              {TAB_DEFS[section].icon}
            </button>
          )
        })}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          visibleTabs={visibleTabs}
          onToggle={onToggleVisibility}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

const RightPanel = React.memo(function RightPanel({
  workspacePath, onFileSelect, refreshKey,
  onOpenFileFromRightTerminal, onOpenFileFromSearch,
  rightTerminalSession, activeSessionId,
  onCreateRightTerminal, onCloseRightTerminal,
  searchFocusTrigger, onOpenFileFromExplorer,
  fileTreeDepth = 5, onDiffScroll,
  onToggleCollapse
}: RightPanelProps) {
  const [activeSection, setActiveSection] = useState<GitSection>('git')
  const [tabOrder, setTabOrder] = useState<GitSection[]>(loadTabOrder)
  const [visibleTabs, setVisibleTabs] = useState<Record<GitSection, boolean>>(loadVisibleTabs)
  const [sessionWorktreeNav, setSessionWorktreeNav] = useState<Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>>({})
  const [fileRefreshKey, setFileRefreshKey] = useState(0)

  const worktreeNav = activeSessionId ? sessionWorktreeNav[activeSessionId] ?? null : null
  const effectiveGitPath = worktreeNav?.worktreePath || workspacePath

  const visibleList = tabOrder.filter(s => visibleTabs[s])

  // 切 tab 时聚焦到 tab 内容（search tab 需聚焦到输入框）
  const gitContentRef = useRef<HTMLDivElement>(null)
  const terminalContentRef = useRef<HTMLDivElement>(null)
  const searchContentRef = useRef<HTMLDivElement>(null)
  const fileContentRef = useRef<HTMLDivElement>(null)
  const sectionRefs: Record<GitSection, React.RefObject<HTMLDivElement>> = {
    git: gitContentRef,
    terminal: terminalContentRef,
    search: searchContentRef,
    file: fileContentRef,
  }
  useEffect(() => {
    if (activeSection === 'search') {
      setTimeout(() => {
        const input = searchContentRef.current?.querySelector('input') as HTMLInputElement | null
        input?.focus()
      })
    } else {
      sectionRefs[activeSection]?.current?.focus({ preventScroll: true })
    }
  }, [activeSection])

  // 切换 visibleTabs 后确保持久化
  const handleToggleVisibility = useCallback((section: GitSection) => {
    setVisibleTabs(prev => {
      const next = { ...prev, [section]: !prev[section] }
      // 至少保留一个可见
      if (!Object.values(next).some(Boolean)) return prev
      saveVisibleTabs(next)
      return next
    })
  }, [])

  // 拖拽重排
  const handleReorder = useCallback((fromSection: GitSection, toSection: GitSection) => {
    setTabOrder(prev => {
      const fromIdx = prev.indexOf(fromSection)
      const toIdx = prev.indexOf(toSection)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      saveTabOrder(next)
      return next
    })
  }, [])

  // ── 键盘切换 tab（跳过隐藏的）──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const bindings = getShortcuts()
      if (eventMatchesBinding(e, bindings['panel.tabRight'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const idx = visibleList.indexOf(activeSection)
        if (idx !== -1) {
          setActiveSection(visibleList[(idx + 1) % visibleList.length])
        }
      }
      if (eventMatchesBinding(e, bindings['panel.tabLeft'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const idx = visibleList.indexOf(activeSection)
        if (idx !== -1) {
          setActiveSection(visibleList[(idx - 1 + visibleList.length) % visibleList.length])
        }
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [activeSection, visibleList])

  // Ctrl+F → 切换到搜索面板；若隐藏则自动显示
  useEffect(() => {
    if (searchFocusTrigger !== undefined && searchFocusTrigger > 0) {
      setVisibleTabs(prev => {
        if (prev['search']) return prev
        const next = { ...prev, search: true }
        saveVisibleTabs(next)
        return next
      })
      setActiveSection('search')
    }
  }, [searchFocusTrigger])

  // 确保 activeSection 始终可见（处理隐藏当前 tab 的情况）
  useEffect(() => {
    if (!visibleTabs[activeSection] && visibleList.length > 0) {
      setActiveSection(visibleList[0])
    }
  }, [visibleTabs, activeSection, visibleList])

  if (!workspacePath) {
    return (
      <div className="flex flex-col h-full">
        <TabBar
          tabs={visibleList}
          activeSection={activeSection}
          onSelect={setActiveSection}
          visibleTabs={visibleTabs}
          onReorder={handleReorder}
          onToggleVisibility={handleToggleVisibility}
          onToggleCollapse={onToggleCollapse}
          onRefreshFile={() => setFileRefreshKey(k => k + 1)}
        />
        <div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">
          No active session
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <TabBar
        tabs={visibleList}
        activeSection={activeSection}
        onSelect={setActiveSection}
        visibleTabs={visibleTabs}
        onReorder={handleReorder}
        onToggleVisibility={handleToggleVisibility}
        onToggleCollapse={onToggleCollapse}
        onRefreshFile={() => setFileRefreshKey(k => k + 1)}
      />

      <div ref={gitContentRef} tabIndex={-1} style={{ display: activeSection === 'git' ? 'flex' : 'none' }} className="flex-1 flex flex-col outline-none focus:outline-none">
        <GitTab
          workspacePath={workspacePath}
          effectiveGitPath={effectiveGitPath}
          worktreeNav={worktreeNav}
          onFileSelect={onFileSelect}
          refreshKey={refreshKey}
          activeSessionId={activeSessionId ?? null}
          isActive={activeSection === 'git'}
          rightTerminalSession={rightTerminalSession ?? null}
          onCloseRightTerminal={onCloseRightTerminal}
          onWorktreeNavChange={setSessionWorktreeNav}
          onDiffScroll={onDiffScroll}
        />
      </div>

      <div ref={terminalContentRef} tabIndex={-1} style={{ display: activeSection === 'terminal' ? 'flex' : 'none' }} className="flex-1 flex flex-col outline-none focus:outline-none">
        <AuxTab
          rightTerminalSession={rightTerminalSession ?? null}
          activeSessionId={activeSessionId ?? null}
          effectiveGitPath={effectiveGitPath}
          worktreeNav={worktreeNav}
          onCreateRightTerminal={onCreateRightTerminal}
          onOpenFileFromRightTerminal={onOpenFileFromRightTerminal}
          isActive={activeSection === 'terminal'}
        />
      </div>

      <div ref={searchContentRef} tabIndex={-1} style={{ display: activeSection === 'search' ? 'flex' : 'none' }} className="flex-1 flex flex-col outline-none focus:outline-none overflow-hidden">
        <SearchPanel
          cwd={workspacePath}
          onOpenFile={(fullPath, lineNumber) => {
            if (onOpenFileFromSearch) {
              onOpenFileFromSearch(fullPath, lineNumber)
            }
          }}
          focusTrigger={searchFocusTrigger}
        />
      </div>

      <div ref={fileContentRef} tabIndex={-1} style={{ display: activeSection === 'file' ? 'flex' : 'none' }} className="flex-1 flex flex-col outline-none focus:outline-none overflow-hidden">
        <FileTab
          workspacePath={workspacePath}
          onOpenFileFromExplorer={onOpenFileFromExplorer}
          fileTreeDepth={fileTreeDepth}
          refreshKey={fileRefreshKey}
        />
      </div>
    </div>
  )
})

export default RightPanel
