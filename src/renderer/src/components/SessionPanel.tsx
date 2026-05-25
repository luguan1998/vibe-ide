import React, { useState, useRef, useEffect, useMemo } from 'react'
import { TerminalSession } from '@shared/types'
import { Zap, Coffee, Plus } from 'lucide-react'
import { useTheme } from '../themes'
import { useI18n } from '../i18n'
import SettingsPanel from './SettingsPanel'
import { loadFilterRules, saveFilterRules, DEFAULT_FILTER_RULES } from './FileTab'

const SESSION_EMOJIS = ['🔥', '💀', '🗿', '🤡', '👽', '🤖', '🐸', '👾', '🎯', '🚀', '⚡', '🌟', '💫', '🌀', '🎭', '🪐', '👻', '🍕', '🎲', '🧩', '🌈', '🦧', '🐉', '🎸']

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

function getSessionEmoji(id: string): string {
  return SESSION_EMOJIS[hashId(id) % SESSION_EMOJIS.length]
}

interface SessionPanelProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  onCreateSession: (shell?: string) => void
  onCloneSession: (cwd: string, shell?: string) => void
  onSwitchSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession?: (id: string, newName: string) => Promise<void>
  onReorderSessions?: (fromIndex: number, toIndex: number) => void
  commandHistory?: Record<string, string[]>
  agentStatus?: Record<string, 'running' | 'idle'>
  showSquiggles?: boolean
  onToggleSquiggles?: (value: boolean) => void
  wordWrap?: boolean
  onToggleWordWrap?: (value: boolean) => void
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
  showSquiggles = false,
  onToggleSquiggles,
  wordWrap = false,
  onToggleWordWrap,
  fileTreeDepth = 5,
  onChangeFileTreeDepth,
  focusSettingsTrigger = 0
}: SessionPanelProps) {
  const [showShortcuts, setShowShortcuts] = useState(false)
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

  useEffect(() => {
    const handleClick = () => setContextMenu(null)
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

  // Menu → Settings → Keyboard Shortcuts opens the shortcuts modal
  useEffect(() => {
    if (focusSettingsTrigger > 0) {
      setShowShortcuts(true)
    }
  }, [focusSettingsTrigger])

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
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
            <Zap size={13} className="shrink-0" />
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
                <div className="inline-flex items-center rounded-md bg-ide-hover overflow-hidden mx-3 my-1.5">
                  <button
                    className={`px-2 py-1 text-[11px] transition-colors ${lang === 'zh' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text'}`}
                    onClick={() => setLang('zh')}
                  >中</button>
                  <button
                    className={`px-2 py-1 text-[11px] transition-colors ${lang === 'en' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text'}`}
                    onClick={() => setLang('en')}
                  >EN</button>
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
                      className={`absolute top-0 ${flyoutOnLeft ? 'right-full mr-1' : 'left-full ml-1'} w-40 bg-ide-bg border border-ide-border rounded shadow-lg py-1 max-h-64 overflow-y-auto`}
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
                {/* Word Wrap toggle */}
                {onToggleWordWrap && (
                  <div className="border-t border-ide-border mt-1 pt-1">
                    <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wordWrap}
                        onChange={(e) => onToggleWordWrap(e.target.checked)}
                        className="accent-ide-accent"
                      />
                      {t('Word Wrap')}
                    </label>
                  </div>
                )}
                {/* Squiggles at bottom */}
                {onToggleSquiggles && (
                  <div className="border-t border-ide-border mt-1 pt-1">
                    <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showSquiggles}
                        onChange={(e) => onToggleSquiggles(e.target.checked)}
                        className="accent-ide-accent"
                      />
                      {t('Show squiggles')}
                    </label>
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
                    ? 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text border-l-[3px] border-ide-accent/60 animate-border-pulse'
                    : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
              } ${dragIndex === index ? 'opacity-40' : ''} ${dropIndex === index && dropIndex !== dragIndex ? 'border-t-2 border-ide-accent' : ''}`}
              onClick={() => onSwitchSession(session.id)}
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
                  <span className="text-sm shrink-0">{getSessionEmoji(session.id)}</span>
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
                    <span className="text-sm truncate">{session.name}</span>
                  )}
                  {session.id !== activeSessionId && agentStatus[session.id] === 'running' && (
                    <span className="text-[10px] text-ide-accent animate-march ml-0.5 shrink-0 font-mono font-bold">&gt;&gt;</span>
                  )}
                </div>
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
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover"
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (session) {
                onCloneSession(session.cwd, session.shell)
              }
              setContextMenu(null)
            }}
          >
            {t('Clone')}
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover"
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (session) startRename(session)
            }}
          >
            {t('Rename')}
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-danger hover:bg-ide-hover"
            onClick={() => {
              onCloseSession(contextMenu.sessionId)
              setContextMenu(null)
            }}
          >
            {t('Close')}
          </button>
        </div>
      )}

      {/* History Hover Popover */}
      {hoverPreview && (() => {
        const cmds = commandHistory[hoverPreview.sessionId] || []
        const displayed = cmds.slice(-20)
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
    </div>
  )
})

export default SessionPanel
