import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { AiMessage, AiToolUse, AiSessionState, AiPermissionRequest } from '@shared/types'
import { AI_FILE_EDIT_TOOLS } from '@shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getMarkdownCodeOverrides } from './MarkdownCodeBlock'
import { useI18n } from '../i18n'

interface AiTabProps {
  activeSessionId: string | null
  workspacePath: string | null
  isActive: boolean
  autoApprove: boolean
  onOpenDiff: (fullPath: string, relativePath: string, oldContent?: string, newContent?: string) => void
}

const EMPTY_SESSION: AiSessionState = {
  ready: false, busy: false, messages: [],
  streaming: false, streamBuffer: '', thinkingBuffer: '', pendingPermission: null,
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
    <div className="animate-fade-in">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 text-[10px] text-ide-text-muted/60 hover:text-ide-text-muted transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-90' : ''}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>Thinking</span>
      </button>
      {open && (
        <div className="mt-1 pl-3 border-l border-ide-border/50 text-[10px] text-ide-text-muted/70 whitespace-pre-wrap">
          {text}
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

const EXAMPLE_PROMPTS = [
  'Explain this codebase',
  'Find potential bugs',
  'Write tests for the main module',
  'Refactor for readability',
]

// ── Main Component ─────────────────────────────────────────────

export default function AiTab({ activeSessionId, workspacePath, isActive, autoApprove, onOpenDiff }: AiTabProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // Per-session AI state
  const [sessionStates, setSessionStates] = useState<Record<string, AiSessionState>>({})
  const state = activeSessionId ? (sessionStates[activeSessionId] || EMPTY_SESSION) : EMPTY_SESSION

  // Input
  const [inputValue, setInputValue] = useState('')
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

        return {
          ...s,
          messages,
          busy: msg.type !== 'result',
          streaming: msg.type === 'result' ? false : s.streaming,
          streamBuffer: clearText || msg.type === 'result' ? '' : s.streamBuffer,
          thinkingBuffer: clearThinking || msg.type === 'result' ? '' : s.thinkingBuffer,
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
    const handleReady = window.api.ai.onReady(({ sessionId }: any) => {
      updateSession(sessionId, (s) => ({ ...s, ready: true }))
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
    updateSession(activeSessionId, (s) => ({
      ...s, busy: true,
      messages: [...s.messages, {
        sessionId: activeSessionId, type: 'user' as const, role: 'user' as const,
        content: message, timestamp: Date.now(),
      }],
    }))
    await window.api.ai.send(activeSessionId, message)
  }, [activeSessionId, inputValue, state.busy, updateSession])

  // ── Send direct (for example prompts) ──
  const sendDirect = useCallback(async (text: string) => {
    if (!activeSessionId || state.busy) return
    updateSession(activeSessionId, (s) => ({
      ...s, busy: true,
      messages: [...s.messages, {
        sessionId: activeSessionId, type: 'user' as const, role: 'user' as const,
        content: text, timestamp: Date.now(),
      }],
    }))
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
      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
        {state.messages.length === 0 && !state.streaming && (
          <div className="flex flex-col items-center justify-center text-ide-text-muted text-xs pt-8 space-y-3 animate-fade-in">
            <div className="animate-zap-glow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 opacity-40">
                <path d="M12 2a4 4 0 0 1 4 4v1a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a2 2 0 0 1 2-2V6a4 4 0 0 1 4-4z" />
                <circle cx="9" cy="12" r="1" fill="currentColor" />
                <circle cx="15" cy="12" r="1" fill="currentColor" />
              </svg>
            </div>
            <span>{t('Ask AI to help with your code...')}</span>
            <div className="flex flex-wrap justify-center gap-1.5 pt-2 max-w-[280px]">
              {EXAMPLE_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => sendDirect(prompt)}
                  className="px-2 py-1 text-[10px] border border-ide-border rounded-full text-ide-text-muted hover:text-ide-text hover:bg-ide-hover hover:border-ide-accent/30 transition-colors"
                >
                  {t(prompt)}
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
      <div className="shrink-0 border-t border-ide-border p-2">
        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={state.ready ? t('Type a message...') : t('Initializing...')}
            rows={2}
            disabled={!state.ready}
            className="flex-1 text-xs bg-ide-bg border border-ide-border rounded px-2 py-1.5 text-ide-text focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50 resize-none disabled:opacity-50"
          />
          {state.busy ? (
            <button
              onClick={() => activeSessionId && window.api.ai.cancel(activeSessionId)}
              className="px-2.5 py-1 text-xs bg-ide-danger hover:bg-ide-danger/80 text-white rounded transition-colors self-end"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || !state.ready}
              className="px-2.5 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 self-end"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
