import React, { useState, useCallback } from 'react'
import SessionPanel from './components/SessionPanel'
import TerminalView from './components/TerminalView'
import GitPanel from './components/GitPanel'
import { TerminalSession } from '@shared/types'

// Declare the window API type
declare global {
  interface Window {
    api: {
      terminal: {
        create: (options?: any) => Promise<TerminalSession>
        write: (id: string, data: string) => void
        resize: (id: string, cols: number, rows: number) => void
        close: (id: string) => Promise<boolean>
        onData: (callback: (data: { id: string; data: string }) => void) => void
        onExit: (callback: (data: { id: string; exitCode: number }) => void) => void
        removeDataListener: () => void
        removeExitListener: () => void
      }
      git: any
      file: any
      workspace: any
    }
  }
}

export default function App() {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [rightPanelWidth, setRightPanelWidth] = useState(380)
  const [leftPanelWidth, setLeftPanelWidth] = useState(240)
  const [isDragging, setIsDragging] = useState(false)

  // Create a new terminal session
  const handleCreateSession = useCallback(async () => {
    const session = await window.api.terminal.create({
      cwd: process.cwd?.() || undefined
    })
    setSessions(prev => [...prev, session])
    setActiveSessionId(session.id)
  }, [])

  // Switch active session
  const handleSwitchSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  // Close a terminal session
  const handleCloseSession = useCallback(async (id: string) => {
    await window.api.terminal.close(id)
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
    }
  }, [activeSessionId, sessions])

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

  // Auto-create first session on mount
  React.useEffect(() => {
    if (sessions.length === 0) {
      handleCreateSession()
    }
  }, [])

  return (
    <div className="h-full w-full flex flex-col bg-ide-bg">
      {/* Title Bar */}
      <div className="titlebar-drag h-9 bg-ide-sidebar border-b border-ide-border flex items-center px-4 select-none shrink-0">
        <span className="text-ide-text-muted text-sm font-medium tracking-wide">Vibe IDE</span>
        <div className="ml-auto flex gap-2 titlebar-no-drag">
          <button
            className="text-ide-text-muted hover:text-ide-text text-xs px-2 py-1 rounded hover:bg-ide-hover"
            onClick={handleCreateSession}
          >
            + New Terminal
          </button>
        </div>
      </div>

      {/* Main Content - 3 Panels */}
      <div className="flex flex-1 overflow-hidden" style={{ cursor: isDragging ? 'col-resize' : 'default' }}>
        {/* Left Panel: Terminal Session Management */}
        <div className="shrink-0 flex flex-col bg-ide-sidebar border-r border-ide-border" style={{ width: leftPanelWidth }}>
          <SessionPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            onCreateSession={handleCreateSession}
            onSwitchSession={handleSwitchSession}
            onCloseSession={handleCloseSession}
          />
        </div>

        {/* Left Panel Resize Handle */}
        <div
          className="w-1 bg-ide-border hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
          onMouseDown={handleLeftResizeStart}
        />

        {/* Center Panel: Terminal */}
        <div className="flex-1 flex flex-col overflow-hidden bg-ide-bg">
          {activeSessionId ? (
            <TerminalView sessionId={activeSessionId} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-ide-text-muted">
              No active terminal session. Create one to start.
            </div>
          )}
        </div>

        {/* Right Panel Resize Handle */}
        <div
          className="w-1 bg-ide-border hover:bg-ide-accent cursor-col-resize shrink-0 transition-colors"
          onMouseDown={handleRightResizeStart}
        />

        {/* Right Panel: Git Management */}
        <div className="shrink-0 flex flex-col bg-ide-sidebar border-l border-ide-border overflow-hidden" style={{ width: rightPanelWidth }}>
          <GitPanel />
        </div>
      </div>
    </div>
  )
}