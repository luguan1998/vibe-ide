import React, { useState, useRef, useEffect, useMemo } from 'react'
import { TerminalSession } from '@shared/types'
import { Zap, Coffee, Plus, Settings } from 'lucide-react'
import { useTheme } from '../themes'

const SESSION_EMOJIS = ['🔥', '💀', '🗿', '🤡', '👽', '🤖', '🐸', '👾', '🎯', '🚀', '⚡', '🌟', '💫', '🌀', '🎭', '🪐', '👻', '🍕', '🎲', '🧩', '🌈', '🦧', '🐉', '🎸']

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
  onCreateSession: () => void
  onCloneSession: (cwd: string) => void
  onSwitchSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession?: (id: string, newName: string) => Promise<void>
  onReorderSessions?: (fromIndex: number, toIndex: number) => void
  commandHistory?: Record<string, string[]>
  claudeStatus?: Record<string, 'running' | 'idle' | null>
  showSquiggles?: boolean
  onToggleSquiggles?: (value: boolean) => void
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
  claudeStatus = {},
  showSquiggles = false,
  onToggleSquiggles
}: SessionPanelProps) {
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const { themes, currentThemeId, setTheme } = useTheme()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [hoverPreview, setHoverPreview] = useState<{ sessionId: string; name: string; left: number; top: number } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

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
    const running = sessions.filter(s => claudeStatus[s.id] === 'running').length
    const idle = total - running
    return { total, running, idle }
  }, [sessions, claudeStatus])

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
            title="Claude 运行中"
          >
            <Zap size={13} className="shrink-0" />
            <span className="text-xs font-bold font-mono">{stats.running}</span>
          </span>
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded text-ide-text-muted bg-ide-hover transition-colors"
            title="空闲"
          >
            <Coffee size={13} className="shrink-0" />
            <span className="text-xs font-bold font-mono">{stats.idle}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative config-menu-area">
            <button
              className="w-6 h-6 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-active hover:text-ide-text flex items-center justify-center transition-colors shrink-0"
              onClick={() => setShowConfigMenu(!showConfigMenu)}
              title="Settings"
            >
              <Settings size={13} />
            </button>
            {showConfigMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 max-h-80 overflow-y-auto config-menu-area">
                <div className="px-3 py-1 text-[11px] text-ide-text-muted uppercase tracking-wider">Theme</div>
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTheme(t.id); setShowConfigMenu(false) }}
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
                {onToggleSquiggles && (
                  <div className="border-t border-ide-border mt-1 pt-1">
                    <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showSquiggles}
                        onChange={(e) => onToggleSquiggles(e.target.checked)}
                        className="accent-ide-accent"
                      />
                      显示错误提示
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onCreateSession}
            className="w-6 h-6 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors shrink-0"
            title="New Terminal"
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
          <div className="px-3 py-4 text-ide-text-muted text-sm text-center">
            No sessions yet
          </div>
        ) : (
          sessions.map((session, index) => (
            <div
              key={session.id}
              draggable={!!onReorderSessions}
              className={`group px-3 py-2 mx-1 rounded cursor-pointer transition-colors ${
                session.id === activeSessionId
                  ? 'bg-ide-accent/20 text-ide-text border-l-2 border-ide-accent'
                  : claudeStatus[session.id] === 'running'
                    ? 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text border-l-2 border-ide-accent/60 animate-border-pulse'
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
                  hoverTimerRef.current = null
                }
                setHoverPreview(null)
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
                </div>
                <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseSession(session.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded text-ide-text-muted hover:text-ide-danger transition-all shrink-0"
                    title="Close Session"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
              </div>
              <div className="text-xs text-ide-text-muted mt-0.5 truncate opacity-70">
                {session.cwd}
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
                onCloneSession(session.cwd)
              }
              setContextMenu(null)
            }}
          >
            Clone
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover"
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (session) startRename(session)
            }}
          >
            Rename
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-danger hover:bg-ide-hover"
            onClick={() => {
              onCloseSession(contextMenu.sessionId)
              setContextMenu(null)
            }}
          >
            Close
          </button>
        </div>
      )}

      {/* History Hover Popover */}
      {hoverPreview && (() => {
        const cmds = commandHistory[hoverPreview.sessionId] || []
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
            onMouseLeave={() => setHoverPreview(null)}
          >
            <div className="px-3 py-1.5 border-b border-ide-border flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-ide-text">History</span>
              <span className="text-xs text-ide-text-muted ml-2">{hoverPreview.name}</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {cmds.length === 0 ? (
                <div className="px-3 py-4 text-xs text-ide-text-muted text-center">
                  No commands yet
                </div>
              ) : (
                cmds.slice(-20).reverse().map((cmd, i) => (
                  <div
                    key={`hp-${i}`}
                    className="px-3 py-0.5 text-xs font-mono text-ide-text hover:bg-ide-hover flex items-center gap-2 group"
                  >
                    <span className="text-ide-text-muted shrink-0 select-none w-5 text-right">
                      {cmds.length - i}
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
                      title="Copy"
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
    </div>
  )
})

export default SessionPanel
