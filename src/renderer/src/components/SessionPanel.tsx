import React from 'react'
import { TerminalSession } from '@shared/types'

interface SessionPanelProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  onCreateSession: () => void
  onSwitchSession: (id: string) => void
  onCloseSession: (id: string) => void
}

export default function SessionPanel({
  sessions,
  activeSessionId,
  onCreateSession,
  onSwitchSession,
  onCloseSession
}: SessionPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-ide-border shrink-0">
        <h2 className="text-sm font-semibold text-ide-text uppercase tracking-wider">Sessions</h2>
        <button
          onClick={onCreateSession}
          className="w-6 h-6 rounded bg-ide-accent hover:bg-ide-accent-hover text-white flex items-center justify-center text-sm transition-colors"
          title="New Terminal"
        >
          +
        </button>
      </div>

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
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Terminal icon */}
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  <span className="text-sm truncate">{session.name}</span>
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

      {/* Footer info */}
      <div className="h-8 px-3 flex items-center border-t border-ide-border text-xs text-ide-text-muted shrink-0">
        {sessions.length} session(s)
      </div>
    </div>
  )
}