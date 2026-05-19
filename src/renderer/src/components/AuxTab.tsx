import React, { useState, useEffect, useCallback, useRef } from 'react'
const TerminalView = React.lazy(() => import('./TerminalView'))
import { TerminalSession } from '@shared/types'
import { parseCommands } from './DocTree'
import { useI18n } from '../i18n'

interface AuxTabProps {
  rightTerminalSession: TerminalSession | null
  activeSessionId: string | null
  effectiveGitPath: string | null
  worktreeNav: { originalPath: string; worktreePath: string; originalBranch: string } | null
  onCreateRightTerminal?: (sessionId: string, cwd?: string) => void
  onOpenFileFromRightTerminal?: (fullPath: string, lineNumber?: number) => void
}

export default function AuxTab({ rightTerminalSession, activeSessionId, effectiveGitPath, worktreeNav, onCreateRightTerminal, onOpenFileFromRightTerminal }: AuxTabProps) {
  const [commands, setCommands] = useState<Array<{ command: string; comment: string }>>([])
  const pendingCommandRef = useRef<string | null>(null)
  const { t } = useI18n()

  // Load CLAUDE.md commands
  const loadClaudeCommands = useCallback(async () => {
    if (!effectiveGitPath) { setCommands([]); return }
    const mdPath = effectiveGitPath.replace(/\\/g, '/') + '/CLAUDE.md'
    try {
      const res: any = await window.api.file.read(mdPath)
      if (res.error) { setCommands([]); return }
      const normalized = res.content.replace(/\r\n/g, '\n')
      setCommands(parseCommands(normalized))
    } catch { setCommands([]) }
  }, [effectiveGitPath])

  useEffect(() => { loadClaudeCommands() }, [effectiveGitPath])

  // Execute pending command when aux terminal becomes ready
  useEffect(() => {
    if (rightTerminalSession && pendingCommandRef.current) {
      const cmd = pendingCommandRef.current
      pendingCommandRef.current = null
      setTimeout(() => {
        window.api.terminal.write(rightTerminalSession.id, cmd + '\r')
      }, 400)
    }
  }, [rightTerminalSession])

  const handleRunCommand = useCallback((command: string) => {
    if (rightTerminalSession) {
      window.api.terminal.write(rightTerminalSession.id, command + '\r')
    } else if (activeSessionId) {
      pendingCommandRef.current = command
      onCreateRightTerminal?.(activeSessionId)
    }
  }, [rightTerminalSession, activeSessionId, onCreateRightTerminal])

  // 右侧终端打开文件的回调 - 触发中间终端切换到 edit
  const handleRightTerminalOpenFile = useCallback(async (fullPath: string, lineNumber?: number) => {
    if (onOpenFileFromRightTerminal) {
      onOpenFileFromRightTerminal(fullPath, lineNumber)
    }
  }, [onOpenFileFromRightTerminal])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        {rightTerminalSession ? (
          <React.Suspense fallback={<div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">Loading...</div>}>
            <TerminalView
              sessionId={rightTerminalSession.id}
              sessionName="Right Terminal"
              sessionCwd={rightTerminalSession.cwd}
              onOpenFile={handleRightTerminalOpenFile}
              showHeader={false}
              fontSize={12}
              isAux={true}
            />
          </React.Suspense>
        ) : effectiveGitPath ? (
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
              className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
            >
              {t('Launch Terminal')}
            </button>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-ide-text-muted text-xs">
            {t('Please select a workspace first')}
          </div>
        )}
      </div>
      {commands.length > 0 && (
        <div className="shrink-0 border-t border-ide-border" style={{ maxHeight: '40%', overflowY: 'auto' }}>
          <div className="px-2 py-1 text-[10px] text-ide-text-muted uppercase tracking-wider sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm">
            {t('Commands')}
          </div>
          {commands.map((cmd, i) => (
            <div key={i} className="px-2 py-0.5 flex items-center gap-1.5 hover:bg-ide-hover group">
              <button
                onClick={() => handleRunCommand(cmd.command)}
                className="w-5 h-5 rounded text-ide-accent hover:bg-ide-accent/20 flex items-center justify-center shrink-0 transition-colors"
                title={`Run: ${cmd.command}`}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path fill-rule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clip-rule="evenodd" />
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
