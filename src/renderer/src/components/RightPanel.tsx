import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useI18n } from '../i18n'

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
  pollingTick?: number
  onOpenFileFromRightTerminal?: (fullPath: string, lineNumber?: number) => void
  onOpenFileFromSearch?: (fullPath: string, lineNumber?: number) => void
  rightTerminalSession?: TerminalSession | null
  activeSessionId?: string | null
  onCreateRightTerminal?: (sessionId: string, cwd?: string) => void
  onCloseRightTerminal?: (sessionId: string) => void
  searchFocusTrigger?: number

  onOpenFileFromExplorer?: (fullPath: string) => void
  onPreviewMarkdown?: (fullPath: string, fileName: string) => void
  onPreviewImage?: (fullPath: string, fileName: string) => void
  fileTreeDepth?: number
  onDiffScroll?: (delta: number) => void
  onToggleCollapse?: () => void
  capsuleTabs?: boolean
  onToggleCapsuleTabs?: () => void
  navigateToFilePayload?: { trigger: number; filePath: string } | null
  onNavigateToFile?: (filePath: string) => void
  onExploreNode?: (node: any) => void
}

type GitSection = 'git' | 'terminal' | 'search' | 'file'

const ALL_SECTIONS: GitSection[] = ['file', 'git', 'terminal', 'search']

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
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M18.75 1.5H5.25C3.1815 1.5 1.5 3.183 1.5 5.25V18.75C1.5 20.8185 3.1815 22.5 5.25 22.5H18.75C20.8185 22.5 22.5 20.8185 22.5 18.75V5.25C22.5 3.183 20.8185 1.5 18.75 1.5ZM21 18.75C21 19.9905 19.9905 21 18.75 21H5.25C4.0095 21 3 19.9905 3 18.75V5.25C3 4.0095 4.0095 3 5.25 3H18.75C19.9905 3 21 4.0095 21 5.25V18.75ZM10.281 13.281L5.781 17.781C5.634 17.928 5.442 18 5.25 18C5.058 18 4.866 17.9265 4.719 17.781C4.4265 17.4885 4.4265 17.013 4.719 16.7205L8.688 12.7515L4.719 8.7825C4.4265 8.49 4.4265 8.0145 4.719 7.722C5.0115 7.4295 5.487 7.4295 5.7795 7.722L10.2795 12.222C10.572 12.5145 10.572 12.99 10.2795 13.2825L10.281 13.281ZM19.5 17.25C19.5 17.664 19.164 18 18.75 18H11.25C10.836 18 10.5 17.664 10.5 17.25C10.5 16.836 10.836 16.5 11.25 16.5H18.75C19.164 16.5 19.5 16.836 19.5 17.25Z" />
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
  x, y, visibleTabs, onToggle, onClose,
  capsuleTabs, onToggleCapsuleTabs,
}: {
  x: number; y: number;
  visibleTabs: Record<GitSection, boolean>;
  onToggle: (s: GitSection) => void;
  onClose: () => void;
  capsuleTabs?: boolean;
  onToggleCapsuleTabs?: () => void;
}) {
  const { t } = useI18n()
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
      {onToggleCapsuleTabs && (
        <>
          <div className="border-t border-ide-border my-1" />
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors"
            onClick={() => onToggleCapsuleTabs()}
          >
            <span className="w-4 h-4 flex items-center justify-center text-ide-text">
              {capsuleTabs ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 opacity-30" />
              )}
            </span>
            <span>{t('Capsule Tabs')}</span>
          </button>
        </>
      )}
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
  capsuleTabs = true,
  onToggleCapsuleTabs,
}: {
  tabs: GitSection[]
  activeSection: GitSection
  onSelect: (s: GitSection) => void
  visibleTabs: Record<GitSection, boolean>
  onReorder: (fromSection: GitSection, toSection: GitSection) => void
  onToggleVisibility: (s: GitSection) => void
  onToggleCollapse?: () => void
  capsuleTabs?: boolean
  onToggleCapsuleTabs?: () => void
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
      {capsuleTabs ? (
        <>
          <div className="flex-1" />
          <div className="flex items-center rounded-lg bg-ide-hover p-0.5">
            {tabs.map(section => {
              const active = section === activeSection
              return (
                <button
                  key={section}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    active ? 'bg-ide-accent/15 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text'
                  } ${dragOverSection === section ? 'ring-1 ring-ide-accent' : ''}`}
                  onClick={() => onSelect(section)}
                  title={TAB_DEFS[section].label}
                  draggable
                  onDragStart={(e) => handleDragStart(e, section)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, section)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, section)}
                  ref={(el) => { if (el) (el as any).__section = section }}
                >
                  {TAB_DEFS[section].icon}
                  <span>{TAB_DEFS[section].label}</span>
                </button>
              )
            })}
          </div>
          <div className="flex-1" />
        </>
      ) : (
        <>
          <span className="text-xs font-semibold text-ide-text tracking-wide uppercase select-none">
            {TAB_DEFS[activeSection].label}
          </span>
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
                  ref={(el) => { if (el) (el as any).__section = section }}
                >
                  {TAB_DEFS[section].icon}
                </button>
              )
            })}
          </div>
        </>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          visibleTabs={visibleTabs}
          onToggle={onToggleVisibility}
          onClose={() => setContextMenu(null)}
          capsuleTabs={capsuleTabs}
          onToggleCapsuleTabs={onToggleCapsuleTabs}
        />
      )}
    </div>
  )
}

function RightPanel({
  workspacePath, onFileSelect, refreshKey, pollingTick,
  onOpenFileFromRightTerminal, onOpenFileFromSearch,
  rightTerminalSession, activeSessionId,
  onCreateRightTerminal, onCloseRightTerminal,
  searchFocusTrigger, onOpenFileFromExplorer, onPreviewMarkdown, onPreviewImage,
  fileTreeDepth = 5, onDiffScroll,
  onToggleCollapse,
  capsuleTabs = true,
  onToggleCapsuleTabs,
  navigateToFilePayload, onNavigateToFile,
  onExploreNode,
}: RightPanelProps) {
  const [activeSection, setActiveSection] = useState<GitSection>('git')
  const [tabOrder, setTabOrder] = useState<GitSection[]>(loadTabOrder)
  const [visibleTabs, setVisibleTabs] = useState<Record<GitSection, boolean>>(loadVisibleTabs)
  const [sessionWorktreeNav, setSessionWorktreeNav] = useState<Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>>({})
  const [fileRefreshKey, setFileRefreshKey] = useState(0)

  // Polling tick triggers file tree refresh
  useEffect(() => {
    if (pollingTick !== undefined && pollingTick > 0) {
      setFileRefreshKey(k => k + 1)
    }
  }, [pollingTick])

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

  // navigateToFilePayload → 切换到 File 面板
  useEffect(() => {
    if (navigateToFilePayload && navigateToFilePayload.trigger > 0) {
      setVisibleTabs(prev => {
        if (prev['file']) return prev
        const next = { ...prev, file: true }
        saveVisibleTabs(next)
        return next
      })
      setActiveSection('file')
    }
  }, [navigateToFilePayload])

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
          capsuleTabs={capsuleTabs}
          onToggleCapsuleTabs={onToggleCapsuleTabs}
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
        capsuleTabs={capsuleTabs}
        onToggleCapsuleTabs={onToggleCapsuleTabs}
      />

      <div ref={gitContentRef} tabIndex={-1} style={{ display: activeSection === 'git' ? 'flex' : 'none' }} className="flex-1 min-h-0 flex flex-col outline-none focus:outline-none">
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
          onNavigateToFile={onNavigateToFile}
        />
      </div>

      <div ref={terminalContentRef} tabIndex={-1} style={{ display: activeSection === 'terminal' ? 'flex' : 'none' }} className="flex-1 min-h-0 flex flex-col outline-none focus:outline-none">
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
          onExploreNode={onExploreNode}
        />
      </div>

      <div ref={fileContentRef} tabIndex={-1} style={{ display: activeSection === 'file' ? 'flex' : 'none' }} className="flex-1 flex flex-col outline-none focus:outline-none overflow-hidden">
        <FileTab
          workspacePath={workspacePath}
          onOpenFileFromExplorer={onOpenFileFromExplorer}
          onPreviewMarkdown={onPreviewMarkdown}
          onPreviewImage={onPreviewImage}
          fileTreeDepth={fileTreeDepth}
          refreshKey={fileRefreshKey}
          navigateToFile={navigateToFilePayload}
          onRefresh={() => setFileRefreshKey(k => k + 1)}
        />
      </div>

    </div>
  )
}

export default RightPanel
