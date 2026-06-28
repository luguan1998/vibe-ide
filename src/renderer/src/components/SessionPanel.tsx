import React, { useState, useRef, useEffect, useMemo } from 'react'
import { TerminalSession, SnippetInfo } from '@shared/types'
import { Zap, Coffee, Plus, Shield, ShieldCheck, Copy, Pencil, X, ChevronRight, MessageSquarePlus } from 'lucide-react'
import { useTheme } from '../themes'
import { useI18n } from '../i18n'
import SettingsPanel from './SettingsPanel'
import CustomCommands, { CustomCommandsHandle, loadCustomCommands, CustomCommand } from './CustomCommands'
import { loadFilterRules, saveFilterRules, DEFAULT_FILTER_RULES } from './FileTab'

// CWD 图标：按目录分配（标题行）
const DEFAULT_CWD_EMOJIS = ['🧩', '📌', '📁', '🚀', '🏷️', '🎯', '🗺️', '🔗']
// Session 图标：按会话分配（列表行）
const DEFAULT_SESSION_EMOJIS = ['🔥', '💀', '🗿', '🤡', '👽', '👻', '🤣', '👾', '⚡', '🌟', '🐉', '🤗', '🙏']

const MAX_RECENT_DIRS = 10

function loadRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem('vibe-ide-recent-dirs')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter((d: unknown) => typeof d === 'string' && d.length > 0).slice(0, MAX_RECENT_DIRS)
    }
  } catch {}
  return []
}

function saveRecentDirs(dirs: string[]): void {
  try { localStorage.setItem('vibe-ide-recent-dirs', JSON.stringify(dirs)) } catch {}
}

function addRecentDir(dir: string, existing: string[]): string[] {
  const normalized = dir.replace(/\\/g, '/')
  const next = [normalized, ...existing.filter(d => d !== normalized)].slice(0, MAX_RECENT_DIRS)
  saveRecentDirs(next)
  return next
}

// 旧版「一个合并数组按 1/3 split」迁移到两个独立池
function migrateLegacyEmojis(): void {
  try {
    if (localStorage.getItem('vibe-ide-cwd-emojis')) return
    const legacyRaw = localStorage.getItem('vibe-ide-session-emojis')
    if (!legacyRaw) return
    const arr = JSON.parse(legacyRaw)
    if (!Array.isArray(arr)) return
    const valid = arr.filter((v: unknown) => typeof v === 'string')
    if (valid.length === 0) return
    const cwdEnd = Math.ceil(valid.length / 3)
    localStorage.setItem('vibe-ide-cwd-emojis', JSON.stringify(valid.slice(0, cwdEnd)))
    localStorage.setItem('vibe-ide-session-emojis', JSON.stringify(valid.slice(cwdEnd)))
  } catch {}
}

function loadCwdEmojis(): string[] {
  migrateLegacyEmojis()
  try {
    const raw = localStorage.getItem('vibe-ide-cwd-emojis')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const valid = arr.filter((v: unknown) => typeof v === 'string')
        if (valid.length > 0) return valid
      }
    }
  } catch {}
  return [...DEFAULT_CWD_EMOJIS]
}

function saveCwdEmojis(emojis: string[]): void {
  try { localStorage.setItem('vibe-ide-cwd-emojis', JSON.stringify(emojis)) } catch {}
}

function loadSessionEmojis(): string[] {
  migrateLegacyEmojis()
  try {
    const raw = localStorage.getItem('vibe-ide-session-emojis')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const valid = arr.filter((v: unknown) => typeof v === 'string')
        if (valid.length > 0) return valid
      }
    }
  } catch {}
  return [...DEFAULT_SESSION_EMOJIS]
}

function saveSessionEmojis(emojis: string[]): void {
  try { localStorage.setItem('vibe-ide-session-emojis', JSON.stringify(emojis)) } catch {}
}

// 🌀 fallback — IPC 取不到时兜底
const FALLBACK_SHELLS = [
  { value: 'pwsh', label: 'PowerShell 7' },
  { value: 'powershell', label: 'PowerShell 5' },
]

// 🌀 fallback — 系统字体取不到时兜底
const FALLBACK_FONTS = [
  'Consolas', 'Cascadia Code', 'JetBrains Mono', 'Fira Code',
  'Source Code Pro', 'IBM Plex Mono', 'Monaco', 'Courier New', 'monospace',
]

function pickEmoji(index: number, pool: string[], override?: string): string {
  if (pool.length === 0) return ''
  if (override && pool.includes(override)) return override
  return pool[index % pool.length]
}

function getCwdEmoji(index: number, pool: string[], override?: string): string {
  return pickEmoji(index, pool, override)
}

function stableEmojiForSession(sessionId: string, pool: string[]): string {
  if (pool.length === 0) return ''
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0
  }
  return pool[Math.abs(hash) % pool.length]
}

interface SessionPanelProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  compact?: boolean
  onCreateSession: (shell?: string) => void
  onCloneSession: (parentId: string | null, cwd: string, shell?: string, name?: string) => void
  onCloneWithInit?: (sessionId: string, cwd: string, shell: string | undefined, command: string) => void
  onSwitchSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession?: (id: string, newName: string) => Promise<void>
  onReorderSessions?: (fromIndex: number, toIndex: number) => void
  onReorderGroup?: (fromGroupIndex: number, toGroupIndex: number) => void
  commandHistory?: Record<string, string[]>
  agentStatus?: Record<string, 'running' | 'idle'>
  autoApproveSessions?: Record<string, boolean>
  onToggleAutoApprove?: (sessionId: string, cwd: string) => void
  pollingEnabled?: boolean
  onTogglePolling?: (value: boolean) => void
  wordWrap?: boolean
  onToggleWordWrap?: (value: boolean) => void
  autoUtf8?: boolean
  onToggleAutoUtf8?: (value: boolean) => void
  cgEnabled?: boolean
  onToggleCgEnabled?: (value: boolean) => void
  inlineDiff?: boolean
  onToggleInlineDiff?: (value: boolean) => void
  capsuleTabs?: boolean
  onToggleCapsuleTabs?: (value: boolean) => void
  ocrEnabled?: boolean
  onToggleOcrEnabled?: (value: boolean) => void
  escAutoAt?: boolean
  onToggleEscAutoAt?: (value: boolean) => void
  fileTreeDepth?: number
  onChangeFileTreeDepth?: (delta: number) => void
  focusSettingsTrigger?: number
  onExecuteCommand?: (command: string) => void
  onInitCommand?: (command: string) => void
  sessionViewModes?: Record<string, 'term' | 'gui'>
  onSwitchViewMode?: (sessionId: string, mode: 'term' | 'gui') => void
  groupSessionsByCwd?: boolean
  onToggleGroupSessionsByCwd?: (v: boolean) => void
  terminalFontSize?: number
  editorFontSize?: number
  onAdjustTerminalFontSize?: (delta: number) => void
  onAdjustEditorFontSize?: (delta: number) => void
  fontFamily?: string
  onSetFontFamily?: (font: string) => void
  uiFontFamily?: string
  onSetUiFontFamily?: (font: string) => void
  termFontFamily?: string
  onSetTermFontFamily?: (font: string) => void
  onResetUiStyle?: () => void
}

const SessionPanel = React.memo(function SessionPanel({
  sessions,
  activeSessionId,
  compact,
  onCreateSession,
  onCloneSession,
  onCloneWithInit,
  onSwitchSession,
  onCloseSession,
  onRenameSession,
  onReorderSessions,
  onReorderGroup,
  commandHistory = {},
  agentStatus = {},
  autoApproveSessions = {},
  onToggleAutoApprove,
  pollingEnabled = false,
  onTogglePolling,
  wordWrap = false,
  onToggleWordWrap,
  autoUtf8 = true,
  onToggleAutoUtf8,
  cgEnabled = true,
  onToggleCgEnabled,
  ocrEnabled = true,
  onToggleOcrEnabled,
  inlineDiff = false,
  onToggleInlineDiff,
  capsuleTabs = true,
  onToggleCapsuleTabs,
  escAutoAt = false,
  onToggleEscAutoAt,
  fileTreeDepth = 5,
  onChangeFileTreeDepth,
  focusSettingsTrigger = 0,
  onExecuteCommand,
  onInitCommand,
  sessionViewModes = {},
  onSwitchViewMode,
  groupSessionsByCwd = true,
  onToggleGroupSessionsByCwd,
  terminalFontSize = 14,
  editorFontSize = 14,
  onAdjustTerminalFontSize,
  onAdjustEditorFontSize,
  fontFamily = 'Consolas',
  onSetFontFamily,
  uiFontFamily = 'Cascadia Code',
  onSetUiFontFamily,
  termFontFamily = 'Cascadia Code',
  onSetTermFontFamily,
  onResetUiStyle,
}: SessionPanelProps) {
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [showFileFilterRules, setShowFileFilterRules] = useState(false)
  const [fileFilterRules, setFileFilterRules] = useState<string[]>(() => loadFilterRules())
  const [fileFilterRulesDraft, setFileFilterRulesDraft] = useState('')
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [showThemeFlyout, setShowThemeFlyout] = useState(false)
  const [showCliConfigModal, setShowCliConfigModal] = useState(false)
  const [cliCommand, setCliCommand] = useState(() => {
    try { return localStorage.getItem('vibe-ide-ai-cli-command') || '' } catch { return '' }
  })
  const [cliCommandDraft, setCliCommandDraft] = useState('')
  const [termType, setTermType] = useState(() => {
    try { return localStorage.getItem('vibe-ide-term-type') || 'pwsh' } catch { return 'pwsh' }
  })
  const [shellOptions, setShellOptions] = useState(FALLBACK_SHELLS)
  const [cwdEmojis, setCwdEmojis] = useState<string[]>(() => loadCwdEmojis())
  const [sessionEmojis, setSessionEmojis] = useState<string[]>(() => loadSessionEmojis())
  const [cwdEmojiOverrides, setCwdEmojiOverrides] = useState<Record<string, string>>({})
  const [sessionEmojiOverrides, setSessionEmojiOverrides] = useState<Record<string, string>>({})
  const [cwdEmojiDraft, setCwdEmojiDraft] = useState('')
  const [sessionEmojiDraft, setSessionEmojiDraft] = useState('')
  const [showOtherOptions, setShowOtherOptions] = useState(false)
  const [showUiStyleModal, setShowUiStyleModal] = useState(false)
  const [uiStyleTab, setUiStyleTab] = useState<'style' | 'emoji'>('style')
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const fontsLoadedRef = useRef(false)
  const fontsLoadingRef = useRef(false)
  const pendingFontsRef = useRef(0)

  // 池变更时清理失效 override（用户在 modal 删了被 override 引用的 emoji 时）
  useEffect(() => {
    setCwdEmojiOverrides(prev => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) if (cwdEmojis.includes(v)) next[k] = v
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [cwdEmojis])
  useEffect(() => {
    setSessionEmojiOverrides(prev => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) if (sessionEmojis.includes(v)) next[k] = v
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [sessionEmojis])

  // 启动时从主进程获取本机已安装的 shell，过滤选项
  useEffect(() => {
    window.api.terminal.getShells().then((shells: { value: string; label: string }[]) => {
      if (shells.length > 0) {
        setShellOptions(shells)
        // 如果当前选中的 shell 不在可用列表中，切到第一个
        setTermType(prev => {
          if (shells.some(s => s.value === prev)) return prev
          const first = shells[0].value
          try { localStorage.setItem('vibe-ide-term-type', first) } catch {}
          return first
        })
      }
    }).catch(() => {})
  }, [])

  // 点击字体下拉时从主进程获取本机已安装字体（主进程缓存，仅加载一次）
  const loadSystemFonts = () => {
    if (fontsLoadedRef.current || fontsLoadingRef.current) return
    fontsLoadingRef.current = true
    const target = ++pendingFontsRef.current
    window.api.system.listFonts()
      .then((fonts) => {
        if (pendingFontsRef.current !== target) return
        if (fonts.length > 0) { setSystemFonts(fonts); fontsLoadedRef.current = true }
      })
      .catch(() => {})
      .finally(() => {
        if (pendingFontsRef.current !== target) return
        fontsLoadingRef.current = false
      })
  }

  const renderFontOptions = (currentValue: string, recommended?: string) => {
    const list = systemFonts.length > 0 ? systemFonts : FALLBACK_FONTS
    const prepend = !!currentValue && !list.includes(currentValue)
    const mark = (f: string) => f === recommended ? ` (${t('Recommended')})` : ''
    return (<>
      {prepend && <option key={`__cur__${currentValue}`} value={currentValue}>{currentValue}{mark(currentValue)}</option>}
      {list.map((f) => <option key={f} value={f}>{f}{mark(f)}</option>)}
    </>)
  }

  // Sync filter rules to git watcher (main process) on mount and when rules change
  useEffect(() => {
    window.api.git.setFilterRules(fileFilterRules)
  }, [fileFilterRules])

  const { themes, currentThemeId, setTheme } = useTheme()
  const { t, lang, setLang } = useI18n()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [cloneSubmenu, setCloneSubmenu] = useState<{ x: number; y: number; sessionId: string; cwd: string; shell?: string; initCommands: CustomCommand[] } | null>(null)
  const cloneSubmenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [emptyAreaMenu, setEmptyAreaMenu] = useState<{ x: number; y: number } | null>(null)
  const [recentDirs, setRecentDirs] = useState<string[]>(() => loadRecentDirs())
  const prevSessionIdsRef = useRef<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [hoverPreview, setHoverPreview] = useState<{ sessionId: string; name: string; left: number; top: number } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cwdHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cwdLinkSession, setCwdLinkSession] = useState<string | null>(null)
  const themeFlyoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showSnippetsFlyout, setShowSnippetsFlyout] = useState(false)
  const [snippetsList, setSnippetsList] = useState<SnippetInfo[]>([])
  const snippetsFlyoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configBtnRef = useRef<HTMLButtonElement>(null)
  const [configMenuStyle, setConfigMenuStyle] = useState<React.CSSProperties>({})
  const [flyoutOnLeft, setFlyoutOnLeft] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const commandsRef = useRef<CustomCommandsHandle>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [dragGroupIndex, setDragGroupIndex] = useState<number | null>(null)
  const [dropGroupIndex, setDropGroupIndex] = useState<number | null>(null)

  const handleToggleConfig = () => {
    if (!showConfigMenu && configBtnRef.current) {
      const rect = configBtnRef.current.getBoundingClientRect()
      const menuWidth = 192
      const left = Math.max(4, rect.right - menuWidth)
      setConfigMenuStyle({
        position: 'fixed',
        left,
        top: rect.bottom + 4,
        minWidth: menuWidth,
      })
      setFlyoutOnLeft((left + menuWidth + 8 + 172) > window.innerWidth)
    }
    setShowConfigMenu(!showConfigMenu)
  }

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renaming])

  // Track new sessions to record their cwd as recent directories
  useEffect(() => {
    for (const s of sessions) {
      if (!prevSessionIdsRef.current.has(s.id)) {
        setRecentDirs(prev => addRecentDir(s.cwd, prev))
      }
    }
    prevSessionIdsRef.current = new Set(sessions.map(s => s.id))
  }, [sessions])

  // Group sessions by normalized cwd
  const sessionGroups = useMemo(() => {
    const map = new Map<string, TerminalSession[]>()
    const order: string[] = []
    for (const s of sessions) {
      const key = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
      if (!map.has(key)) {
        map.set(key, [])
        order.push(key)
      }
      map.get(key)!.push(s)
    }
    return order.map(cwd => ({ cwd, sessions: map.get(cwd)! }))
  }, [sessions])

  // Flat index map for drag reorder: visual position → session index in original array
  const flatIndexMap = useMemo(() => {
    const map: number[] = []
    for (const g of sessionGroups) {
      for (const s of g.sessions) {
        map.push(sessions.findIndex(si => si.id === s.id))
      }
    }
    return map
  }, [sessionGroups, sessions])

  useEffect(() => {
    const handleClick = () => { setContextMenu(null); setEmptyAreaMenu(null) }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  useEffect(() => {
    if (!showConfigMenu) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.config-menu-area')) {
        setShowConfigMenu(false)
      }
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [showConfigMenu])

  // Settings menu: auto-close when mouse leaves the menu area (incl. submenus)
  useEffect(() => {
    if (!showConfigMenu) return
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    const isInMenuArea = (el: EventTarget | null) =>
      !!(el as HTMLElement | null)?.closest('.config-menu-area')
    const handleMouseOut = (e: MouseEvent) => {
      if (isInMenuArea(e.target) && !isInMenuArea(e.relatedTarget)) {
        if (closeTimer) clearTimeout(closeTimer)
        closeTimer = setTimeout(() => setShowConfigMenu(false), 200)
      }
    }
    const handleMouseOver = (e: MouseEvent) => {
      if (isInMenuArea(e.target)) {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
      }
    }
    document.addEventListener('mouseout', handleMouseOut, true)
    document.addEventListener('mouseover', handleMouseOver, true)
    return () => {
      document.removeEventListener('mouseout', handleMouseOut, true)
      document.removeEventListener('mouseover', handleMouseOver, true)
      if (closeTimer) clearTimeout(closeTimer)
    }
  }, [showConfigMenu])

  // ESC handler for Other Options modal (capture phase per CLAUDE.md rule #8)
  useEffect(() => {
    if (!showOtherOptions) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setShowOtherOptions(false)
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [showOtherOptions])

  // ESC handler for UI Style modal (capture phase per CLAUDE.md rule #8)
  useEffect(() => {
    if (!showUiStyleModal) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setShowUiStyleModal(false)
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [showUiStyleModal])

  // ESC handler for CLI Config modal (capture phase per CLAUDE.md rule #8)
  useEffect(() => {
    if (!showCliConfigModal) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setShowCliConfigModal(false)
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [showCliConfigModal])

  // Menu → Settings → Keyboard Shortcuts opens the shortcuts modal
  useEffect(() => {
    if (focusSettingsTrigger > 0) {
      setShowShortcuts(true)
    }
  }, [focusSettingsTrigger])

  useEffect(() => { window.api.appVersion().then(setAppVersion).catch(() => {}) }, [])

  // 打开配置菜单时加载 snippets 列表
  useEffect(() => {
    if (showConfigMenu) {
      window.api.snippets.load().then(r => setSnippetsList(r.snippets)).catch(() => {})
    }
  }, [showConfigMenu])

  const handleSnippetToggle = async (filename: string, enabled: boolean) => {
    const result = await window.api.snippets.toggle(filename, enabled)
    setSnippetsList(result.snippets)
    const style = document.getElementById('custom-css')
    if (style) { style.textContent = result.css }
    else if (result.css) {
      const s = document.createElement('style')
      s.id = 'custom-css'
      s.textContent = result.css
      document.head.appendChild(s)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
  }

  const handleEmptyAreaContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setEmptyAreaMenu({ x: e.clientX, y: e.clientY })
  }

  const handleRename = async () => {
    if (!renaming || !newName.trim()) {
      setRenaming(null)
      return
    }
    if (onRenameSession) {
      await onRenameSession(renaming, newName.trim())
    } else {
      await (window.api.terminal as any).rename(renaming, newName.trim())
    }
    setRenaming(null)
    setNewName('')
  }

  const startRename = (session: TerminalSession) => {
    setRenaming(session.id)
    setNewName(session.name)
    setContextMenu(null)
  }

  const stats = useMemo(() => {
    const total = sessions.length
    const running = sessions.filter(s => agentStatus[s.id] === 'running').length
    const idle = total - running
    return { running, idle }
  }, [sessions, agentStatus])

  const renderSessionItem = (
    session: TerminalSession,
    dragIdx: number,
    opts: { showAutoApprove: boolean; showCwd: boolean; outerClass: string; nameClass: string; minHeightClass: string }
  ) => (
    <div
      key={session.id}
      draggable={!!onReorderSessions}
      className={`group ${opts.outerClass} session-item${
        session.id === activeSessionId ? ' session-item--active' : ''
      } ${
        session.id === activeSessionId
          ? 'bg-ide-accent/20 text-ide-text border-l-[3px] border-ide-accent'
          : agentStatus[session.id] === 'running'
            ? 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text border-l-[3px] border-ide-accent/60'
            : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
      } ${dragIndex === dragIdx ? 'opacity-40' : ''} ${dropIndex === dragIdx && dropIndex !== dragIndex ? 'border-t-2 border-ide-accent' : ''}`}
      onClick={() => onSwitchSession(session.id)}
      onDoubleClick={(e) => { e.stopPropagation(); startRename(session) }}
      onContextMenu={(e) => handleContextMenu(e, session.id)}
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        hoverTimerRef.current = setTimeout(() => {
          setHoverPreview({ sessionId: session.id, name: session.name, left: rect.right + 6, top: rect.top })
        }, 600)
      }}
      onMouseLeave={() => {
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current)
        }
        hoverTimerRef.current = setTimeout(() => {
          setHoverPreview(null)
        }, 200)
      }}
      onDragStart={() => { setDragIndex(dragIdx); setDragGroupIndex(null); setDropGroupIndex(null) }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (dragIndex === null || dragIndex === dragIdx) {
          setDropIndex(null)
          return
        }
        const rect = e.currentTarget.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        setDropIndex(e.clientY < midY ? dragIdx : dragIdx + 1)
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (dragIndex !== null && dragIndex !== dragIdx) {
          const toIndex = dropIndex !== null && dropIndex > dragIndex ? dropIndex - 1 : dropIndex ?? dragIdx
          onReorderSessions?.(dragIndex, toIndex)
        }
        setDragIndex(null)
        setDropIndex(null)
        setDragGroupIndex(null)
        setDropGroupIndex(null)
      }}
      onDragEnd={() => {
        setDragIndex(null)
        setDropIndex(null)
        setDragGroupIndex(null)
        setDropGroupIndex(null)
      }}
    >
      <div className={`flex items-center justify-between ${opts.minHeightClass}`}>
        <div className={`flex items-center gap-1.5 min-w-0 flex-1 ${opts.showCwd ? 'pr-12' : ''}`}>
          {renaming === session.id ? (
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleRename()
                }
                if (e.key === 'Escape') setRenaming(null)
              }}
              onBlur={handleRename}
              className="bg-ide-bg border border-ide-accent rounded px-1 text-xs text-ide-text outline-none w-24"
            />
          ) : (
            <>
              {(() => {
                const sessionEmoji = sessionEmojiOverrides[session.id] || stableEmojiForSession(session.id, sessionEmojis)
                return (
                  <span
                    className="text-sm shrink-0 w-4 h-4 flex items-center justify-center cursor-pointer hover:bg-ide-hover rounded select-none transition-colors session-item__icon"
                    title={t('Click to cycle emoji')}
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      if (sessionEmojis.length === 0) return
                      const idx = sessionEmojis.indexOf(sessionEmoji)
                      const next = sessionEmojis[(idx + 1) % sessionEmojis.length]
                      setSessionEmojiOverrides(prev => ({ ...prev, [session.id]: next }))
                    }}
                    onContextMenu={(e) => e.stopPropagation()}
                  >{sessionEmoji}</span>
                )
              })()}
              <span className={`text-sm ${opts.nameClass} session-item__name ${agentStatus[session.id] === 'running' ? 'animate-text-wave' : ''}`} title={session.name}>{session.name}</span>
            </>
          )}
        </div>
        <div className={`flex items-center session-item__actions ${opts.showCwd ? 'absolute right-3 top-1/2 -translate-y-1/2' : ''}`}>
          {opts.showAutoApprove && onToggleAutoApprove && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleAutoApprove(session.id, session.cwd) }}
              className={`w-5 h-5 rounded transition-all shrink-0 flex items-center justify-center ${
                autoApproveSessions[session.id]
                  ? 'text-ide-accent opacity-100'
                  : 'text-ide-text-muted opacity-0 group-hover:opacity-100 hover:bg-ide-accent hover:text-white'
              }`}
              title={autoApproveSessions[session.id] ? t('Auto Approve: ON') : t('Auto Approve: OFF')}
            >
              {autoApproveSessions[session.id] ? <ShieldCheck size={13} /> : <Shield size={13} />}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCloseSession(session.id)
            }}
            className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-ide-text-muted hover:bg-ide-accent hover:text-white transition-all shrink-0 flex items-center justify-center"
            title={t('Close Session')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      {opts.showCwd && (
        <div
          className="text-xs mt-0.5 session-item__cwd"
          onMouseEnter={() => {
            cwdHoverTimerRef.current = setTimeout(() => {
              setCwdLinkSession(session.id)
            }, 600)
          }}
          onMouseLeave={() => {
            if (cwdHoverTimerRef.current) {
              clearTimeout(cwdHoverTimerRef.current)
              cwdHoverTimerRef.current = null
            }
            setCwdLinkSession(null)
          }}
        >
          <span
            className={`inline-block max-w-full truncate transition-all ${
              cwdLinkSession === session.id
                ? 'underline text-ide-text cursor-pointer bg-ide-accent/15 rounded px-0.5'
                : 'text-ide-text-muted opacity-70'
            }`}
            title={cwdLinkSession === session.id ? t('Open in Explorer') : session.cwd.length > 18 ? session.cwd : undefined}
            onClick={(e) => {
              if (cwdLinkSession === session.id) {
                e.stopPropagation()
                window.api.file.openExplorer(session.cwd)
              }
            }}
          >
            {session.cwd.length > 20 ? session.cwd.replace(/^.*[\\\/]/, '') : session.cwd}
          </span>
        </div>
      )}
    </div>
  )

  return (
    <div className={`flex flex-col session-panel${compact ? '' : ' h-full'}`} style={{ fontFamily: 'var(--ide-session-font)' }}>
      {/* Header + Dashboard merged */}
      <div className="h-10 px-5 flex items-center justify-between shrink-0 session-panel__header">
        <div className="flex items-center gap-1.5 session-panel__stats">
          <span
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors session-panel__stat ${
              stats.running > 0
                ? 'text-ide-accent bg-ide-accent/10'
                : 'text-ide-text-muted bg-ide-hover'
            }`}
            title={t('running')}
          >
            <Zap size={13} className={`shrink-0 ${stats.running > 0 ? 'animate-zap-glow' : ''}`} />
            <span className="text-xs font-bold font-mono">{stats.running}</span>
          </span>
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded text-ide-text-muted bg-ide-hover transition-colors session-panel__stat"
            title={t('Idle')}
          >
            <Coffee size={13} className="shrink-0" />
            <span className="text-xs font-bold font-mono">{stats.idle}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative config-menu-area session-panel__config">
            <button
              ref={configBtnRef}
              className={`w-6 h-6 rounded flex items-center justify-center transition-colors shrink-0 session-panel__config-btn ${
                showConfigMenu
                  ? 'text-ide-accent bg-ide-accent/20'
                  : 'text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white'
              }`}
              onClick={handleToggleConfig}
              title={t('Settings')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[13px] h-[13px]">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {showConfigMenu && (
              <div style={configMenuStyle} className="bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 config-menu-area session-panel__config-menu">
                {/* Language toggle */}
                <div className="flex items-center justify-between mx-3 my-1.5">
                  <div className="inline-flex items-center rounded-md bg-ide-hover overflow-hidden">
                    <button
                      className={`px-2 py-1 text-[11px] transition-colors ${lang === 'zh' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text'}`}
                      onClick={() => setLang('zh')}
                    >中</button>
                    <button
                      className={`px-2 py-1 text-[11px] transition-colors ${lang === 'en' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text'}`}
                      onClick={() => setLang('en')}
                    >EN</button>
                  </div>
                  {appVersion && (
                    <span className="text-[11px] text-ide-text-muted/60">v{appVersion}</span>
                  )}
                </div>
                <div className="border-t border-ide-border mt-1 pt-1">
                {/* Theme flyout */}
                <div
                  className="relative"
                  onMouseEnter={() => {
                    if (themeFlyoutTimerRef.current) clearTimeout(themeFlyoutTimerRef.current)
                    setShowThemeFlyout(true)
                  }}
                  onMouseLeave={() => {
                    themeFlyoutTimerRef.current = setTimeout(() => setShowThemeFlyout(false), 200)
                  }}
                >
                  <div className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors">
                    {t('Theme')}
                  </div>
                  {showThemeFlyout && (
                    <div
                      className={`absolute top-0 ${flyoutOnLeft ? 'right-full mr-1' : 'left-full ml-1'} w-44 bg-ide-bg border border-ide-border rounded shadow-lg py-1 max-h-64 overflow-y-auto session-panel__theme-list`}
                      onMouseEnter={() => {
                        if (themeFlyoutTimerRef.current) clearTimeout(themeFlyoutTimerRef.current)
                      }}
                      onMouseLeave={() => setShowThemeFlyout(false)}
                    >
                      {themes.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => { setTheme(t.id) }}
                          className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors ${
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
                    </div>
                  )}
                </div>
                </div>
                {/* Snippets */}
                <div className="border-t border-ide-border mt-1 pt-1">
                <div
                  className="relative"
                  onMouseEnter={() => {
                    if (snippetsFlyoutTimerRef.current) clearTimeout(snippetsFlyoutTimerRef.current)
                    setShowSnippetsFlyout(true)
                  }}
                  onMouseLeave={() => {
                    snippetsFlyoutTimerRef.current = setTimeout(() => setShowSnippetsFlyout(false), 200)
                  }}
                >
                  <div className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors">
                    {t('CSS Snippets')}
                  </div>
                  {showSnippetsFlyout && (
                    <div
                      className={`absolute top-0 ${flyoutOnLeft ? 'right-full mr-1' : 'left-full ml-1'} w-52 bg-ide-bg border border-ide-border rounded shadow-lg py-1 max-h-64 overflow-y-auto session-panel__snippets-list`}
                      onMouseEnter={() => {
                        if (snippetsFlyoutTimerRef.current) clearTimeout(snippetsFlyoutTimerRef.current)
                      }}
                      onMouseLeave={() => setShowSnippetsFlyout(false)}
                    >
                      {snippetsList.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-ide-text-muted">
                          {t('No snippets found.\nPlace .css files in the snippets/ folder.')}
                        </div>
                      ) : (
                        snippetsList.map(s => (
                          <button
                            key={s.name}
                            onClick={() => handleSnippetToggle(s.name, !s.enabled)}
                            className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors ${
                              s.enabled ? 'text-ide-text hover:bg-ide-hover' : 'text-ide-text-muted/40 hover:bg-ide-hover hover:text-ide-text-muted'
                            }`}
                          >
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              s.enabled ? 'bg-ide-accent border-ide-accent text-white' : 'border-ide-border'
                            }`}>
                              {s.enabled && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </span>
                            <span className="truncate">{s.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                </div>
                {/* UI Style */}
                {(onToggleCapsuleTabs || onToggleGroupSessionsByCwd || onToggleInlineDiff || onAdjustTerminalFontSize || onAdjustEditorFontSize) && (
                  <div className="border-t border-ide-border mt-1 pt-1">
                    <button
                      className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors"
                      onClick={() => {
                        setCwdEmojiDraft(cwdEmojis.join('\n'))
                        setSessionEmojiDraft(sessionEmojis.join('\n'))
                        setShowUiStyleModal(true)
                        setShowConfigMenu(false)
                      }}
                    >
                      {t('UI Style')}
                    </button>
                  </div>
                )}
                <div className="border-t border-ide-border mt-1 pt-1">
                {/* 命令行配置 */}
                <button
                  className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors"
                  onClick={() => {
                    setCliCommandDraft(cliCommand)
                    setShowCliConfigModal(true)
                    setShowConfigMenu(false)
                  }}
                >
                  {t('CLI Configuration')}
                </button>
                </div>
                {/* Keyboard Shortcuts */}
                <div className="border-t border-ide-border mt-1 pt-1">
                  <button
                    className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors"
                    onClick={() => { setShowShortcuts(true); setShowConfigMenu(false) }}
                  >
                    {t('Keyboard Shortcuts')}
                  </button>
                </div>
                {/* File Tree Depth */}
                {onChangeFileTreeDepth && (
                  <div className="border-t border-ide-border mt-1 pt-1">
                    <div className="flex items-center justify-between px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover">
                      <span className="whitespace-nowrap shrink-0">{t('File Tree Depth')}</span>
                      <div className="flex items-center gap-px">
                        <button
                          className="w-4 h-4 rounded bg-ide-hover text-ide-text-muted hover:bg-ide-accent hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none disabled:opacity-30 disabled:cursor-not-allowed"
                          disabled={fileTreeDepth <= 1}
                          onClick={(e) => { e.stopPropagation(); onChangeFileTreeDepth(-1) }}
                        >{'<'}</button>
                        <span className="text-center font-mono text-ide-accent font-bold text-xs leading-none">{fileTreeDepth}</span>
                        <button
                          className="w-4 h-4 rounded bg-ide-hover text-ide-text-muted hover:bg-ide-accent hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none disabled:opacity-30 disabled:cursor-not-allowed"
                          disabled={fileTreeDepth >= 12}
                          onClick={(e) => { e.stopPropagation(); onChangeFileTreeDepth(1) }}
                        >{'>'}</button>
                      </div>
                    </div>
                  </div>
                )}
                {/* File Filter Rules */}
                <div className="border-t border-ide-border mt-1 pt-1">
                  <button
                    className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors"
                    onClick={() => {
                      setFileFilterRulesDraft(fileFilterRules.join('\n'))
                      setShowFileFilterRules(true)
                      setShowConfigMenu(false)
                    }}
                  >
                    {t('File Filter Rules')}
                  </button>
                </div>
                {/* Other Options */}
                {(onToggleWordWrap || onToggleAutoUtf8 || onTogglePolling || onToggleInlineDiff) && (
                  <div className="border-t border-ide-border mt-1 pt-1">
                    <button
                      className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors"
                      onClick={() => { setShowOtherOptions(true); setShowConfigMenu(false) }}
                    >
                      {t('Other Options…')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => onCreateSession(termType)}
            className="w-6 h-6 rounded flex items-center justify-center transition-colors shrink-0 session-panel__new-btn text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white"
            title={`${t('New Terminal')} (${shellOptions.find(tt => tt.value === termType)?.label || termType})`}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 min-h-0 mx-2 mb-2 mt-1 overflow-hidden flex flex-col rounded-lg session-panel__list-wrapper">
        <div className="flex-1 min-h-0 overflow-y-auto pb-2 session-panel__list"
          onDragOver={(e) => {
            if (dragGroupIndex !== null && sessionGroups.length > 0) {
              e.preventDefault()
              e.stopPropagation()
              setDropGroupIndex(sessionGroups.length)
            } else if (dragIndex !== null && sessions.length > 0) {
              setDropIndex(sessions.length)
            }
          }}
          onDrop={(e) => {
            if (dragGroupIndex !== null && dragGroupIndex !== sessionGroups.length) {
              e.preventDefault()
              e.stopPropagation()
              const targetIdx = dropGroupIndex !== null ? dropGroupIndex : sessionGroups.length
              const toIdx = targetIdx > dragGroupIndex ? targetIdx - 1 : targetIdx
              onReorderGroup?.(dragGroupIndex, toIdx)
            }
            setDragGroupIndex(null)
            setDropGroupIndex(null)
            setDragIndex(null)
            setDropIndex(null)
          }}
          onContextMenu={handleEmptyAreaContextMenu}
        >
        {sessions.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ide-text-muted text-sm">
            No sessions yet
          </div>
        ) : groupSessionsByCwd ? (
          sessionGroups.map((group, gi) => {
            const dirName = group.cwd.replace(/^.*[\/]/, '')
            const cwdEmoji = getCwdEmoji(gi, cwdEmojis, cwdEmojiOverrides[group.cwd])
            const groupHasActive = activeSessionId && group.sessions.some(s => s.id === activeSessionId)
            return (
              <div
                key={group.cwd}
                className={`bg-ide-sidebar border border-ide-border rounded-lg overflow-hidden session-group ${gi > 0 ? 'mt-3' : ''}`}
                style={dropGroupIndex === gi && dropGroupIndex !== dragGroupIndex ? { borderTop: '2px solid rgb(var(--ide-accent))' } : undefined}
              >
                {/* Folder header */}
                <div
                  draggable={!!onReorderGroup}
                  className={`group h-7 pl-4 pr-3 shrink-0 select-none flex items-center justify-between border-b border-ide-border text-ide-text-muted acrylic-titlebar rounded-t-lg session-group__header ${
                    dragGroupIndex === gi ? 'opacity-40' : ''
                  }`}
                  onDragStart={() => { setDragGroupIndex(gi); setDragIndex(null); setDropIndex(null) }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (dragGroupIndex === null || dragGroupIndex === gi) {
                      setDropGroupIndex(null)
                      return
                    }
                    const rect = e.currentTarget.getBoundingClientRect()
                    const midY = rect.top + rect.height / 2
                    setDropGroupIndex(e.clientY < midY ? gi : gi + 1)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (dragGroupIndex !== null && dragGroupIndex !== gi) {
                      const targetIdx = dropGroupIndex !== null ? dropGroupIndex : gi
                      const toIdx = targetIdx > dragGroupIndex ? targetIdx - 1 : targetIdx
                      onReorderGroup?.(dragGroupIndex, toIdx)
                    }
                    setDragGroupIndex(null)
                    setDropGroupIndex(null)
                    setDragIndex(null)
                    setDropIndex(null)
                  }}
                  onDragEnd={() => {
                    setDragGroupIndex(null)
                    setDropGroupIndex(null)
                    setDragIndex(null)
                    setDropIndex(null)
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-xs shrink-0 w-3.5 h-3.5 flex items-center justify-center cursor-pointer hover:bg-ide-hover rounded select-none transition-colors"
                      title={t('Click to cycle emoji')}
                      draggable={false}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        if (cwdEmojis.length === 0) return
                        const idx = cwdEmojis.indexOf(cwdEmoji)
                        const next = cwdEmojis[(idx + 1) % cwdEmojis.length]
                        setCwdEmojiOverrides(prev => ({ ...prev, [group.cwd]: next }))
                      }}
                      onContextMenu={(e) => e.stopPropagation()}
                    >{cwdEmoji}</span>
                    <span
                      className={`text-xs font-medium truncate min-w-0 cursor-pointer transition-all session-group__path ${
                        groupHasActive || cwdLinkSession === group.cwd ? 'text-ide-text' : 'text-ide-text-muted'
                      } ${
                        cwdLinkSession === group.cwd
                          ? 'underline bg-ide-accent/15 rounded px-0.5'
                          : ''
                      }`}
                      title={group.cwd}
                      onMouseEnter={() => {
                        cwdHoverTimerRef.current = setTimeout(() => {
                          setCwdLinkSession(group.cwd)
                        }, 600)
                      }}
                      onMouseLeave={() => {
                        if (cwdHoverTimerRef.current) {
                          clearTimeout(cwdHoverTimerRef.current)
                          cwdHoverTimerRef.current = null
                        }
                        setCwdLinkSession(null)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (cwdLinkSession === group.cwd) {
                          window.api.file.openExplorer(group.cwd)
                        }
                      }}
                    >{dirName}</span>
                  </div>
                  <div className="flex items-center">
                  {onToggleAutoApprove && (() => {
                    const anyOn = group.sessions.some(s => autoApproveSessions[s.id])
                    const firstSession = group.sessions[0]
                    return firstSession ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleAutoApprove(firstSession.id, firstSession.cwd)
                        }}
                        className={`w-5 h-5 rounded transition-all shrink-0 flex items-center justify-center ${
                          anyOn
                            ? 'text-ide-accent opacity-100'
                            : 'text-ide-text-muted opacity-0 group-hover:opacity-100 hover:bg-ide-accent hover:text-white'
                        }`}
                        title={anyOn ? t('Auto Approve: ON') : t('Auto Approve: OFF')}
                      >
                        {anyOn ? <ShieldCheck size={13} /> : <Shield size={13} />}
                      </button>
                    ) : null
                  })()}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onCloneSession(null, group.cwd, termType)
                      }}
                      className="w-5 h-5 rounded text-ide-text-muted opacity-0 group-hover:opacity-100 hover:bg-ide-accent hover:text-white transition-all shrink-0 flex items-center justify-center"
                      title={t('New Terminal in this folder')}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
                {/* Sessions under this folder */}
                <div>
                {group.sessions.map((session) => {
                  const flatIdx = flatIndexMap.indexOf(sessions.findIndex(si => si.id === session.id))
                  return renderSessionItem(session, flatIdx, { showAutoApprove: false, showCwd: false, outerClass: 'pl-4 pr-3 py-1 cursor-pointer transition-colors min-h-[44px] h-auto', nameClass: 'line-clamp-2 break-all', minHeightClass: 'min-h-[44px]' })
                })}
                </div>
              </div>
            )
          })
        ) : (
          <div className="bg-ide-sidebar border border-ide-border rounded-lg overflow-hidden session-panel__flat-list">
            {sessions.map((session, index) => renderSessionItem(session, index, { showAutoApprove: true, showCwd: true, outerClass: 'px-3 py-1 cursor-pointer transition-colors relative', nameClass: 'truncate min-w-0', minHeightClass: 'min-h-[32px]' }))}
          </div>
        )}
        {dropGroupIndex !== null && dropGroupIndex === sessionGroups.length && dropGroupIndex !== dragGroupIndex && (
          <div className="mx-1 border-t-2 border-ide-accent mt-1" />
        )}
        {dropIndex === sessions.length && dropIndex !== dragIndex && dragIndex !== sessions.length - 1 && (
          <div className="mx-1 border-t-2 border-ide-accent" />
        )}
        </div>

      {/* Custom Commands */}
      <CustomCommands ref={commandsRef} onExecuteCommand={onExecuteCommand} onInitCommand={onInitCommand} />

      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative"
            onMouseEnter={() => {
              const cmds = loadCustomCommands().filter(c => c.type === 'init')
              if (cmds.length === 0) return
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (!session) return
              if (cloneSubmenuTimerRef.current) { clearTimeout(cloneSubmenuTimerRef.current); cloneSubmenuTimerRef.current = null }
              setCloneSubmenu({ x: contextMenu.x + 168, y: contextMenu.y + 4, sessionId: session.id, cwd: session.cwd, shell: session.shell, initCommands: cmds })
            }}
            onMouseLeave={() => {
              cloneSubmenuTimerRef.current = setTimeout(() => setCloneSubmenu(null), 150)
            }}
          >
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
              onClick={() => {
                const session = sessions.find(s => s.id === contextMenu.sessionId)
                if (session) {
                  onCloneSession(session.id, session.cwd, session.shell)
                }
                setContextMenu(null)
                setCloneSubmenu(null)
              }}
            >
              <Copy size={14} className="text-ide-text-muted" />
              <span>{t('Clone')}</span>
              {loadCustomCommands().some(c => c.type === 'init') && (
                <ChevronRight size={14} className="ml-auto text-ide-text-muted" />
              )}
            </button>
            {cloneSubmenu && cloneSubmenu.sessionId === contextMenu.sessionId && (
              <div
                className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[140px]"
                style={{ left: cloneSubmenu.x, top: cloneSubmenu.y }}
                onMouseEnter={() => {
                  if (cloneSubmenuTimerRef.current) { clearTimeout(cloneSubmenuTimerRef.current); cloneSubmenuTimerRef.current = null }
                }}
                onMouseLeave={() => {
                  setCloneSubmenu(null)
                }}
              >
                {cloneSubmenu.initCommands.map(cmd => (
                  <button
                    key={cmd.id}
                    className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
                    onClick={() => {
                      if (onCloneWithInit) {
                        onCloneWithInit(cloneSubmenu.sessionId, cloneSubmenu.cwd, cloneSubmenu.shell, cmd.command)
                      }
                      setContextMenu(null)
                      setCloneSubmenu(null)
                    }}
                  >
                    <MessageSquarePlus size={14} className="text-ide-accent" />
                    <span className="truncate max-w-[180px]">{cmd.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {onToggleAutoApprove && (() => {
            const session = sessions.find(s => s.id === contextMenu.sessionId)
            const isOn = session ? autoApproveSessions[session.id] : false
            return (
              <button
                className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
                onClick={() => {
                  if (session) onToggleAutoApprove(session.id, session.cwd)
                  setContextMenu(null)
                }}
              >
                {isOn ? <ShieldCheck size={14} className="text-ide-accent" /> : <Shield size={14} className="text-ide-text-muted" />}
                <span>{t('Auto Approve')}</span>
                {isOn && <span className="ml-auto text-ide-accent text-xs">✓</span>}
              </button>
            )
          })()}
          {onSwitchViewMode && (() => {
            const isGui = sessionViewModes[contextMenu.sessionId] === 'gui'
            return (
              <button
                className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
                onClick={() => {
                  onSwitchViewMode(contextMenu.sessionId, isGui ? 'term' : 'gui')
                  setContextMenu(null)
                }}
              >
                <Zap size={14} className={isGui ? 'text-ide-text-muted' : 'text-ide-accent'} />
                <span>{t(isGui ? 'Switch to Terminal Mode' : 'Switch to GUI Mode')}</span>
              </button>
            )
          })()}
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (session) startRename(session)
            }}
          >
            <Pencil size={14} className="text-ide-text-muted" />
            <span>{t('Rename')}</span>
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-danger hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              onCloseSession(contextMenu.sessionId)
              setContextMenu(null)
            }}
          >
            <X size={14} className="text-ide-danger" />
            <span>{t('Close')}</span>
          </button>
        </div>
      )}

      {/* Empty Area Context Menu — recent directories */}
      {emptyAreaMenu && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[200px]"
          style={{ left: emptyAreaMenu.x, top: emptyAreaMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              onCreateSession(termType)
              setEmptyAreaMenu(null)
            }}
          >
            <Plus size={14} className="text-ide-text-muted" />
            {t('New Terminal')}
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              commandsRef.current?.openCreateModal()
              setEmptyAreaMenu(null)
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-text-muted shrink-0">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            {t('Custom Command')}
          </button>
          {recentDirs.length > 0 && (
            <>
              <div className="border-t border-ide-border my-1" />
              <div className="px-3 py-1 text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Recent Directories')}</div>
              {recentDirs.map((dir, i) => (
                <div
                  key={`${dir}-${i}`}
                  className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2 group"
                >
                  <button
                    className="flex items-center gap-2 truncate flex-1 cursor-pointer bg-transparent border-none text-inherit text-sm p-0"
                    onClick={() => {
                      onCloneSession(null, dir, termType)
                      setEmptyAreaMenu(null)
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-text-muted shrink-0">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="truncate">{dir}</span>
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover flex items-center justify-center shrink-0 transition-all -mr-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRecentDirs(prev => {
                        const next = prev.filter((_, idx) => idx !== i)
                        saveRecentDirs(next)
                        return next
                      })
                    }}
                    title={t('Remove')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* History Hover Popover */}
      {hoverPreview && (() => {
        const cmds = commandHistory[hoverPreview.sessionId] || []
        const displayed = cmds.slice(-30)
        return (
          <div
            className="fixed z-50 bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-80 max-h-64 flex flex-col"
            style={{ left: hoverPreview.left, top: hoverPreview.top }}
            onMouseEnter={() => {
              if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current)
                hoverTimerRef.current = null
              }
            }}
            onMouseLeave={() => {
              hoverTimerRef.current = setTimeout(() => {
                setHoverPreview(null)
              }, 300)
            }}
          >
            <div className="flex items-center px-3 py-1 border-b border-ide-border shrink-0 bg-ide-sidebar">
              <span className="text-xs font-semibold text-ide-text truncate">{hoverPreview.name}</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {cmds.length === 0 ? (
                <div className="px-3 py-4 text-xs text-ide-text-muted text-center">
                  {t('No commands yet')}
                </div>
              ) : (
                displayed.map((cmd, i) => (
                  <div
                    key={`hp-${i}`}
                    className="px-3 py-0.5 text-xs font-mono text-ide-text hover:bg-ide-hover flex items-center gap-2 group"
                  >
                    <span className="text-ide-text-muted shrink-0 select-none w-5 text-right">
                      {cmds.length - displayed.length + i + 1}
                    </span>
                    <span className="truncate flex-1" title={cmd}>
                      {cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd}
                    </span>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        await navigator.clipboard.writeText(cmd)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-ide-text-muted hover:text-ide-text shrink-0 transition-opacity p-0.5"
                      title={t('Copy')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })()}

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowShortcuts(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text">{t('Keyboard Shortcuts')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowShortcuts(false)}
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SettingsPanel />
            </div>
          </div>
        </div>
      )}

      {/* File Filter Rules Modal */}
      {showFileFilterRules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFileFilterRules(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text">{t('File Filter Rules')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowFileFilterRules(false)}
              >
                ×
              </button>
            </div>
            <div className="p-3">
              <p className="text-xs text-ide-text-muted mb-2">{t('Skip directories matching these names. One per line.')}</p>
              <textarea
                className="w-full h-48 bg-ide-bg border border-ide-border rounded px-3 py-2 text-sm text-ide-text font-mono focus:border-ide-accent focus:outline-none resize-none"
                value={fileFilterRulesDraft}
                onChange={(e) => setFileFilterRulesDraft(e.target.value)}
                placeholder=".git&#10;node_modules&#10;dist&#10;build"
              />
              <div className="flex justify-between gap-2 mt-3">
                <button
                  className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                  onClick={() => setFileFilterRulesDraft(DEFAULT_FILTER_RULES.join('\n'))}
                >
                  {t('Reset Defaults')}
                </button>
                <div className="flex gap-2">
                <button
                  className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                  onClick={() => setShowFileFilterRules(false)}
                >
                  {t('Cancel')}
                </button>
                <button
                  className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
                  onClick={() => {
                    const rules = fileFilterRulesDraft.split('\n').map(s => s.trim()).filter(Boolean)
                    setFileFilterRules(rules)
                    saveFilterRules(rules)
                    setShowFileFilterRules(false)
                    window.dispatchEvent(new CustomEvent('file-filter-rules-changed'))
                  }}
                >
                  {t('Save')}
                </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Other Options Modal */}
      {/* Other Options Modal */}
      {showOtherOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowOtherOptions(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[400px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text">{t('Other Options…')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowOtherOptions(false)}
              >
                ×
              </button>
            </div>
            <div className="p-4 flex flex-col gap-4">
              {onToggleWordWrap && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={wordWrap} onChange={(e) => onToggleWordWrap(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('Word Wrap')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Auto-wrap long lines in diff/editor. Recommended: off')}</p>
                </label>
              )}
              {onToggleAutoUtf8 && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={autoUtf8} onChange={(e) => onToggleAutoUtf8(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('Auto UTF-8')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Run chcp 65001 on terminal start to set UTF-8 encoding')}</p>
                </label>
              )}
              {onToggleCgEnabled && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={cgEnabled} onChange={(e) => onToggleCgEnabled(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('CodeGraph')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Code symbol indexing for smart search. Disable to free ~170MB main process memory.')}</p>
                </label>
              )}
              {onToggleOcrEnabled && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={ocrEnabled} onChange={(e) => onToggleOcrEnabled(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('OCR Image to Text')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Drag image or Ctrl+V to extract text from images and paste into terminal')}</p>
                </label>
              )}
              {onTogglePolling && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={pollingEnabled} onChange={(e) => onTogglePolling(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('Polling Refresh Git/File')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Poll git and file tree every 6s. Recommended: off (only for network drives where file watching is unreliable)')}</p>
                </label>
              )}
              {onToggleEscAutoAt && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={escAutoAt} onChange={(e) => onToggleEscAutoAt(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('ESC Auto @ Selection')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('When pressing ESC in diff view with text selected, auto-insert @filepath:line into the terminal.')}</p>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {/* UI Style Modal */}
      {showUiStyleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowUiStyleModal(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text">{t('UI Style')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowUiStyleModal(false)}
              >
                ×
              </button>
            </div>
            <div className="flex shrink-0 border-b border-ide-border">
              <button
                className={`flex-1 px-3 py-2 text-xs transition-colors ${uiStyleTab === 'style' ? 'text-ide-accent border-b-2 border-ide-accent font-medium' : 'text-ide-text-muted hover:text-ide-text'}`}
                onClick={() => setUiStyleTab('style')}
              >
                {t('UI Style')}
              </button>
              <button
                className={`flex-1 px-3 py-2 text-xs transition-colors ${uiStyleTab === 'emoji' ? 'text-ide-accent border-b-2 border-ide-accent font-medium' : 'text-ide-text-muted hover:text-ide-text'}`}
                onClick={() => setUiStyleTab('emoji')}
              >
                {t('Emoji Text')}
              </button>
            </div>
            <div className="p-4 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              {uiStyleTab === 'style' && (<>
              {onToggleCapsuleTabs && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={capsuleTabs} onChange={(e) => onToggleCapsuleTabs(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('Capsule Tabs')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Use capsule-style tab bar instead of icon buttons.')}</p>
                </label>
              )}
              {onToggleGroupSessionsByCwd && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={groupSessionsByCwd} onChange={(e) => onToggleGroupSessionsByCwd(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('Group Sessions by Folder')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Group sessions by their working directory. Off = flat list with cwd under each item.')}</p>
                </label>
              )}
              {onToggleInlineDiff && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={inlineDiff} onChange={(e) => onToggleInlineDiff(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('Force Inline Diff')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Force inline diff mode (revert button uses circular icon). Recommended: off (side-by-side reads better)')}</p>
                </label>
              )}
              {onAdjustTerminalFontSize && (
                <div className="flex items-center justify-between text-xs text-ide-text">
                  <span className="whitespace-nowrap shrink-0">{t('Terminal Font Size')}</span>
                  <div className="flex items-center gap-px">
                    <button
                      className="w-4 h-4 rounded bg-ide-hover text-ide-text-muted hover:bg-ide-accent hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none disabled:opacity-30 disabled:cursor-not-allowed"
                      disabled={terminalFontSize <= 8}
                      onClick={(e) => { e.stopPropagation(); onAdjustTerminalFontSize(-1) }}
                    >{'<'}</button>
                    <span className="text-center font-mono text-ide-accent font-bold text-xs leading-none w-5">{terminalFontSize}</span>
                    <button
                      className="w-4 h-4 rounded bg-ide-hover text-ide-text-muted hover:bg-ide-accent hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none disabled:opacity-30 disabled:cursor-not-allowed"
                      disabled={terminalFontSize >= 30}
                      onClick={(e) => { e.stopPropagation(); onAdjustTerminalFontSize(1) }}
                    >{'>'}</button>
                  </div>
                </div>
              )}
              {onAdjustEditorFontSize && (
                <div className="flex items-center justify-between text-xs text-ide-text">
                  <span className="whitespace-nowrap shrink-0">{t('Editor Font Size')}</span>
                  <div className="flex items-center gap-px">
                    <button
                      className="w-4 h-4 rounded bg-ide-hover text-ide-text-muted hover:bg-ide-accent hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none disabled:opacity-30 disabled:cursor-not-allowed"
                      disabled={editorFontSize <= 8}
                      onClick={(e) => { e.stopPropagation(); onAdjustEditorFontSize(-1) }}
                    >{'<'}</button>
                    <span className="text-center font-mono text-ide-accent font-bold text-xs leading-none w-5">{editorFontSize}</span>
                    <button
                      className="w-4 h-4 rounded bg-ide-hover text-ide-text-muted hover:bg-ide-accent hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none disabled:opacity-30 disabled:cursor-not-allowed"
                      disabled={editorFontSize >= 30}
                      onClick={(e) => { e.stopPropagation(); onAdjustEditorFontSize(1) }}
                    >{'>'}</button>
                  </div>
                </div>
              )}
              {onSetFontFamily && (
                <div className="flex items-center justify-between text-xs text-ide-text">
                  <span className="whitespace-nowrap shrink-0">{t('Session Font')}</span>
                  <select
                    className="bg-ide-hover border border-ide-border rounded text-xs text-ide-text px-1.5 py-0.5 outline-none focus:border-ide-accent max-w-[160px]"
                    value={fontFamily}
                    onChange={(e) => { if (e.target.value) onSetFontFamily(e.target.value) }}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={loadSystemFonts}
                  >
                    {renderFontOptions(fontFamily, 'Consolas')}
                  </select>
                </div>
              )}
              {onSetUiFontFamily && (
                <div className="flex items-center justify-between text-xs text-ide-text">
                  <span className="whitespace-nowrap shrink-0">{t('UI Font')}</span>
                  <select
                    className="bg-ide-hover border border-ide-border rounded text-xs text-ide-text px-1.5 py-0.5 outline-none focus:border-ide-accent max-w-[160px]"
                    value={uiFontFamily}
                    onChange={(e) => { if (e.target.value) onSetUiFontFamily(e.target.value) }}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={loadSystemFonts}
                  >
                    {renderFontOptions(uiFontFamily, 'Cascadia Code')}
                  </select>
                </div>
              )}
              {onSetTermFontFamily && (
                <div className="flex items-center justify-between text-xs text-ide-text">
                  <span className="whitespace-nowrap shrink-0">{t('Terminal Font')}</span>
                  <select
                    className="bg-ide-hover border border-ide-border rounded text-xs text-ide-text px-1.5 py-0.5 outline-none focus:border-ide-accent max-w-[160px]"
                    value={termFontFamily}
                    onChange={(e) => { if (e.target.value) onSetTermFontFamily(e.target.value) }}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={loadSystemFonts}
                  >
                    {renderFontOptions(termFontFamily, 'Cascadia Code')}
                  </select>
                </div>
              )}

              {/* 恢复默认：字体 / 字号 / 开关 */}
              {onResetUiStyle && (
                <div className="flex justify-end pt-3 border-t border-ide-border">
                  <button
                    className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover rounded transition-colors"
                    onClick={onResetUiStyle}
                  >
                    {t('Reset Defaults')}
                  </button>
                </div>
              )}
              </>)}

              {uiStyleTab === 'emoji' && (<>
              {/* 会话图标 */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-ide-text">{t('Emoji Text')}</span>
                <p className="text-[11px] text-ide-text-muted">{t('Click any emoji in the sidebar to cycle.')}</p>

                {/* Folder / cwd pool */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-ide-text-muted">{t('Folder Icons (per cwd)')}</span>
                    <span className="text-[10px] text-ide-text-muted">{t('One per line')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2 bg-ide-hover rounded p-2 min-h-[36px]">
                    {(() => {
                      const pool = cwdEmojiDraft.split('\n').map(s => s.trim()).filter(Boolean)
                      return pool.length === 0
                      ? <span className="text-xs text-ide-text-muted py-1">{t('No emojis')}</span>
                      : pool.map((emoji, i) => (
                        <span key={`c${i}`} className="text-lg bg-ide-accent/15 rounded px-0.5">{emoji}</span>
                      ))
                    })()}
                  </div>
                  <textarea
                    className="w-full h-16 bg-ide-bg border border-ide-border rounded px-3 py-2 text-sm text-ide-text font-mono focus:border-ide-accent focus:outline-none resize-none"
                    value={cwdEmojiDraft}
                    onChange={(e) => {
                      setCwdEmojiDraft(e.target.value)
                      const cwd = e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                      setCwdEmojis(cwd)
                      saveCwdEmojis(cwd)
                    }}
                    placeholder={'📁\n📍\n🏷️'}
                  />
                </div>

                {/* Session pool */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-ide-text-muted">{t('Session Icons')}</span>
                    <span className="text-[10px] text-ide-text-muted">{t('One per line')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2 bg-ide-hover rounded p-2 min-h-[36px]">
                    {(() => {
                      const pool = sessionEmojiDraft.split('\n').map(s => s.trim()).filter(Boolean)
                      return pool.length === 0
                      ? <span className="text-xs text-ide-text-muted py-1">{t('No emojis')}</span>
                      : pool.map((emoji, i) => (
                        <span key={`s${i}`} className="text-lg">{emoji}</span>
                      ))
                    })()}
                  </div>
                  <textarea
                    className="w-full h-16 bg-ide-bg border border-ide-border rounded px-3 py-2 text-sm text-ide-text font-mono focus:border-ide-accent focus:outline-none resize-none"
                    value={sessionEmojiDraft}
                    onChange={(e) => {
                      setSessionEmojiDraft(e.target.value)
                      const session = e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                      setSessionEmojis(session)
                      saveSessionEmojis(session)
                    }}
                    placeholder={'🔥\n💀\n🗿'}
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                    onClick={() => {
                      setCwdEmojiDraft(DEFAULT_CWD_EMOJIS.join('\n'))
                      setSessionEmojiDraft(DEFAULT_SESSION_EMOJIS.join('\n'))
                      setCwdEmojis([...DEFAULT_CWD_EMOJIS])
                      saveCwdEmojis([...DEFAULT_CWD_EMOJIS])
                      setSessionEmojis([...DEFAULT_SESSION_EMOJIS])
                      saveSessionEmojis([...DEFAULT_SESSION_EMOJIS])
                    }}
                  >
                    {t('Reset Defaults')}
                  </button>
                </div>
              </div>
              </>)}
            </div>
          </div>
        </div>
      )}

      {/* CLI Configuration Modal — Shell Type + AI CLI Command */}
      {showCliConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCliConfigModal(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[400px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text">{t('CLI Configuration')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowCliConfigModal(false)}
              >
                ×
              </button>
            </div>
            <div className="p-4 flex flex-col gap-4">
              {/* Shell Type */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Shell Type')}</span>
                <select
                  value={termType}
                  onChange={(e) => {
                    const val = e.target.value
                    setTermType(val)
                    try { localStorage.setItem('vibe-ide-term-type', val) } catch {}
                  }}
                  className="w-full px-3 py-2 text-sm bg-ide-sidebar border border-ide-border rounded text-ide-text focus:outline-none focus:border-ide-accent/60"
                >
                  {shellOptions.map((tt) => (
                    <option key={tt.value} value={tt.value}>{tt.label}</option>
                  ))}
                </select>
              </label>
              {/* AI CLI Command */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Claude Code GUI Command')}</span>
                <input
                  type="text"
                  value={cliCommandDraft}
                  onChange={(e) => setCliCommandDraft(e.target.value)}
                  onBlur={() => {
                    const val = cliCommandDraft.trim()
                    setCliCommand(val)
                    try { localStorage.setItem('vibe-ide-ai-cli-command', val) } catch {}
                  }}
                  placeholder="auto-detect: claude → openclaude"
                  className="w-full px-3 py-2 text-sm font-mono bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default SessionPanel
