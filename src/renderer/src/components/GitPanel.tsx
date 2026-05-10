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
type GitSection = 'git' | 'terminal' | 'search' | 'file'

const GitPanel = React.memo(function GitPanel({ workspacePath, onFileSelect, refreshKey, onOpenFileFromRightTerminal, onOpenFileFromSearch, rightTerminalSession, onCreateRightTerminal, onCloseRightTerminal, searchFocusTrigger }: GitPanelProps) {
  const [activeSection, setActiveSection] = useState<GitSection>('git')
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)
  const [untrackedExpanded, setUntrackedExpanded] = useState(true)
  const [logExpanded, setLogExpanded] = useState(false)
  const [branchesExpanded, setBranchesExpanded] = useState(false)
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [logs, setLogs] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')
  const [diffStaged, setDiffStaged] = useState<boolean>(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [currentGitPath, setCurrentGitPath] = useState<string | null>(null)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  const [commitDiff, setCommitDiff] = useState<string>('')
  const gitChangedHandlerRef = useRef<any>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; branchName: string } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: string; filePath: string; fileName: string } | null>(null)

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
      if (logExpanded) refreshLog()
    })

    return () => {
      window.api.git.removeChangedListener(gitChangedHandlerRef.current)
    }
  }, [logExpanded])
  // Dismiss context menu on outside click
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  // Ctrl+Left/Right → switch right panel tabs
  const tabOrder = ['git', 'terminal', 'search', 'file'] as const
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopImmediatePropagation()
        const idx = tabOrder.indexOf(activeSection)
        const next = e.key === 'ArrowRight'
          ? (idx + 1) % tabOrder.length
          : (idx - 1 + tabOrder.length) % tabOrder.length
        setActiveSection(tabOrder[next])
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [activeSection])

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

  // Discard changes (git checkout -- file)
  const handleDiscard = useCallback(async (filePath: string) => {
    await window.api.git.discard(filePath)
    await refreshStatus()
  }, [refreshStatus])

  // Delete untracked file
  const handleDeleteFile = useCallback(async (filePath: string) => {
    const fullPath = workspacePath ? `${workspacePath.replace(/\\/g, '/')}/${filePath}` : filePath
    await window.api.file.delete(fullPath)
    await refreshStatus()
  }, [refreshStatus, workspacePath])

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

  // Apply worktree branch changes as file modifications (no commits)
  const handleApplyBranch = useCallback(async (branch: string) => {
    try {
      const result = await window.api.git.applyBranch(branch)
      if (result.error) {
        setError(result.error)
      } else {
        if (result.message) {
          setMessage(result.message)
          setTimeout(() => setMessage(null), 3000)
        }
        await refreshBranches()
        await refreshStatus()
      }
    } catch (err: any) {
      setError(err.message)
    }
    setContextMenu(null)
  }, [refreshBranches, refreshStatus])

  // Stash
  const handleStash = useCallback(async () => {
    await window.api.git.stashPush()
    await refreshStatus()
  }, [refreshStatus])

  // Pop stash
  const handlePush = useCallback(async () => {
    await window.api.git.push()
    await refreshStatus()
  }, [refreshStatus])

  const handleStashPop = useCallback(async () => {
    await window.api.git.stashPop()
    await refreshStatus()
  }, [refreshStatus])

  // Init git repo
  const handleInit = useCallback(async () => {
    const result = await window.api.git.init()
    if (result.success) {
      setError(null)
      setCurrentGitPath(workspacePath)
      await refreshStatus()
      await refreshLog()
      await refreshBranches()
    }
  }, [workspacePath, refreshStatus, refreshLog, refreshBranches])

  // Auto refresh on tab change
  // Initial load of all git data on mount
  useEffect(() => {
    refreshStatus()
    refreshLog()
    refreshBranches()
  }, [])

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

  const splitPath = (filePath: string): { name: string; dir: string } => {
    const idx = filePath.lastIndexOf('/')
    if (idx === -1) return { name: filePath, dir: '' }
    return { name: filePath.slice(idx + 1), dir: filePath.slice(0, idx + 1) }
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
        {/* 顶部栏目切换 — tab 风格 */}
        <div className="h-10 flex items-center shrink-0">
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
              activeSection === 'git'
                ? 'text-ide-text border-b-2 border-ide-accent'
                : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b-2 border-transparent'
            }`}
            onClick={() => setActiveSection('git')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M6 21V9a9 9 0 0 0 9 9" />
              <path d="M18 3v12" />
            </svg>
            <span>Git</span>
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
              activeSection === 'terminal'
                ? 'text-ide-text border-b-2 border-ide-accent'
                : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b-2 border-transparent'
            }`}
            onClick={() => setActiveSection('terminal')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            <span>Aux</span>
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
              activeSection === 'search'
                ? 'text-ide-text border-b-2 border-ide-accent'
                : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b-2 border-transparent'
            }`}
            onClick={() => setActiveSection('search')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>Find</span>
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
              activeSection === 'file'
                ? 'text-ide-text border-b-2 border-ide-accent'
                : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b-2 border-transparent'
            }`}
            onClick={() => setActiveSection('file')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            <span>File</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">
          No active session
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏目切换 — tab 风格 */}
      <div className="h-10 flex items-center shrink-0">
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
            activeSection === 'git'
              ? 'text-ide-text border-b-2 border-ide-accent'
              : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b-2 border-transparent'
          }`}
          onClick={() => setActiveSection('git')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M6 21V9a9 9 0 0 0 9 9" />
            <path d="M18 3v12" />
          </svg>
          <span>Git</span>
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
            activeSection === 'terminal'
              ? 'text-ide-text border-b-2 border-ide-accent'
              : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b-2 border-transparent'
          }`}
          onClick={() => setActiveSection('terminal')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span>Aux</span>
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
            activeSection === 'search'
              ? 'text-ide-text border-b-2 border-ide-accent'
              : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b-2 border-transparent'
          }`}
          onClick={() => setActiveSection('search')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Find</span>
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
            activeSection === 'file'
              ? 'text-ide-text border-b-2 border-ide-accent'
              : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover border-b-2 border-transparent'
          }`}
          onClick={() => setActiveSection('file')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
          <span>File</span>
        </button>
      </div>

      {/* Git 内容 */}
      {activeSection === 'git' && (
        <>
          {/* Branch + Git Tabs — 合并一行 */}
          {status && (
            <div className="h-9 pl-2 pr-3 flex items-center border-b border-ide-border shrink-0 gap-2">
              {/* Left: branch info */}
              <div className="flex items-center gap-1 min-w-0 flex-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 0-9 9" />
                </svg>
                <span className="text-xs text-ide-text font-medium truncate">{status.branch}</span>
                {status.ahead > 0 && <span className="text-ide-success text-[11px]">↑{status.ahead}</span>}
                {status.behind > 0 && <span className="text-ide-warning text-[11px]">↓{status.behind}</span>}
              </div>
              <button
                onClick={refreshStatus}
                className="text-ide-text-muted hover:text-ide-text transition-colors shrink-0"
                title="Refresh"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                </svg>
              </button>
            </div>
          )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {message && (
          <div className="px-3 py-2 text-sm text-ide-accent bg-ide-accent/10 animate-fade-in">
            <p>{message}</p>
          </div>
        )}
        {error && (
          <div className="px-3 py-2 text-sm text-ide-danger bg-ide-danger/10 animate-fade-in">
            <p className="mb-2">{error}</p>
            {/not a git/i.test(error) && (
              <button
                onClick={handleInit}
                className="px-3 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
              >
                git init
              </button>
            )}
          </div>
        )}

        {status && (
          <div className="flex flex-col">
            {/* Staged Changes */}
            {status && status.files.filter(f => f.staged).length > 0 && (
              <div className="border-b border-ide-border">
                {(() => {
                  const stagedFiles = status.files.filter(f => f.staged)
                  const stats = calcFileStats(stagedFiles)
                  return (
                    <div
                      className="pl-2 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                      onClick={() => setStagedExpanded(!stagedExpanded)}
                    >
                      <div className="flex items-center gap-1">
                        <span className="w-2 text-center text-ide-text-muted">{stagedExpanded ? '▼' : '▶'}</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-success shrink-0">
                          <polyline points="21 8 21 21 3 21 3 8" />
                          <rect x="1" y="3" width="22" height="5" />
                          <line x1="10" y1="12" x2="14" y2="12" />
                        </svg>
                        <span>Staged ({stagedFiles.length})</span>
{stats.additions > 0 && <span className="text-ide-success font-mono">+{stats.additions}</span>}
                      {stats.deletions > 0 && <span className="text-ide-danger font-mono">-{stats.deletions}</span>}
                      </div>
                      {stagedExpanded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnstageAll(stagedFiles.map(f => f.path)) }}
                          className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                        >
                          Unstage All
                        </button>
                      )}
                    </div>
                  )
                })()}
                {stagedExpanded && status.files.filter(f => f.staged).map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`staged-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <span className={`font-bold ${getStatusColor(file)} w-3.5 text-center shrink-0`}>
                      {getStatusIcon(file)}
                    </span>
                    <span className="shrink-0 text-[11px]">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted text-[10px] min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <span className="shrink-0 w-5" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUnstage(file.path) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center"
                      title="取消暂存"
                    >
                      −
                    </button>
                  </div>
                )})}
              </div>
            )}

            {/* Unstaged Changes */}
            {status && status.files.filter(f => !f.staged && f.status !== 'untracked').length > 0 && (
              <div className="border-b border-ide-border">
                {(() => {
                  const modifiedFiles = status.files.filter(f => !f.staged && f.status !== 'untracked')
                  const stats = calcFileStats(modifiedFiles)
                  return (
                    <div
                      className="pl-2 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                      onClick={() => setChangesExpanded(!changesExpanded)}
                    >
                      <div className="flex items-center gap-1">
                        <span className="w-2 text-center text-ide-text-muted">{changesExpanded ? '▼' : '▶'}</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span>Changes ({modifiedFiles.length})</span>
{stats.additions > 0 && <span className="text-ide-success font-mono">+{stats.additions}</span>}
                      {stats.deletions > 0 && <span className="text-ide-danger font-mono">-{stats.deletions}</span>}
                      </div>
                      {changesExpanded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStageAll(modifiedFiles.map(f => f.path)) }}
                          className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                        >
                          Stage All
                        </button>
                      )}
                    </div>
                  )
                })()}
                {changesExpanded && status.files.filter(f => !f.staged && f.status !== 'untracked').map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`unstaged-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <span className={`font-bold ${getStatusColor(file)} w-3.5 text-center shrink-0`}>
                      {getStatusIcon(file)}
                    </span>
                    <span className="shrink-0 text-[11px]">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted text-[10px] min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center"
                      title="暂存修改"
                    >
                      +
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'discard', filePath: file.path, fileName: name }) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center"
                      title="撤销修改"
                    >
                      −
                    </button>
                  </div>
                )})}
              </div>
            )}

            {/* Untracked Files */}
            {status && status.files.filter(f => f.status === 'untracked').length > 0 && (
              <div className="border-b border-ide-border">
                <div
                  className="pl-2 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                  onClick={() => setUntrackedExpanded(!untrackedExpanded)}
                >
                  <div className="flex items-center gap-1">
                    <span className="w-2 text-center text-ide-text-muted">{untrackedExpanded ? '▼' : '▶'}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-text-muted shrink-0">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                    <span>Untracked ({status.files.filter(f => f.status === 'untracked').length})</span>
                  </div>
                  {untrackedExpanded && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStageAll(status!.files.filter(f => f.status === 'untracked').map(f => f.path)) }}
                      className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                    >
                      Stage All
                    </button>
                  )}
                </div>
                {untrackedExpanded && status.files.filter(f => f.status === 'untracked').map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`untracked-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <span className="font-bold text-ide-text-muted w-3.5 text-center shrink-0">U</span>
                    <span className="shrink-0 text-[11px]">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted text-[10px] min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center"
                      title="暂存修改"
                    >
                      +
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', filePath: file.path, fileName: name }) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center"
                      title="删除文件"
                    >
                      −
                    </button>
                  </div>
                )})}
              </div>
            )}

            {/* Clean state */}
            {status && status.clean && (
              <div className="px-2 py-2 text-xs text-ide-text-muted text-center">
                No changes detected
              </div>
            )}
          </div>
        )}

        <div className="mt-auto">
        {/* Commits / Log */}
        <div className="border-b border-ide-border">
          <div
            className="pl-2 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
            onClick={() => setLogExpanded(!logExpanded)}
          >
            <div className="flex items-center gap-1">
              <span className="w-2 text-center text-ide-text-muted">{logExpanded ? '▼' : '▶'}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Commits ({logs.length})</span>
            </div>
          </div>
          {logExpanded && (
            <div className="flex flex-col">
              {logs.length === 0 ? (
                <div className="px-2 py-2 text-xs text-ide-text-muted text-center">No commits yet</div>
              ) : (
                logs.map(entry => (
                <div key={entry.hash}>
                  <div
                    className={`pl-5 pr-2 py-1.5 border-b border-ide-border/50 hover:bg-ide-hover cursor-pointer ${
                      expandedCommit === entry.hash ? 'bg-ide-accent/10' : ''
                    }`}
                    onClick={() => handleCommitClick(entry.hash)}
                  >
                    <div className="text-xs text-ide-text truncate">{entry.message}</div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-ide-text-muted">
                      <span className="text-ide-accent">{entry.hash.slice(0, 7)}</span>
                      <span>{entry.author}</span>
                      <span>{new Date(entry.date).toLocaleDateString()}</span>
                      {entry.refs && <span className="text-ide-warning">{entry.refs}</span>}
                    </div>
                  </div>
                  {expandedCommit === entry.hash && (
                    <div className="bg-ide-bg border-b border-ide-border animate-fade-in">
                      <div className="pl-5 pr-2 py-1 text-[11px] text-ide-text-muted uppercase tracking-wider bg-ide-hover/50">
                        Files ({commitFiles.length})
                      </div>
                      {commitFiles.map(file => {
                        const { name, dir } = splitPath(file.path)
                        return (
                        <div
                          key={file.path}
                          className="pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1"
                          onClick={() => handleCommitFileClick(file)}
                        >
                          <span className={`text-xs font-bold w-3.5 text-center shrink-0 ${
                            file.status === 'added' ? 'text-ide-success' :
                            file.status === 'deleted' ? 'text-ide-danger' :
                            file.status === 'renamed' ? 'text-ide-warning' :
                            'text-ide-text-muted'
                          }`}>
                            {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M'}
                          </span>
                          <span className="shrink-0 text-[11px]">{name}</span>
                          {dir && <span className="truncate text-ide-text-muted text-[10px] min-w-0">{dir}</span>}
                          <span className="shrink-0 ml-auto flex items-center gap-1 text-[11px]">
                            {file.additions > 0 && <span className="text-ide-success font-mono">+{file.additions}</span>}
                            {file.deletions > 0 && <span className="text-ide-danger font-mono">-{file.deletions}</span>}
                          </span>
                        </div>
                      )})}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          )}
        </div>

        {/* Branches */}
        <div className="border-b border-ide-border">
          <div
            className="pl-2 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
            onClick={() => setBranchesExpanded(!branchesExpanded)}
          >
            <div className="flex items-center gap-1">
              <span className="w-2 text-center text-ide-text-muted">{branchesExpanded ? '▼' : '▶'}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                <circle cx="12" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="6" r="3" />
                <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 0-2 2v2" />
              </svg>
              <span>Branches ({branches.length})</span>
            </div>
          </div>
          {branchesExpanded && (
          <div className="flex flex-col">
            {branches.length === 0 ? (
              <div className="px-2 py-2 text-xs text-ide-text-muted text-center">No branches</div>
            ) : (
              branches.map(branch => (
                <div
                  key={branch.name}
                  className={`pl-5 pr-2 py-1.5 text-xs border-b border-ide-border/50 cursor-pointer flex items-center justify-between ${
                    branch.current ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text hover:bg-ide-hover'
                  }`}
                  onClick={() => !branch.current && handleCheckout(branch.name)}
                  onContextMenu={(e) => {
                    if (branch.name.startsWith('worktree-')) {
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, branchName: branch.name })
                    }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 0-9 9" />
                    </svg>
                    <span className="text-xs">{branch.name}</span>
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
      </div>
      </div>

      {/* Commit area */}
          {status && (
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
              {status.clean && status.ahead > 0 ? (
                <button
                  onClick={handlePush}
                  className="w-full py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                  Push{status.ahead > 0 ? ` (${status.ahead})` : ''}
                </button>
              ) : (
                <>
                  <textarea
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message..."
                    className="w-full h-20 text-xs bg-ide-bg border border-ide-border rounded px-2 py-1 text-ide-text resize-none focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.ctrlKey) handleCommit()
                    }}
                  />
                  <button
                    onClick={handleCommit}
                    disabled={!commitMessage.trim()}
                    className="mt-2 w-full py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Commit (Ctrl+Enter)
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Aux 栏目 */}
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
                className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
              >
                启动终端
              </button>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">
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

      {/* File 栏目 — 预留 */}
      {activeSection === 'file' && (
        <div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">
          File
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmAction(null)}>
          <div className="bg-ide-bg border border-ide-border rounded shadow-lg p-4 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ide-text mb-4">
              {confirmAction.type === 'discard'
                ? `确定撤销对 ${confirmAction.fileName} 的修改？此操作不可恢复。`
                : `确定删除 ${confirmAction.fileName}？此操作不可恢复。`
              }
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded"
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-ide-danger hover:bg-red-600 text-white rounded"
                onClick={async () => {
                  const { type, filePath } = confirmAction
                  setConfirmAction(null)
                  if (type === 'discard') {
                    await handleDiscard(filePath)
                  } else {
                    await handleDeleteFile(filePath)
                  }
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu for worktree branches */}
      {contextMenu && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => handleApplyBranch(contextMenu.branchName)}
          >
            合并修改
          </button>
        </div>
      )}
    </div>
  )
})

export default GitPanel