import React, { useState, useEffect, useCallback, useRef } from 'react'
import { GitStatusResult, GitFileStatus, GitLogEntry, GitBranch, GitCommitFile, TerminalSession } from '@shared/types'

interface GitTabProps {
  workspacePath: string | null
  effectiveGitPath: string | null
  worktreeNav: { originalPath: string; worktreePath: string; originalBranch: string } | null
  onFileSelect?: (filePath: string, diffContent: string, isStaged: boolean, commitHash?: string, fullPath?: string) => void
  refreshKey?: number
  activeSessionId?: string | null
  rightTerminalSession?: TerminalSession | null
  onCloseRightTerminal?: (sessionId: string) => void
  onWorktreeNavChange: (updater: (prev: Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>) => Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>) => void
}

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

export default function GitTab({ workspacePath, effectiveGitPath, worktreeNav, onFileSelect, refreshKey, activeSessionId, rightTerminalSession, onCloseRightTerminal, onWorktreeNavChange }: GitTabProps) {
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)
  const [untrackedExpanded, setUntrackedExpanded] = useState(true)
  const [logExpanded, setLogExpanded] = useState(false)
  const [branchesExpanded, setBranchesExpanded] = useState(false)
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status
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
  const [commitContextMenu, setCommitContextMenu] = useState<{ x: number; y: number; hash: string; message: string } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: string; filePath: string; fileName: string } | null>(null)
  const [conflictApply, setConflictApply] = useState<{ branch: string; message: string } | null>(null)
  const [remoteBranches, setRemoteBranches] = useState<{ name: string; remote: string; branch: string }[]>([])
  const [selectedRemote, setSelectedRemote] = useState<string>('')
  const [showPushDropdown, setShowPushDropdown] = useState(false)
  const [stashCount, setStashCount] = useState(0)

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

  const refreshStashCount = useCallback(async () => {
    const list = await window.api.git.stashList()
    if (Array.isArray(list)) {
      setStashCount(list.length)
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
      const resolvedFullPath = effectiveGitPath
        ? `${effectiveGitPath.replace(/\\/g, '/')}/${file.path}`
        : ''
      onFileSelect(file.path, result.content || '', file.staged, undefined, resolvedFullPath)
    }
  }, [loadDiff, onFileSelect, effectiveGitPath])

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
    onFileSelect(filePath, file.diff, false, expandedCommit!)
  }, [onFileSelect, expandedCommit])

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
    const fullPath = effectiveGitPath ? `${effectiveGitPath.replace(/\\/g, '/')}/${filePath}` : filePath
    await window.api.file.delete(fullPath)
    await refreshStatus()
  }, [refreshStatus, effectiveGitPath])

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

  // Navigate to worktree
  const handleNavigateToWorktree = useCallback(async (branch: string) => {
    try {
      const result = await window.api.git.getWorktreePath(branch)
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.path) {
        if (rightTerminalSession && activeSessionId) {
          onCloseRightTerminal?.(activeSessionId)
        }
        onWorktreeNavChange(prev => {
          const existing = prev[activeSessionId!]
          return {
            ...prev,
            [activeSessionId!]: {
              originalPath: existing?.originalPath || workspacePath!,
              worktreePath: result.path,
              originalBranch: existing?.originalBranch || statusRef.current?.branch || ''
            }
          }
        })
      }
    } catch (err: any) {
      setError(err.message)
    }
  }, [workspacePath, rightTerminalSession, activeSessionId, onCloseRightTerminal, onWorktreeNavChange])

  // Return from worktree navigation
  const handleBackFromWorktree = useCallback(() => {
    if (rightTerminalSession && activeSessionId) {
      onCloseRightTerminal?.(activeSessionId)
    }
    onWorktreeNavChange(prev => {
      const next = { ...prev }
      delete next[activeSessionId!]
      return next
    })
  }, [rightTerminalSession, activeSessionId, onCloseRightTerminal, onWorktreeNavChange])

  // Apply worktree branch changes
  const handleApplyBranch = useCallback(async (branch: string) => {
    setContextMenu(null)
    try {
      const result = await window.api.git.applyBranch(branch)
      if (result.conflict) {
        setConflictApply({ branch, message: result.message })
        return
      }
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
  }, [refreshBranches, refreshStatus])

  // Stash
  const handleStash = useCallback(async () => {
    await window.api.git.stashPush()
    await refreshStatus()
    await refreshStashCount()
  }, [refreshStatus, refreshStashCount])

  // Pop stash
  const handleStashPop = useCallback(async () => {
    await window.api.git.stashPop()
    await refreshStatus()
    await refreshStashCount()
  }, [refreshStatus, refreshStashCount])

  // Push
  const handlePush = useCallback(async () => {
    if (selectedRemote) {
      const parts = selectedRemote.split('/')
      const remote = parts[0]
      const branch = parts.slice(1).join('/')
      await window.api.git.push(remote, branch)
    } else {
      await window.api.git.push()
    }
    await refreshStatus()
    await refreshLog()
    await refreshBranches()
    setShowPushDropdown(false)
  }, [refreshStatus, refreshLog, refreshBranches, selectedRemote])

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

  // Switch git workspace when effective path changes
  useEffect(() => {
    if (!effectiveGitPath || effectiveGitPath === currentGitPath) return
    const switchWorkspace = async () => {
      const result = await window.api.git.setWorkspace(effectiveGitPath)
      if (result.success) {
        setCurrentGitPath(effectiveGitPath)
        refreshStatus()
        refreshLog()
        refreshBranches()
        refreshStashCount()
      }
    }
    switchWorkspace()
  }, [effectiveGitPath])

  // Handle refreshKey changes (triggered by Ctrl+S in DiffViewer)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refreshStatus()
    }
  }, [refreshKey])

  // Listen for git:changed events from file watcher
  useEffect(() => {
    gitChangedHandlerRef.current = window.api.git.onChanged(() => {
      refreshStatus()
      if (logExpanded) refreshLog()
    })

    return () => {
      window.api.git.removeChangedListener(gitChangedHandlerRef.current)
    }
  }, [logExpanded])

  // Dismiss context menus on outside click
  useEffect(() => {
    const handleClick = () => { setContextMenu(null); setCommitContextMenu(null) }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  // Load remote branches
  useEffect(() => {
    if (status && workspacePath) {
      window.api.git.remoteBranches().then(result => {
        if (!result.error) {
          setRemoteBranches(result)
        }
      })
    }
  }, [status, workspacePath])

  // Dismiss push dropdown on outside click
  useEffect(() => {
    if (!showPushDropdown) return
    const handleClick = () => setShowPushDropdown(false)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [showPushDropdown])

  // Detect conflict markers in staged files
  const hasConflictInStaged = status?.files?.some(f => f.staged && f.status === 'conflicted') ?? false

  return (
    <>
      {/* Branch info bar */}
      {status && (
        <div className="h-9 pl-5 pr-3 flex items-center border-b border-ide-border shrink-0 gap-2">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 0-9 9" />
            </svg>
            <span className="text-sm text-ide-text font-medium truncate">{status.branch}</span>
            {status.ahead > 0 && <span className="text-ide-success text-[11px]">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="text-ide-warning text-[11px]">↓{status.behind}</span>}
          </div>
          <button
            onClick={() => { refreshStatus(); refreshLog(); refreshBranches() }}
            className="text-ide-text-muted hover:text-ide-text transition-colors shrink-0 w-5 flex items-center justify-center"
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
                      className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                      onClick={() => setStagedExpanded(!stagedExpanded)}
                    >
                      <div className="flex items-center gap-1">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${stagedExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
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
                          className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors inline-flex items-center gap-1"
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fill-rule="evenodd" d="M9.75 3.5A2.75 2.75 0 0 0 7 6.25v5.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V6.25a4.25 4.25 0 0 1 8.5 0v1a.75.75 0 0 1-1.5 0v-1A2.75 2.75 0 0 0 9.75 3.5Z" clip-rule="evenodd" /></svg>
                          全部取消
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
                      className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                      onClick={() => setChangesExpanded(!changesExpanded)}
                    >
                      <div className="flex items-center gap-1">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${changesExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
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
                          className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors inline-flex items-center gap-1"
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fill-rule="evenodd" d="M6.25 12.5A2.75 2.75 0 0 0 9 9.75V4.56L6.78 6.78a.75.75 0 0 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06L10.5 4.56v5.19a4.25 4.25 0 0 1-8.5 0v-1a.75.75 0 0 1 1.5 0v1a2.75 2.75 0 0 0 2.75 2.75Z" clip-rule="evenodd" /></svg>
                          全部暂存
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
                  className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                  onClick={() => setUntrackedExpanded(!untrackedExpanded)}
                >
                  <div className="flex items-center gap-1">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${untrackedExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
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
                      className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors inline-flex items-center gap-1"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fill-rule="evenodd" d="M6.25 12.5A2.75 2.75 0 0 0 9 9.75V4.56L6.78 6.78a.75.75 0 0 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06L10.5 4.56v5.19a4.25 4.25 0 0 1-8.5 0v-1a.75.75 0 0 1 1.5 0v1a2.75 2.75 0 0 0 2.75 2.75Z" clip-rule="evenodd" /></svg>
                      全部暂存
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
              className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
              onClick={() => setLogExpanded(!logExpanded)}
            >
              <div className="flex items-center gap-1">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${logExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
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
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCommitContextMenu({ x: e.clientX, y: e.clientY, hash: entry.hash, message: entry.message })
                      }}
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
              className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
              onClick={() => setBranchesExpanded(!branchesExpanded)}
            >
              <div className="flex items-center gap-1">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${branchesExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
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
                branches.map(branch => {
                  const isOriginalBranch = worktreeNav && branch.name === worktreeNav.originalBranch
                  return (
                  <div
                    key={branch.name}
                    className={`pl-5 pr-2 py-1.5 text-xs border-b border-ide-border/50 cursor-pointer flex items-center justify-between ${
                      isOriginalBranch ? 'bg-ide-success/10 text-ide-text' : branch.current ? 'bg-ide-accent/10 text-ide-text' : branch.remote ? 'text-ide-text-muted cursor-not-allowed' : 'text-ide-text hover:bg-ide-hover'
                    }`}
                    onClick={() => {
                      if (isOriginalBranch) { handleBackFromWorktree(); return }
                      if (branch.current || branch.remote) return
                      if (branch.name.startsWith('worktree-')) {
                        handleNavigateToWorktree(branch.name)
                      } else {
                        handleCheckout(branch.name)
                      }
                    }}
                    onContextMenu={(e) => {
                      if (branch.name.startsWith('worktree-')) {
                        e.preventDefault()
                        setContextMenu({ x: e.clientX, y: e.clientY, branchName: branch.name })
                      }
                    }}
                  >
                    <div className="flex items-center gap-1">
                      {isOriginalBranch ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0 text-ide-success">
                          <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                          <line x1="6" y1="3" x2="6" y2="15" />
                          <circle cx="18" cy="6" r="3" />
                          <circle cx="6" cy="18" r="3" />
                          <path d="M18 9a9 9 0 0 0-9 9" />
                        </svg>
                      )}
                      <span className="text-xs">{branch.name}</span>
                    </div>
                    {isOriginalBranch ? (
                      <span className="text-xs text-ide-success">main</span>
                    ) : branch.current && (
                      <span className="text-xs text-ide-accent">current</span>
                    )}
                  </div>
                )})
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
              Pop Stash{stashCount > 0 ? ` (${stashCount})` : ''}
            </button>
          </div>
          {status.clean && status.ahead > 0 ? (
            <div className="relative">
              <div className="flex">
                <button
                  onClick={handlePush}
                  className="flex-1 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-l transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                  Push{status.ahead > 0 ? ` (${status.ahead})` : ''}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowPushDropdown(!showPushDropdown) }}
                  className="py-1.5 px-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-r border-l border-white/20 transition-colors"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
              </div>
              {showPushDropdown && (
                <div
                  className="absolute bottom-full left-0 right-0 mb-1 bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 max-h-40 overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handlePush}
                    className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${!selectedRemote ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text hover:bg-ide-hover'}`}
                  >
                    origin (default)
                  </button>
                  {remoteBranches.map(rb => (
                    <button
                      key={rb.name}
                      onClick={() => { setSelectedRemote(rb.name); handlePush() }}
                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${selectedRemote === rb.name ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text hover:bg-ide-hover'}`}
                    >
                      <span className="text-ide-text-muted">{rb.remote}/</span>{rb.branch}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
              {hasConflictInStaged && (
                <div className="mt-2 px-2 py-1.5 text-[11px] text-ide-danger bg-ide-danger/10 rounded animate-fade-in flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  暂存区存在冲突文件，请先解决冲突后再提交
                </div>
              )}
              <button
                onClick={handleCommit}
                disabled={!commitMessage.trim() || !status?.files?.some(f => f.staged) || hasConflictInStaged}
                className="mt-2 w-full py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Commit (Ctrl+Enter)
              </button>
            </>
          )}
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

      {/* Context Menu for commit entries */}
      {commitContextMenu && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
          style={{ left: commitContextMenu.x, top: commitContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => {
              const msg = commitContextMenu.message.replace(/\n/g, '\r\n')
              navigator.clipboard.writeText(msg)
              setCommitContextMenu(null)
            }}
          >
            Copy Message
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => {
              navigator.clipboard.writeText(commitContextMenu.hash)
              setCommitContextMenu(null)
            }}
          >
            Copy Hash
          </button>
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

      {/* Conflict Dialog */}
      {conflictApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConflictApply(null)}>
          <div className="bg-ide-bg border border-ide-border rounded shadow-lg p-4 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ide-text mb-2">
              合并 {conflictApply.branch} 时检测到冲突
            </p>
            <p className="text-[11px] text-ide-text-muted mb-4 max-h-24 overflow-y-auto">
              {conflictApply.message.slice(0, 300)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded"
                onClick={() => setConflictApply(null)}
              >
                放弃
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded"
                onClick={async () => {
                  const branch = conflictApply.branch
                  setConflictApply(null)
                  await window.api.git.applyBranchRetry(branch)
                  await refreshBranches()
                  await refreshStatus()
                }}
              >
                保留冲突
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
