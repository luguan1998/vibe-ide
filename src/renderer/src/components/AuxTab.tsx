import React, { useState, useEffect, useCallback, useRef } from 'react'
const TerminalView = React.lazy(() => import('./TerminalView'))
import type { TerminalViewHandle } from './TerminalView'
import { TerminalSession } from '@shared/types'
import { parseCommands, loadMdContent } from './DocTree'
import { useI18n } from '../i18n'

interface AuxTabProps {
  rightTerminalSessions: Record<string, TerminalSession>
  activeSessionId: string | null
  effectiveGitPath: string | null
  worktreeNav: { originalPath: string; worktreePath: string; originalBranch: string } | null
  onCreateRightTerminal?: (sessionId: string, cwd?: string) => void
  onOpenFileFromRightTerminal?: (fullPath: string, lineNumber?: number) => void
  isActive?: boolean
  clearAuxBufferTrigger?: { sid: string; n: number }
}

export default function AuxTab({ rightTerminalSessions, activeSessionId, effectiveGitPath, worktreeNav, onCreateRightTerminal, onOpenFileFromRightTerminal, isActive, clearAuxBufferTrigger }: AuxTabProps) {
  const [commands, setCommands] = useState<Array<{ command: string; comment: string }>>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState<number | null>(null)
  const pendingCommandRef = useRef<string | null>(null)
  const auxTerminalRefs = useRef<Record<string, TerminalViewHandle>>({})
  const selectedCommandIndexRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const { t } = useI18n()

  const handleRunCommand = useCallback((command: string) => {
    const activeRightTerminal = activeSessionId ? rightTerminalSessions[activeSessionId] : undefined
    if (activeRightTerminal) {
      window.api.terminal.write(activeRightTerminal.id, command + '\r')
    } else if (activeSessionId) {
      pendingCommandRef.current = command
      if (worktreeNav) {
        onCreateRightTerminal?.(activeSessionId, effectiveGitPath ?? undefined)
      } else {
        onCreateRightTerminal?.(activeSessionId)
      }
    }
  }, [rightTerminalSessions, activeSessionId, onCreateRightTerminal, worktreeNav, effectiveGitPath])

  // 右侧终端打开文件的回调 - 触发中间终端切换到 edit
  const handleRightTerminalOpenFile = useCallback(async (fullPath: string, lineNumber?: number) => {
    if (onOpenFileFromRightTerminal) {
      onOpenFileFromRightTerminal(fullPath, lineNumber)
    }
  }, [onOpenFileFromRightTerminal])

  // Load CLAUDE.md (or AGENTS.md) commands（复用 GitTab pendingPathRef 防 stale 模式）
  const pendingPathRef = useRef<string | null>(null)

  useEffect(() => {
    const targetPath = effectiveGitPath
    pendingPathRef.current = targetPath
    setSelectedCommandIndex(null)
    hasAutoFocused.current = false

    const load = async () => {
      if (!targetPath) {
        if (pendingPathRef.current === targetPath) setCommands([])
        return
      }
      const content = await loadMdContent(targetPath)
      if (pendingPathRef.current !== targetPath) return
      if (!content) { setCommands([]); return }
      setCommands(parseCommands(content))
    }
    load()
  }, [effectiveGitPath])

  // 切 session 或切走 tab 时清除键盘导航高亮
  useEffect(() => { setSelectedCommandIndex(null) }, [activeSessionId])
  useEffect(() => { if (!isActive) { setSelectedCommandIndex(null); hasAutoFocused.current = false } }, [isActive])

  // 自动聚焦第一个命令
  const hasAutoFocused = useRef(false)
  useEffect(() => {
    if (!hasAutoFocused.current && commands.length > 0) {
      setSelectedCommandIndex(0)
      hasAutoFocused.current = true
    }
  }, [commands.length > 0])

  // Sync ref for keyboard handler (avoid re-registration on every index change)
  useEffect(() => { selectedCommandIndexRef.current = selectedCommandIndex }, [selectedCommandIndex])

  // Keyboard navigation in commands panel: ArrowUp/Down 选择，Enter 执行
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!isActiveRef.current) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (commands.length === 0) return
        e.preventDefault()
        const prev = selectedCommandIndexRef.current
        setSelectedCommandIndex(
          e.key === 'ArrowDown'
            ? (prev === null ? 0 : Math.min(prev + 1, commands.length - 1))
            : (prev === null ? commands.length - 1 : Math.max(prev - 1, 0))
        )
      } else if (e.key === 'Enter') {
        const idx = selectedCommandIndexRef.current
        if (idx !== null && idx < commands.length) {
          e.preventDefault()
          handleRunCommand(commands[idx].command)
        }
      } else if (e.key === 'Escape') {
        setSelectedCommandIndex(null)
      }
    }

    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [commands, handleRunCommand])

  // Execute pending command when aux terminal becomes ready
  useEffect(() => {
    const activeRightTerminal = activeSessionId ? rightTerminalSessions[activeSessionId] : undefined
    if (activeRightTerminal && pendingCommandRef.current) {
      const cmd = pendingCommandRef.current
      pendingCommandRef.current = null
      setTimeout(() => {
        window.api.terminal.write(activeRightTerminal.id, cmd + '\r')
      }, 1200)
    }
  }, [rightTerminalSessions, activeSessionId])

  // 切 session 时聚焦新 active 的 aux 终端（照抄主终端 terminalRefs 模式）
  useEffect(() => {
    if (!isActive || !activeSessionId) return
    auxTerminalRefs.current[activeSessionId]?.focus()
  }, [isActive, activeSessionId])

  useEffect(() => {
    if (!clearAuxBufferTrigger || clearAuxBufferTrigger.n === 0) return
    auxTerminalRefs.current[clearAuxBufferTrigger.sid]?.clearBuffer()
  }, [clearAuxBufferTrigger])

  return (
    <div ref={containerRef} tabIndex={-1} className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none focus:ring-0">
      <div className="flex-1 min-h-0 overflow-hidden">
        {Object.entries(rightTerminalSessions).map(([sid, term]) => (
          <div key={sid} className="h-full flex flex-col overflow-hidden" style={{ display: sid === activeSessionId ? 'flex' : 'none' }}>
            <React.Suspense fallback={<div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">Loading...</div>}>
              <TerminalView
                ref={(node) => { if (node) auxTerminalRefs.current[sid] = node }}
                sessionId={term.id}
                sessionName="Right Terminal"
                sessionCwd={term.cwd}
                onOpenFile={handleRightTerminalOpenFile}
                showHeader={false}
                fontSize={12}
                isAux={true}
                isActive={sid === activeSessionId}
              />
            </React.Suspense>
          </div>
        ))}
        {!(activeSessionId && rightTerminalSessions[activeSessionId]) && (
          effectiveGitPath ? (
            <div className="h-full flex items-center justify-center">
              <button
                onClick={() => {
                  if (!activeSessionId) return
                  if (worktreeNav) {
                    onCreateRightTerminal?.(activeSessionId, effectiveGitPath)
                  } else {
                    onCreateRightTerminal?.(activeSessionId)
                  }
                }}
                className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors aux-tab__launch-btn"
              >
                {t('Launch Terminal')}
              </button>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-ide-text-muted text-xs">
              {t('Please select a workspace first')}
            </div>
          )
        )}
      </div>
      {commands.length > 0 && (
        <div className="shrink-0 border-t border-ide-border" style={{ maxHeight: '40%', overflowY: 'auto' }}>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-ide-accent sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm border-b border-ide-border">
            {t('Commands')}
          </div>
          {commands.map((cmd, i) => (
            <div
              key={i}
              className={`px-2 py-0.5 flex items-center gap-1.5 hover:bg-ide-hover group ${
                selectedCommandIndex === i ? 'bg-ide-accent/10 text-ide-text' : ''
              }`}
            >
              <button
                onClick={() => handleRunCommand(cmd.command)}
                className="w-5 h-5 rounded text-ide-accent hover:bg-ide-accent/20 flex items-center justify-center shrink-0 transition-colors"
                title={`Run: ${cmd.command}`}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
                </svg>
              </button>
              <span className="text-[11px] font-mono font-semibold text-ide-text shrink-0 w-[8.5rem] truncate">{cmd.command}</span>
              <span className="text-[10px] text-ide-text-muted/60 truncate">{cmd.comment}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
