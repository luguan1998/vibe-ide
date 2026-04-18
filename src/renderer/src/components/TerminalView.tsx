import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'

interface TerminalViewProps {
  sessionId: string
}

export default function TerminalView({ sessionId }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isReady, setIsReady] = useState(false)

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current) return

    // Clean up previous terminal
    if (xtermRef.current) {
      xtermRef.current.dispose()
    }

    const term = new Terminal({
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#7c3aed',
        cursorAccent: '#1a1a2e',
        selectionBackground: 'rgba(124, 58, 237, 0.3)',
        black: '#000000',
        red: '#e74c3c',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e0e0e0',
        brightBlack: '#555555',
        brightRed: '#ff6b6b',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff'
      },
      fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowTransparency: true,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(terminalRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon
    setIsReady(true)

    // Handle terminal data input
    term.onData((data: string) => {
      window.api.terminal.write(sessionId, data)
    })

    // Handle resize
    const onResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit()
          const dims = xtermRef.current.cols + 'x' + xtermRef.current.rows
          window.api.terminal.resize(sessionId, xtermRef.current.cols, xtermRef.current.rows)
        } catch (e) {
          // Ignore fit errors during resize
        }
      }
    }

    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      setIsReady(false)
    }
  }, []) // Initialize once

  // Listen for terminal data from PTY
  useEffect(() => {
    if (!xtermRef.current || !isReady) return

    // Remove old listeners and set up new ones
    window.api.terminal.removeDataListener()
    window.api.terminal.removeExitListener()

    window.api.terminal.onData((data: { id: string; data: string }) => {
      if (data.id === sessionId && xtermRef.current) {
        xtermRef.current.write(data.data)
      }
    })

    window.api.terminal.onExit((data: { id: string; exitCode: number }) => {
      if (data.id === sessionId && xtermRef.current) {
        xtermRef.current.write(`\r\n[Process exited with code ${data.exitCode}]\r\n`)
      }
    })

    // Resize PTY to match terminal dimensions
    if (xtermRef.current) {
      window.api.terminal.resize(sessionId, xtermRef.current.cols, xtermRef.current.rows)
    }

    return () => {
      window.api.terminal.removeDataListener()
      window.api.terminal.removeExitListener()
    }
  }, [sessionId, isReady])

  // Auto-fit on mount and when container resizes
  useEffect(() => {
    if (!fitAddonRef.current) return

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit()
        } catch (e) {
          // Ignore
        }
      }
    })

    if (terminalRef.current) {
      observer.observe(terminalRef.current)
    }

    // Initial fit after a small delay to ensure DOM is ready
    setTimeout(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit()
        } catch (e) {
          // Ignore
        }
      }
    }, 100)

    return () => observer.disconnect()
  }, [isReady])

  return (
    <div className="flex flex-col h-full">
      {/* Terminal tab header */}
      <div className="h-10 px-3 flex items-center border-b border-ide-border shrink-0 bg-ide-sidebar/50">
        <span className="text-sm text-ide-text-muted">Session: {sessionId.slice(0, 12)}</span>
      </div>

      {/* Terminal container */}
      <div ref={terminalRef} className="flex-1 overflow-hidden p-1" />
    </div>
  )
}