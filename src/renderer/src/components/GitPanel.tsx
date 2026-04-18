import React, { useState, useEffect, useCallback } from 'react'
import { GitStatusResult, GitFileStatus, GitLogEntry, GitBranch } from '@shared/types'
import DiffViewer from './DiffViewer'

interface GitPanelProps {
  workspacePath: string | null
}

type GitTab = 'changes' | 'log' | 'branches'

export default function GitPanel({ workspacePath }: GitPanelProps) {
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
  }, [loadDiff])

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

  if (!workspacePath) {
    return (
      <div className="flex flex-col h-full">
        <div className="h-10 px-3 flex items-center border-b border-ide-border shrink-0">
          <h2 className="text-sm font-semibold text-ide-text uppercase tracking-wider">Git</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm">
          No active session
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-10 px-3 flex items-center border-b border-ide-border shrink-0">
        <h2 className="text-sm font-semibold text-ide-text uppercase tracking-wider">Git</h2>
        <button
          onClick={refreshStatus}
          className="ml-auto text-ide-text-muted hover:text-ide-text text-sm transition-colors"
          title="Refresh"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </button>
      </div>

      {/* Branch Info */}
      {status && (
        <div className="px-3 py-2 border-b border-ide-border shrink-0">
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
        </div>
      )}

      {/* Tabs */}
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
                <div className="px-3 py-1.5 text-xs text-ide-text-muted uppercase tracking-wider bg-ide-hover/50 flex items-center justify-between">
                  <span>Staged Changes ({status.files.filter(f => f.staged).length})</span>
                  <button
                    onClick={() => handleUnstage(status!.files.filter(f => f.staged).map(f => f.path))}
                    className="text-xs text-ide-text-muted hover:text-ide-text"
                  >
                    Unstage All
                  </button>
                </div>
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
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUnstage(file.path) }}
                      className="opacity-0 group-hover:opacity-100 text-xs text-ide-text-muted hover:text-ide-text shrink-0"
                    >
                      −
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Unstaged Changes */}
            {status && status.files.filter(f => !f.staged && f.status !== 'untracked').length > 0 && (
              <div className="border-b border-ide-border">
                <div className="px-3 py-1.5 text-xs text-ide-text-muted uppercase tracking-wider bg-ide-hover/50 flex items-center justify-between">
                  <span>Changes ({status.files.filter(f => !f.staged && f.status !== 'untracked').length})</span>
                </div>
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

            {/* Untracked Files */}
            {status && status.files.filter(f => f.status === 'untracked').length > 0 && (
              <div className="border-b border-ide-border">
                <div className="px-3 py-1.5 text-xs text-ide-text-muted uppercase tracking-wider bg-ide-hover/50">
                  Untracked ({status.files.filter(f => f.status === 'untracked').length})
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

            {/* Diff Viewer */}
            {selectedFile && diffContent && (
              <DiffViewer
                filePath={selectedFile}
                diffContent={diffContent}
                isStaged={diffStaged}
                onStage={handleStage}
                onUnstage={handleUnstage}
              />
            )}
          </div>
        )}

        {activeTab === 'log' && (
          <div className="flex flex-col">
            {logs.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ide-text-muted text-center">No commits yet</div>
            ) : (
              logs.map(entry => (
                <div key={entry.hash} className="px-3 py-2 border-b border-ide-border/50 hover:bg-ide-hover cursor-pointer">
                  <div className="text-sm text-ide-text truncate">{entry.message}</div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-ide-text-muted">
                    <span className="text-ide-accent">{entry.hash.slice(0, 7)}</span>
                    <span>{entry.author}</span>
                    <span>{new Date(entry.date).toLocaleDateString()}</span>
                    {entry.refs && <span className="text-ide-warning">{entry.refs}</span>}
                  </div>
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
    </div>
  )
}