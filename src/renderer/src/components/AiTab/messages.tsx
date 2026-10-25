import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { AiMessage, AiToolUse, UserTurn } from '@shared/types'
import { asToolArray } from '@shared/types'
import { useI18n } from '../../i18n'
import { cleanMessageContent } from '../../utils/aiConversationFormatter'
import { ChevronDown, ChevronRight, Check, Undo2, MessageSquare, GitBranch, Copy, Circle, Loader2, ListTodo } from 'lucide-react'
import { ToolIcon, AiToolCallCard, CompactToolSummary, isPureToolMessage } from './tools'
import { ChatMarkdown } from './markdown'
import { CONTENT_MAX_W, PANEL_MAX_W, MSG_GAP } from './layout'
import { ClaudeLogoIcon } from '../ClaudeLogoIcon'
import { PiLogoIcon } from '../PiLogoIcon'
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
        const todos = asToolArray<{ content?: string; status?: string; activeForm?: string }>(tool.input?.todos)
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
// resume 历史由主进程 turnByLine 打 isRealUserTurn 标记，跨轮无 result 分隔时启发式不可信，标记优先
export function isRealUserInput(messages: AiMessage[], i: number): boolean {
  const m = messages[i]
  if (!m || m.role !== 'user' || m.type !== 'user' || !m.content) return false
  if (m.isRealUserTurn === true) return true
  return !(i > 0 && messages[i - 1].type === 'assistant')
}

interface TurnStats {
  toolCount: number
  durationMs?: number
  // 回合耗时统一按“真实用户输入 → 最后一条主会话消息（result / 正文）时间戳”换算，
  // 历史会话没有 result.durationMs 也能得到同一口径
  startAt?: number
  endAt?: number
  aborted: boolean
  // 该回合是否存在被收进摘要行的过程内容（工具/thinking/非末段正文）
  hasProcess: boolean
  contentCount: number
  // 该回合有会渲染 meta 栏的 result 行：末条正文不再重复承载 copy/fork/时间
  metaResult?: boolean
}

// 回合结束后挂在用户气泡下方的摘要行：耗时/工具数，点击展开过程内容
function formatTurnSummary(s: TurnStats): string {
  const bits: string[] = []
  if (s.toolCount > 0) {
    bits.push(`Cooked for ${s.toolCount} tools`)
  } else if (s.durationMs != null) {
    const sec = s.durationMs / 1000
    bits.push(`Cooked for ${sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`}`)
  }
  if (s.aborted) bits.push('paused by user')
  return bits.join(' · ')
}

// 本轮开始时刻 = 最近一条真实用户输入的时间戳；busy 计时与回合结束后耗时共用这一口径
export function lastRealUserTurnStartAt(messages: AiMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserInput(messages, i)) return messages[i].timestamp ?? null
  }
  return null
}

// 真实用户轮清单：turnIdx 与 MessageList 的 data-user-turn 同域，跳转与 hover 弹窗导航共用一份派生口径
export function deriveUserTurns(messages: AiMessage[]): { turnIdx: number; content: string }[] {
  const turns: { turnIdx: number; content: string }[] = []
  messages.forEach((m, i) => {
    if (isRealUserInput(messages, i)) turns.push({ turnIdx: turns.length, content: m.content || '' })
  })
  return turns
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

function formatHourMin(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function AiUserMessage({ message, userMessageIndex, isBusy, onRevert, onRevertAndCode, isInternal, allowRevert = true, turnSummary, turnExpanded, turnExpandable, onToggleTurn }: {
  message: AiMessage
  userMessageIndex: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  isInternal?: boolean
  allowRevert?: boolean
  turnSummary?: string
  turnExpanded?: boolean
  turnExpandable?: boolean
  onToggleTurn?: () => void
}) {
  const { t } = useI18n()
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const revertBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showPopover) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target) || revertBtnRef.current?.contains(target)) return
      setShowPopover(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPopover])

  const cleanedContent = cleanMessageContent(message.content || '')
  if (!cleanedContent) return null
  const timeStr = message.timestamp ? formatHourMin(message.timestamp) : ''
  const showRevert = allowRevert && userMessageIndex >= 0 && !isInternal

  return (
    <div
      className={`ai-tab__message ai-tab__message--user w-full ${CONTENT_MAX_W} mx-auto flex flex-col items-end gap-1.5 animate-fade-in group/user`}
      {...(userMessageIndex >= 0 ? { 'data-user-turn': userMessageIndex } : undefined)}
    >
      <div className="ai-tab__message-wrap max-w-[85%] relative">
        <div className="ai-tab__user-bubble px-3 py-2 rounded-2xl bg-ide-accent/12 border-2 border-ide-accent/30 text-ide-text whitespace-pre-wrap">
          {cleanedContent}
        </div>

        {showPopover && showRevert && !isBusy && (
          <div ref={popoverRef}
            className="ai-tab__user-popover absolute right-0 top-[calc(100%+34px)] z-40
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
      <div className="ai-tab__user-actions flex w-full items-center justify-end gap-2.5 h-7 opacity-0 group-hover/user:opacity-100 transition-opacity">
        <span className="text-sm leading-none tabular-nums text-ide-text-muted/50 mr-1">{timeStr}</span>
        {showRevert && (
          <button
            ref={revertBtnRef}
            onClick={() => setShowPopover(v => !v)}
            disabled={isBusy}
            title={t('Revert')}
            className="w-7 h-7 flex items-center justify-center rounded-full text-ide-text-muted hover:bg-ide-hover hover:text-ide-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Undo2 size={14} />
          </button>
        )}
        <CopyButton text={cleanedContent} className="w-7 h-7 flex items-center justify-center rounded-full text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors" />
      </div>
      {turnSummary && (
        <div className="ai-tab__turn-summary-row w-full pb-1.5">
          <button
            type="button"
            onClick={turnExpandable ? onToggleTurn : undefined}
            className={`ai-tab__turn-summary flex items-center gap-1 text-sm leading-none text-ide-text-muted/50 transition-colors ${turnExpandable ? 'hover:text-ide-text' : 'cursor-default'}`}
          >
            <span className="shrink-0 -ml-px">✻</span>
            <span>{turnSummary}</span>
            {turnExpandable && <ChevronRight size={12} className={`shrink-0 transition-transform ${turnExpanded ? 'rotate-90' : ''}`} />}
          </button>
        </div>
      )}
    </div>
  )
}

// cleanMessageContent 是 6 趟 [\s\S]*? 正则 + 6 次字符串分配；thinking 正文几乎不含标签，
// 先用 indexOf 探一次 '<'（V8 SIMD 扫描，未命中即原文），命中才走完整清洗，语义完全一致
function stripCommandTags(text: string): string {
  return text.indexOf('<') < 0 ? text.trim() : cleanMessageContent(text)
}

// think 块完成后（文本停止增长）驻留 2s 再收起；用户手动点过则不再自动收起
const THINK_DWELL_MS = 2000

export function ThinkingBlock({ text, durationMs, openByDefault = false, autoCollapse = false, autoScroll = false, smoothStream = false }: {
  text: string
  durationMs?: number
  openByDefault?: boolean
  autoCollapse?: boolean
  autoScroll?: boolean
  smoothStream?: boolean
}) {
  const [open, setOpen] = useState(openByDefault)
  const userToggled = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const label = durationMs != null
    ? `Thinking for ${(durationMs / 1000).toFixed(1)}s`
    : 'Thinking'
  const shown = stripCommandTags(text)

  // 平滑流式：每次 flush 的增量段做一次柔和淡入。时长按段长自适应（flush 固定 200ms，段长∝模型速度）：
  // 慢速小段保持最多 600ms 的雾散梯度；段长 ≥72 字（约 360 字/s）时淡入不再晚于下一次落字，
  // 直接落字，避免逐段连闪。旧段 DOM 复用不重播。
  const SEG_KEEP = 24
  const SEG_REF = 24
  const SEG_DUR_MIN = 200
  const SEG_DUR_MAX = 600
  const segStreamRef = useRef<{ last: string; seq: number; segs: { id: number; start: number; end: number; dur: number }[] }>(
    { last: '', seq: 0, segs: [] })
  let segView: { segs: { id: number; text: string; dur: number }[] } | null = null
  if (smoothStream && shown) {
    const st = segStreamRef.current
    if (!st.segs.length || !shown.startsWith(st.last)) {
      st.segs = [{ id: st.seq++, start: 0, end: shown.length, dur: 0 }]
    } else if (shown.length > st.last.length) {
      const len = shown.length - st.last.length
      const rawDur = Math.round((SEG_REF * SEG_DUR_MAX) / len)
      st.segs.push({ id: st.seq++, start: st.last.length, end: shown.length,
        dur: rawDur <= SEG_DUR_MIN ? 0 : Math.min(SEG_DUR_MAX, rawDur) })
    }
    st.last = shown
    if (st.segs.length > SEG_KEEP) {
      const drop = st.segs.length - SEG_KEEP + 1
      // 最旧 drop 段并成一条并沿用首段 id → React 复用 DOM，已播完的淡入不会重播
      st.segs.splice(0, drop, { id: st.segs[0].id, start: st.segs[0].start, end: st.segs[drop - 1].end, dur: st.segs[0].dur })
    }
    segView = { segs: st.segs.map((s) => ({ id: s.id, text: shown.slice(s.start, s.end), dur: s.dur })) }
  }

  // 依赖 text：块的内容还在增长时不断重置计时，真正停笔 2s 后才收起
  useEffect(() => {
    if (!autoCollapse || !open || userToggled.current) return
    const id = setTimeout(() => {
      if (!userToggled.current) setOpen(false)
    }, THINK_DWELL_MS)
    return () => clearTimeout(id)
  }, [text, autoCollapse, open])

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

  // 清洗后为空（纯空白/纯标签，如 buffer 只累计了换行、历史恢复的标签态 thinking）→ 整块不渲染
  if (!shown) return null

  return (
    <div className="ai-tab__thinking max-w-full">
      <button
        onClick={() => { userToggled.current = true; setOpen(v => !v) }}
        className="ai-tab__thinking-toggle flex w-fit items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 ring-1 ring-inset ring-ide-accent/20 transition-colors"
      >
        <span className="shrink-0 flex items-center justify-center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 block" aria-labelledby="thinkIconTitle">
          <title id="thinkIconTitle">Thinking</title>
          <path d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
        </svg></span>
        <span className="shrink-0 leading-none">{label}</span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden">
          <div ref={contentRef} className="ai-tab__thinking-content mt-1.5 px-3 py-2 text-xs bg-ide-accent/5 border border-ide-accent/15 rounded space-y-1 max-h-64 overflow-y-auto">
            {segView ? (
              <pre className="ai-tab__thinking-text whitespace-pre-wrap break-words text-[13px] text-ide-text-muted">
                {segView.segs.map((s) => (
                  <span key={s.id} className={s.dur > 0 ? 'ai-tab__think-seg' : undefined}
                    style={s.dur > 0 ? { animationDuration: `${s.dur}ms` } : undefined}>{s.text}</span>
                ))}
              </pre>
            ) : (
              <pre className="ai-tab__thinking-text whitespace-pre-wrap break-words text-[13px] text-ide-text-muted">{shown}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const BUSY_QUIPS = [
  'Forging the digital frontier…',
  'The empire, long divided, must unite…',
  'Decrypting the matrix, one token at a time…',
  'Wrestling with the thought daemons…',
  'Aligning the cosmic bits…',
  'The bytes must flow…',
  'Resisting the centralized compiler…',
  'A bug in time saves nine…',
  'Consulting the rubber duck oracle…',
  'Bribing the garbage collector…',
]

// busy 期间固定在输入框上方的状态行：替代原先挂在用户气泡上的 cooked 摘要
export function BusyStatus({ startAt, backend, tool }: {
  startAt: number
  backend?: 'claude' | 'pi'
  tool?: { name: string; elapsed: number } | null
}) {
  const [sec, setSec] = useState(() => Math.max(0, Math.floor((Date.now() - startAt) / 1000)))
  useEffect(() => {
    setSec(Math.max(0, Math.floor((Date.now() - startAt) / 1000)))
    const id = setInterval(() => setSec(Math.max(0, Math.floor((Date.now() - startAt) / 1000))), 1000)
    return () => clearInterval(id)
  }, [startAt])
  const timeLabel = sec >= 10
    ? sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`
    : ''
  const quip = useMemo(() => BUSY_QUIPS[Math.floor(Math.random() * BUSY_QUIPS.length)], [])
  const label = quip + (timeLabel ? ` (${timeLabel})` : '')
  return (
    <div className="ai-tab__busy-status flex items-center gap-1.5 px-1 pb-1 text-[13px] leading-none select-none">
      {backend === 'pi'
        ? <PiLogoIcon className="shrink-0 animate-spin-pixel text-sm leading-none select-none" />
        : <ClaudeLogoIcon className="shrink-0 animate-spin-pixel text-sm leading-none select-none" fill="currentColor" />}
      <span className="text-ide-accent/60">{label}</span>
      {tool && <span className="font-mono text-[11px] text-ide-text-muted/40">· {tool.name} {Math.round(tool.elapsed)}s</span>}
    </div>
  )
}

function CopyButton({ text, className = 'hover:text-ide-accent' }: { text: string; className?: string }) {
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
      className={`shrink-0 ${className}`}
      title="Copy"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

function CollapsibleAgentGroup({ messages, workspacePath, onOpenFile, thinkingMode }: {
  messages: AiMessage[]
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number, mode?: 'diff' | 'edit') => void
  thinkingMode: 'recent' | 'collapsed'
}) {
  const [expanded, setExpanded] = useState(false)
  const toolCount = messages.reduce((acc, m) => acc + (m.toolUse ? m.toolUse.length : 0), 0)
  return (
    <div className={`ai-tab__agent-group w-full ${CONTENT_MAX_W} mx-auto animate-fade-in`}>
      <div className={`ml-2 pl-2 border-l-[3px] border-ide-accent/40 ${MSG_GAP}`}>
        <button
          onClick={() => setExpanded(v => !v)}
          className="ai-tab__agent-toggle flex w-fit items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 border border-ide-accent/20 transition-colors"
        >
          <span className="shrink-0"><ToolIcon category="agent" /></span>
          <span className="shrink-0 leading-none">Agent{(toolCount > 0) && ` (${toolCount} tools)`}</span>
          <ChevronDown size={10} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && (
          <div className={MSG_GAP}>
            {messages.map((msg, i) => (
              <AiMessageBubble
                key={i}
                message={msg}
                workspacePath={workspacePath}
                onOpenFile={onOpenFile}
                userMessageIndex={-1}
                isBusy={false}
                onRevert={() => {}}
                onRevertAndCode={() => {}}
                onFork={() => {}}
                thinkingMode={thinkingMode}
                copyText={undefined}
                forkIdx={-1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
function AiAssistantMessage({ message, workspacePath, onOpenFile, copyText, forkIdx, onFork, contentOnly, thinkingMode }: {
  message: AiMessage
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number, mode?: 'diff' | 'edit') => void
  copyText?: string
  forkIdx: number
  onFork: (idx: number) => void
  contentOnly?: boolean
  thinkingMode?: 'recent' | 'collapsed'
}) {
  const { t } = useI18n()
  // result 行只有 CLI 汇总字段；历史会话的回合末条 assistant（无 result）只承载按钮，无耗时
  const showMeta = message.type === 'result'
    ? (message.costUsd != null || message.numTurns != null || message.isAborted || message.durationMs != null)
    : forkIdx >= 0 || copyText != null
  const showContent = message.type !== 'result'
  const hasContent = showContent && (message.content || message.thinking || (message.toolUse && message.toolUse.length > 0))
  // 只有刚提交的块才展开挂载；切会话/重挂时历史块保持收起，不会一次性全部弹开
  const recentThink = thinkingMode === 'recent'
    && Date.now() - (message.timestamp ?? 0) < THINK_DWELL_MS

  const errorStatus = !message.isAborted && message.subtype === 'error_max_tokens'
    ? { label: t('Max tokens reached'), color: 'text-ide-warning' }
    : !message.isAborted && message.subtype === 'error_during_execution'
      ? { label: t('Execution failed'), color: 'text-ide-danger' }
      : null

  return (
    <div className={`ai-tab__message ai-tab__message--assistant flex flex-col items-center ${MSG_GAP}`}>
      {errorStatus && (
        <div className={`ai-tab__status-pill w-full ${CONTENT_MAX_W} text-[9px] font-medium px-1 ${errorStatus.color}`}>
          {errorStatus!.label}
        </div>
      )}
      {hasContent && (
        <div className={`ai-tab__message-content w-full ${CONTENT_MAX_W} ${MSG_GAP}`}>
          {!contentOnly && message.thinking && (
            <ThinkingBlock
              text={message.thinking}
              durationMs={message.thinkingDurationMs}
              openByDefault={recentThink}
              autoCollapse={thinkingMode === 'recent'}
            />
          )}
          {message.content && (
            <ChatMarkdown text={message.content} workspacePath={workspacePath} onOpenFile={onOpenFile} />
          )}
          {!contentOnly && message.toolUse && message.toolUse.length > 0 && (
            message.toolUse.length === 1
              ? <AiToolCallCard key={message.toolUse[0].id} tool={message.toolUse[0]} workspacePath={workspacePath} onOpenFile={onOpenFile} />
              : <CompactToolSummary tools={message.toolUse} workspacePath={workspacePath} onOpenFile={onOpenFile} />
          )}
        </div>
      )}
      {showMeta && (
        // 耗时摘要挂在回合摘要行；此处 hover 时出 复制 + fork + 时间
        <div className={`ai-tab__message-meta group/meta flex w-full ${CONTENT_MAX_W} items-center h-7`}>
          <div className="flex items-center gap-2.5 opacity-0 group-hover/meta:opacity-100 pointer-events-none group-hover/meta:pointer-events-auto transition-opacity">
            {copyText && <CopyButton text={copyText} className="w-7 h-7 flex items-center justify-center rounded-full text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors" />}
            {forkIdx >= 0 && (
              <button
                onClick={() => onFork(forkIdx)}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
                title={t('Fork to new session')}
              >
                <GitBranch size={14} />
              </button>
            )}
            <span className="text-sm leading-none tabular-nums text-ide-text-muted/50">{message.timestamp ? formatHourMin(message.timestamp) : ''}</span>
          </div>
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
    <div className={`ai-tab__error w-full ${CONTENT_MAX_W} mx-auto px-3 py-2 rounded-2xl rounded-tl-md bg-ide-danger/10 border border-ide-danger/25 text-ide-danger text-xs animate-fade-in`}>
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
    <div className={`ai-tab__todo-panel shrink-0 border-b border-ide-border/30 animate-fade-in w-full ${PANEL_MAX_W} mx-auto`}>
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

const AiMessageBubble = React.memo(function AiMessageBubble({ message, workspacePath, onOpenFile, userMessageIndex, isBusy, onRevert, onRevertAndCode, onFork, isInternal, allowHistory = true, turnSummary, thinkingMode, contentOnly, copyText, forkIdx, turnExpandable, turnExpanded, turnIdx, onToggleTurn }: {
  message: AiMessage
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number, mode?: 'diff' | 'edit') => void
  userMessageIndex: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
  isInternal?: boolean
  allowHistory?: boolean
  turnSummary?: string
  thinkingMode?: 'recent' | 'collapsed'
  contentOnly?: boolean
  copyText?: string
  forkIdx?: number
  turnExpandable?: boolean
  turnExpanded?: boolean
  turnIdx?: number
  onToggleTurn?: (turnIdx: number) => void
}) {
  let inner: React.ReactNode
  if (message.error) {
    inner = <AiErrorMessage message={message} />
  } else if (message.role === 'user') {
    inner = <AiUserMessage message={message} userMessageIndex={userMessageIndex} isBusy={isBusy} onRevert={onRevert} onRevertAndCode={onRevertAndCode} isInternal={isInternal} allowRevert={allowHistory} turnSummary={turnSummary} turnExpandable={turnExpandable} turnExpanded={turnExpanded} onToggleTurn={turnIdx != null && turnIdx >= 0 && onToggleTurn ? () => onToggleTurn(turnIdx) : undefined} />
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
    inner = <AiAssistantMessage message={message} workspacePath={workspacePath} onOpenFile={onOpenFile} copyText={copyText} forkIdx={forkIdx ?? -1} onFork={onFork} contentOnly={contentOnly} thinkingMode={thinkingMode} />
  }

  return <>{inner}</>
})

// 回合视图：busy 时过程内容按时间顺序全部展开（think 块停笔 2s 后各自收起）；
// 回合结束后过程内容整体收进用户气泡下的 cooked 摘要行，点击可展开。
export const MessageList = React.memo(function MessageList({ messages, userTurns, busy, pendingPermission, workspacePath, onOpenFile, onRevert, onRevertAndCode, onFork, allowHistory = true }: {
  messages: AiMessage[]
  userTurns: UserTurn[]
  busy: boolean
  pendingPermission: boolean
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number, mode?: 'diff' | 'edit') => void
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
  allowHistory?: boolean
}) {
  // busy 不等于回合进行中（等权限批准时 aiStore.onPermission 会把 busy 置回 false），两者合一才是"回合未完"
  const turnOngoing = busy || pendingPermission
  const userMessages = messages.filter((m, i) => isRealUserInput(messages, i))

  // 回合归属：index → turn（真实用户输入序号）
  const turnOf: number[] = new Array(messages.length)
  const turnStats: TurnStats[] = []
  let curTurn = -1
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (isRealUserInput(messages, i)) {
      curTurn++
      turnStats.push({ toolCount: 0, aborted: false, hasProcess: false, contentCount: 0, startAt: m.timestamp })
    }
    turnOf[i] = curTurn
    const s = turnStats[curTurn]
    if (!s) continue
    // 主会话消息（排除子代理）的最后时间戳即回合结束时刻
    if (!m.parentToolUseId && m.timestamp != null) s.endAt = Math.max(s.endAt ?? 0, m.timestamp)
    if (m.toolUse?.length) {
      s.toolCount += m.toolUse.length
      s.hasProcess = true
    }
    if (m.thinking) s.hasProcess = true
    if (m.type === 'result') {
      if (m.durationMs != null) s.durationMs = m.durationMs
      if (m.isAborted) s.aborted = true
      if (!m.parentToolUseId && (m.costUsd != null || m.numTurns != null || m.isAborted === true || m.durationMs != null)) s.metaResult = true
    }
    // 回合内除最后一段正文外的正文都会被收进摘要行
    if (m.type === 'assistant' && !m.parentToolUseId && m.content && s.contentCount++ > 0) s.hasProcess = true
  }
  // 时间戳口径优先于 CLI 的 result.durationMs：历史会话没有 result 行也能显示耗时
  for (const s of turnStats) {
    if (s.startAt != null && s.endAt != null && s.endAt > s.startAt) s.durationMs = s.endAt - s.startAt
  }

  // 每个 index 之前的真实用户输入数（含当前）→ forkIdx = userCountBefore - 1
  const userCountBefore: number[] = new Array(messages.length)
  {
    let count = 0
    for (let i = 0; i < messages.length; i++) {
      if (isRealUserInput(messages, i)) count++
      userCountBefore[i] = count
    }
  }

  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(() => new Set())
  const toggleTurn = useCallback((t: number) => {
    setExpandedTurns(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }, [])

  const groups: Array<
    | { type: 'agent'; messages: AiMessage[]; parentId: string; startIndex: number }
    | { type: 'msg'; message: AiMessage; index: number }
    | { type: 'readSummary'; tools: AiToolUse[]; firstToolId: string; turnIdx: number; index: number }
    | { type: 'toolCard'; tool: AiToolUse; turnIdx: number; index: number }
  > = []
  const readBuffer: AiToolUse[] = []
  let firstToolId = ''
  let firstToolTurn = -1
  let firstToolIdx = -1
  const flushReads = () => {
    if (readBuffer.length === 0) return
    if (readBuffer.length === 1) {
      groups.push({ type: 'toolCard', tool: readBuffer[0], turnIdx: firstToolTurn, index: firstToolIdx })
    } else {
      groups.push({ type: 'readSummary', tools: [...readBuffer], firstToolId, turnIdx: firstToolTurn, index: firstToolIdx })
    }
    readBuffer.length = 0
    firstToolId = ''
    firstToolTurn = -1
    firstToolIdx = -1
  }
  // Async sub-agents (and the main agent) interleave in the live stream, so consecutive-
  // same-parent grouping would split one agent into many fragments. Map each parentToolUseId
  // to a single agent group; all of that parent's messages collect into it at first-occurrence
  // position (regardless of interleaving).
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
        if (readBuffer.length === 0) {
          firstToolId = tool.id
          firstToolTurn = turnOf[i]
          firstToolIdx = i
        }
        readBuffer.push(tool)
      }
    } else {
      flushReads()
      groups.push({ type: 'msg', message: msg, index: i })
    }
  }
  flushReads()

  // 每回合只留最后一段正文（即该回合的答案）；此前各段正文与工具一样收进摘要行
  const finalContentIdx = new Set<number>()
  let lastContent = -1
  for (let i = 0; i < messages.length; i++) {
    if (isRealUserInput(messages, i)) {
      if (lastContent >= 0) finalContentIdx.add(lastContent)
      lastContent = -1
      continue
    }
    const m = messages[i]
    if (m.type === 'assistant' && !m.parentToolUseId && m.content) lastContent = i
  }
  if (lastContent >= 0) finalContentIdx.add(lastContent)

  return <>{groups.map((item) => {
    const turnIdx = turnOf['index' in item ? item.index : item.startIndex]
    const ongoing = turnOngoing && turnIdx === turnStats.length - 1
    const expanded = expandedTurns.has(turnIdx)
    const showProcess = ongoing || expanded
    const thinkingMode: 'recent' | 'collapsed' = expanded ? 'collapsed' : 'recent'

    if (item.type === 'agent') {
      if (!showProcess) return null
      return <CollapsibleAgentGroup key={`agent-${item.startIndex}`} messages={item.messages} workspacePath={workspacePath} onOpenFile={onOpenFile} thinkingMode={thinkingMode} />
    }
    if (item.type === 'readSummary') {
      if (!showProcess) return null
      return <CompactToolSummary key={`read-${item.firstToolId}`} tools={item.tools} workspacePath={workspacePath} onOpenFile={onOpenFile} />
    }
    if (item.type === 'toolCard') {
      if (!showProcess) return null
      return <AiToolCallCard key={`tool-${item.tool.id}`} tool={item.tool} workspacePath={workspacePath} onOpenFile={onOpenFile} />
    }

    const msg = item.message
    const isFinal = finalContentIdx.has(item.index)
    const isUser = isRealUserInput(messages, item.index)
    const stats = turnStats[turnIdx]
    // 回合结束后，末条正文以外的过程内容全部收进摘要行；result / error 仍需渲染
    if (!isUser && !isFinal && !showProcess && msg.type !== 'result' && !msg.error) return null

    const uIdx = isUser ? userMessages.indexOf(msg) : -1
    let copyText: string | undefined
    let forkIdx = -1
    if (msg.type === 'result' && !msg.parentToolUseId) {
      for (let j = item.index - 1; j >= 0; j--) {
        const prev = messages[j]
        // 子代理消息与工具回填都夹在主 result 与主回复之间，属本回合内部噪音
        if (prev.parentToolUseId || prev.toolResult) continue
        if (prev.type === 'assistant' && prev.content) { copyText = prev.content; break }
        if (prev.type !== 'assistant') break
      }
      if (allowHistory) forkIdx = userCountBefore[item.index] - 1
    } else if (isFinal && !ongoing && msg.type === 'assistant' && !stats?.metaResult) {
      copyText = msg.content || undefined
      if (allowHistory) forkIdx = userCountBefore[item.index] - 1
    }

    return (
      <AiMessageBubble
        key={item.index}
        message={msg}
        workspacePath={workspacePath}
        onOpenFile={onOpenFile}
        userMessageIndex={uIdx}
        isBusy={busy}
        onRevert={onRevert}
        onRevertAndCode={onRevertAndCode}
        onFork={onFork}
        isInternal={userTurns[uIdx]?.isInternal ?? false}
        allowHistory={allowHistory}
        turnSummary={isUser && !ongoing && stats ? formatTurnSummary(stats) || undefined : undefined}
        thinkingMode={thinkingMode}
        contentOnly={isFinal && !showProcess}
        copyText={copyText}
        forkIdx={forkIdx}
        turnExpandable={isUser && !!stats?.hasProcess}
        turnExpanded={isUser && expanded}
        turnIdx={isUser ? turnIdx : undefined}
        onToggleTurn={toggleTurn}
      />
    )
  })}</>
})
