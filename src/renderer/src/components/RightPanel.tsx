import React, { useState, useEffect } from 'react'
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
}

type GitSection = 'git' | 'terminal' | 'search' | 'file'

// Shared tab bar (used in both no-workspace and main return)
function TabBar({ activeSection, onSelect }: { activeSection: GitSection; onSelect: (s: GitSection) => void }) {
  return (
    <div className="h-10 flex items-center shrink-0 px-3 border-b border-ide-border">
      <span className="text-xs font-semibold text-ide-text tracking-wide uppercase">
        {activeSection === 'git' ? 'Git' : activeSection === 'terminal' ? 'Aux' : activeSection === 'search' ? 'Find' : activeSection === 'file' ? 'File' : 'Settings'}
      </span>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <button
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'git' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
          onClick={() => onSelect('git')}
          title="Git"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M6 21V9a9 9 0 0 0 9 9" />
            <path d="M18 3v12" />
          </svg>
        </button>
        <button
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'terminal' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
          onClick={() => onSelect('terminal')}
          title="Aux"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>
        <button
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'file' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
          onClick={() => onSelect('file')}
          title="File"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        </button>
        <button
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'search' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
          onClick={() => onSelect('search')}
          title="Find"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>
    </div>
  )
}

const RightPanel = React.memo(function RightPanel({
  workspacePath, onFileSelect, refreshKey,
  onOpenFileFromRightTerminal, onOpenFileFromSearch,
  rightTerminalSession, activeSessionId,
  onCreateRightTerminal, onCloseRightTerminal,
  searchFocusTrigger, onOpenFileFromExplorer,
  fileTreeDepth = 5, onDiffScroll
}: RightPanelProps) {
  const [activeSection, setActiveSection] = useState<GitSection>('git')
  // worktree 导航状态跨 tab 共享：Git tab 显示 back 按钮，Aux tab 需要 worktree cwd
  const [sessionWorktreeNav, setSessionWorktreeNav] = useState<Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>>({})

  const worktreeNav = activeSessionId ? sessionWorktreeNav[activeSessionId] ?? null : null
  const effectiveGitPath = worktreeNav?.worktreePath || workspacePath

  // Ctrl+Left/Right → switch right panel tabs
  const tabOrder = ['git', 'terminal', 'file', 'search'] as const
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const bindings = getShortcuts()
      if (eventMatchesBinding(e, bindings['panel.tabRight'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const idx = tabOrder.indexOf(activeSection)
        setActiveSection(tabOrder[(idx + 1) % tabOrder.length])
      }
      if (eventMatchesBinding(e, bindings['panel.tabLeft'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const idx = tabOrder.indexOf(activeSection)
        setActiveSection(tabOrder[(idx - 1 + tabOrder.length) % tabOrder.length])
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [activeSection])

  // Ctrl+F → 切换到搜索面板
  useEffect(() => {
    if (searchFocusTrigger !== undefined && searchFocusTrigger > 0) {
      setActiveSection('search')
    }
  }, [searchFocusTrigger])

  if (!workspacePath) {
    return (
      <div className="flex flex-col h-full">
        <TabBar activeSection={activeSection} onSelect={setActiveSection} />
        <div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">
          No active session
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <TabBar activeSection={activeSection} onSelect={setActiveSection} />

      {activeSection === 'git' && (
        <GitTab
          workspacePath={workspacePath}
          effectiveGitPath={effectiveGitPath}
          worktreeNav={worktreeNav}
          onFileSelect={onFileSelect}
          refreshKey={refreshKey}
          activeSessionId={activeSessionId ?? null}
          rightTerminalSession={rightTerminalSession ?? null}
          onCloseRightTerminal={onCloseRightTerminal}
          onWorktreeNavChange={setSessionWorktreeNav}
          onDiffScroll={onDiffScroll}
        />
      )}

      {activeSection === 'terminal' && (
        <AuxTab
          rightTerminalSession={rightTerminalSession ?? null}
          activeSessionId={activeSessionId ?? null}
          effectiveGitPath={effectiveGitPath}
          worktreeNav={worktreeNav}
          onCreateRightTerminal={onCreateRightTerminal}
          onOpenFileFromRightTerminal={onOpenFileFromRightTerminal}
        />
      )}

      {activeSection === 'search' && (
        <SearchPanel
          cwd={workspacePath}
          onOpenFile={(fullPath, lineNumber) => {
            if (onOpenFileFromSearch) {
              onOpenFileFromSearch(fullPath, lineNumber)
            }
          }}
          focusTrigger={searchFocusTrigger}
        />
      )}

      {activeSection === 'file' && (
        <FileTab
          workspacePath={workspacePath}
          onOpenFileFromExplorer={onOpenFileFromExplorer}
          fileTreeDepth={fileTreeDepth}
        />
      )}
    </div>
  )
})

export default RightPanel
