
import React, { useState, useCallback, lazy, Suspense, useRef, useEffect } from 'react'
import SessionPanel from './components/SessionPanel'
import RightPanel from './components/RightPanel'
import DiffViewer from './components/DiffViewer'
import { TerminalSession, RenameTerminalResult } from '@shared/types'
import { getShortcuts, eventMatchesBinding } from './shortcuts'
import { useI18n } from './i18n'
import type { TerminalViewHandle } from './components/TerminalView'

const TerminalView = lazy(() => import('./components/TerminalView'))

// Declare the window API type
declare global {
  interface Window {
    api: {
      terminal: {
        rename(id: string, newName: string): Promise<RenameTerminalResult>
        create: (options?: { cwd?: string; name?: string; shell?: string }) => Promise<TerminalSession>
        getShells: () => Promise<{ value: string; label: string }[]>
        setAutoApprove: (id: string, cwd: string, enabled: boolean) => Promise<{ success: boolean }>
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
        discard: (filePath: string) => Promise<any>
        stashList: () => Promise<any>
        stashPush: (message?: string) => Promise<any>
        stashPop: () => Promise<any>
        push: (remote?: string, branch?: string) => Promise<any>
        remoteBranches: () => Promise<any>
        init: () => Promise<any>
        show: (hash: string) => Promise<any>
        showFile: (ref: string, filePath: string) => Promise<any>
        getWorktreePath: (branch: string) => Promise<any>
        applyBranchRetry: (branch: string) => Promise<any>
        deleteWorktree: (branch: string) => Promise<any>
        setFilterRules: (rules: string[]) => Promise<any>
        onChanged: (callback: () => void) => any
        removeChangedListener: (handler?: any) => void
      }
      file: {
        read: (filePath: string) => Promise<any>
        write: (filePath: string, content: string) => Promise<any>
        readWithEncoding: (filePath: string, encoding?: string) => Promise<{ content: string; encoding: string; bom: boolean; confidence: number; error?: string }>
        writeWithEncoding: (filePath: string, content: string, encoding?: string) => Promise<{ success: boolean; error?: string }>
        list: (dirPath: string) => Promise<any>
        tree: (dirPath: string, depth?: number, skipPatterns?: string[]) => Promise<any>
        delete: (filePath: string) => Promise<any>
        rename: (oldPath: string, newPath: string) => Promise<any>
        createDir: (dirPath: string) => Promise<any>
        openExplorer: (filePath: string) => Promise<any>
        find: (cwd: string, filename: string, skipPatterns?: string[]) => Promise<any>
      }
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
      appVersion: () => Promise<string>
      onFontAdjust: (callback: (delta: number) => void) => any
      removeFontAdjustListener: (handler?: any) => void
      onFocusSettings: (callback: () => void) => any
      removeFocusSettingsListener: (handler?: any) => void
      onStartupOpenPath: (callback: (data: { type: 'directory' | 'file'; path: string }) => void) => any
      removeStartupOpenPathListener: (handler?: any) => void
    }
  }
}

type CenterView = 'terminal' | 'diff'

interface DiffFileState {
  defaultEdit?: boolean
  filePath: string          // 相对路径（用于 git diff）
  fullPath: string          // 完整路径（用于 file read/write）
  diffContent: string
  isStaged: boolean
  commitHash?: string       // 查看历史 commit 时的 commit hash
  lineNumber?: number       // 跳转到指定行
  showSquiggles?: boolean
  revision: number          // 递增以强制 DiffViewer 重新加载内容
}

export default function App() {
  const { t } = useI18n()
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [rightTerminalSessions, setRightTerminalSessions] = useState<Record<string, TerminalSession>>({})  // 每个 session 独立的右侧终端
  const [rightPanelWidth, setRightPanelWidth] = useState(380)
  const rightPanelPrevWidth = useRef(380)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)

  const handleToggleRightPanel = useCallback(() => {
    const delta = rightPanelWidth + 1 // panel + resize handle
    if (rightPanelCollapsed) {
      window.resizeBy(delta, 0)
      setRightPanelCollapsed(false)
    } else {
      rightPanelPrevWidth.current = rightPanelWidth
      setRightPanelCollapsed(true)
      window.resizeBy(-delta, 0)
    }
  }, [rightPanelCollapsed, rightPanelWidth])
  const [leftPanelWidth, setLeftPanelWidth] = useState(240)
  const [isDragging, setIsDragging] = useState(false)
  const [centerView, setCenterView] = useState<CenterView>('terminal')
  const [diffFile, setDiffFile] = useState<DiffFileState | null>(null)
  const diffRevisionRef = useRef(0)
  const [showSquiggles, setShowSquiggles] = useState(false)
  const [pollingEnabled, setPollingEnabled] = useState(() => {
    try { return localStorage.getItem('vibe-ide-polling') === '1' } catch { return false }
  })
  const [pollingTick, setPollingTick] = useState(0)
  const [gitRefreshKey, setGitRefreshKey] = useState(0)

  // Polling timer: auto-refresh git + file every 6s
  useEffect(() => {
    if (!pollingEnabled) return
    const id = setInterval(() => {
      setGitRefreshKey(k => k + 1)
      setPollingTick(k => k + 1)
    }, 6000)
    return () => clearInterval(id)
  }, [pollingEnabled])

  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0)
  const [navigateToFilePayload, setNavigateToFilePayload] = useState<{ trigger: number; filePath: string } | null>(null)

  const [focusSettingsTrigger, setFocusSettingsTrigger] = useState(0)
  const [diffScrollTrigger, setDiffScrollTrigger] = useState(0)
  const [commandHistory, setCommandHistory] = useState<Record<string, string[]>>({})
  const [showHistory, setShowHistory] = useState(false)
  const [historySelectedIndex, setHistorySelectedIndex] = useState(0)
  const showHistoryRef = useRef(false)
  const historySelectedIndexRef = useRef(0)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const manuallyRenamedRef = useRef<Set<string>>(new Set())
  const commandHistoryRef = useRef(commandHistory)
  const historyListRef = useRef<HTMLDivElement>(null)
  const [agentStatus, setAgentStatus] = useState<Record<string, 'running' | 'idle'>>({})
  const [autoApproveSessions, setAutoApproveSessions] = useState<Record<string, boolean>>({})
  const [focusedPanel, setFocusedPanel] = useState<'term' | 'right' | null>(null)
  const [wordWrap, setWordWrap] = useState(() => {
    try { return localStorage.getItem('vibe-ide-word-wrap') === 'true' } catch { return false }
  })
  const [autoUtf8, setAutoUtf8] = useState(() => {
    try { return localStorage.getItem('vibe-ide-auto-utf8') !== 'false' } catch { return true }
  })
  const [inlineDiff, setInlineDiff] = useState(() => {
    try { return localStorage.getItem('vibe-ide-inline-diff') === 'true' } catch { return false }
  })

  const [fileTreeDepth, setFileTreeDepth] = useState(() => {
    try {
      const v = localStorage.getItem('vibe-ide-file-tree-depth')
      return v ? Math.max(1, Math.min(8, Number(v))) : 5
    } catch { return 3 }
  })

  const handleFileTreeDepthChange = useCallback((delta: number) => {
    setFileTreeDepth(prev => {
      const next = Math.max(1, Math.min(8, prev + delta))
      try { localStorage.setItem('vibe-ide-file-tree-depth', String(next)) } catch {}
      return next
    })
  }, [])

  const [terminalFontSize, setTerminalFontSize] = useState(() => {
    try {
      const v = localStorage.getItem('vibe-ide-terminal-font-size')
      return v ? Math.max(8, Math.min(30, Number(v))) : 14
    } catch { return 14 }
  })
  const [editorFontSize, setEditorFontSize] = useState(() => {
    try {
      const v = localStorage.getItem('vibe-ide-editor-font-size')
      return v ? Math.max(8, Math.min(30, Number(v))) : 14
    } catch { return 14 }
  })
  const centerViewRef = React.useRef<CenterView>('terminal')

  // Keep ref in sync so IPC listener always sees latest centerView
  React.useEffect(() => {
    centerViewRef.current = centerView
  }, [centerView])

  // Terminal refs for focus management (keyed by sessionId)
  const terminalRefs = useRef<Record<string, TerminalViewHandle>>({})
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const flashPanelRef = useRef<'term' | 'right' | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Flash focus indicator on panel switch, auto-hide after 1.5s
  const triggerFlash = useCallback((panel: 'term' | 'right') => {
    if (flashPanelRef.current === panel) return
    flashPanelRef.current = panel
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setFocusedPanel(panel)
    flashTimerRef.current = setTimeout(() => {
      setFocusedPanel(null)
      flashTimerRef.current = null
    }, 600)
  }, [])

  const handleCenterFocus = useCallback(() => {
    if (pendingBlurRef.current) {
      clearTimeout(pendingBlurRef.current)
      pendingBlurRef.current = null
    }
    triggerFlash('term')
  }, [triggerFlash])

  const handleCenterBlur = useCallback(() => {
    pendingBlurRef.current = setTimeout(() => {
      flashPanelRef.current = null
      pendingBlurRef.current = null
    }, 0)
  }, [])

  const handleRightFocus = useCallback(() => {
    if (pendingBlurRef.current) {
      clearTimeout(pendingBlurRef.current)
      pendingBlurRef.current = null
    }
    triggerFlash('right')
  }, [triggerFlash])

  const handleRightBlur = useCallback(() => {
    pendingBlurRef.current = setTimeout(() => {
      flashPanelRef.current = null
      pendingBlurRef.current = null
    }, 0)
  }, [])

  // Focus terminal when switching sessions or returning from diff
  useEffect(() => {
    if (centerView === 'terminal' && activeSessionId) {
      // Delay to let the new TerminalView mount/show
      const timer = setTimeout(() => {
        terminalRefs.current[activeSessionId]?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [centerView, activeSessionId])

  // Persist font sizes to localStorage
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-terminal-font-size', String(terminalFontSize)) } catch {}
  }, [terminalFontSize])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-editor-font-size', String(editorFontSize)) } catch {}
  }, [editorFontSize])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-word-wrap', String(wordWrap)) } catch {}
  }, [wordWrap])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-auto-utf8', String(autoUtf8)) } catch {}
  }, [autoUtf8])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-inline-diff', String(inlineDiff)) } catch {}
  }, [inlineDiff])

  // Keep refs in sync for use in capture-phase keyboard handlers
  React.useEffect(() => { showHistoryRef.current = showHistory }, [showHistory])
  React.useEffect(() => { historySelectedIndexRef.current = historySelectedIndex }, [historySelectedIndex])
  React.useEffect(() => { commandHistoryRef.current = commandHistory }, [commandHistory])

  // Auto-scroll selected history item into view
  React.useEffect(() => {
    if (showHistory && historyListRef.current) {
      const selected = historyListRef.current.querySelector('[data-history-index]')
      if (selected) selected.scrollIntoView({ block: 'nearest' })
    }
  }, [showHistory, historySelectedIndex])

  // Listen for font-adjust IPC from main process (for Ctrl+-/= keys eaten by Chromium)
  React.useEffect(() => {
    const handler = window.api.onFontAdjust((delta: number) => {
      if (centerViewRef.current === 'terminal') {
        setTerminalFontSize(prev => Math.max(8, Math.min(30, prev + delta)))
      } else {
        setEditorFontSize(prev => Math.max(8, Math.min(30, prev + delta)))
      }
    })
    return () => {
      window.api.removeFontAdjustListener(handler)
    }
  }, [])

  // Listen for focus:settings IPC from main process menu
  React.useEffect(() => {
    const handler = window.api.onFocusSettings(() => {
      setFocusSettingsTrigger(k => k + 1)
    })
    return () => {
      window.api.removeFocusSettingsListener(handler)
    }
  }, [])
  const handleAgentStatusChange = useCallback((sessionId: string, status: 'running' | 'idle') => {
    setAgentStatus(prev => {
      if (prev[sessionId] === status) return prev
      return { ...prev, [sessionId]: status }
    })
  }, [])

  const handleToggleAutoApprove = useCallback(async (sessionId: string, cwd: string) => {
    setAutoApproveSessions(prev => {
      const next = !prev[sessionId]
      window.api.terminal.setAutoApprove(sessionId, cwd, next)
      const updated = { ...prev }
      if (next) {
        updated[sessionId] = true
      } else {
        delete updated[sessionId]
      }
      return updated
    })
  }, [])

  // OSC 标题变更回调：仅当用户未手动改过名时自动替换
  const handleOscTitleChange = useCallback(async (sessionId: string, title: string) => {
    if (manuallyRenamedRef.current.has(sessionId)) return

    // 去掉前缀 spinner/状态字符（CC 思考动画：✻⠐·等），保留正文
    // braille 区块 U+2800-U+28FF 覆盖所有盲文点字 spinner
    const clean = title.replace(/^[\s✢✳∗✻✽·\*⠀-⣿]+/, '').trim()
    if (!clean) return

    // 过滤无意义的 OSC 标题
    if (/[\\\/]/.test(clean)) return       // 路径类（如 PowerShell 进程路径）
    const shellNames = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe', 'wsl.exe', 'powershell', 'pwsh', 'cmd', 'bash', 'wsl']
    if (shellNames.includes(clean.toLowerCase())) return  // shell 已知名

    const result = await window.api.terminal.rename(sessionId, clean)
    if (result.success && result.session) {
      setSessions(prev => prev.map(s => s.id === sessionId ? result.session! : s))
    }
  }, [])

  // Track terminal commands per session
  const handleCommandEntered = useCallback((sessionId: string, command: string) => {
    setCommandHistory(prev => {
      const existing = prev[sessionId] || []
      // dedup: skip if same as last command
      if (existing.length > 0 && existing[existing.length - 1] === command) return prev
      const next = [...existing, command]
      if (next.length > 500) return { ...prev, [sessionId]: next.slice(-500) }
      return { ...prev, [sessionId]: next }
    })
  }, [])

  // Global keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const bindings = getShortcuts()

      // search.focus → focus search in right panel
      if (eventMatchesBinding(e, bindings['search.focus'])) {
        if (centerView !== 'diff') {
          e.preventDefault()
          e.stopImmediatePropagation()
          setSearchFocusTrigger(k => k + 1)
        }
      }

      // terminal.next / terminal.prev → blur right panel, switch session, focus terminal
      if (eventMatchesBinding(e, bindings['terminal.next'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ;(document.activeElement as HTMLElement)?.blur()
        const idx = sessions.findIndex(s => s.id === activeSessionId)
        const next = (idx + 1) % sessions.length
        if (sessions[next]) {
          setActiveSessionId(sessions[next].id)
          setCenterView('terminal')
          setDiffFile(null)
          setTimeout(() => {
            terminalRefs.current[sessions[next].id]?.focus()
          }, 0)
        }
      }
      if (eventMatchesBinding(e, bindings['terminal.prev'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ;(document.activeElement as HTMLElement)?.blur()
        const idx = sessions.findIndex(s => s.id === activeSessionId)
        const next = (idx - 1 + sessions.length) % sessions.length
        if (sessions[next]) {
          setActiveSessionId(sessions[next].id)
          setCenterView('terminal')
          setDiffFile(null)
          setTimeout(() => {
            terminalRefs.current[sessions[next].id]?.focus()
          }, 0)
        }
      }


      // terminal.history → toggle command history popup
      if (eventMatchesBinding(e, bindings['terminal.history'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (showHistoryRef.current) {
          setShowHistory(false)
        } else if (activeSessionId) {
          const cmds = commandHistoryRef.current[activeSessionId] || []
          setHistorySelectedIndex(Math.max(0, cmds.length - 1))
          setShowHistory(true)
        }
      }

      // font.increase / font.decrease → adjust font size
      // Also match numpad aliases (NumpadAdd ⇔ Equal, NumpadSubtract ⇔ Minus)
      const increaseMatch =
        eventMatchesBinding(e, bindings['font.increase']) ||
        (bindings['font.increase'].endsWith('Equal') &&
         eventMatchesBinding(e, bindings['font.increase'].replace('Equal', 'NumpadAdd')))
      const decreaseMatch =
        eventMatchesBinding(e, bindings['font.decrease']) ||
        (bindings['font.decrease'].endsWith('Minus') &&
         eventMatchesBinding(e, bindings['font.decrease'].replace('Minus', 'NumpadSubtract')))

      if (increaseMatch || decreaseMatch) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const delta = decreaseMatch ? -1 : 1
        if (centerView === 'terminal') {
          setTerminalFontSize(prev => Math.max(8, Math.min(30, prev + delta)))
        } else if (centerView === 'diff') {
          setEditorFontSize(prev => Math.max(8, Math.min(30, prev + delta)))
        }
      }

      // History popup navigation (when open, intercept arrow/enter/escape)
      if (showHistoryRef.current && activeSessionId) {
        const cmds = commandHistoryRef.current[activeSessionId] || []
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopImmediatePropagation()
          setShowHistory(false)
          return
        }
        if (e.key === 'ArrowUp' && cmds.length > 0) {
          e.preventDefault()
          e.stopImmediatePropagation()
          setHistorySelectedIndex(prev => Math.max(0, prev - 1))
          return
        }
        if (e.key === 'ArrowDown' && cmds.length > 0) {
          e.preventDefault()
          e.stopImmediatePropagation()
          setHistorySelectedIndex(prev => Math.min(cmds.length - 1, prev + 1))
          return
        }
        if (e.key === 'Enter' && cmds.length > 0) {
          e.preventDefault()
          e.stopImmediatePropagation()
          const idx = historySelectedIndexRef.current
          if (cmds[idx]) {
            window.api.terminal.write(activeSessionId, cmds[idx] + '\r')
          }
          setShowHistory(false)
          return
        }
      }

      // Escape: return focus to terminal from right panel (non-editable areas only)
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const active = document.activeElement as HTMLElement | null
        if (active && rightPanelRef.current?.contains(active) && centerView !== 'diff') {
          const tag = active.tagName
          if (tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT') {
            e.preventDefault()
            e.stopImmediatePropagation()
            active.blur()
            if (activeSessionId) {
              setTimeout(() => terminalRefs.current[activeSessionId]?.focus(), 0)
            }
          }
        }
      }
    }
    // capture phase: intercept before xterm.js gets it
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [centerView, sessions, activeSessionId])

  // Get cwd of the currently active session
  const activeSessionCwd = sessions.find(s => s.id === activeSessionId)?.cwd ?? null

  // Create a new terminal session — ask user to pick a directory first
  const handleCreateSession = useCallback(async (shell?: string) => {
    try {
      const dirResult = await window.api.workspace.pickDir()
      if (dirResult.canceled) return
      const session = await window.api.terminal.create({ cwd: dirResult.path, shell, autoUtf8 })
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
      setCenterView('terminal')
      setDiffFile(null)
    } catch (err) {
      console.error('Failed to create terminal session:', err)
    }
  }, [autoUtf8])

  // Create a terminal session at a specific path (no directory picker)
  const handleCreateSessionAt = useCallback(async (cwd: string, shell?: string) => {
    try {
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8 })
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
      setCenterView('terminal')
      setDiffFile(null)
      return session
    } catch (err) {
      console.error('Failed to create terminal session at path:', err)
      return null
    }
  }, [autoUtf8])

  // Listen for startup:openPath IPC from main process (CLI argument or second instance)
  React.useEffect(() => {
    const handler = window.api.onStartupOpenPath(async (data: { type: 'directory' | 'file'; path: string }) => {
      if (data.type === 'directory') {
        await handleCreateSessionAt(data.path)
      } else {
        // File: open parent directory as session, then open the file in editor
        const parentDir = data.path.replace(/[/\\][^/\\]*$/, '') || data.path
        const session = await handleCreateSessionAt(parentDir)
        if (session) {
          try {
            const result = await window.api.file.read(data.path)
            if (!result.error) {
              let filePath = data.path
              if (parentDir && data.path.startsWith(parentDir)) {
                filePath = data.path.slice(parentDir.length).replace(/^[\\/]+/, '')
              }
              setDiffFile({
                filePath,
                fullPath: data.path,
                diffContent: '',
                isStaged: false,
                defaultEdit: true,
                revision: ++diffRevisionRef.current
              })
              setCenterView('diff')
            }
          } catch (err) {
            console.error('Failed to open file from startup path:', err)
          }
        }
      }
    })
    return () => {
      window.api.removeStartupOpenPathListener(handler)
    }
  }, [handleCreateSessionAt])

  // Clone a terminal session (same cwd), insert below parent
  const handleCloneSession = useCallback(async (parentId: string | null, cwd: string, shell?: string, name?: string) => {
    try {
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8, name })
      setSessions(prev => {
        if (parentId == null) return [...prev, session]
        const parentIndex = prev.findIndex(s => s.id === parentId)
        if (parentIndex === -1) return [...prev, session]
        const next = [...prev]
        next.splice(parentIndex + 1, 0, session)
        return next
      })
      setActiveSessionId(session.id)
      setCenterView('terminal')
      setDiffFile(null)
    } catch (err) {
      console.error('Failed to clone terminal session:', err)
    }
  }, [autoUtf8])

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
    // 清理该 session 的命令历史和 agent 状态
    setCommandHistory(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setAgentStatus(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setAutoApproveSessions(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    // 清理该 session 的右侧终端
    const rightTerm = rightTerminalSessions[id]
    if (rightTerm) {
      window.api.terminal.close(rightTerm.id)
      setRightTerminalSessions(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
    }
  }, [activeSessionId, sessions, rightTerminalSessions])

  const handleReorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    setSessions(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  // Rename a terminal session
  const handleRenameSession = useCallback(async (id: string, newName: string) => {
    const oldSession = sessionsRef.current.find(s => s.id === id)
    if (oldSession && oldSession.name !== newName) {
      manuallyRenamedRef.current.add(id)
    }
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

  const handleFileSelect = useCallback((filePath: string, diffContent: string, isStaged: boolean, commitHash?: string, resolvedFullPath?: string) => {
    const fullPath = resolvedFullPath || (activeSessionCwd ? `${activeSessionCwd}/${filePath}` : filePath)
    setDiffFile({ filePath, fullPath, diffContent, isStaged, commitHash, revision: ++diffRevisionRef.current })
    setCenterView('diff')
  }, [activeSessionCwd])

  const handleDiffScroll = useCallback((delta: number) => {
    setDiffScrollTrigger(prev => prev + delta)
  }, [])

  const handleNavigateToFile = useCallback((filePath: string) => {
    setNavigateToFilePayload({ trigger: Date.now(), filePath })
  }, [])

  const handleBackToTerminal = useCallback(() => {
    setCenterView('terminal')
    setDiffFile(null)
  }, [])

  const handleRefreshGit = useCallback(async () => {
    setGitRefreshKey(k => k + 1)
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
        diffContent: '',
        isStaged: false,
        lineNumber,
        defaultEdit: true,
        revision: ++diffRevisionRef.current
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

      // 计算 filePath（相对路径），右侧终端 cwd 与活动 session cwd 一致
      const rightCwd = activeSessionCwd
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
        lineNumber,
        revision: ++diffRevisionRef.current
      })
      setCenterView('diff')
    } catch (err) {
      console.error('Failed to open file from right terminal:', err)
    }
  }, [activeSessionCwd])

  // 创建右侧终端（每个 session 独立）
  const handleCreateRightTerminal = useCallback(async (sessionId: string, cwdOverride?: string) => {
    if (rightTerminalSessions[sessionId]) return
    const session = sessions.find(s => s.id === sessionId)
    const cwd = cwdOverride || session?.cwd
    if (!cwd) return
    try {
      // 🌀 从 localStorage 读取用户选择的 shell 类型
      const shell = (() => { try { return localStorage.getItem('vibe-ide-term-type') || undefined } catch { return undefined } })()
      const term = await window.api.terminal.create({ cwd, shell, autoUtf8 })
      setRightTerminalSessions(prev => ({ ...prev, [sessionId]: term }))
    } catch (err) {
      console.error('Failed to create right terminal:', err)
    }
  }, [rightTerminalSessions, sessions, autoUtf8])

  // 关闭右侧终端
  const handleCloseRightTerminal = useCallback(async (sessionId: string) => {
    const term = rightTerminalSessions[sessionId]
    if (!term) return
    await window.api.terminal.close(term.id)
    setRightTerminalSessions(prev => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [rightTerminalSessions])

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
        defaultEdit: true,
        lineNumber,
        revision: ++diffRevisionRef.current
      })
      setCenterView('diff')
    } catch (err) {
      console.error('Failed to open file from search:', err)
    }
  }, [activeSessionCwd])

  // 处理从文件浏览器打开文件 — 默认 edit 模式
  const handleOpenFileFromExplorer = useCallback(async (fullPath: string) => {
    try {
      let filePath = fullPath
      if (activeSessionCwd && fullPath.startsWith(activeSessionCwd)) {
        filePath = fullPath.slice(activeSessionCwd.length).replace(/^[\\\/]+/, '')
      }
      setDiffFile({
        filePath,
        fullPath,
        diffContent: '',
        isStaged: false,
        defaultEdit: true,
        revision: ++diffRevisionRef.current
      })
      setCenterView('diff')
    } catch (err) {
      console.error('Failed to open file from explorer:', err)
    }
  }, [activeSessionCwd])


  return (
    <div className="h-full w-full flex flex-col bg-ide-bg">
      {/* Title Bar */}
      <div className="titlebar-drag h-9 bg-ide-sidebar border-b border-ide-border flex items-center px-4 select-none shrink-0">
        <span className="w-[18px] h-[18px] mr-1.5 shrink-0 -ml-1 flex items-center justify-center rounded bg-ide-accent/40 text-[11px] leading-none">🤔</span>
        <span className="text-ide-text-muted text-sm font-medium tracking-wide">Vibe IDE</span>
        <div className="flex-1" />
        <button
          className="no-drag w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
          style={{ marginRight: 138 }}
          onClick={handleToggleRightPanel}
          title={rightPanelCollapsed ? t('Expand Panel') : t('Collapse Panel')}
        >
          {rightPanelCollapsed ? (
            <svg viewBox="0 0 16 16" fill="currentColor" className="size-4">
              <path fillRule="evenodd" d="M12.78 7.595a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06l2.72-2.72-2.72-2.72a.75.75 0 0 1 1.06-1.06l3.25 3.25Zm-8.25-3.25 3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06l2.72-2.72-2.72-2.72a.75.75 0 0 1 1.06-1.06Z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor" className="size-4">
              <path fillRule="evenodd" d="M3.22 7.595a.75.75 0 0 0 0 1.06l3.25 3.25a.75.75 0 0 0 1.06-1.06l-2.72-2.72 2.72-2.72a.75.75 0 0 0-1.06-1.06l-3.25 3.25Zm8.25-3.25-3.25 3.25a.75.75 0 0 0 0 1.06l3.25 3.25a.75.75 0 1 0 1.06-1.06l-2.72-2.72 2.72-2.72a.75.75 0 0 0-1.06-1.06Z" clipRule="evenodd" />
            </svg>
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
            onReorderSessions={handleReorderSessions}
            commandHistory={commandHistory}
            agentStatus={agentStatus}
            autoApproveSessions={autoApproveSessions}
            onToggleAutoApprove={handleToggleAutoApprove}
            showSquiggles={showSquiggles}
            onToggleSquiggles={setShowSquiggles}
            pollingEnabled={pollingEnabled}
            onTogglePolling={(v) => { setPollingEnabled(v); try { localStorage.setItem('vibe-ide-polling', v ? '1' : '0') } catch {} }}
            wordWrap={wordWrap}
            onToggleWordWrap={setWordWrap}
            autoUtf8={autoUtf8}
            onToggleAutoUtf8={setAutoUtf8}
            inlineDiff={inlineDiff}
            onToggleInlineDiff={setInlineDiff}
            fileTreeDepth={fileTreeDepth}
            onChangeFileTreeDepth={handleFileTreeDepthChange}
            focusSettingsTrigger={focusSettingsTrigger}
          />
        </div>

        {/* Left Panel Resize Handle */}
        <div
          className="w-1 bg-ide-border hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
          onMouseDown={handleLeftResizeStart}
        />

        {/* Center Panel: Terminal or Diff — all three blocks always mounted, toggled via display */}
        <div className="flex-1 flex flex-col overflow-hidden bg-ide-bg focus-frame"
          data-focused={focusedPanel === 'term' ? 'true' : undefined}
          onFocus={handleCenterFocus}
          onBlur={handleCenterBlur}>
          {/* Diff */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ display: centerView === 'diff' && diffFile ? 'flex' : 'none' }}>
            {diffFile && (
              <DiffViewer
                key={`${diffFile.fullPath}-${diffFile.commitHash || 'working'}`}
                filePath={diffFile.filePath}
                fullPath={diffFile.fullPath}
                diffContent={diffFile.diffContent}
                isStaged={diffFile.isStaged}
                commitHash={diffFile.commitHash}
                showSquiggles={showSquiggles}
                lineNumber={diffFile.lineNumber}
                revision={diffFile.revision}
                onBack={handleBackToTerminal}
                onSaved={handleRefreshGit}
                defaultEdit={diffFile.defaultEdit}
                fontSize={editorFontSize}
                wordWrap={wordWrap}
                inlineDiff={inlineDiff}
                scrollTrigger={diffScrollTrigger}
              />
            )}
          </div>
          {/* Empty state */}
          <div className="flex-1 flex items-center justify-center text-ide-text-muted" style={{ display: !(centerView === 'diff' && diffFile) && sessions.length === 0 ? 'flex' : 'none' }}>
            No active terminal session. Create one to start.
          </div>
          {/* Terminal sessions */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ display: !(centerView === 'diff' && diffFile) && sessions.length > 0 ? 'flex' : 'none' }}>
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-ide-text-muted">Loading...</div>}>
              {sessions.map(session => (
                <div
                  key={session.id}
                  className="flex-1 flex flex-col overflow-hidden"
                  style={{ display: session.id === activeSessionId ? 'flex' : 'none' }}
                >
                  <TerminalView ref={(node) => { if (node) terminalRefs.current[session.id] = node }} sessionId={session.id} sessionName={session.name} sessionCwd={session.cwd} onOpenFile={handleOpenFileFromTerminal} onCommand={(cmd) => handleCommandEntered(session.id, cmd)} showHeader={false} fontSize={terminalFontSize} newlineShortcut={getShortcuts()['terminal.newline']} pageDownShortcut={getShortcuts()['terminal.pageDown']} pageUpShortcut={getShortcuts()['terminal.pageUp']} onAgentStatusChange={handleAgentStatusChange} onOscTitle={handleOscTitleChange} />
                </div>
              ))}
            </Suspense>
          </div>
        </div>

        {/* Right Panel Resize Handle */}
        {!rightPanelCollapsed && (
          <div
            className="w-1 bg-ide-border hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
            onMouseDown={handleRightResizeStart}
          />
        )}

        {/* Right Panel */}
        {rightPanelCollapsed ? null : (
        <div ref={rightPanelRef}
          className="shrink-0 flex flex-col bg-ide-sidebar border-l border-ide-border overflow-hidden focus-frame"
          style={{ width: rightPanelWidth }}
          data-focused={focusedPanel === 'right' ? 'true' : undefined}
          onFocus={handleRightFocus}
          onBlur={handleRightBlur}>
          <RightPanel
            workspacePath={activeSessionCwd}
            activeSessionId={activeSessionId}
            onFileSelect={handleFileSelect}
            refreshKey={gitRefreshKey}
            pollingTick={pollingTick}
            onOpenFileFromRightTerminal={handleOpenFileFromRightTerminal}
            onOpenFileFromSearch={handleOpenFileFromSearch}
            onOpenFileFromExplorer={handleOpenFileFromExplorer}
            rightTerminalSession={activeSessionId ? rightTerminalSessions[activeSessionId] : undefined}
            onCreateRightTerminal={handleCreateRightTerminal}
            onCloseRightTerminal={handleCloseRightTerminal}
            searchFocusTrigger={searchFocusTrigger}
            navigateToFilePayload={navigateToFilePayload}
            onNavigateToFile={handleNavigateToFile}

            fileTreeDepth={fileTreeDepth}
            onDiffScroll={handleDiffScroll}
            onToggleCollapse={handleToggleRightPanel}
          />
        </div>
        )}
      </div>

      {/* History Popup Overlay */}
      {showHistory && activeSessionId && (() => {
        const cmds = commandHistory[activeSessionId] || []
        const sessionName = sessions.find(s => s.id === activeSessionId)?.name || activeSessionId
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowHistory(false)}>
            <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[600px] max-h-[500px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-center px-4 py-2.5 border-b border-ide-border shrink-0 bg-ide-sidebar">
                <span className="text-sm font-semibold text-ide-text truncate">{sessionName}</span>
              </div>
              <div className="flex-1 overflow-y-auto" ref={historyListRef}>
                {cmds.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-ide-text-muted text-center">No commands yet</div>
                ) : (
                  cmds.map((cmd, i) => (
                    <div
                      key={`hist-${i}`}
                      data-history-index={i === historySelectedIndex ? i : undefined}
                      className={`px-4 py-1.5 text-sm font-mono cursor-pointer flex items-center gap-3 ${
                        i === historySelectedIndex ? 'bg-ide-accent/20 text-ide-text' : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
                      }`}
                      onClick={() => {
                        window.api.terminal.write(activeSessionId, cmd)
                        setShowHistory(false)
                      }}
                      onMouseEnter={() => setHistorySelectedIndex(i)}
                    >
                      <span className="text-ide-text-muted shrink-0 w-8 text-right text-xs">{i + 1}</span>
                      <span className="truncate flex-1" title={cmd}>{cmd}</span>
                      <button
                        className="shrink-0 text-ide-text-muted/40 hover:text-ide-text transition-colors"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(cmd)
                        }}
                        title="Copy"
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                          <path fillRule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6ZM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}