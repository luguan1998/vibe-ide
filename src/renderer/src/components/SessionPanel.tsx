import React, { useState, useRef, useEffect } from 'react'
import { TerminalSession, ShellOption } from '@shared/types'

interface SessionPanelProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  onCreateSession: (shell?: string) => void
  onSwitchSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession?: (id: string, newName: string) => Promise<void>
  onGetShells: () => Promise<ShellOption[]>
}

export default function SessionPanel({
  sessions,
  activeSessionId,
  onCreateSession,
  onSwitchSession,
  onCloseSession,
  onRenameSession,
  onGetShells
}: SessionPanelProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [showShellPicker, setShowShellPicker] = useState(false)
  const [shells, setShells] = useState<ShellOption[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-ide-border shrink-0">
        <h2 className="text-sm font-semibold text-ide-text uppercase tracking-wider">Sessions</h2>
        <button
          onClick={async () => {
            const shellList = await onGetShells()
            setShells(shellList)
            setShowShellPicker(!showShellPicker)
          }}
          className="w-6 h-6 rounded bg-ide-accent hover:bg-ide-accent-hover text-white flex items-center justify-center text-sm transition-colors"
          title="New Terminal"
        >
          +
        </button>
      </div>

      {/* Shell Picker Dropdown */}
      {showShellPicker && (
        <div className="border-b border-ide-border px-3 py-2 shrink-0 bg-ide-sidebar">
          <div className="text-xs text-ide-text-muted mb-1">Select shell:</div>
          {shells.filter(s => s.available).map((shell) => (
            <button
              key={shell.id}
              className="w-full px-2 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover rounded mb-0.5 flex items-center gap-2"
              onClick={() => {
                setShowShellPicker(false)
                onCreateSession(shell.path)
              }}
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-ide-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span>{shell.name}</span>
            </button>
          ))}
          <button
            className="w-full px-2 py-1.5 text-left text-xs text-ide-text-muted hover:bg-ide-hover rounded"
            onClick={() => {
              setShowShellPicker(false)
              onCreateSession()
            }}
          >
            Default shell
          </button>
        </div>
      )}

      {/* Session List */}
      <div className="flex-1 overflow-y-auto py-1">
        {sessions.length === 0 ? (
          <div className="px-3 py-4 text-ide-text-muted text-sm text-center">
            No sessions yet
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`group px-3 py-2 mx-1 rounded cursor-pointer transition-colors ${
                session.id === activeSessionId
                  ? 'bg-ide-accent/20 text-ide-text border-l-2 border-ide-accent'
                  : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
              }`}
              onClick={() => onSwitchSession(session.id)}
              onContextMenu={(e) => handleContextMenu(e, session.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
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
    </div>
  )
}