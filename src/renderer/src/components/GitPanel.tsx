import React, { useState, useEffect, useCallback, useRef } from 'react'
import TerminalView from './TerminalView'
import SearchPanel from './SearchPanel'
import { GitStatusResult, GitFileStatus, GitLogEntry, GitBranch, GitShowResult, GitCommitFile, TerminalSession } from '@shared/types'

interface GitPanelProps {
  workspacePath: string | null
  onFileSelect?: (filePath: string, diffContent: string, isStaged: boolean) => void
  refreshKey?: number
  // 右侧终端跳转时，触发中间终端切换到 edit 模式
  onOpenFileFromRightTerminal?: (fullPath: string, lineNumber?: number) => void
  // 搜索跳转时，触发中间终端切换到 edit 模式
  onOpenFileFromSearch?: (fullPath: string, lineNumber?: number) => void
  // 右侧独立终端 session
  rightTerminalSession?: TerminalSession | null
  // 创建右侧终端
  onCreateRightTerminal?: () => void
  // 关闭右侧终端
  onCloseRightTerminal?: () => void
  // Ctrl+F 触发搜索面板聚焦
  searchFocusTrigger?: number
}

type GitTab = 'changes' | 'log' | 'branches'
type GitSection = 'git' | 'terminal' | 'search'

const GitPanel = React.memo(function GitPanel({ workspacePath, onFileSelect, refreshKey, onOpenFileFromRightTerminal, onOpenFileFromSearch, rightTerminalSession, onCreateRightTerminal, onCloseRightTerminal, searchFocusTrigger }: GitPanelProps) {
  const [activeSection, setActiveSection] = useState<GitSection>('git')
  const [activeTab, setActiveTab] = useState<GitTab>('changes')
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [logs, setLogs] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')
  const [diffStaged, setDiffStaged] = useState<boolean>(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentGitPath, setCurrentGitPath] = useState<string | null>(null)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  const [commitDiff, setCommitDiff] = useState<string>('')
  const gitChangedHandlerRef = useRef<any>(null)

  // Switch git workspace when workspacePath changes
  useEffect(() => {
    if (!workspacePath || workspacePath === currentGitPath) return
    const switchWorkspace = async () => {
      const result = await window.api.git.setWorkspace(workspacePath)
      if (result.success) {
        setCurrentGitPath(workspacePath)
        // Refresh all git data for the new workspace
        refreshStatus()
        refreshLog()
        refreshBranches()
      }
    }
    switchWorkspace()
  }, [workspacePath])

  // Handle refreshKey changes (triggered by Ctrl+S in DiffViewer)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refreshStatus()
    }
  }, [refreshKey])

  // Listen for git:changed events from file watcher
  useEffect(() => {
    gitChangedHandlerRef.current = window.api.git.onChanged(() => {
      // Auto refresh when git state changes (external edits, terminal commands, etc.)
      refreshStatus()
      if (activeTab === 'log') refreshLog()
    })

    return () => {
      window.api.git.removeChangedListener(gitChangedHandlerRef.current)
    }
  }, [activeTab])

  // Refresh git status
  const refreshStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.git.status()
      if (result.error) {
        setError(result.error)
      } else {
        setStatus(result)
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }, [])

  // Refresh git log
  const refreshLog = useCallback(async () => {
    try {
      const result = await window.api.git.log(50)
      if (result.error) {
        setError(result.error)
      } else {
        setLogs(result)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  // Refresh branches
  const refreshBranches = useCallback(async () => {
    try {
      const result = await window.api.git.branches()
      if (result.error) {
        setError(result.error)
      } else {
        setBranches(result)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  // Load diff for a file
  const loadDiff = useCallback(async (filePath: string, staged: boolean) => {
    setLoading(true)
    try {
      const result = await window.api.git.diff(filePath, staged)
      if (result.error) {
        setError(result.error)
        setDiffContent('')
      } else {
        setDiffContent(result.content || '')
        setDiffStaged(staged)
      }
    } catch (err: any) {
      setError(err.message)
      setDiffContent('')
    }
    setLoading(false)
  }, [])

  // Handle file click - show diff
  const handleFileClick = useCallback(async (file: GitFileStatus) => {
    setSelectedFile(file.path)
    await loadDiff(file.path, file.staged)
    if (onFileSelect) {
      const result = await window.api.git.diff(file.path, file.staged)
      onFileSelect(file.path, result.content || '', file.staged)
    }
  }, [loadDiff, onFileSelect])

  // Handle commit click - show expanded files and diff
  const handleCommitClick = useCallback(async (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null)
      setCommitFiles([])
      setCommitDiff('')
      return
    }
    setLoading(true)
    try {
      const result = await window.api.git.show(hash)
      if (result.error) {
        setError(result.error)
      } else {
        setExpandedCommit(hash)
        setCommitFiles(result.files || [])
        setCommitDiff(result.diff || '')
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }, [expandedCommit])

  // Handle commit file click - show diff in main view
  const handleCommitFileClick = useCallback(async (file: GitCommitFile) => {
    if (!file.diff || !onFileSelect) return
    const filePath = file.path
    setSelectedFile(filePath)
    onFileSelect(filePath, file.diff, false)
  }, [onFileSelect])

  // Stage a file
  const handleStage = useCallback(async (filePath: string) => {
    await window.api.git.add(filePath)
    await refreshStatus()
  }, [refreshStatus])

  // Unstage a file
  const handleUnstage = useCallback(async (filePath: string) => {
    await window.api.git.reset(filePath)
    await refreshStatus()
  }, [refreshStatus])

  // Stage all files
  const handleStageAll = useCallback(async (filePaths: string[]) => {
    for (const fp of filePaths) {
      await window.api.git.add(fp)
    }
    await refreshStatus()
  }, [refreshStatus])

  // Unstage all files
  const handleUnstageAll = useCallback(async (filePaths: string[]) => {
    for (const fp of filePaths) {
      await window.api.git.reset(fp)
    }
    await refreshStatus()
  }, [refreshStatus])

  // Commit
  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return
    await window.api.git.commit({ message: commitMessage })
    setCommitMessage('')
    await refreshStatus()
    await refreshLog()
  }, [commitMessage, refreshStatus, refreshLog])

  // Checkout branch
  const handleCheckout = useCallback(async (branch: string) => {
    await window.api.git.checkout(branch)
    await refreshBranches()
    await refreshStatus()
  }, [refreshBranches, refreshStatus])

  // Stash
  const handleStash = useCallback(async () => {
    await window.api.git.stashPush()
    await refreshStatus()
  }, [refreshStatus])

  // Pop stash
  const handleStashPop = useCallback(async () => {
    await window.api.git.stashPop()
    await refreshStatus()
  }, [refreshStatus])

  // Auto refresh on tab change
  useEffect(() => {
    if (activeTab === 'changes') refreshStatus()
    else if (activeTab === 'log') refreshLog()
    else if (activeTab === 'branches') refreshBranches()
  }, [activeTab, refreshStatus, refreshLog, refreshBranches])

  // Ctrl+F → 切换到搜索面板
  useEffect(() => {
    if (searchFocusTrigger !== undefined && searchFocusTrigger > 0) {
      setActiveSection('search')
    }
  }, [searchFocusTrigger])

  // Initial load — handled by workspacePath effect above

  // Get status icon for file
  const getStatusIcon = (file: GitFileStatus): string => {
    switch (file.status) {
      case 'added': return 'A'
      case 'modified': return 'M'
      case 'deleted': return 'D'
      case 'renamed': return 'R'
      case 'untracked': return 'U'
      case 'conflicted': return 'C'
      default: return '?'
    }
  }

  const getStatusColor = (file: GitFileStatus): string => {
    switch (file.status) {
      case 'added': return 'text-ide-success'
      case 'modified': return 'ide-warning'
      case 'deleted': return 'text-ide-danger'
      case 'untracked': return 'text-ide-text-muted'
      case 'conflicted': return 'text-ide-danger'
      default: return 'text-ide-text-muted'
    }
  }

  const calcFileStats = (files: GitFileStatus[]) => {
    return files.reduce(
      (acc, f) => {
        acc.additions += f.additions || 0
        acc.deletions += f.deletions || 0
        return acc
      },
      { additions: 0, deletions: 0 }
    )
  }

  // 右侧终端打开文件的回调 - 触发中间终端切换到 edit
  const handleRightTerminalOpenFile = useCallback(async (fullPath: string, lineNumber?: number) => {
    if (onOpenFileFromRightTerminal) {
      onOpenFileFromRightTerminal(fullPath, lineNumber)
    }
  }, [onOpenFileFromRightTerminal])

  if (!workspacePath) {
    return (
      <div className="flex flex-col h-full">
        {/* 顶部栏目切换 - 左侧当前选中文字 + 右侧三个图标 */}
        <div className="flex border-b border-ide-border shrink-0 items-center px-3 py-2">
          {/* 左侧：当前选中的文字 */}
          <span className="text-sm text-ide-text font-medium">
            {activeSection === 'git' ? 'Git' : activeSection === 'terminal' ? '终端' : '搜索'}
          </span>

          {/* 右侧：三个图标按钮 */}
          <div className="ml-auto flex gap-1">
            {/* Git 图标 */}
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                activeSection === 'git'
                  ? 'text-ide-accent bg-ide-accent/10'
                  : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
              }`}
              onClick={() => setActiveSection('git')}
              title="Git"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M6 21V9a9 9 0 0 0 9 9" />
                <path d="M18 3v12" />
              </svg>
            </button>
            {/* Terminal 图标 */}
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                activeSection === 'terminal'
                  ? 'text-ide-accent bg-ide-accent/10'
                  : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
              }`}
              onClick={() => setActiveSection('terminal')}
              title="终端"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </button>
            {/* Search 图标 */}
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                activeSection === 'search'
                  ? 'text-ide-accent bg-ide-accent/10'
                  : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
              }`}
              onClick={() => setActiveSection('search')}
              title="搜索"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm">
          No active session
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏目切换 - 左侧当前选中文字 + 右侧三个图标 */}
      <div className="flex border-b border-ide-border shrink-0 items-center px-3 py-2">
        {/* 左侧：当前选中的文字 */}
        <span className="text-sm text-ide-text font-medium">
          {activeSection === 'git' ? 'Git' : activeSection === 'terminal' ? '终端' : '搜索'}
        </span>

        {/* 右侧：三个图标按钮 */}
        <div className="ml-auto flex gap-1">
          {/* Git 图标 */}
          <button
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              activeSection === 'git'
                ? 'text-ide-accent bg-ide-accent/10'
                : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
            }`}
            onClick={() => setActiveSection('git')}
            title="Git"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M6 21V9a9 9 0 0 0 9 9" />
              <path d="M18 3v12" />
            </svg>
          </button>
          {/* Terminal 图标 */}
          <button
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              activeSection === 'terminal'
                ? 'text-ide-accent bg-ide-accent/10'
                : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
            }`}
            onClick={() => setActiveSection('terminal')}
            title="终端"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>
          {/* Search 图标 */}
          <button
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              activeSection === 'search'
                ? 'text-ide-accent bg-ide-accent/10'
                : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
            }`}
            onClick={() => setActiveSection('search')}
            title="搜索"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>
      </div>

      {/* Git 内容 */}
      {activeSection === 'git' && (
        <>
          {/* Branch Info + Refresh Button */}
          {status && (
            <div className="px-3 py-2 border-b border-ide-border shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-accent shrink-0">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 0-9 9" />
                </svg>
                <span className="text-ide-text font-medium">{status.branch}</span>
                {status.ahead > 0 && <span className="text-ide-success text-xs">↑{status.ahead}</span>}
                {status.behind > 0 && <span className="text-ide-warning text-xs">↓{status.behind}</span>}
              </div>
              <button
                onClick={refreshStatus}
                className="text-ide-text-muted hover:text-ide-text text-sm transition-colors"
                title="Refresh"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                </svg>
              </button>
            </div>
          )}

          {/* Git Tabs */}
          <div className="flex border-b border-ide-border shrink-0">
            {(['changes', 'log', 'branches'] as GitTab[]).map(tab => (
              <button
                key={tab}
                className={`px-3 py-2 text-sm transition-colors ${
                  activeTab === tab
                    ? 'text-ide-accent border-b-2 border-ide-accent'
                    : 'text-ide-text-muted hover:text-ide-text'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'changes' ? 'Changes' : tab === 'log' ? 'Log' : 'Branches'}
              </button>
            ))}
          </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 text-sm text-ide-danger bg-ide-danger/10 animate-fade-in">
            {error}
          </div>
        )}

        {activeTab === 'changes' && (
          <div className="flex flex-col">
            {/* Staged Changes */}
            {status && status.files.filter(f => f.staged).length > 0 && (
              <div className="border-b border-ide-border">
                {(() => {
                  const stagedFiles = status.files.filter(f => f.staged)
                  const stats = calcFileStats(stagedFiles)
                  return (
                    <div className="px-3 py-1.5 text-xs text-ide-text-muted uppercase tracking-wider bg-ide-hover/50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>Staged Changes ({stagedFiles.length})</span>
{stats.additions > 0 && <span className="text-ide-success font-mono">+{stats.additions}</span>}
                      {stats.deletions > 0 && <span className="text-ide-danger font-mono">-{stats.deletions}</span>}
                      </div>
                      <button
                        onClick={() => handleUnstageAll(stagedFiles.map(f => f.path))}
                        className="text-xs text-ide-text-muted hover:text-ide-text"
                      >
                        Unstage All
                      </button>
                    </div>
                  )
                })()}
                {status.files.filter(f => f.staged).map(file => (
                  <div
                    key={`staged-${file.path}`}
                    className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-ide-hover flex items-center justify-between group ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text-muted'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs font-bold ${getStatusColor(file)} w-4 text-center shrink-0`}>
                        {getStatusIcon(file)}
                      </span>
                      <span className="truncate">{file.path}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      {(file.additions ?? 0) > 0 && <span className="text-ide-success font-mono">+{file.additions}</span>}
                      {(file.deletions ?? 0) > 0 && <span className="text-ide-danger font-mono">-{file.deletions}</span>}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleUnstage(file.path) }}
                        className="opacity-0 group-hover:opacity-100 text-xs text-ide-text-muted hover:text-ide-text shrink-0"
                      >
                        −
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Unstaged Changes */}
            {status && status.files.filter(f => !f.staged && f.status !== 'untracked').length > 0 && (
              <div className="border-b border-ide-border">
                {(() => {
                  const modifiedFiles = status.files.filter(f => !f.staged && f.status !== 'untracked')
                  const stats = calcFileStats(modifiedFiles)
                  return (
                    <div className="px-3 py-1.5 text-xs text-ide-text-muted uppercase tracking-wider bg-ide-hover/50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>Changes ({modifiedFiles.length})</span>
{stats.additions > 0 && <span className="text-ide-success font-mono">+{stats.additions}</span>}
                      {stats.deletions > 0 && <span className="text-ide-danger font-mono">-{stats.deletions}</span>}
                      </div>
                      <button
                        onClick={() => handleStageAll(modifiedFiles.map(f => f.path))}
                        className="text-xs text-ide-text-muted hover:text-ide-text"
                      >
                        Stage All
                      </button>
                    </div>
                  )
                })()}
                {status.files.filter(f => !f.staged && f.status !== 'untracked').map(file => (
                  <div
                    key={`unstaged-${file.path}`}
                    className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-ide-hover flex items-center justify-between group ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text-muted'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs font-bold ${getStatusColor(file)} w-4 text-center shrink-0`}>
                        {getStatusIcon(file)}
                      </span>
                      <span className="truncate">{file.path}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      {(file.additions ?? 0) > 0 && <span className="text-ide-success font-mono">+{file.additions}</span>}
                      {(file.deletions ?? 0) > 0 && <span className="text-ide-danger font-mono">-{file.deletions}</span>}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                        className="opacity-0 group-hover:opacity-100 text-xs text-ide-text-muted hover:text-ide-text shrink-0"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Untracked Files */}
            {status && status.files.filter(f => f.status === 'untracked').length > 0 && (
              <div className="border-b border-ide-border">
                <div className="px-3 py-1.5 text-xs text-ide-text-muted uppercase tracking-wider bg-ide-hover/50 flex items-center justify-between">
                  <span>Untracked ({status.files.filter(f => f.status === 'untracked').length})</span>
                  <button
                    onClick={() => handleStageAll(status!.files.filter(f => f.status === 'untracked').map(f => f.path))}
                    className="text-xs text-ide-text-muted hover:text-ide-text"
                  >
                    Stage All
                  </button>
                </div>
                {status.files.filter(f => f.status === 'untracked').map(file => (
                  <div
                    key={`untracked-${file.path}`}
                    className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-ide-hover flex items-center justify-between group ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text-muted'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-ide-text-muted w-4 text-center shrink-0">U</span>
                      <span className="truncate">{file.path}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                      className="opacity-0 group-hover:opacity-100 text-xs text-ide-text-muted hover:text-ide-text shrink-0"
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Clean state */}
            {status && status.clean && (
              <div className="px-3 py-4 text-sm text-ide-text-muted text-center">
                No changes detected
              </div>
            )}
          </div>
        )}

        {activeTab === 'log' && (
          <div className="flex flex-col">
            {logs.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ide-text-muted text-center">No commits yet</div>
            ) : (
              logs.map(entry => (
                <div key={entry.hash}>
                  <div
                    className={`px-3 py-2 border-b border-ide-border/50 hover:bg-ide-hover cursor-pointer ${
                      expandedCommit === entry.hash ? 'bg-ide-accent/10' : ''
                    }`}
                    onClick={() => handleCommitClick(entry.hash)}
                  >
                    <div className="text-sm text-ide-text truncate">{entry.message}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-ide-text-muted">
                      <span className="text-ide-accent">{entry.hash.slice(0, 7)}</span>
                      <span>{entry.author}</span>
                      <span>{new Date(entry.date).toLocaleDateString()}</span>
                      {entry.refs && <span className="text-ide-warning">{entry.refs}</span>}
                    </div>
                  </div>
                  {expandedCommit === entry.hash && (
                    <div className="bg-ide-bg border-b border-ide-border animate-fade-in">
                      <div className="px-3 py-1.5 text-xs text-ide-text-muted uppercase tracking-wider bg-ide-hover/50">
                        Changed Files ({commitFiles.length})
                      </div>
                      {commitFiles.map(file => (
                        <div
                          key={file.path}
                          className="px-3 py-1.5 text-sm cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                          onClick={() => handleCommitFileClick(file)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-xs font-bold w-4 text-center shrink-0 ${
                              file.status === 'added' ? 'text-ide-success' :
                              file.status === 'deleted' ? 'text-ide-danger' :
                              file.status === 'renamed' ? 'text-ide-warning' :
                              'text-ide-text-muted'
                            }`}>
                              {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M'}
                            </span>
                            <span className="truncate">{file.path}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs shrink-0">
                            {file.additions > 0 && <span className="text-ide-success font-mono">+{file.additions}</span>}
                            {file.deletions > 0 && <span className="text-ide-danger font-mono">-{file.deletions}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'branches' && (
          <div className="flex flex-col">
            {branches.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ide-text-muted text-center">No branches</div>
            ) : (
              branches.map(branch => (
                <div
                  key={branch.name}
                  className={`px-3 py-2 border-b border-ide-border/50 cursor-pointer flex items-center justify-between ${
                    branch.current ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
                  }`}
                  onClick={() => !branch.current && handleCheckout(branch.name)}
                >
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 0-9 9" />
                    </svg>
                    <span className="text-sm">{branch.name}</span>
                  </div>
                  {branch.current && (
                    <span className="text-xs text-ide-accent">current</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Commit area */}
          {activeTab === 'changes' && (
            <div className="shrink-0 border-t border-ide-border p-3">
              {/* Quick actions */}
              <div className="flex gap-2 mb-2">
                <button
                  onClick={handleStash}
                  className="text-xs text-ide-text-muted hover:text-ide-text px-2 py-1 rounded bg-ide-hover transition-colors"
                >
                  Stash
                </button>
                <button
                  onClick={handleStashPop}
                  className="text-xs text-ide-text-muted hover:text-ide-text px-2 py-1 rounded bg-ide-hover transition-colors"
                >
                  Pop Stash
                </button>
              </div>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message..."
                className="w-full h-24 text-sm bg-ide-bg border border-ide-border rounded px-2 py-1.5 text-ide-text resize-none focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) handleCommit()
                }}
              />
              <button
                onClick={handleCommit}
                disabled={!commitMessage.trim()}
                className="mt-2 w-full py-1.5 text-sm bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Commit (Ctrl+Enter)
              </button>
            </div>
          )}
        </>
      )}

      {/* Terminal 栏目 */}
      {activeSection === 'terminal' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {rightTerminalSession ? (
            <TerminalView
              sessionId={rightTerminalSession.id}
              sessionName="Right Terminal"
              sessionCwd={rightTerminalSession.cwd}
              onOpenFile={handleRightTerminalOpenFile}
              showHeader={false}
            />
          ) : workspacePath ? (
            <div className="flex-1 flex items-center justify-center">
              <button
                onClick={onCreateRightTerminal}
                className="px-4 py-2 text-sm bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
              >
                启动终端
              </button>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm">
              请先选择工作目录
            </div>
          )}
        </div>
      )}

      {/* Search 栏目 */}
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
    </div>
  )
})

export default GitPanel