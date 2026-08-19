import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { AiMessage, AiToolUse, UserTurn } from '@shared/types'
import { useI18n } from '../../i18n'
import { cleanMessageContent } from '../../utils/aiConversationFormatter'
import { ChevronDown, Check, Undo2, MessageSquare, GitFork, Copy, Circle, Loader2, ListTodo } from 'lucide-react'
import { ToolIcon, AiToolCallCard, CollapsedToolsSummary, isMergeTool, isPureToolMessage } from './tools'
import { ChatMarkdown } from './markdown'
interface TodoItem {
  id: string
  subject: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  parentToolUseId?: string
}

function extractTaskId(tool: AiToolUse): string {
  const content = tool.result?.content || ''
  if (!content) return ''
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed.id === 'string') return parsed.id
    if (parsed && typeof parsed.taskId === 'string') return parsed.taskId
  } catch { /* fall through */ }
  const m = content.match(/["']?id["']?\s*[:=]\s*["']?([^"'\s,}]+)/)
  return m ? m[1] : ''
}

export function deriveTodoList(messages: AiMessage[]): TodoItem[] {
  const tasks = new Map<string, TodoItem>()
  const createdOrder: string[] = []
  for (const msg of messages) {
    if (!msg.toolUse) continue
    for (const tool of msg.toolUse) {
      if (tool.name === 'TodoWrite') {
        const todos = (tool.input?.todos || []) as Array<{ content?: string; status?: string; activeForm?: string }>
        tasks.clear()
        todos.forEach((td, i) => {
          const status = td.status === 'completed' || td.status === 'in_progress' ? td.status : 'pending'
          tasks.set(`${tool.id}-${i}`, {
            id: `${tool.id}-${i}`,
            subject: td.content || td.activeForm || '',
            status,
            parentToolUseId: msg.parentToolUseId,
          })
        })
      } else if (tool.name === 'TaskCreate') {
        const realId = extractTaskId(tool)
        const id = realId || String(tasks.size + 1)
        tasks.set(id, {
          id,
          subject: tool.input?.subject || '',
          description: tool.input?.description,
          status: 'pending',
          parentToolUseId: msg.parentToolUseId,
        })
        if (realId) createdOrder.push(realId)
      } else if (tool.name === 'TaskUpdate') {
        const rawId = String(tool.input?.taskId ?? '')
        const newStatus = tool.input?.status as TodoItem['status'] | undefined
        const existing = tasks.get(rawId)
          ?? tasks.get(createdOrder[Number(rawId) - 1])
          ?? tasks.get(String(Number(rawId)))
        if (existing && newStatus) {
          existing.status = newStatus
        }
      }
    }
  }
  return [...tasks.values()].filter(t => t.status !== 'deleted')
}
// 真实用户输入：tool_result 回填消息也是 type:'user' 的 AiMessage（CLI 把工具结果写进
// user 行），但它们紧跟含 tool_use 的 assistant 之后，不得计入 userTurns/revert/fork 索引
function isRealUserInput(messages: AiMessage[], i: number): boolean {
  const m = messages[i]
  if (!m || m.role !== 'user' || m.type !== 'user' || !m.content) return false
  return !(i > 0 && messages[i - 1].type === 'assistant')
}

export function findMessageIndexForUserMessage(messages: AiMessage[], userMessageIndex: number): number {
  let count = 0
  for (let i = 0; i < messages.length; i++) {
    if (isRealUserInput(messages, i)) {
      if (count === userMessageIndex) return i
      count++
    }
  }
  return -1
}

// 该 content 在真实用户输入中、index 之前出现的次数 = index 处消息的 occurrence（0-based）
export function countContentOccurrencesBefore(messages: AiMessage[], index: number, content: string): number {
  let occurrence = 0
  for (let i = 0; i < index; i++) {
    if (isRealUserInput(messages, i) && messages[i].content === content) occurrence++
  }
  return occurrence
}

function AiUserMessage({ message, userMessageIndex, isBusy, onRevert, onRevertAndCode, isInternal }: {
  message: AiMessage
  userMessageIndex: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
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
    <div className="ai-tab__message ai-tab__message--user w-full max-w-[896px] mx-auto flex justify-end animate-fade-in">
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
          </div>
        )}
      </div>
    </div>
  )
}

export function ThinkingBlock({ text, defaultOpen = false, durationMs, autoScroll, autoFold }: { text: string; defaultOpen?: boolean; durationMs?: number; autoScroll?: boolean; autoFold?: boolean }) {
  // autoFold（live 接管 busy 区 thinking）：以展开态挂载无缝交接（零高度跳变）、匹配其底部滚动位、
  // 下一帧 rAF 平滑折叠、跳过 fade-in。故 autoFold 隐含 defaultOpen=true + autoScroll=true
  const [open, setOpen] = useState(autoFold || defaultOpen)
  const shouldAutoScroll = autoScroll || autoFold
  const contentRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const label = durationMs != null
    ? `Thinking for ${(durationMs / 1000).toFixed(1)}s`
    : 'Thinking'

  useEffect(() => {
    if (!shouldAutoScroll) return
    const el = contentRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledUpRef.current = distFromBottom > 20
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [shouldAutoScroll])

  useEffect(() => {
    if (!shouldAutoScroll) return
    const el = contentRef.current
    if (!el || userScrolledUpRef.current) return
    el.scrollTop = el.scrollHeight
  }, [text, shouldAutoScroll])

  // 下一帧 rAF 折叠：grid 1fr→0fr 200ms 过渡把瞬塌改为平滑收起，过渡期浏览器连续 clamp scrollTop 保持底部 pinned
  useEffect(() => {
    if (!autoFold) return
    const id = requestAnimationFrame(() => setOpen(false))
    return () => cancelAnimationFrame(id)
  }, [autoFold])

  return (
    <div className={`ai-tab__thinking max-w-full ${autoFold ? '' : 'animate-fade-in'}`}>
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
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden">
          <div ref={contentRef} className="ai-tab__thinking-content px-3 py-2 text-xs bg-ide-accent/5 border border-ide-accent/15 rounded space-y-1 max-h-64 overflow-y-auto">
            <pre className="ai-tab__thinking-text whitespace-pre-wrap break-words text-[13px] text-ide-text-muted">{cleanMessageContent(text)}</pre>
          </div>
        </div>
      </div>
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
    <div className="ai-tab__agent-group w-full max-w-[896px] mx-auto animate-fade-in">
      <div className="ml-2 pl-2 border-l-[3px] border-ide-accent/40 space-y-1">
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
    </div>
  )
}
function AiAssistantMessage({ message, workspacePath, onOpenFile, copyText, viewMode, onFork, forkIdx, isLive }: {
  message: AiMessage
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  copyText?: string
  viewMode?: number
  onFork: (idx: number) => void
  forkIdx: number
  isLive?: boolean
}) {
  const { t } = useI18n()
  // 实时生成完成的那条消息曾 isLive=true：完成瞬间 isLive 切 false 会让 root 追加 animate-fade-in
  // 重播 opacity 0→1 → 屏幕一闪。记录"曾经 live 过"，永跳过 fade-in（resume/历史消息 wasLive 始终 false，正常渐入）
  const wasLiveRef = useRef(false)
  if (isLive) wasLiveRef.current = true
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
    <div className={`ai-tab__message ai-tab__message--assistant flex flex-col items-center space-y-1 ${isLive || wasLiveRef.current ? '' : 'animate-fade-in'}`}>
      {errorStatus && (
        <div className={`ai-tab__status-pill w-full max-w-[896px] text-[9px] font-medium px-1 ${errorStatus.color}`}>
          {errorStatus!.label}
        </div>
      )}
      {hasContent && (
        <div className="ai-tab__message-content w-full max-w-[896px] space-y-1.5">
          {/* isLive = 当前正在流式生成的那条消息（提交时 busy）。autoFold 让它展开态挂载无缝交接 busy 区
              thinking、下一帧平滑收起；历史消息 isLive=false 折叠挂载。isLive 另让本消息 root 跳过 fade-in（接管不透明） */}
          {!hideThink && message.thinking && <ThinkingBlock text={message.thinking} durationMs={message.thinkingDurationMs} autoFold={isLive} />}
          {message.content && <ChatMarkdown text={message.content} workspacePath={workspacePath} onOpenFile={onOpenFile} />}
          {!hideTools && message.toolUse && message.toolUse.length >= 2 && <CollapsedToolsSummary tools={message.toolUse} />}
          {!hideTools && message.toolUse && message.toolUse.length === 1 && (
            <AiToolCallCard key={message.toolUse[0].id} tool={message.toolUse[0]} />
          )}
        </div>
      )}
      {showMeta && (
        <div className="ai-tab__message-meta w-full max-w-[896px] flex items-center gap-2 text-[11px] text-ide-text-muted/50 group/meta">
          <span className="inline-flex items-center gap-0.5">
            <span className="text-sm">✻</span>
            <span>Churned for {(() => { const sec = (message.durationMs || 0) / 1000; if (sec < 60) return `${sec.toFixed(1)}s`; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return `${m}m ${s}s`; })()}</span>
            {message.isAborted && <span className="text-ide-text-muted/40"> · paused by user</span>}
          </span>
          {copyText && <CopyButton text={copyText} />}
          {forkIdx >= 0 && (
            <button
              onClick={() => onFork(forkIdx)}
              className="shrink-0 opacity-0 group-hover/meta:opacity-100 transition-opacity hover:text-ide-accent"
              title={t('Fork to new session')}
            >
              <GitFork size={12} />
            </button>
          )}
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
    <div className="ai-tab__error w-full max-w-[896px] mx-auto px-3 py-2 rounded-2xl rounded-tl-md bg-ide-danger/10 border border-ide-danger/25 text-ide-danger text-xs animate-fade-in">
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
    <div className="ai-tab__todo-panel shrink-0 border-b border-ide-border/30 animate-fade-in w-full max-w-[928px] mx-auto">
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

const AiMessageBubble = React.memo(function AiMessageBubble({ message, workspacePath, onOpenFile, userMessageIndex, isBusy, onRevert, onRevertAndCode, onFork, msgIndex, allMessages, viewMode, isInternal }: {
  message: AiMessage
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  userMessageIndex: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
  msgIndex: number
  allMessages: AiMessage[]
  viewMode?: number
  isInternal?: boolean
}) {
  // isLive = 当前正在流式生成的那条消息（最后一条 + busy）。用于让它的 thinking 以展开态挂载无缝交接 busy 区、
  // 下一帧平滑折叠；并让本消息 root 跳过 fade-in（接管时不透明）。子 agent 走 CollapsibleAgentGroup 的 isBusy=false → 永远非 live
  const isLive = isBusy && msgIndex === allMessages.length - 1
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
    inner = <AiUserMessage message={message} userMessageIndex={userMessageIndex} isBusy={isBusy} onRevert={onRevert} onRevertAndCode={onRevertAndCode} isInternal={isInternal} />
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
    // fork 语义 = 保留到该 AI 回复正文结束：第 N 个主会话 result = 第 N 回合完成，
    // 其 forkIdx = 其之前真实用户输入数 - 1（截断点 = 该回合的 user 消息索引，
    // main 端会保留整个回合）
    let forkIdx = -1
    if (message.type === 'result' && !message.parentToolUseId) {
      let count = 0
      for (let j = 0; j < msgIndex; j++) {
        if (isRealUserInput(allMessages, j)) count++
      }
      forkIdx = count - 1
    }
    inner = <AiAssistantMessage message={message} workspacePath={workspacePath} onOpenFile={onOpenFile} copyText={copyText} viewMode={viewMode} onFork={onFork} forkIdx={forkIdx} isLive={isLive} />
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
  const userMessages = messages.filter((m, i) => isRealUserInput(messages, i))
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
    const uIdx = isRealUserInput(messages, item.index)
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
