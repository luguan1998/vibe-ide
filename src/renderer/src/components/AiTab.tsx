import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { AiMessage, AiToolUse, AiSessionState, AiPermissionRequest, AiPermissionMode, AiSlashCommand } from '@shared/types'
import { AI_FILE_EDIT_TOOLS } from '@shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getMarkdownCodeOverrides } from './MarkdownCodeBlock'
import { useI18n } from '../i18n'
import { SquareArrowUp, Square, ChevronDown, Check } from 'lucide-react'

interface AiTabProps {
  activeSessionId: string | null
  workspacePath: string | null
  isActive: boolean
  autoApprove: boolean
  permissionMode: AiPermissionMode
  onPermissionModeChange: (mode: AiPermissionMode) => void
  onViewAi: () => void
  onRenameSession: (name: string) => void
  onOpenDiff: (fullPath: string, relativePath: string, oldContent?: string, newContent?: string) => void
}

const EMPTY_SESSION: AiSessionState = {
  ready: false, busy: false, messages: [],
  streaming: false, streamBuffer: '', thinkingBuffer: '', pendingPermission: null,
  slashCommands: [], model: '', contextPercent: null, name: '',
}

// ── Tool type classification ──────────────────────────────────────

const COMMAND_TOOLS = new Set(['Bash', 'bash', 'terminal', 'run_command', 'execute_command'])
const SEARCH_TOOLS = new Set(['Grep', 'grep', 'search', 'Glob', 'glob', 'find', 'ripgrep'])

function getToolCategory(name: string): 'file' | 'command' | 'search' | 'default' {
  if (AI_FILE_EDIT_TOOLS.has(name)) return 'file'
  if (COMMAND_TOOLS.has(name)) return 'command'
  if (SEARCH_TOOLS.has(name)) return 'search'
  return 'default'
}

// ── Sub-components (被调先于主调) ──────────────────────────────

function ChatMarkdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`md-preview text-xs ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownCodeOverrides()}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

// During streaming, only render markdown up to the last CLOSED code fence.
// Any open (incomplete) code block is shown as raw text to prevent CodeBlock
// from remounting + re-colorizing on every token (which causes flicker).
function StreamingMarkdown({ text, className = '' }: { text: string; className?: string }) {
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

  return (
    <div className={`md-preview text-xs ${className}`}>
      {safePart && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownCodeOverrides()}>
          {safePart}
        </ReactMarkdown>
      )}
      {rawPart && <pre className="whitespace-pre-wrap text-ide-text">{rawPart}</pre>}
    </div>
  )
}

function ToolIcon({ category }: { category: 'file' | 'command' | 'search' | 'default' }) {
  const cls = "w-3 h-3 shrink-0"
  if (category === 'file') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
  if (category === 'command') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
  if (category === 'search') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
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
    <div className="inline-block max-w-full animate-fade-in">
      <button
        onClick={() => setExpanded(v => !v)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
          isFileEdit ? 'bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25' : 'bg-ide-hover text-ide-text-muted hover:bg-ide-active'
        }`}
      >
        <span className="shrink-0"><ToolIcon category={category} /></span>
        <span className="shrink-0">{tool.name}</span>
        {detail && <span className="truncate max-w-[140px] opacity-60 text-[9px]">{detail}</span>}
        {hasResult && (
          <span className={`shrink-0 text-[9px] ${tool.result!.isError ? 'text-ide-danger' : 'text-ide-success'}`}>
            {tool.result!.isError ? '✗' : '✓'}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 px-2 py-1 text-[10px] font-mono bg-ide-bg border border-ide-border rounded space-y-1 max-h-48 overflow-y-auto">
          {hasResult && (
            <div className={tool.result!.isError ? 'text-ide-danger/80' : 'text-ide-text'}>
              <pre className="whitespace-pre-wrap break-words text-[9px]">{tool.result!.content}</pre>
            </div>
          )}
          <div className="text-ide-text-muted">
            <pre className="whitespace-pre-wrap break-words text-[9px]">{JSON.stringify(tool.input, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

function AiPermissionCard({ perm, sessionId, onRespond }: {
  perm: AiPermissionRequest
  sessionId: string
  onRespond: (sid: string, rid: string, approved: boolean, tool: string, toolInput?: Record<string, any>) => void
}) {
  const { t } = useI18n()
  return (
    <div className="shrink-0 border-t border-ide-warning/40 bg-ide-warning/5 px-2 py-2 animate-fade-in">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-warning shrink-0 mt-0.5">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium text-ide-warning">{t('AI wants permission to run:')}</div>
          <div className="mt-1 px-1.5 py-1 bg-ide-bg/80 rounded text-[10px] font-mono text-ide-text truncate">
            <span className="text-ide-accent">{perm.tool}</span>
            {perm.command && <span className="text-ide-text-muted"> → {perm.command}</span>}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5 mt-2 ml-6">
        <button
          onClick={() => onRespond(sessionId, perm.requestId, true, perm.tool, perm.toolInput)}
          className="px-3 py-1 text-[11px] font-medium bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
        >
          {t('Approve')}
        </button>
        <button
          onClick={() => onRespond(sessionId, perm.requestId, false, perm.tool, perm.toolInput)}
          className="px-3 py-1 text-[11px] font-medium border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
        >
          {t('Deny')}
        </button>
      </div>
    </div>
  )
}

function AiUserMessage({ message }: { message: AiMessage }) {
  return (
    <div className="flex justify-end animate-fade-in">
      <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-md bg-ide-accent/12 border border-ide-accent/25 text-ide-text text-xs whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  )
}

function ThinkingBlock({ text, defaultOpen = false }: { text: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="inline-block max-w-full animate-fade-in">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-ide-hover text-ide-text-muted hover:bg-ide-active transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0">
          <path d="M9 18h6M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
        </svg>
        <span className="shrink-0">Thinking</span>
      </button>
      {open && (
        <div className="mt-1 px-3 py-2 text-xs bg-ide-bg border border-ide-border rounded space-y-1 max-h-64 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-words text-[11px] text-ide-text-muted">{text}</pre>
        </div>
      )}
    </div>
  )
}

function AiAssistantMessage({ message }: { message: AiMessage }) {
  const showMeta = message.type === 'result' && (message.costUsd != null || message.numTurns != null)
  const showContent = message.type !== 'result'
  const hasContent = showContent && (message.content || message.thinking || (message.toolUse && message.toolUse.length > 0))
  return (
    <div className="space-y-1 animate-fade-in">
      {hasContent && (
        <div className="max-w-[92%] space-y-1.5">
          {message.thinking && <ThinkingBlock text={message.thinking} />}
          {message.content && <ChatMarkdown text={message.content} />}
          {message.toolUse?.map(tool => <AiToolCallCard key={tool.id} tool={tool} />)}
        </div>
      )}
      {showMeta && (
        <div className="text-[9px] text-ide-text-muted/50 px-1">
          {message.numTurns} turns · {(message.costUsd! * 100).toFixed(2)}¢ · {((message.durationMs || 0) / 1000).toFixed(1)}s
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
    <div className="px-3 py-2 rounded-2xl rounded-tl-md bg-ide-danger/10 border border-ide-danger/25 text-ide-danger text-xs animate-fade-in">
      {message.error}
      {message.installCmd && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <code className="px-1.5 py-0.5 bg-ide-bg/60 rounded text-[10px] font-mono text-ide-text-muted flex-1 truncate">
            {message.installCmd}
          </code>
          <button
            onClick={handleCopyCmd}
            className="shrink-0 px-1.5 py-0.5 text-[10px] border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
          >
            {copied ? '✓' : t('Copy')}
          </button>
        </div>
      )}
    </div>
  )
}

function AiMessageBubble({ message }: { message: AiMessage }) {
  if (message.error) return <AiErrorMessage message={message} />
  if (message.role === 'user') return <AiUserMessage message={message} />
  // 'result' duplicates the preceding 'assistant' text — only render if it carries cost/turn metadata
  if (message.type === 'result' && message.costUsd == null && message.numTurns == null) return null
  return <AiAssistantMessage message={message} />
}

// ── Merge tool_result into assistant message ─────────────────────

function mergeToolResultIntoMessages(
  messages: AiMessage[],
  toolUseId: string,
  result: { toolUseId: string; content: string; isError: boolean }
): AiMessage[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg.toolUse) continue
    const toolIndex = msg.toolUse.findIndex(t => t.id === toolUseId)
    if (toolIndex !== -1) {
      const updatedToolUse = [...msg.toolUse]
      updatedToolUse[toolIndex] = { ...updatedToolUse[toolIndex], result }
      const updatedMessages = [...messages]
      updatedMessages[i] = { ...msg, toolUse: updatedToolUse }
      return updatedMessages
    }
  }
  return null
}

// Find last tool_use in messages that has no result yet (for merging session-level errors)
function findPendingToolIndex(messages: AiMessage[]): { msgIdx: number; toolIdx: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg.toolUse) continue
    for (let j = msg.toolUse.length - 1; j >= 0; j--) {
      if (!msg.toolUse[j].result) {
        return { msgIdx: i, toolIdx: j }
      }
    }
  }
  return null
}

// ── Example prompts ──────────────────────────────────────────────

const EXAMPLE_PROMPTS: { label: string; prompt: string }[] = [
  { label: 'Explain this codebase', prompt: 'prompt.explain' },
  { label: 'Find potential bugs', prompt: 'prompt.bugs' },
  { label: 'Write tests', prompt: 'prompt.tests' },
  { label: 'Refactor', prompt: 'prompt.refactor' },
]

const MODE_OPTIONS: { value: AiPermissionMode; label: string; icon: string }[] = [
  { value: 'default', label: 'Default', icon: '🔒' },
  { value: 'plan', label: 'Plan', icon: '📋' },
  { value: 'acceptEdits', label: 'Edit', icon: '✏️' },
  { value: 'auto', label: 'Auto', icon: '⚡' },
  { value: 'dontAsk', label: 'Don\'t Ask', icon: '🚫' },
  { value: 'bypassPermissions', label: 'Bypass', icon: '🔓' },
]

// ── Slash command descriptions (fallback for commands without description) ──
const SLASH_COMMAND_DESCRIPTIONS: Record<string, { description: string; argumentHint?: string }> = {
  compact: { description: 'Compress conversation context', argumentHint: '[instructions]' },
  clear: { description: 'Clear conversation history', argumentHint: '[name]' },
  context: { description: 'View context usage', argumentHint: '[all]' },
  cost: { description: 'Show session cost and usage' },
  usage: { description: 'Show session cost and usage' },
  model: { description: 'Switch AI model', argumentHint: '[model]' },
  help: { description: 'Show available commands' },
  exit: { description: 'Exit the session' },
  init: { description: 'Initialize project CLAUDE.md' },
  status: { description: 'Show version, model, account info' },
  memory: { description: 'Edit CLAUDE.md memory file' },
  doctor: { description: 'Diagnose Claude Code installation' },
  permissions: { description: 'Manage tool permission rules' },
  config: { description: 'Open settings', argumentHint: '[key=value]' },
  review: { description: 'Review a pull request', argumentHint: '[PR]' },
  plan: { description: 'Enter plan mode', argumentHint: '[description]' },
}

function enrichSlashCommands(names: string[]): AiSlashCommand[] {
  return names.map(name => {
    const preset = SLASH_COMMAND_DESCRIPTIONS[name]
    return {
      name,
      description: preset?.description || name,
      argumentHint: preset?.argumentHint,
    }
  })
}

// ── ContextBar ──────────────────────────────────────────────────────
function ContextBar({ percent }: { percent: number | null }) {
  const pct = percent ?? 0
  const TOTAL_SEGMENTS = 5
  const filled = Math.round(pct / 100 * TOTAL_SEGMENTS)

  const colorClass =
    pct >= 80 ? 'bg-ide-danger'
    : pct >= 50 ? 'bg-ide-warning'
    : 'bg-ide-success'

  const textColorClass =
    pct >= 80 ? 'text-ide-danger'
    : pct >= 50 ? 'text-ide-warning'
    : 'text-ide-success'

  return (
    <div
      className="flex items-center gap-1.5 shrink-0 w-[70px]"
      title={`${pct}% context used`}
    >
      <div className="flex gap-[2px]">
        {Array.from({ length: TOTAL_SEGMENTS }).map((_, i) => (
          <div
            key={i}
            className={`w-[6px] h-3 rounded-[2px] transition-colors duration-300 ${i < filled ? colorClass : 'bg-ide-border/40'}`}
          />
        ))}
      </div>
      <span className={`text-xs font-mono leading-none ${textColorClass}`}>
        {pct}%
      </span>
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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg
                   text-ide-text-muted hover:text-ide-text hover:bg-ide-hover
                   transition-colors"
        title={`${current?.label} mode`}
      >
        <span className="text-sm">{current?.icon}</span>
        <span className="max-w-[60px] truncate">{current?.label}</span>
        <ChevronDown size={12} className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1.5 z-30
                        bg-ide-sidebar border border-ide-border rounded-lg
                        shadow-lg min-w-[130px] py-0.5 animate-fade-in">
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                opt.value === value
                  ? 'bg-ide-accent/15 text-ide-accent'
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
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-ide-sidebar border border-ide-border rounded shadow-lg z-20 max-h-48 overflow-y-auto animate-fade-in">
      {filtered.map((cmd, i) => {
        const globalIndex = commands.filter(c => c.name.toLowerCase().startsWith(filter.toLowerCase())).indexOf(cmd)
        return (
          <button
            key={cmd.name}
            onClick={() => onSelect(cmd)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-[11px] transition-colors ${
              globalIndex === selectedIndex
                ? 'bg-ide-accent/15 text-ide-accent'
                : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
            }`}
          >
            <span className="font-mono text-ide-accent shrink-0">/{cmd.name}</span>
            {cmd.argumentHint && <span className="text-ide-text-muted/50 text-[10px] shrink-0">{cmd.argumentHint}</span>}
            <span className="truncate">{cmd.description}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────

export default function AiTab({ activeSessionId, workspacePath, isActive, autoApprove, permissionMode, onPermissionModeChange, onViewAi, onRenameSession, onOpenDiff }: AiTabProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // Per-session AI state
  const [sessionStates, setSessionStates] = useState<Record<string, AiSessionState>>({})
  const state = activeSessionId ? (sessionStates[activeSessionId] || EMPTY_SESSION) : EMPTY_SESSION

  // Session history
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false)
  const [sessionHistoryList, setSessionHistoryList] = useState<any[]>([])
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
  const [inputValue, setInputValue] = useState('')
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const onOpenDiffRef = useRef(onOpenDiff)
  onOpenDiffRef.current = onOpenDiff

  // Track which sessions have been created to avoid double-init
  const createdSessionsRef = useRef<Set<string>>(new Set())

  // ── Update session state helper ──
  const updateSession = useCallback((sessionId: string, updater: (s: AiSessionState) => AiSessionState) => {
    setSessionStates(prev => ({
      ...prev,
      [sessionId]: updater(prev[sessionId] || { ...EMPTY_SESSION }),
    }))
  }, [])

  // ── IPC: AI messages ──
  useEffect(() => {
    const handleMsg = window.api.ai.onMessage((msg: any) => {
      if (!msg.sessionId) return
      updateSession(msg.sessionId, (s) => {
        const isAssistant = msg.type === 'assistant' && msg.role === 'assistant'

        // Determine what the stream buffers have that the incoming message doesn't.
        // Only flush unique content to avoid duplication (e.g. same thinking appearing
        // in both the stream buffer and the assistant message).
        const extraThinking = s.thinkingBuffer && s.thinkingBuffer !== msg.thinking
          ? s.thinkingBuffer : ''
        const extraText = s.streamBuffer && s.streamBuffer !== msg.content
          ? s.streamBuffer : ''
        const hasExtra = extraThinking || extraText

        // Flush on assistant (capture buffer content not in message) or
        // result (fallback for interrupted streaming).
        const flushedMsg = (hasExtra && s.streaming && (isAssistant || msg.type === 'result'))
          ? [{ sessionId: msg.sessionId, type: 'assistant' as const, role: 'assistant' as const,
              content: extraText || undefined,
              thinking: extraThinking || undefined,
              timestamp: Date.now() }]
          : []

        let messages: AiMessage[]
        if (msg.toolResult) {
          const merged = mergeToolResultIntoMessages(s.messages, msg.toolResult.toolUseId, msg.toolResult)
          messages = merged
            ? [...merged, ...flushedMsg]
            : [...s.messages, ...flushedMsg, msg]
        } else {
          messages = [...s.messages, ...flushedMsg, msg]
        }

        // Clear buffers: only the fields the incoming message already covers.
        // Keep thinking buffer if message has no thinking (preserves for next turn).
        const clearThinking = isAssistant && !!msg.thinking
        const clearText = isAssistant && !!msg.content

        // Auto-rename from first user message
        const isUserMsg = msg.type === 'user' && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()
        const newName = isUserMsg && !s.name ? msg.content.trim().slice(0, 60) : s.name
        if (isUserMsg && !s.name && newName) onRenameSession(newName)

        return {
          ...s,
          messages,
          name: newName,
          busy: msg.type !== 'result',
          streaming: msg.type === 'result' ? false : s.streaming,
          streamBuffer: clearText || msg.type === 'result' ? '' : s.streamBuffer,
          thinkingBuffer: clearThinking || msg.type === 'result' ? '' : s.thinkingBuffer,
          contextPercent: msg.contextPercent != null ? Math.round(msg.contextPercent) : s.contextPercent,
        }
      })
    })
    return () => window.api.ai.removeMessageListener(handleMsg)
  }, [updateSession])

  // ── IPC: Stream tokens ──
  useEffect(() => {
    const handleToken = window.api.ai.onStreamToken(({ sessionId, token, kind }: any) => {
      updateSession(sessionId, (s) => {
        if (kind === 'thinking') {
          return { ...s, thinkingBuffer: s.thinkingBuffer + token, streaming: true }
        }
        return { ...s, streamBuffer: s.streamBuffer + token, streaming: true }
      })
    })
    return () => window.api.ai.removeStreamTokenListener(handleToken)
  }, [updateSession])

  // ── IPC: File changes → open DiffViewer ──
  useEffect(() => {
    const handleFc = window.api.ai.onFileChange((change: any) => {
      onOpenDiffRef.current(change.filePath, change.relativePath, change.oldContent, change.content)
    })
    return () => window.api.ai.removeFileChangeListener(handleFc)
  }, [])

  // ── IPC: Permission requests ──
  useEffect(() => {
    const handlePerm = window.api.ai.onPermission((perm: any) => {
      updateSession(perm.sessionId, (s) => ({ ...s, pendingPermission: perm }))
    })
    return () => window.api.ai.removePermissionListener(handlePerm)
  }, [updateSession])

  // ── IPC: Ready ──
  useEffect(() => {
    const handleReady = window.api.ai.onReady(({ sessionId, slashCommands, model }: any) => {
      const commands = enrichSlashCommands(slashCommands || [])
      updateSession(sessionId, (s) => ({ ...s, ready: true, slashCommands: commands, model: model || '' }))
    })
    return () => window.api.ai.removeReadyListener(handleReady)
  }, [updateSession])

  // ── IPC: Errors — merge into last pending tool or show standalone ──
  useEffect(() => {
    const handleErr = window.api.ai.onError(({ sessionId, error, installCmd }: any) => {
      updateSession(sessionId, (s) => {
        const pendingToolIdx = findPendingToolIndex(s.messages)
        let messages: AiMessage[]
        if (pendingToolIdx != null) {
          const { msgIdx, toolIdx } = pendingToolIdx
          const msg = s.messages[msgIdx]
          const tool = msg.toolUse![toolIdx]
          const mergedToolUse = [...msg.toolUse!]
          mergedToolUse[toolIdx] = { ...tool, result: { toolUseId: tool.id, content: error, isError: true } }
          messages = [...s.messages]
          messages[msgIdx] = { ...msg, toolUse: mergedToolUse }
        } else {
          messages = [...s.messages, { sessionId, type: 'result' as const, error, installCmd, timestamp: Date.now() }]
        }
        return {
          ...s,
          ready: true,
          busy: false, streaming: false, streamBuffer: '', thinkingBuffer: '',
          messages,
        }
      })
    })
    return () => window.api.ai.removeErrorListener(handleErr)
  }, [updateSession])

  // ── Session lifecycle: check availability then auto-create AI session ──
  useEffect(() => {
    if (!activeSessionId || !workspacePath) return
    if (createdSessionsRef.current.has(activeSessionId)) return
    createdSessionsRef.current.add(activeSessionId)

    // Pre-check availability
    const sid = activeSessionId
    window.api.ai.checkAvailable().then((result: any) => {
      if (!result.available) {
        updateSession(sid, (s) => ({
          ...s,
          ready: true,
          messages: [{
            sessionId: sid, type: 'result' as const,
            error: result.error || 'Claude CLI not found',
            installCmd: result.installCmd,
            timestamp: Date.now(),
          }],
        }))
        return
      }
      window.api.ai.create({
        sessionId: sid,
        cwd: workspacePath,
        autoApprove,
        permissionMode,
      })
      updateSession(sid, () => ({ ...EMPTY_SESSION }))
    }).catch(() => {
      updateSession(sid, (s) => ({
        ...s,
        ready: true,
        messages: [{
          sessionId: sid, type: 'result' as const,
          error: 'Failed to check CLI availability',
          timestamp: Date.now(),
        }],
      }))
    })
  }, [activeSessionId, workspacePath]) // intentionally omit autoApprove to not re-create

  // ── Cleanup destroyed sessions ──
  const handleDestroySession = useCallback((sessionId: string) => {
    window.api.ai.destroy(sessionId)
    createdSessionsRef.current.delete(sessionId)
    setSessionStates(prev => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
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
      if (!s.name && newName) onRenameSession(newName)
      return {
        ...s, busy: true, name: newName,
        messages: [...s.messages, {
          sessionId: activeSessionId, type: 'user' as const, role: 'user' as const,
          content: message, timestamp: Date.now(),
        }],
      }
    })
    await window.api.ai.send(activeSessionId, message)
  }, [activeSessionId, inputValue, state.busy, updateSession, onRenameSession])

  // ── Send direct (for example prompts) ──
  const sendDirect = useCallback(async (text: string) => {
    if (!activeSessionId || state.busy) return
    updateSession(activeSessionId, (s) => {
      const newName = !s.name ? text.slice(0, 60) : s.name
      if (!s.name && newName) onRenameSession(newName)
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

  // ── Permission response ──
  const handlePermissionResponse = useCallback((
    sessionId: string, requestId: string, approved: boolean,
    tool: string, toolInput?: Record<string, any>
  ) => {
    window.api.ai.respondPermission(sessionId, requestId, approved, tool, toolInput)
    updateSession(sessionId, (s) => ({ ...s, pendingPermission: null }))
  }, [updateSession])

  // Exported for parent cleanup
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as any).__aiDestroyAll = () => {
        createdSessionsRef.current.forEach((sid) => {
          window.api.ai.destroy(sid)
        })
        createdSessionsRef.current.clear()
        setSessionStates({})
      }
    }
  }, [])

  // ── Status text ──
  const statusText = !state.ready
    ? t('Connecting...')
    : state.streaming
      ? t('Streaming...')
      : null

  return (
    <div ref={containerRef} tabIndex={-1} className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none focus:ring-0">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-ide-border shrink-0">
        <span className="text-xs font-medium text-ide-text truncate">{state.name || 'untitled'}</span>
        <div className="flex items-center gap-1">
          {/* Session history */}
          <button
            onClick={async () => {
              const result = await window.api.ai.listSessions(workspacePath || undefined)
              if (result.sessions?.length > 0) {
                setSessionHistoryList(result.sessions)
                setSessionHistoryOpen(true)
              }
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
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
              createdSessionsRef.current.delete(activeSessionId)
              updateSession(activeSessionId, () => ({ ...EMPTY_SESSION }))
              window.api.ai.create({
                sessionId: activeSessionId,
                cwd: workspacePath,
                autoApprove,
                permissionMode,
              })
              onViewAi()
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
            title={t('New Session')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
      {/* Session history dropdown */}
      {sessionHistoryOpen && sessionHistoryList.length > 0 && (
        <div ref={historyRef} className="absolute top-8 right-2 bg-ide-sidebar border border-ide-border rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto w-56 animate-fade-in">
          {sessionHistoryList.map((s: any) => {
            const timeStr = s.timestamp ? new Date(s.timestamp).toLocaleString() : ''
            return (
              <button
                key={s.session_id || s.id}
                onClick={async () => {
                  if (activeSessionId) {
                    // Load conversation history from .jsonl before resuming
                    const history = await window.api.ai.loadSessionMessages(s.session_id || s.id, workspacePath || '')
                    updateSession(activeSessionId, () => ({
                      ...EMPTY_SESSION,
                      messages: history.messages,
                      model: history.model || '',
                      slashCommands: enrichSlashCommands(history.slashCommands || []),
                      ready: false,
                    }))
                    await window.api.ai.destroy(activeSessionId)
                    window.api.ai.create({
                      sessionId: activeSessionId,
                      cwd: workspacePath || '',
                      autoApprove,
                      permissionMode,
                      resumeSessionId: s.session_id || s.id,
                    })
                  }
                  setSessionHistoryOpen(false)
                  setSessionHistoryList([])
                }}
                className="w-full px-2 py-1.5 text-[11px] text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors text-left"
              >
                <div className="truncate">{s.name || s.session_id || s.id}</div>
                {timeStr && <div className="text-[9px] text-ide-text-muted/50 mt-0.5">{timeStr}</div>}
              </button>
            )
          })}
        </div>
      )}
      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
        {state.messages.length === 0 && !state.streaming && (
          <div className="flex flex-col items-center justify-center text-ide-text-muted text-xs pt-8 space-y-3 animate-fade-in">
            <div className="animate-zap-glow text-ide-accent">
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
            <div className="flex flex-wrap justify-center gap-1.5 pt-2 max-w-[280px]">
              {EXAMPLE_PROMPTS.map((item, i) => (
                <button
                  key={i}
                  onClick={() => sendDirect(t(item.prompt))}
                  className="px-3 py-1.5 text-xs border border-ide-border rounded-full text-ide-text-muted hover:text-ide-text hover:bg-ide-hover hover:border-ide-accent/30 transition-colors"
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>
        )}
        {state.messages.map((msg: AiMessage, i: number) => (
          <AiMessageBubble key={i} message={msg} />
        ))}
        {/* Streaming buffer — thinking + text */}
        {state.streaming && (state.streamBuffer || state.thinkingBuffer) && (
          <div className="max-w-[92%] space-y-1.5 animate-fade-in">
            {state.thinkingBuffer && <ThinkingBlock text={state.thinkingBuffer} defaultOpen />}
            {state.streamBuffer && (
              <div>
                <StreamingMarkdown text={state.streamBuffer} />
                <span className="inline-block w-1 h-3 bg-ide-accent animate-pulse ml-0.5 align-middle" />
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Permission popup — floats above input, not inside scroll area */}
      {state.pendingPermission && activeSessionId && (
        <AiPermissionCard
          perm={state.pendingPermission}
          sessionId={activeSessionId}
          onRespond={handlePermissionResponse}
        />
      )}

      {/* Input */}
      <div className="shrink-0 p-2">
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
          <div className="rounded-2xl border border-ide-accent/60
                          bg-ide-sidebar shadow-sm
                          transition-colors focus-within:border-ide-accent">

            {/* Textarea zone */}
            <div className="px-3 pt-2.5 pb-1.5">
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
                className="w-full text-xs bg-transparent px-0 py-0.5 text-ide-text
                           placeholder:text-ide-text-muted/50 resize-none
                           focus:outline-none disabled:opacity-50 leading-relaxed text-sm"
              />
            </div>

            {/* Bottom toolbar */}
            <div className="flex items-center gap-2 px-2 py-1.5
                            border-t border-ide-border/30">
              {/* LEFT: Context bar + model name */}
              <div className="flex items-center gap-3 shrink-0">
                <ContextBar percent={state.contextPercent} />
                {state.model && (
                  <span className="text-xs text-ide-text-muted/60 font-mono
                                 truncate w-[90px] leading-tight">
                    {state.model}
                  </span>
                )}
              </div>

              {/* CENTER: flex spacer */}
              <div className="flex-1" />

              {/* RIGHT: Mode selector + Send/Cancel */}
              <div className="flex items-center gap-1 shrink-0">
                <ModeSelector
                  value={permissionMode}
                  onChange={onPermissionModeChange}
                />

                {state.busy ? (
                  <button
                    type="button"
                    onClick={() => activeSessionId && window.api.ai.cancel(activeSessionId)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg
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
                    className="w-7 h-7 flex items-center justify-center rounded-lg
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
}
