
import React, { useState, useCallback, useMemo, lazy, Suspense, useRef, useEffect } from 'react'
import SessionPanel from './components/SessionPanel'
import RightPanel from './components/RightPanel'
import DiffViewer from './components/DiffViewer'
import MarkdownPreview from './components/MarkdownPreview'
import ImagePreview from './components/ImagePreview'
import OutlinePanel, { isCode, isMarkdown } from './components/OutlinePanel'
import NavBar from './components/NavBar'
import WelcomeScreen from './components/WelcomeScreen'
import CallGraphOverlay from './components/CallGraphOverlay'
import AiTab, { AiTabHandle } from './components/AiTab'
import { CodeGraphSearch } from './components/CodeGraphSearch'
import { CodeGraphExploreResult } from './components/CodeGraphExploreResult'
import { TerminalSession, RenameTerminalResult, AiPermissionMode, RecentFileEntry } from '@shared/types'
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
        create: (options?: { cwd?: string; name?: string; shell?: string; autoUtf8?: boolean }) => Promise<TerminalSession>
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
        log: (opts?: { count?: number; skip?: number }) => Promise<any>
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
        deleteBranch: (branch: string) => Promise<any>
        setFilterRules: (rules: string[]) => Promise<any>
        diffCommitFile: (hash: string, filePath: string, isRoot: boolean) => Promise<any>
        lineLog: (filePath: string, startLine: number, endLine: number) => Promise<any>
      }
      file: {
        read: (filePath: string) => Promise<any>
        write: (filePath: string, content: string) => Promise<any>
        readWithEncoding: (filePath: string, encoding?: string, forceOpen?: boolean) => Promise<{ content: string; encoding: string; bom: boolean; confidence: number; error?: string }>
        writeWithEncoding: (filePath: string, content: string, encoding?: string) => Promise<{ success: boolean; error?: string }>
        list: (dirPath: string) => Promise<any>
        tree: (dirPath: string, depth?: number, skipPatterns?: string[]) => Promise<any>
        delete: (filePath: string) => Promise<any>
        rename: (oldPath: string, newPath: string) => Promise<any>
        createDir: (dirPath: string) => Promise<any>
        openExplorer: (filePath: string) => Promise<any>
        copy: (srcPath: string, destPath: string) => Promise<any>
        move: (srcPath: string, destPath: string) => Promise<any>
        find: (cwd: string, filename: string, skipPatterns?: string[]) => Promise<any>
        onChanged: (callback: () => void) => any
        removeChangedListener: (handler?: any) => void
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
          wholeWord?: boolean
          include?: string
        }) => Promise<any>
        replace: (options: {
          query: string
          replacement: string
          cwd: string
          regex?: boolean
          caseSensitive?: boolean
          wholeWord?: boolean
          include?: string
          excludeFiles?: string[]
        }) => Promise<{ filesModified: number; totalReplacements: number; errors: string[] }>
      }
      code: {
        setWorkspace: (root: string) => Promise<{ success: boolean; error?: string }>
        isInitialized: (root: string) => Promise<{ initialized: boolean; error?: string }>
        init: (root: string) => Promise<{ success: boolean; error?: string }>
        searchNodes: (query: string, opts?: { limit?: number; kinds?: string[]; filePath?: string; excludePatterns?: string[] }) => Promise<{ nodes: import('@shared/types').CodeSymbol[]; total: number; error?: string }>
        getCallers: (id: string, maxDepth?: number) => Promise<{ nodes: any[]; error?: string }>
        getCallees: (id: string, maxDepth?: number) => Promise<{ nodes: any[]; error?: string }>
        isIndexing: () => Promise<{ isIndexing: boolean; error?: string }>
        cancelInit: () => Promise<{ success: boolean; error?: string }>
        getStats: () => Promise<any>
        installMcp: (targets: string[], workspacePath: string) => Promise<{ success: boolean; error?: string }>
        findRelevantContext: (query: string, opts?: { searchLimit?: number; traversalDepth?: number; maxNodes?: number }) => Promise<{ nodes: import('@shared/types').CodeSymbol[]; roots: string[]; confidence?: 'high' | 'low'; error?: string }>
        explore: (query: string, opts?: any) => Promise<{ nodes: import('@shared/types').CodeSymbol[]; roots: string[]; error?: string }>
        checkAvailable: () => Promise<{ available: boolean; cliAvailable?: boolean; installCmd?: string; error?: string }>
        onProgress: (callback: (progress: any) => void) => any
        removeProgressListener: (handler?: any) => void
        setEnabled: (enabled: boolean) => Promise<{ enabled: boolean }>
      }
      ocr: {
        recognize: (input: string | { buffer: Uint8Array; name: string }) => Promise<string>
      }
      theme: {
        setTitleBar: (options: { color: string; symbolColor: string; backgroundColor: string }) => void
      }
      appVersion: () => Promise<string>
      perf: { snapshot: () => Promise<any> }
      system: { listFonts: () => Promise<string[]> }
      onFontAdjust: (callback: (delta: number) => void) => any
      removeFontAdjustListener: (handler?: any) => void
      onFocusSettings: (callback: () => void) => any
      removeFocusSettingsListener: (handler?: any) => void
      onStartupOpenPath: (callback: (data: { type: 'directory' | 'file'; path: string }) => void) => any
      removeStartupOpenPathListener: (handler?: any) => void
      ai: {
        checkAvailable: (cliCommand?: string) => Promise<{ available: boolean; installCmd?: string; error?: string }>
        create: (options: { sessionId: string; cwd: string; autoApprove?: boolean; permissionMode?: string; resumeSessionId?: string; cliCommand?: string; model?: string }) => Promise<{ success: boolean; error?: string }>
        send: (sessionId: string, message: string) => Promise<{ success: boolean; error?: string }>
        cancel: (sessionId: string) => Promise<boolean>
        destroy: (sessionId: string) => Promise<boolean>
        respondPermission: (sessionId: string, requestId: string, approved: boolean, tool?: string, toolInput?: Record<string, any>, feedback?: string) => Promise<{ success: boolean }>
        clearAndExecutePlan: (sessionId: string, planFilePath: string) => Promise<{ success: boolean; error?: string }>
        setPermissionMode: (sessionId: string, mode: string) => Promise<{ success: boolean; error?: string }>
        setModel: (sessionId: string, model: string) => Promise<{ success: boolean; error?: string }>
        askResume: (sessionId: string, answers: Record<string, string>) => Promise<{ success: boolean; error?: string }>
        listSessions: (cwd?: string) => Promise<{ sessions: any[]; error?: string }>
        loadSessionMessages: (resumeSessionId: string, cwd: string) => Promise<{ messages: any[]; model?: string; slashCommands?: any[]; error?: string }>
        revert: (payload: { sessionId: string; userMessageIndex: number; scope: 'conversation' | 'both'; cwd: string }) => Promise<{ success: boolean; error?: string }>
        fork: (payload: { sessionId: string; userMessageIndex: number; cwd: string }) => Promise<{ success: boolean; newClaudeSessionId?: string; error?: string }>
        onMessage: (callback: (data: any) => void) => any
        removeMessageListener: (handler?: any) => void
        onStreamToken: (callback: (data: { sessionId: string; token: string }) => void) => any
        removeStreamTokenListener: (handler?: any) => void
        onPermission: (callback: (data: any) => void) => any
        removePermissionListener: (handler?: any) => void
        onReady: (callback: (data: { sessionId: string }) => void) => any
        removeReadyListener: (handler?: any) => void
        onFileChange: (callback: (data: any) => void) => any
        removeFileChangeListener: (handler?: any) => void
        onProgress: (callback: (data: any) => void) => any
        removeProgressListener: (handler?: any) => void
        onError: (callback: (data: { sessionId: string; error: string }) => void) => any
        removeErrorListener: (handler?: any) => void
      }
    }
      }
}

type CenterView = 'terminal' | 'diff' | 'markdown' | 'image'

interface DiffFileState {
  defaultEdit?: boolean
  filePath: string          // 相对路径（用于 git diff）
  fullPath: string          // 完整路径（用于 file read/write）
  diffContent: string
  isStaged: boolean
  commitHash?: string       // 查看历史 commit 时的 commit hash
  lineNumber?: number       // 跳转到指定行
  revision: number          // 递增以强制 DiffViewer 重新加载内容
  compareOriginalContent?: string  // 文件对比模式：左侧文件内容
  compareOriginalPath?: string     // 文件对比模式：左侧文件路径
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
  const [isDragOverEdit, setIsDragOverEdit] = useState(false)
  const [centerView, setCenterView] = useState<CenterView>('terminal')
  const [diffFile, setDiffFile] = useState<DiffFileState | null>(null)
  const [currentFileContent, setCurrentFileContent] = useState<string>('')  // DiffViewer 回传，供 OutlinePanel 省 IPC
  // 文件切换时清空 stale content，防止新 OutlinePanel 拿到上一个文件的内容
  useEffect(() => { setCurrentFileContent('') }, [diffFile?.fullPath])
  const [markdownFile, setMarkdownFile] = useState<{ fullPath: string; fileName: string } | null>(null)
  const [imageFile, setImageFile] = useState<{ fullPath: string; fileName: string } | null>(null)
  const diffRevisionRef = useRef(0)
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
  const [mdSearchTrigger, setMdSearchTrigger] = useState(0)
  const [sessionViewModes, setSessionViewModes] = useState<Record<string, 'term' | 'gui'>>({})
  const sessionViewModesRef = useRef(sessionViewModes); sessionViewModesRef.current = sessionViewModes
  const [callGraphFocalNode, setCallGraphFocalNode] = useState<any>(null)
  const callGraphFocalNodeRef = useRef<any>(null); callGraphFocalNodeRef.current = callGraphFocalNode
  const handleOpenCallGraphFromEditor = useCallback(async (word: string) => {
    try {
      const r = await window.api.code.searchNodes(word, { limit: 10, kinds: ['function', 'method', 'constructor'] })
      if (r.error || !r.nodes.length) return
      const exact = r.nodes.find(n => n.name === word)
      setCallGraphFocalNode(exact || r.nodes[0])
    } catch {}
  }, [])
  const handleViewLineHistory = useCallback((filePath: string, lineNumber: number) => {
    // Use trigger counter to force re-render even if filePath+lineNumber are same
    setLineHistoryPayload({ filePath, lineNumber })
  }, [])
  const [showCodeSearch, setShowCodeSearch] = useState(false)
  const [codeSearchFocusTrigger, setCodeSearchFocusTrigger] = useState(0)
  const [exploreResult, setExploreResult] = useState<{ query: string; content: string } | null>(null)

  const showCodeSearchRef = useRef(false); showCodeSearchRef.current = showCodeSearch
  const codeSearchActivatedRef = useRef(false)
  const exploreResultRef = useRef(exploreResult); exploreResultRef.current = exploreResult
  const closeCodeSearch = useCallback(() => {
    setShowCodeSearch(false)
    codeSearchActivatedRef.current = false
    setCodeSearchFocusTrigger(0)
  }, [])
  const [navigateToFilePayload, setNavigateToFilePayload] = useState<{ trigger: number; filePath: string } | null>(null)

  // ── Recently opened files (global, persisted) ──
  const RECENT_FILES_KEY = 'vibe-ide-recent-files'
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_FILES_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr) && arr.every((v: any) => v && typeof v.path === 'string')) {
          return arr.map((v: any) => ({ path: v.path, line: typeof v.line === 'number' && v.line > 0 ? v.line : undefined }))
        }
      }
    } catch {}
    return []
  })

  const recordRecentFile = useCallback((fullPath: string, lineNumber?: number) => {
    if (!fullPath) return
    const line = typeof lineNumber === 'number' && lineNumber > 0 ? lineNumber : undefined
    const norm = (p: string) => p.replace(/\\/g, '/')
    const target = norm(fullPath)
    setRecentFiles(prev => {
      const existingIdx = prev.findIndex(r => norm(r.path) === target)
      if (existingIdx >= 0) {
        // 已在列表：刷新行号，保持原位置不变（不置顶、不影响其余条目）
        // lineNumber 缺省（如文件树点开）时保留已有行号——行号由光标回写/跳转入口维护，普通打开不清空
        const existing = prev[existingIdx]
        const mergedLine = line ?? existing.line
        if (existing.line === mergedLine) return prev
        const next = prev.map((r, i) => i === existingIdx ? { ...r, line: mergedLine } : r)
        try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)) } catch {}
        return next
      }
      // 新文件：置顶
      const next = [{ path: fullPath, line }, ...prev].slice(0, 10)
      try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // 从最近文件列表移除单个文件（X 按钮）
  const removeRecentFile = useCallback((fullPath: string) => {
    if (!fullPath) return
    const norm = (p: string) => p.replace(/\\/g, '/')
    const target = norm(fullPath)
    setRecentFiles(prev => {
      const next = prev.filter(r => norm(r.path) !== target)
      if (next.length === prev.length) return prev
      try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // Line history payload — triggered by Monaco right-click "View Line History"
  const [lineHistoryPayload, setLineHistoryPayload] = useState<{ filePath: string; lineNumber: number } | null>(null)
  const lineHistoryPayloadRef = useRef(lineHistoryPayload)
  lineHistoryPayloadRef.current = lineHistoryPayload

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
  const [terminalBusy, setTerminalBusy] = useState<Record<string, boolean>>({})
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({})
  const agentStatus = useMemo(() => {
    const result: Record<string, 'running' | 'idle'> = {}
    for (const s of sessions) {
      result[s.id] = (terminalBusy[s.id] || aiBusy[s.id]) ? 'running' : 'idle'
    }
    return result
  }, [sessions, terminalBusy, aiBusy])
  const [autoApproveSessions, setAutoApproveSessions] = useState<Record<string, boolean>>({})
  const [aiPermissionModes, setAiPermissionModes] = useState<Record<string, AiPermissionMode>>({})
  const [forkSessions, setForkSessions] = useState<Record<string, string>>({})
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
  const [capsuleTabs, setCapsuleTabs] = useState(() => {
    try { return localStorage.getItem('vibe-ide-capsule-tabs') !== 'false' } catch { return true }
  })
  const [groupSessionsByCwd, setGroupSessionsByCwd] = useState(() => {
    try { return localStorage.getItem('vibe-ide-group-sessions-by-cwd') !== 'false' } catch { return true }
  })
  const [escAutoAt, setEscAutoAt] = useState(() => {
    try { return localStorage.getItem('vibe-ide-esc-auto-at') === 'true' } catch { return false }
  })
  const escAutoAtRef = useRef(escAutoAt)
  escAutoAtRef.current = escAutoAt

  const [ocrEnabled, setOcrEnabled] = useState(() => {
    try { return localStorage.getItem('vibe-ide-ocr-enabled') !== '0' } catch { return true }
  })
  const [cgEnabled, setCgEnabled] = useState(() => {
    try { return localStorage.getItem('vibe-ide-cg-enabled') !== '0' } catch { return true }
  })

  const [fileTreeDepth, setFileTreeDepth] = useState(() => {
    try {
      const v = localStorage.getItem('vibe-ide-file-tree-depth')
      return v ? Math.max(1, Math.min(12, Number(v))) : 5
    } catch { return 3 }
  })

  const handleFileTreeDepthChange = useCallback((delta: number) => {
    setFileTreeDepth(prev => {
      const next = Math.max(1, Math.min(12, prev + delta))
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
  const [sessionFontFamily, setSessionFontFamily] = useState(() => {
    try {
      return localStorage.getItem('vibe-ide-session-font') || 'Consolas'
    } catch { return 'Consolas' }
  })
  const [fontFamily, setFontFamily] = useState(() => {
    try {
      return localStorage.getItem('vibe-ide-font-family') || 'Cascadia Code'
    } catch { return 'Cascadia Code' }
  })
  const [termFontFamily, setTermFontFamily] = useState(() => {
    try {
      return localStorage.getItem('vibe-ide-term-font') || 'Cascadia Code'
    } catch { return 'Cascadia Code' }
  })
  const centerViewRef = React.useRef<CenterView>('terminal')

  // Keep ref in sync so IPC listener always sees latest centerView
  React.useEffect(() => {
    centerViewRef.current = centerView
  }, [centerView])

  // Terminal refs for focus management (keyed by sessionId)
  const terminalRefs = useRef<Record<string, TerminalViewHandle>>({})
  const aiTabRefs = useRef<Record<string, AiTabHandle>>({})
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const centerPanelRef = useRef<HTMLDivElement>(null)
  // Cursor position (DiffViewer 回传，供行历史等使用)
  interface CursorHistoryEntry { fullPath: string; line: number; column: number }
  const cursorRef = useRef<CursorHistoryEntry | null>(null)
  // 视口顶部可见行（滚轮实际看到的位置，非光标）— DiffViewer 的 onDidScrollChange 实时回写，供最近文件行号
  interface VisibleLineEntry { fullPath: string; line: number }
  const visibleLineRef = useRef<VisibleLineEntry | null>(null)
  const diffFileRef = useRef(diffFile)
  diffFileRef.current = diffFile

  // ── 最近文件行号落盘：切换/关闭 diff 文件时，回写上一个文件的视口可见行号 ──
  // visibleLineRef 切文件瞬间仍是旧值（新 DiffViewer 尚未 mount 写入），故可安全存上一个文件
  const prevDiffPathRef = useRef<string | null>(null)
  useEffect(() => {
    const prevPath = prevDiffPathRef.current
    const cur = visibleLineRef.current
    // 校验 visibleLineRef 仍归属上一个文件，避免误存新文件行号
    if (prevPath && cur && cur.fullPath === prevPath && cur.line > 0) {
      recordRecentFile(prevPath, cur.line)
    }
    prevDiffPathRef.current = diffFile?.fullPath ?? null
  }, [diffFile?.fullPath, recordRecentFile])

  // ── 关 app / 切后台时兜底落盘当前文件视口可见行号 ──
  useEffect(() => {
    const save = () => {
      const cur = visibleLineRef.current
      if (cur && cur.line > 0) recordRecentFile(cur.fullPath, cur.line)
    }
    const onHide = () => { if (document.visibilityState === 'hidden') save() }
    window.addEventListener('beforeunload', save)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', save)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [recordRecentFile])

  // ── 行书签（手动钉选 📌，跨重启持久化，全局不按 session 隔离）──
  const BOOKMARKS_KEY = 'vibe-ide-bookmarks'
  interface BookmarkEntry { fullPath: string; line: number }
  const loadBookmarks = (): BookmarkEntry[] => {
    try {
      const raw = localStorage.getItem(BOOKMARKS_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) {
          return arr.filter((b: any) => b && typeof b.fullPath === 'string' && typeof b.line === 'number')
        }
      }
    } catch {}
    return []
  }
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() => loadBookmarks())
  const bookmarksRef = useRef(bookmarks)
  bookmarksRef.current = bookmarks
  React.useEffect(() => {
    try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks)) } catch {}
  }, [bookmarks])
  const toggleBookmark = useCallback((fullPath: string, line: number) => {
    setBookmarks(prev => {
      const idx = prev.findIndex(b => b.fullPath === fullPath && b.line === line)
      if (idx >= 0) { const next = [...prev]; next.splice(idx, 1); return next }
      return [...prev, { fullPath, line }]
    })
  }, [])
  // 当前文件的书签行号集合（传给 DiffViewer 渲染 glyph margin 📌）
  const currentFileBookmarks = useMemo(
    () => new Set(bookmarks.filter(b => b.fullPath === diffFile?.fullPath).map(b => b.line)),
    [bookmarks, diffFile]
  )
  // Alt 画笔模式（按住 Alt 时编辑器鼠标变 🖌️）
  const [altBrush, setAltBrush] = useState(false)
  const altBrushRef = useRef(false)
  altBrushRef.current = altBrush
  // Nav bar state
  const [navBarVisible, setNavBarVisible] = useState(false)
  const [navBarIndex, setNavBarIndex] = useState(0)
  const navBarVisibleRef = useRef(false)
  const navBarIndexRef = useRef(0)
  const navBarCwdRef = useRef<string | null>(null)
  const navBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navBarCancelledRef = useRef(false)
  const navBarUsedRef = useRef(false)  // true when user actually navigated with arrows
  navBarVisibleRef.current = navBarVisible
  navBarIndexRef.current = navBarIndex
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

  // Focus input when switching sessions or returning from diff
  useEffect(() => {
    if (centerView === 'terminal' && activeSessionId) {
      const mode = sessionViewModes[activeSessionId]
      const timer = setTimeout(() => {
        if (mode === 'gui') {
          aiTabRefs.current[activeSessionId]?.focus()
        } else {
          terminalRefs.current[activeSessionId]?.focus()
        }
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [centerView, activeSessionId, sessionViewModes])

  // Persist font sizes to localStorage
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-terminal-font-size', String(terminalFontSize)) } catch {}
  }, [terminalFontSize])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-editor-font-size', String(editorFontSize)) } catch {}
  }, [editorFontSize])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-session-font', sessionFontFamily) } catch {}
  }, [sessionFontFamily])
  React.useEffect(() => {
    document.documentElement.style.setProperty('--ide-session-font', sessionFontFamily)
  }, [sessionFontFamily])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-font-family', fontFamily) } catch {}
  }, [fontFamily])
  React.useEffect(() => {
    document.documentElement.style.setProperty('--ide-font-family', fontFamily)
  }, [fontFamily])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-term-font', termFontFamily) } catch {}
  }, [termFontFamily])
  React.useEffect(() => {
    document.documentElement.style.setProperty('--ide-term-font', termFontFamily)
  }, [termFontFamily])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-word-wrap', String(wordWrap)) } catch {}
  }, [wordWrap])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-auto-utf8', String(autoUtf8)) } catch {}
  }, [autoUtf8])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-ocr-enabled', ocrEnabled ? '1' : '0') } catch {}
  }, [ocrEnabled])
  useEffect(() => {
    try { localStorage.setItem('vibe-ide-cg-enabled', cgEnabled ? '1' : '0') } catch {}
    window.api.code.setEnabled(cgEnabled)
  }, [cgEnabled])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-inline-diff', String(inlineDiff)) } catch {}
  }, [inlineDiff])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-capsule-tabs', String(capsuleTabs)) } catch {}
  }, [capsuleTabs])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-group-sessions-by-cwd', String(groupSessionsByCwd)) } catch {}
  }, [groupSessionsByCwd])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-esc-auto-at', String(escAutoAt)) } catch {}
  }, [escAutoAt])

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

  // Drag-and-drop file to compare: edit 模式下拖入文件触发对比
  // 使用 window 级别 capture 监听，确保在 Monaco 等子组件之前拦截事件
  React.useEffect(() => {
    let dragHideTimer: ReturnType<typeof setTimeout> | null = null

    const isFileDrag = (e: DragEvent) =>
      e.dataTransfer?.types.includes('Files') || (e.dataTransfer?.files && e.dataTransfer.files.length > 0)

    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      const panel = centerPanelRef.current
      if (!panel || !panel.contains(e.target as Node)) return
      if (!diffFileRef.current?.defaultEdit) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      if (dragHideTimer) { clearTimeout(dragHideTimer); dragHideTimer = null }
      setIsDragOverEdit(true)
    }

    const onDragLeave = (e: DragEvent) => {
      const panel = centerPanelRef.current
      if (!panel) return
      // 仅当鼠标离开中心面板区域时隐藏 overlay
      if (e.target === panel || !panel.contains(e.relatedTarget as Node)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        dragHideTimer = setTimeout(() => {
          setIsDragOverEdit(false)
          dragHideTimer = null
        }, 200)
      }
    }

    const onDrop = async (e: DragEvent) => {
      if (!isFileDrag(e)) return
      if (!diffFileRef.current?.defaultEdit) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (dragHideTimer) { clearTimeout(dragHideTimer); dragHideTimer = null }
      setIsDragOverEdit(false)

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      const droppedPath = (files[0] as any).path as string | undefined
      const currentEditPath = diffFileRef.current?.fullPath
      if (!currentEditPath) return


      let compareContent: string
      let comparePath: string

      if (droppedPath) {
        if (droppedPath === currentEditPath) return
        try {
          const compareResult = await window.api.file.read(droppedPath)
          compareContent = compareResult.error ? '' : (compareResult.content || '')
          comparePath = droppedPath
        } catch {
          return
        }
      } else {
        const file = files[0]
        try {
          const buffer = await file.arrayBuffer()
          compareContent = new TextDecoder().decode(buffer)
          comparePath = file.name
        } catch {
          return
        }
      }

      setDiffFile(prev => prev ? {
        ...prev,
        defaultEdit: false,
        diffContent: '',
        compareOriginalContent: compareContent,
        compareOriginalPath: comparePath,
        revision: ++diffRevisionRef.current
      } : null)
    }

    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)

    return () => {
      if (dragHideTimer) clearTimeout(dragHideTimer)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
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
    setTerminalBusy(prev => {
      const v = status === 'running'
      if (prev[sessionId] === v) return prev
      return { ...prev, [sessionId]: v }
    })
  }, [])

  const handleAiAgentStatusChange = useCallback((sessionId: string, status: 'running' | 'idle') => {
    setAiBusy(prev => {
      const v = status === 'running'
      if (prev[sessionId] === v) return prev
      return { ...prev, [sessionId]: v }
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

  // per-session onCommand 缓存：避免内联箭头击穿 TerminalView 的 React.memo（handleCommandEntered 已 useCallback 稳定）
  const onCommandForSession = useMemo(() => {
    const cache = new Map<string, (cmd: string) => void>()
    return (id: string) => {
      let fn = cache.get(id)
      if (!fn) { fn = (cmd: string) => handleCommandEntered(id, cmd); cache.set(id, fn) }
      return fn
    }
  }, [handleCommandEntered])

  // Global keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const bindings = getShortcuts()

      // ── Alt keydown: start long-press timer to show code search (and nav bar if history) ──
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        navBarCancelledRef.current = false
        setAltBrush(true)
        e.preventDefault()
        e.stopImmediatePropagation()
        if (navBarTimerRef.current) clearTimeout(navBarTimerRef.current)
        navBarTimerRef.current = setTimeout(() => {
          navBarTimerRef.current = null
          codeSearchActivatedRef.current = false
          setShowCodeSearch(true)
          if (bookmarksRef.current.length > 0) {
            const idx = navBarIndexRef.current
            if (idx >= 0 && idx < bookmarksRef.current.length) {
              navBarCwdRef.current = sessionsRef.current.find(s => s.id === activeSessionId)?.cwd ?? null
              navBarVisibleRef.current = true
              navBarCancelledRef.current = false
              navBarUsedRef.current = false
              navBarIndexRef.current = idx
              setNavBarVisible(true)
              setNavBarIndex(idx)
            }
          }
        }, 300)
        return
      }

      // ── nav bar mode: intercept Left/Right to move selection ──
      if (navBarVisibleRef.current) {
        if (e.key === 'ArrowLeft' && e.altKey) {
          e.preventDefault()
          e.stopImmediatePropagation()
          navBarUsedRef.current = true
          setNavBarIndex(prev => {
            const len = bookmarksRef.current.length
            return prev <= 0 ? len - 1 : prev - 1
          })
          return
        }
        if (e.key === 'ArrowRight' && e.altKey) {
          e.preventDefault()
          e.stopImmediatePropagation()
          navBarUsedRef.current = true
          setNavBarIndex(prev => {
            const len = bookmarksRef.current.length
            return prev >= len - 1 ? 0 : prev + 1
          })
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopImmediatePropagation()
          if (navBarTimerRef.current) { clearTimeout(navBarTimerRef.current); navBarTimerRef.current = null }
          setNavBarVisible(false)
          return
        }
      }

      // codegraph.open → open CodeGraph search and focus input
      if (eventMatchesBinding(e, bindings['codegraph.open'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        codeSearchActivatedRef.current = true
        setShowCodeSearch(true)
        setCodeSearchFocusTrigger(k => k + 1)
        return
      }

      // search.focus → focus search in right panel (md preview: route to in-page search)
      if (eventMatchesBinding(e, bindings['search.focus'])) {
        if (centerView === 'markdown') {
          e.preventDefault()
          e.stopImmediatePropagation()
          setMdSearchTrigger(k => k + 1)
        } else if (centerView !== 'diff') {
          e.preventDefault()
          e.stopImmediatePropagation()
          setSearchFocusTrigger(k => k + 1)
        }
      }

      // terminal.next / terminal.prev → blur right panel, switch session, focus terminal
      // Use visual order (grouped by cwd) instead of creation order
      const groups = new Map<string, TerminalSession[]>()
      for (const s of sessions) {
        const key = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(s)
      }
      const visualOrder = Array.from(groups.values()).flat()

      if (eventMatchesBinding(e, bindings['terminal.next'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ;(document.activeElement as HTMLElement)?.blur()
        const idx = visualOrder.findIndex(s => s.id === activeSessionId)
        const next = (idx + 1) % visualOrder.length
        if (visualOrder[next]) {
          const nextId = visualOrder[next].id
          const nextMode = sessionViewModesRef.current[nextId]
          setActiveSessionId(nextId)
          setCenterView('terminal')
          setDiffFile(null)
          setTimeout(() => {
            if (nextMode === 'gui') {
              aiTabRefs.current[nextId]?.focus()
            } else {
              terminalRefs.current[nextId]?.focus()
            }
          }, 0)
        }
      }
      if (eventMatchesBinding(e, bindings['terminal.prev'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ;(document.activeElement as HTMLElement)?.blur()
        const idx = visualOrder.findIndex(s => s.id === activeSessionId)
        const next = (idx - 1 + visualOrder.length) % visualOrder.length
        if (visualOrder[next]) {
          const nextId = visualOrder[next].id
          const nextMode = sessionViewModesRef.current[nextId]
          setActiveSessionId(nextId)
          setCenterView('terminal')
          setDiffFile(null)
          setTimeout(() => {
            if (nextMode === 'gui') {
              aiTabRefs.current[nextId]?.focus()
            } else {
              terminalRefs.current[nextId]?.focus()
            }
          }, 0)
        }
      }


      // session.clone → Ctrl+N clone current session
      if (eventMatchesBinding(e, bindings['session.clone'])) {
        if (activeSessionId) {
          e.preventDefault()
          e.stopImmediatePropagation()
          const current = sessions.find(s => s.id === activeSessionId)
          if (current) {
            handleCloneSession(current.id, current.cwd, current.shell)
          }
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
        } else if (centerView === 'diff' || centerView === 'markdown' || centerView === 'image') {
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

      // view.togglePreview — Ctrl+L: toggle diff/edit ↔ markdown preview
      if (eventMatchesBinding(e, bindings['view.togglePreview'])) {
        if (centerView === 'markdown' && markdownFile) {
          e.preventDefault()
          e.stopImmediatePropagation()
          const fp = markdownFile.fullPath
          let filePath = fp
          if (activeSessionCwd && fp.startsWith(activeSessionCwd)) {
            filePath = fp.slice(activeSessionCwd.length).replace(/^[\\\/]+/, '')
          }
          setDiffFile({
            filePath,
            fullPath: fp,
            diffContent: '',
            isStaged: false,
            defaultEdit: true,
            revision: ++diffRevisionRef.current
          })
          setCenterView('diff')
          setMarkdownFile(null)
          return
        } else if (centerView === 'diff' && diffFile) {
          if (isMarkdownFile(diffFile.fullPath)) {
            e.preventDefault()
            e.stopImmediatePropagation()
            const fileName = diffFile.fullPath.replace(/[\\/]/g, '/').split('/').pop() || diffFile.filePath
            setMarkdownFile({ fullPath: diffFile.fullPath, fileName })
            setCenterView('markdown')
            setDiffFile(null)
            return
          }
        }
      }

      // navigate.back / navigate.forward — show nav bar (commit on Alt release)
      if (!navBarVisibleRef.current && bookmarksRef.current.length > 0) {
        const isBack = eventMatchesBinding(e, bindings['navigate.back'])
        const isForward = eventMatchesBinding(e, bindings['navigate.forward'])
        if (isBack || isForward) {
          e.preventDefault()
          e.stopImmediatePropagation()
          if (navBarTimerRef.current) { clearTimeout(navBarTimerRef.current); navBarTimerRef.current = null }
          const delta = isBack ? -1 : 1
          const startIdx = navBarIndexRef.current + delta
          const hist = bookmarksRef.current
          if (startIdx >= 0 && startIdx < hist.length) {
            navBarCwdRef.current = sessionsRef.current.find(s => s.id === activeSessionId)?.cwd ?? null
            navBarVisibleRef.current = true
            navBarCancelledRef.current = false
            setNavBarIndex(startIdx)
            setNavBarVisible(true)
          }
          return
        }
      }

      // Escape priority: call graph → code search → explore result → focus return
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (callGraphFocalNodeRef.current) {
          e.preventDefault(); e.stopImmediatePropagation()
          setCallGraphFocalNode(null)
          return
        }
        if (showCodeSearchRef.current) {
          e.preventDefault(); e.stopImmediatePropagation()
          closeCodeSearch()
          return
        }
        if (exploreResultRef.current) {
          e.preventDefault(); e.stopImmediatePropagation()
          setExploreResult(null)
          return
        }
        const active = document.activeElement as HTMLElement | null
        if (active && rightPanelRef.current?.contains(active) && centerView === 'terminal') {
          const tag = active.tagName
          if (tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT') {
            e.preventDefault()
            e.stopImmediatePropagation()
            active.blur()
            if (activeSessionId) {
              const mode = sessionViewModesRef.current[activeSessionId]
              setTimeout(() => {
                if (mode === 'gui') {
                  aiTabRefs.current[activeSessionId]?.focus()
                } else {
                  terminalRefs.current[activeSessionId]?.focus()
                }
              }, 0)
            }
          }
        }
      }
    }
    // capture phase: intercept before xterm.js gets it
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [centerView, sessions, activeSessionId])

  // Alt keyup → commit nav bar selection
  React.useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') {
        if (navBarTimerRef.current) { clearTimeout(navBarTimerRef.current); navBarTimerRef.current = null }
        return
      }
      // Alt released: cancel pending timer (short tap should not trigger overlay)
      setAltBrush(false)
      if (navBarTimerRef.current) { clearTimeout(navBarTimerRef.current); navBarTimerRef.current = null }
      // Dismiss CodeGraphSearch on Alt release if not activated (clicked/focused)
      if (showCodeSearchRef.current && !codeSearchActivatedRef.current) {
        closeCodeSearch()
      }

      if (!navBarVisibleRef.current) return
      if (navBarCancelledRef.current) { setNavBarVisible(false); return }
      if (!navBarUsedRef.current) { setNavBarVisible(false); return }
      const idx = navBarIndexRef.current
      const hist = bookmarksRef.current
      if (idx >= 0 && idx < hist.length) {
        const entry = hist[idx]
        const cwd = navBarCwdRef.current
        let filePath = entry.fullPath
        if (cwd && entry.fullPath.startsWith(cwd)) {
          filePath = entry.fullPath.slice(cwd.length).replace(/^[\\\/]+/, '')
        }
        setDiffFile({
          filePath,
          fullPath: entry.fullPath,
          diffContent: '',
          isStaged: false,
          defaultEdit: true,
          lineNumber: entry.line,
          revision: ++diffRevisionRef.current
        })
        setCenterView('diff')
      }
      setNavBarVisible(false)
    }
    window.addEventListener('keyup', handleKeyUp)
    return () => window.removeEventListener('keyup', handleKeyUp)
  }, [])

  // NavBar click → navigate to file (same as Alt keyup commit)
  const handleNavBarSelect = useCallback((idx: number) => {
    if (navBarTimerRef.current) { clearTimeout(navBarTimerRef.current); navBarTimerRef.current = null }
    navBarVisibleRef.current = false
    setNavBarVisible(false)
    const hist = bookmarksRef.current
    if (idx >= 0 && idx < hist.length) {
      const entry = hist[idx]
      const cwd = navBarCwdRef.current
      let filePath = entry.fullPath
      if (cwd && entry.fullPath.startsWith(cwd)) {
        filePath = entry.fullPath.slice(cwd.length).replace(/^[\\\/]+/, '')
      }
      setDiffFile({
        filePath,
        fullPath: entry.fullPath,
        diffContent: '',
        isStaged: false,
        defaultEdit: true,
        lineNumber: entry.line,
        revision: ++diffRevisionRef.current
      })
      setCenterView('diff')
    }
  }, [])

  // 清除所有书签（NavBar 右上角 X）
  const handleClearBookmarks = useCallback(() => {
    if (navBarTimerRef.current) { clearTimeout(navBarTimerRef.current); navBarTimerRef.current = null }
    navBarVisibleRef.current = false
    setNavBarVisible(false)
    setBookmarks([])
  }, [])

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

  // Fork AI conversation at a specific user message
  const handleForkSession = useCallback(async (currentSessionId: string, userMessageIndex: number) => {
    try {
      const current = sessions.find(s => s.id === currentSessionId)
      if (!current) return

      // 1. Call fork IPC to create truncated JSONL with new session ID
      const result = await window.api.ai.fork({
        sessionId: currentSessionId,
        userMessageIndex,
        cwd: current.cwd,
      })
      if (!result.success || !result.newClaudeSessionId) {
        console.error('Fork failed:', result.error)
        return
      }

      // 2. Create new terminal session (same cwd)
      const session = await window.api.terminal.create({ cwd: current.cwd, autoUtf8 })

      // 3. Store fork resume ID for the new session
      setForkSessions(prev => ({ ...prev, [session.id]: result.newClaudeSessionId! }))

      // 4. Insert session right after the current one
      setSessions(prev => {
        const parentIndex = prev.findIndex(s => s.id === currentSessionId)
        if (parentIndex === -1) return [...prev, session]
        const next = [...prev]
        next.splice(parentIndex + 1, 0, session)
        return next
      })

      // 5. Switch to new session in gui mode — AiTab's auto-create will use resumeSessionId
      setActiveSessionId(session.id)
      setSessionViewModes(prev => ({ ...prev, [session.id]: 'gui' }))
      setCenterView('terminal')
      setDiffFile(null)
    } catch (err) {
      console.error('Failed to fork session:', err)
    }
  }, [sessions, autoUtf8])

  // Switch active session
  const handleSwitchSession = useCallback((id: string) => {
    setActiveSessionId(id)
    setCenterView('terminal')
    setDiffFile(null)
  }, [])

  // Execute a custom command — sends to AI input in GUI mode, terminal otherwise
  const handleExecuteCommand = useCallback((command: string) => {
    if (!activeSessionId) return
    const normalized = command.replace(/\r\n/g, '\n')
    const mode = sessionViewModes[activeSessionId]
    if (mode === 'gui') {
      aiTabRefs.current[activeSessionId]?.setValue(normalized)
      aiTabRefs.current[activeSessionId]?.focus()
    } else {
      window.api.terminal.write(activeSessionId, normalized.replace(/\n/g, '\r'))
      setCenterView('terminal')
      setDiffFile(null)
      setTimeout(() => terminalRefs.current[activeSessionId]?.focus(), 0)
    }
  }, [activeSessionId, sessionViewModes])

  // Clone with init: clone specific session and write command into the new clone
  const handleCloneWithInit = useCallback(async (sessionId: string, cwd: string, shell: string | undefined, command: string) => {
    try {
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8 })
      setSessions(prev => {
        const parentIndex = prev.findIndex(s => s.id === sessionId)
        if (parentIndex === -1) return [...prev, session]
        const next = [...prev]
        next.splice(parentIndex + 1, 0, session)
        return next
      })
      setActiveSessionId(session.id)
      setCenterView('terminal')
      setDiffFile(null)
      const normalized = command.replace(/\r\n/g, '\n')
      if (autoUtf8) {
        setTimeout(() => {
          window.api.terminal.write(session.id, normalized.replace(/\n/g, '\r'))
        }, 600)
      } else {
        window.api.terminal.write(session.id, normalized.replace(/\n/g, '\r'))
      }
    } catch (err) {
      console.error('Failed to clone with init:', err)
    }
  }, [autoUtf8])

  // Init command: clone active session and write command into the new clone
  const handleInitCommand = useCallback(async (command: string) => {
    const activeSession = sessions.find(s => s.id === activeSessionId)
    if (!activeSession) return
    try {
      const session = await window.api.terminal.create({
        cwd: activeSession.cwd,
        shell: activeSession.shell,
        autoUtf8
      })
      setSessions(prev => {
        const parentIndex = prev.findIndex(s => s.id === activeSessionId)
        if (parentIndex === -1) return [...prev, session]
        const next = [...prev]
        next.splice(parentIndex + 1, 0, session)
        return next
      })
      setActiveSessionId(session.id)
      setCenterView('terminal')
      setDiffFile(null)
      const normalized = command.replace(/\r\n/g, '\n')
      if (autoUtf8) {
        setTimeout(() => {
          window.api.terminal.write(session.id, normalized.replace(/\n/g, '\r'))
        }, 600)
      } else {
        window.api.terminal.write(session.id, normalized.replace(/\n/g, '\r'))
      }
    } catch (err) {
      console.error('Failed to init session:', err)
    }
  }, [activeSessionId, sessions, autoUtf8])

  // Close a terminal session
  const handleCloseSession = useCallback(async (id: string) => {
    await window.api.terminal.close(id)
    // 清理 terminalRefs / aiTabRefs 中已关闭 session 的 handle 引用
    delete terminalRefs.current[id]
    delete aiTabRefs.current[id]
    setSessions(prev => prev.filter(s => s.id !== id))
    // 清理该 session 的命令历史和 agent 状态
    setCommandHistory(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setTerminalBusy(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setAiBusy(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setForkSessions(prev => {
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
    // 清理该 session 的 AI 子进程
    window.api.ai.destroy(id)
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

  const handleReorderGroup = useCallback((fromGroupIdx: number, toGroupIdx: number) => {
    setSessions(prev => {
      const map = new Map<string, TerminalSession[]>()
      const order: string[] = []
      for (const s of prev) {
        const key = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
        if (!map.has(key)) { map.set(key, []); order.push(key) }
        map.get(key)!.push(s)
      }
      const groups = order.map(cwd => ({ cwd, sessions: map.get(cwd)! }))
      const [moved] = groups.splice(fromGroupIdx, 1)
      groups.splice(toGroupIdx, 0, moved)
      return groups.flatMap(g => g.sessions)
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

  const handleBackToTerminal = useCallback((selection?: { startLine: number; endLine: number }) => {
    // 如果有选区且用户开启了 esc-auto-at，注入 @filepath:startLine:endLine 到终端
    if (escAutoAtRef.current && selection && diffFile && activeSessionId) {
      let relPath = diffFile.fullPath
      if (activeSessionCwd && relPath.startsWith(activeSessionCwd)) {
        relPath = relPath.slice(activeSessionCwd.length).replace(/^[\\\/]+/, '')
      }
      relPath = relPath.replace(/\\/g, '/')
      window.api.terminal.write(activeSessionId, `@${relPath}:${selection.startLine} `)
    }
    setCenterView('terminal')
    setDiffFile(null)
    setCurrentFileContent('')
  }, [diffFile, activeSessionId, activeSessionCwd])

  const handleRefreshGit = useCallback(async () => {
    setGitRefreshKey(k => k + 1)
  }, [])

  const handleOutlineNavigate = useCallback((line: number, headingName?: string) => {
    if (centerView === 'diff' && diffFile) {
      setDiffFile(prev => prev ? { ...prev, lineNumber: line } : prev)
      setOutlineScrollTrigger(prev => prev + 1) // force lineNumber effect re-fire
    }
    if (centerView === 'markdown' && headingName) {
      setMdScrollHeading(headingName)
    }
  }, [centerView, diffFile])

  const [mdScrollHeading, setMdScrollHeading] = useState<string | undefined>(undefined)
  const [outlineScrollTrigger, setOutlineScrollTrigger] = useState(0)

  // 处理从中间终端点击文件路径打开文件
  const handleOpenFileFromTerminal = useCallback((fullPath: string, lineNumber?: number) => {
    recordRecentFile(fullPath, lineNumber)
    let filePath = fullPath
    if (activeSessionCwd && fullPath.startsWith(activeSessionCwd)) {
      filePath = fullPath.slice(activeSessionCwd.length).replace(/^[\\\/]+/, '')
    }
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
  }, [activeSessionCwd])

  // 处理从右侧终端点击文件路径打开文件 - 直接切换到 edit 模式
  const handleOpenFileFromRightTerminal = useCallback((fullPath: string, lineNumber?: number) => {
    recordRecentFile(fullPath, lineNumber)
    const rightCwd = activeSessionCwd
    let filePath = fullPath
    if (rightCwd && fullPath.startsWith(rightCwd)) {
      filePath = fullPath.slice(rightCwd.length).replace(/^[\\\/]+/, '')
    }
    setDiffFile({
      filePath,
      fullPath,
      diffContent: '',
      isStaged: false,
      lineNumber,
      revision: ++diffRevisionRef.current
    })
    setCenterView('diff')
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
  const isMarkdownFile = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    return ['md', 'mdx', 'markdown'].includes(ext)
  }

  const handleOpenFileFromSearch = useCallback((fullPath: string, lineNumber?: number) => {
    recordRecentFile(fullPath, lineNumber)
    if (isMarkdownFile(fullPath)) {
      setMarkdownFile({ fullPath, fileName: fullPath.split(/[\\/]/).pop() || fullPath })
      setCenterView('markdown')
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
  }, [activeSessionCwd])

  // 搜索结果点击打开：即使 md 也默认进编辑模式（defaultEdit），区别于
  // 最近文件 / AI 链接 / callgraph（走 handleOpenFileFromSearch 的 md 预览）。
  // 想看渲染预览可按 Ctrl+L（view.togglePreview：diff(md) ↔ markdown）。
  const handleOpenSearchResult = useCallback((fullPath: string, lineNumber?: number) => {
    recordRecentFile(fullPath, lineNumber)
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
  }, [activeSessionCwd])

  // 处理从「最近文件」栏点击打开文件 — 复用 search 打开逻辑（含 markdown 预览 + 行号定位 + 记录）
  const handleOpenRecentFile = useCallback((fullPath: string, lineNumber?: number) => {
    handleOpenFileFromSearch(fullPath, lineNumber)
  }, [handleOpenFileFromSearch])

  // 处理从文件浏览器打开文件 — 默认 edit 模式（铅笔入口可带行号定位）
  const handleOpenFileFromExplorer = useCallback((fullPath: string, lineNumber?: number) => {
    recordRecentFile(fullPath, lineNumber)
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
  }, [activeSessionCwd])

  const handleCompareWithCurrent = useCallback(async (compareFullPath: string) => {
    if (!diffFile?.defaultEdit) return
    const [compareResult] = await Promise.all([
      window.api.file.read(compareFullPath)
    ])
    const compareContent = compareResult.error ? '' : (compareResult.content || '')
    setDiffFile(prev => prev ? {
      ...prev,
      defaultEdit: false,
      diffContent: '',
      compareOriginalContent: compareContent,
      compareOriginalPath: compareFullPath,
      revision: ++diffRevisionRef.current
    } : null)
  }, [diffFile])

  const handleSwitchViewMode = useCallback((sessionId: string, mode: 'term' | 'gui') => {
    setSessionViewModes(prev => ({ ...prev, [sessionId]: mode }))
    if (activeSessionId !== sessionId) {
      handleSwitchSession(sessionId)
    }
  }, [activeSessionId, handleSwitchSession])

  const handlePreviewMarkdown = useCallback((fullPath: string, fileName: string) => {
    setMarkdownFile({ fullPath, fileName })
    setCenterView('markdown')
  }, [])

  const handleBackFromMarkdown = useCallback(() => {
    setCenterView('terminal')
    setMarkdownFile(null)
  }, [])

  const handlePreviewImage = useCallback((fullPath: string, fileName: string) => {
    setImageFile({ fullPath, fileName })
    setCenterView('image')
  }, [])

  const handleBackFromImage = useCallback(() => {
    setCenterView('terminal')
    setImageFile(null)
  }, [])

  const isWelcome = sessions.length === 0

  return (
    <div className="h-full w-full flex flex-col bg-ide-bg">
      {/* Title Bar */}
      <div className="titlebar-drag h-9 bg-ide-sidebar border-b border-ide-border flex items-center px-4 select-none shrink-0">
        <span className="w-[18px] h-[18px] mr-1.5 shrink-0 -ml-1 flex items-center justify-center rounded bg-ide-accent/40 text-[11px] leading-none">🤔</span>
        <span className="text-ide-text-muted text-sm font-medium tracking-wide">Vibe IDE</span>
        <div className="flex-1" />
        <button
          className="no-drag w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
          style={{ marginRight: 134 }}
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
        {/* Left Panel: Session + Outline */}
        <div className="shrink-0 flex flex-col relative" style={{ width: leftPanelWidth, display: isWelcome ? 'none' : undefined }}>
          {/* SessionPanel: always full height */}
          <div className="flex-1 overflow-hidden">
            <SessionPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              onCreateSession={handleCreateSession}
            onCloneSession={handleCloneSession}
            onSwitchSession={handleSwitchSession}
            onCloseSession={handleCloseSession}
            onRenameSession={handleRenameSession}
            onReorderSessions={handleReorderSessions}
            onReorderGroup={handleReorderGroup}
            commandHistory={commandHistory}
            agentStatus={agentStatus}
            autoApproveSessions={autoApproveSessions}
            onToggleAutoApprove={handleToggleAutoApprove}
            pollingEnabled={pollingEnabled}
            onTogglePolling={(v) => { setPollingEnabled(v); try { localStorage.setItem('vibe-ide-polling', v ? '1' : '0') } catch {} }}
            wordWrap={wordWrap}
            onToggleWordWrap={setWordWrap}
            autoUtf8={autoUtf8}
            onToggleAutoUtf8={setAutoUtf8}
            cgEnabled={cgEnabled}
            onToggleCgEnabled={setCgEnabled}
            ocrEnabled={ocrEnabled}
            onToggleOcrEnabled={setOcrEnabled}
            inlineDiff={inlineDiff}
            onToggleInlineDiff={setInlineDiff}
            capsuleTabs={capsuleTabs}
            onToggleCapsuleTabs={setCapsuleTabs}
            groupSessionsByCwd={groupSessionsByCwd}
            onToggleGroupSessionsByCwd={setGroupSessionsByCwd}
            escAutoAt={escAutoAt}
            onToggleEscAutoAt={setEscAutoAt}
            terminalFontSize={terminalFontSize}
            editorFontSize={editorFontSize}
            onAdjustTerminalFontSize={(delta: number) => setTerminalFontSize(prev => Math.max(8, Math.min(30, prev + delta)))}
            onAdjustEditorFontSize={(delta: number) => setEditorFontSize(prev => Math.max(8, Math.min(30, prev + delta)))}
            fontFamily={sessionFontFamily}
            onSetFontFamily={setSessionFontFamily}
            uiFontFamily={fontFamily}
            onSetUiFontFamily={setFontFamily}
            termFontFamily={termFontFamily}
            onSetTermFontFamily={setTermFontFamily}
            onResetUiStyle={() => {
              setTerminalFontSize(14)
              setEditorFontSize(14)
              setCapsuleTabs(true)
              setGroupSessionsByCwd(true)
              setInlineDiff(false)
              setSessionFontFamily('Consolas')
              setFontFamily('Cascadia Code')
              setTermFontFamily('Cascadia Code')
            }}
            fileTreeDepth={fileTreeDepth}
            onChangeFileTreeDepth={handleFileTreeDepthChange}
            focusSettingsTrigger={focusSettingsTrigger}
            onExecuteCommand={handleExecuteCommand}
            onInitCommand={handleInitCommand}
            onCloneWithInit={handleCloneWithInit}
            sessionViewModes={sessionViewModes}
            onSwitchViewMode={handleSwitchViewMode}
          />
          </div>
          {/* Outline: overlay covering entire left panel below title bar */}
          {centerView === 'diff' && diffFile && (isCode(diffFile.fullPath) || isMarkdown(diffFile.fullPath)) && (
            <div className="absolute left-2 right-2 bottom-2 border border-ide-border rounded-lg overflow-hidden z-10 bg-ide-sidebar" style={{ top: 44 }}>
              <OutlinePanel
                key={diffFile.fullPath}
                filePath={diffFile.filePath}
                fullPath={diffFile.fullPath}
                content={currentFileContent}
                hasExternalProvider={true}
                onNavigate={handleOutlineNavigate}
              />
            </div>
          )}
          {centerView === 'markdown' && markdownFile && isMarkdown(markdownFile.fullPath) && (
            <div className="absolute left-2 right-2 bottom-2 border border-ide-border rounded-lg overflow-hidden z-10 bg-ide-sidebar" style={{ top: 44 }}>
              <OutlinePanel
                key={markdownFile.fullPath}
                filePath={markdownFile.fileName}
                fullPath={markdownFile.fullPath}
                onNavigate={handleOutlineNavigate}
              />
            </div>
          )}
        </div>

        {/* Left Panel Resize Handle */}
        {!isWelcome && (
        <div
          className="w-1 hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
          onMouseDown={handleLeftResizeStart}
        />
        )}

        {/* Center Panel: Terminal or Diff — all three blocks always mounted, toggled via display */}
        <div className="flex-1 flex flex-col overflow-hidden bg-ide-bg focus-frame relative"
          ref={centerPanelRef}
          data-focused={focusedPanel === 'term' ? 'true' : undefined}
          onFocus={handleCenterFocus}
          onBlur={handleCenterBlur}>
          {/* Diff */}
          {centerView === 'diff' && diffFile && (
            <div className="flex-1 mx-1 mb-1.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col">
              <DiffViewer
                key={`${diffFile.fullPath}-${diffFile.commitHash || 'working'}`}
                filePath={diffFile.filePath}
                fullPath={diffFile.fullPath}
                diffContent={diffFile.diffContent}
                isStaged={diffFile.isStaged}
                commitHash={diffFile.commitHash}
                lineNumber={diffFile.lineNumber}
                revision={diffFile.revision}
                onBack={handleBackToTerminal}
                onSaved={handleRefreshGit}
                defaultEdit={diffFile.defaultEdit}
                fontSize={editorFontSize}
                wordWrap={wordWrap}
                inlineDiff={inlineDiff}
                scrollTrigger={diffScrollTrigger}
                cursorRef={cursorRef}
                visibleLineRef={visibleLineRef}
                onContentLoaded={setCurrentFileContent}
                onOpenCallGraph={handleOpenCallGraphFromEditor}
                onViewLineHistory={handleViewLineHistory}
                compareOriginalContent={diffFile.compareOriginalContent}
                compareOriginalPath={diffFile.compareOriginalPath}
                bookmarks={currentFileBookmarks}
                onToggleBookmark={(line) => toggleBookmark(diffFile.fullPath, line)}
                altBrush={altBrush}
              />
            </div>
          )}
          {/* Markdown Preview */}
          {centerView === 'markdown' && markdownFile && (
            <div className="flex-1 mx-1 mb-1.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col">
              <MarkdownPreview
                key={markdownFile.fullPath}
                fullPath={markdownFile.fullPath}
                fileName={markdownFile.fileName}
                onBack={handleBackFromMarkdown}
                scrollToHeading={mdScrollHeading}
                searchTrigger={mdSearchTrigger}
              />
            </div>
          )}
          {/* Image Preview */}
          {centerView === 'image' && imageFile && (
            <div className="flex-1 mx-1 mb-1.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col">
              <ImagePreview
                key={imageFile.fullPath}
                fullPath={imageFile.fullPath}
                fileName={imageFile.fileName}
                onBack={handleBackFromImage}
              />
            </div>
          )}
          {/* Welcome screen — shown when no sessions exist */}
          {centerView === 'terminal' && sessions.length === 0 && (
            <WelcomeScreen
              onOpenFolder={() => handleCreateSession()}
              onOpenPath={(path) => handleCreateSessionAt(path)}
            />
          )}
          {/* Terminal sessions / AI GUI mode */}
          <div className="flex-1 mx-1 mb-1.5 mt-0.5 border-2 border-ide-border rounded-lg overflow-hidden flex flex-col" style={{ display: centerView === 'terminal' && sessions.length > 0 ? 'flex' : 'none' }}>
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-ide-text-muted">Loading...</div>}>
              {sessions.map(session => {
                const isGui = sessionViewModes[session.id] === 'gui'
                return (
                  <div
                    key={session.id}
                    className="flex-1 flex flex-col overflow-hidden"
                    style={{ display: session.id === activeSessionId ? 'flex' : 'none' }}
                  >
                    {isGui ? (
                      <AiTab
                        ref={(node) => { if (node) aiTabRefs.current[session.id] = node }}
                        activeSessionId={session.id}
                        workspacePath={session.cwd}
                        isActive={session.id === activeSessionId}
                        autoApprove={autoApproveSessions[session.id] ?? false}
                        permissionMode={aiPermissionModes[session.id] ?? 'bypassPermissions'}
                        onPermissionModeChange={(mode: AiPermissionMode) => {
                          setAiPermissionModes(prev => ({ ...prev, [session.id]: mode }))
                          // Push to subprocess so the actual --permission-mode reflects UI state.
                          // Without this, subprocess keeps the spawn-time mode and UI lies.
                          window.api.ai.setPermissionMode(session.id, mode)
                        }}
                        onViewAi={() => {
                          setSessionViewModes(prev => ({ ...prev, [session.id]: 'gui' }))
                        }}
                        onOpenFile={handleOpenFileFromSearch}
                        onRenameSession={async (name: string) => {
                          if (manuallyRenamedRef.current.has(session.id)) return
                          const result = await window.api.terminal.rename(session.id, name)
                          if (result.success && result.session) {
                            setSessions(prev => prev.map(s => s.id === session.id ? result.session! : s))
                          }
                        }}
                        resumeSessionId={forkSessions[session.id]}
                        onForkSession={(userMessageIndex: number) => {
                          handleForkSession(session.id, userMessageIndex)
                        }}
                        onAgentStatusChange={handleAiAgentStatusChange}
                      />
                    ) : (
                      <TerminalView ref={(node) => { if (node) terminalRefs.current[session.id] = node }} sessionId={session.id} sessionName={session.name} sessionCwd={session.cwd} onOpenFile={handleOpenFileFromTerminal} onCommand={onCommandForSession(session.id)} showHeader={false} fontSize={terminalFontSize} fontFamily={termFontFamily} isActive={session.id === activeSessionId} ocrEnabled={ocrEnabled} newlineShortcut={getShortcuts()['terminal.newline']} pageDownShortcut={getShortcuts()['terminal.pageDown']} pageUpShortcut={getShortcuts()['terminal.pageUp']} onAgentStatusChange={handleAgentStatusChange} onOscTitle={handleOscTitleChange} />
                    )}
                  </div>
                )
              })}
            </Suspense>
          </div>
          {/* Drag-over overlay for file compare */}
          {isDragOverEdit && (
            <div className="absolute inset-0 z-50 bg-ide-accent/20 border-2 border-dashed border-ide-accent rounded-lg flex items-center justify-center pointer-events-none">
              <div className="bg-ide-sidebar border border-ide-border rounded-xl px-6 py-4 shadow-2xl">
                <span className="text-sm text-ide-text font-medium">Drop file to compare</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel Resize Handle */}
        {!rightPanelCollapsed && !isWelcome && (
          <div
            className="w-1 hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
            onMouseDown={handleRightResizeStart}
          />
        )}

        {/* Right Panel */}
        {rightPanelCollapsed || isWelcome ? null : (
        <div ref={rightPanelRef}
          className="shrink-0 flex flex-col overflow-hidden focus-frame"
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
            onOpenFileFromSearch={handleOpenSearchResult}
            onOpenFileFromExplorer={handleOpenFileFromExplorer}
            recentFiles={recentFiles}
            onOpenRecentFile={handleOpenRecentFile}
            onRemoveRecentFile={removeRecentFile}
            onEditRecentFile={handleOpenFileFromExplorer}
            onCompareWithCurrent={handleCompareWithCurrent}
            currentEditFilePath={diffFile?.defaultEdit ? diffFile.fullPath : null}
            onPreviewMarkdown={handlePreviewMarkdown}
            onPreviewImage={handlePreviewImage}
            rightTerminalSession={activeSessionId ? rightTerminalSessions[activeSessionId] : undefined}
            onCreateRightTerminal={handleCreateRightTerminal}
            onCloseRightTerminal={handleCloseRightTerminal}
            searchFocusTrigger={searchFocusTrigger}
            navigateToFilePayload={navigateToFilePayload}
            onNavigateToFile={handleNavigateToFile}
            onExploreNode={(node) => setCallGraphFocalNode(node)}
            lineHistoryPayload={lineHistoryPayload}

            fileTreeDepth={fileTreeDepth}
            onDiffScroll={handleDiffScroll}
            onToggleCollapse={handleToggleRightPanel}
            capsuleTabs={capsuleTabs}
            onToggleCapsuleTabs={() => setCapsuleTabs(v => !v)}
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

      {/* Nav Bar — 书签列表，Alt+←/→ 切换并跳转 */}
      <NavBar
        entries={bookmarks}
        selectedIndex={navBarIndex}
        visible={navBarVisible}
        onSelect={handleNavBarSelect}
        onClearAll={handleClearBookmarks}
      />

      {/* Call Graph Overlay — rendered at App level like NavBar to stay on top */}
      {callGraphFocalNode && (
        <CallGraphOverlay
          focalNode={callGraphFocalNode}
          onClose={() => setCallGraphFocalNode(null)}
          onJumpToFile={(filePath, line) => {
            const cwd = activeSessionCwd
            if (!cwd) return
            const sep = cwd.includes('\\') ? '\\' : '/'
            const absPath = filePath.startsWith('/') || filePath.includes(':')
              ? filePath
              : cwd + sep + filePath.replace(/\//g, sep)
            handleOpenFileFromSearch(absPath, line)
          }}
        />
      )}

      {/* CodeGraph Search — Alt-triggered center overlay */}
      {showCodeSearch && (
        <CodeGraphSearch
          workspacePath={activeSessionCwd}
          onClose={closeCodeSearch}
          onSelectNode={(node) => setCallGraphFocalNode(node)}
          onJumpTo={(node) => {
            const cwd = activeSessionCwd
            if (!cwd) return
            const sep = cwd.includes('\\') ? '\\' : '/'
            const filePath = node.filePath
            const absPath = filePath.startsWith('/') || filePath.includes(':')
              ? filePath
              : cwd + sep + filePath.replace(/\//g, sep)
            handleOpenFileFromSearch(absPath, node.line)
          }}
          onActivated={() => { codeSearchActivatedRef.current = true }}
          onExploreResult={(result) => { setExploreResult(result); closeCodeSearch() }}
          focusTrigger={codeSearchFocusTrigger}
        />
      )}
      {/* CodeGraph Explore Result — MD-rendered popup */}
      {exploreResult && (
        <CodeGraphExploreResult
          query={exploreResult.query}
          content={exploreResult.content}
          onClose={() => setExploreResult(null)}
        />
      )}
    </div>
  )

  }