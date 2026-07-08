import React, { useState, useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { AiMessage, AiToolUse, AiSessionState, AiPermissionRequest, AiPermissionMode, AiSlashCommand } from '@shared/types'
import { AI_FILE_EDIT_TOOLS } from '@shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStableCodeOverrides } from './MarkdownCodeBlock'
import { useI18n } from '../i18n'
import { FILE_PATH_REGEX, parseFilePath } from '../utils/filePathUtils'
import { aiStore, useAiSession, EMPTY_SESSION, enrichSlashCommands, SLASH_COMMAND_DESCRIPTIONS } from '../aiStore'
import { SquareArrowUp, Square, ChevronDown, Check, HelpCircle, FileText, Undo2, MessageSquare, GitFork, MessageSquarePlus, Copy, Circle, Loader2, ListTodo, Eye, EyeOff } from 'lucide-react'

interface AiTabProps {
  activeSessionId: string | null
  workspacePath: string | null
  isActive: boolean
  autoApprove: boolean
  permissionMode: AiPermissionMode
  onPermissionModeChange: (mode: AiPermissionMode) => void
  onViewAi: () => void
  onRenameSession: (name: string) => void
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  onForkSession?: (userMessageIndex: number) => void
  onAgentStatusChange?: (sessionId: string, status: 'running' | 'idle') => void
  resumeSessionId?: string
}

export interface AiTabHandle {
  focus: () => void
  setValue: (text: string) => void
}

// ── Tool type classification ──────────────────────────────────────

const COMMAND_TOOLS = new Set(['Bash', 'bash', 'terminal', 'run_command', 'execute_command'])
const SEARCH_TOOLS = new Set(['Grep', 'grep', 'search', 'Glob', 'glob', 'find', 'ripgrep', 'Read'])

function getToolCategory(name: string): 'file' | 'command' | 'search' | 'default' {
  if (AI_FILE_EDIT_TOOLS.has(name)) return 'file'
  if (COMMAND_TOOLS.has(name)) return 'command'
  if (SEARCH_TOOLS.has(name)) return 'search'
  return 'default'
}

// ── Task tools ────────────────────────────────────────────────────

const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop'])

interface TodoItem {
  id: string
  subject: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  parentToolUseId?: string
}

function deriveTodoList(messages: AiMessage[]): TodoItem[] {
  const tasks = new Map<string, TodoItem>()
  for (const msg of messages) {
    if (!msg.toolUse) continue
    for (const tool of msg.toolUse) {
      if (tool.name === 'TaskCreate') {
        const id = String(tasks.size + 1)
        tasks.set(id, {
          id,
          subject: tool.input?.subject || '',
          description: tool.input?.description,
          status: 'pending',
          parentToolUseId: msg.parentToolUseId,
        })
      } else if (tool.name === 'TaskUpdate') {
        const taskId = String(tool.input?.taskId || '')
        const newStatus = tool.input?.status as TodoItem['status'] | undefined
        const existing = tasks.get(taskId)
        if (existing && newStatus) {
          existing.status = newStatus
        }
      }
    }
  }
  return [...tasks.values()].filter(t => t.status !== 'deleted')
}

// ── Sub-components (被调先于主调) ──────────────────────────────

function ChatMarkdown({ text, className = '', workspacePath, onOpenFile }: {
  text: string; className?: string
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
}) {
  const codeOverrides = useStableCodeOverrides()
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!workspacePath || !onOpenFile) return
    const target = e.target as HTMLElement
    if (target.closest('a, pre')) return
    if (window.getSelection()?.toString().trim()) return
    const block = target.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote') as HTMLElement
    const text = block?.textContent || ''
    FILE_PATH_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = FILE_PATH_REGEX.exec(text)) !== null) {
      const parsed = parseFilePath(match[0], workspacePath)
      if (parsed) {
        e.preventDefault()
        onOpenFile(parsed.fullPath, parsed.lineNumber)
        return
      }
    }
  }, [workspacePath, onOpenFile])

  return (
    <div className={`ai-tab__markdown md-preview text-sm ${className}`} onClick={handleClick}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeOverrides}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

// During streaming, only render markdown up to the last CLOSED code fence.
// Any open (incomplete) code block is shown as raw text to prevent CodeBlock
// from remounting + re-colorizing on every token (which causes flicker).
function StreamingMarkdown({ text, className = '', workspacePath, onOpenFile }: {
  text: string; className?: string
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
}) {
  const codeOverrides = useStableCodeOverrides()
  const fenceRe = /```/g
  let count = 0
  let lastCloseIdx = -1
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    count++
    if (count % 2 === 0) lastCloseIdx = m.index + 3
  }
  const isCodeOpen = count % 2 !== 0
  const safePart = isCodeOpen ? (lastCloseIdx >= 0 ? text.slice(0, lastCloseIdx) : '') : text
  const rawPart = isCodeOpen ? text.slice(lastCloseIdx >= 0 ? lastCloseIdx : 0) : ''

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!workspacePath || !onOpenFile) return
    const target = e.target as HTMLElement
    if (target.closest('a, pre')) return
    if (window.getSelection()?.toString().trim()) return
    const block = target.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote') as HTMLElement
    const text = block?.textContent || ''
    FILE_PATH_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = FILE_PATH_REGEX.exec(text)) !== null) {
      const parsed = parseFilePath(match[0], workspacePath)
      if (parsed) {
        e.preventDefault()
        onOpenFile(parsed.fullPath, parsed.lineNumber)
        return
      }
    }
  }, [workspacePath, onOpenFile])

  return (
    <div className={`ai-tab__markdown ai-tab__markdown--streaming md-preview text-sm ${className}`} onClick={handleClick}>
      {safePart && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeOverrides}>
          {safePart}
        </ReactMarkdown>
      )}
      {rawPart && <pre className="ai-tab__markdown-raw whitespace-pre-wrap text-ide-text">{rawPart}</pre>}
    </div>
  )
}

function ToolIcon({ category }: { category: 'file' | 'command' | 'search' | 'default' }) {
  const cls = "w-3 h-3 shrink-0"
  if (category === 'file') return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={cls}>
      <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.848 2.047a.75.75 0 0 0 .98.98l2.047-.848a2.75 2.75 0 0 0 .892-.596l4.261-4.262a1.75 1.75 0 0 0 0-2.474Z" />
      <path d="M4.75 3.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V9A.75.75 0 0 1 14 9v2.25A2.75 2.75 0 0 1 11.25 14h-6.5A2.75 2.75 0 0 1 2 11.25v-6.5A2.75 2.75 0 0 1 4.75 2H7a.75.75 0 0 1 0 1.5H4.75Z" />
    </svg>
  )
  if (category === 'command') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
  if (category === 'search') return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={cls}>
      <path d="M7.25 3.688a8.035 8.035 0 0 0-4.872-.523A.48.48 0 0 0 2 3.64v7.994c0 .345.342.588.679.512a6.02 6.02 0 0 1 4.571.81V3.688ZM8.75 12.956a6.02 6.02 0 0 1 4.571-.81c.337.075.679-.167.679-.512V3.64a.48.48 0 0 0-.378-.475 8.034 8.034 0 0 0-4.872.523v9.268Z" />
    </svg>
  )
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function AiToolCallCard({ tool }: { tool: AiToolUse }) {
  const [expanded, setExpanded] = useState(false)
  const category = getToolCategory(tool.name)
  const isFileEdit = category === 'file'
  const hasResult = !!tool.result
  const detail = tool.input?.file_path || tool.input?.command || ''
  return (
    <div className="ai-tab__tool-call inline-block max-w-full animate-fade-in">
      <button
        onClick={() => setExpanded(v => !v)}
        className={`ai-tab__tool-toggle inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono transition-colors ${
          isFileEdit ? 'bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25' : 'bg-ide-hover text-ide-text-muted hover:bg-ide-active'
        }`}
      >
        <span className="shrink-0"><ToolIcon category={category} /></span>
        <span className="shrink-0 leading-none">{tool.name}</span>
        {detail && <span className="ai-tab__tool-detail-preview truncate max-w-[140px] opacity-60 text-[9px] leading-none">{detail}</span>}
        {hasResult && (
          <span className={`ai-tab__tool-status shrink-0 text-[9px] leading-none ${tool.result!.isError ? 'text-ide-danger' : 'text-ide-success'}`}>
            {tool.result!.isError ? '✗' : '✓'}
          </span>
        )}
      </button>
      {expanded && (
        <div className="ai-tab__tool-detail-panel mt-1 px-2 py-1 text-[11px] font-mono bg-ide-bg border border-ide-border rounded space-y-1 max-h-48 overflow-y-auto">
          {hasResult && (
            <div className={tool.result!.isError ? 'text-ide-danger/80' : 'text-ide-text'}>
              <pre className="whitespace-pre-wrap break-words text-[11px]">{tool.result!.content}</pre>
            </div>
          )}
          <div className="text-ide-text-muted">
            <pre className="whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(tool.input, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

const AiAskQuestionCard = React.memo(function AiAskQuestionCard({ perm, sessionId, onRespond }: {
  perm: AiPermissionRequest
  sessionId: string
  onRespond: (sid: string, rid: string, approved: boolean, tool: string, toolInput?: Record<string, any>) => void
}) {
  const { t } = useI18n()

  const questions = (perm.toolInput?.questions || []) as Array<{
    question: string
    header: string
    multiSelect: boolean
    options: Array<{ label: string; description?: string; preview?: string }>
  }>

  // 单题单选 → 点击选项立即提交；多题或多选 → Submit 统一提交
  const quickSubmit = questions.length === 1 && !questions[0].multiSelect

  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {}
    for (const q of questions) init[q.question] = new Set<string>()
    return init
  })

  const allAnswered = questions.every(q => (selections[q.question]?.size ?? 0) >= 1)

  const buildAnswers = (selOverride?: Record<string, Set<string>>): Record<string, string> => {
    const sel = selOverride ?? selections
    const answers: Record<string, string> = {}
    for (const q of questions) {
      answers[q.question] = [...(sel[q.question] || [])].join(', ')
    }
    return answers
  }

  const handleSubmit = () => {
    onRespond(sessionId, perm.requestId, true, perm.tool, { ...perm.toolInput, answers: buildAnswers() })
  }

  const toggle = (qText: string, label: string, multi: boolean) => {
    const prevSet = selections[qText] || new Set<string>()
    const next = new Set<string>(multi ? prevSet : [])
    if (multi) {
      if (prevSet.has(label)) next.delete(label)
      else next.add(label)
    } else {
      next.add(label)
    }
    setSelections(prev => ({ ...prev, [qText]: next }))

    // quickSubmit 模式下，单题单选点击即提交
    if (quickSubmit) {
      onRespond(sessionId, perm.requestId, true, perm.tool, {
        ...perm.toolInput,
        answers: { [qText]: label },
      })
    }
  }

  return (
    <div className="ai-tab__question-card shrink-0 border-t border-ide-accent/40 bg-ide-accent/5 px-3 py-2.5 animate-fade-in">
      <div className="flex items-center gap-1.5 mb-1.5">
        <HelpCircle size={15} className="text-ide-accent shrink-0" />
        <span className="ai-tab__question-title text-[13px] font-medium text-ide-accent">{t('AI has a question')}</span>
      </div>

      {questions.map((q, qi) => (
        <div key={qi} className="mb-3 last:mb-0">
          <div className="ai-tab__question-header flex items-center gap-1.5 mb-1">
            <span className="px-2 py-1 text-[11px] font-medium rounded bg-ide-accent/15 text-ide-accent border border-ide-accent/25">
              {q.header}
            </span>
            {q.multiSelect && (
              <span className="text-[11px] text-ide-text-muted/60">{t('multi-select')}</span>
            )}
          </div>
          <div className="text-[13px] text-ide-text mb-1.5">{q.question}</div>
          <div className="flex flex-wrap gap-1">
            {q.options.map((opt, oi) => {
              const selected = selections[q.question]?.has(opt.label) ?? false
              return (
                <button
                  key={oi}
                  title={opt.description}
                  onClick={() => toggle(q.question, opt.label, q.multiSelect)}
                  className={`ai-tab__question-option px-3 py-1.5 text-[12px] rounded border transition-colors ${
                    selected
                      ? 'ai-tab__question-option--selected bg-ide-accent/20 border-ide-accent/50 text-ide-text'
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

      <div className="flex gap-1.5 mt-2">
        {!quickSubmit && (
          <button
            disabled={!allAnswered}
            onClick={handleSubmit}
            className={`ai-tab__question-submit-btn px-4 py-1.5 text-[13px] font-medium rounded transition-colors ${
              allAnswered
                ? 'bg-ide-accent hover:bg-ide-accent-hover text-white'
                : 'bg-ide-accent/30 text-white/50 cursor-not-allowed'
            }`}
          >
            {t('Submit')}
          </button>
        )}
        <button
          onClick={() => onRespond(sessionId, perm.requestId, false, perm.tool, perm.toolInput)}
          className="ai-tab__question-deny-btn px-4 py-1.5 text-[13px] font-medium border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
        >
          {t('Deny')}
        </button>
      </div>
    </div>
  )
})

const AiPermissionCard = React.memo(function AiPermissionCard({ perm, sessionId, onRespond }: {
  perm: AiPermissionRequest
  sessionId: string
  onRespond: (sid: string, rid: string, approved: boolean, tool: string, toolInput?: Record<string, any>) => void
}) {
  const { t } = useI18n()
  return (
    <div className="ai-tab__permission-card shrink-0 border-t border-ide-warning/40 bg-ide-warning/5 px-3 py-2.5 animate-fade-in">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-ide-warning shrink-0 mt-0.5">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="ai-tab__permission-title text-[13px] font-medium text-ide-warning">{t('AI wants permission to run:')}</div>
          <div className="ai-tab__permission-cmd mt-1 px-1.5 py-1 bg-ide-bg/80 rounded text-[12px] font-mono text-ide-text truncate">
            <span className="text-ide-accent">{perm.tool}</span>
            {perm.command && <span className="text-ide-text-muted"> → {perm.command}</span>}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5 mt-2 ml-7">
        <button
          onClick={() => onRespond(sessionId, perm.requestId, true, perm.tool, perm.toolInput)}
          className="ai-tab__permission-approve-btn px-4 py-1.5 text-[13px] font-medium bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
        >
          {t('Approve')}
        </button>
        <button
          onClick={() => onRespond(sessionId, perm.requestId, false, perm.tool, perm.toolInput)}
          className="ai-tab__permission-deny-btn px-4 py-1.5 text-[13px] font-medium border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
        >
          {t('Deny')}
        </button>
      </div>
    </div>
  )
})

// ExitPlanMode approval card. Plan content is already on disk (perm.toolInput.planFilePath);
// "Clear & Execute" kills the plan-mode subprocess and respawns in acceptEdits mode with the
// plan re-injected as first message — clears the inflated context from exploration.
// "Send Feedback" denies with a feedback message so the model revises the plan.
const AiExitPlanModeCard = React.memo(function AiExitPlanModeCard({ perm, sessionId, onClearExecute, onDeny, workspacePath, onOpenFile }: {
  perm: AiPermissionRequest
  sessionId: string
  onClearExecute: (sessionId: string, planFilePath: string) => void
  onDeny: (sessionId: string, requestId: string, feedback: string) => void
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
}) {
  const { t } = useI18n()
  const plan = (perm.toolInput?.plan as string) || ''
  const planFilePath = (perm.toolInput?.planFilePath as string) || ''
  const [feedback, setFeedback] = useState('')

  return (
    <div className="ai-tab__plan-card shrink-0 border-t border-ide-accent/40 bg-ide-accent/5 px-3 py-2.5 animate-fade-in">
      <div className="flex items-center gap-1.5 mb-1.5">
        <FileText size={15} className="text-ide-accent shrink-0" />
        <span className="text-[13px] font-medium text-ide-accent">{t('Plan Ready')}</span>
      </div>

      <div className="ai-tab__plan-content max-h-64 overflow-y-auto mb-1.5 bg-ide-bg/60 rounded px-2 py-1.5 border border-ide-border/40">
        <ChatMarkdown text={plan} workspacePath={workspacePath} onOpenFile={onOpenFile} />
      </div>

      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={t('Feedback for revision (optional)')}
        rows={2}
        className="ai-tab__plan-feedback w-full text-[13px] px-2 py-1 mb-1.5 bg-ide-bg border border-ide-border rounded resize-none focus:outline-none focus:border-ide-accent/60 text-ide-text"
      />

      <div className="flex gap-1.5">
        <button
          onClick={() => onClearExecute(sessionId, planFilePath)}
          className="ai-tab__plan-execute-btn px-4 py-1.5 text-[13px] font-medium bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
        >
          {t('Clear & Execute')}
        </button>
        {feedback.trim() && (
          <button
            onClick={() => onDeny(sessionId, perm.requestId, feedback)}
            className="px-4 py-1.5 text-[13px] font-medium border border-ide-accent/40 hover:bg-ide-accent/10 text-ide-accent rounded transition-colors"
          >
            {t('Send Feedback')}
          </button>
        )}
        <button
          onClick={() => onDeny(sessionId, perm.requestId, '')}
          className="px-4 py-1.5 text-[13px] font-medium border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
        >
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
})

function findMessageIndexForUserMessage(messages: AiMessage[], userMessageIndex: number): number {
  let count = 0
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user' && m.content && m.type === 'user') {
      if (count === userMessageIndex) return i
      count++
    }
  }
  return -1
}

function AiUserMessage({ message, userMessageIndex, totalUserMessages, isBusy, onRevert, onRevertAndCode, onFork }: {
  message: AiMessage
  userMessageIndex: number
  totalUserMessages: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
}) {
  const { t } = useI18n()
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHideTimer = () => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }

  useEffect(() => {
    if (!showPopover) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPopover])

  return (
    <div className="ai-tab__message ai-tab__message--user flex justify-end animate-fade-in">
      <div className="ai-tab__message-wrap max-w-[85%] relative"
        onMouseEnter={() => { clearHideTimer(); setShowPopover(true) }}
        onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setShowPopover(false), 300) }}
      >
        <div className="ai-tab__user-bubble px-3 py-2 rounded-2xl rounded-tr-md bg-ide-accent/12 border-2 border-ide-accent/30 text-ide-text text-sm whitespace-pre-wrap">
          {message.content}
        </div>

        {showPopover && (
          <div ref={popoverRef}
            className="ai-tab__user-popover absolute right-0 top-full mt-1 z-30
                       bg-ide-sidebar border border-ide-border rounded-lg shadow-lg
                       py-1 min-w-[170px] animate-fade-in"
          >
            <button
              onClick={() => { setShowPopover(false); onRevertAndCode(userMessageIndex) }}
              disabled={isBusy}
              className="ai-tab__user-popover-item w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left text-ide-text-muted
                         hover:bg-ide-hover hover:text-ide-text
                         disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Undo2 size={12} className="shrink-0" />
              {t('Revert conversation & code')}
            </button>
            <button
              onClick={() => { setShowPopover(false); onRevert(userMessageIndex) }}
              disabled={isBusy}
              className="ai-tab__user-popover-item w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left text-ide-text-muted
                         hover:bg-ide-hover hover:text-ide-text
                         disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <MessageSquare size={12} className="shrink-0" />
              {t('Revert conversation only')}
            </button>
            <button
              onClick={() => { setShowPopover(false); onFork(userMessageIndex) }}
              disabled={isBusy}
              className="ai-tab__user-popover-item w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left text-ide-text-muted
                         hover:bg-ide-hover hover:text-ide-text
                         disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <GitFork size={12} className="shrink-0" />
              {t('Fork to new session')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBlock({ text, defaultOpen = false, durationMs }: { text: string; defaultOpen?: boolean; durationMs?: number }) {
  const [open, setOpen] = useState(defaultOpen)
  const label = durationMs != null
    ? `Thinking for ${(durationMs / 1000).toFixed(1)}s`
    : 'Thinking'
  return (
    <div className="ai-tab__thinking max-w-full animate-fade-in">
      <button
        onClick={() => setOpen(v => !v)}
        className="ai-tab__thinking-toggle inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 border border-ide-accent/20 transition-colors"
      >
        <svg role="img" width="12px" height="12px" viewBox="0 0 24 24" aria-labelledby="lightBulbIconTitle" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" fill="none" className="shrink-0">
          <title id="lightBulbIconTitle">Light Bulb</title>
          <path d="M16 12C15.3333333 12.6666667 15 14 15 16L15 17 9 17 9 16C9 14 8.66666667 12.6666667 8 12 5.6739597 9.6739597 5.41421356 6.10050506 7.75735931 3.75735931 10.1005051 1.41421356 13.8994949 1.41421356 16.2426407 3.75735931 18.5857864 6.10050506 18.4068484 9.59315157 16 12zM10 21L14 21"/>
        </svg>
        <span className="shrink-0 leading-none">{label}</span>
      </button>
      {open && (
        <div className="ai-tab__thinking-content mt-1 px-3 py-2 text-xs bg-ide-accent/5 border border-ide-accent/15 rounded space-y-1 max-h-64 overflow-y-auto">
          <pre className="ai-tab__thinking-text whitespace-pre-wrap break-words text-[13px] text-ide-text-muted">{text}</pre>
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 opacity-0 group-hover/meta:opacity-100 transition-opacity hover:text-ide-accent"
      title="Copy"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function CollapsedToolsSummary({ tools }: { tools: AiToolUse[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="ai-tab__tools-summary animate-fade-in">
      <button
        onClick={() => setExpanded(v => !v)}
        className="ai-tab__tools-summary-toggle inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 border border-ide-accent/15 transition-colors"
      >
        <ToolIcon category="default" />
        <span className="shrink-0 leading-none">tools * {tools.length}</span>
        <ChevronDown size={10} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="ai-tab__tools-summary-list mt-1 flex flex-col gap-1 animate-fade-in">
          {tools.map(tool => <AiToolCallCard key={tool.id} tool={tool} />)}
        </div>
      )}
    </div>
  )
}

function AiAssistantMessage({ message, workspacePath, onOpenFile, copyText, viewMode }: {
  message: AiMessage
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  copyText?: string
  viewMode?: number
}) {
  const { t } = useI18n()
  const hideTools = viewMode === 1 || viewMode === 2
  const hideThink = viewMode === 2
  const showMeta = message.type === 'result' && (message.costUsd != null || message.numTurns != null)
  const showContent = message.type !== 'result'
  const hasContent = showContent && (message.content || message.thinking || (message.toolUse && message.toolUse.length > 0))

  // Status pill for result messages — abort takes precedence over subtype errors
  const statusConfig = message.type === 'result' && message.isAborted
    ? { label: t('Aborted'), color: 'text-ide-text-muted/60' }
    : message.subtype === 'error_max_tokens'
      ? { label: t('Max tokens reached'), color: 'text-ide-warning' }
      : message.subtype === 'error_during_execution'
        ? { label: t('Execution failed'), color: 'text-ide-danger' }
        : null

  return (
    <div className="ai-tab__message ai-tab__message--assistant space-y-1 animate-fade-in">
      {statusConfig && (
        <div className={`ai-tab__status-pill text-[9px] font-medium px-1 ${statusConfig.color}`}>
          {statusConfig!.label}
        </div>
      )}
      {hasContent && (
        <div className="ai-tab__message-content max-w-[92%] space-y-1.5">
          {!hideThink && message.thinking && <ThinkingBlock text={message.thinking} durationMs={message.thinkingDurationMs} />}
          {!hideTools && message.toolUse && message.toolUse.length >= 2 && <CollapsedToolsSummary tools={message.toolUse} />}
          {!hideTools && message.toolUse && message.toolUse.length === 1 && (
            <AiToolCallCard key={message.toolUse[0].id} tool={message.toolUse[0]} />
          )}
          {message.content && <ChatMarkdown text={message.content} workspacePath={workspacePath} onOpenFile={onOpenFile} />}
        </div>
      )}
      {showMeta && (
        <div className="ai-tab__message-meta flex items-center gap-2 text-[11px] text-ide-text-muted/50 px-1 group/meta">
          <span className="inline-flex items-center gap-0.5">
            <span className="text-sm">✻</span>
            <span>Churned for {((message.durationMs || 0) / 1000).toFixed(1)}s</span>
          </span>
          {copyText && <CopyButton text={copyText} />}
        </div>
      )}
    </div>
  )
}

function AiErrorMessage({ message }: { message: AiMessage }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const handleCopyCmd = useCallback(() => {
    if (message.installCmd) {
      navigator.clipboard.writeText(message.installCmd).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }, [message.installCmd])

  return (
    <div className="ai-tab__error px-3 py-2 rounded-2xl rounded-tl-md bg-ide-danger/10 border border-ide-danger/25 text-ide-danger text-xs animate-fade-in">
      {message.error}
      {message.installCmd && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <code className="ai-tab__error-cmd px-1.5 py-0.5 bg-ide-bg/60 rounded text-[10px] font-mono text-ide-text-muted flex-1 truncate">
            {message.installCmd}
          </code>
          <button
            onClick={handleCopyCmd}
            className="ai-tab__error-copy-btn shrink-0 px-1.5 py-0.5 text-[10px] border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
          >
            {copied ? '✓' : t('Copy')}
          </button>
        </div>
      )}
    </div>
  )
}

function TodoListPanel({ items }: { items: TodoItem[] }) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const completed = items.filter(i => i.status === 'completed').length
  const total = items.length

  return (
    <div className="ai-tab__todo-panel shrink-0 border-b border-ide-border/30 animate-fade-in">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="ai-tab__todo-toggle w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-ide-hover/30 transition-colors"
      >
        <ListTodo size={13} className="text-ide-accent shrink-0" />
        <span className="text-[11px] font-medium text-ide-text-muted">
          {t('Tasks')} ({completed}/{total})
        </span>
        <ChevronDown size={11} className={`ml-auto text-ide-text-muted/50 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && (
        <div className="px-2 pb-1.5 space-y-0.5">
          {items.map(item => {
            const isCompleted = item.status === 'completed'
            const isInProgress = item.status === 'in_progress'
            return (
              <div key={item.id} className="ai-tab__todo-item flex items-center gap-2 px-1 py-0.5 text-xs">
                {isCompleted ? (
                  <Check size={12} className="text-ide-success shrink-0" />
                ) : isInProgress ? (
                  <Loader2 size={12} className="text-ide-accent shrink-0 animate-spin" />
                ) : (
                  <Circle size={12} className="text-ide-text-muted/40 shrink-0" />
                )}
                <span className={`ai-tab__todo-text truncate ${isCompleted ? 'ai-tab__todo-text--completed line-through text-ide-text-muted/40' : 'text-ide-text'}`}>
                  {item.subject}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AiMessageBubble({ message, workspacePath, onOpenFile, userMessageIndex, totalUserMessages, isBusy, onRevert, onRevertAndCode, onFork, msgIndex, allMessages, viewMode }: {
  message: AiMessage
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  userMessageIndex: number
  totalUserMessages: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
  msgIndex: number
  allMessages: AiMessage[]
  viewMode?: number
}) {
  let copyText: string | undefined
  if (message.type === 'result' && message.numTurns != null) {
    for (let j = msgIndex - 1; j >= 0; j--) {
      const prev = allMessages[j]
      if (prev.type === 'assistant' && prev.content) { copyText = prev.content; break }
      if (prev.type !== 'assistant') break
    }
  }
  const { t } = useI18n()
  let inner: React.ReactNode
  if (message.error) {
    inner = <AiErrorMessage message={message} />
  } else if (message.role === 'user') {
    inner = <AiUserMessage message={message} userMessageIndex={userMessageIndex} totalUserMessages={totalUserMessages} isBusy={isBusy} onRevert={onRevert} onRevertAndCode={onRevertAndCode} onFork={onFork} />
  } else if (
    message.type === 'result'
    && message.costUsd == null
    && message.numTurns == null
    && message.subtype !== 'error_max_tokens'
    && message.subtype !== 'error_during_execution'
    && !message.isAborted
  ) {
    // success 且无 meta → 重复消息，不渲染
    return null
  } else {
    inner = <AiAssistantMessage message={message} workspacePath={workspacePath} onOpenFile={onOpenFile} copyText={copyText} viewMode={viewMode} />
  }

  // 子 agent 视觉分组（Agent/Task 工具产生的子消息）
  if (message.parentToolUseId) {
    return (
      <div className="ai-tab__agent-group border-l-[3px] border-ide-accent/40 pl-2 ml-2 space-y-1">
        <div className="ai-tab__agent-label text-[9px] text-ide-accent/70 uppercase tracking-wider font-mono">
          {t('Agent')}
        </div>
        {inner}
      </div>
    )
  }
  return <>{inner}</>
}

// ── Example prompts ──────────────────────────────────────────────

const EXAMPLE_PROMPTS: { label: string; prompt: string }[] = [
  { label: 'Explain this codebase', prompt: 'prompt.explain' },
  { label: 'Find potential bugs', prompt: 'prompt.bugs' },
  { label: 'Write tests', prompt: 'prompt.tests' },
  { label: 'Refactor', prompt: 'prompt.refactor' },
]

const MODE_OPTIONS: { value: AiPermissionMode; label: string; icon: string }[] = [
  { value: 'plan', label: 'Plan', icon: '📋' },
  { value: 'acceptEdits', label: 'Edit', icon: '✏️' },
  { value: 'bypassPermissions', label: 'Bypass', icon: '🔓' },
]

// ── ContextBar ──────────────────────────────────────────────────────
function ContextBar({ percent }: { percent: number | null }) {
  const pct = percent ?? 0
  const TOTAL = 10
  const filled = Math.round(pct / 100 * TOTAL)

  const colorClass =
    pct >= 80 ? 'bg-ide-danger'
    : pct >= 50 ? 'bg-ide-warning'
    : 'bg-ide-success'

  const textColor =
    pct >= 80 ? 'text-ide-danger'
    : pct >= 50 ? 'text-ide-warning'
    : 'text-ide-success'

  return (
    <div
      className="ai-tab__context-bar flex items-center gap-1.5 shrink-0"
      title={`${pct}% context used`}
    >
      {/* energy bar frame */}
      <div className="ai-tab__context-bar-frame flex gap-[2px] border-2 border-ide-border/80 rounded-md px-[3px] py-[3px]">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <div
            key={i}
            className={`ai-tab__context-bar-cell w-[5px] h-3 rounded-[2px] transition-all duration-500 ${
              i < filled ? `ai-tab__context-bar-cell--filled ${colorClass}` : 'bg-ide-border/25'
            }`}
          />
        ))}
      </div>
      <span className={`ai-tab__context-bar-pct text-[10px] font-mono leading-none tabular-nums ${textColor}`}>
        {pct}%
      </span>
    </div>
  )
}

// ── ModelBadge ──────────────────────────────────────────────────────
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku']

function ModelBadge({
  model,
  sessionId,
}: {
  model: string
  sessionId: string | null
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const prevModelRef = useRef(model)

  const displayModel = pendingModel || model

  const shortName = (() => {
    if (!displayModel) return ''
    return displayModel
  })()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); e.stopPropagation() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleSelect = useCallback((alias: string) => {
    if (!sessionId) return
    prevModelRef.current = model
    setPendingModel(alias)
    setOpen(false)
    window.api.ai.setModel(sessionId, alias)
  }, [sessionId, model])

  useEffect(() => {
    if (pendingModel && model && model !== prevModelRef.current) {
      setPendingModel(null)
    }
  }, [model, pendingModel])

  const currentAlias = MODEL_ALIASES.find(a => {
    if (!model) return false
    const resolved = model.toLowerCase()
    return resolved.includes(a) || resolved.includes({ opus: 'pro', sonnet: 'pro', haiku: 'flash' }[a] || '')
  })

  return (
    <div ref={ref} className="ai-tab__model relative shrink-0">
      <button
        type="button"
        onClick={() => sessionId && setOpen(v => !v)}
        className={`ai-tab__model-btn flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full
          transition-colors leading-tight
          ${sessionId
            ? 'bg-ide-border/30 text-ide-text-muted hover:bg-ide-hover hover:text-ide-text cursor-pointer'
            : 'bg-ide-border/15 text-ide-text-muted/40 cursor-default'
          }`}
        title={model || 'Model'}
        disabled={!sessionId}
      >
        <span className="truncate max-w-[160px]">{shortName || 'default'}</span>
        {sessionId && <ChevronDown size={10} className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <div className="ai-tab__model-dropdown absolute bottom-full right-0 mb-1.5 z-30
          bg-ide-sidebar border border-ide-border rounded-lg
          shadow-lg min-w-[110px] py-0.5 animate-fade-in">
          {MODEL_ALIASES.map(alias => {
            const isCurrent = !pendingModel && alias === currentAlias
            return (
              <button
                key={alias}
                type="button"
                onClick={() => handleSelect(alias)}
                className={`ai-tab__model-option w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                  isCurrent
                    ? 'ai-tab__model-option--selected bg-ide-accent/15 text-ide-accent'
                    : 'text-ide-text hover:bg-ide-hover'
                }`}
              >
                <span className="truncate">{alias}</span>
                {isCurrent && <Check size={10} className="ml-auto shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── ModeSelector ──────────────────────────────────────────────────────
function ModeSelector({
  value,
  onChange,
}: {
  value: AiPermissionMode
  onChange: (mode: AiPermissionMode) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = MODE_OPTIONS.find(o => o.value === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); e.stopPropagation() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div ref={ref} className="ai-tab__mode relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="ai-tab__mode-btn flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg
                   text-ide-text-muted hover:text-ide-text hover:bg-ide-hover
                   transition-colors"
        title={`${current?.label} mode`}
      >
        <span className="text-sm">{current?.icon}</span>
        <span className="max-w-[60px] truncate">{current?.label}</span>
        <ChevronDown size={12} className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="ai-tab__mode-dropdown absolute bottom-full right-0 mb-1.5 z-30
                        bg-ide-sidebar border border-ide-border rounded-lg
                        shadow-lg min-w-[130px] py-0.5 animate-fade-in">
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`ai-tab__mode-option w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                opt.value === value
                  ? 'ai-tab__mode-option--selected bg-ide-accent/15 text-ide-accent'
                  : 'text-ide-text hover:bg-ide-hover'
              }`}
            >
              <span className="text-xs shrink-0">{opt.icon}</span>
              <span className="truncate">{opt.label}</span>
              {opt.value === value && <Check size={10} className="ml-auto shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SlashCommandAutocomplete ──────────────────────────────────────

function SlashCommandAutocomplete({
  commands,
  filter,
  selectedIndex,
  onSelect,
  onClose,
}: {
  commands: AiSlashCommand[]
  filter: string
  selectedIndex: number
  onSelect: (cmd: AiSlashCommand) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const filtered = commands.filter(c => c.name.toLowerCase().startsWith(filter.toLowerCase()))
  if (filtered.length === 0) return null

  return (
    <div className="ai-tab__slash-menu absolute bottom-full left-0 right-0 mb-1 bg-ide-sidebar border border-ide-border rounded shadow-lg z-20 max-h-48 overflow-y-auto animate-fade-in">
      {filtered.map((cmd, i) => {
        const globalIndex = commands.filter(c => c.name.toLowerCase().startsWith(filter.toLowerCase())).indexOf(cmd)
        return (
          <button
            key={cmd.name}
            onClick={() => onSelect(cmd)}
            className={`ai-tab__slash-menu-item w-full flex items-center gap-2 px-2 py-1.5 text-[11px] transition-colors ${
              globalIndex === selectedIndex
                ? 'ai-tab__slash-menu-item--selected bg-ide-accent/15 text-ide-accent'
                : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
            }`}
          >
            <span className="ai-tab__slash-menu-cmd font-mono text-ide-accent shrink-0">/{cmd.name}</span>
            {cmd.argumentHint && <span className="text-ide-text-muted/50 text-[10px] shrink-0">{cmd.argumentHint}</span>}
            <span className="truncate">{cmd.description}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────

const BUSY_QUIPS = [
  'Forging the digital frontier…',
  'The empire, long divided, must unite…',
  'Defending the sacred source…',
  'Decrypting the matrix, one token at a time…',
  'Wrestling with the thought daemons…',
  'Aligning the cosmic bits…',
  'The bytes must flow…',
  'Resisting the centralized compiler…',
  'A bug in time saves nine…',
  'Long live the open-source rebellion…',
]

const AiTab = forwardRef<AiTabHandle, AiTabProps>(function AiTab({ activeSessionId, workspacePath, isActive, autoApprove, permissionMode, onPermissionModeChange, onViewAi, onRenameSession, onOpenFile, onForkSession, onAgentStatusChange, resumeSessionId }, ref) {
  const { t } = useI18n()
  const busyQuip = useMemo(() => BUSY_QUIPS[Math.floor(Math.random() * BUSY_QUIPS.length)], [])
  const containerRef = useRef<HTMLDivElement>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // AI session state — shared singleton store (进程级单例,消除 N 倍冗余)
  const state = useAiSession(activeSessionId)

  // Sync AI busy state to parent agentStatus (OR with terminal detection)
  useEffect(() => {
    if (!activeSessionId || !onAgentStatusChange) return
    onAgentStatusChange(activeSessionId, state.busy ? 'running' : 'idle')
  }, [activeSessionId, state.busy, onAgentStatusChange])

  // Auto-rename session from first user message — store 只设 state.name,
  // 副作用(持久化 rename)在此触发。用 ref 持有 onRenameSession,避免
  // 内联 prop 引用变化导致 effect 频繁重跑(只在 name 真正变化时触发)。
  const onRenameSessionRef = useRef(onRenameSession)
  onRenameSessionRef.current = onRenameSession
  useEffect(() => {
    if (!activeSessionId || !state.name) return
    onRenameSessionRef.current?.(state.name)
  }, [activeSessionId, state.name])

  // Session history
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false)
  const [sessionHistoryList, setSessionHistoryList] = useState<any[]>([])
  const [viewMode, setViewMode] = useState(0) // 0=all, 1=hide tools, 2=hide tools+think
  const historyRef = useRef<HTMLDivElement>(null)

  // Close session history on outside click + Escape
  useEffect(() => {
    if (!sessionHistoryOpen) return
    const handleClick = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setSessionHistoryOpen(false)
        setSessionHistoryList([])
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSessionHistoryOpen(false)
        setSessionHistoryList([])
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [sessionHistoryOpen])

  // Input
  // Per-session draft keyed by sessionId — survives session switching.
  // Uses activeSessionIdRef so setInputValue identity stays stable across sessionId
  // changes (matters for memoized child components consuming the setter).
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const inputValue = activeSessionId ? (inputValues[activeSessionId] || '') : ''
  const setInputValue = useCallback((v: string) => {
    const sid = activeSessionIdRef.current
    if (!sid) return
    setInputValues(prev => ({ ...prev, [sid]: v }))
  }, [])
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => { inputRef.current?.focus({ preventScroll: true }) },
    setValue: (text: string) => { setInputValue(text) },
  }), [setInputValue])

  // ── Update session state helper(委托给单例 store)──
  const updateSession = useCallback((sessionId: string, updater: (s: AiSessionState) => AiSessionState) => {
    aiStore.updateSession(sessionId, updater)
  }, [])

  // ── IPC listeners(sessionStates / onMessage / onStreamToken / onPermission /
  // onReady / onError)已上提到 aiStore 单例,此处不再重复注册。──

  // ── Session lifecycle: check availability then auto-create AI session ──
  useEffect(() => {
    if (!activeSessionId || !workspacePath) return
    const cliCommand = (() => {
      try { return localStorage.getItem('vibe-ide-ai-cli-command') || undefined } catch { return undefined }
    })()
    aiStore.ensureCreated(activeSessionId, {
      cwd: workspacePath,
      autoApprove,
      permissionMode,
      ...(resumeSessionId ? { resumeSessionId } : {}),
      cliCommand,
    })
  }, [activeSessionId, workspacePath]) // intentionally omit autoApprove to not re-create

  // ── Cleanup destroyed sessions ──
  const handleDestroySession = useCallback((sessionId: string) => {
    window.api.ai.destroy(sessionId)
    aiStore.clearSession(sessionId)
  }, [])

  // ── Smart auto-scroll: passive listener + threshold ──
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledUpRef.current = distFromBottom > 40
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [state.messages.length, state.streamBuffer])

  // ── Focus input when tab becomes active ──
  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus({ preventScroll: true })
    }
  }, [isActive])

  // ── Send handler ──
  const handleSend = useCallback(async () => {
    if (!activeSessionId || !inputValue.trim() || state.busy) return
    const message = inputValue.trim()
    setInputValue('')
    updateSession(activeSessionId, (s) => {
      const newName = !s.name ? message.slice(0, 60) : s.name
      return {
        ...s, busy: true, name: newName,
        messages: [...s.messages, {
          sessionId: activeSessionId, type: 'user' as const, role: 'user' as const,
          content: message, timestamp: Date.now(),
        }],
      }
    })
    await window.api.ai.send(activeSessionId, message)
  }, [activeSessionId, inputValue, state.busy, updateSession])

  // ── Send direct (for example prompts) ──
  const sendDirect = useCallback(async (text: string) => {
    if (!activeSessionId || state.busy) return
    updateSession(activeSessionId, (s) => {
      const newName = !s.name ? text.slice(0, 60) : s.name
      return {
        ...s, busy: true, name: newName,
        messages: [...s.messages, {
          sessionId: activeSessionId, type: 'user' as const, role: 'user' as const,
          content: text, timestamp: Date.now(),
        }],
      }
    })
    await window.api.ai.send(activeSessionId, text)
  }, [activeSessionId, state.busy, updateSession])

  // ── ExitPlanMode "Clear & Execute": kill plan-mode subprocess, respawn in acceptEdits,
  // re-inject plan from disk as first message. onDeny 委托 aiStore.handlePlanDeny;
  // onClearExecute 需切 UI permission mode 故留组件内(被调先于主调)。
  const handlePlanClearExecute = useCallback(async (sessionId: string, planFilePath: string) => {
    if (!planFilePath) return
    // Preserve messages/model/slashCommands/contextPercent — main side /clear is intentional
    // (drops plan-mode accumulated tokens), but renderer UI history should remain visible.
    updateSession(sessionId, (s) => ({
      ...s,
      pendingPermission: null,
      streaming: false,
      streamBuffer: '',
      thinkingBuffer: '',
      thinkingStartedAt: null,
      busy: true,
      ready: false,
    }))
    // Switch UI mode to acceptEdits — the new subprocess spawns with acceptEdits, so the
    // ModeSelector must reflect reality. Without this, UI still shows "Plan" after execution.
    onPermissionModeChange('acceptEdits')
    await window.api.ai.clearAndExecutePlan(sessionId, planFilePath)
  }, [updateSession, onPermissionModeChange])

  // ── Revert / Fork handlers ──────────────────────────────────────

  const handleRevert = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !workspacePath) return

    // 1. Optimistic: truncate renderer messages before the target
    const targetMsgIdx = findMessageIndexForUserMessage(state.messages, userMessageIndex)
    const truncatedMessages = targetMsgIdx >= 0 ? state.messages.slice(0, targetMsgIdx) : []

    // 2. Restore the reverted message to the input for re-editing
    if (targetMsgIdx >= 0 && state.messages[targetMsgIdx]?.content) {
      setInputValue(state.messages[targetMsgIdx].content!)
    }

    // 3. Update renderer state — truncate messages, keep input enabled
    updateSession(activeSessionId, (s) => ({
      ...s,
      messages: truncatedMessages,
      busy: false,
      streaming: false, streamBuffer: '', thinkingBuffer: '', thinkingStartedAt: null,
      pendingPermission: null,
    }))

    // 4. IPC: truncate JSONL, kill old CLI, spawn new with --resume
    await window.api.ai.revert({
      sessionId: activeSessionId,
      userMessageIndex,
      scope: 'conversation',
      cwd: workspacePath,
    })
  }, [activeSessionId, workspacePath, state.messages, updateSession, setInputValue])

  const handleRevertAndCode = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !workspacePath) return

    // 1. Revert all unstaged file changes
    try {
      const status = await window.api.git.status()
      if (status?.files) {
        for (const f of status.files) {
          if (f.staged) continue
          if (f.status === 'modified' || f.status === 'deleted') {
            await window.api.git.discard(f.path)
          } else if (f.status === 'untracked' || f.status === '?') {
            await window.api.file.delete(f.path)
          }
        }
      }
    } catch (err) { console.error('git discard failed:', err) }

    // 2. Same as handleRevert
    await handleRevert(userMessageIndex)
  }, [handleRevert, workspacePath])

  const handleFork = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !onForkSession) return
    onForkSession(userMessageIndex)
  }, [activeSessionId, onForkSession])

  // ── Todo list ──
  const todoItems = useMemo(() => deriveTodoList(state.messages), [state.messages])

  // ── Status text ──
  const statusText = !state.ready
    ? t('Connecting...')
    : state.streaming
      ? t('Streaming...')
      : null

  // ── Copy entire conversation ──
  const handleCopyConversation = useCallback(() => {
    const text = state.messages
      .filter(m => m.role && m.content)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}`)
      .join('\n\n---\n\n')
    if (text) navigator.clipboard.writeText(text)
  }, [state.messages])

  return (
    <div ref={containerRef} tabIndex={-1} className="ai-tab flex-1 flex flex-col overflow-hidden outline-none focus:outline-none focus:ring-0">
      {/* Header */}
      <div className="ai-tab__header flex items-center justify-between px-2 py-1 border-b border-ide-border shrink-0 acrylic-titlebar-clean">
        <div className="ai-tab__header-left flex items-center gap-1.5 min-w-0">
            <svg height="1em" style={{ flex: 'none', lineHeight: 1 }} viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fillRule="nonzero"></path>
            </svg>
            <span className="ai-tab__session-name text-xs font-medium text-ide-text truncate">{state.name || 'untitled'}</span>
          </div>
        <div className="ai-tab__header-actions flex items-center gap-1">
          {/* Copy conversation */}
          <button
            onClick={handleCopyConversation}
            className="ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
            title={t('Copy Conversation')}
          >
            <Copy size={14} />
          </button>
          {/* Toggle tool visibility */}
          <button
            onClick={() => setViewMode(v => (v + 1) % 3)}
            className={`ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors ${viewMode === 2 ? 'ai-tab__header-btn--active bg-ide-active' : ''}`}
            title={viewMode === 0 ? t('Show All') : viewMode === 1 ? t('Hide Tools') : t('Hide Tools & Think')}
          >
            {viewMode === 0 ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          {/* Session history */}
          <button
            onClick={async () => {
              const result = await window.api.ai.listSessions(workspacePath || undefined)
              if (result.sessions?.length > 0) {
                setSessionHistoryList(result.sessions)
                setSessionHistoryOpen(true)
              }
            }}
            className="ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
            title={t('Session History')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          {/* New session */}
          <button
            onClick={() => {
              if (!activeSessionId || !workspacePath) return
              handleDestroySession(activeSessionId)
              const cliCommand = (() => {
                try { return localStorage.getItem('vibe-ide-ai-cli-command') || undefined } catch { return undefined }
              })()
              aiStore.ensureCreated(activeSessionId, {
                cwd: workspacePath,
                autoApprove,
                permissionMode,
                cliCommand,
              })
              onViewAi()
            }}
            className="ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
            title={t('New Session')}
          >
            <MessageSquarePlus size={14} />
          </button>
        </div>
      </div>
      {/* Session history dropdown */}
      {sessionHistoryOpen && sessionHistoryList.length > 0 && (
        <div ref={historyRef} className="ai-tab__history-dropdown absolute top-8 right-2 bg-ide-sidebar border border-ide-border rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto w-56 animate-fade-in">
          {sessionHistoryList.map((s: any) => {
            const timeStr = s.timestamp ? new Date(s.timestamp).toLocaleString() : ''
            return (
              <button
                key={s.session_id || s.id}
                onClick={async () => {
                  if (activeSessionId) {
                    // Load conversation history from .jsonl before resuming
                    const history = await window.api.ai.loadSessionMessages(s.session_id || s.id, workspacePath || '')
                    const sessionName = s.name && s.name !== s.session_id ? s.name : ''
                    updateSession(activeSessionId, () => ({
                      ...EMPTY_SESSION,
                      messages: history.messages,
                      model: history.model || '',
                      slashCommands: enrichSlashCommands(history.slashCommands || []),
                      name: sessionName,
                      ready: false,
                    }))
                    await window.api.ai.destroy(activeSessionId)
                    const cliCommand = (() => {
                      try { return localStorage.getItem('vibe-ide-ai-cli-command') || undefined } catch { return undefined }
                    })()
                    window.api.ai.create({
                      sessionId: activeSessionId,
                      cwd: workspacePath || '',
                      autoApprove,
                      permissionMode,
                      resumeSessionId: s.session_id || s.id,
                      ...(cliCommand ? { cliCommand } : {}),
                    })
                  }
                  setSessionHistoryOpen(false)
                  setSessionHistoryList([])
                }}
                className="ai-tab__history-item w-full px-2 py-1.5 text-[11px] text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors text-left"
              >
                <div className="ai-tab__history-item-name truncate">{s.name || s.session_id || s.id}</div>
                {timeStr && <div className="ai-tab__history-item-time text-[9px] text-ide-text-muted/50 mt-0.5">{timeStr}</div>}
              </button>
            )
          })}
        </div>
      )}
      {/* Messages */}
      <div ref={scrollContainerRef} className="ai-tab__messages flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
        {state.messages.length === 0 && !state.streaming && (
          <div className="ai-tab__empty flex flex-col items-center justify-center text-ide-text-muted text-xs pt-8 space-y-3 animate-fade-in">
            <div className="ai-tab__empty-icon animate-zap-glow text-ide-accent">
              <svg
                fill="currentColor"
                fillRule="evenodd"
                height={64}
                width={64}
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  clipRule="evenodd"
                  d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
                />
              </svg>
            </div>
            <div className="ai-tab__empty-prompts flex flex-wrap justify-center gap-1.5 pt-2 max-w-[280px]">
              {EXAMPLE_PROMPTS.map((item, i) => (
                <button
                  key={i}
                  onClick={() => sendDirect(t(item.prompt))}
                  className="ai-tab__example-btn px-3 py-1.5 text-xs border border-ide-border rounded-full text-ide-text-muted hover:text-ide-text hover:bg-ide-hover hover:border-ide-accent/30 transition-colors"
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>
        )}
        {(() => {
          const userMessages = state.messages.filter(m => m.role === 'user' && m.content && m.type === 'user')
          const totalUserMessages = userMessages.length
          return state.messages.map((msg: AiMessage, i: number) => {
            const uIdx = msg.role === 'user' && msg.content && msg.type === 'user'
              ? userMessages.indexOf(msg)
              : -1
            return (
              <AiMessageBubble
                key={i}
                message={msg}
                msgIndex={i}
                allMessages={state.messages}
                workspacePath={workspacePath}
                onOpenFile={onOpenFile}
                userMessageIndex={uIdx}
                totalUserMessages={totalUserMessages}
                isBusy={state.busy}
                onRevert={handleRevert}
                onRevertAndCode={handleRevertAndCode}
                onFork={handleFork}
                viewMode={viewMode}
              />
            )
          })
        })()}
        {/* Busy indicator — thinking + streaming + sparkle */}
        {state.busy && (
          <div className="ai-tab__busy max-w-[92%] space-y-1.5 animate-fade-in">
            {state.thinkingBuffer && <ThinkingBlock text={state.thinkingBuffer} defaultOpen />}
            {state.streamBuffer ? (
              <div>
                <StreamingMarkdown text={state.streamBuffer} workspacePath={workspacePath} onOpenFile={onOpenFile} />
                <span className="ai-tab__busy-sparkle animate-sparkle ml-0.5 text-sm leading-none align-middle select-none">✻</span>
                <span className="ai-tab__busy-quip ml-0.5 text-xs leading-none align-middle select-none text-ide-accent/60">{busyQuip}</span>
              </div>
            ) : (
              <div>
                <span className="animate-sparkle text-sm leading-none select-none">✻</span>
                <span className="ml-0.5 text-xs leading-none select-none text-ide-accent/60">{busyQuip}</span>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Permission popup — floats above input, not inside scroll area */}
      {state.pendingPermission && activeSessionId && (
        state.pendingPermission.tool === 'AskUserQuestion' ? (
          <AiAskQuestionCard
            perm={state.pendingPermission}
            sessionId={activeSessionId}
            onRespond={aiStore.handleAskResume}
          />
        ) : state.pendingPermission.tool === 'ExitPlanMode' ? (
          <AiExitPlanModeCard
            perm={state.pendingPermission}
            sessionId={activeSessionId}
            onClearExecute={handlePlanClearExecute}
            onDeny={aiStore.handlePlanDeny}
            workspacePath={workspacePath}
            onOpenFile={onOpenFile}
          />
        ) : (
          <AiPermissionCard
            perm={state.pendingPermission}
            sessionId={activeSessionId}
            onRespond={aiStore.handlePermissionResponse}
          />
        )
      )}

      {/* Todo list — pins above input so it stays visible */}
      {todoItems.length > 0 && <TodoListPanel items={todoItems} />}

      {/* Input */}
      <div className="ai-tab__input-area shrink-0 p-2">
        <div className="relative">
          {slashMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-20">
              <SlashCommandAutocomplete
                commands={state.slashCommands.length > 0 ? state.slashCommands : enrichSlashCommands(Object.keys(SLASH_COMMAND_DESCRIPTIONS))}
                filter={slashFilter}
                selectedIndex={slashSelectedIndex}
                onSelect={(cmd) => {
                  setInputValue(`/${cmd.name} `)
                  setSlashMenuOpen(false)
                  setSlashFilter('')
                  setSlashSelectedIndex(0)
                  inputRef.current?.focus({ preventScroll: true })
                }}
                onClose={() => {
                  setSlashMenuOpen(false)
                  setSlashFilter('')
                  setSlashSelectedIndex(0)
                }}
              />
            </div>
          )}

          {/* Pill container */}
          <div className="ai-tab__input-pill rounded-2xl border border-ide-accent/60
                          bg-ide-sidebar shadow-sm
                          transition-colors focus-within:border-ide-accent">

            {/* Textarea zone */}
            <div className="ai-tab__input-zone px-3 pt-2.5 pb-1.5">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => {
                  const val = e.target.value
                  setInputValue(val)
                  if (val.startsWith('/')) {
                    const filter = val.slice(1).split(' ')[0]
                    setSlashMenuOpen(true)
                    setSlashFilter(filter)
                    setSlashSelectedIndex(0)
                  } else {
                    setSlashMenuOpen(false)
                    setSlashFilter('')
                  }
                }}
                onKeyDown={(e) => {
                  if (slashMenuOpen) {
                    const activeCommands = state.slashCommands.length > 0 ? state.slashCommands : enrichSlashCommands(Object.keys(SLASH_COMMAND_DESCRIPTIONS))
                    const filtered = activeCommands.filter(c => c.name.toLowerCase().startsWith(slashFilter.toLowerCase()))
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSlashSelectedIndex(prev => (prev + 1) % filtered.length)
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSlashSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length)
                      return
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      if (filtered[slashSelectedIndex]) {
                        setInputValue(`/${filtered[slashSelectedIndex].name} `)
                      }
                      setSlashMenuOpen(false)
                      setSlashFilter('')
                      setSlashSelectedIndex(0)
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setSlashMenuOpen(false)
                      setSlashFilter('')
                      setSlashSelectedIndex(0)
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder={state.ready ? t('Type a message...') : t('Initializing...')}
                rows={2}
                disabled={!state.ready}
                onContextMenu={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const el = e.currentTarget as HTMLTextAreaElement
                  el.focus()
                  if (document.execCommand('paste')) return
                  try {
                    const text = await navigator.clipboard.readText()
                    if (text) el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end')
                  } catch {}
                  el.dispatchEvent(new Event('input', { bubbles: true }))
                }}
                className="ai-tab__textarea w-full text-sm bg-transparent px-0 py-0.5 text-ide-text
                           placeholder:text-ide-text-muted/50 resize-none
                           focus:outline-none disabled:opacity-50 leading-relaxed text-sm"
              />
            </div>

            {/* Bottom toolbar */}
            <div className="ai-tab__input-toolbar flex items-center gap-2 px-2 py-1.5
                            border-t border-ide-border/30">
              {/* LEFT: Context bar + model badge */}
              <div className="ai-tab__toolbar-left flex items-center gap-2 shrink-0">
                <ContextBar percent={state.contextPercent} />
                <ModelBadge model={state.model} sessionId={activeSessionId} />
              </div>

              {/* CENTER: flex spacer */}
              <div className="flex-1" />

              {/* RIGHT: Mode selector + Send/Cancel */}
              <div className="ai-tab__toolbar-right flex items-center gap-1 shrink-0">
                <ModeSelector
                  value={permissionMode}
                  onChange={onPermissionModeChange}
                />

                {state.busy ? (
                  <button
                    type="button"
                    onClick={() => activeSessionId && window.api.ai.cancel(activeSessionId)}
                    className="ai-tab__stop-btn w-7 h-7 flex items-center justify-center rounded-lg
                               bg-ide-danger/20 hover:bg-ide-danger/30 text-ide-danger
                               transition-colors"
                    title={t('Cancel')}
                  >
                    <Square size={13} strokeWidth={2.5} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || !state.ready}
                    className="ai-tab__send-btn w-7 h-7 flex items-center justify-center rounded-lg
                               bg-ide-accent hover:bg-ide-accent-hover text-white
                               transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t('Send')}
                  >
                    <SquareArrowUp size={14} strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

export default AiTab
