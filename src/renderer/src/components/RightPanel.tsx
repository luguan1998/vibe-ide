import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useI18n } from '../i18n'

import GitTab from './GitTab'
import AuxTab from './AuxTab'
import FileTab from './FileTab'
import GameLauncher from './GameLauncher'
import BrowserView, { BrowserViewHandle } from './BrowserView'
import { getShortcuts, eventMatchesBinding } from '../shortcuts'
import { AuxTerminalTab, RecentFileEntry } from '@shared/types'

interface RightPanelProps {
  workspacePath: string | null
  onFileSelect?: (filePath: string, isStaged: boolean, commitHash: string | undefined, fullPath: string | undefined, gitStats: { additions: number; deletions: number }) => void
  refreshKey?: number
  pollingTick?: number
  onOpenFileFromRightTerminal?: (fullPath: string, lineNumber?: number) => void
  onOpenFileFromSearch?: (fullPath: string, lineNumber?: number) => void
  rightTerminalSessions?: Record<string, AuxTerminalTab[]>
  activeSessionId?: string | null
  onCreateRightTerminal?: (sessionId: string, cwd?: string) => void
  onCloseRightTerminal?: (sessionId: string) => void
  activeAuxIndex?: Record<string, number>
  onCloseAuxTerminal?: (sessionId: string, tabId: string) => void
  onSelectAuxTab?: (sessionId: string, index: number) => void
  onSplitAuxTerminal?: (sessionId: string, tabIndex: number) => void
  onResizeAuxSplit?: (sessionId: string, tabId: string, sizes: number[]) => void
  clearAuxBufferTrigger?: { sid: string; n: number }

  onOpenFileFromExplorer?: (fullPath: string) => void
  onCompareWithCurrent?: (fullPath: string) => void
  currentEditFilePath?: string | null
  onPreviewMarkdown?: (fullPath: string, fileName: string) => void
  onPreviewImage?: (fullPath: string, fileName: string) => void
  onOpenFileInBrowser?: (fullPath: string) => void
  onDiffScroll?: (delta: number) => void
  onToggleCollapse?: () => void
  capsuleTabs?: boolean
  onToggleCapsuleTabs?: () => void
  navigateToFilePayload?: { trigger: number; filePath: string } | null
  onNavigateToFile?: (filePath: string) => void
  onExploreNode?: (node: any) => void
  lineHistoryPayload?: { filePath: string; lineNumber: number } | null
  recentFiles?: RecentFileEntry[]
  onOpenRecentFile?: (fullPath: string, lineNumber?: number) => void
  onRemoveRecentFile?: (fullPath: string) => void
  onEditRecentFile?: (fullPath: string) => void
  brushActive?: boolean
  sessionWorktreeNav: Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>
  onWorktreeNavChange: React.Dispatch<React.SetStateAction<Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>>>
  onResumeClaudeHistory: (historySessionId: string, cwd: string, name: string, mode: 'tui' | 'gui') => void
  onResumeDshHistory?: (dshSessionId: string, cwd: string, name: string) => void
  historyNavNonce?: number
  browserDocked?: boolean
  browserDockNonce?: number
  browserViewRef?: React.MutableRefObject<BrowserViewHandle | null>
  onBrowserBack?: () => void
  onBrowserAnnotate?: (line: string) => void
  onBrowserToggleDock?: () => void
  hideTabBar?: boolean
  onRestoreWidth?: () => void
}

type GitSection = 'git' | 'terminal' | 'file' | 'game'

const ALL_SECTIONS: GitSection[] = ['file', 'git', 'terminal', 'game']

const TAB_DEFS: Record<GitSection, { label: string; icon: React.ReactNode }> = {
  git: {
    label: 'Git',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" paintOrder="stroke" className="w-4 h-4">
        <path d="M21 8.25C21 6.1815 19.3185 4.5 17.25 4.5C15.1815 4.5 13.5 6.1815 13.5 8.25C13.5 10.023 14.739 11.5035 16.395 11.892C16.116 12.819 15.2655 13.5 14.25 13.5H9.75C8.9025 13.5 8.1285 13.7925 7.5 14.268V7.4235C9.21 7.0755 10.5 5.5605 10.5 3.75C10.5 1.6815 8.8185 0 6.75 0C4.6815 0 3 1.6815 3 3.75C3 5.562 4.29 7.0755 6 7.4235V16.575C4.29 16.923 3 18.438 3 20.2485C3 22.317 4.6815 23.9985 6.75 23.9985C8.8185 23.9985 10.5 22.317 10.5 20.2485C10.5 18.4755 9.261 16.995 7.605 16.6065C7.884 15.6795 8.7345 14.9985 9.75 14.9985H14.25C16.0845 14.9985 17.61 13.6725 17.931 11.9295C19.674 11.607 21 10.0845 21 8.25ZM4.5 3.75C4.5 2.5095 5.5095 1.5 6.75 1.5C7.9905 1.5 9 2.5095 9 3.75C9 4.9905 7.9905 6 6.75 6C5.5095 6 4.5 4.9905 4.5 3.75ZM9 20.25C9 21.4905 7.9905 22.5 6.75 22.5C5.5095 22.5 4.5 21.4905 4.5 20.25C4.5 19.0095 5.5095 18 6.75 18C7.9905 18 9 19.0095 9 20.25ZM17.25 10.5C16.0095 10.5 15 9.4905 15 8.25C15 7.0095 16.0095 6 17.25 6C18.4905 6 19.5 7.0095 19.5 8.25C19.5 9.4905 18.4905 10.5 17.25 10.5Z" />
      </svg>
    ),
  },
  terminal: {
    label: 'Aux',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
        <path d="M5,10c-2.8,0-5-2.2-5-5s2.2-5,5-5s5,2.2,5,5c0,0.6-0.4,1-1,1S8,5.6,8,5c0-1.7-1.3-3-3-3S2,3.3,2,5s1.3,3,3,3 c0.6,0,1,0.4,1,1S5.6,10,5,10z" />
        <path d="M19,10c-0.6,0-1-0.4-1-1s0.4-1,1-1c1.7,0,3-1.3,3-3s-1.3-3-3-3s-3,1.3-3,3c0,0.6-0.4,1-1,1s-1-0.4-1-1c0-2.8,2.2-5,5-5 s5,2.2,5,5S21.8,10,19,10z" />
        <path d="M5,24c-2.8,0-5-2.2-5-5s2.2-5,5-5c0.6,0,1,0.4,1,1s-0.4,1-1,1c-1.7,0-3,1.3-3,3s1.3,3,3,3s3-1.3,3-3c0-0.6,0.4-1,1-1 s1,0.4,1,1C10,21.8,7.8,24,5,24z" />
        <path d="M19,24c-2.8,0-5-2.2-5-5c0-0.6,0.4-1,1-1s1,0.4,1,1c0,1.7,1.3,3,3,3s3-1.3,3-3s-1.3-3-3-3c-0.6,0-1-0.4-1-1s0.4-1,1-1 c2.8,0,5,2.2,5,5S21.8,24,19,24z" />
        <path d="M9,20c-0.6,0-1-0.4-1-1V5c0-0.6,0.4-1,1-1s1,0.4,1,1v14C10,19.6,9.6,20,9,20z" />
        <path d="M15,20c-0.6,0-1-0.4-1-1V5c0-0.6,0.4-1,1-1s1,0.4,1,1v14C16,19.6,15.6,20,15,20z" />
        <path d="M19,10H5c-0.6,0-1-0.4-1-1s0.4-1,1-1h14c0.6,0,1,0.4,1,1S19.6,10,19,10z" />
        <path d="M19,16H5c-0.6,0-1-0.4-1-1s0.4-1,1-1h14c0.6,0,1,0.4,1,1S19.6,16,19,16z" />
      </svg>
    ),
  },
  file: {
    label: 'Dir',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        <line x1="6" y1="12" x2="18" y2="12" />
      </svg>
    ),
  },
  game: {
    label: 'Nga',
    icon: (
      <svg viewBox="0 0 100 100" fill="currentColor" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" paintOrder="stroke" className="w-[17px] h-[17px]">
        <path d="M50.3,87.7c-1.1,0-2.2-0.3-3.1-1l-10.1-7c-0.8-0.5-1.8-0.6-2.6-0.1l-8.8,5.2c-1.7,1-3.7,1-5.5,0c-1.7-1-2.7-2.7-2.7-4.7 V43.9c0-17.9,14.6-32.5,32.5-32.5s32.5,14.6,32.5,32.5v36.4c0,2-1,3.7-2.7,4.7c-1.7,1-3.7,1-5.4,0l-8.9-5.2 c-0.8-0.5-1.9-0.4-2.7,0.1l-9.3,6.8C52.5,87.4,51.4,87.7,50.3,87.7z M35.7,76.4c1.1,0,2.2,0.3,3.1,1l10.1,7c0.9,0.6,2,0.6,2.8,0 l9.3-6.8c1.7-1.3,4.1-1.4,6-0.3l8.9,5.2l0,0c0.8,0.4,1.7,0.4,2.4,0c0.8-0.4,1.2-1.2,1.2-2.1V43.9c0-16.3-13.2-29.5-29.5-29.5 S20.5,27.6,20.5,43.9v36.4c0,0.9,0.5,1.7,1.2,2.1c0.8,0.4,1.7,0.4,2.4,0l8.8-5.2C33.8,76.6,34.7,76.4,35.7,76.4z M35.9,54.1 c-4.9,0-8.8-4-8.8-8.8c0-4.9,4-8.8,8.8-8.8s8.8,4,8.8,8.8C44.7,50.1,40.7,54.1,35.9,54.1z M35.9,39.5c-3.2,0-5.8,2.6-5.8,5.8 c0,3.2,2.6,5.8,5.8,5.8s5.8-2.6,5.8-5.8C41.7,42.1,39.1,39.5,35.9,39.5z M64.3,54.1c-4.9,0-8.8-4-8.8-8.8c0-4.9,4-8.8,8.8-8.8 s8.8,4,8.8,8.8C73.1,50.1,69.2,54.1,64.3,54.1z M64.3,39.5c-3.2,0-5.8,2.6-5.8,5.8c0,3.2,2.6,5.8,5.8,5.8s5.8-2.6,5.8-5.8 C70.1,42.1,67.5,39.5,64.3,39.5z M32.4,30.6c0.1-0.1,5.8-7.2,13.8-7.7c0.8,0,1.5-0.8,1.4-1.6c0-0.8-0.7-1.4-1.6-1.4 c-9.3,0.5-15.7,8.5-16,8.8c-0.5,0.6-0.4,1.6,0.2,2.1c0.3,0.2,0.6,0.3,0.9,0.3C31.7,31.1,32.1,30.9,32.4,30.6z" />
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
      if (Array.isArray(arr) && arr.length > 0 && arr.every(s => ALL_SECTIONS.includes(s))) {
        const missing = ALL_SECTIONS.filter(s => !arr.includes(s))
        if (missing.length > 0) {
          const merged = [...arr, ...missing]
          saveTabOrder(merged)
          return merged
        }
        return arr
      }
    }
  } catch {}
  return [...ALL_SECTIONS]
}

function saveTabOrder(order: GitSection[]) {
  try { localStorage.setItem('vibe-ide-right-tab-order', JSON.stringify(order)) } catch {}
}

const DEFAULT_VISIBLE_TABS: Record<GitSection, boolean> = { git: true, terminal: true, file: true, game: true }

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
    <div className="h-10 flex items-center shrink-0 px-3 right-panel__tab-bar" onContextMenu={handleContextMenu}>
      {capsuleTabs ? (
        <>
          <div className="flex-1" />
          <div className="flex items-center rounded-lg bg-ide-hover p-0.5">
            {tabs.map(section => {
              const active = section === activeSection
              return (
                <button
                  key={section}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors right-panel__tab${active ? ' right-panel__tab--active' : ''} ${
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
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
            {tabs.map(section => {
              const active = section === activeSection
              return (
                <button
                  key={section}
                  className={`w-7 h-7 flex items-center justify-center rounded transition-colors right-panel__tab${active ? ' right-panel__tab--active' : ''} ${
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
                  <span className="scale-100">{TAB_DEFS[section].icon}</span>
                </button>
              )
            })}
          </div>
        <div className="flex-1" />
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

// ── Hover Tab Rail (hideTabBar 模式:右缘垂直居中的图标导航) ──

function TabRail({ activeSection, visibleList, onSelect, onRestoreWidth, onHideRail }: {
  activeSection: GitSection
  visibleList: GitSection[]
  onSelect: (s: GitSection) => void
  onRestoreWidth?: () => void
  onHideRail?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1 border border-ide-border rounded-lg bg-ide-panel/95 backdrop-blur-md p-1 shadow-xl opacity-0 translate-x-3 pointer-events-none group-hover/rail:opacity-100 group-hover/rail:translate-x-0 group-hover/rail:pointer-events-auto transition-[opacity,transform] duration-150 ease-out group/rx">
      {visibleList.map((section, i) => {
        const active = section === activeSection
        return (
          <button
            key={section}
            className={`relative w-9 h-9 flex items-center justify-center rounded transition-colors ${
              active ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
            }`}
            onClick={() => onSelect(section)}
            title={TAB_DEFS[section].label}
          >
            <span className="scale-125">{TAB_DEFS[section].icon}</span>
            {i === 0 && onHideRail && (
              <span
                onClick={(e) => { e.stopPropagation(); onHideRail() }}
                title={t('Hide Rail')}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover bg-ide-panel border border-ide-border shadow-sm cursor-pointer opacity-0 pointer-events-none group-hover/rx:opacity-100 group-hover/rx:pointer-events-auto transition-opacity duration-150"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-2 h-2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </span>
            )}
          </button>
        )
      })}
      {onRestoreWidth && (
        <button
          className="w-9 h-9 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
          onClick={onRestoreWidth}
          title={t('Restore Default Width')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
      )}
    </div>
  )
}


function RightPanel({
  workspacePath, onFileSelect, refreshKey, pollingTick,
  onOpenFileFromRightTerminal, onOpenFileFromSearch,
  rightTerminalSessions, activeSessionId,
  onCreateRightTerminal, onCloseRightTerminal,
  activeAuxIndex, onCloseAuxTerminal, onSelectAuxTab, onSplitAuxTerminal, onResizeAuxSplit,
  clearAuxBufferTrigger, onOpenFileFromExplorer, onCompareWithCurrent, currentEditFilePath, onPreviewMarkdown, onPreviewImage, onOpenFileInBrowser,
  onDiffScroll,
  onToggleCollapse,
  capsuleTabs = true,
  onToggleCapsuleTabs,
  navigateToFilePayload, onNavigateToFile,
  onExploreNode,
  lineHistoryPayload,
  recentFiles, onOpenRecentFile,
  onRemoveRecentFile,
  onEditRecentFile,
  brushActive,
  sessionWorktreeNav,
  onWorktreeNavChange,
  onResumeClaudeHistory,
  onResumeDshHistory,
  historyNavNonce,
  browserDocked,
  browserDockNonce,
  browserViewRef,
  onBrowserBack,
  onBrowserAnnotate,
  onBrowserToggleDock,
  hideTabBar,
  onRestoreWidth,
}: RightPanelProps) {
  const [activeSection, setActiveSection] = useState<GitSection>('file')
  const [tabOrder, setTabOrder] = useState<GitSection[]>(loadTabOrder)
  const [visibleTabs, setVisibleTabs] = useState<Record<GitSection, boolean>>(DEFAULT_VISIBLE_TABS)
  const [fileRefreshKey, setFileRefreshKey] = useState(0)
  const [railHidden, setRailHidden] = useState(false)

  // 面板回到 tab 栏模式（宽度 <700）时清除竖栏隐藏状态
  useEffect(() => {
    if (!hideTabBar) setRailHidden(false)
  }, [hideTabBar])

  // Polling tick triggers file tree refresh
  useEffect(() => {
    if (pollingTick !== undefined && pollingTick > 0) {
      setFileRefreshKey(k => k + 1)
    }
  }, [pollingTick])

  const worktreeNav = activeSessionId ? sessionWorktreeNav[activeSessionId] ?? null : null
  const effectiveGitPath = worktreeNav?.worktreePath || workspacePath
  const auxArr = activeSessionId && rightTerminalSessions ? rightTerminalSessions[activeSessionId] : undefined
  const activeAuxIdx = activeSessionId && activeAuxIndex ? (activeAuxIndex[activeSessionId] ?? 0) : 0
  const activeRightTerminal = auxArr?.[activeAuxIdx]?.terminals?.[0] ?? null

  const visibleList = useMemo(() => tabOrder.filter(s => visibleTabs[s]), [tabOrder, visibleTabs])

  // 切 tab 时聚焦到 tab 内容（search tab 需聚焦到输入框）
  const gitContentRef = useRef<HTMLDivElement>(null)
  const terminalContentRef = useRef<HTMLDivElement>(null)
  const fileContentRef = useRef<HTMLDivElement>(null)
  const gameContentRef = useRef<HTMLDivElement>(null)
  const sectionRefs: Record<GitSection, React.RefObject<HTMLDivElement>> = {
    git: gitContentRef,
    terminal: terminalContentRef,
    file: fileContentRef,
    game: gameContentRef,
  }
  useEffect(() => {
    if (activeSection === 'game') {
      setTimeout(() => {
        const input = gameContentRef.current?.querySelector('input, textarea') as HTMLInputElement | null
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
      for (let i = 1; i <= 5; i++) {
        if (eventMatchesBinding(e, bindings[`panel.tab${i}`])) {
          e.preventDefault()
          e.stopImmediatePropagation()
          if (visibleList[i - 1]) {
            setActiveSection(visibleList[i - 1])
          }
        }
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [activeSection, visibleList])

  // navigateToFilePayload → 切换到 File 面板
  useEffect(() => {
    if (navigateToFilePayload && navigateToFilePayload.trigger > 0) {
      setVisibleTabs(prev => {
        if (prev['file']) return prev
        const next = { ...prev, file: true }
        return next
      })
      setActiveSection('file')
    }
  }, [navigateToFilePayload])

  // lineHistoryPayload → 切换到 Git 面板
  useEffect(() => {
    if (lineHistoryPayload) {
      setVisibleTabs(prev => {
        if (prev['git']) return prev
        const next = { ...prev, git: true }
        return next
      })
      setActiveSection('git')
    }
  }, [lineHistoryPayload])

  useEffect(() => {
    if (historyNavNonce) {
      setVisibleTabs(prev => {
        if (prev['game']) return prev
        const next = { ...prev, game: true }
        return next
      })
      setActiveSection('game')
    }
  }, [historyNavNonce])

  // 浏览器停靠右栏 → 切到 Nga tab 展示覆盖层
  useEffect(() => {
    if (browserDocked && browserDockNonce) {
      setVisibleTabs(prev => {
        if (prev['game']) return prev
        const next = { ...prev, game: true }
        return next
      })
      setActiveSection('game')
    }
  }, [browserDocked, browserDockNonce])

  // 确保 activeSection 始终可见（处理隐藏当前 tab 的情况）
  useEffect(() => {
    if (!visibleTabs[activeSection] && visibleList.length > 0) {
      setActiveSection(visibleList[0])
    }
  }, [visibleTabs, activeSection, visibleList])

  if (!workspacePath) {
    return (
      <div className="flex flex-col h-full group/rail relative">
        {!hideTabBar && (
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
        )}
        {hideTabBar && !railHidden && (
          <TabRail activeSection={activeSection} visibleList={visibleList} onSelect={setActiveSection} onRestoreWidth={onRestoreWidth} onHideRail={() => setRailHidden(true)} />
        )}
        <div className={`flex-1 min-h-0 mx-2 ${hideTabBar ? 'mb-0.5' : 'mb-1'} mt-0.5 bg-ide-sidebar border border-ide-border rounded-lg overflow-hidden flex items-center justify-center right-panel__content`}>
          <span className="text-ide-text-muted text-xs">No active session</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full right-panel group/rail relative">
      {!hideTabBar && (
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
      )}
      {hideTabBar && !railHidden && (
        <TabRail activeSection={activeSection} visibleList={visibleList} onSelect={setActiveSection} onRestoreWidth={onRestoreWidth} onHideRail={() => setRailHidden(true)} />
      )}

      <div className={`flex-1 min-h-0 mx-2 ${hideTabBar ? 'mb-0.5' : 'mb-2'} mt-0.5 bg-ide-sidebar border border-ide-border rounded-lg overflow-hidden flex flex-col right-panel__content`}>

      <div ref={gitContentRef} tabIndex={-1} style={{ display: activeSection === 'git' ? 'flex' : 'none' }} className="flex-1 min-h-0 flex flex-col outline-none focus:outline-none">
        <GitTab
          workspacePath={workspacePath}
          effectiveGitPath={effectiveGitPath}
          worktreeNav={worktreeNav}
          onFileSelect={onFileSelect}
          refreshKey={refreshKey}
          activeSessionId={activeSessionId ?? null}
          isActive={activeSection === 'git'}
          rightTerminalSession={activeRightTerminal}
          onCloseRightTerminal={onCloseRightTerminal}
          onWorktreeNavChange={onWorktreeNavChange}
          onDiffScroll={onDiffScroll}
          onNavigateToFile={onNavigateToFile}
          lineHistoryPayload={lineHistoryPayload}
        />
      </div>

      <div ref={terminalContentRef} tabIndex={-1} style={{ display: activeSection === 'terminal' ? 'flex' : 'none' }} className="flex-1 min-h-0 flex flex-col outline-none focus:outline-none">
        <AuxTab
          rightTerminalSessions={rightTerminalSessions ?? {}}
          activeSessionId={activeSessionId ?? null}
          effectiveGitPath={effectiveGitPath}
          worktreeNav={worktreeNav}
          onCreateRightTerminal={onCreateRightTerminal}
          onOpenFileFromRightTerminal={onOpenFileFromRightTerminal}
          isActive={activeSection === 'terminal'}
          clearAuxBufferTrigger={clearAuxBufferTrigger}
          activeAuxIndex={activeAuxIndex ?? {}}
          onCloseAuxTerminal={onCloseAuxTerminal}
          onSelectAuxTab={onSelectAuxTab}
          onSplitAuxTerminal={onSplitAuxTerminal}
          onResizeAuxSplit={onResizeAuxSplit}
        />
      </div>

      <div ref={fileContentRef} tabIndex={-1} style={{ display: activeSection === 'file' ? 'flex' : 'none' }} className="flex-1 flex flex-col outline-none focus:outline-none overflow-hidden">
        <FileTab
          workspacePath={workspacePath}
          onOpenFileFromExplorer={onOpenFileFromExplorer}
          onOpenFileAtLine={onOpenFileFromSearch}
          onCompareWithCurrent={onCompareWithCurrent}
          currentEditFilePath={currentEditFilePath}
          onPreviewMarkdown={onPreviewMarkdown}
          onPreviewImage={onPreviewImage}
          onOpenInBrowser={onOpenFileInBrowser}
          refreshKey={fileRefreshKey}
          navigateToFile={navigateToFilePayload}
          onRefresh={() => setFileRefreshKey(k => k + 1)}
          recentFiles={recentFiles ?? []}
          onOpenRecentFile={onOpenRecentFile}
          onRemoveRecentFile={onRemoveRecentFile}
          onEditRecentFile={onEditRecentFile}
          isActive={activeSection === 'file'}
          brushActive={brushActive}
          onExploreNode={onExploreNode}
        />
      </div>

      <div ref={gameContentRef} tabIndex={-1} style={{ display: activeSection === 'game' ? 'flex' : 'none' }} className="flex-1 flex flex-col outline-none focus:outline-none overflow-hidden relative">
        <GameLauncher workspacePath={workspacePath} onResumeClaudeHistory={onResumeClaudeHistory} onResumeDshHistory={onResumeDshHistory} historyNavNonce={historyNavNonce} onOpenFileFromExplorer={onOpenFileFromExplorer} onPreviewMarkdown={onPreviewMarkdown} />
        {browserDocked && (
          <div className="absolute inset-0 z-10 flex flex-col bg-ide-bg">
            <BrowserView
              ref={browserViewRef ?? undefined}
              docked
              onBack={onBrowserBack ?? (() => {})}
              onAnnotate={onBrowserAnnotate ?? (() => {})}
              onToggleDock={onBrowserToggleDock}
              workspacePath={workspacePath}
            />
          </div>
        )}
      </div>

      </div>

    </div>
  )
}

export default RightPanel
