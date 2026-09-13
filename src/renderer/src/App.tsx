
import React, { useState, useCallback, useMemo, lazy, Suspense, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { getDshApi } from './dsh/history'
import { loadSessionWorkspace, saveSessionWorkspace, randomTermEmoji, type Session, type SessionTab } from './sessionRestore'
const DshView = lazy(() => import('./components/DshView'))
import type { DshViewHandle } from './components/DshView'
import SessionPanel, { type SessionPanelHandle } from './components/SessionPanel'
import RightPanel from './components/RightPanel'
import GitTab from './components/GitTab'
import FileTab from './components/FileTab'
import DiffViewer from './components/DiffViewer'
import { FileTabsView } from './components/FileTabsView'
import { useFileTabs } from './utils/useFileTabs'
import { FileTab as FileTabState, DiffFileTab, baseName, makeTabId, autoViewKind } from './fileTabs'
import type { TabSnapshot, TabRuntime } from './fileTabs'
import MarkdownPreview, { MD_SEARCH_OPEN } from './components/MarkdownPreview'
import ImagePreview from './components/ImagePreview'
import BrowserView, { BrowserViewHandle, setBrowserStartUrl } from './components/BrowserView'
import NavBar, { NavEntry } from './components/NavBar'
import WelcomeScreen from './components/WelcomeScreen'
import CallGraphOverlay from './components/CallGraphOverlay'
import { DesktopPet, type PetLogicalState } from './components/DesktopPet'
import SearchPanel from './components/SearchPanel'
import { ModalOverlay } from './components/ModalOverlay'
import { DirectoryPicker } from './components/DirectoryPicker'
import QuickOpen from './components/QuickOpen'
import AiTab, { AiTabHandle } from './components/AiTab'
import BoardView, { BOARD_FOCUS } from './components/BoardView'
import { aiStore, readAiCliConfig } from './aiStore'
import { CodeGraphSearch } from './components/CodeGraphSearch'
import { CodeGraphExploreResult } from './components/CodeGraphExploreResult'
import iconPattern from '@renderer/assets/icon-pattern.png?inline'
import iconBgMask from '@renderer/assets/icon-bg-mask.png?inline'
import { ADD_ANNOTATION_EVENT, BTW_REPLY_EVENT, toRelPath } from './components/vibeEvents'
import { TerminalSession, AuxTerminalTab, RenameTerminalResult, AiPermissionMode, RecentFileEntry, WorktreeRecord, PrProviderView, PrProviderInput, PrRemoteInfo, CreatePrPayload, PrResult, PrTestInput, PrTestResult, PrListResult, PrConflictResult } from '@shared/types'
import { getShortcuts, eventMatchesBinding, eventIsModifierPress, parseKeybinding } from './shortcuts'
import { useI18n } from './i18n'
import { cwdStore, useKeptGroups, mergeGroupOrder } from './cwdStore'
import type { TerminalViewHandle } from './components/TerminalView'
import { getMainShellType, getAuxShellType } from './utils/shellPrefs'
import { resolveAbsPath, toFileUrl } from './utils/filePathUtils'

const TerminalView = lazy(() => import('./components/TerminalView'))

const PANEL_TAB_RAIL_MIN_W = 700
const RIGHT_PANEL_DEFAULT_W = 380
const BROWSER_DOCK_W = 860

// Declare the window API type
declare global {
  interface Window {
    api: {
      terminal: {
        rename(id: string, newName: string): Promise<RenameTerminalResult>
        create: (options?: { id?: string; cwd?: string; name?: string; shell?: string; autoUtf8?: boolean; initCommand?: string }) => Promise<TerminalSession>
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
        lineLog: (filePath: string, startLine: number, endLine: number) => Promise<any>
        graph: (opts?: { count?: number; skip?: number }) => Promise<any>
        prProviders: () => Promise<PrProviderView[]>
        prProviderSave: (input: PrProviderInput) => Promise<PrProviderView[]>
        prProviderDelete: (id: string) => Promise<PrProviderView[]>
        prRemoteInfo: () => Promise<PrRemoteInfo>
        createPr: (payload: CreatePrPayload) => Promise<PrResult>
        prTest: (input: PrTestInput) => Promise<PrTestResult>
        prList: () => Promise<PrListResult>
        prTemplate: (base?: string) => Promise<{ content: string }>
        prCheckConflict: (base: string) => Promise<PrConflictResult>
        onMetaChanged: (callback: (data?: { commonDir?: string; kind?: 'status' | 'full' }) => void) => any
        removeMetaChangedListener: (handler?: any) => void
      }
      file: {
        read: (filePath: string) => Promise<any>
        write: (filePath: string, content: string) => Promise<any>
        readWithEncoding: (filePath: string, encoding?: string, forceOpen?: boolean) => Promise<{ content: string; encoding: string; bom: boolean; confidence: number; error?: string }>
        writeWithEncoding: (filePath: string, content: string, encoding?: string) => Promise<{ success: boolean; error?: string }>
        list: (dirPath: string) => Promise<any>
        getDrives: () => Promise<string[]>
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
        dir: (configDir?: string) => Promise<string>
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
      board: {
        records: (workspacePath: string) => Promise<import('@shared/types').BoardRecordsResult>
        create: (options: import('@shared/types').BoardCreateOptions) => Promise<import('@shared/types').BoardOpResult>
        finish: (workspacePath: string, recordId: string) => Promise<import('@shared/types').BoardOpResult>
        clear: (workspacePath: string, recordId: string) => Promise<import('@shared/types').BoardOpResult>
        merge: (workspacePath: string, recordId: string) => Promise<import('@shared/types').BoardMergeResult>
        mergeAbort: (workspacePath: string) => Promise<import('@shared/types').BoardOpResult>
      }
      theme: {
        setTitleBar: (options: { color: string; symbolColor: string; backgroundColor: string }) => void
      }
      appVersion: () => Promise<string>
      appHome: () => Promise<string>
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
        create: (options: { sessionId: string; cwd: string; autoApprove?: boolean; permissionMode?: string; resumeSessionId?: string; cliCommand?: string; configDir?: string; model?: string; enableWorktree?: boolean; computerUse?: boolean; browserUse?: boolean }) => Promise<{ success: boolean; error?: string }>
        send: (sessionId: string, message: string) => Promise<{ success: boolean; error?: string }>
        cancel: (sessionId: string) => Promise<boolean>
        forceStop: (sessionId: string) => Promise<{ success: boolean; error?: string }>
        destroy: (sessionId: string) => Promise<boolean>
        respondPermission: (sessionId: string, requestId: string, approved: boolean, tool?: string, toolInput?: Record<string, any>, feedback?: string) => Promise<{ success: boolean }>
        clearAndExecutePlan: (sessionId: string, planFilePath: string, model?: string, resume?: boolean) => Promise<{ success: boolean; error?: string }>
        listUserTurns: (sessionId: string, cwd: string) => Promise<any>
        setPermissionMode: (sessionId: string, mode: string) => Promise<{ success: boolean; error?: string }>
        setModel: (sessionId: string, model: string) => Promise<{ success: boolean; error?: string }>
        resolveModels: (sessionId?: string) => Promise<{ default: string; opus: string; sonnet: string; haiku: string }>
        resolveSkills: (sessionId?: string, cwd?: string) => Promise<import('@shared/types').AiSlashCommand[]>
        sideQuestion: (sessionId: string, question: string) => Promise<{ success: boolean; response?: string | null; synthetic?: boolean; error?: string }>
        setContextWindow: (sessionId: string, contextWindow: number) => Promise<{ success: boolean; contextPercent?: number | null; error?: string }>
        getContextInfo: (sessionId: string) => Promise<{ usedTokens: number | null; contextWindow: number | null } | null>
        setVisible: (visible: boolean) => Promise<void>
        setBusy: (busy: boolean) => void
        onModelChanged: (callback: (data: { sessionId: string; model: string }) => void) => any
        removeModelChangedListener: (handler?: any) => void
        askResume: (sessionId: string, answers: Record<string, string>) => Promise<{ success: boolean; error?: string }>
        resolveConfigDir: (configDir?: string) => Promise<string>
        listSessions: (cwd?: string, configDir?: string) => Promise<{ sessions: any[]; error?: string }>
        deleteSession: (sessionId: string, cwd: string, configDir?: string) => Promise<{ success: boolean; error?: string }>
        loadSessionMessages: (resumeSessionId: string, cwd: string, configDir?: string) => Promise<{ messages: any[]; model?: string; slashCommands?: any[]; error?: string; actualCwd?: string }>
        listAllSessions: (configDir?: string, currentCwd?: string) => Promise<{ sessions: import('@shared/types').AiSessionSummary[]; total?: number }>
        searchSessions: (query: string, opts?: import('@shared/types').AiSearchOptions) => Promise<{ sessions: import('@shared/types').AiSessionSearchGroup[]; truncated?: boolean }>
        loadSessionMessagesByDir: (resumeSessionId: string, projectDir: string, configDir?: string) => Promise<{ messages: any[]; model?: string; slashCommands?: any[]; error?: string; actualCwd?: string }>
        deleteSessionByDir: (sessionId: string, projectDir: string, configDir?: string) => Promise<{ success: boolean; error?: string }>
        revert: (payload: { sessionId: string; userMessageIndex: number; scope: 'conversation' | 'both'; cwd: string }) => Promise<{ success: boolean; error?: string }>
        fork: (payload: { sessionId: string; userMessageIndex: number; cwd: string }) => Promise<{ success: boolean; newClaudeSessionId?: string; error?: string }>
        onMessage: (callback: (data: any) => void) => any
        removeMessageListener: (handler?: any) => void
        onStreamToken: (callback: (data: { sessionId: string; token: string }) => void) => any
        removeStreamTokenListener: (handler?: any) => void
        onPermission: (callback: (data: any) => void) => any
        removePermissionListener: (handler?: any) => void
        onReady: (callback: (data: { sessionId: string; session_id?: string; cwd?: string }) => void) => any
        removeReadyListener: (handler?: any) => void
        onFileChange: (callback: (data: any) => void) => any
        removeFileChangeListener: (handler?: any) => void
        onProgress: (callback: (data: any) => void) => any
        removeProgressListener: (handler?: any) => void
        onError: (callback: (data: { sessionId: string; error: string }) => void) => any
        removeErrorListener: (handler?: any) => void
        initReplyCursor: (sessionId: string, cwd: string, configDir?: string) => Promise<import('@shared/types').AiReply | null>
        stopReplyCursor: (sessionId: string) => Promise<boolean>
        readReply: (sessionId: string) => Promise<boolean>
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
      dsh: {
        start: (cwd?: string) => Promise<{ ok: boolean; port?: number; error?: string }>
        stop: () => Promise<{ ok: boolean }>
        getPort: () => Promise<number | null>
        deleteSession: (sessionId: string, cwd?: string) => Promise<{ ok: boolean; error?: string }>
        plugin: (args: string[]) => Promise<{ ok: boolean; code: number | null; output: string }>
        restart: () => Promise<{ ok: boolean; port?: number; error?: string }>
        onReady: (callback: (data: { port: number }) => void) => any
        removeReadyListener: (handler?: any) => void
      }
    }
  }
}

type CenterView = 'terminal' | 'files' | 'browser' | 'search' | 'board'

// 网页调试停靠位置偏好（中栏 / 右栏覆盖 Nga tab），localStorage 持久化，默认右栏
function loadBrowserDockPref(): 'center' | 'right' {
  try { return localStorage.getItem('vibe-ide-browser-dock') === 'center' ? 'center' : 'right' } catch {}
  return 'right'
}

function saveBrowserDockPref(pos: 'center' | 'right') {
  try { localStorage.setItem('vibe-ide-browser-dock', pos) } catch {}
}

type OpenFileMode = 'auto' | 'edit' | 'diff'

interface OpenFileOpts {
  mode?: OpenFileMode
  lineNumber?: number
  record?: boolean
  relPath?: string
  git?: { isStaged?: boolean; commitHash?: string; gitStats?: { additions: number; deletions: number } }
  compare?: { content: string; path: string }
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

// /btw side-question result → desktop pet bubble (DesktopPet subscribes BTW_REPLY_EVENT)
function dispatchBtwReply(detail: { pending?: boolean; text?: string | null; error?: string }): void {
  window.dispatchEvent(new CustomEvent(BTW_REPLY_EVENT, { detail }))
}

export default function App() {
  const { t } = useI18n()
  const [initialWorkspace] = useState(loadSessionWorkspace)
  // 一个 cwd 只恢复一个 terminal tab（其余丢弃），gui/dsh 不变
  const initialTabs = useMemo(() => {
    const all = initialWorkspace?.sessions.flatMap(s => s.tabs) ?? []
    const seen = new Set<string>()
    return all.filter(t => {
      if (t.kind !== 'terminal') return true
      const key = t.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [initialWorkspace])
  const [sessions, setSessions] = useState<SessionTab[]>(initialTabs)
  const normCwdKey = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const keptGroups = useKeptGroups()
  // 稳定分组顺序:会话数组按创建序混杂插入,组序若按"首现位置"推导,删除组内会话会令该组位置跳变导致排布错位。
  // 用 session id 保序子序列判定:仅删/仅增(含 clone 插入、cwd 变更)→ 保持旧组序(被删组剔除、新组追加);
  // id 相对顺序被打乱(组/会话拖拽重排)→ 才跟随新首现序。
  // 空组保留位(keptGroups)按记录下标并入组序,与 SessionPanel 渲染序一致(键盘切会话、看板同步)。
  const stableGroupRef = useRef<{ ids: string[]; order: string[] } | null>(null)
  const stableGroupOrder = useMemo(() => {
    const sessionOrder: string[] = []
    const seen = new Set<string>()
    for (const s of sessions) {
      const key = normCwdKey(s.cwd)
      if (!seen.has(key)) { seen.add(key); sessionOrder.push(key) }
    }
    let base = sessionOrder
    const prev = stableGroupRef.current
    if (prev) {
      const newIds = sessions.map(s => s.id)
      const subseq = (outer: string[], inner: string[]) => {
        let j = 0
        for (const id of outer) {
          if (id === inner[j]) { j++; if (j === inner.length) return true }
        }
        return false
      }
      const sameIds = prev.ids.length === newIds.length && prev.ids.every((id, i) => id === newIds[i])
      const keepOrder = sameIds || subseq(prev.ids, newIds) || subseq(newIds, prev.ids)
      if (keepOrder) {
        base = prev.order.filter(k => seen.has(k))
        for (const k of sessionOrder) if (!base.includes(k)) base.push(k)
      }
    }
    const order = mergeGroupOrder(base, keptGroups)
    stableGroupRef.current = { ids: sessions.map(s => s.id), order }
    return order
  }, [sessions, keptGroups])
  // 按稳定组序重排的会话数组:分组模式取代 sessions 传面板与快捷键循环,组内会话保持原相对顺序
  const stableSessions = useMemo(() => {
    if (stableGroupOrder.length === 0) return sessions
    const pos = new Map<string, number>(stableGroupOrder.map((k, i) => [k, i]))
    return [...sessions].sort((a, b) => (pos.get(normCwdKey(a.cwd)) ?? Infinity) - (pos.get(normCwdKey(b.cwd)) ?? Infinity))
  }, [sessions, stableGroupOrder])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const id = initialWorkspace?.activeTabId ?? null
    return id && initialTabs.some(t => t.id === id) ? id : (initialTabs[0]?.id ?? null)
  })
  const [rightTerminalSessions, setRightTerminalSessions] = useState<Record<string, AuxTerminalTab[]>>({})  // 每个 session 独立的 aux terminal tabs（每 tab 含 1-3 个 terminal）
  const [activeAuxIndex, setActiveAuxIndex] = useState<Record<string, number>>({})  // 每个 session 当前 active 的 aux terminal 下标
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_W)
  const rightPanelPrevWidth = useRef(380)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [historyNavNonce, setHistoryNavNonce] = useState(0)

  const handleOpenHistoryTab = useCallback(() => {
    if (rightPanelCollapsed) {
      window.resizeBy(rightPanelWidth + 1, 0)
      setRightPanelCollapsed(false)
    }
    setHistoryNavNonce(n => n + 1)
  }, [rightPanelCollapsed, rightPanelWidth])

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
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const handleToggleLeftPanel = useCallback(() => setLeftPanelCollapsed(v => !v), [])
  // 左栏三态切换：三态之下显示右栏同款 Dir/Git 面板；进过一次后保持挂载（切回会话用 display 隐藏，保留面板内部状态）
  const [leftPanelView, setLeftPanelView] = useState<'session' | 'dir' | 'git'>('session')
  const [leftPanelsReady, setLeftPanelsReady] = useState(false)
  const handleLeftPanelViewChange = useCallback((view: 'session' | 'dir' | 'git') => {
    setLeftPanelView(view)
    if (view !== 'session') setLeftPanelsReady(true)
  }, [])
  const [isDragging, setIsDragging] = useState(false)
  const [isDragOverEdit, setIsDragOverEdit] = useState(false)
  const [centerView, setCenterView] = useState<CenterView>('terminal')
  // ── 文件 Tab 系统（全局共享一份，见 doc/file-tabs）──
  const [tabDirtyMap, setTabDirtyMap] = useState<Record<string, boolean>>({})
  const tabRuntimeRef = useRef(new Map<string, TabRuntime>())
  const tabSnapshotsRef = useRef<Record<string, TabSnapshot>>({})
  const [closeAsk, setCloseAsk] = useState<{ tabId: string } | null>(null)
  const closeAskRef = useRef(false); closeAskRef.current = closeAsk !== null
  const [sessionSwitchAsk, setSessionSwitchAsk] = useState<{ count: number } | null>(null)
  const sessionSwitchAskRef = useRef(false); sessionSwitchAskRef.current = sessionSwitchAsk !== null
  const tabPopoverGuardRef = useRef<null | (() => boolean)>(null)
  const fileTabs = useFileTabs(useCallback((id: string) => !tabRuntimeRef.current.get(id)?.dirty, []))
  const { tabs, activeTab, activeTabId, tabsRef, openTab, activateTab, closeTab, closeAll, updateTab } = fileTabs
  const activeTabRef = useRef<FileTabState | null>(null); activeTabRef.current = activeTab

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
  // useEffect 延迟同步,渲染帧内读到的是打开 overlay 前的 centerView(用于定侧/回落判断)
  const centerViewRef = React.useRef<CenterView>('terminal')
  const overlayKind = centerView === 'files' && tabs.length > 0 ? 'files' : null
  const overlaySnapRef = useRef<{ key: string | null; right: boolean; base: 'terminal' | 'board' }>({ key: null, right: false, base: 'terminal' })
  if (overlayKind && overlaySnapRef.current.key !== overlayKind) {
    const firstOpen = overlaySnapRef.current.key === null
    const base = firstOpen && centerViewRef.current === 'board' ? 'board' : overlaySnapRef.current.base
    overlaySnapRef.current = {
      key: overlayKind,
      right: !rightPanelCollapsed && rightPanelWidth >= PANEL_TAB_RAIL_MIN_W,
      base,
    }
  }
  if (!overlayKind && overlaySnapRef.current.key !== null) {
    overlaySnapRef.current = { key: null, right: false, base: 'terminal' }
  }
  const overlayOnRight = overlayKind !== null && overlaySnapRef.current.right && !rightPanelCollapsed
  const overlayOnRightRef = useRef(false); overlayOnRightRef.current = overlayOnRight
  // 左栏「看板激活」随 base 保持(overlay 期间不回落 session)
  const boardActive = overlayKind !== null ? overlaySnapRef.current.base === 'board' : centerView === 'board'
  // 中栏看板卡片:仅无 overlay 或 overlay 落右栏时显示(覆盖中栏时让位给文件)
  const boardCenterShown = boardActive && (overlayKind === null || overlayOnRight)
  const [dshSidebarShown, setDshSidebarShown] = useState(() => {
    try { return localStorage.getItem('vibe-ide-dsh-sidebar') === '1' } catch { return false }
  })
  const [dshThemeOverride, setDshThemeOverride] = useState(() => {
    try { return localStorage.getItem('vibe-ide-dsh-theme-override') !== '0' } catch { return true }
  })
  const [gitRefreshKey, setGitRefreshKey] = useState(0)

  // dsh sidebar 收起/展开：layout stub toggleSidebar 与 DshView 展开 trigger 都 dispatch 此 event
  useEffect(() => {
    const onToggle = () => {
      setDshSidebarShown(prev => {
        const next = !prev
        try { localStorage.setItem('vibe-ide-dsh-sidebar', next ? '1' : '0') } catch {}
        return next
      })
    }
    window.addEventListener('vibe:dsh-sidebar-toggle', onToggle)
    return () => window.removeEventListener('vibe:dsh-sidebar-toggle', onToggle)
  }, [])

  // 空闲时预热 dsh chunk（lazy 拆分后首次进入 dsh 要现场加载 2.5MB，会卡交互）
  useEffect(() => {
    const t = window.setTimeout(() => {
      const idle = (window as any).requestIdleCallback
      if (typeof idle === 'function') {
        idle(() => { void import('./components/DshView') }, { timeout: 2000 })
      } else {
        void import('./components/DshView')
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [])

  // 有需要恢复的 DSH 会话时，后台先把 DSH server 拉起来；具体会话仍点击后再加载
  useEffect(() => {
    const hasDsh = initialWorkspace?.sessions.some(s => s.tabs.some(t => t.kind === 'dsh')) ?? false
    if (!hasDsh) return
    const t = window.setTimeout(() => {
      window.api.dsh.start().catch(() => {})
    }, 1000)
    return () => clearTimeout(t)
  }, [initialWorkspace])

  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0)
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
      const next = [{ path: fullPath, line, endLine }, ...prev]
      if (next.length <= 7) return next
      // 超限时从尾部淘汰未固定的条目；全固定则保持（略超上限）
      const result = [...next]
      for (let i = result.length - 1; i >= 0 && result.length > 7; i--) {
        if (!result[i].pinned) result.splice(i, 1)
      }
      return result
    })
  }, [])

  // 固定/取消固定最近文件（pinned 不被 max-7 淘汰，hover 预览中置顶）
  const togglePinRecentFile = useCallback((fullPath: string) => {
    if (!fullPath) return
    const norm = (p: string) => p.replace(/\\/g, '/')
    const target = norm(fullPath)
    setRecentFiles(prev => prev.map(r => (norm(r.path) === target ? { ...r, pinned: !r.pinned } : r)))
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
  const dshAutoTitledRef = useRef<Set<string>>(new Set())
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
  const [appFocused, setAppFocused] = useState(true)
  const agentStatus = useMemo(() => {
    const result: Record<string, 'running' | 'idle' | 'warn'> = {}
    for (const s of sessions) {
      const busy = terminalBusy[s.id] || aiBusy[s.id]
      result[s.id] = busy ? 'running' : (warnSessions[s.id] ? 'warn' : 'idle')
    }
    return result
  }, [sessions, terminalBusy, aiBusy, warnSessions])
  // 任意 session(AI tab / dsh / 主终端输出活动)处于 running → 暂停 git 元数据监听
  // (AI 每轮裸 git 命令刷 .git/index 会反射成 GitTab 刷新风暴);全部非 running 才恢复。
  // 主进程 setGitMetaPaused 幂等,重复上报为 no-op。
  useEffect(() => {
    const anyRunning = Object.values(agentStatus).some(v => v === 'running')
    window.api.ai.setBusy(anyRunning)
  }, [agentStatus])
  useEffect(() => {
    const prev = prevBusyRef.current
    const updates: Record<string, boolean> = {}
    let changed = false
    // 看板开启时没有"选中的session"（effSel=null）：所有 running→idle 一视同仁记 warn
    const effSel = boardActive ? null : activeSessionId
    for (const s of sessions) {
      const sid = s.id
      const busy = !!(terminalBusy[sid] || aiBusy[sid])
      const prevBusy = prev[sid] ?? false
      // 非被选中 session：running→idle 变 warn，并触发一次回复快照读取（游标未注册时主进程 no-op）
      if (prevBusy && !busy && sid !== effSel) {
        updates[sid] = true
        changed = true
        window.api.ai.readReply(sid).catch(() => {})
      }
    }
    if (effSel && warnSessionsRef.current[effSel]) {
      updates[effSel] = false
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
  }, [sessions, terminalBusy, aiBusy, activeSessionId, centerView])

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
  const [focusedPanel, setFocusedPanel] = useState<'term' | 'right' | null>(null)
  const [wordWrap, setWordWrap] = useState(() => {
    try { return localStorage.getItem('vibe-ide-word-wrap') === 'true' } catch { return false }
  })
  const [autoUtf8, setAutoUtf8] = useState(() => {
    try { return localStorage.getItem('vibe-ide-auto-utf8') !== 'false' } catch { return true }
  })
  const [inlineDiff, setInlineDiff] = useState(() => {
    try { return localStorage.getItem('vibe-ide-inline-diff') !== 'false' } catch { return true }
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
  const [showSessionButtons, setShowSessionButtons] = useState(() => {
    try { return localStorage.getItem('vibe-ide-session-buttons') !== 'false' } catch { return true }
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
  // Keep ref in sync so IPC listener always sees latest centerView
  React.useEffect(() => {
    centerViewRef.current = centerView
  }, [centerView])

  // Session panel "Task Board" button requests the board center view.
  // The board is the bottom layer: no selected session, no ESC semantics of its own.
  React.useEffect(() => {
    const openBoard = () => setCenterView('board')
    window.addEventListener(BOARD_FOCUS, openBoard)
    return () => window.removeEventListener(BOARD_FOCUS, openBoard)
  }, [])

  // 持久化当前打开的所有 tab，按 cwd 聚合为 Session 容器
  // 分组模式下按稳定组序(stableSessions)保存，保证重启后组排布与删除前一致
  React.useEffect(() => {
    const byCwd = new Map<string, { cwd: string; tabs: SessionTab[] }>()
    for (const s of (groupSessionsByCwd ? stableSessions : sessions)) {
      const key = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
      const group = byCwd.get(key) || { cwd: s.cwd, tabs: [] }
      group.tabs.push(s)
      byCwd.set(key, group)
    }
    const sessionContainers: Session[] = []
    for (const group of byCwd.values()) {
      const activeTabId = group.tabs.some(t => t.id === activeSessionId) ? activeSessionId! : group.tabs[0].id
      sessionContainers.push({
        id: group.cwd.replace(/\\/g, '/').replace(/\/+$/, ''),
        cwd: group.cwd,
        name: group.tabs[0].name,
        activeTabId,
        tabs: group.tabs,
      })
    }
    saveSessionWorkspace({ activeTabId: activeSessionId, sessions: sessionContainers })
  }, [sessions, stableSessions, activeSessionId, groupSessionsByCwd])

  // 恢复的终端 tab 直接后台创建真实 PTY，不需要用户点击
  React.useEffect(() => {
    const terminalTabs = initialTabs.filter(t => t.kind === 'terminal')
    if (terminalTabs.length === 0) return
    let cancelled = false
    void (async () => {
      for (const tab of terminalTabs) {
        if (cancelled) break
        try {
          if (!sessionsRef.current.some(s => s.id === tab.id)) continue
          const real = await window.api.terminal.create({
            cwd: tab.cwd,
            shell: getMainShellType(),
            autoUtf8,
            initCommand: readDefaultAgent(),
          })
          const realTab: SessionTab = { ...real, kind: 'terminal', loaded: true, emoji: tab.emoji }
          if (cancelled) {
            await window.api.terminal.close(real.id)
            break
          }
          if (!sessionsRef.current.some(s => s.id === tab.id)) {
            await window.api.terminal.close(real.id)
            continue
          }
          setSessions(prev => {
            if (!prev.some(s => s.id === tab.id)) return prev
            const idx = prev.findIndex(s => s.id === tab.id)
            const next = prev.filter(s => s.id !== tab.id)
            next.splice(Math.min(idx, next.length), 0, realTab)
            return next
          })
          setActiveSessionId(prev => prev === tab.id ? real.id : prev)
        } catch (err) {
          console.error('Failed to restore terminal session:', err)
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // AI ready 时记录 CC GUI 的真实 Claude session id，供重启后 --resume 恢复
  React.useEffect(() => {
    const handler = window.api.ai.onReady((data: any) => {
      const sid: string | undefined = data?.sessionId
      const sessionId: string | undefined = data?.session_id
      const cwd: string | undefined = data?.cwd
      if (sid && sessionId) {
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, resumeSessionId: s.resumeSessionId || sessionId } : s))
      }
      if (sid && cwd) {
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, resumeCwd: cwd } : s))
      }
    })
    return () => window.api.ai.removeReadyListener(handler)
  }, [])

  React.useEffect(() => {
    aiStore.setActiveSession(activeSessionId)
  }, [activeSessionId])

  // Terminal refs for focus management (keyed by sessionId)
  const terminalRefs = useRef<Record<string, TerminalViewHandle>>({})
  const aiTabRefs = useRef<Record<string, AiTabHandle>>({})
  const dshRefs = useRef<Record<string, DshViewHandle>>({})
  const browserViewRef = useRef<BrowserViewHandle | null>(null)
  const [browserDocked, setBrowserDocked] = useState(false)
  const [browserDockNonce, setBrowserDockNonce] = useState(0)
  const browserDockedRef = useRef(false)
  const browserDockPrevWidth = useRef<number | null>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const centerPanelRef = useRef<HTMLDivElement>(null)
  const sessionPanelRef = useRef<SessionPanelHandle>(null)
  // Cursor position (DiffViewer 回传，供行历史等使用)
  interface CursorHistoryEntry { fullPath: string; line: number; column: number }
  const cursorRef = useRef<CursorHistoryEntry | null>(null)
  // 视口中间可见行（居中还原用）— DiffViewer 的 onDidScrollChange 实时回写，供最近文件行号
  interface VisibleLineEntry { fullPath: string; line: number }
  const visibleLineRef = useRef<VisibleLineEntry | null>(null)


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
  // deps 不含 sessions:AI 响应期 OSC 标题/onReady 的 setSessions(map) 会产生新数组引用,
  // 若依赖 sessions 会被误触重跑,反复 focus 抢走宠物气泡等外部输入焦点。mode 取 sessionsRef 即可
  useEffect(() => {
    if (centerView === 'terminal' && activeSessionId) {
      const mode = sessionsRef.current.find(s => s.id === activeSessionId)?.kind
      const timer = setTimeout(() => {
        if (mode === 'gui') {
          aiTabRefs.current[activeSessionId]?.focus()
        } else if (mode === 'dsh') {
          dshRefs.current[activeSessionId]?.focus()
        } else {
          terminalRefs.current[activeSessionId]?.focus()
        }
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
    try { localStorage.setItem('vibe-ide-session-buttons', String(showSessionButtons)) } catch {}
  }, [showSessionButtons])
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
      const at = activeTabRef.current
      if (!(at?.kind === 'diff' && at.defaultEdit && !at.compareOriginalPath)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      if (dragHideTimer) { clearTimeout(dragHideTimer); dragHideTimer = null }
      setIsDragOverEdit(true)
    }

    const onDragLeave = (e: DragEvent) => {
      const panel = centerPanelRef.current
      if (!panel) return
      if (activeTabRef.current?.kind === 'markdown') return
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
      const baseTab = activeTabRef.current
      if (!(baseTab?.kind === 'diff' && baseTab.defaultEdit && !baseTab.compareOriginalPath)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (dragHideTimer) { clearTimeout(dragHideTimer); dragHideTimer = null }
      setIsDragOverEdit(false)

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      const droppedPath = (files[0] as any).path as string | undefined
      if (droppedPath) {
        if (droppedPath === baseTab.fullPath) return
        await openCompareTab(baseTab, droppedPath)
      } else {
        const file = files[0]
        try {
          const buffer = await file.arrayBuffer()
          const compareContent = new TextDecoder().decode(buffer)
          await openCompareTab(baseTab, file.name, compareContent)
        } catch {
          return
        }
      }
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

  // dsh 会话发送（宠物发送 / 右键追加 / 定时共用）：dshId 优先恢复的历史会话 id
  const sendToDshSession = useCallback(async (sessionId: string, text: string) => {
    handleCommandEntered(sessionId, text)
    const api = await getDshApi(sessionsRef.current.find(s => s.id === sessionId)?.cwd)
    const dshId = sessionsRef.current.find(s => s.id === sessionId)?.dshSessionId || sessionId
    await api.sessions.prompt({ sessionId: dshId, mode: 'queue', content: [{ type: 'text', text }] })
  }, [handleCommandEntered])

  const sendDraftLine = useCallback(async (sessionId: string | null | undefined, text: string) => {
    if (!sessionId) return
    const mode = sessionsRef.current.find(s => s.id === sessionId)?.kind
    if (mode === 'gui') {
      // /btw prefix → non-interrupting side question. This funnel is the single
      // entry for keypad / context input / BTW_PREFIX prefill, so detection lives
      // here once and the pet stays dumb. Answer returns via BTW_REPLY_EVENT.
      const btw = /^\s*\/btw\b\s*([\s\S]*)$/i.exec(text)
      if (btw) {
        const question = btw[1].trim()
        if (question) {
          dispatchBtwReply({ pending: true })
          window.api.ai.sideQuestion(sessionId, question)
            .then((r) => {
              if (r?.success) dispatchBtwReply({ text: r.response })
              else dispatchBtwReply({ error: r?.error || 'Side question failed' })
            })
            .catch((e: any) => dispatchBtwReply({ error: e?.message || String(e) }))
          return
        }
      }
      aiTabRefs.current[sessionId]?.sendText(text)
      aiTabRefs.current[sessionId]?.focus()
      return
    }
    if (mode === 'dsh') {
      try {
        const api = await getDshApi(sessionsRef.current.find(s => s.id === sessionId)?.cwd)
        const dshId = sessionsRef.current.find(s => s.id === sessionId)?.dshSessionId || sessionId
        // 自动命名：仅当 DSH 会话还没有任何用户问题时才用当前文本命名，
        // 避免覆盖 DSH 自己按“最早问题”生成的标题（恢复的历史会话也保留原标题）。
        if (!sessionsRef.current.find(s => s.id === sessionId)?.dshSessionId && !manuallyRenamedRef.current.has(sessionId) && !dshAutoTitledRef.current.has(sessionId)) {
          const historyRes = await api.sessions.history({ sessionId: dshId, maxMessages: 200 }).catch(() => null)
          const hasExistingUserMessage = !!historyRes?.result?.ok
            && ((historyRes.result.value?.events ?? []) as any[]).some(
              (e: any) => e.event?.type === 'user/message' && e.event?.data?.source?.kind === 'user'
            )
          if (hasExistingUserMessage) {
            // 已有历史问题：不再自动命名，避免把标题改成最后一个问题
            dshAutoTitledRef.current.add(sessionId)
          } else {
            const title = text.replace(/\s+/g, ' ').trim().slice(0, 30)
            if (title) {
              dshAutoTitledRef.current.add(sessionId)
              try {
                await api.sessions.rename({ sessionId: dshId, title })
              } catch (e) {
                dshAutoTitledRef.current.delete(sessionId)
                console.error('Failed to auto-rename dsh session:', e)
              }
            }
          }
        }
        await sendToDshSession(sessionId, text)
      } catch (e) {
        console.error('Failed to send to dsh session:', e)
      }
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
  }, [waitDraftIdle, sendToDshSession])


  // gui/dsh session 无 PTY：terminal.rename 失败时本地改名
  const applyRename = useCallback(async (id: string, name: string) => {
    const r = await window.api.terminal.rename(id, name)
    if (r.success && r.session) setSessions(prev => prev.map(s => s.id === id ? { ...s, ...r.session! } : s))
    else setSessions(prev => prev.map(s => s.id === id ? { ...s, name } : s))
  }, [])

  const handleDshTitleChange = useCallback(async (sessionId: string, title: string) => {
    if (manuallyRenamedRef.current.has(sessionId)) return
    const cur = sessionsRef.current.find(s => s.id === sessionId)
    if (!cur || cur.name === title) return
    await applyRename(sessionId, title)
  }, [applyRename])

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
    const target = sessionsRef.current.find(s => s.id === sessionId)
    const isGui = target?.kind === 'gui'
    const isDsh = target?.kind === 'dsh'
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
      } else if (isDsh) {
        try {
          await sendToDshSession(sessionId, lines[i])
        } catch (e) {
          console.error('Failed to pipe to dsh session:', e)
        }
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
  }, [sendToDshSession])

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

  // 定时任务：向指定 session 入管道，不切换当前会话
  const handlePipeToSession = useCallback((sessionId: string, command: string) => {
    if (!pipeQueueRef.current.has(sessionId)) pipeQueueRef.current.set(sessionId, [])
    pipeQueueRef.current.get(sessionId)!.push(command)
    if (!pipeProcessingRef.current.get(sessionId)) {
      pipeProcessingRef.current.set(sessionId, true)
      processPipeQueue(sessionId)
    }
  }, [processPipeQueue])

  const cancelPipeRef = useRef(cancelPipe)
  cancelPipeRef.current = cancelPipe
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  const handleBrowseUrl = useCallback((url: string) => {
    if (!url) return
    if (browserDockedRef.current) {
      setBrowserDockNonce(n => n + 1)
      browserViewRef.current?.loadURL(url)
      return
    }
    if (centerViewRef.current === 'browser') { browserViewRef.current?.loadURL(url); return }
    if (loadBrowserDockPref() === 'right' && sessionsRef.current.find(s => s.id === activeSessionIdRef.current)?.cwd) {
      setBrowserStartUrl(url)
      browserDockedRef.current = true
      setBrowserDocked(true)
      setBrowserDockNonce(n => n + 1)
      return
    }
    setBrowserStartUrl(url)
    setCenterView('browser')
  }, [])

  const handleOpenFileInBrowser = useCallback((fullPath: string) => {
    handleBrowseUrl(toFileUrl(fullPath))
  }, [handleBrowseUrl])

  useEffect(() => {
    (window as any).__vibeSendLine = (text: string) => sendDraftLine(activeSessionIdRef.current, text)
    ;(window as any).__vibeAppendInput = (text: string) => {
      const sid = activeSessionIdRef.current
      if (!sid) return
      if (sessionsRef.current.find(s => s.id === sid)?.kind === 'gui') {
        aiTabRefs.current[sid]?.appendText(text)
        aiTabRefs.current[sid]?.focus()
      } else {
        terminalRefs.current[sid]?.appendText(text)
        terminalRefs.current[sid]?.focus()
      }
    }
    ;(window as any).__vibeBrowse = handleBrowseUrl
  }, [waitDraftIdle, sendDraftLine, handleBrowseUrl])

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

  // ═══ 文件 Tab 系统核心操作 ═══
  const relFromCwd = useCallback((fullPath: string) => {
    const cwd = sessionsRef.current.find(s => s.id === activeSessionIdRef.current)?.cwd
    if (!cwd) return fullPath
    const c = cwd.replace(/\\/g, '/').replace(/\/$/, '')
    const p = fullPath.replace(/\\/g, '/')
    if (p.toLowerCase().startsWith(c.toLowerCase() + '/')) return p.slice(c.length + 1)
    return fullPath
  }, [])

  const openFileView = useCallback((fullPath: string, opts: OpenFileOpts = {}) => {
    const mode: OpenFileMode = opts.mode ?? 'auto'
    const kind = (mode === 'diff' || mode === 'edit') ? 'diff' as const : autoViewKind(fullPath)
    const name = baseName(fullPath)
    const buildTab = (): FileTabState => kind === 'diff' ? {
      id: makeTabId('diff'),
      kind: 'diff',
      fullPath,
      fileName: name,
      filePath: opts.relPath ?? relFromCwd(fullPath),
      isStaged: !!opts.git?.isStaged,
      commitHash: opts.git?.commitHash,
      gitStats: opts.git?.gitStats,
      defaultEdit: mode !== 'diff',
      viewMode: mode === 'diff' ? 'diff' : 'edit',
      lineNumber: opts.lineNumber,
      jumpNonce: 1,
      revision: 1,
      compareOriginalContent: opts.compare?.content,
      compareOriginalPath: opts.compare?.path,
    } : {
      id: makeTabId(kind),
      kind,
      fullPath,
      fileName: name,
      lineNumber: opts.lineNumber,
    }
    const { tab: opened, existed, evicted } = openTab(buildTab)
    if (evicted) {
      delete tabSnapshotsRef.current[evicted.id]
      tabRuntimeRef.current.delete(evicted.id)
      setTabDirtyMap(prev => {
        if (!(evicted.id in prev)) return prev
        const n = { ...prev }
        delete n[evicted.id]
        return n
      })
    }
    if (existed) {
      const patch: Record<string, unknown> = {}
      if (opts.lineNumber && opts.lineNumber > 0) {
        patch.lineNumber = opts.lineNumber
        patch.jumpNonce = (opened.jumpNonce ?? 0) + 1
      }
      // 未保存的 tab 不重拉内容，避免覆盖内存 buffer
      if (opened.kind === 'diff' && !tabRuntimeRef.current.get(opened.id)?.dirty) {
        if (opts.git) {
          patch.gitStats = opts.git.gitStats
          patch.isStaged = !!opts.git.isStaged
          patch.revision = opened.revision + 1
        }
        if (opts.compare) {
          patch.compareOriginalContent = opts.compare.content
          patch.revision = ((patch.revision as number | undefined) ?? opened.revision) + 1
        }
      }
      if (Object.keys(patch).length) updateTab(opened.id, patch as Partial<FileTabState>)
    }
    if (opts.record !== false) recordRecentFile(fullPath, opts.lineNumber)
    setCenterView('files')
  }, [openTab, updateTab, recordRecentFile, relFromCwd])

  const flushTabVisibleLine = useCallback((tab: FileTabState | null | undefined) => {
    if (!tab || tab.kind !== 'diff') return
    const v = visibleLineRef.current
    if (v && v.fullPath === tab.fullPath && v.line > 0) recordRecentFile(tab.fullPath, v.line)
  }, [recordRecentFile])

  const returnToBaseView = useCallback(() => {
    setCenterView(overlaySnapRef.current.base === 'board' ? 'board' : 'terminal')
  }, [])

  const getTabSnapshot = useCallback((tabId: string): TabSnapshot | null => tabSnapshotsRef.current[tabId] ?? null, [])
  const pushTabSnapshot = useCallback((tabId: string, s: TabSnapshot) => { tabSnapshotsRef.current[tabId] = s }, [])
  const handleTabRuntime = useCallback((tabId: string, rt: TabRuntime | null) => {
    if (rt) tabRuntimeRef.current.set(tabId, rt)
    else tabRuntimeRef.current.delete(tabId)
    setTabDirtyMap(prev => {
      const cur = !!rt?.dirty
      if (!!prev[tabId] === cur) return prev
      const n = { ...prev }
      if (cur) n[tabId] = true
      else delete n[tabId]
      return n
    })
  }, [])

  const closeAllTabs = useCallback(() => {
    closeAll()
    tabSnapshotsRef.current = {}
    tabRuntimeRef.current.clear()
    setTabDirtyMap({})
  }, [closeAll])

  const closeTabNow = useCallback((tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId)
    flushTabVisibleLine(tab)
    const nextId = closeTab(tabId)
    delete tabSnapshotsRef.current[tabId]
    tabRuntimeRef.current.delete(tabId)
    setTabDirtyMap(prev => {
      if (!(tabId in prev)) return prev
      const n = { ...prev }
      delete n[tabId]
      return n
    })
    if (!nextId) returnToBaseView()
  }, [closeTab, flushTabVisibleLine, returnToBaseView])

  const requestCloseTabById = useCallback((tabId: string) => {
    if (closeAskRef.current) return
    if (tabPopoverGuardRef.current?.()) return
    const rt = tabRuntimeRef.current.get(tabId)
    if (rt?.dirty) { activateTab(tabId); setCloseAsk({ tabId }); return }
    closeTabNow(tabId)
  }, [activateTab, closeTabNow])

  const confirmCloseTab = useCallback(async (mode: 'save' | 'discard') => {
    const ask = closeAsk
    if (!ask) return
    setCloseAsk(null)
    if (mode === 'save') {
      try { await tabRuntimeRef.current.get(ask.tabId)?.save() } catch {}
    }
    closeTabNow(ask.tabId)
  }, [closeAsk, closeTabNow])

  const closeAllTabsAndReturn = useCallback(() => {
    for (const tb of tabsRef.current) flushTabVisibleLine(tb)
    closeAllTabs()
    setCenterView('terminal')
  }, [flushTabVisibleLine, closeAllTabs])

  // 切会话时的 tab 处置：中栏显示 → 全关回终端；右栏 overlay 且 cwd 不变 → 保留；
  // 有关闭前有未保存 → 先收起并发确认（保存/不保存/取消，取消则保留在后台）
  const applySessionTabPolicy = useCallback((nextSessionId: string) => {
    if (tabsRef.current.length === 0) { setCenterView('terminal'); return }
    const prevCwd = sessionsRef.current.find(s => s.id === activeSessionIdRef.current)?.cwd
    const nextCwd = sessionsRef.current.find(s => s.id === nextSessionId)?.cwd
    const norm = (p?: string) => (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (overlayOnRightRef.current && norm(prevCwd) === norm(nextCwd)) return
    if (sessionSwitchAskRef.current) return
    const dirtyCount = tabsRef.current.filter(t => tabRuntimeRef.current.get(t.id)?.dirty).length
    if (dirtyCount > 0) {
      setCenterView('terminal')
      setSessionSwitchAsk({ count: dirtyCount })
      return
    }
    closeAllTabsAndReturn()
  }, [closeAllTabsAndReturn])

  const confirmSessionSwitch = useCallback(async (mode: 'save' | 'discard') => {
    setSessionSwitchAsk(null)
    if (mode === 'save') {
      for (const t of tabsRef.current) {
        const rt = tabRuntimeRef.current.get(t.id)
        if (rt?.dirty) { try { await rt.save() } catch {} }
      }
    }
    closeAllTabsAndReturn()
  }, [closeAllTabsAndReturn])

  // 未保存确认弹窗 ESC 取消
  useEffect(() => {
    if (!closeAsk && !sessionSwitchAsk) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (closeAskRef.current) setCloseAsk(null)
      else setSessionSwitchAsk(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeAsk, sessionSwitchAsk])

  // md 预览 → 编辑模式（diff/edit 视图）：与 Ctrl+L togglePreview 的 markdown 分支共用
  const openMarkdownInEditor = useCallback((fullPath: string) => {
    openFileView(fullPath, { mode: 'edit' })
  }, [openFileView])

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
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...result.session! } : s))
    }
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
        if (centerView === 'files' && activeTabRef.current?.kind === 'markdown') {
          e.preventDefault()
          e.stopImmediatePropagation()
          window.dispatchEvent(new CustomEvent(MD_SEARCH_OPEN))
        } else if (centerView !== 'files') {
          e.preventDefault()
          e.stopImmediatePropagation()
          setShowSearchDropdown(true)
          setSearchFocusTrigger(k => k + 1)
        }
      }

      // terminal.next / terminal.prev → blur right panel, switch session, focus terminal
      // Use visual order: grouped by cwd when grouping enabled, raw array order otherwise
      // 分组模式下用 stableSessions(稳定组序),与左侧面板视觉排布一致:删除会话不改变组序
      const visualOrder = groupSessionsByCwd ? stableSessions : sessions

      if (eventMatchesBinding(e, bindings['terminal.next'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ;(document.activeElement as HTMLElement)?.blur()
        const idx = visualOrder.findIndex(s => s.id === activeSessionId)
        const next = (idx + 1) % visualOrder.length
        if (visualOrder[next]) {
          const nextId = visualOrder[next].id
          const nextMode = sessionsRef.current.find(s => s.id === nextId)?.kind
          setActiveSessionId(nextId)
          applySessionTabPolicy(nextId)
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
          const nextMode = sessionsRef.current.find(s => s.id === nextId)?.kind
          setActiveSessionId(nextId)
          applySessionTabPolicy(nextId)
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
        } else if (centerView === 'files') {
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
            if (sessionsRef.current.find(s => s.id === activeSessionId)?.kind === 'dsh') {
              void sendToDshSession(activeSessionId, cmds[idx])
            } else {
              window.api.terminal.write(activeSessionId, cmds[idx].replace(/\n/g, '\x1b\r') + '\r')
            }
          }
          setShowHistory(false)
          return
        }
      }

      // view.togglePreview — Ctrl+L: toggle diff/edit ↔ markdown preview
      if (eventMatchesBinding(e, bindings['view.togglePreview'])) {
        const at = activeTabRef.current
        if (at?.kind === 'markdown') {
          e.preventDefault()
          e.stopImmediatePropagation()
          openMarkdownInEditor(at.fullPath)
          return
        } else if (at?.kind === 'diff') {
          if (autoViewKind(at.fullPath) === 'markdown') {
            e.preventDefault()
            e.stopImmediatePropagation()
            openFileView(at.fullPath, { mode: 'auto' })
            return
          }
        }
      }

      // Escape priority: directory picker → call graph → code search → explore result → search dropdown → focus return
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (dirPickerRef.current) {
          e.preventDefault(); e.stopImmediatePropagation()
          setDirPicker(null)
          return
        }
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
              const mode = sessionsRef.current.find(s => s.id === activeSessionId)?.kind
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
        openFileView(entry.fullPath, { mode: 'edit', lineNumber: entry.line, record: false })
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
      openFileView(entry.fullPath, { mode: 'edit', lineNumber: entry.line, record: false })
    }
  }, [openFileView])

  const handleQuickOpenSelect = useCallback((fullPath: string, relativePath: string) => {
    openFileView(fullPath, { mode: 'edit', relPath: relativePath, record: false })
    closeQuickOpen()
  }, [openFileView, closeQuickOpen])

  // Get cwd of the currently active session
  const activeSessionCwd = sessions.find(s => s.id === activeSessionId)?.cwd ?? null
  const leftWorktreeNav = activeSessionId ? sessionWorktreeNav[activeSessionId] ?? null : null
  const leftEffectiveGitPath = leftWorktreeNav?.worktreePath || activeSessionCwd

  // 本地构造 gui/dsh session 记录（不建 PTY，三者互斥省内存）
  function makeLocalSession(cwd: string, opts?: { name?: string; id?: string }): SessionTab {
    return {
      id: opts?.id || `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: opts?.name || `Terminal ${sessionsRef.current.length + 1}`,
      cwd,
      active: true,
      createdAt: Date.now(),
      kind: 'terminal',
      loaded: true,
    }
  }

  const addSessionRecord = useCallback((session: SessionTab, parentId?: string | null, activate = true) => {
    // term 会话默认随机 emoji（落到具体 emoji 而非类型 SVG），克隆时父 emoji 优先
    const rec = session.kind === 'terminal' && session.emoji === undefined
      ? { ...session, emoji: randomTermEmoji() }
      : session
    setSessions(prev => {
      if (prev.some(s => s.id === rec.id)) return prev
      if (parentId == null) return [...prev, rec]
      const parentIndex = prev.findIndex(s => s.id === parentId)
      if (parentIndex === -1) return [...prev, rec]
      const next = [...prev]
      next.splice(parentIndex + 1, 0, rec)
      return next
    })
    if (!activate) return
    setActiveSessionId(session.id)
    applySessionTabPolicy(session.id)
  }, [applySessionTabPolicy])

  const createTermSession = useCallback(async (cwd: string, shell: string = getMainShellType(), initOverride?: string, activate = true) => {
    const session = await window.api.terminal.create({ cwd, shell, autoUtf8, initCommand: initOverride ?? readDefaultAgent() })
    const tab: SessionTab = { ...session, kind: 'terminal', loaded: true }
    addSessionRecord(tab, null, activate)
    return session
  }, [autoUtf8, addSessionRecord])

  // Create a new session — 打开自建目录选择弹窗（选目录 + 类型）
  const [isOpening, setIsOpening] = useState(false)
  const [dirPicker, setDirPicker] = useState<{ initialDir: string; shell?: string } | null>(null)
  const dirPickerRef = useRef(dirPicker); dirPickerRef.current = dirPicker
  const handleCreateSession = useCallback((shell: string = getMainShellType()) => {
    let initialDir = 'C:\\'
    try {
      const last = localStorage.getItem('vibe-ide-dirpicker-last-dir')
      if (last) initialDir = last
      else if (activeSessionCwd) initialDir = activeSessionCwd
      else {
        const recent = cwdStore.getRecentDirs()
        if (recent.length > 0) initialDir = recent[0]
      }
    } catch {}
    setDirPicker({ initialDir, shell })
  }, [activeSessionCwd])

  // 右键「新建」：在当前 cwd 直接创建对应类型，不弹目录选择
  const handleNewSessionHere = useCallback(async (cwd: string, mode: 'term' | 'gui' | 'dsh') => {
    try {
      setIsOpening(true)
      if (mode === 'term') {
        await createTermSession(cwd)
      } else {
        const session = makeLocalSession(cwd)
        addSessionRecord({ ...session, kind: mode, loaded: true })
      }
    } catch (err) {
      console.error('Failed to create session here:', err)
    } finally {
      setIsOpening(false)
    }
  }, [createTermSession, addSessionRecord])

  // 组头终端下拉：在指定 cwd 新建终端并执行命令（initOverride 顶掉默认 agent 命令）
  const handleNewTermCommand = useCallback(async (cwd: string, command: string) => {
    try {
      setIsOpening(true)
      await createTermSession(cwd, getMainShellType(), command)
    } catch (err) {
      console.error('Failed to run command in new terminal:', err)
    } finally {
      setIsOpening(false)
    }
  }, [createTermSession])

  const handleDirPickerConfirm = useCallback(async (cwd: string, mode: 'term' | 'gui' | 'dsh') => {
    setDirPicker(null)
    try { localStorage.setItem('vibe-ide-dirpicker-last-dir', cwd) } catch {}
    try {
      setIsOpening(true)
      if (mode === 'term') {
        await createTermSession(cwd, dirPicker?.shell)
      } else {
        const session = makeLocalSession(cwd)
        addSessionRecord({ ...session, kind: mode, loaded: true })
      }
    } catch (err) {
      console.error('Failed to create session:', err)
    } finally {
      setIsOpening(false)
    }
  }, [createTermSession, addSessionRecord, dirPicker])

  // Create a terminal session at a specific path (no directory picker)
  const handleCreateSessionAt = useCallback(async (cwd: string, shell: string = getMainShellType()) => {
    try {
      setIsOpening(true)
      return await createTermSession(cwd, shell)
    } catch (err) {
      console.error('Failed to create terminal session at path:', err)
      return null
    } finally {
      setIsOpening(false)
    }
  }, [createTermSession])

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
          openFileView(data.path, { mode: 'edit', relPath: filePath, record: false })
        }
      }
    })
    return () => {
      window.api.removeStartupOpenPathListener(handler)
    }
  }, [handleCreateSessionAt, openFileView])

  // Clone a terminal session (same cwd), insert below parent
  const handleCloneSession = useCallback(async (parentId: string | null, cwd: string, shell?: string, name?: string) => {
    const parent = parentId ? sessions.find(s => s.id === parentId) : undefined
    const parentMode = parent?.kind
    const parentEmoji = parent?.emoji
    if (parentMode === 'gui' || parentMode === 'dsh') {
      const session = makeLocalSession(cwd, { name })
      addSessionRecord({ ...session, kind: parentMode, loaded: true, emoji: parentEmoji }, parentId)
      return
    }
    try {
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8, name, initCommand: readDefaultAgent() })
      addSessionRecord({ ...session, kind: 'terminal', loaded: true, emoji: parentEmoji }, parentId)
    } catch (err) {
      console.error('Failed to clone terminal session:', err)
    }
  }, [autoUtf8, sessions, addSessionRecord])

  // 分屏：仅 terminal 生效。主 session 视图下方新增同 cwd 的副屏 PTY；
  // 副屏不进 sessions（左侧列表无感知），也不参与 running/idle/OSC 检测
  const [splitTwins, setSplitTwins] = useState<Record<string, string>>({})
  const [splitRatios, setSplitRatios] = useState<Record<string, number>>({})
  const splitDragRef = useRef<{ parentId: string; startY: number; startRatio: number; containerHeight: number } | null>(null)
  const onSplitDragMove = useCallback((e: MouseEvent) => {
    const d = splitDragRef.current
    if (!d) return
    const ratio = Math.min(0.9, Math.max(0.1, d.startRatio + (e.clientY - d.startY) / d.containerHeight))
    setSplitRatios(prev => prev[d.parentId] === ratio ? prev : { ...prev, [d.parentId]: ratio })
  }, [])
  const onSplitDragUp = useCallback(() => {
    splitDragRef.current = null
    window.removeEventListener('mousemove', onSplitDragMove)
    window.removeEventListener('mouseup', onSplitDragUp)
  }, [onSplitDragMove])
  const startSplitDrag = useCallback((e: React.MouseEvent, parentId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const container = (e.currentTarget as HTMLElement).parentElement
    splitDragRef.current = {
      parentId,
      startY: e.clientY,
      startRatio: splitRatios[parentId] ?? 0.5,
      containerHeight: container?.clientHeight ?? 1,
    }
    window.addEventListener('mousemove', onSplitDragMove)
    window.addEventListener('mouseup', onSplitDragUp)
  }, [onSplitDragMove, onSplitDragUp, splitRatios])

  const handleSplitSession = useCallback(async (sessionId: string) => {
    const session = sessionsRef.current.find(s => s.id === sessionId)
    if (!session || session.kind !== 'terminal' || !session.loaded) return
    if (splitTwins[sessionId]) return
    try {
      const twin = await window.api.terminal.create({ cwd: session.cwd, shell: session.shell, autoUtf8, initCommand: readDefaultAgent() })
      setSplitTwins(prev => ({ ...prev, [sessionId]: twin.id }))
      applySessionTabPolicy(sessionId)
    } catch (err) {
      console.error('Failed to split terminal session:', err)
    }
  }, [autoUtf8, splitTwins, applySessionTabPolicy])

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

      // 2. Local session record (gui mode, no PTY) — AiTab's auto-create will use resumeSessionId
      const session: SessionTab = {
        ...makeLocalSession(current.cwd),
        kind: 'gui',
        resumeSessionId: result.newClaudeSessionId!,
        resumeCwd: current.cwd,
        loaded: true,
      }

      // 3. Insert session right after the current one
      addSessionRecord(session, currentSessionId)
    } catch (err) {
      console.error('Failed to fork session:', err)
    }
  }, [sessions, autoUtf8])

  // dsh 会话内 fork（「在新对话中分支」）：dsh 侧已生成子会话（历史=分叉前缀），
  // 这里为它建 Vibe session（id=childId 收养 dsh 子会话），插到源会话下方并切换。
  React.useEffect(() => {
    const onDshFork = async (e: Event): Promise<void> => {
      const d = (e as CustomEvent).detail as { sourceId: string; childId: string; cwd?: string; title?: string } | undefined
      if (!d?.childId || !d.cwd) return
      try {
        // 固定 id=childId 收养 dsh 子会话（dsh 模式无 PTY）
        const session = makeLocalSession(d.cwd, { id: d.childId, name: d.title })
        addSessionRecord({ ...session, kind: 'dsh', dshSessionId: d.childId, loaded: true }, d.sourceId)
      } catch (err) {
        console.error('Failed to fork dsh session into Vibe:', err)
      }
    }
    window.addEventListener('vibe:dsh-fork', onDshFork)
    return () => window.removeEventListener('vibe:dsh-fork', onDshFork)
  }, [addSessionRecord])

  // 按需加载：deferred tab 首次成为 active 时补齐真实资源
  const ensureSessionLoaded = useCallback(async (id: string) => {
    const session = sessionsRef.current.find(s => s.id === id)
    if (!session || session.loaded) return

    // 恢复出来的 Terminal tab 没有真实 PTY，加载时新建一个并替换占位 tab
    if (session.kind === 'terminal') {
      try {
        const real = await window.api.terminal.create({
          cwd: session.cwd,
          shell: getMainShellType(),
          autoUtf8,
          initCommand: readDefaultAgent(),
        })
        const realTab: SessionTab = { ...real, kind: 'terminal', loaded: true, emoji: session.emoji }
        setSessions(prev => {
          const idx = prev.findIndex(s => s.id === id)
          if (idx === -1) return prev
          const next = prev.filter(s => s.id !== id)
          next.splice(Math.min(idx, next.length), 0, realTab)
          return next
        })
        setActiveSessionId(prev => prev === id ? real.id : prev)
      } catch (err) {
        console.error('Failed to restore terminal session:', err)
      }
      return
    }

    setSessions(prev => prev.map(s => s.id === id ? { ...s, loaded: true } : s))

    if (session.kind === 'gui') {
      const resumeSessionId = session.resumeSessionId
      if (!resumeSessionId) return
      const resumeCwd = session.resumeCwd || session.cwd
      if (resumeCwd !== session.cwd) {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, cwd: resumeCwd } : s))
      }
      try {
        const result = await aiStore.resumeSession(id, resumeSessionId, resumeCwd, {
          autoApprove: false,
          permissionMode: 'bypassPermissions',
          name: session.name,
        })
        if (!result) return
        if (result.cwd && result.cwd !== (sessionsRef.current.find(x => x.id === id)?.resumeCwd || session.cwd)) {
          setSessions(prev => prev.map(s => s.id === id ? { ...s, cwd: result.cwd!, resumeCwd: result.cwd! } : s))
        }
        if (!result.resumed) {
          setSessions(prev => prev.map(s => s.id === id ? { ...s, resumeSessionId: undefined, resumeCwd: undefined } : s))
        }
      } catch {}
    }
  }, [autoUtf8])

  // deferred tab 经任意路径成为 active（点击 / Ctrl+方向键 / 看板）都自动加载
  React.useEffect(() => {
    if (activeSessionId) void ensureSessionLoaded(activeSessionId)
  }, [activeSessionId, ensureSessionLoaded])

  // Switch active session
  const handleSwitchSession = useCallback((id: string) => {
    setActiveSessionId(id)
    applySessionTabPolicy(id)
  }, [applySessionTabPolicy])

  // Execute a custom command — sends to AI input in GUI mode, terminal otherwise
  const handleExecuteCommand = useCallback((command: string) => {
    if (!activeSessionId) return
    const normalized = command.replace(/\r\n/g, '\n')
    const mode = sessions.find(s => s.id === activeSessionId)?.kind
    if (mode === 'gui') {
      aiTabRefs.current[activeSessionId]?.setValue(normalized)
      aiTabRefs.current[activeSessionId]?.focus()
    } else {
      window.api.terminal.write(activeSessionId, normalized.replace(/\n/g, '\r'))
      applySessionTabPolicy(activeSessionId)
      setTimeout(() => terminalRefs.current[activeSessionId]?.focus(), 0)
    }
  }, [activeSessionId, sessions, applySessionTabPolicy])

  const handleCloneWithInit = useCallback(async (sessionId: string, cwd: string, shell: string | undefined, command: string) => {
    try {
      const session = await window.api.terminal.create({ cwd, shell, autoUtf8, initCommand: command })
      const parentEmoji = sessionsRef.current.find(s => s.id === sessionId)?.emoji
      const tab: SessionTab = { ...session, kind: 'terminal', loaded: true, emoji: parentEmoji ?? randomTermEmoji() }
      setSessions(prev => {
        const parentIndex = prev.findIndex(s => s.id === sessionId)
        if (parentIndex === -1) return [...prev, tab]
        const next = [...prev]
        next.splice(parentIndex + 1, 0, tab)
        return next
      })
      setActiveSessionId(session.id)
      applySessionTabPolicy(session.id)
    } catch (err) {
      console.error('Failed to clone with init:', err)
    }
  }, [autoUtf8, applySessionTabPolicy])

  const handleInitCommand = useCallback(async (command: string) => {
    const activeSession = sessions.find(s => s.id === activeSessionId)
    if (!activeSession) return
    await handleCloneWithInit(activeSession.id, activeSession.cwd, activeSession.shell, command)
  }, [activeSessionId, sessions, handleCloneWithInit])

  // Close a terminal session (core, no board prompt — used by finish/clear paths)
  const closeSessionCore = useCallback(async (id: string) => {
    const twinId = splitTwins[id]
    cancelPipe(id)
    if (twinId) cancelPipe(twinId)
    await window.api.terminal.close(id)
    if (twinId) await window.api.terminal.close(twinId)
    if (twinId) delete terminalRefs.current[twinId]
    // 清理 terminalRefs / aiTabRefs / dshRefs 中已关闭 session 的 handle 引用
    delete terminalRefs.current[id]
    delete aiTabRefs.current[id]
    delete dshRefs.current[id]
    setSessions(prev => prev.filter(s => s.id !== id))
    // 分组模式下关闭组内最后一个 session：该 cwd 记为保留空组，位置沿用当前组序
    if (groupSessionsByCwd) {
      const closing = sessions.find(s => s.id === id)
      const key = closing ? normCwdKey(closing.cwd) : ''
      if (key && !sessions.some(s => s.id !== id && normCwdKey(s.cwd) === key)) {
        cwdStore.upsertKeptGroup(key, Math.max(0, stableGroupOrder.indexOf(key)))
      }
    }
    if (twinId) setSplitTwins(prev => { const n = { ...prev }; delete n[id]; return n })
    if (twinId) setSplitRatios(prev => { const n = { ...prev }; delete n[id]; return n })
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
  }, [activeSessionId, sessions, rightTerminalSessions, splitTwins, setSplitTwins, setSplitRatios, groupSessionsByCwd, stableGroupOrder])

  // 看板任务会话：关标签不再静默遗留记录+worktree，弹确认让用户选"仅关闭"或"关闭并清理"
  const [boardCloseAsk, setBoardCloseAsk] = useState<{ rec: WorktreeRecord; sessionId: string } | null>(null)
  // busy 会话关闭需二次确认
  const [busyCloseAsk, setBusyCloseAsk] = useState<string | null>(null)

  const proceedCloseSession = useCallback(async (id: string) => {
    const s = sessions.find(x => x.id === id)
    if (s && s.kind === 'terminal' && s.cwd) {
      try {
        const res = await window.api.board.records(s.cwd)
        const rec = res.records.find(r => r.id === id)
        if (rec) {
          setBoardCloseAsk({ rec, sessionId: id })
          return
        }
      } catch {}
    }
    await closeSessionCore(id)
  }, [sessions, closeSessionCore])

  const handleCloseSession = useCallback(async (id: string) => {
    if (terminalBusyRef.current[id] || aiBusyRef.current[id]) {
      setBusyCloseAsk(id)
      return
    }
    await proceedCloseSession(id)
  }, [proceedCloseSession])

  const confirmBusyClose = useCallback(async () => {
    if (!busyCloseAsk) return
    const sid = busyCloseAsk
    setBusyCloseAsk(null)
    await proceedCloseSession(sid)
  }, [busyCloseAsk, proceedCloseSession])

  useEffect(() => {
    if (!busyCloseAsk) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      setBusyCloseAsk(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busyCloseAsk])

  useEffect(() => {
    if (!boardCloseAsk) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      setBoardCloseAsk(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [boardCloseAsk])

  const handleBoardClearWarn = useCallback((id: string) => {
    setWarnSessions(prev => {
      if (!(id in prev)) return prev
      const n = { ...prev }
      delete n[id]
      return n
    })
  }, [])

  const handleBoardFocusSession = useCallback((id: string) => {
    setActiveSessionId(id)
    applySessionTabPolicy(id)
  }, [applySessionTabPolicy])

  const handleBoardCreate = useCallback(async (title: string, launchCommand?: string, createCwd?: string | null): Promise<{ ok: boolean; record?: WorktreeRecord; error?: string }> => {
    const targetCwd = createCwd || activeSessionCwd
    if (!targetCwd) return { ok: false, error: '无活动工作区' }
    try {
      const res = await window.api.board.create({ workspacePath: targetCwd, title, launchCommand })
      if (!res.ok || !res.record) return { ok: false, error: res.error ?? '创建失败' }
      const rec = res.record
      // worktree 会话：注册 worktreeNav 让图标走 worktree 状态(🌿)；emoji 持久化负责重启后仍显示 🌿
      setSessionWorktreeNav(prev => prev[rec.id] ? prev : { ...prev, [rec.id]: { originalPath: rec.repoRoot, worktreePath: rec.worktreePath, originalBranch: rec.baseBranch } })
      setSessions(prev => prev.some(s => s.id === rec.id) ? prev : [...prev, {
        id: rec.id,
        kind: 'terminal',
        name: rec.title,
        cwd: rec.worktreePath,
        emoji: '🌿',
        active: false,
        createdAt: Date.now(),
        loaded: true
      }])
      return { ok: true, record: rec }
    } catch (e: any) {
      console.warn('[board] create failed:', e?.message)
      return { ok: false, error: e?.message ?? '创建失败' }
    }
  }, [activeSessionCwd])

  const handleBoardOpenRecord = useCallback(async (rec: WorktreeRecord) => {
    if (!sessionsRef.current.some(s => s.id === rec.id)) {
      try {
        await window.api.terminal.create({ id: rec.id, cwd: rec.worktreePath, name: rec.title, initCommand: rec.launchCommand })
      } catch (e: any) {
        console.warn('[board] open terminal failed:', e?.message)
        return
      }
      // 与 handleBoardCreate 对齐：worktreeNav 注册(图标走 worktree 状态) + emoji 持久化双保险
      setSessionWorktreeNav(prev => prev[rec.id] ? prev : { ...prev, [rec.id]: { originalPath: rec.repoRoot, worktreePath: rec.worktreePath, originalBranch: rec.baseBranch } })
      setSessions(prev => prev.some(s => s.id === rec.id) ? prev : [...prev, {
        id: rec.id,
        kind: 'terminal',
        name: rec.title,
        cwd: rec.worktreePath,
        emoji: '🌿',
        active: true,
        createdAt: Date.now(),
        loaded: true
      }])
    }
    setActiveSessionId(rec.id)
    applySessionTabPolicy(rec.id)
  }, [applySessionTabPolicy])

  const handleBoardFinishRecord = useCallback(async (rec: WorktreeRecord): Promise<boolean> => {
    await closeSessionCore(rec.id)
    try {
      const res = await window.api.board.finish(rec.repoRoot, rec.id)
      if (res?.error) {
        console.warn('[board] finish:', res.error)
        return false
      }
      // worktree 目录已删：清掉该 cwd 的空组保留位，避免留下指向已删目录的分组卡
      cwdStore.removeKeptGroup(rec.worktreePath)
      return true
    } catch (e: any) {
      console.warn('[board] finish failed:', e?.message)
      return false
    }
  }, [closeSessionCore])

  const handleBoardClearRecord = useCallback(async (rec: WorktreeRecord) => {
    // 与 handleBoardFinishRecord 对齐:清记录前先关 pty + 删 tab,否则泄漏 shell 进程 + 孤儿会话
    await closeSessionCore(rec.id)
    try {
      const res = await window.api.board.clear(rec.repoRoot, rec.id)
      if (!res?.error) cwdStore.removeKeptGroup(rec.worktreePath)
    } catch (e: any) {
      console.warn('[board] clear failed:', e?.message)
    }
  }, [closeSessionCore])

  const confirmBoardCloseOnly = useCallback(async () => {
    if (!boardCloseAsk) return
    const sid = boardCloseAsk.sessionId
    setBoardCloseAsk(null)
    await closeSessionCore(sid)
  }, [boardCloseAsk, closeSessionCore])

  const confirmBoardCloseClean = useCallback(async () => {
    if (!boardCloseAsk) return
    const rec = boardCloseAsk.rec
    setBoardCloseAsk(null)
    await handleBoardFinishRecord(rec)
  }, [boardCloseAsk, handleBoardFinishRecord])

  const handleBoardMergeRecord = useCallback(async (rec: WorktreeRecord) => {
    try {
      return await window.api.board.merge(rec.repoRoot, rec.id)
    } catch (e: any) {
      console.warn('[board] merge failed:', e?.message)
      return { error: e?.message ?? '合并失败' }
    }
  }, [])

  const handleBoardMergeAbort = useCallback(async (rec: WorktreeRecord) => {
    try {
      const res = await window.api.board.mergeAbort(rec.repoRoot)
      if (res?.error) console.warn('[board] merge abort:', res.error)
      return res
    } catch (e: any) {
      console.warn('[board] merge abort failed:', e?.message)
      return { error: e?.message ?? '中止合并失败' }
    }
  }, [])

  const handleBoardCreatePlain = useCallback(async (cwd: string, launchCommand?: string) => {
    try {
      return await createTermSession(cwd, undefined, launchCommand, false)
    } catch (e: any) {
      console.warn('[board] create plain session failed:', e?.message)
      return null
    }
  }, [createTermSession])

  const handleReadTerminalTail = useCallback((sessionId: string, maxLines?: number): string[] => {
    return terminalRefs.current[sessionId]?.readTail(maxLines ?? 200) ?? []
  }, [])

  const handleReorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    setSessions(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  // 组拖拽：索引按完整组序（含空组保留位，与面板视觉一致），保留位下标同步写回 store
  const handleReorderGroup = useCallback((fromGroupIdx: number, toGroupIdx: number) => {
    const full = stableGroupOrder.slice()
    const [moved] = full.splice(fromGroupIdx, 1)
    if (!moved) return
    full.splice(toGroupIdx, 0, moved)
    const kept = cwdStore.getKeptGroups()
    if (kept.length) {
      cwdStore.setKeptGroups(kept.map(e => {
        const i = full.indexOf(e.cwd)
        return i < 0 ? e : { ...e, idx: i }
      }))
    }
    setSessions(prev => {
      const map = new Map<string, SessionTab[]>()
      for (const s of prev) {
        const key = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(s)
      }
      // full 之外的组（快照后新入 state 的 session）追加尾部，避免被 flatMap 静默丢弃
      const rest = [...map.keys()].filter(k => !full.includes(k))
      return [...full, ...rest].flatMap(k => map.get(k) ?? [])
    })
  }, [stableGroupOrder])

  // 分组模式组内拖动：按 id 定位，组序沿用当前稳定组序（与面板视觉一致），新组追加尾部；
  // 避免全局 splice 使组序被首现序推导而跳变
  const handleReorderSessionInGroup = useCallback((sessionId: string, targetSessionId: string, before: boolean) => {
    setSessions(prev => {
      const moved = prev.find(s => s.id === sessionId)
      const target = prev.find(s => s.id === targetSessionId)
      if (!moved || !target || normCwdKey(moved.cwd) !== normCwdKey(target.cwd)) return prev
      const gKey = normCwdKey(moved.cwd)
      const map = new Map<string, SessionTab[]>()
      const order: string[] = []
      for (const s of prev) {
        const key = normCwdKey(s.cwd)
        if (!map.has(key)) { map.set(key, []); order.push(key) }
        map.get(key)!.push(s)
      }
      const rest = map.get(gKey)!.filter(s => s.id !== sessionId)
      const ti = rest.findIndex(s => s.id === targetSessionId)
      if (ti < 0) return prev
      rest.splice(before ? ti : ti + 1, 0, moved)
      map.set(gKey, rest)
      const groupOrder = stableGroupOrder.filter(k => map.has(k)).concat(order.filter(k => !stableGroupOrder.includes(k)))
      return groupOrder.flatMap(k => map.get(k)!)
    })
  }, [stableGroupOrder])

  // Set session row-icon emoji (undefined = type icon), stored on SessionTab
  const handleSetSessionEmoji = useCallback((id: string, emoji?: string) => {
    setSessions(prev => prev.some(s => s.id === id) ? prev.map(s => s.id === id ? { ...s, emoji: emoji || undefined } : s) : prev)
  }, [])

  // Rename a terminal session
  const handleRenameSession = useCallback(async (id: string, newName: string) => {
    const oldSession = sessionsRef.current.find(s => s.id === id)
    if (oldSession && oldSession.name !== newName) {
      manuallyRenamedRef.current.add(id)
    }
    await applyRename(id, newName)
    if (oldSession?.kind === 'dsh') {
      try {
        const api = await getDshApi(oldSession?.cwd)
        await api.sessions.rename({ sessionId: oldSession.dshSessionId || id, title: newName })
      } catch (e) {
        console.error('Failed to rename dsh session:', e)
      }
    }
  }, [applyRename])

  // Handle panel resizing
  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const startX = e.clientX
    const startWidth = rightPanelWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      const maxWidth = Math.max(280, window.innerWidth - 240)
      const newWidth = Math.max(280, Math.min(maxWidth, startWidth + delta))
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

  const handleRestoreRightWidth = useCallback(() => setRightPanelWidth(RIGHT_PANEL_DEFAULT_W), [])

  const handleLeftResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const startX = e.clientX
    const startWidth = leftPanelWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const newWidth = Math.max(150, Math.min(400, startWidth + delta))
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

  // webview guest 进程会吞掉滑过其区域的 mousemove，拖宽期间冻结指针事件否则分隔条拖不动
  useEffect(() => {
    if (isDragging) document.body.classList.add('panel-dragging')
    else document.body.classList.remove('panel-dragging')
    return () => document.body.classList.remove('panel-dragging')
  }, [isDragging])

  const handleFileSelect = useCallback((filePath: string, isStaged: boolean, commitHash: string | undefined, resolvedFullPath: string | undefined, gitStats: { additions: number; deletions: number }) => {
    const fullPath = resolvedFullPath || (activeSessionCwd ? `${activeSessionCwd}/${filePath}` : filePath)
    openFileView(fullPath, { mode: 'diff', relPath: filePath, git: { isStaged, commitHash, gitStats } })
  }, [activeSessionCwd, openFileView])

  const handleDiffScroll = useCallback((delta: number) => {
    setDiffScrollTrigger(prev => prev + delta)
  }, [])

  const handleNavigateToFile = useCallback((filePath: string) => {
    setNavigateToFilePayload({ trigger: Date.now(), filePath })
  }, [])

  // 浏览器停靠期间临时加宽的右栏，关闭/移回中栏时还原本来的宽度
  const restoreBrowserDockWidth = useCallback(() => {
    if (browserDockPrevWidth.current !== null) {
      setRightPanelWidth(browserDockPrevWidth.current)
      browserDockPrevWidth.current = null
    }
  }, [])

  const handleCloseBrowser = useCallback(() => {
    browserDockedRef.current = false
    setBrowserDocked(false)
    restoreBrowserDockWidth()
    setCenterView('terminal')
  }, [restoreBrowserDockWidth])

  const handleToggleBrowserDock = useCallback(() => {
    const next = !browserDockedRef.current
    browserDockedRef.current = next
    setBrowserDocked(next)
    saveBrowserDockPref(next ? 'right' : 'center')
    if (next) {
      if (centerViewRef.current === 'browser') setCenterView('terminal')
      setBrowserDockNonce(n => n + 1)
    } else {
      restoreBrowserDockWidth()
      setCenterView('browser')
    }
  }, [restoreBrowserDockWidth])

  // 打开网页调试：按停靠偏好决定落点（右侧时直接覆盖 Nga tab）
  const handleOpenWebDebug = useCallback(() => {
    if (browserDockedRef.current) {
      setBrowserDockNonce(n => n + 1)
      return
    }
    if (loadBrowserDockPref() === 'right' && activeSessionCwd) {
      browserDockedRef.current = true
      setBrowserDocked(true)
      setBrowserDockNonce(n => n + 1)
      return
    }
    setCenterView('browser')
  }, [activeSessionCwd])

  // Nga 内置浏览器入口：不受停靠偏好影响，直接停靠右栏并加宽右栏
  const handleOpenBrowserRight = useCallback(() => {
    if (centerViewRef.current === 'browser') setCenterView('terminal')
    browserDockedRef.current = true
    setBrowserDocked(true)
    saveBrowserDockPref('right')
    if (browserDockPrevWidth.current === null) {
      browserDockPrevWidth.current = rightPanelWidth
      setRightPanelWidth(BROWSER_DOCK_W)
    }
    setBrowserDockNonce(n => n + 1)
  }, [rightPanelWidth])

  const handleRefreshGit = useCallback(async () => {
    setGitRefreshKey(k => k + 1)
  }, [])

  const handleOutlineNavigate = useCallback((line: number, headingName?: string) => {
    const at = activeTabRef.current
    if (at?.kind === 'diff') {
      updateTab(at.id, { lineNumber: line, jumpNonce: (at.jumpNonce ?? 0) + 1 } as Partial<FileTabState>)
    } else if (at?.kind === 'markdown' && headingName) {
      setMdScrollHeading(headingName)
    }
  }, [updateTab])

  const handleAnnotationTrigger = useCallback((start: number, end: number) => {
    const fp = activeTabRef.current?.fullPath
    if (!fp) return
    const rel = toRelPath(fp, activeSessionCwd)
    window.dispatchEvent(new CustomEvent(ADD_ANNOTATION_EVENT, { detail: { rel, start, end } }))
  }, [activeSessionCwd])

  const [mdScrollHeading, setMdScrollHeading] = useState<string | undefined>(undefined)

  // 处理从中间终端点击文件路径打开文件
  const handleOpenFileFromTerminal = useCallback((fullPath: string, lineNumber?: number) => {
    openFileView(fullPath, { lineNumber })
  }, [openFileView])

  // 处理从右侧终端点击文件路径打开文件
  const handleOpenFileFromRightTerminal = useCallback((fullPath: string, lineNumber?: number) => {
    openFileView(fullPath, { lineNumber })
  }, [openFileView])

  // 创建右侧终端（每个 session 独立，可多个 tab，append 后自动切到新 tab）
  const handleCreateRightTerminal = useCallback(async (sessionId: string, cwdOverride?: string, launchCommand?: string) => {
    const session = sessions.find(s => s.id === sessionId)
    const cwd = cwdOverride || session?.cwd
    if (!cwd) return
    try {
      const shell = getAuxShellType()
      const term = await window.api.terminal.create({ cwd, shell, autoUtf8 })
      const prevLen = rightTerminalSessions[sessionId]?.length ?? 0
      const newTab: AuxTerminalTab = { id: term.id, terminals: [term], sizes: [1], launchCommand }
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

  // 处理从搜索面板打开文件（md/image 预览，其余编辑）
  const handleOpenFileFromSearch = useCallback((fullPath: string, lineNumber?: number) => {
    openFileView(fullPath, { lineNumber })
  }, [openFileView])

  // 搜索结果点击打开：即使 md 也默认进编辑模式，区别于最近文件 / AI 链接 / callgraph（md 预览）。
  // 想看渲染预览可按 Ctrl+L（view.togglePreview：diff(md) ↔ markdown）。
  const handleOpenSearchResult = useCallback((fullPath: string, lineNumber?: number) => {
    openFileView(fullPath, { mode: 'edit', lineNumber })
  }, [openFileView])

  // 处理从「最近文件」栏点击打开文件 — 复用 search 打开逻辑（含 markdown 预览 + 行号定位 + 记录）
  const handleOpenRecentFile = useCallback((fullPath: string, lineNumber?: number) => {
    handleOpenFileFromSearch(fullPath, lineNumber)
  }, [handleOpenFileFromSearch])

  // 处理从文件浏览器打开文件 — 默认 edit 模式（铅笔入口可带行号定位）
  const handleOpenFileFromExplorer = useCallback((fullPath: string, lineNumber?: number) => {
    openFileView(fullPath, { mode: 'edit', lineNumber })
  }, [openFileView])

  // dsh 会话内点击文件（tool 行/产物）：dsh context 把 host.openPath 重定向为本事件，
  // 这里用编辑器打开，替代 OS 默认应用的「打开方式」弹窗
  useEffect(() => {
    const onDshOpenFile = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path
      if (path) handleOpenFileFromSearch(path)
    }
    window.addEventListener('vibe:dsh-open-file', onDshOpenFile)
    return () => window.removeEventListener('vibe:dsh-open-file', onDshOpenFile)
  }, [handleOpenFileFromSearch])

  const openCompareTab = useCallback(async (baseTab: DiffFileTab, compareFullPath: string, contentOverride?: string) => {
    let compareContent: string
    if (contentOverride !== undefined) {
      compareContent = contentOverride
    } else {
      const compareResult = await window.api.file.read(compareFullPath)
      compareContent = compareResult.error ? '' : (compareResult.content || '')
    }
    openFileView(baseTab.fullPath, {
      mode: 'diff',
      relPath: baseTab.filePath,
      compare: { content: compareContent, path: compareFullPath },
      record: false,
    })
  }, [openFileView])

  const handleCompareWithCurrent = useCallback(async (compareFullPath: string) => {
    const at = activeTabRef.current
    if (!(at?.kind === 'diff' && at.defaultEdit && !at.compareOriginalPath)) return
    await openCompareTab(at, compareFullPath)
  }, [openCompareTab])

  const handleResumeDshHistory = useCallback(async (dshSessionId: string, cwd: string, name: string) => {
    try {
      setIsOpening(true)
      const session = makeLocalSession(cwd, { name: name || undefined })
      addSessionRecord({ ...session, kind: 'dsh', dshSessionId, loaded: true })
    } catch (err) {
      console.error('Failed to resume dsh history:', err)
    } finally {
      setIsOpening(false)
    }
  }, [addSessionRecord])

  const handleResumeClaudeHistory = useCallback(async (historySessionId: string, cwd: string, name: string, mode: 'tui' | 'gui') => {
    try {
      setIsOpening(true)
      if (mode === 'tui') {
        const shell = getMainShellType()
        let initCommand: string | undefined
        const { cliCommand, configDir } = readAiCliConfig()
        const bin = cliCommand || 'claude'
        const isPosix = shell === 'bash' || shell === 'sh' || shell === 'zsh' || shell === 'gitbash'
        const binPart = bin.includes(' ') ? (shell === 'cmd' ? `"${bin}"` : isPosix ? `'${bin}'` : `& '${bin}'`) : bin
        const base = `${binPart} --resume ${historySessionId}`
        // Bare names (.opencc) resolve to ~/.opencc so the tui launch and the gui history
        // lookup agree on the same config dir. Always resolve (fallback included) and pin
        // it via env var so the resumed tui reads the same dir the gui listed sessions from.
        const resolvedConfigDir = await window.api.ai.resolveConfigDir(configDir || undefined)
        initCommand = !resolvedConfigDir ? base
          : shell === 'cmd' ? `set "CLAUDE_CONFIG_DIR=${resolvedConfigDir}" && ${base}`
          : isPosix ? `CLAUDE_CONFIG_DIR='${resolvedConfigDir}' ${base}`
          : `$env:CLAUDE_CONFIG_DIR='${resolvedConfigDir}'; ${base}`
        const session = await window.api.terminal.create({ cwd, shell, autoUtf8, name: name || undefined, initCommand })
        addSessionRecord({ ...session, kind: 'terminal', loaded: true })
      } else {
        const session: SessionTab = {
          ...makeLocalSession(cwd, { name: name || undefined }),
          kind: 'gui',
          resumeSessionId: historySessionId,
          resumeCwd: cwd,
          loaded: true,
        }
        addSessionRecord(session)
        const resumeResult = await aiStore.resumeSession(session.id, historySessionId, cwd, { autoApprove: false, permissionMode: 'bypassPermissions', name })
        if (resumeResult.cwd && resumeResult.cwd !== cwd) {
          setSessions(prev => prev.map(s => s.id === session.id ? { ...s, cwd: resumeResult.cwd!, resumeCwd: resumeResult.cwd! } : s))
        }
        if (!resumeResult.resumed) {
          setSessions(prev => prev.map(s => s.id === session.id ? { ...s, resumeSessionId: undefined, resumeCwd: undefined } : s))
        }
      }
    } catch (err) {
      console.error('Failed to resume claude history:', err)
    } finally {
      setIsOpening(false)
    }
  }, [autoUtf8, addSessionRecord])

  const handlePreviewMarkdown = useCallback((fullPath: string, _fileName: string) => {
    openFileView(fullPath, { mode: 'auto' })
  }, [openFileView])

  const handlePreviewImage = useCallback((fullPath: string, _fileName: string) => {
    openFileView(fullPath, { mode: 'auto' })
  }, [openFileView])

  // 无任何 cwd（含空组保留位）才视为空应用，空组存在时左侧面板可见、可直接在该组新建
  const isWelcome = sessions.length === 0 && keptGroups.length === 0

  const currentEditFilePath = activeTab?.kind === 'diff' && activeTab.defaultEdit && !activeTab.compareOriginalPath ? activeTab.fullPath : null

  const renderTab = useCallback((tab: FileTabState, isActive: boolean, headerLeading: ReactNode) => {
    if (tab.kind === 'diff') {
      return (
        <DiffViewer
          headerLeading={headerLeading}
          isActive={isActive}
          tabId={tab.id}
          getSnapshot={() => getTabSnapshot(tab.id)}
          onPushSnapshot={(s) => pushTabSnapshot(tab.id, s)}
          onRuntimeChange={(rt) => handleTabRuntime(tab.id, rt)}
          onViewModeChange={(m) => updateTab(tab.id, { viewMode: m })}
          filePath={tab.filePath}
          fullPath={tab.fullPath}
          isStaged={tab.isStaged}
          commitHash={tab.commitHash}
          lineNumber={tab.lineNumber}
          jumpNonce={tab.jumpNonce}
          revision={tab.revision}
          onDismiss={returnToBaseView}
          onSaved={handleRefreshGit}
          defaultEdit={tab.defaultEdit}
          fontSize={editorFontSize}
          wordWrap={wordWrap}
          inlineDiff={inlineDiff}
          diffSplitRatio={diffSplitRatio}
          scrollTrigger={diffScrollTrigger}
          cursorRef={cursorRef}
          visibleLineRef={visibleLineRef}
          onOpenCallGraph={handleOpenCallGraphFromEditor}
          onViewLineHistory={handleViewLineHistory}
          jumpCwd={activeSessionCwd ?? undefined}
          onJumpToFile={handleOpenFileFromSearch}
          compareOriginalContent={tab.compareOriginalContent}
          compareOriginalPath={tab.compareOriginalPath}
          onAnnotationTrigger={handleAnnotationTrigger}
          brushActive={brushActive}
          onOutlineNavigate={handleOutlineNavigate}
        />
      )
    }
    if (tab.kind === 'markdown') {
      return (
        <MarkdownPreview
          headerLeading={headerLeading}
          tabId={tab.id}
          getSnapshot={() => getTabSnapshot(tab.id)}
          onPushSnapshot={(s) => pushTabSnapshot(tab.id, s)}
          onRuntimeChange={(rt) => handleTabRuntime(tab.id, rt)}
          fullPath={tab.fullPath}
          fileName={tab.fileName}
          onDismiss={returnToBaseView}
          onToggleEdit={() => openMarkdownInEditor(tab.fullPath)}
          scrollToHeading={mdScrollHeading}
          brushActive={brushActive}
          onOutlineNavigate={handleOutlineNavigate}
        />
      )
    }
    return (
      <ImagePreview
        headerLeading={headerLeading}
        fullPath={tab.fullPath}
        fileName={tab.fileName}
        onDismiss={returnToBaseView}
        brushActive={brushActive}
      />
    )
  }, [getTabSnapshot, pushTabSnapshot, handleTabRuntime, updateTab, requestCloseTabById, handleRefreshGit, editorFontSize, wordWrap, inlineDiff, diffSplitRatio, diffScrollTrigger, activeSessionCwd, handleOpenFileFromSearch, handleAnnotationTrigger, brushActive, handleOutlineNavigate, openMarkdownInEditor, mdScrollHeading])

  const fileTabsNode = (
    <FileTabsView
      tabs={tabs}
      activeTabId={activeTabId}
      dirtyMap={tabDirtyMap}
      recentFiles={recentFiles}
      onActivate={activateTab}
      onRequestClose={requestCloseTabById}
      onDismissView={returnToBaseView}
      onOpenRecent={handleOpenRecentFile}
      popoverGuardRef={tabPopoverGuardRef}
      renderTab={renderTab}
      t={t}
    />
  )

  const rightOverlay = overlayOnRight ? fileTabsNode : null

  // 右面板宽到出现 TabRail 导航（>= PANEL_TAB_RAIL_MIN_W）时收紧中间卡片与右面板的间隙，原始宽度保持对称
  const centerGapX = !isWelcome && rightPanelWidth >= PANEL_TAB_RAIL_MIN_W ? 'ml-1 mr-0' : 'mx-1'

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
        {leftPanelCollapsed && !isWelcome && (
        <button
          className="no-drag w-6 h-6 ml-1 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
          onClick={handleToggleLeftPanel}
          title={t('Restore Sessions')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        )}
        <div className="flex-1" />
        <button
          className={`no-drag w-6 h-6 rounded flex items-center justify-center transition-colors shrink-0 ${showSearchDropdown ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
          style={{ marginRight: 16 }}
          onClick={() => { setShowSearchDropdown(true); setSearchFocusTrigger(k => k + 1) }}
          title={t('Search')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
            <circle cx="11" cy="11" r="8" />
            <line x1="17" y1="17" x2="22" y2="22" />
          </svg>
        </button>
        <button
          className={`no-drag w-6 h-6 rounded flex items-center justify-center transition-colors shrink-0 ${browserDocked || centerView === 'browser' ? 'text-ide-text bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
          style={{ marginRight: 16 }}
          onClick={handleOpenWebDebug}
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
        <div className="shrink-0 flex flex-col relative" data-panel="left" style={{ width: leftPanelWidth, display: isWelcome || leftPanelCollapsed ? 'none' : undefined }}>
          {/* SessionPanel: always full height */}
          <div className="flex-1 overflow-hidden">
            <SessionPanel
              ref={sessionPanelRef}
              sessions={groupSessionsByCwd ? stableSessions : sessions}
              activeSessionId={boardActive ? null : activeSessionId}
              onCreateSession={handleCreateSession}
            onCreateSessionAt={handleCreateSessionAt}
            onCloneSession={handleCloneSession}
            onSplitSession={handleSplitSession}
            onSwitchSession={handleSwitchSession}
            onCloseSession={handleCloseSession}
            onRenameSession={handleRenameSession}
            onSetSessionEmoji={handleSetSessionEmoji}
            onReorderSessions={handleReorderSessions}
            onReorderGroup={handleReorderGroup}
            onReorderSessionInGroup={handleReorderSessionInGroup}
            commandHistory={commandHistory}
            agentStatus={agentStatus}
            sessionWorktreeNav={sessionWorktreeNav}
            onResetCache={handleResetCache}
            dshSidebarShown={dshSidebarShown}
            onToggleDshSidebar={(v) => { setDshSidebarShown(v); try { localStorage.setItem('vibe-ide-dsh-sidebar', v ? '1' : '0') } catch {} }}
            dshThemeOverride={dshThemeOverride}
            onToggleDshThemeOverride={(v) => { setDshThemeOverride(v); try { localStorage.setItem('vibe-ide-dsh-theme-override', v ? '1' : '0') } catch {}; window.dispatchEvent(new CustomEvent('vibe:dsh-theme-override-change')) }}
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
            showSessionButtons={showSessionButtons}
            onToggleShowSessionButtons={setShowSessionButtons}
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
              setShowSessionButtons(true)
              setInlineDiff(true)
              setDiffSplitRatio(0.3)
              setSessionFontFamily('Consolas')
              setFontFamily('Consolas')
              setTermFontFamily('Consolas')
            }}
            focusSettingsTrigger={focusSettingsTrigger}
            onExecuteCommand={handleExecuteCommand}
            onInitCommand={handleInitCommand}
            onPipeCommand={handlePipeCommand}
            onPipeToSession={handlePipeToSession}
            pipeRunning={pipeRunning}
            pipeProgress={pipeProgress}
            onCancelPipe={cancelPipe}
            onCloneWithInit={handleCloneWithInit}
            onNewTermCommand={handleNewTermCommand}
            onNewSessionHere={handleNewSessionHere}
            onOpenHistoryTab={handleOpenHistoryTab}
            boardActive={boardActive}
            panelView={leftPanelView}
            onPanelViewChange={handleLeftPanelViewChange}
            panelContent={leftPanelsReady ? (
              <>
                <div style={{ display: leftPanelView === 'git' ? 'flex' : 'none' }} className="flex-1 min-h-0 flex flex-col">
                  <GitTab
                    workspacePath={activeSessionCwd}
                    effectiveGitPath={leftEffectiveGitPath}
                    worktreeNav={leftWorktreeNav}
                    onFileSelect={handleFileSelect}
                    refreshKey={gitRefreshKey}
                    activeSessionId={activeSessionId}
                    isActive={leftPanelView === 'git'}
                    pauseWhenHidden
                    onWorktreeNavChange={setSessionWorktreeNav}
                    onDiffScroll={handleDiffScroll}
                    onNavigateToFile={handleNavigateToFile}
                    lineHistoryPayload={lineHistoryPayload}
                  />
                </div>
                <div style={{ display: leftPanelView === 'dir' ? 'flex' : 'none' }} className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <FileTab
                    workspacePath={activeSessionCwd}
                    onOpenFileFromExplorer={handleOpenFileFromExplorer}
                    onOpenFileAtLine={handleOpenSearchResult}
                    onCompareWithCurrent={handleCompareWithCurrent}
                    currentEditFilePath={currentEditFilePath}
                    onPreviewMarkdown={handlePreviewMarkdown}
                    onPreviewImage={handlePreviewImage}
                    onOpenInBrowser={handleOpenFileInBrowser}
                    navigateToFile={navigateToFilePayload}
                    recentFiles={recentFiles}
                    onOpenRecentFile={handleOpenRecentFile}
                    onRemoveRecentFile={removeRecentFile}
                    onEditRecentFile={handleOpenFileFromExplorer}
                    isActive={leftPanelView === 'dir'}
                    pauseWhenHidden
                    brushActive={brushActive}
                    onExploreNode={(node: any) => setCallGraphFocalNode(node)}
                  />
                </div>
              </>
            ) : undefined}
            recentFiles={recentFiles}
            onOpenRecentFile={handleOpenRecentFile}
            onRemoveRecentFile={removeRecentFile}
            onTogglePinRecentFile={togglePinRecentFile}
          />
          </div>
        </div>

        {/* Left Panel Resize Handle */}
        {!isWelcome && !leftPanelCollapsed && (
        <div
          className="group relative z-30 w-1 hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
          onMouseDown={handleLeftResizeStart}
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
          <button
            className="no-drag absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[18px] h-8 rounded-full bg-ide-accent hover:bg-ide-accent-hover text-white flex items-center justify-center cursor-pointer opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
            onMouseDown={e => e.stopPropagation()}
            onClick={handleToggleLeftPanel}
            title={t('Collapse Sessions')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-4">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
        )}

        {/* Center Panel: Terminal or Diff — all three blocks always mounted, toggled via display */}
        <div className="flex-1 flex flex-col overflow-hidden bg-ide-bg focus-frame relative"
          ref={centerPanelRef}
          data-focused={focusedPanel === 'term' ? 'true' : undefined}
          onFocus={handleCenterFocus}
          onBlur={handleCenterBlur}>
          {/* File Tabs (diff / edit / markdown / image) */}
          {centerView === 'files' && tabs.length > 0 && !overlayOnRight && (
            <div className={`flex-1 ${centerGapX} mb-0.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col center-overlay`}>
              {fileTabsNode}
            </div>
          )}
          {/* Browser */}
          {centerView === 'browser' && !browserDocked && (
            <div className={`flex-1 ${centerGapX} mb-0.5 mt-0.5 border border-ide-border rounded-lg overflow-hidden flex flex-col center-card`}>
              <BrowserView
                ref={browserViewRef}
                onBack={handleCloseBrowser}
                onAnnotate={(line) => { (window as any).__vibeAppendInput?.(line) }}
                onToggleDock={activeSessionCwd ? handleToggleBrowserDock : undefined}
                workspacePath={activeSessionCwd}
              />
            </div>
          )}
          {/* Welcome screen — 仅当无任何 cwd（无 session 且无空组）时显示 */}
          {centerView === 'terminal' && isWelcome && (
            <WelcomeScreen
              isOpening={isOpening}
              onOpenFolder={() => handleCreateSession()}
              onOpenPath={(path) => handleCreateSessionAt(path)}
            />
          )}
          {/* Terminal sessions / AI GUI mode — overlayOnRight 时回落 base 视图(terminal/board)而非恒显示 terminal */}
          <div className={`flex-1 ${centerGapX} mb-0.5 mt-0.5 border-2 border-ide-border rounded-lg overflow-hidden flex flex-col center-card`} style={{ display: (centerView === 'terminal' || (overlayOnRight && overlaySnapRef.current.base === 'terminal')) && sessions.length > 0 ? 'flex' : 'none' }}>
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-ide-text-muted">Loading...</div>}>
              {sessions.map(session => {
                const isGui = session.kind === 'gui'
                const isDsh = session.kind === 'dsh'
                const isDeferred = !session.loaded
                if (isDeferred && session.id !== activeSessionId) return null
                const isActive = session.id === activeSessionId
                const twinId = session.kind === 'terminal' ? splitTwins[session.id] : undefined
                return (
                  <div
                    key={session.id}
                    className="flex-1 flex flex-col overflow-hidden"
                    style={{ display: isActive ? 'flex' : 'none' }}
                  >
                    {isDeferred ? (
                      <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm">
                        {t('Loading...')}
                      </div>
                    ) : isGui ? (
                      <AiTab
                        ref={(node) => { if (node) aiTabRefs.current[session.id] = node }}
                        activeSessionId={session.id}
                        workspacePath={session.cwd}
                        isActive={isActive}
                        autoApprove={false}
                        permissionMode={aiPermissionModes[session.id] ?? 'bypassPermissions'}
                        onPermissionModeChange={(mode: AiPermissionMode) => {
                          setAiPermissionModes(prev => ({ ...prev, [session.id]: mode }))
                          // Push to subprocess so the actual --permission-mode reflects UI state.
                          // Without this, subprocess keeps the spawn-time mode and UI lies.
                          window.api.ai.setPermissionMode(session.id, mode)
                        }}
                        onViewAi={() => {
                          setSessions(prev => prev.map(s => s.id === session.id ? { ...s, kind: 'gui' } : s))
                        }}
                        onOpenFile={handleOpenFileFromSearch}
                        onRenameSession={async (name: string) => {
                          if (manuallyRenamedRef.current.has(session.id)) return
                          await applyRename(session.id, name)
                        }}
                        resumeSessionId={session.resumeSessionId}
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
                    ) : isDsh ? (
                      <DshView ref={(node) => { if (node) dshRefs.current[session.id] = node }} sessionId={session.id} cwd={session.cwd} isActive={isActive} dshSessionId={session.dshSessionId} sidebarVisible={dshSidebarShown} onAgentStatusChange={handleAgentStatusChange} onTitleChange={handleDshTitleChange} onCommand={onCommandForSession(session.id)} />
                    ) : twinId ? (
                      <>
                        <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ flexGrow: splitRatios[session.id] ?? 0.5, flexBasis: 0 }}>
                          <TerminalView ref={(node) => { if (node) terminalRefs.current[session.id] = node }} sessionId={session.id} sessionName={session.name} sessionCwd={session.cwd} onOpenFile={handleOpenFileFromTerminal} onCommand={onCommandForSession(session.id)} showHeader={false} fontSize={terminalFontSize} fontFamily={termFontFamily} isActive={isActive} ocrEnabled={ocrEnabled} newlineShortcut={getShortcuts()['terminal.newline']} pageDownShortcut={getShortcuts()['terminal.pageDown']} pageUpShortcut={getShortcuts()['terminal.pageUp']} onAgentStatusChange={handleAgentStatusChange} onOscTitle={handleOscTitleChange} />
                        </div>
                        <div
                          className="shrink-0 h-1 cursor-ns-resize bg-ide-border hover:bg-ide-accent/60 transition-colors"
                          onMouseDown={(e) => startSplitDrag(e, session.id)}
                        />
                        <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ flexGrow: 1 - (splitRatios[session.id] ?? 0.5), flexBasis: 0 }}>
                          <TerminalView ref={(node) => { if (node) terminalRefs.current[twinId] = node }} sessionId={twinId} sessionCwd={session.cwd} onOpenFile={handleOpenFileFromTerminal} showHeader={false} fontSize={terminalFontSize} fontFamily={termFontFamily} isActive={isActive} ocrEnabled={ocrEnabled} newlineShortcut={getShortcuts()['terminal.newline']} pageDownShortcut={getShortcuts()['terminal.pageDown']} pageUpShortcut={getShortcuts()['terminal.pageUp']} />
                        </div>
                      </>
                    ) : (
                      <TerminalView ref={(node) => { if (node) terminalRefs.current[session.id] = node }} sessionId={session.id} sessionName={session.name} sessionCwd={session.cwd} onOpenFile={handleOpenFileFromTerminal} onCommand={onCommandForSession(session.id)} showHeader={false} fontSize={terminalFontSize} fontFamily={termFontFamily} isActive={isActive} ocrEnabled={ocrEnabled} newlineShortcut={getShortcuts()['terminal.newline']} pageDownShortcut={getShortcuts()['terminal.pageDown']} pageUpShortcut={getShortcuts()['terminal.pageUp']} onAgentStatusChange={handleAgentStatusChange} onOscTitle={handleOscTitleChange} />
                    )}
                  </div>
                )
              })}
            </Suspense>
          </div>
          {/* 看板仅可见时挂载：隐藏后常驻的 reload 会随 sessions 抖动反复 spawn git rev-parse（board.records），切走 session 直接关闭 */}
          {boardCenterShown && (
          <div className={`flex-1 ${centerGapX} mb-0.5 mt-0.5 border-2 border-ide-border rounded-lg overflow-hidden flex flex-col center-card`}>
            <BoardView
              workspacePath={activeSessionCwd}
              sessions={groupSessionsByCwd ? stableSessions : sessions}
              agentStatus={agentStatus}
              activeSessionId={null}
              sessionWorktreeNav={sessionWorktreeNav}
              onCreateRecord={handleBoardCreate}
              onFocusSession={handleBoardFocusSession}
              onOpenRecord={handleBoardOpenRecord}
              onExecuteFinish={handleBoardFinishRecord}
              onClearRecord={handleBoardClearRecord}
              onMergeRecord={handleBoardMergeRecord}
              onMergeAbort={handleBoardMergeAbort}
              onSendToSession={handlePipeToSession}
              onAcknowledgeWarn={handleBoardClearWarn}
              onCreatePlainSession={handleBoardCreatePlain}
              onReadSessionTail={handleReadTerminalTail}
              onCloseSession={handleCloseSession}
            />
          </div>
          )}
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
            className={`relative z-30 ${rightPanelWidth >= PANEL_TAB_RAIL_MIN_W ? 'w-px' : 'w-1 hover:bg-ide-accent'} cursor-col-resize shrink-0 transition-colors`}
            onMouseDown={handleRightResizeStart}
          >
            <div className={`absolute inset-y-0 -left-2 -right-2 ${rightPanelWidth >= PANEL_TAB_RAIL_MIN_W ? 'hover:bg-ide-accent/25' : ''}`} />
          </div>
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
            onOpenFileFromRightTerminal={handleOpenFileFromRightTerminal}
            onOpenFileFromSearch={handleOpenSearchResult}
            onOpenFileFromExplorer={handleOpenFileFromExplorer}
            recentFiles={recentFiles}
            onOpenRecentFile={handleOpenRecentFile}
            onRemoveRecentFile={removeRecentFile}
            onEditRecentFile={handleOpenFileFromExplorer}
            onCompareWithCurrent={handleCompareWithCurrent}
            currentEditFilePath={currentEditFilePath}
            onPreviewMarkdown={handlePreviewMarkdown}
            onPreviewImage={handlePreviewImage}
            onOpenFileInBrowser={handleOpenFileInBrowser}
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
            hideTabBar={rightPanelWidth >= PANEL_TAB_RAIL_MIN_W}
            panelWide={rightPanelWidth >= PANEL_TAB_RAIL_MIN_W}
            onRestoreWidth={handleRestoreRightWidth}
            contentOverlay={rightOverlay}
            brushActive={brushActive}
            onResumeClaudeHistory={handleResumeClaudeHistory}
            onResumeDshHistory={handleResumeDshHistory}
            historyNavNonce={historyNavNonce}
            browserDocked={browserDocked}
            browserDockNonce={browserDockNonce}
            browserViewRef={browserViewRef}
            onBrowserBack={handleCloseBrowser}
            onBrowserAnnotate={(line) => { (window as any).__vibeAppendInput?.(line) }}
            onBrowserToggleDock={handleToggleBrowserDock}
            onOpenBrowser={handleOpenBrowserRight}
          />
        </div>
        )}
      </div>

      {/* File tab close confirm — unsaved changes */}
      {closeAsk && (() => {
        const tab = tabs.find(t => t.id === closeAsk.tabId)
        return (
          <div
            className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center"
            onMouseDown={() => setCloseAsk(null)}
          >
            <div
              className="bg-ide-sidebar border border-ide-border rounded-xl p-4 w-[400px] mx-4 shadow-2xl space-y-3"
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="text-sm text-ide-text font-medium truncate">
                {t('File has unsaved changes')} · {tab?.fileName ?? ''}
              </div>
              <div className="text-xs text-ide-text-muted leading-relaxed">
                {t('Closing will discard unsaved changes. Save first?')}
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setCloseAsk(null)}
                  className="px-3 py-1.5 rounded-md text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                >
                  {t('Cancel')}
                </button>
                <button
                  onClick={() => void confirmCloseTab('discard')}
                  className="px-3 py-1.5 rounded-md text-xs text-ide-danger bg-ide-danger/15 border border-ide-danger/40 hover:bg-ide-danger/25 transition-colors"
                >
                  {t("Don't Save")}
                </button>
                <button
                  onClick={() => void confirmCloseTab('save')}
                  className="px-3 py-1.5 rounded-md text-xs bg-ide-accent text-white hover:brightness-110 transition-colors"
                >
                  {t('Save')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Session switch confirm — dirty file tabs will be closed */}
      {sessionSwitchAsk && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center"
          onMouseDown={() => setSessionSwitchAsk(null)}
        >
          <div
            className="bg-ide-sidebar border border-ide-border rounded-xl p-4 w-[400px] mx-4 shadow-2xl space-y-3"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="text-sm text-ide-text font-medium truncate">
              {t('Files have unsaved changes')} · {sessionSwitchAsk.count}
            </div>
            <div className="text-xs text-ide-text-muted leading-relaxed">
              {t('Switching session closes open tabs. Unsaved changes will be lost.')}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setSessionSwitchAsk(null)}
                className="px-3 py-1.5 rounded-md text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={() => void confirmSessionSwitch('discard')}
                className="px-3 py-1.5 rounded-md text-xs text-ide-danger bg-ide-danger/15 border border-ide-danger/40 hover:bg-ide-danger/25 transition-colors"
              >
                {t("Don't Save")}
              </button>
              <button
                onClick={() => void confirmSessionSwitch('save')}
                className="px-3 py-1.5 rounded-md text-xs bg-ide-accent text-white hover:brightness-110 transition-colors"
              >
                {t('Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Busy session close confirm — running task will be terminated */}
      {busyCloseAsk && (() => {
        const name = sessions.find(s => s.id === busyCloseAsk)?.name || busyCloseAsk
        return (
          <div
            className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center"
            onMouseDown={() => setBusyCloseAsk(null)}
          >
            <div
              className="bg-ide-sidebar border border-ide-border rounded-xl p-4 w-[400px] mx-4 shadow-2xl space-y-3"
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="text-sm text-ide-text font-medium truncate">
                {t('Close running session?')} · {name}
              </div>
              <div className="text-xs text-ide-text-muted leading-relaxed">
                {t('The session is still running. Closing will terminate its process and in-flight task.')}
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setBusyCloseAsk(null)}
                  className="px-3 py-1.5 rounded-md text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                >
                  {t('Cancel')}
                </button>
                <button
                  onClick={() => void confirmBusyClose()}
                  className="px-3 py-1.5 rounded-md text-xs text-ide-danger bg-ide-danger/15 border border-ide-danger/40 hover:bg-ide-danger/25 transition-colors"
                >
                  {t('Close anyway')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Board session close prompt — plain close keeps the card, clean removes worktree+branch */}
      {boardCloseAsk && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center"
          onMouseDown={() => setBoardCloseAsk(null)}
        >
          <div
            className="bg-ide-sidebar border border-ide-border rounded-xl p-4 w-[400px] mx-4 shadow-2xl space-y-3"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="text-sm text-ide-text font-medium truncate">
              {t('Board session')} · {boardCloseAsk.rec.title}
            </div>
            <div className="text-xs text-ide-text-muted leading-relaxed">
              {t('Close only keeps the task card; clean deletes the worktree and branch.')} (<span className="font-mono">{boardCloseAsk.rec.branchName}</span>)
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setBoardCloseAsk(null)}
                className="px-3 py-1.5 rounded-md text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={() => void confirmBoardCloseOnly()}
                className="px-3 py-1.5 rounded-md text-xs text-ide-text border border-ide-border hover:bg-ide-hover transition-colors"
              >
                {t('Close only')}
              </button>
              <button
                onClick={() => void confirmBoardCloseClean()}
                className="px-3 py-1.5 rounded-md text-xs text-ide-danger bg-ide-danger/15 border border-ide-danger/40 hover:bg-ide-danger/25 transition-colors"
              >
                {t('Close & clean worktree')}
              </button>
            </div>
          </div>
        </div>
      )}

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
                        if (sessionsRef.current.find(s => s.id === activeSessionId)?.kind === 'dsh') {
                          void sendToDshSession(activeSessionId, cmd)
                        } else {
                          window.api.terminal.write(activeSessionId, cmd.replace(/\n/g, '\x1b\r'))
                        }
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
            handleOpenFileFromSearch(resolveAbsPath(filePath, activeSessionCwd ?? undefined), line)
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
            handleOpenFileFromSearch(resolveAbsPath(node.filePath, activeSessionCwd ?? undefined), node.line)
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

      {/* Directory Picker — 自建目录浏览弹窗（新建 session 选目录 + 类型） */}
      {dirPicker && (
        <DirectoryPicker
          initialDir={dirPicker.initialDir}
          onConfirm={handleDirPickerConfirm}
          onCancel={() => setDirPicker(null)}
        />
      )}

      {/* Desktop pet — warn>busy>unfocused>idle，跟随活跃 session 与窗口聚焦 */}
      <DesktopPet
        logicalState={petLogicalState}
        activeSessionId={activeSessionId}
        activeSessionCwd={activeSessionCwd}
        sessions={sessions}
        dshActive={!!activeSessionId && sessions.find(s => s.id === activeSessionId)?.kind === 'dsh'}
        dshSessionId={activeSessionId ? (sessions.find(s => s.id === activeSessionId)?.dshSessionId || activeSessionId) : undefined}
      />
    </div>
  )

  }