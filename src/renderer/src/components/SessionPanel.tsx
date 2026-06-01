import React, { useState, useRef, useEffect, useMemo } from 'react'
import { TerminalSession } from '@shared/types'
import { Zap, Coffee, Plus, Shield, ShieldCheck, Copy, Pencil, X } from 'lucide-react'
import { useTheme } from '../themes'
import { useI18n } from '../i18n'
import SettingsPanel from './SettingsPanel'
import { loadFilterRules, saveFilterRules, DEFAULT_FILTER_RULES } from './FileTab'

const DEFAULT_SESSION_EMOJIS = ['🔥', '💀', '🗿', '🤡', '👽', '🤖', '🐸', '👾', '🎯', '🚀', '⚡', '🌟', '💫', '🌀', '🎭', '🪐', '👻', '🍕', '🎲', '🧩', '🌈', '🙏', '🐉']

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

function loadSessionEmojis(): string[] {
  try {
    const raw = localStorage.getItem('vibe-ide-session-emojis')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length > 0) return arr
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

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function getSessionEmoji(id: string, emojis: string[]): string {
  return emojis[hashId(id) % emojis.length]
}

interface SessionPanelProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  onCreateSession: (shell?: string) => void
  onCloneSession: (parentId: string | null, cwd: string, shell?: string, name?: string) => void
  onSwitchSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession?: (id: string, newName: string) => Promise<void>
  onReorderSessions?: (fromIndex: number, toIndex: number) => void
  commandHistory?: Record<string, string[]>
  agentStatus?: Record<string, 'running' | 'idle'>
  autoApproveSessions?: Record<string, boolean>
  onToggleAutoApprove?: (sessionId: string, cwd: string) => void
  showSquiggles?: boolean
  onToggleSquiggles?: (value: boolean) => void
  pollingEnabled?: boolean
  onTogglePolling?: (value: boolean) => void
  wordWrap?: boolean
  onToggleWordWrap?: (value: boolean) => void
  autoUtf8?: boolean
  onToggleAutoUtf8?: (value: boolean) => void
  inlineDiff?: boolean
  onToggleInlineDiff?: (value: boolean) => void
  fileTreeDepth?: number
  onChangeFileTreeDepth?: (delta: number) => void
  focusSettingsTrigger?: number
}

const SessionPanel = React.memo(function SessionPanel({
  sessions,
  activeSessionId,
  onCreateSession,
  onCloneSession,
  onSwitchSession,
  onCloseSession,
  onRenameSession,
  onReorderSessions,
  commandHistory = {},
  agentStatus = {},
  autoApproveSessions = {},
  onToggleAutoApprove,
  showSquiggles = false,
  onToggleSquiggles,
  pollingEnabled = false,
  onTogglePolling,
  wordWrap = false,
  onToggleWordWrap,
  autoUtf8 = true,
  onToggleAutoUtf8,
  inlineDiff = false,
  onToggleInlineDiff,
  fileTreeDepth = 5,
  onChangeFileTreeDepth,
  focusSettingsTrigger = 0
}: SessionPanelProps) {
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [showFileFilterRules, setShowFileFilterRules] = useState(false)
  const [fileFilterRules, setFileFilterRules] = useState<string[]>(() => loadFilterRules())
  const [fileFilterRulesDraft, setFileFilterRulesDraft] = useState('')
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [showThemeFlyout, setShowThemeFlyout] = useState(false)
  const [showTermTypeFlyout, setShowTermTypeFlyout] = useState(false)
  const [termType, setTermType] = useState(() => {
    try { return localStorage.getItem('vibe-ide-term-type') || 'pwsh' } catch { return 'pwsh' }
  })
  const [shellOptions, setShellOptions] = useState(FALLBACK_SHELLS)
  const [sessionEmojis, setSessionEmojis] = useState<string[]>(() => loadSessionEmojis())
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emojiDraft, setEmojiDraft] = useState('')
  const [showOtherOptions, setShowOtherOptions] = useState(false)

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

  // Sync filter rules to git watcher (main process) on mount and when rules change
  useEffect(() => {
    window.api.git.setFilterRules(fileFilterRules)
  }, [fileFilterRules])

  const { themes, currentThemeId, setTheme } = useTheme()
  const { t, lang, setLang } = useI18n()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
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
  const termTypeFlyoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configBtnRef = useRef<HTMLButtonElement>(null)
  const [configMenuStyle, setConfigMenuStyle] = useState<React.CSSProperties>({})
  const [flyoutOnLeft, setFlyoutOnLeft] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

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

  // Menu → Settings → Keyboard Shortcuts opens the shortcuts modal
  useEffect(() => {
    if (focusSettingsTrigger > 0) {
      setShowShortcuts(true)
    }
  }, [focusSettingsTrigger])

  useEffect(() => { window.api.appVersion().then(setAppVersion).catch(() => {}) }, [])

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
    return { total, running, idle }
  }, [sessions, agentStatus])

  return (
    <div className="flex flex-col h-full">
      {/* Header + Dashboard merged */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-ide-border shrink-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
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
            className="flex items-center gap-1 px-2 py-0.5 rounded text-ide-text-muted bg-ide-hover transition-colors"
            title={t('Idle')}
          >
            <Coffee size={13} className="shrink-0" />
            <span className="text-xs font-bold font-mono">{stats.idle}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative config-menu-area">
            <button
              ref={configBtnRef}
              className={`w-6 h-6 rounded flex items-center justify-center transition-colors shrink-0 ${
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
              <div style={configMenuStyle} className="bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 config-menu-area">
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
                      className={`absolute top-0 ${flyoutOnLeft ? 'right-full mr-1' : 'left-full ml-1'} w-44 bg-ide-bg border border-ide-border rounded shadow-lg py-1 max-h-64 overflow-y-auto`}
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
                {/* Emoji Text */}
                <div className="border-t border-ide-border mt-1 pt-1">
                  <button
                    className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors"
                    onClick={() => {
                      setEmojiDraft(sessionEmojis.join('\n'))
                      setShowEmojiPicker(true)
                      setShowConfigMenu(false)
                    }}
                  >
                    {t('Emoji Text')}
                  </button>
                </div>
                <div className="border-t border-ide-border mt-1 pt-1">
                {/* Shell Type flyout */}
                <div
                  className="relative"
                  onMouseEnter={() => {
                    if (termTypeFlyoutTimerRef.current) clearTimeout(termTypeFlyoutTimerRef.current)
                    setShowTermTypeFlyout(true)
                  }}
                  onMouseLeave={() => {
                    termTypeFlyoutTimerRef.current = setTimeout(() => setShowTermTypeFlyout(false), 200)
                  }}
                >
                  <div className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors">
                    {t('Shell Type')}
                  </div>
                  {showTermTypeFlyout && (
                    <div
                      className={`absolute top-0 ${flyoutOnLeft ? 'right-full mr-1' : 'left-full ml-1'} w-40 bg-ide-bg border border-ide-border rounded shadow-lg py-1`}
                      onMouseEnter={() => {
                        if (termTypeFlyoutTimerRef.current) clearTimeout(termTypeFlyoutTimerRef.current)
                      }}
                      onMouseLeave={() => setShowTermTypeFlyout(false)}
                    >
                      {shellOptions.map((tt) => (
                        <button
                          key={tt.value}
                          onClick={() => {
                            setTermType(tt.value)
                            try { localStorage.setItem('vibe-ide-term-type', tt.value) } catch {}
                          }}
                          className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors ${
                            termType === tt.value
                              ? 'text-ide-accent bg-ide-accent/10'
                              : 'text-ide-text hover:bg-ide-hover'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full shrink-0 ${
                            termType === tt.value
                              ? 'bg-ide-accent border-ide-accent'
                              : 'border border-ide-border'
                          }`} />
                          {tt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
                          disabled={fileTreeDepth >= 8}
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
                {(onToggleWordWrap || onToggleAutoUtf8 || onToggleSquiggles || onTogglePolling || onToggleInlineDiff) && (
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
            className={`w-6 h-6 rounded flex items-center justify-center transition-colors shrink-0 ${
              sessions.length === 0
                ? 'text-white bg-ide-accent hover:bg-ide-accent-hover'
                : 'text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white'
            }`}
            title={`${t('New Terminal')} (${shellOptions.find(tt => tt.value === termType)?.label || termType})`}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto py-1"
        onDragOver={(e) => {
          if (dragIndex !== null && sessions.length > 0) {
            setDropIndex(sessions.length)
          }
        }}
        onContextMenu={handleEmptyAreaContextMenu}
      >
        {sessions.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ide-text-muted text-sm">
            No sessions yet
          </div>
        ) : (
          sessions.map((session, index) => (
            <div
              key={session.id}
              draggable={!!onReorderSessions}
              className={`group px-3 py-2 mx-1 rounded cursor-pointer transition-colors ${
                session.id === activeSessionId
                  ? 'bg-ide-accent/20 text-ide-text border-l-[3px] border-ide-accent'
                  : agentStatus[session.id] === 'running'
                    ? 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text border-l-[3px] border-ide-accent/60'
                    : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
              } ${dragIndex === index ? 'opacity-40' : ''} ${dropIndex === index && dropIndex !== dragIndex ? 'border-t-2 border-ide-accent' : ''}`}
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
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragIndex === null || dragIndex === index) {
                  setDropIndex(null)
                  return
                }
                const rect = e.currentTarget.getBoundingClientRect()
                const midY = rect.top + rect.height / 2
                setDropIndex(e.clientY < midY ? index : index + 1)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex !== null && dragIndex !== index) {
                  const toIndex = dropIndex !== null && dropIndex > dragIndex ? dropIndex - 1 : dropIndex ?? index
                  onReorderSessions?.(dragIndex, toIndex)
                }
                setDragIndex(null)
                setDropIndex(null)
              }}
              onDragEnd={() => {
                setDragIndex(null)
                setDropIndex(null)
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[12px] shrink-0 w-[16px] h-[16px] flex items-center justify-center rounded-full ${session.id !== activeSessionId && agentStatus[session.id] === 'running' ? 'animate-aura-glow' : ''}`}>{getSessionEmoji(session.id, sessionEmojis)}</span>
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
                      className="bg-ide-bg border border-ide-accent rounded px-1 text-sm text-ide-text outline-none w-24"
                    />
                  ) : (
                    <span className={`text-sm truncate ${agentStatus[session.id] === 'running' ? 'animate-text-wave' : ''}`}>{session.name}</span>
                  )}
                </div>
                <div className="flex items-center">
                {onToggleAutoApprove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleAutoApprove(session.id, session.cwd)
                    }}
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
              <div
                className="text-xs mt-0.5"
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
                  title={cwdLinkSession === session.id ? t('Open in Explorer') : undefined}
                  onClick={(e) => {
                    if (cwdLinkSession === session.id) {
                      e.stopPropagation()
                      window.api.file.openExplorer(session.cwd)
                    }
                  }}
                >
                  {session.cwd}
                </span>
              </div>
            </div>
          ))
        )}
        {dropIndex === sessions.length && dropIndex !== dragIndex && dragIndex !== sessions.length - 1 && (
          <div className="mx-1 border-t-2 border-ide-accent" />
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (session) {
                onCloneSession(session.id, session.cwd, session.shell, session.name)
              }
              setContextMenu(null)
            }}
          >
            <Copy size={14} className="text-ide-text-muted" />
            <span>{t('Clone')}</span>
          </button>
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
          {recentDirs.length > 0 && (
            <>
              <div className="border-t border-ide-border my-1" />
              <div className="px-3 py-1 text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Recent Directories')}</div>
              {recentDirs.map((dir, i) => (
                <button
                  key={`${dir}-${i}`}
                  className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
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

      {/* Emoji Picker Modal */}
      {showEmojiPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowEmojiPicker(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text">{t('Emoji Text')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowEmojiPicker(false)}
              >
                ×
              </button>
            </div>
            <div className="p-3">
              <p className="text-xs text-ide-text-muted mb-2">{t('Each session gets a random icon. One per line.')}</p>
              <div className="flex flex-wrap gap-1 mb-3 bg-ide-hover rounded p-2 min-h-[40px]">
                {(() => {
                  const lines = emojiDraft.split('\n').map(s => s.trim()).filter(Boolean)
                  return lines.length === 0
                    ? <span className="text-xs text-ide-text-muted py-1">无表情</span>
                    : lines.map((emoji, i) => (
                        <span key={i} className="text-lg" title={emoji}>{emoji}</span>
                      ))
                })()}
              </div>
              <textarea
                className="w-full h-32 bg-ide-bg border border-ide-border rounded px-3 py-2 text-sm text-ide-text font-mono focus:border-ide-accent focus:outline-none resize-none"
                value={emojiDraft}
                onChange={(e) => setEmojiDraft(e.target.value)}
                placeholder={'🔥\n💀\n🗿\n🤡\n👽'}
              />
              <div className="flex justify-between gap-2 mt-3">
                <button
                  className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                  onClick={() => setEmojiDraft(DEFAULT_SESSION_EMOJIS.join('\n'))}
                >
                  {t('Reset Defaults')}
                </button>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                    onClick={() => setShowEmojiPicker(false)}
                  >
                    {t('Cancel')}
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
                    onClick={() => {
                      const emojis = emojiDraft.split('\n').map(s => s.trim()).filter(Boolean)
                      if (emojis.length > 0) {
                        setSessionEmojis(emojis)
                        saveSessionEmojis(emojis)
                      }
                      setShowEmojiPicker(false)
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
              {onToggleSquiggles && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={showSquiggles} onChange={(e) => onToggleSquiggles(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('Show squiggles')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Show LSP diagnostics in diff/editor. Recommended: off (basic highlighting is sufficient, this feature is incomplete)')}</p>
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
              {onToggleInlineDiff && (
                <label className="flex flex-col gap-0.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={inlineDiff} onChange={(e) => onToggleInlineDiff(e.target.checked)} className="accent-ide-accent" />
                    <span className="text-xs text-ide-text">{t('Force Inline Diff')}</span>
                  </div>
                  <p className="text-[11px] text-ide-text-muted ml-[22px]">{t('Force inline diff mode (revert button uses circular icon). Recommended: off (side-by-side reads better)')}</p>
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default SessionPanel
