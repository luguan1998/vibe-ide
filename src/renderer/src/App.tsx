
import React, { useState, useCallback, useMemo, lazy, Suspense, useRef, useEffect } from 'react'
import SessionPanel, { type SessionPanelHandle } from './components/SessionPanel'
import RightPanel from './components/RightPanel'
import DiffViewer from './components/DiffViewer'
import MarkdownPreview, { MD_SEARCH_OPEN } from './components/MarkdownPreview'
import ImagePreview from './components/ImagePreview'
import BrowserView, { BrowserViewHandle } from './components/BrowserView'
import { isCode, isMarkdown } from './components/OutlinePanel'
import NavBar, { NavEntry } from './components/NavBar'
import WelcomeScreen from './components/WelcomeScreen'
import CallGraphOverlay from './components/CallGraphOverlay'
import { DesktopPet, type PetLogicalState } from './components/DesktopPet'
import SearchPanel from './components/SearchPanel'
import { ModalOverlay } from './components/ModalOverlay'
import QuickOpen from './components/QuickOpen'
import AiTab, { AiTabHandle } from './components/AiTab'
import GameMujica, { FOCUS_MUJICA, MUJICA_CLOSE } from './components/GameMujica'
import { mujicaStore, useMujica } from './mujicaStore'
import { aiStore, readAiCliConfig } from './aiStore'
import { CodeGraphSearch } from './components/CodeGraphSearch'
import { CodeGraphExploreResult } from './components/CodeGraphExploreResult'
import { getFileInfo, FILE_ICON_PATHS } from './components/FileIcons'
import iconPattern from '@renderer/assets/icon-pattern.png?inline'
import iconBgMask from '@renderer/assets/icon-bg-mask.png?inline'
import { ADD_ANNOTATION_EVENT, toRelPath } from './components/vibeEvents'
import { TerminalSession, AuxTerminalTab, RenameTerminalResult, AiPermissionMode, RecentFileEntry } from '@shared/types'
import { getShortcuts, eventMatchesBinding, eventIsModifierPress, parseKeybinding } from './shortcuts'
import { useI18n } from './i18n'
import type { TerminalViewHandle } from './components/TerminalView'
import { getMainShellType, getAuxShellType } from './utils/shellPrefs'

const TerminalView = lazy(() => import('./components/TerminalView'))

// Declare the window API type
declare global {
  interface Window {
    api: {
      terminal: {
        rename(id: string, newName: string): Promise<RenameTerminalResult>
        create: (options?: { cwd?: string; name?: string; shell?: string; autoUtf8?: boolean; initCommand?: string }) => Promise<TerminalSession>
        getShells: () => Promise<{ value: string; label: string }[]>
        refreshEnv: () => Promise<{ success: boolean; count?: number; error?: string }>
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
        amend: (options: any) => Promise<any>
        branches: () => Promise<any>
        checkout: (branch: string) => Promise<any>
        applyBranch: (branch: string) => Promise<any>
        discard: (filePath: string) => Promise<any>
        stashList: () => Promise<any>
        stashPush: (message?: string) => Promise<any>
        stashPop: () => Promise<any>
        stashDrop: () => Promise<any>
        push: (remote?: string, branch?: string, force?: boolean) => Promise<any>
        remoteBranches: () => Promise<any>
        init: () => Promise<any>
        show: (hash: string) => Promise<any>
        showFile: (ref: string, filePath: string) => Promise<any>
        getWorktreePath: (branch: string) => Promise<any>
        applyBranchRetry: (branch: string) => Promise<any>
        deleteWorktree: (branch: string, force?: boolean) => Promise<any>
        deleteBranch: (branch: string) => Promise<any>
        setFilterRules: (rules: string[]) => Promise<any>
        diffCommitFile: (hash: string, filePath: string, isRoot: boolean) => Promise<any>
        lineLog: (filePath: string, startLine: number, endLine: number) => Promise<any>
        graph: (opts?: { count?: number; skip?: number }) => Promise<any>
      }
      file: {
        read: (filePath: string) => Promise<any>
        write: (filePath: string, content: string) => Promise<any>
        readWithEncoding: (filePath: string, encoding?: string, forceOpen?: boolean) => Promise<{ content: string; encoding: string; bom: boolean; confidence: number; error?: string }>
        writeWithEncoding: (filePath: string, content: string, encoding?: string) => Promise<{ success: boolean; error?: string }>
        list: (dirPath: string) => Promise<any>
        getPathForFile: (file: File) => string
        tree: (dirPath: string, depth?: number, skipPatterns?: string[]) => Promise<any>
        delete: (filePath: string) => Promise<any>
        rename: (oldPath: string, newPath: string) => Promise<any>
        createDir: (dirPath: string) => Promise<any>
        openExplorer: (filePath: string) => Promise<any>
        copy: (srcPath: string, destPath: string) => Promise<any>
        move: (srcPath: string, destPath: string) => Promise<any>
        find: (cwd: string, filename: string, skipPatterns?: string[]) => Promise<any>
        searchByName: (cwd: string, query: string, skipPatterns?: string[], nameOnly?: boolean) => Promise<any>
        onChanged: (callback: () => void) => any
        removeChangedListener: (handler?: any) => void
      }
      claudeConfig: {
        dir: () => Promise<string>
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
        create: (options: { sessionId: string; cwd: string; autoApprove?: boolean; permissionMode?: string; resumeSessionId?: string; cliCommand?: string; configDir?: string; model?: string; enableWorktree?: boolean }) => Promise<{ success: boolean; error?: string }>
        send: (sessionId: string, message: string) => Promise<{ success: boolean; error?: string }>
        cancel: (sessionId: string) => Promise<boolean>
        forceStop: (sessionId: string) => Promise<{ success: boolean; error?: string }>
        destroy: (sessionId: string) => Promise<boolean>
        respondPermission: (sessionId: string, requestId: string, approved: boolean, tool?: string, toolInput?: Record<string, any>, feedback?: string) => Promise<{ success: boolean }>
        clearAndExecutePlan: (sessionId: string, planFilePath: string, model?: string, resume?: boolean) => Promise<{ success: boolean; error?: string }>
        listUserTurns: (sessionId: string, cwd: string) => Promise<any>
        setPermissionMode: (sessionId: string, mode: string) => Promise<{ success: boolean; error?: string }>
        setModel: (sessionId: string, model: string) => Promise<{ success: boolean; error?: string }>
        setVisible: (visible: boolean) => Promise<void>
        onModelChanged: (callback: (data: { sessionId: string; model: string }) => void) => any
        removeModelChangedListener: (handler?: any) => void
        askResume: (sessionId: string, answers: Record<string, string>) => Promise<{ success: boolean; error?: string }>
        resolveConfigDir: (configDir?: string) => Promise<string>
        listSessions: (cwd?: string, configDir?: string) => Promise<{ sessions: any[]; error?: string }>
        deleteSession: (sessionId: string, cwd: string, configDir?: string) => Promise<{ success: boolean; error?: string }>
        loadSessionMessages: (resumeSessionId: string, cwd: string, configDir?: string) => Promise<{ messages: any[]; model?: string; slashCommands?: any[]; error?: string }>
        listAllSessions: (configDir?: string, currentCwd?: string) => Promise<{ sessions: import('@shared/types').AiSessionSummary[]; total?: number }>
        searchSessions: (query: string, opts?: import('@shared/types').AiSearchOptions) => Promise<{ sessions: import('@shared/types').AiSessionSearchGroup[]; truncated?: boolean }>
        loadSessionMessagesByDir: (resumeSessionId: string, projectDir: string, configDir?: string) => Promise<{ messages: any[]; model?: string; slashCommands?: any[]; error?: string }>
        deleteSessionByDir: (sessionId: string, projectDir: string, configDir?: string) => Promise<{ success: boolean; error?: string }>
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
        watchReplies: (sessionId: string, cwd: string, configDir?: string) => Promise<import('@shared/types').AiReply | null>
        stopReplyWatch: (sessionId: string) => Promise<boolean>
        onReply: (callback: (data: import('@shared/types').AiReply) => void) => any
        removeReplyListener: (handler?: any) => void
      }
      snippets: {
        load: () => Promise<import('@shared/types').SnippetsLoadResult>
        toggle: (filename: string, enabled: boolean) => Promise<import('@shared/types').SnippetsLoadResult>
      }
      pet: {
        list: () => Promise<import('@shared/types').PetListResult>
        setActive: (id: string) => Promise<import('@shared/types').PetListResult>
        delete: (id: string) => Promise<import('@shared/types').PetListResult>
        onChanged: (callback: () => void) => any
        removeChangedListener: (handler?: any) => void
      }
    }
  }
}

type CenterView = 'terminal' | 'diff' | 'markdown' | 'image' | 'browser' | 'mujica' | 'search'

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

function readDefaultAgent(): string {
  try { return localStorage.getItem('vibe-ide-default-agent') || '' } catch { return '' }
}

function HistoryCopyButton({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <button
      className="shrink-0 text-ide-text-muted/40 hover:text-ide-text transition-colors"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(cmd).then(() => {
          setCopied(true)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setCopied(false), 1500)
        })
      }}
      title="Copy"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5 text-ide-success">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
          <path fillRule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6ZM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2Z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  )
}

export default function App() {
  const { t } = useI18n()
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [rightTerminalSessions, setRightTerminalSessions] = useState<Record<string, AuxTerminalTab[]>>({})  // 每个 session 独立的 aux terminal tabs（每 tab 含 1-3 个 terminal）
  const [activeAuxIndex, setActiveAuxIndex] = useState<Record<string, number>>({})  // 每个 session 当前 active 的 aux terminal 下标
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
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const quickOpenOpenRef = useRef(false)
  const openQuickOpen = useCallback((v: boolean) => {
    quickOpenOpenRef.current = v
    setQuickOpenOpen(v)
  }, [])
  const closeQuickOpen = useCallback(() => {
    quickOpenOpenRef.current = false
    setQuickOpenOpen(false)
  }, [])
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
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)

  const showCodeSearchRef = useRef(false); showCodeSearchRef.current = showCodeSearch
  const showSearchDropdownRef = useRef(false); showSearchDropdownRef.current = showSearchDropdown
  const exploreResultRef = useRef(exploreResult); exploreResultRef.current = exploreResult
  const closeCodeSearch = useCallback(() => {
    setShowCodeSearch(false)
    setCodeSearchFocusTrigger(0)
  }, [])
  const [navigateToFilePayload, setNavigateToFilePayload] = useState<{ trigger: number; filePath: string } | null>(null)

  // ── Recently opened files (in-memory only, not persisted) ──
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([])
  const [lastOpenedFile, setLastOpenedFile] = useState<RecentFileEntry | null>(null)

  const recordRecentFile = useCallback((fullPath: string, lineNumber?: number, endLineNumber?: number) => {
    if (!fullPath) return
    const line = typeof lineNumber === 'number' && lineNumber > 0 ? lineNumber : undefined
    const endLine = typeof endLineNumber === 'number' && endLineNumber > 0 ? endLineNumber : undefined
    const entry = { path: fullPath, line, endLine }
    setLastOpenedFile(entry)
    const norm = (p: string) => p.replace(/\\/g, '/')
    const target = norm(fullPath)
    setRecentFiles(prev => {
      const existingIdx = prev.findIndex(r => norm(r.path) === target)
      if (existingIdx >= 0) {
        const existing = prev[existingIdx]
        const mergedLine = line ?? existing.line
        const mergedEndLine = endLine ?? existing.endLine
        if (existing.line === mergedLine && existing.endLine === mergedEndLine) return prev
        return prev.map((r, i) => i === existingIdx ? { ...r, line: mergedLine, endLine: mergedEndLine } : r)
      }
      return [{ path: fullPath, line, endLine }, ...prev].slice(0, 7)
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
  const [clearAuxBufferTrigger, setClearAuxBufferTrigger] = useState<{ sid: string; n: number }>({ sid: '', n: 0 })
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
  const [pipeRunning, setPipeRunning] = useState<Record<string, boolean>>({})
  const [pipeProgress, setPipeProgress] = useState<Record<string, { current: number; total: number }>>({})
  const pipeRunnersRef = useRef<Map<string, { cancelled: boolean; resolveIdle: (() => void) | null; sleepTimer: ReturnType<typeof setTimeout> | null; sleepResolve: (() => void) | null }>>(new Map())
  const pipeQueueRef = useRef<Map<string, string[]>>(new Map())
  const pipeProcessingRef = useRef<Map<string, boolean>>(new Map())
  const terminalBusyRef = useRef<Record<string, boolean>>({})
  const aiBusyRef = useRef<Record<string, boolean>>({})
  const [warnSessions, setWarnSessions] = useState<Record<string, boolean>>({})
  const warnSessionsRef = useRef<Record<string, boolean>>({})
  warnSessionsRef.current = warnSessions
  const prevBusyRef = useRef<Record<string, boolean>>({})
  // 整个 app 是否聚焦（window blur / 最小化 → false），用于宠物 unfocused 状态
  const [appFocused, setAppFocused] = useState(() => (typeof document !== 'undefined' ? document.hasFocus() : true))
  const agentStatus = useMemo(() => {
    const result: Record<string, 'running' | 'idle' | 'warn'> = {}
    for (const s of sessions) {
      const busy = terminalBusy[s.id] || aiBusy[s.id]
      result[s.id] = busy ? 'running' : (warnSessions[s.id] ? 'warn' : 'idle')
    }
    return result
  }, [sessions, terminalBusy, aiBusy, warnSessions])
  useEffect(() => {
    const prev = prevBusyRef.current
    const updates: Record<string, boolean> = {}
    let changed = false
    for (const s of sessions) {
      const sid = s.id
      const busy = !!(terminalBusy[sid] || aiBusy[sid])
      const prevBusy = prev[sid] ?? false
      if (prevBusy && !busy && sid !== activeSessionId) {
        updates[sid] = true
        changed = true
      }
    }
    if (activeSessionId && warnSessionsRef.current[activeSessionId]) {
      updates[activeSessionId] = false
      changed = true
    }
    const cur: Record<string, boolean> = {}
    for (const s of sessions) cur[s.id] = !!(terminalBusy[s.id] || aiBusy[s.id])
    prevBusyRef.current = cur
    if (changed) {
      setWarnSessions(p => {
        const n = { ...p }
        for (const [k, v] of Object.entries(updates)) {
          if (v) n[k] = true
          else delete n[k]
        }
        return n
      })
    }
  }, [sessions, terminalBusy, aiBusy, activeSessionId])

  // 窗口聚焦/可见性 → appFocused（切走/最小化时宠物切 unfocused）
  useEffect(() => {
    const onWinFocus = () => setAppFocused(true)
    const onWinBlur = () => { setAppFocused(false); setBrushActive(false) }
    const onVis = () => { setAppFocused(document.hasFocus()); if (!document.hasFocus()) setBrushActive(false) }
    window.addEventListener('focus', onWinFocus)
    window.addEventListener('blur', onWinBlur)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onWinFocus)
      window.removeEventListener('blur', onWinBlur)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // 宠物逻辑状态：warn(全局) > busy(当前 session terminal|ai) > unfocused > idle
  const petLogicalState = useMemo<PetLogicalState>(() => {
    if (Object.values(warnSessions).some(Boolean)) return 'warn'
    const sid = activeSessionId ?? ''
    if (terminalBusy[sid] || aiBusy[sid]) return 'busy'
    if (!appFocused) return 'unfocused'
    return 'idle'
  }, [warnSessions, terminalBusy, aiBusy, activeSessionId, appFocused])

  const [aiPermissionModes, setAiPermissionModes] = useState<Record<string, AiPermissionMode>>({})
  const [sessionWorktreeNav, setSessionWorktreeNav] = useState<Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>>({})
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
  const [diffSplitRatio, setDiffSplitRatio] = useState(() => {
    const v = Number(localStorage.getItem('vibe-ide-diff-split-ratio'))
    const r = Number.isFinite(v) && v > 0 ? v : 0.3
    return Math.min(0.9, Math.max(0.1, Math.round(r * 10) / 10))
  })
  const [capsuleTabs, setCapsuleTabs] = useState(() => {
    try { return localStorage.getItem('vibe-ide-capsule-tabs') !== 'false' } catch { return true }
  })
  const [groupSessionsByCwd, setGroupSessionsByCwd] = useState(() => {
    try { return localStorage.getItem('vibe-ide-group-sessions-by-cwd') !== 'false' } catch { return true }
  })
  const [recentFilesPanelEnabled, setRecentFilesPanelEnabled] = useState(() => {
    try { return localStorage.getItem('vibe-ide-recent-files-panel') === 'true' } catch { return false }
  })
  const [outlineOverlayEnabled, setOutlineOverlayEnabled] = useState(() => {
    try { return localStorage.getItem('vibe-ide-outline-overlay') !== 'false' } catch { return true }
  })

  const [ocrEnabled, setOcrEnabled] = useState(() => {
    try { return localStorage.getItem('vibe-ide-ocr-enabled') !== '0' } catch { return true }
  })
  const [forceDomRenderer, setForceDomRenderer] = useState(() => {
    try { return localStorage.getItem('vibe-ide-force-dom-renderer') === '1' } catch { return false }
  })
  const [cgEnabled, setCgEnabled] = useState(() => {
    try { return localStorage.getItem('vibe-ide-cg-enabled') !== '0' } catch { return true }
  })

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
      return localStorage.getItem('vibe-ide-font-family') || 'Consolas'
    } catch { return 'Consolas' }
  })
  const [termFontFamily, setTermFontFamily] = useState(() => {
    try {
      return localStorage.getItem('vibe-ide-term-font') || 'Consolas'
    } catch { return 'Consolas' }
  })
  const centerViewRef = React.useRef<CenterView>('terminal')

  // Keep ref in sync so IPC listener always sees latest centerView
  React.useEffect(() => {
    centerViewRef.current = centerView
  }, [centerView])

  // mujica stays active while its agents run even after the center view is switched away —
  // the session panel shows a restore pill when it's hidden but still running.
  const mujicaActive = useMujica().active

  // Nga "mujica" card requests the canvas as a center view (covers the terminal area, not full-app)
  React.useEffect(() => {
    const openMujica = () => { mujicaStore.setActive(true); setCenterView('mujica') }
    const closeMujica = () => { mujicaStore.setActive(false); setCenterView('terminal') }
    window.addEventListener(FOCUS_MUJICA, openMujica)
    window.addEventListener(MUJICA_CLOSE, closeMujica)
    return () => {
      window.removeEventListener(FOCUS_MUJICA, openMujica)
      window.removeEventListener(MUJICA_CLOSE, closeMujica)
    }
  }, [])

  // mujica base repo defaults to the active session cwd until the user browses for another.
  // Computed inline from sessions/activeSessionId (declared above) — referencing the
  // derived `activeSessionCwd` const here would hit TDZ (it's declared further down).
  React.useEffect(() => {
    mujicaStore.setDefaultCwd(sessions.find(s => s.id === activeSessionId)?.cwd ?? null)
  }, [sessions, activeSessionId])

  React.useEffect(() => {
    aiStore.setActiveSession(activeSessionId)
  }, [activeSessionId])

  // Terminal refs for focus management (keyed by sessionId)
  const terminalRefs = useRef<Record<string, TerminalViewHandle>>({})
  const aiTabRefs = useRef<Record<string, AiTabHandle>>({})
  const browserViewRef = useRef<BrowserViewHandle | null>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const centerPanelRef = useRef<HTMLDivElement>(null)
  const sessionPanelRef = useRef<SessionPanelHandle>(null)
  // Cursor position (DiffViewer 回传，供行历史等使用)
  interface CursorHistoryEntry { fullPath: string; line: number; column: number }
  const cursorRef = useRef<CursorHistoryEntry | null>(null)
  // 视口中间可见行（居中还原用）— DiffViewer 的 onDidScrollChange 实时回写，供最近文件行号
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


  // ── NavBar 数据源：当前 session cwd 下的最近打开文件（复用 recentFiles）──
  const navBarEntries = useMemo<NavEntry[]>(() => {
    const cwd = sessions.find(s => s.id === activeSessionId)?.cwd ?? null
    const w = cwd ? cwd.replace(/\\/g, '/').replace(/\/$/, '') : ''
    if (!w) return []
    return recentFiles
      .filter(f => { const p = f.path.replace(/\\/g, '/'); return p === w || p.startsWith(w + '/') })
      .map(f => ({ fullPath: f.path, line: f.line ?? 1 }))
  }, [recentFiles, sessions, activeSessionId])
  const navBarEntriesRef = useRef(navBarEntries)
  navBarEntriesRef.current = navBarEntries
  const [brushActive, setBrushActive] = useState(false)
  const brushActiveRef = useRef(false)
  brushActiveRef.current = brushActive
  // Nav bar state
  const [navBarVisible, setNavBarVisible] = useState(false)
  const [navBarIndex, setNavBarIndex] = useState(0)
  const [navBarSolid, setNavBarSolid] = useState(false)
  const navBarVisibleRef = useRef(false)
  const navBarIndexRef = useRef(0)
  const navBarCwdRef = useRef<string | null>(null)
  const navBarUsedRef = useRef(false)  // true when user actually navigated with arrows
  navBarVisibleRef.current = navBarVisible
  navBarIndexRef.current = navBarIndex
  // navBarEntries 缩短（删最近文件）或重排（置顶）时 clamp navBarIndex，防越界致长按 alt 呼不出 NavBar
  useEffect(() => {
    setNavBarIndex(prev => {
      const len = navBarEntries.length
      if (len > 0 && prev >= len) return len - 1
      if (prev < 0) return 0
      return prev
    })
  }, [navBarEntries])
  useEffect(() => {
    if (!navBarVisible) setNavBarSolid(false)
  }, [navBarVisible])
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
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-force-dom-renderer', forceDomRenderer ? '1' : '0') } catch {}
  }, [forceDomRenderer])
  useEffect(() => {
    try { localStorage.setItem('vibe-ide-cg-enabled', cgEnabled ? '1' : '0') } catch {}
    window.api.code.setEnabled(cgEnabled)
  }, [cgEnabled])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-inline-diff', String(inlineDiff)) } catch {}
  }, [inlineDiff])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-diff-split-ratio', String(diffSplitRatio)) } catch {}
  }, [diffSplitRatio])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-capsule-tabs', String(capsuleTabs)) } catch {}
  }, [capsuleTabs])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-group-sessions-by-cwd', String(groupSessionsByCwd)) } catch {}
  }, [groupSessionsByCwd])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-recent-files-panel', String(recentFilesPanelEnabled)) } catch {}
  }, [recentFilesPanelEnabled])
  React.useEffect(() => {
    try { localStorage.setItem('vibe-ide-outline-overlay', String(outlineOverlayEnabled)) } catch {}
  }, [outlineOverlayEnabled])

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
      // md 预览自身处理图片拖入，diff 对比不拦截
      if (!diffFileRef.current?.defaultEdit || centerViewRef.current === 'markdown') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      if (dragHideTimer) { clearTimeout(dragHideTimer); dragHideTimer = null }
      setIsDragOverEdit(true)
    }

    const onDragLeave = (e: DragEvent) => {
      const panel = centerPanelRef.current
      if (!panel) return
      if (centerViewRef.current === 'markdown') return
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
      if (!diffFileRef.current?.defaultEdit || centerViewRef.current === 'markdown') return
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

  const draftWaitersRef = useRef<Map<string, Array<() => void>>>(new Map())
  const draftSleepRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; resolve: () => void } | null>>(new Map())

  const notifyDraftIdle = useCallback((sessionId: string) => {
    if (terminalBusyRef.current[sessionId] || aiBusyRef.current[sessionId]) return
    const arr = draftWaitersRef.current.get(sessionId)
    if (arr && arr.length) {
      draftWaitersRef.current.delete(sessionId)
      arr.forEach(r => r())
    }
  }, [])

  const waitDraftIdle = useCallback(async (sessionId: string | null | undefined) => {
    if (!sessionId) return
    if (!terminalBusyRef.current[sessionId] && !aiBusyRef.current[sessionId]) return
    return new Promise<void>(resolve => {
      const arr = draftWaitersRef.current.get(sessionId) || []
      arr.push(resolve)
      draftWaitersRef.current.set(sessionId, arr)
    })
  }, [])

  const sendDraftLine = useCallback(async (sessionId: string | null | undefined, text: string) => {
    if (!sessionId) return
    const isGui = sessionViewModesRef.current[sessionId] === 'gui'
    if (isGui) {
      aiTabRefs.current[sessionId]?.sendText(text)
      aiTabRefs.current[sessionId]?.focus()
      return
    }
    window.api.terminal.write(sessionId, text + '\r')
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        draftSleepRef.current.delete(sessionId)
        resolve()
      }, 2000)
      draftSleepRef.current.set(sessionId, { timer, resolve })
    })
    await waitDraftIdle(sessionId)
  }, [waitDraftIdle])


  const handleAgentStatusChange = useCallback((sessionId: string, status: 'running' | 'idle') => {
    const v = status === 'running'
    setTerminalBusy(prev => {
      if (prev[sessionId] === v) return prev
      return { ...prev, [sessionId]: v }
    })
    if (terminalBusyRef.current[sessionId] !== v) {
      terminalBusyRef.current = { ...terminalBusyRef.current, [sessionId]: v }
    }
    if (status === 'idle') {
      const runner = pipeRunnersRef.current.get(sessionId)
      if (runner && !runner.cancelled && runner.resolveIdle) {
        const resolve = runner.resolveIdle
        runner.resolveIdle = null
        resolve()
      }
      notifyDraftIdle(sessionId)
    }
  }, [notifyDraftIdle])

  const cancelPipe = useCallback((sessionId: string) => {
    pipeQueueRef.current.delete(sessionId)
    pipeProcessingRef.current.delete(sessionId)
    const runner = pipeRunnersRef.current.get(sessionId)
    if (!runner) return
    runner.cancelled = true
    if (runner.resolveIdle) { const r = runner.resolveIdle; runner.resolveIdle = null; r() }
    if (runner.sleepTimer) { clearTimeout(runner.sleepTimer); runner.sleepTimer = null }
    if (runner.sleepResolve) { const r = runner.sleepResolve; runner.sleepResolve = null; r() }
  }, [])

  const processPipeQueue = useCallback(async (sessionId: string) => {
    const queue = pipeQueueRef.current.get(sessionId)
    if (!queue || queue.length === 0) {
      pipeProcessingRef.current.delete(sessionId)
      pipeRunnersRef.current.delete(sessionId)
      setPipeRunning(prev => { const n = { ...prev }; delete n[sessionId]; return n })
      setPipeProgress(prev => { const n = { ...prev }; delete n[sessionId]; return n })
      return
    }
    const command = queue.shift()!
    const isGui = sessionViewModesRef.current[sessionId] === 'gui'
    const PIPE_DETECT_DELAY = 2000
    const lines = command.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
    const runner = { cancelled: false, resolveIdle: null as (() => void) | null, sleepTimer: null as ReturnType<typeof setTimeout> | null, sleepResolve: null as (() => void) | null }
    pipeRunnersRef.current.set(sessionId, runner)
    setPipeRunning(prev => ({ ...prev, [sessionId]: true }))
    setPipeProgress(prev => ({ ...prev, [sessionId]: { current: 0, total: lines.length + queue.reduce((s, c) => s + c.split('\n').filter(Boolean).length, 0) } }))
    const sleep = (ms: number) => new Promise<void>(resolve => {
      runner.sleepResolve = resolve
      runner.sleepTimer = setTimeout(() => { runner.sleepResolve = null; resolve() }, ms)
    })
    const isBusy = () => isGui ? aiBusyRef.current[sessionId] === true : terminalBusyRef.current[sessionId] === true
    let globalIdx = 0
    for (let i = 0; i < lines.length; i++) {
      if (runner.cancelled) break
      globalIdx++
      setPipeProgress(prev => {
        const p = prev[sessionId]
        return p ? { ...prev, [sessionId]: { current: Math.min(globalIdx, p.total), total: p.total } } : prev
      })
      if (i === 0) {
        await new Promise<void>(resolve => {
          if (runner.cancelled) { resolve(); return }
          if (!isBusy()) { resolve(); return }
          runner.resolveIdle = resolve
        })
        if (runner.cancelled) break
      }
      if (isGui) {
        aiTabRefs.current[sessionId]?.sendText(lines[i])
      } else {
        window.api.terminal.write(sessionId, lines[i] + '\r')
      }
      await sleep(PIPE_DETECT_DELAY)
      if (runner.cancelled) break
      await new Promise<void>(resolve => {
        if (runner.cancelled) { resolve(); return }
        if (!isBusy()) { resolve(); return }
        runner.resolveIdle = resolve
      })
      if (runner.cancelled) break
    }
    processPipeQueue(sessionId)
  }, [])

  const handlePipeCommand = useCallback(async (command: string) => {
    const sessionId = activeSessionId
    if (!sessionId) return
    if (!pipeQueueRef.current.has(sessionId)) pipeQueueRef.current.set(sessionId, [])
    pipeQueueRef.current.get(sessionId)!.push(command)
    if (!pipeProcessingRef.current.get(sessionId)) {
      pipeProcessingRef.current.set(sessionId, true)
      processPipeQueue(sessionId)
    }
  }, [activeSessionId, processPipeQueue])

  const cancelPipeRef = useRef(cancelPipe)
  cancelPipeRef.current = cancelPipe
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  useEffect(() => {
    (window as any).__vibeSendLine = (text: string) => sendDraftLine(activeSessionIdRef.current, text)
    ;(window as any).__vibeAppendInput = (text: string) => {
      const sid = activeSessionIdRef.current
      if (!sid) return
      if (sessionViewModesRef.current[sid] === 'gui') {
        aiTabRefs.current[sid]?.appendText(text)
        aiTabRefs.current[sid]?.focus()
      } else {
        terminalRefs.current[sid]?.appendText(text)
        terminalRefs.current[sid]?.focus()
      }
    }
    ;(window as any).__vibeBrowse = (url: string) => {
      if (!url) return
      if (centerViewRef.current === 'browser') browserViewRef.current?.loadURL(url)
      else window.open(url, '_blank')
    }
  }, [waitDraftIdle, sendDraftLine])

  const handleAiAgentStatusChange = useCallback((sessionId: string, status: 'running' | 'idle') => {
    const v = status === 'running'
    setAiBusy(prev => {
      if (prev[sessionId] === v) return prev
      return { ...prev, [sessionId]: v }
    })
    if (aiBusyRef.current[sessionId] !== v) {
      aiBusyRef.current = { ...aiBusyRef.current, [sessionId]: v }
    }
    if (status === 'idle') {
      const runner = pipeRunnersRef.current.get(sessionId)
      if (runner && !runner.cancelled && runner.resolveIdle) {
        const resolve = runner.resolveIdle
        runner.resolveIdle = null
        resolve()
      }
      notifyDraftIdle(sessionId)
    }
  }, [notifyDraftIdle])

  const handleResetCache = useCallback((sessionId: string) => {
    terminalRefs.current[sessionId]?.clearBuffer()
    setClearAuxBufferTrigger(prev => ({ sid: sessionId, n: prev.n + 1 }))
    setCommandHistory(prev => {
      const next = { ...prev }
      delete next[sessionId]
      return next
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

      if (quickOpenOpenRef.current) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
          return
        }
      }

      // ── Brush modifier keydown: feather pen cursor ──
      if (eventIsModifierPress(e, bindings['brush.activate'])) {
        setBrushActive(true)
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }

      // ── Alt keydown: 显示 NavBar（Alt+←/→ 切换并跳转）──
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const hist = navBarEntriesRef.current
        if (hist.length > 0) {
          let idx = navBarIndexRef.current
          if (idx < 0 || idx >= hist.length) idx = 0
          navBarCwdRef.current = sessionsRef.current.find(s => s.id === activeSessionId)?.cwd ?? null
          navBarVisibleRef.current = true
          navBarUsedRef.current = false
          navBarIndexRef.current = idx
          setNavBarSolid(false)
          setNavBarVisible(true)
          setNavBarIndex(idx)
        }
        return
      }

      // ── nav bar mode: intercept Left/Right to move selection ──
      if (navBarVisibleRef.current) {
        if (e.key === 'ArrowLeft' && e.altKey) {
          e.preventDefault()
          e.stopImmediatePropagation()
          navBarUsedRef.current = true
          setNavBarSolid(true)
          setNavBarIndex(prev => {
            const len = navBarEntriesRef.current.length
            return prev <= 0 ? len - 1 : prev - 1
          })
          return
        }
        if (e.key === 'ArrowRight' && e.altKey) {
          e.preventDefault()
          e.stopImmediatePropagation()
          navBarUsedRef.current = true
          setNavBarSolid(true)
          setNavBarIndex(prev => {
            const len = navBarEntriesRef.current.length
            return prev >= len - 1 ? 0 : prev + 1
          })
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopImmediatePropagation()
          setNavBarVisible(false)
          return
        }
      }

      // quickOpen.file → Ctrl+E toggle fuzzy file quick open
      if (eventMatchesBinding(e, bindings['quickOpen.file'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (quickOpenOpenRef.current) closeQuickOpen()
        else openQuickOpen(true)
        return
      }

      // codegraph.open → open CodeGraph search and focus input
      if (eventMatchesBinding(e, bindings['codegraph.open'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setShowCodeSearch(true)
        setCodeSearchFocusTrigger(k => k + 1)
        return
      }

      // search.focus → open search dropdown (md preview: route to in-page search)
      if (eventMatchesBinding(e, bindings['search.focus'])) {
        if (centerView === 'markdown') {
          e.preventDefault()
          e.stopImmediatePropagation()
          window.dispatchEvent(new CustomEvent(MD_SEARCH_OPEN))
        } else if (centerView !== 'diff') {
          e.preventDefault()
          e.stopImmediatePropagation()
          setShowSearchDropdown(true)
          setSearchFocusTrigger(k => k + 1)
        }
      }

      // terminal.next / terminal.prev → blur right panel, switch session, focus terminal
      // Use visual order: grouped by cwd when grouping enabled, raw array order otherwise
      let visualOrder: TerminalSession[]
      if (groupSessionsByCwd) {
        const groups = new Map<string, TerminalSession[]>()
        for (const s of sessions) {
          const key = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(s)
        }
        visualOrder = Array.from(groups.values()).flat()
      } else {
        visualOrder = sessions
      }

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
            window.api.terminal.write(activeSessionId, cmds[idx].replace(/\n/g, '\x1b\r') + '\r')
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

      // Escape priority: call graph → code search → explore result → search dropdown → focus return
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
        if (showSearchDropdownRef.current) {
          e.preventDefault(); e.stopImmediatePropagation()
          setShowSearchDropdown(false)
          return
        }
        const active = document.activeElement as HTMLElement | null
        if (active && rightPanelRef.current?.contains(active) && centerView === 'terminal') {
          const tag = active.tagName
          const isDraftAddInput = active.classList.contains('draft-plan__add-input')
          if (tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT' || isDraftAddInput) {
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
  }, [centerView, sessions, activeSessionId, groupSessionsByCwd])

  // Brush keyup → deactivate feather pen
  React.useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      const brushBinding = parseKeybinding(getShortcuts()['brush.activate'])
      const brushEKey = brushBinding.ctrl ? 'Control' : brushBinding.alt ? 'Alt' : brushBinding.shift ? 'Shift' : 'Meta'
      if (e.key === brushEKey) {
        setBrushActive(false)
        return
      }

      if (e.key !== 'Alt') return

      if (!navBarVisibleRef.current) return
      if (!navBarUsedRef.current) { setNavBarVisible(false); return }
      const idx = navBarIndexRef.current
      const hist = navBarEntriesRef.current
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
    navBarVisibleRef.current = false
    setNavBarVisible(false)
    const hist = navBarEntriesRef.current
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

  const handleQuickOpenSelect = useCallback((fullPath: string, relativePath: string) => {
    setDiffFile({
      filePath: relativePath,
      fullPath,
      diffContent: '',
      isStaged: false,
      defaultEdit: true,
      revision: ++diffRevisionRef.current,
    })
    setCenterView('diff')
    closeQuickOpen()
  }, [closeQuickOpen])

  // Get cwd of the currently active session
  const activeSessionCwd = sessions.find(s => s.id === activeSessionId)?.cwd ?? null

  // Create a new terminal session — ask user to pick a directory first
  const [isOpening, setIsOpening] = useState(false)
  const handleCreateSession = useCallback(async (shell: string = getMainShellType()) => {
    try {
      setIsOpening(true)
      const dirResult = await window.api.workspace.pickDir()
      if (dirResult.canceled) return
      const session = await window.api.terminal.create({ cwd: dirResult.path, shell, autoUtf8, initCommand: readDefaultAgent() })
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
      setCenterView('terminal')
      setDiffFile(null)
    } catch (err) {
      console.error('Failed to create terminal session:', err)
    } finally {
      setIsOpening(false)
    }
  }, [autoUtf8])

  // Create a terminal session at a specific path (no directory picker)
  const handleCreateSessionAt = useCallback(async (cwd: string, shell: string = getMainShellType()) => {
    try {
      setIsOpening(true)
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8, initCommand: readDefaultAgent() })
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
      setCenterView('terminal')
      setDiffFile(null)
      return session
    } catch (err) {
      console.error('Failed to create terminal session at path:', err)
      return null
    } finally {
      setIsOpening(false)
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
      const fromGui = !!(parentId && sessionViewModes[parentId] === 'gui')
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8, name, initCommand: fromGui ? undefined : readDefaultAgent() })
      setSessions(prev => {
        if (parentId == null) return [...prev, session]
        const parentIndex = prev.findIndex(s => s.id === parentId)
        if (parentIndex === -1) return [...prev, session]
        const next = [...prev]
        next.splice(parentIndex + 1, 0, session)
        return next
      })
      setActiveSessionId(session.id)
      if (parentId && sessionViewModes[parentId] === 'gui') {
        setSessionViewModes(prev => ({ ...prev, [session.id]: 'gui' }))
      }
      setCenterView('terminal')
      setDiffFile(null)
    } catch (err) {
      console.error('Failed to clone terminal session:', err)
    }
  }, [autoUtf8, sessionViewModes])

  // Fork AI conversation at a specific user message
  const handleForkSession = useCallback(async (currentSessionId: string, userMessageIndex: number, content?: string, occurrence?: number) => {
    try {
      const current = sessions.find(s => s.id === currentSessionId)
      if (!current) return

      // 1. Call fork IPC to create truncated JSONL with new session ID
      const result = await window.api.ai.fork({
        sessionId: currentSessionId,
        userMessageIndex,
        cwd: current.cwd,
        ...(content ? { content, occurrence } : {}),
      })
      if (!result.success || !result.newClaudeSessionId) {
        console.error('Fork failed:', result.error)
        return
      }

      // 2. Create new terminal session (same cwd)
      const session = await window.api.terminal.create({ cwd: current.cwd, shell: getMainShellType(), autoUtf8 })

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

  const handleCloneWithInit = useCallback(async (sessionId: string, cwd: string, shell: string | undefined, command: string) => {
    try {
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8, initCommand: command })
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
    } catch (err) {
      console.error('Failed to clone with init:', err)
    }
  }, [autoUtf8])

  const handleInitCommand = useCallback(async (command: string) => {
    const activeSession = sessions.find(s => s.id === activeSessionId)
    if (!activeSession) return
    await handleCloneWithInit(activeSession.id, activeSession.cwd, activeSession.shell, command)
  }, [activeSessionId, sessions, handleCloneWithInit])

  // Close a terminal session
  const handleCloseSession = useCallback(async (id: string) => {
    cancelPipe(id)
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
    // 清理该 session 的全部右侧终端
    const rightTerms = rightTerminalSessions[id]
    if (rightTerms && rightTerms.length > 0) {
      Promise.all(rightTerms.flatMap(tab => tab.terminals).map(t => window.api.terminal.close(t.id)))
      setRightTerminalSessions(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setActiveAuxIndex(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    // 清理该 session 的 AI 子进程 + renderer 单例 store 中的状态(消除残骸)
    window.api.ai.destroy(id)
    aiStore.clearSession(id)
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
      const newWidth = Math.max(280, Math.min(800, startWidth + delta))
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

  const handleOutlineNavigate = useCallback((line: number, headingName?: string) => {
    if (centerView === 'diff' && diffFile) {
      setDiffFile(prev => prev ? { ...prev, lineNumber: line } : prev)
      setOutlineScrollTrigger(prev => prev + 1) // force lineNumber effect re-fire
    }
    if (centerView === 'markdown' && headingName) {
      setMdScrollHeading(headingName)
    }
  }, [centerView, diffFile])

  const handleAnnotationTrigger = useCallback((start: number, end: number) => {
    const fp = diffFile?.fullPath
    if (!fp) return
    const rel = toRelPath(fp, activeSessionCwd)
    window.dispatchEvent(new CustomEvent(ADD_ANNOTATION_EVENT, { detail: { rel, start, end } }))
  }, [diffFile?.fullPath, activeSessionCwd])

  const [mdScrollHeading, setMdScrollHeading] = useState<string | undefined>(undefined)
  const [, setOutlineScrollTrigger] = useState(0)

  // 处理从中间终端点击文件路径打开文件
  const handleOpenFileFromTerminal = useCallback((fullPath: string, lineNumber?: number) => {
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
      lineNumber,
      defaultEdit: true,
      revision: ++diffRevisionRef.current
    })
    setCenterView('diff')
  }, [activeSessionCwd])

  // 处理从右侧终端点击文件路径打开文件 - 直接切换到 edit 模式
  const handleOpenFileFromRightTerminal = useCallback((fullPath: string, lineNumber?: number) => {
    recordRecentFile(fullPath, lineNumber)
    if (isMarkdownFile(fullPath)) {
      setMarkdownFile({ fullPath, fileName: fullPath.split(/[\\/]/).pop() || fullPath })
      setCenterView('markdown')
      return
    }
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

  // 创建右侧终端（每个 session 独立，可多个 tab，append 后自动切到新 tab）
  const handleCreateRightTerminal = useCallback(async (sessionId: string, cwdOverride?: string) => {
    const session = sessions.find(s => s.id === sessionId)
    const cwd = cwdOverride || session?.cwd
    if (!cwd) return
    try {
      const shell = getAuxShellType()
      const term = await window.api.terminal.create({ cwd, shell, autoUtf8 })
      const prevLen = rightTerminalSessions[sessionId]?.length ?? 0
      const newTab: AuxTerminalTab = { id: term.id, terminals: [term], sizes: [1] }
      setRightTerminalSessions(prev => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] || []), newTab]
      }))
      setActiveAuxIndex(prev => ({ ...prev, [sessionId]: prevLen }))
    } catch (err) {
      console.error('Failed to create right terminal:', err)
    }
  }, [sessions, autoUtf8, rightTerminalSessions])

  // 关闭该 session 全部右侧终端（worktree 切换/返回用）
  const handleCloseRightTerminal = useCallback(async (sessionId: string) => {
    const tabs = rightTerminalSessions[sessionId]
    if (!tabs || tabs.length === 0) return
    await Promise.all(tabs.flatMap(tab => tab.terminals).map(t => window.api.terminal.close(t.id)))
    setRightTerminalSessions(prev => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    setActiveAuxIndex(prev => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [rightTerminalSessions])

  // 关闭单个 aux terminal tab（含其全部 terminals）
  const handleCloseAuxTerminal = useCallback(async (sessionId: string, tabId: string) => {
    const tabs = rightTerminalSessions[sessionId]
    if (!tabs) return
    const idx = tabs.findIndex(t => t.id === tabId)
    if (idx === -1) return
    const tab = tabs[idx]
    await Promise.all(tab.terminals.map(t => window.api.terminal.close(t.id)))
    setRightTerminalSessions(prev => {
      const arr = prev[sessionId] || []
      const filtered = arr.filter(t => t.id !== tabId)
      const next = { ...prev }
      if (filtered.length === 0) delete next[sessionId]
      else next[sessionId] = filtered
      return next
    })
    setActiveAuxIndex(prev => {
      const oldLen = (rightTerminalSessions[sessionId] || []).length
      const newLen = oldLen - 1
      if (newLen <= 0) {
        const next = { ...prev }
        delete next[sessionId]
        return next
      }
      const cur = prev[sessionId] ?? 0
      const nextIdx = Math.min(Math.max(cur - (idx < cur ? 1 : 0), 0), newLen - 1)
      return { ...prev, [sessionId]: nextIdx }
    })
  }, [rightTerminalSessions])

  // 分屏向下新增：当前 tab 加一个 terminal（最多 3 个）
  const handleSplitAuxTerminal = useCallback(async (sessionId: string, tabIndex: number) => {
    const tabs = rightTerminalSessions[sessionId]
    const tab = tabs?.[tabIndex]
    if (!tab || tab.terminals.length >= 3) return
    const cwd = tab.terminals[0]?.cwd
    if (!cwd) return
    try {
      const shell = getAuxShellType()
      const term = await window.api.terminal.create({ cwd, shell, autoUtf8 })
      setRightTerminalSessions(prev => {
        const arr = prev[sessionId] || []
        const next = arr.map((t, i) => i === tabIndex
          ? { ...t, terminals: [...t.terminals, term], sizes: Array(t.terminals.length + 1).fill(1) }
          : t)
        return { ...prev, [sessionId]: next }
      })
      setActiveAuxIndex(prev => ({ ...prev, [sessionId]: tabIndex }))
    } catch (err) {
      console.error('Failed to split aux terminal:', err)
    }
  }, [rightTerminalSessions, autoUtf8])

  // 拖拽调整分屏比例
  const handleResizeAuxSplit = useCallback((sessionId: string, tabId: string, sizes: number[]) => {
    setRightTerminalSessions(prev => {
      const arr = prev[sessionId] || []
      const next = arr.map(t => t.id === tabId ? { ...t, sizes } : t)
      return { ...prev, [sessionId]: next }
    })
  }, [])

  // 切换 aux terminal active tab
  const handleSelectAuxTab = useCallback((sessionId: string, index: number) => {
    setActiveAuxIndex(prev => ({ ...prev, [sessionId]: index }))
  }, [])

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

  const handleResumeClaudeHistory = useCallback(async (historySessionId: string, cwd: string, name: string, mode: 'tui' | 'gui') => {
    try {
      setIsOpening(true)
      const shell = getMainShellType()
      let initCommand: string | undefined
      if (mode === 'tui') {
        const { cliCommand, configDir } = readAiCliConfig()
        const bin = cliCommand || 'claude'
        const isPosix = shell === 'bash' || shell === 'sh' || shell === 'zsh' || shell === 'gitbash'
        const binPart = bin.includes(' ') ? (shell === 'cmd' ? `"${bin}"` : isPosix ? `'${bin}'` : `& '${bin}'`) : bin
        const base = `${binPart} --resume ${historySessionId}`
        // Bare names (.opencc) resolve to ~/.opencc so the tui launch and the gui history
        // lookup agree on the same config dir. Use the resolved absolute path in the env var.
        const resolvedConfigDir = configDir ? await window.api.ai.resolveConfigDir(configDir) : ''
        initCommand = !resolvedConfigDir ? base
          : shell === 'cmd' ? `set "CLAUDE_CONFIG_DIR=${resolvedConfigDir}" && ${base}`
          : isPosix ? `CLAUDE_CONFIG_DIR='${resolvedConfigDir}' ${base}`
          : `$env:CLAUDE_CONFIG_DIR='${resolvedConfigDir}'; ${base}`
      }
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8, name: name || undefined, initCommand })
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
      setCenterView('terminal')
      setDiffFile(null)
      if (mode === 'gui') {
        await aiStore.resumeSession(session.id, historySessionId, cwd, { autoApprove: false, permissionMode: 'bypassPermissions', name })
        setSessionViewModes(prev => ({ ...prev, [session.id]: 'gui' }))
      }
    } catch (err) {
      console.error('Failed to resume claude history:', err)
    } finally {
      setIsOpening(false)
    }
  }, [autoUtf8])

  const handlePreviewMarkdown = useCallback((fullPath: string, fileName: string) => {
    recordRecentFile(fullPath)
    setMarkdownFile({ fullPath, fileName })
    setCenterView('markdown')
  }, [recordRecentFile])

  const handleBackFromMarkdown = useCallback(() => {
    setCenterView('terminal')
    setMarkdownFile(null)
  }, [])

  const handlePreviewImage = useCallback((fullPath: string, fileName: string) => {
    recordRecentFile(fullPath)
    setImageFile({ fullPath, fileName })
    setCenterView('image')
  }, [recordRecentFile])

  const handleBackFromImage = useCallback(() => {
    setCenterView('terminal')
    setImageFile(null)
  }, [])

  const isWelcome = sessions.length === 0

  const hideRecentFiles = !!(recentFilesPanelEnabled && (
    (centerView === 'diff' && diffFile && (isCode(diffFile.fullPath) || isMarkdown(diffFile.fullPath))) ||
    (centerView === 'markdown' && markdownFile && isMarkdown(markdownFile.fullPath))
  ))

  return (
    <div className="h-full w-full flex flex-col bg-ide-bg">
      {/* Title Bar */}
      <div className="titlebar-drag h-9 bg-ide-sidebar border-b border-ide-border flex items-center px-4 select-none shrink-0">
        <span className="relative w-[18px] h-[18px] mr-1.5 shrink-0 -ml-1 block">
          <span
            className="absolute inset-0 bg-ide-accent"
            style={{ maskImage: `url(${iconBgMask})`, WebkitMaskImage: `url(${iconBgMask})`, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' }}
          />
          <img src={iconPattern} alt="" className="absolute inset-0 w-full h-full object-contain" />
        </span>
        <span className="text-ide-text-muted text-sm font-medium tracking-wide">Vibe IDE</span>
        <button
          className="no-drag config-menu-area w-6 h-6 ml-[10px] rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); sessionPanelRef.current?.toggleConfig(r) }}
          title={t('Settings')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="butt" strokeLinejoin="bevel" className="w-5 h-5">
            <path d="M12 3 L19 8 L19 15 L12 20 L5 15 L5 8 Z M5 8 L12 13 L19 8 M12 13 L12 20" />
          </svg>
        </button>
        <div className="flex-1" />
        <button
          className={`no-drag w-6 h-6 rounded flex items-center justify-center transition-colors shrink-0 ${showSearchDropdown ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
          style={{ marginRight: 16 }}
          onClick={() => setShowSearchDropdown(true)}
          title={t('Search')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
            <circle cx="11" cy="11" r="8" />
            <line x1="17" y1="17" x2="22" y2="22" />
          </svg>
        </button>
        <button
          className="no-drag w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
          style={{ marginRight: 16 }}
          onClick={() => setCenterView('browser')}
          title={t('Web Debug')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </button>
        <button
          className="no-drag w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
          style={{ marginRight: 132 }}
          onClick={handleToggleRightPanel}
          title={rightPanelCollapsed ? t('Expand Panel') : t('Collapse Panel')}
        >
          {rightPanelCollapsed ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
              <path d="M19,2H5C2.243,2,0,4.243,0,7v10c0,2.757,2.243,5,5,5h14c2.757,0,5-2.243,5-5V7c0-2.757-2.243-5-5-5ZM2,17V7c0-1.654,1.346-3,3-3H13V20H5c-1.654,0-3-1.346-3-3Zm20,0c0,1.654-1.346,3-3,3h-4V4h4c1.654,0,3,1.346,3,3v10Zm-2-6c0,.553-.448,1-1,1h-1c-.552,0-1-.447-1-1s.448-1,1-1h1c.552,0,1,.447,1,1Zm0,4c0,.553-.448,1-1,1h-1c-.552,0-1-.447-1-1s.448-1,1-1h1c.552,0,1,.447,1,1Zm0-8c0,.553-.448,1-1,1h-1c-.552,0-1-.447-1-1s.448-1,1-1h1c.552,0,1,.447,1,1Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
              <path d="M19,2H5C2.243,2,0,4.243,0,7v10c0,2.757,2.243,5,5,5h14c2.757,0,5-2.243,5-5V7c0-2.757-2.243-5-5-5ZM2,17V7c0-1.654,1.346-3,3-3H13V20H5c-1.654,0-3-1.346-3-3Zm20,0c0,1.654-1.346,3-3,3h-4V4h4c1.654,0,3,1.346,3,3v10Zm-2-6c0,.553-.448,1-1,1h-1c-.552,0-1-.447-1-1s.448-1,1-1h1c.552,0,1,.447,1,1Zm0,4c0,.553-.448,1-1,1h-1c-.552,0-1-.447-1-1s.448-1,1-1h1c.552,0,1,.447,1,1Zm0-8c0,.553-.448,1-1,1h-1c-.552,0-1-.447-1-1s.448-1,1-1h1c.552,0,1,.447,1,1Z" />
            </svg>
          )}
        </button>
      </div>

      {/* Main Content - 3 Panels */}
      <div className="flex flex-1 overflow-hidden" style={{ cursor: isDragging ? 'col-resize' : 'default' }}>
        {/* Left Panel: Session + Outline */}
        <div className="shrink-0 flex flex-col relative" data-panel="left" style={{ width: leftPanelWidth, display: isWelcome ? 'none' : undefined }}>
          {/* SessionPanel: always full height */}
          <div className="flex-1 overflow-hidden">
            <SessionPanel
              ref={sessionPanelRef}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onCreateSession={handleCreateSession}
            onCreateSessionAt={handleCreateSessionAt}
            onCloneSession={handleCloneSession}
            onSwitchSession={handleSwitchSession}
            onCloseSession={handleCloseSession}
            onRenameSession={handleRenameSession}
            onReorderSessions={handleReorderSessions}
            onReorderGroup={handleReorderGroup}
            commandHistory={commandHistory}
            agentStatus={agentStatus}
            onResumeClaudeHistory={handleResumeClaudeHistory}
            onResetCache={handleResetCache}
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
            forceDomRenderer={forceDomRenderer}
            onToggleForceDomRenderer={setForceDomRenderer}
            inlineDiff={inlineDiff}
            onToggleInlineDiff={setInlineDiff}
            diffSplitRatio={diffSplitRatio}
            onSetDiffSplitRatio={setDiffSplitRatio}
            capsuleTabs={capsuleTabs}
            onToggleCapsuleTabs={setCapsuleTabs}
            groupSessionsByCwd={groupSessionsByCwd}
            onToggleGroupSessionsByCwd={setGroupSessionsByCwd}
            recentFilesPanelEnabled={recentFilesPanelEnabled}
            onToggleRecentFilesPanel={setRecentFilesPanelEnabled}
            hideRecentFiles={hideRecentFiles}
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
              setDiffSplitRatio(0.3)
              setSessionFontFamily('Consolas')
              setFontFamily('Consolas')
              setTermFontFamily('Consolas')
            }}
            focusSettingsTrigger={focusSettingsTrigger}
            onExecuteCommand={handleExecuteCommand}
            onInitCommand={handleInitCommand}
            onPipeCommand={handlePipeCommand}
            pipeRunning={pipeRunning}
            pipeProgress={pipeProgress}
            onCancelPipe={cancelPipe}
            onCloneWithInit={handleCloneWithInit}
            sessionViewModes={sessionViewModes}
            onSwitchViewMode={handleSwitchViewMode}
            recentFiles={recentFiles}
            onOpenRecentFile={handleOpenRecentFile}
            onRemoveRecentFile={removeRecentFile}
            mujicaRestoreVisible={mujicaActive && centerView !== 'mujica'}
            onRestoreMujica={() => window.dispatchEvent(new CustomEvent(FOCUS_MUJICA))}
          />
          </div>
          {/* Outline + floating recent files — shared flex container so outline scrolling respects recent-files height */}
          {recentFilesPanelEnabled && recentFiles.length > 0 && ((centerView === 'diff' && diffFile && (isCode(diffFile.fullPath) || isMarkdown(diffFile.fullPath))) || (centerView === 'markdown' && markdownFile && isMarkdown(markdownFile.fullPath))) && (
            <div className="absolute left-2 right-2 bottom-2 z-10 flex flex-col bg-ide-sidebar border border-ide-border rounded-lg overflow-hidden">
              {recentFilesPanelEnabled && recentFiles.length > 0 && (
                <div className="shrink-0 border-t border-ide-border">
                  {recentFiles.slice(0, 5).map(f => {
                    const baseName = f.path.split(/[\\/]/).pop() || f.path
                    const info = getFileInfo(baseName)
                    return (
                      <div
                        key={f.path}
                        className="group px-3 py-1 cursor-pointer transition-colors relative min-h-[32px] session-item text-ide-text-muted hover:bg-ide-hover hover:text-ide-text"
                        title={f.path}
                        onClick={() => handleOpenRecentFile(f.path, f.line)}
                      >
                        <div className="flex items-center justify-between min-h-[32px]">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <svg viewBox="0 0 16 16" fill="currentColor" className={`ft-icon shrink-0 ${info.color}`}
                              dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
                            <span className="truncate min-w-0 text-sm session-item__name">{baseName}</span>
                          </div>
                          <div className="flex items-center session-item__actions">
                            <button
                              onClick={(e) => { e.stopPropagation(); removeRecentFile(f.path) }}
                              className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-ide-text-muted hover:bg-ide-accent hover:text-white transition-all shrink-0 flex items-center justify-center"
                              title={t('Remove')}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
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
            <div className="flex-1 mx-1 mb-0.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col">
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
                diffSplitRatio={diffSplitRatio}
                scrollTrigger={diffScrollTrigger}
                cursorRef={cursorRef}
                visibleLineRef={visibleLineRef}
                onOpenCallGraph={handleOpenCallGraphFromEditor}
                onViewLineHistory={handleViewLineHistory}
                compareOriginalContent={diffFile.compareOriginalContent}
                compareOriginalPath={diffFile.compareOriginalPath}
                onAnnotationTrigger={handleAnnotationTrigger}
                brushActive={brushActive}
                outlineEnabled={outlineOverlayEnabled}
                onToggleOutline={() => setOutlineOverlayEnabled(prev => !prev)}
                onOutlineNavigate={handleOutlineNavigate}
              />
            </div>
          )}
          {/* Markdown Preview */}
          {centerView === 'markdown' && markdownFile && (
            <div className="flex-1 mx-1 mb-0.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col center-overlay">
              <MarkdownPreview
                key={markdownFile.fullPath}
                fullPath={markdownFile.fullPath}
                fileName={markdownFile.fileName}
                onBack={handleBackFromMarkdown}
                scrollToHeading={mdScrollHeading}
                brushActive={brushActive}
                outlineEnabled={outlineOverlayEnabled}
                onToggleOutline={() => setOutlineOverlayEnabled(prev => !prev)}
                onOutlineNavigate={handleOutlineNavigate}
              />
            </div>
          )}
          {/* Image Preview */}
          {centerView === 'image' && imageFile && (
            <div className="flex-1 mx-1 mb-0.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col center-overlay">
              <ImagePreview
                key={imageFile.fullPath}
                fullPath={imageFile.fullPath}
                fileName={imageFile.fileName}
                onBack={handleBackFromImage}
                brushActive={brushActive}
              />
            </div>
          )}
          {/* Browser */}
          {centerView === 'browser' && (
            <div className="flex-1 mx-1 mb-0.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col">
              <BrowserView
                ref={browserViewRef}
                onBack={handleBackToTerminal}
                onAnnotate={(line) => { (window as any).__vibeAppendInput?.(line) }}
              />
            </div>
          )}
          {/* Welcome screen — shown when no sessions exist */}
          {centerView === 'terminal' && sessions.length === 0 && (
            <WelcomeScreen
              isOpening={isOpening}
              onOpenFolder={() => handleCreateSession()}
              onOpenPath={(path) => handleCreateSessionAt(path)}
            />
          )}
          {/* Terminal sessions / AI GUI mode */}
          <div className="flex-1 mx-1 mb-0.5 mt-0.5 border-2 border-ide-border rounded-lg overflow-hidden flex flex-col" style={{ display: centerView === 'terminal' && sessions.length > 0 ? 'flex' : 'none' }}>
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
                        autoApprove={false}
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
                        onForkSession={(userMessageIndex: number, content?: string, occurrence?: number) => {
                          handleForkSession(session.id, userMessageIndex, content, occurrence)
                        }}
                        onAgentStatusChange={handleAiAgentStatusChange}
                        brushActive={brushActive}
                        lastOpenedFile={lastOpenedFile}
                        worktreeNav={sessionWorktreeNav[session.id] ?? null}
                        onWorktreeNavChange={setSessionWorktreeNav}
                        onCommand={onCommandForSession(session.id)}
                      />
                    ) : (
                      <TerminalView ref={(node) => { if (node) terminalRefs.current[session.id] = node }} sessionId={session.id} sessionName={session.name} sessionCwd={session.cwd} onOpenFile={handleOpenFileFromTerminal} onCommand={onCommandForSession(session.id)} showHeader={false} fontSize={terminalFontSize} fontFamily={termFontFamily} isActive={session.id === activeSessionId} ocrEnabled={ocrEnabled} newlineShortcut={getShortcuts()['terminal.newline']} pageDownShortcut={getShortcuts()['terminal.pageDown']} pageUpShortcut={getShortcuts()['terminal.pageUp']} onAgentStatusChange={handleAgentStatusChange} onOscTitle={handleOscTitleChange} />
                    )}
                  </div>
                )
              })}
            </Suspense>
          </div>
          {/* mujica canvas — display-toggle so state + running agents survive hide (ESC = collapse, restore pill shows in session list) */}
          <div className="flex-1 mx-1 mb-0.5 mt-0.5 border-2 border-ide-border rounded-lg overflow-hidden flex flex-col" style={{ display: centerView === 'mujica' ? 'flex' : 'none' }}>
            <GameMujica onCollapse={() => setCenterView('terminal')} />
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
          className="shrink-0 flex flex-col overflow-hidden focus-frame relative"
          style={{ width: rightPanelWidth }}
          data-panel="right"
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
            rightTerminalSessions={rightTerminalSessions}
            activeAuxIndex={activeAuxIndex}
            onCreateRightTerminal={handleCreateRightTerminal}
            onCloseRightTerminal={handleCloseRightTerminal}
            onCloseAuxTerminal={handleCloseAuxTerminal}
            onSelectAuxTab={handleSelectAuxTab}
            onSplitAuxTerminal={handleSplitAuxTerminal}
            onResizeAuxSplit={handleResizeAuxSplit}
            clearAuxBufferTrigger={clearAuxBufferTrigger}
            navigateToFilePayload={navigateToFilePayload}
            onNavigateToFile={handleNavigateToFile}
            onExploreNode={(node: any) => setCallGraphFocalNode(node)}
            lineHistoryPayload={lineHistoryPayload}
            sessionWorktreeNav={sessionWorktreeNav}
            onWorktreeNavChange={setSessionWorktreeNav}
            onDiffScroll={handleDiffScroll}
            onToggleCollapse={handleToggleRightPanel}
            capsuleTabs={capsuleTabs}
            onToggleCapsuleTabs={() => setCapsuleTabs(v => !v)}
            brushActive={brushActive}
            onResumeClaudeHistory={handleResumeClaudeHistory}
          />
        </div>
        )}
      </div>

      {/* History Popup Overlay */}
      {showHistory && activeSessionId && (() => {
        const cmds = commandHistory[activeSessionId] || []
        const sessionName = sessions.find(s => s.id === activeSessionId)?.name || activeSessionId
        return (
          <ModalOverlay onClose={() => setShowHistory(false)}>
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
                        window.api.terminal.write(activeSessionId, cmd.replace(/\n/g, '\x1b\r'))
                        setShowHistory(false)
                      }}
                      onMouseEnter={() => setHistorySelectedIndex(i)}
                    >
                      <span className="text-ide-text-muted shrink-0 w-8 text-right text-xs">{i + 1}</span>
                      <span className="truncate flex-1" title={cmd}>{cmd}</span>
                      <HistoryCopyButton cmd={cmd} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </ModalOverlay>
        )
      })()}

      {/* Quick Open — Ctrl+E fuzzy file search across active session cwd */}
      <QuickOpen
        open={quickOpenOpen}
        cwd={activeSessionCwd}
        onSelect={handleQuickOpenSelect}
        onClose={closeQuickOpen}
      />

      {/* Nav Bar — 当前 cwd 最近文件，Alt+←/→ 切换并跳转 */}
      <NavBar
        entries={navBarEntries}
        selectedIndex={navBarIndex}
        visible={navBarVisible}
        solid={navBarSolid}
        onSelect={handleNavBarSelect}
      />

      {/* Search Dropdown — titlebar 搜索图标浮窗 */}
      <ModalOverlay
        onClose={() => setShowSearchDropdown(false)}
        style={{ display: showSearchDropdown ? 'block' : 'none' }}
      >
        <div
          className="absolute bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl flex flex-col overflow-hidden animate-fade-in"
          style={{
            top: 40,
            right: 16,
            width: 480,
            maxHeight: 'calc(100vh - 56px)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <SearchPanel
            cwd={activeSessionCwd}
            onOpenFile={(fullPath, lineNumber) => {
              handleOpenSearchResult(fullPath, lineNumber)
            }}
            focusTrigger={searchFocusTrigger}
            onExploreNode={(node: any) => setCallGraphFocalNode(node)}
          />
        </div>
      </ModalOverlay>

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

      {/* Desktop pet — warn>busy>unfocused>idle，跟随活跃 session 与窗口聚焦 */}
      <DesktopPet logicalState={petLogicalState} activeSessionId={activeSessionId} activeSessionCwd={activeSessionCwd} sessions={sessions} />
    </div>
  )

  }