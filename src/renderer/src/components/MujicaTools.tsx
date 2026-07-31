import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiStore, useAiSession } from '../aiStore'
import { mujicaStore } from '../mujicaStore'
import { ChatMarkdown, StreamingMarkdown } from './AiTab'
import { getAuxShellType } from '../utils/shellPrefs'
import { parseCommands, loadMdContent } from './DocTree'
import type { AiPermissionRequest, TerminalSession } from '@shared/types'

const TerminalView = React.lazy(() => import('./TerminalView'))
import type { TerminalViewHandle } from './TerminalView'

// AskUserQuestion can't be bypassed by any permission mode — the main process kills the
// subprocess when it arrives (awaitingUserInput) and answers go via askResume (--resume).
// Allow/Deny writes control_response to a dead stdin, so options must use handleAskResume.
function AskQuestionCard({ id, perm }: { id: string; perm: AiPermissionRequest }) {
  const questions = (perm.toolInput?.questions || []) as Array<{
    question: string
    header: string
    multiSelect: boolean
    options: Array<{ label: string; description?: string; preview?: string }>
  }>
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {}
    for (const q of questions) init[q.question] = new Set<string>()
    return init
  })
  const quickSubmit = questions.length === 1 && !questions[0].multiSelect
  const allAnswered = questions.every(q => (selections[q.question]?.size ?? 0) >= 1)

  const submit = (sel?: Record<string, Set<string>>) => {
    const s = sel ?? selections
    const answers: Record<string, string> = {}
    for (const q of questions) answers[q.question] = [...(s[q.question] || [])].join(', ')
    aiStore.handleAskResume(id, perm.requestId, true, perm.tool, { ...perm.toolInput, answers })
  }
  const skip = () => aiStore.handleAskResume(id, perm.requestId, false, perm.tool, perm.toolInput)

  const toggle = (qText: string, label: string, multi: boolean) => {
    const prevSet = selections[qText] || new Set<string>()
    const next = new Set<string>(multi ? prevSet : [])
    if (multi) {
      if (prevSet.has(label)) next.delete(label)
      else next.add(label)
    } else {
      next.add(label)
    }
    const nextSelections = { ...selections, [qText]: next }
    setSelections(nextSelections)
    if (quickSubmit) submit(nextSelections)
  }

  return (
    <div className="border border-ide-accent/40 rounded p-2 text-xs space-y-2 bg-ide-accent/5">
      {questions.map((q, qi) => (
        <div key={qi} className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-ide-accent/15 text-ide-accent border border-ide-accent/25">
              {q.header}
            </span>
            {q.multiSelect && <span className="text-[10px] text-ide-text-muted/60">multi-select</span>}
          </div>
          <div className="text-ide-text">{q.question}</div>
          <div className="flex flex-wrap gap-1">
            {q.options.map((opt, oi) => {
              const selected = selections[q.question]?.has(opt.label) ?? false
              return (
                <button
                  key={oi}
                  title={opt.description}
                  onClick={() => toggle(q.question, opt.label, q.multiSelect)}
                  className={`px-2 py-1 rounded border transition-colors ${
                    selected
                      ? 'bg-ide-accent/20 border-ide-accent/50 text-ide-text'
                      : 'border-ide-border hover:bg-ide-hover text-ide-text-muted'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        {!quickSubmit && (
          <button
            onClick={() => submit()}
            disabled={!allAnswered}
            className="flex-1 px-2 py-1 rounded bg-ide-accent/20 text-ide-accent hover:bg-ide-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Submit
          </button>
        )}
        <button
          onClick={skip}
          className={`px-2 py-1 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors ${quickSubmit ? 'text-[10px] px-1' : 'flex-1 border border-ide-border'}`}
        >
          skip
        </button>
      </div>
    </div>
  )
}

function PermissionCard({ id, perm }: { id: string; perm: AiPermissionRequest }) {
  if (perm.tool === 'AskUserQuestion') return <AskQuestionCard id={id} perm={perm} />
  const respond = (approved: boolean) => {
    aiStore.handlePermissionResponse(id, perm.requestId, approved, perm.tool, perm.toolInput)
  }
  const summary = perm.command || (perm.toolInput ? JSON.stringify(perm.toolInput).slice(0, 80) : '')
  return (
    <div className="border border-ide-warning/50 rounded p-2 text-xs space-y-1 bg-ide-hover/40">
      <div className="flex items-center gap-1 text-ide-warning font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-ide-warning" />
        {perm.tool}
      </div>
      {summary && <div className="text-ide-text-muted truncate font-mono">{summary}</div>}
      <div className="flex gap-2 pt-1">
        <button onClick={() => respond(true)} className="flex-1 px-2 py-1 rounded bg-ide-success/20 text-ide-success hover:bg-ide-success/30 transition-colors">Allow</button>
        <button onClick={() => respond(false)} className="flex-1 px-2 py-1 rounded bg-ide-danger/20 text-ide-danger hover:bg-ide-danger/30 transition-colors">Deny</button>
      </div>
    </div>
  )
}

function basename(p: string | undefined): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

// Persistent output pane: rendered while an agent node is pinned (click to pin,
// click again or ✕ to close). Output + terminal tabs; the terminal is spawned in
// the agent's worktree path once it exists, falling back to the base cwd.
export default function MujicaOutput({ pinnedId }: { pinnedId: string }) {
  const s = useAiSession(pinnedId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'output' | 'terminal'>('output')
  const viewRef = useRef(view)
  viewRef.current = view
  const [term, setTerm] = useState<TerminalSession | null>(null)
  const [termError, setTermError] = useState('')
  const termRef = useRef<TerminalSession | null>(null)
  const terminalHandleRef = useRef<TerminalViewHandle | null>(null)
  const cwd = s.worktreePath ?? s.cwd
  const cwdRef = useRef(cwd)
  const autoUtf8 = useMemo(() => {
    try { return localStorage.getItem('vibe-ide-auto-utf8') !== 'false' } catch { return true }
  }, [])
  const [commands, setCommands] = useState<Array<{ command: string; comment: string }>>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState<number | null>(null)
  const selectedCommandIndexRef = useRef<number | null>(null)
  useEffect(() => { selectedCommandIndexRef.current = selectedCommandIndex }, [selectedCommandIndex])
  const pendingCommandRef = useRef<string | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [s.messages, s.streamBuffer])

  // worktreePath may arrive after the agent becomes ready → close the terminal and
  // respawn it in the new cwd so the terminal always points at the worktree.
  useEffect(() => {
    if (cwdRef.current === cwd) return
    cwdRef.current = cwd
    if (termRef.current) {
      window.api.terminal.close(termRef.current.id)
      termRef.current = null
      setTerm(null)
    }
  }, [cwd])

  useEffect(() => () => {
    if (termRef.current) window.api.terminal.close(termRef.current.id)
  }, [])

  useEffect(() => {
    if (view === 'terminal') terminalHandleRef.current?.focus()
  }, [view])

  // Load CLAUDE.md (or AGENTS.md) commands for the terminal's cwd (pendingPathRef 防 stale 模式)
  const pendingPathRef = useRef<string | null>(null)
  useEffect(() => {
    const targetPath = cwd
    pendingPathRef.current = targetPath
    setSelectedCommandIndex(null)
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
  }, [cwd])

  const ensureTerminal = useCallback(async () => {
    if (termRef.current) return
    setTermError('')
    try {
      const t = await window.api.terminal.create({ cwd: cwdRef.current, shell: getAuxShellType(), autoUtf8 })
      termRef.current = t
      setTerm(t)
    } catch (e) {
      setTermError(String(e))
    }
  }, [autoUtf8])

  const runCommand = useCallback((command: string) => {
    const trimmed = command.trim()
    if (/^https?:\/\//i.test(trimmed)) {
      (window as any).__vibeBrowse?.(trimmed)
      return
    }
    const t = termRef.current
    if (t) {
      window.api.terminal.write(t.id, command + '\r')
    } else {
      pendingCommandRef.current = command
      ensureTerminal()
    }
  }, [ensureTerminal])

  // Execute pending command once the terminal becomes ready
  useEffect(() => {
    if (term && pendingCommandRef.current) {
      const cmd = pendingCommandRef.current
      pendingCommandRef.current = null
      setTimeout(() => {
        window.api.terminal.write(term.id, cmd + '\r')
      }, 1200)
    }
  }, [term])

  // Keyboard navigation in the commands panel (terminal tab only): ArrowUp/Down 选择，Enter 执行
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (viewRef.current !== 'terminal') return
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
          runCommand(commands[idx].command)
        }
      } else if (e.key === 'Escape') {
        setSelectedCommandIndex(null)
      }
    }

    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [commands, runCommand])

  return (
    <div className="absolute right-0 top-0 bottom-0 w-3/5 min-w-[420px] bg-ide-sidebar border-l border-ide-border shadow-2xl flex flex-col z-10">
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ide-text-muted bg-ide-hover/40 shrink-0">
        <span className="truncate flex-1">{basename(s.worktreePath) || 'agent output'}</span>
        <div className="flex items-center gap-0.5 bg-ide-hover rounded-md p-0.5 shrink-0">
          <button
            onClick={() => setView('output')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors ${
              view === 'output' ? 'bg-ide-accent/15 text-ide-text' : 'text-ide-text-muted hover:text-ide-text'
            }`}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
              <rect x="2.5" y="3" width="11" height="9" rx="1.5" />
              <line x1="5" y1="6.5" x2="11" y2="6.5" />
              <line x1="5" y1="9" x2="9" y2="9" />
            </svg>
            Output
          </button>
          <button
            onClick={() => { ensureTerminal(); setView('terminal') }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors ${
              view === 'terminal' ? 'bg-ide-accent/15 text-ide-text' : 'text-ide-text-muted hover:text-ide-text'
            }`}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
              <polyline points="3.5,4 7,8 3.5,12" />
              <line x1="9" y1="12" x2="13" y2="12" />
            </svg>
            Terminal
          </button>
        </div>
        <button
          onClick={() => mujicaStore.unpin()}
          title="close"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col" style={{ display: view === 'output' ? 'flex' : 'none' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-2">
          {s.pendingPermission && <PermissionCard id={pinnedId} perm={s.pendingPermission} />}
          {s.messages.map((m, i) => {
            if (m.type === 'user' && typeof m.content === 'string') {
              return <div key={i} className="text-right text-sm text-ide-text break-words">{m.content}</div>
            }
            if (m.type === 'assistant' && m.content) {
              return <ChatMarkdown key={i} text={m.content} workspacePath={s.worktreePath ?? null} />
            }
            if (m.type === 'result' && (m as any).error) {
              return <div key={i} className="text-xs text-ide-danger break-words">{(m as any).error}</div>
            }
            if (m.type === 'result') {
              const r = m as any
              return <div key={i} className="text-[11px] text-ide-text-muted">done · {r.numTurns ?? ''} turns {r.costUsd != null ? `· $${r.costUsd.toFixed(4)}` : ''}</div>
            }
            return null
          })}
          {s.streaming && s.streamBuffer && <StreamingMarkdown text={s.streamBuffer} workspacePath={s.worktreePath ?? null} />}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
        {term ? (
          <React.Suspense fallback={<div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">Loading...</div>}>
            <TerminalView
              ref={(node) => { if (node) terminalHandleRef.current = node }}
              sessionId={term.id}
              sessionName="Agent Terminal"
              sessionCwd={term.cwd}
              showHeader={false}
              fontSize={12}
              isAux={true}
              isActive={view === 'terminal'}
            />
          </React.Suspense>
        ) : termError ? (
          <div className="flex-1 flex items-center justify-center text-ide-danger text-xs px-4 text-center break-all">{termError}</div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">Launching…</div>
        )}
        {commands.length > 0 && (
          <div className="shrink-0 border-t border-ide-border" style={{ maxHeight: '32%', overflowY: 'auto' }}>
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-ide-accent sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm border-b border-ide-border">
              Commands
            </div>
            {commands.map((cmd, i) => (
              <div
                key={i}
                className={`px-2 py-0.5 flex items-center gap-1.5 hover:bg-ide-hover group ${
                  selectedCommandIndex === i ? 'bg-ide-accent/10 text-ide-text' : ''
                }`}
              >
                <button
                  onClick={() => runCommand(cmd.command)}
                  className="w-5 h-5 rounded text-ide-accent hover:bg-ide-accent/20 flex items-center justify-center shrink-0 transition-colors"
                  title={`Run: ${cmd.command}`}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
                  </svg>
                </button>
                <span className={`text-xs font-mono font-semibold shrink-0 w-[8.5rem] truncate ${/^https?:\/\//i.test(cmd.command.trim()) ? 'text-ide-accent underline' : 'text-ide-text'}`}>{cmd.command}</span>
                <span className="text-xs text-ide-text-muted/70 truncate">{cmd.comment}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
