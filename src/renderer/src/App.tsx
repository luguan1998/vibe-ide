import React, { useState, useCallback } from 'react'
import SessionPanel from './components/SessionPanel'
import TerminalView from './components/TerminalView'
import GitPanel from './components/GitPanel'
import DiffViewer from './components/DiffViewer'
import { TerminalSession, RenameTerminalResult } from '@shared/types'
import { useTheme } from './themes'

// Declare the window API type
declare global {
  interface Window {
    api: {
      terminal: {
        rename(id: string, newName: string): Promise<RenameTerminalResult>
        create: (options?: any) => Promise<TerminalSession>
        write: (id: string, data: string) => void
        resize: (id: string, cols: number, rows: number) => void
        close: (id: string) => Promise<boolean>
        onData: (callback: (data: { id: string; data: string }) => void) => any
        onExit: (callback: (data: { id: string; exitCode: number }) => void) => any
        removeDataListener: (handler?: any) => void
        removeExitListener: (handler?: any) => void
      }
      git: {
        setWorkspace: (path: string) => Promise<any>
        status: () => Promise<any>
        log: (count?: number) => Promise<any>
        diff: (filePath?: string, staged?: boolean) => Promise<any>
        add: (files: string | string[]) => Promise<any>
        reset: (files: string | string[]) => Promise<any>
        commit: (options: any) => Promise<any>
        branches: () => Promise<any>
        checkout: (branch: string) => Promise<any>
        applyBranch: (branch: string) => Promise<any>
        stashList: () => Promise<any>
        stashPush: (message?: string) => Promise<any>
        stashPop: () => Promise<any>
        init: () => Promise<any>
        show: (hash: string) => Promise<any>
      }
      file: any
      workspace: {
        open: () => Promise<any>
        current: () => Promise<{ path: string }>
        pickDir: () => Promise<{ path: string; canceled: boolean }>
      }
      search: {
        grep: (options: {
          query: string
          cwd: string
          regex?: boolean
          caseSensitive?: boolean
          include?: string
        }) => Promise<any>
      }
      theme: {
        setTitleBar: (options: { color: string; symbolColor: string; backgroundColor: string }) => void
      }
    }
  }
}

type CenterView = 'terminal' | 'diff'

interface DiffFileState {
  filePath: string          // 相对路径（用于 git diff）
  fullPath: string          // 完整路径（用于 file read/write）
  diffContent: string
  isStaged: boolean
  lineNumber?: number       // 跳转到指定行
  showSquiggles?: boolean
}

export default function App() {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [rightTerminalSession, setRightTerminalSession] = useState<TerminalSession | null>(null)  // 右侧独立终端
  const [rightPanelWidth, setRightPanelWidth] = useState(380)
  const [leftPanelWidth, setLeftPanelWidth] = useState(240)
  const [isDragging, setIsDragging] = useState(false)
  const [centerView, setCenterView] = useState<CenterView>('terminal')
  const [diffFile, setDiffFile] = useState<DiffFileState | null>(null)
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [showSquiggles, setShowSquiggles] = useState(false)
  const { themes, currentThemeId, setTheme } = useTheme()
  const [gitRefreshKey, setGitRefreshKey] = useState(0)
  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0)
  const [commandHistory, setCommandHistory] = useState<Record<string, string[]>>({})

  // Track terminal commands per session
  const handleCommandEntered = useCallback((sessionId: string, command: string) => {
    setCommandHistory(prev => {
      const existing = prev[sessionId] || []
      const next = [...existing, command]
      if (next.length > 500) return { ...prev, [sessionId]: next.slice(-500) }
      return { ...prev, [sessionId]: next }
    })
  }, [])

  // Ctrl+F → focus search in right panel (only when not in diff/edit mode)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (centerView !== 'diff') {
          e.preventDefault()
          e.stopImmediatePropagation()
          setSearchFocusTrigger(k => k + 1)
        }
      }
    }
    // capture phase: intercept before xterm.js gets it
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [centerView])

  // Get cwd of the currently active session
  const activeSessionCwd = sessions.find(s => s.id === activeSessionId)?.cwd ?? null

  // Create a new terminal session — ask user to pick a directory first
  const handleCreateSession = useCallback(async () => {
    try {
      const dirResult = await window.api.workspace.pickDir()
      if (dirResult.canceled) return
      const session = await window.api.terminal.create({ cwd: dirResult.path })
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
    } catch (err) {
      console.error('Failed to create terminal session:', err)
    }
  }, [])

  // Clone a terminal session (same cwd)
  const handleCloneSession = useCallback(async (cwd: string) => {
    try {
      const session = await window.api.terminal.create({ cwd })
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
    } catch (err) {
      console.error('Failed to clone terminal session:', err)
    }
  }, [])

  // Switch active session
  const handleSwitchSession = useCallback((id: string) => {
    setActiveSessionId(id)
    setCenterView('terminal')
    setDiffFile(null)
  }, [])

  // Close a terminal session
  const handleCloseSession = useCallback(async (id: string) => {
    await window.api.terminal.close(id)
    setSessions(prev => prev.filter(s => s.id !== id))
    // 清理该 session 的命令历史
    setCommandHistory(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
    }
  }, [activeSessionId, sessions])

  // Rename a terminal session
  const handleRenameSession = useCallback(async (id: string, newName: string) => {
    const result = await window.api.terminal.rename(id, newName)
    if (result.success && result.session) {
      setSessions(prev => prev.map(s => s.id === id ? result.session! : s))
    }
  }, [])

  // Handle panel resizing
  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const startX = e.clientX
    const startWidth = rightPanelWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      const newWidth = Math.max(280, Math.min(600, startWidth + delta))
      setRightPanelWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [rightPanelWidth])

  const handleLeftResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const startX = e.clientX
    const startWidth = leftPanelWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const newWidth = Math.max(180, Math.min(400, startWidth + delta))
      setLeftPanelWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [leftPanelWidth])

  const handleFileSelect = useCallback((filePath: string, diffContent: string, isStaged: boolean) => {
    // filePath 是相对路径，需要拼接 workspace 路径得到完整路径
    const fullPath = activeSessionCwd ? `${activeSessionCwd}/${filePath}` : filePath
    setDiffFile({ filePath, fullPath, diffContent, isStaged })
    setCenterView('diff')
  }, [activeSessionCwd])

  const handleBackToTerminal = useCallback(() => {
    setCenterView('terminal')
    setDiffFile(null)
  }, [])

  const handleStage = useCallback(async (filePath: string) => {
    await window.api.git.add(filePath)
  }, [])

  const handleUnstage = useCallback(async (filePath: string) => {
    await window.api.git.reset(filePath)
  }, [])

  const handleRefreshGit = useCallback(async () => {
    setGitRefreshKey(k => k + 1)
  }, [])

  const handleRefreshDiff = useCallback(async (filePath: string, isStaged: boolean): Promise<string> => {
    const result = await window.api.git.diff(filePath, isStaged)
    return result.content || ''
  }, [])

  // 处理从中间终端点击文件路径打开文件
  const handleOpenFileFromTerminal = useCallback(async (fullPath: string, lineNumber?: number) => {
    try {
      // 读取文件内容
      const result = await window.api.file.read(fullPath)
      if (result.error) {
        console.error('Failed to read file:', result.error)
        return
      }

      // 计算 filePath（相对路径）用于 git 操作
      let filePath = fullPath
      if (activeSessionCwd && fullPath.startsWith(activeSessionCwd)) {
        filePath = fullPath.slice(activeSessionCwd.length).replace(/^[\\\/]+/, '')
      }

      // 设置 diffFile 状态，使用空 diffContent（因为是从终端打开，不是 git diff）
      setDiffFile({
        filePath,
        fullPath,
        diffContent: '',  // 直接打开编辑，不是 diff 视图
        isStaged: false,
        lineNumber
      })
      setCenterView('diff')
    } catch (err) {
      console.error('Failed to open file from terminal:', err)
    }
  }, [activeSessionCwd])

  // 处理从右侧终端点击文件路径打开文件 - 直接切换到 edit 模式
  const handleOpenFileFromRightTerminal = useCallback(async (fullPath: string, lineNumber?: number) => {
    try {
      // 读取文件内容
      const result = await window.api.file.read(fullPath)
      if (result.error) {
        console.error('Failed to read file:', result.error)
        return
      }

      // 计算 filePath（相对路径）用于 git 操作，使用右侧终端的 cwd
      const rightCwd = rightTerminalSession?.cwd
      let filePath = fullPath
      if (rightCwd && fullPath.startsWith(rightCwd)) {
        filePath = fullPath.slice(rightCwd.length).replace(/^[\\\/]+/, '')
      }

      // 设置 diffFile 状态，直接打开编辑模式
      setDiffFile({
        filePath,
        fullPath,
        diffContent: '',  // 直接打开编辑，不是 diff 视图
        isStaged: false,
        lineNumber
      })
      setCenterView('diff')
    } catch (err) {
      console.error('Failed to open file from right terminal:', err)
    }
  }, [rightTerminalSession])

  // 创建右侧终端
  const handleCreateRightTerminal = useCallback(async () => {
    if (rightTerminalSession) return  // 已存在则不重复创建
    try {
      // 使用当前活动 session 的 cwd，如果没有则让用户选择
      const cwd = activeSessionCwd
      if (!cwd) return

      const session = await window.api.terminal.create({ cwd })
      setRightTerminalSession(session)
    } catch (err) {
      console.error('Failed to create right terminal:', err)
    }
  }, [rightTerminalSession, activeSessionCwd])

  // 关闭右侧终端
  const handleCloseRightTerminal = useCallback(async () => {
    if (!rightTerminalSession) return
    await window.api.terminal.close(rightTerminalSession.id)
    setRightTerminalSession(null)
  }, [rightTerminalSession])

  // 处理从搜索面板打开文件
  const handleOpenFileFromSearch = useCallback(async (fullPath: string, lineNumber?: number) => {
    try {
      const result = await window.api.file.read(fullPath)
      if (result.error) {
        console.error('Failed to read file:', result.error)
        return
      }

      let filePath = fullPath
      if (activeSessionCwd && fullPath.startsWith(activeSessionCwd)) {
        filePath = fullPath.slice(activeSessionCwd.length).replace(/^[\\\/]+/, '')
      }

      setDiffFile({
        filePath,
        fullPath,
        diffContent: '',
        isStaged: false,
        lineNumber
      })
      setCenterView('diff')
    } catch (err) {
      console.error('Failed to open file from search:', err)
    }
  }, [activeSessionCwd])


  // 当左侧活动 session 的 cwd 变化时，同步更新右侧终端（如果存在）
  React.useEffect(() => {
    if (rightTerminalSession && activeSessionCwd && rightTerminalSession.cwd !== activeSessionCwd) {
      // 关闭旧的右侧终端，创建新的
      window.api.terminal.close(rightTerminalSession.id)
      window.api.terminal.create({ cwd: activeSessionCwd }).then(session => {
        setRightTerminalSession(session)
      })
    }
  }, [activeSessionCwd])

  // Auto-create first session on mount
  React.useEffect(() => {
    if (sessions.length === 0) {
      handleCreateSession()
    }
  }, [])

  return (
    <div className="h-full w-full flex flex-col bg-ide-bg">
      {/* Title Bar */}
      <div className="titlebar-drag h-9 bg-ide-sidebar border-b border-ide-border flex items-center px-4 select-none shrink-0">
        <span className="text-ide-text-muted text-sm font-medium tracking-wide">Vibe IDE</span>
        <button
          className="ml-4 titlebar-no-drag text-ide-text-muted hover:text-ide-text w-6 h-6 rounded hover:bg-ide-hover flex items-center justify-center relative"
          onClick={() => setShowConfigMenu(!showConfigMenu)}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {showConfigMenu && (
            <div className="absolute left-0 top-full mt-1 w-52 bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 max-h-80 overflow-y-auto">
              <div className="px-3 py-1 text-xs text-ide-text-muted uppercase tracking-wider">Theme</div>
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTheme(t.id); setShowConfigMenu(false) }}
                  className={`w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 transition-colors ${
                    currentThemeId === t.id
                      ? 'text-ide-accent bg-ide-accent/10'
                      : 'text-ide-text hover:bg-ide-hover'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-ide-border shrink-0"
                    style={{ backgroundColor: `rgb(${t.css['ide-accent']})` }}
                  />
                  {t.label}
                </button>
              ))}
              <div className="border-t border-ide-border mt-1 pt-1">
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-ide-text hover:bg-ide-hover cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSquiggles}
                    onChange={(e) => setShowSquiggles(e.target.checked)}
                    className="accent-ide-accent"
                  />
                  显示错误提示
                </label>
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Main Content - 3 Panels */}
      <div className="flex flex-1 overflow-hidden" style={{ cursor: isDragging ? 'col-resize' : 'default' }}>
        {/* Left Panel: Terminal Session Management */}
        <div className="shrink-0 flex flex-col bg-ide-sidebar border-r border-ide-border" style={{ width: leftPanelWidth }}>
          <SessionPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            onCreateSession={handleCreateSession}
            onCloneSession={handleCloneSession}
            onSwitchSession={handleSwitchSession}
            onCloseSession={handleCloseSession}
            onRenameSession={handleRenameSession}
            commandHistory={commandHistory}
          />
        </div>

        {/* Left Panel Resize Handle */}
        <div
          className="w-1 bg-ide-border hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
          onMouseDown={handleLeftResizeStart}
        />

        {/* Center Panel: Terminal or Diff */}
        <div className="flex-1 flex flex-col overflow-hidden bg-ide-bg">
          {centerView === 'diff' && diffFile ? (
            <DiffViewer
              filePath={diffFile.filePath}
              fullPath={diffFile.fullPath}
              diffContent={diffFile.diffContent}
              isStaged={diffFile.isStaged}
              showSquiggles={showSquiggles}
              lineNumber={diffFile.lineNumber}
              onStage={handleStage}
              onUnstage={handleUnstage}
              onBack={handleBackToTerminal}
              onSaved={handleRefreshGit}
              onRefreshDiff={handleRefreshDiff}
            />
          ) : sessions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-ide-text-muted">
              No active terminal session. Create one to start.
            </div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                className="flex-1 flex flex-col overflow-hidden"
                style={{ display: session.id === activeSessionId ? 'flex' : 'none' }}
              >
                <TerminalView sessionId={session.id} sessionName={session.name} sessionCwd={session.cwd} onOpenFile={handleOpenFileFromTerminal} onCommand={(cmd) => handleCommandEntered(session.id, cmd)} />
              </div>
            ))
          )}
        </div>

        {/* Right Panel Resize Handle */}
        <div
          className="w-1 bg-ide-border hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
          onMouseDown={handleRightResizeStart}
        />

        {/* Right Panel: Git Management */}
        <div className="shrink-0 flex flex-col bg-ide-sidebar border-l border-ide-border overflow-hidden" style={{ width: rightPanelWidth }}>
          <GitPanel
            workspacePath={activeSessionCwd}
            onFileSelect={handleFileSelect}
            refreshKey={gitRefreshKey}
            onOpenFileFromRightTerminal={handleOpenFileFromRightTerminal}
            onOpenFileFromSearch={handleOpenFileFromSearch}
            rightTerminalSession={rightTerminalSession}
            onCreateRightTerminal={handleCreateRightTerminal}
            onCloseRightTerminal={handleCloseRightTerminal}
            searchFocusTrigger={searchFocusTrigger}
          />
        </div>
      </div>
    </div>
  )
}