import React, { useState, useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { AiMessage, AiToolUse, AiSessionState, AiPermissionRequest, AiPermissionMode, AiSlashCommand, RecentFileEntry, UserTurn } from '@shared/types'
import { AI_FILE_EDIT_TOOLS } from '@shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStableCodeOverrides } from '../MarkdownCodeBlock'
import { useI18n } from '../../i18n'
import { FILE_PATH_REGEX, parseFilePath } from '../../utils/filePathUtils'
import { cleanMessageContent, formatConversationMarkdown } from '../../utils/aiConversationFormatter'
import { loadFilterRules } from '../FileTab'
import { getFileInfo, FILE_ICON_PATHS } from '../FileIcons'
import { aiStore, useAiSession, EMPTY_SESSION, enrichSlashCommands, SLASH_COMMAND_DESCRIPTIONS, readAiCliConfig } from '../../aiStore'
import { EXAMPLE_PROMPTS } from '../examplePrompts'
import { SquareArrowUp, Square, ChevronDown, ChevronUp, Check, HelpCircle, FileText, Undo2, MessageSquare, GitFork, MessageSquarePlus, Copy, Circle, Loader2, ListTodo, Eye, EyeOff, Plug, GitBranch, Folder, X } from 'lucide-react'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { useTheme } from '../../themes'
import { displayLabel, getShortcuts } from '../../shortcuts'
import { ToolIcon, AiToolCallCard, CollapsedToolsSummary, isMergeTool, isPureToolMessage } from './tools'
import { ChatMarkdown } from './markdown'
interface TodoItem {
  id: string
  subject: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  parentToolUseId?: string
}

export function deriveTodoList(messages: AiMessage[]): TodoItem[] {
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
export function findMessageIndexForUserMessage(messages: AiMessage[], userMessageIndex: number): number {
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

function AiUserMessage({ message, userMessageIndex, totalUserMessages, isBusy, onRevert, onRevertAndCode, onFork, isInternal }: {
  message: AiMessage
  userMessageIndex: number
  totalUserMessages: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
  isInternal?: boolean
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

  const cleanedContent = cleanMessageContent(message.content || '')
  if (!cleanedContent) return null

  return (
    <div className="ai-tab__message ai-tab__message--user flex justify-end animate-fade-in">
      <div className="ai-tab__message-wrap max-w-[85%] relative"
        onMouseEnter={() => { clearHideTimer(); setShowPopover(true) }}
        onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setShowPopover(false), 300) }}
      >
        <div className="ai-tab__user-bubble px-3 py-2 rounded-2xl bg-ide-accent/12 border-2 border-ide-accent/30 text-ide-text whitespace-pre-wrap">
          {cleanedContent}
        </div>

        {showPopover && userMessageIndex > 0 && !isInternal && !isBusy && (
          <div ref={popoverRef}
            className="ai-tab__user-popover absolute right-0 top-full mt-1 z-40
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

export function ThinkingBlock({ text, defaultOpen = false, durationMs, autoScroll }: { text: string; defaultOpen?: boolean; durationMs?: number; autoScroll?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const contentRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const label = durationMs != null
    ? `Thinking for ${(durationMs / 1000).toFixed(1)}s`
    : 'Thinking'

  useEffect(() => {
    if (!autoScroll) return
    const el = contentRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledUpRef.current = distFromBottom > 20
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [autoScroll])

  useEffect(() => {
    if (!autoScroll) return
    const el = contentRef.current
    if (!el || userScrolledUpRef.current) return
    el.scrollTop = el.scrollHeight
  }, [text, autoScroll])

  return (
    <div className="ai-tab__thinking max-w-full animate-fade-in">
      <button
        onClick={() => setOpen(v => !v)}
        className="ai-tab__thinking-toggle inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 border border-ide-accent/20 transition-colors"
      >
        <span className="shrink-0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0" aria-labelledby="lightBulbIconTitle">
          <title id="lightBulbIconTitle">Light Bulb</title>
          <path d="M16 12C15.3333333 12.6666667 15 14 15 16L15 17 9 17 9 16C9 14 8.66666667 12.6666667 8 12 5.6739597 9.6739597 5.41421356 6.10050506 7.75735931 3.75735931 10.1005051 1.41421356 13.8994949 1.41421356 16.2426407 3.75735931 18.5857864 6.10050506 18.4068484 9.59315157 16 12zM10 21L14 21"/>
        </svg></span>
        <span className="shrink-0 leading-none">{label}</span>
      </button>
      {open && (
        <div ref={contentRef} className="ai-tab__thinking-content mt-1 px-3 py-2 text-xs bg-ide-accent/5 border border-ide-accent/15 rounded space-y-1 max-h-64 overflow-y-auto">
          <pre className="ai-tab__thinking-text whitespace-pre-wrap break-words text-[13px] text-ide-text-muted">{cleanMessageContent(text)}</pre>
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

function CollapsibleAgentGroup({ messages, workspacePath, onOpenFile, viewMode }: {
  messages: AiMessage[]
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  viewMode?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const toolCount = messages.reduce((acc, m) => acc + (m.toolUse ? m.toolUse.length : 0), 0)
  return (
    <div className="ai-tab__agent-group border-l-[3px] border-ide-accent/40 pl-2 ml-2 space-y-1 animate-fade-in">
      <button
        onClick={() => setExpanded(v => !v)}
        className="ai-tab__agent-toggle inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 border border-ide-accent/20 transition-colors"
      >
        <span className="shrink-0"><ToolIcon category="agent" /></span>
        <span className="shrink-0 leading-none">Agent{(toolCount > 0) && ` (${toolCount} tools)`}</span>
        <ChevronDown size={10} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-1">
          {messages.map((msg, i) => (
            <AiMessageBubble
              key={i}
              message={msg}
              msgIndex={-1}
              allMessages={messages}
              workspacePath={workspacePath}
              onOpenFile={onOpenFile}
              userMessageIndex={-1}
              totalUserMessages={0}
              isBusy={false}
              onRevert={() => {}}
              onRevertAndCode={() => {}}
              onFork={() => {}}
              viewMode={viewMode}
            />
          ))}
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
  const showMeta = message.type === 'result' && (message.costUsd != null || message.numTurns != null || message.isAborted || message.durationMs != null)
  const showContent = message.type !== 'result'
  const hasContent = showContent && (message.content || message.thinking || (message.toolUse && message.toolUse.length > 0))

  const errorStatus = !message.isAborted && message.subtype === 'error_max_tokens'
    ? { label: t('Max tokens reached'), color: 'text-ide-warning' }
    : !message.isAborted && message.subtype === 'error_during_execution'
      ? { label: t('Execution failed'), color: 'text-ide-danger' }
      : null

  return (
    <div className="ai-tab__message ai-tab__message--assistant space-y-1 animate-fade-in">
      {errorStatus && (
        <div className={`ai-tab__status-pill text-[9px] font-medium px-1 ${errorStatus.color}`}>
          {errorStatus!.label}
        </div>
      )}
      {hasContent && (
        <div className="ai-tab__message-content max-w-[92%] space-y-1.5">
          {!hideThink && message.thinking && <ThinkingBlock text={message.thinking} durationMs={message.thinkingDurationMs} />}
          {message.content && <ChatMarkdown text={message.content} workspacePath={workspacePath} onOpenFile={onOpenFile} />}
          {!hideTools && message.toolUse && message.toolUse.length >= 2 && <CollapsedToolsSummary tools={message.toolUse} />}
          {!hideTools && message.toolUse && message.toolUse.length === 1 && (
            <AiToolCallCard key={message.toolUse[0].id} tool={message.toolUse[0]} />
          )}
        </div>
      )}
      {showMeta && (
        <div className="ai-tab__message-meta flex items-center gap-2 text-[11px] text-ide-text-muted/50 px-1 group/meta">
          <span className="inline-flex items-center gap-0.5">
            <span className="text-sm">✻</span>
            <span>Churned for {((message.durationMs || 0) / 1000).toFixed(1)}s</span>
            {message.isAborted && <span className="text-ide-text-muted/40"> · paused by user</span>}
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

export function TodoListPanel({ items }: { items: TodoItem[] }) {
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

const AiMessageBubble = React.memo(function AiMessageBubble({ message, workspacePath, onOpenFile, userMessageIndex, totalUserMessages, isBusy, onRevert, onRevertAndCode, onFork, msgIndex, allMessages, viewMode, isInternal }: {
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
  isInternal?: boolean
}) {
  let copyText: string | undefined
  if (message.type === 'result' && message.numTurns != null) {
    for (let j = msgIndex - 1; j >= 0; j--) {
      const prev = allMessages[j]
      if (prev.type === 'assistant' && prev.content) { copyText = prev.content; break }
      if (prev.type !== 'assistant') break
    }
  }
  let inner: React.ReactNode
  if (message.error) {
    inner = <AiErrorMessage message={message} />
  } else if (message.role === 'user') {
    inner = <AiUserMessage message={message} userMessageIndex={userMessageIndex} totalUserMessages={totalUserMessages} isBusy={isBusy} onRevert={onRevert} onRevertAndCode={onRevertAndCode} onFork={onFork} isInternal={isInternal} />
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

  return <>{inner}</>
})

export function MessageList({ messages, userTurns, viewMode, busy, workspacePath, onOpenFile, onRevert, onRevertAndCode, onFork }: {
  messages: AiMessage[]
  userTurns: UserTurn[]
  viewMode: number
  busy: boolean
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
}) {
  const userMessages = messages.filter(m => m.role === 'user' && m.content && m.type === 'user')
  const totalUserMessages = userMessages.length
  const groups: Array<
    | { type: 'agent'; messages: AiMessage[]; parentId: string; startIndex: number }
    | { type: 'msg'; message: AiMessage; index: number }
    | { type: 'readSummary'; tools: AiToolUse[]; firstToolId: string }
    | { type: 'toolCard'; tool: AiToolUse }
  > = []
  const hideTools = viewMode === 1 || viewMode === 2
  const readBuffer: AiToolUse[] = []
  let firstToolId = ''
  const flushReads = () => {
    if (readBuffer.length === 0) return
    if (hideTools) { readBuffer.length = 0; firstToolId = ''; return }
    if (readBuffer.length >= 2) {
      groups.push({ type: 'readSummary', tools: [...readBuffer], firstToolId })
    } else {
      groups.push({ type: 'toolCard', tool: readBuffer[0] })
    }
    readBuffer.length = 0
    firstToolId = ''
  }
  // Async sub-agents (and the main agent) interleave in the live stream, so consecutive-
  // same-parent grouping would split one agent into many fragments. Map each parentToolUseId
  // to a single agent group; all of that parent's messages collect into it at first-occurrence
  // position (right after the spawning Agent tool_use card), regardless of interleaving.
  const agentGroupByParent = new Map<string, { type: 'agent'; messages: AiMessage[]; parentId: string; startIndex: number }>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.parentToolUseId) {
      flushReads()
      let g = agentGroupByParent.get(msg.parentToolUseId)
      if (!g) {
        g = { type: 'agent', messages: [], parentId: msg.parentToolUseId, startIndex: i }
        agentGroupByParent.set(msg.parentToolUseId, g)
        groups.push(g)
      }
      g.messages.push(msg)
      continue
    }
    const isStreamingLast = i === messages.length - 1 && busy
    if (isPureToolMessage(msg) && !isStreamingLast) {
      for (const tool of msg.toolUse ?? []) {
        if (isMergeTool(tool.name)) {
          if (readBuffer.length === 0) firstToolId = tool.id
          readBuffer.push(tool)
        } else {
          flushReads()
          if (!hideTools) groups.push({ type: 'toolCard', tool })
        }
      }
    } else {
      flushReads()
      groups.push({ type: 'msg', message: msg, index: i })
    }
  }
  flushReads()

  return <>{groups.map((item) => {
    if (item.type === 'agent') {
      return <CollapsibleAgentGroup key={`agent-${item.startIndex}`} messages={item.messages} workspacePath={workspacePath} onOpenFile={onOpenFile} viewMode={viewMode} />
    }
    if (item.type === 'readSummary') {
      return <CollapsedToolsSummary key={`read-${item.firstToolId}`} tools={item.tools} />
    }
    if (item.type === 'toolCard') {
      return <AiToolCallCard key={`tool-${item.tool.id}`} tool={item.tool} />
    }
    const msg = item.message
    const uIdx = msg.role === 'user' && msg.content && msg.type === 'user'
      ? userMessages.indexOf(msg)
      : -1
    return (
      <AiMessageBubble
        key={item.index}
        message={msg}
        msgIndex={item.index}
        allMessages={messages}
        workspacePath={workspacePath}
        onOpenFile={onOpenFile}
        userMessageIndex={uIdx}
        totalUserMessages={totalUserMessages}
        isBusy={busy}
        onRevert={onRevert}
        onRevertAndCode={onRevertAndCode}
        onFork={onFork}
        viewMode={viewMode}
        isInternal={userTurns[uIdx]?.isInternal ?? false}
      />
    )
  })}</>
}
