export { ChatMarkdown, StreamingMarkdown } from './markdown'
export { InlineAnnotationInput } from './permissions'
import React, { useState, useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { AiSessionState, AiPermissionMode, RecentFileEntry } from '@shared/types'
import { useI18n } from '../../i18n'
import { formatConversationMarkdown } from '../../utils/aiConversationFormatter'
import { loadFilterRules } from '../FileTab'
import { aiStore, useAiSession, EMPTY_SESSION, enrichSlashCommands, SLASH_COMMAND_DESCRIPTIONS, readAiCliConfig } from '../../aiStore'
import { EXAMPLE_PROMPTS } from '../examplePrompts'
import { SquareArrowUp, Square, Check, MessageSquarePlus, Copy, Eye, EyeOff, Plug, GitBranch, X } from 'lucide-react'
import { StreamingMarkdown } from './markdown'
import { ThinkingBlock, TodoListPanel, deriveTodoList, findMessageIndexForUserMessage, countContentOccurrencesBefore, MessageList } from './messages'
import { ToolIcon, getToolCategory } from './tools'
import { AiAskQuestionCard, AiPermissionCard, AiExitPlanModeCard } from './permissions'
import { SlashCommandAutocomplete, MentionAutocomplete, ContextBar, ModelBadge, ModeSelector } from './inputArea'
import type { MentionItem } from './inputArea'
import { ClaudeLogoIcon } from '../ClaudeLogoIcon'
function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  if (n < 1000000) return `${(n / 1000).toFixed(1)} kB`
  return `${(n / 1000000).toFixed(1)} MB`
}

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
  onForkSession?: (userMessageIndex: number, content?: string, occurrence?: number) => void
  onAgentStatusChange?: (sessionId: string, status: 'running' | 'idle') => void
  resumeSessionId?: string
  brushActive?: boolean
  lastOpenedFile?: RecentFileEntry | null
  worktreeNav?: { originalPath: string; worktreePath: string; originalBranch: string } | null
  onWorktreeNavChange?: React.Dispatch<React.SetStateAction<Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>>>
  onCommand?: (command: string) => void
}

export interface AiTabHandle {
  focus: () => void
  setValue: (text: string) => void
  appendText: (text: string) => void
  sendText: (text: string) => void
}
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
const AiTab = forwardRef<AiTabHandle, AiTabProps>(function AiTab({ activeSessionId, workspacePath, isActive, autoApprove, permissionMode, onPermissionModeChange, onViewAi, onRenameSession, onOpenFile, onForkSession, onAgentStatusChange, resumeSessionId, brushActive, lastOpenedFile, worktreeNav, onWorktreeNavChange, onCommand }, ref) {
  const { t } = useI18n()
  const busyQuip = useMemo(() => BUSY_QUIPS[Math.floor(Math.random() * BUSY_QUIPS.length)], [])
  const containerRef = useRef<HTMLDivElement>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // AI session state — shared singleton store (进程级单例,消除 N 倍冗余)
  const state = useAiSession(activeSessionId)

  const busyStartRef = useRef<number>(0)
  const [busySeconds, setBusySeconds] = useState(0)
  useEffect(() => {
    if (state.busy) {
      if (!busyStartRef.current) busyStartRef.current = Date.now()
      const tick = () => setBusySeconds(Math.floor((Date.now() - busyStartRef.current) / 1000))
      tick()
      const id = setInterval(tick, 1000)
      return () => clearInterval(id)
    }
    busyStartRef.current = 0
    setBusySeconds(0)
  }, [state.busy])
  const busyTimeLabel = busySeconds >= 10
    ? busySeconds >= 60
      ? ` (${Math.floor(busySeconds / 60)}m ${busySeconds % 60}s)`
      : ` (${busySeconds}s)`
    : ''

  // Stop button two-stage: 点过一次软中断后 5s 内仍 busy 才升级强杀，未点击不自动武装
  const [interruptTried, setInterruptTried] = useState(false)
  const [forceArmed, setForceArmed] = useState(false)
  useEffect(() => {
    if (!state.busy) { setInterruptTried(false); setForceArmed(false); return }
    if (!interruptTried) return
    const t = setTimeout(() => setForceArmed(true), 5000)
    return () => clearTimeout(t)
  }, [state.busy, interruptTried])

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
  const [worktreeEnabled, setWorktreeEnabled] = useState(false)
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

  const [mentionMenuOpen, setMentionMenuOpen] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)
  const [mentionResults, setMentionResults] = useState<MentionItem[]>([])
  const mentionTriggerStartRef = useRef(0)
  const mentionReqIdRef = useRef(0)

  const closeMention = useCallback(() => {
    setMentionMenuOpen(false)
    setMentionFilter('')
    setMentionResults([])
    setMentionSelectedIndex(0)
  }, [])

  const selectMention = useCallback((item: MentionItem) => {
    const el = inputRef.current
    if (el) {
      const start = mentionTriggerStartRef.current
      const end = el.selectionStart ?? el.value.length
      const insert = `@${item.relativePath} `
      el.setRangeText(insert, start, end, 'end')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.focus({ preventScroll: true })
    }
    closeMention()
  }, [closeMention])

  useEffect(() => {
    if (!mentionMenuOpen || !workspacePath) { setMentionResults([]); return }
    const query = mentionFilter
    if (!query) { setMentionResults([]); return }
    const reqId = ++mentionReqIdRef.current
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.file.searchByName(workspacePath, query, loadFilterRules())
        if (mentionReqIdRef.current !== reqId) return
        if (res && !res.error) {
          setMentionResults(res.matches || [])
          setMentionSelectedIndex(0)
        } else {
          setMentionResults([])
        }
      } catch {
        if (mentionReqIdRef.current === reqId) setMentionResults([])
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [mentionMenuOpen, mentionFilter, workspacePath])

  useEffect(() => { closeMention() }, [activeSessionId, closeMention])

  const dispatchMessageRef = useRef<((message: string) => Promise<void>) | null>(null)

  useImperativeHandle(ref, () => ({
    focus: () => { inputRef.current?.focus({ preventScroll: true }) },
    setValue: (text: string) => { setInputValue(text) },
    appendText: (text: string) => {
      const sid = activeSessionIdRef.current
      if (!sid) return
      setInputValues(prev => {
        const cur = prev[sid] || ''
        const sep = cur.trim() ? ';\n' : ''
        return { ...prev, [sid]: cur + sep + text }
      })
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
        el.focus({ preventScroll: true })
        el.selectionStart = el.selectionEnd = el.value.length
        el.scrollTop = el.scrollHeight
      })
    },
    sendText: (text: string) => {
      if (!text.trim()) return
      dispatchMessageRef.current?.(text.trim())
    },
  }), [setInputValue, setInputValues])

  const autoGrow = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = 200
    const newH = Math.min(el.scrollHeight, maxH)
    el.style.height = `${newH}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [])

  useEffect(() => { autoGrow() }, [inputValue, autoGrow])

  // ── Update session state helper(委托给单例 store)──
  const updateSession = useCallback((sessionId: string, updater: (s: AiSessionState) => AiSessionState) => {
    aiStore.updateSession(sessionId, updater)
  }, [])

  // ── IPC listeners(sessionStates / onMessage / onStreamToken / onPermission /
  // onReady / onError)已上提到 aiStore 单例,此处不再重复注册。──

  // ── Session lifecycle: check availability then auto-create AI session ──
  useEffect(() => {
    if (!activeSessionId || !workspacePath) return
    const { cliCommand, configDir } = readAiCliConfig()
    aiStore.ensureCreated(activeSessionId, {
      cwd: workspacePath,
      autoApprove,
      permissionMode,
      ...(resumeSessionId ? { resumeSessionId } : {}),
      cliCommand,
      configDir,
      ...(worktreeEnabled ? { enableWorktree: true } : {}),
    })
  }, [activeSessionId, workspacePath, worktreeEnabled])

  // ── Cleanup destroyed sessions ──
  const handleDestroySession = useCallback((sessionId: string) => {
    window.api.ai.destroy(sessionId)
    aiStore.clearSession(sessionId)
    onWorktreeNavChange?.(prev => {
      if (!prev[sessionId]) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [onWorktreeNavChange])

  useEffect(() => {
    if (!activeSessionId || !workspacePath || !state.worktreePath || !onWorktreeNavChange) return
    const wtp = state.worktreePath
    onWorktreeNavChange(prev => {
      if (prev[activeSessionId]?.worktreePath === wtp) return prev
      return {
        ...prev,
        [activeSessionId]: {
          originalPath: workspacePath,
          worktreePath: wtp,
          originalBranch: '',
        }
      }
    })
  }, [activeSessionId, workspacePath, state.worktreePath, onWorktreeNavChange])

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

  const scrollRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (userScrolledUpRef.current) return
    if (scrollRafRef.current != null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      if (!userScrolledUpRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
      }
    })
  }, [state.messages.length, state.streamBuffer, state.thinkingBuffer])

  // ── Focus input when tab becomes active ──
  // ready 前 textarea 是 disabled 无法聚焦,克隆的新 session 需等 ready 后再聚焦
  useEffect(() => {
    if (isActive && state.ready && inputRef.current) {
      inputRef.current.focus({ preventScroll: true })
      autoGrow()
    }
  }, [isActive, state.ready, autoGrow])

  // ── Dispatch a message to the subprocess (shared core) ──
  // Immediate send and piped auto-send both funnel through here.
  const dispatchMessage = useCallback(async (message: string) => {
    if (!activeSessionId || !message.trim()) return
    const isSlash = message.startsWith('/')
    const isClear = message.startsWith('/clear')
    onCommand?.(message)
    updateSession(activeSessionId, (s) => {
      const newName = !s.name && !isSlash ? message.slice(0, 60) : s.name
      const userMsg = { sessionId: activeSessionId, type: 'user' as const, role: 'user' as const, content: message, timestamp: Date.now() }
      return {
        ...s, busy: true, name: newName, pipedPrompt: '',
        messages: isClear ? [] : [...s.messages, userMsg],
        ...(isClear ? { fileChangesByTurn: [], userTurns: [] } : {}),
      }
    })
    await window.api.ai.send(activeSessionId, message)
  }, [activeSessionId, updateSession])

  dispatchMessageRef.current = dispatchMessage

  // ── Send handler (immediate, idle only) ──
  const handleSend = useCallback(async () => {
    if (!activeSessionId || !inputValue.trim() || state.busy) return
    const message = inputValue.trim()
    setInputValue('')
    await dispatchMessage(message)
  }, [activeSessionId, inputValue, state.busy, setInputValue, dispatchMessage])

  // ── Enter key: pipe while busy, send when idle ──
  // While the agent is running, Enter appends the draft to a per-session
  // pipedPrompt buffer (shown as a "piped" chip) instead of sending; the
  // buffer is auto-dispatched when the session returns to idle.
  const handleEnter = useCallback(() => {
    if (!activeSessionId || !inputValue.trim()) return
    if (state.busy) {
      const text = inputValue.trim()
      setInputValue('')
      updateSession(activeSessionId, (s) => {
        const prev = s.pipedPrompt || ''
        const sep = prev ? '\n' : ''
        return { ...s, pipedPrompt: prev + sep + text }
      })
      return
    }
    handleSend()
  }, [activeSessionId, inputValue, state.busy, setInputValue, updateSession, handleSend])

  // ── Auto-dispatch piped prompt when session returns to idle ──
  // busy true→false (turn done) and no pending permission → flush piped.
  const prevBusyRef = useRef(state.busy)
  useEffect(() => {
    const wasBusy = prevBusyRef.current
    prevBusyRef.current = state.busy
    if (!wasBusy || state.busy || state.pendingPermission || !activeSessionId) return
    const piped = (state.pipedPrompt || '').trim()
    if (!piped) return
    dispatchMessage(piped)
  }, [state.busy, state.pendingPermission, activeSessionId, dispatchMessage, state.pipedPrompt])

  // ── ExitPlanMode "Clear & Execute": kill plan-mode subprocess, respawn in bypassPermissions,
  // re-inject plan from disk as first message. onDeny 委托 aiStore.handlePlanDeny;
  // onClearExecute 需切 UI permission mode 故留组件内(被调先于主调)。
  const modelRef = useRef(state.model)
  modelRef.current = state.model
  const handlePlanClearExecute = useCallback(async (sessionId: string, planFilePath: string, modelOverride?: string) => {
    if (!planFilePath) return
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
    onPermissionModeChange('bypassPermissions')
    const model = modelOverride || modelRef.current
    await window.api.ai.clearAndExecutePlan(sessionId, planFilePath, model)
  }, [updateSession, onPermissionModeChange])

  // ── ExitPlanMode "Continue": kill + --resume respawn → restore full context ──
  const handlePlanContinue = useCallback(async (sessionId: string, requestId: string, modelOverride?: string) => {
    if (!requestId) return
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
    onPermissionModeChange('bypassPermissions')
    const model = modelOverride || modelRef.current
    await window.api.ai.clearAndExecutePlan(sessionId, '', model, true)
  }, [updateSession, onPermissionModeChange])

  // ── Revert / Fork handlers ──────────────────────────────────────

  const handleRevert = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !workspacePath) return

    const targetMsgIdx = findMessageIndexForUserMessage(state.messages, userMessageIndex)
    if (targetMsgIdx < 0) return

    // Renderer's userMessageIndex can drift below the JSONL turn index (AskUserQuestion
    // answers / plan approvals / continuation prompts exist only in the JSONL). Pass the
    // clicked message's content + occurrence so the main process resolves the true turn.
    const targetContent = state.messages[targetMsgIdx]?.content
    const occurrence = targetContent ? countContentOccurrencesBefore(state.messages, targetMsgIdx, targetContent) : 0

    const savedMessages = state.messages
    const savedFileChanges = state.fileChangesByTurn

    const truncatedMessages = state.messages.slice(0, targetMsgIdx)
    const truncatedFileChanges = state.fileChangesByTurn.slice(0, userMessageIndex)

    if (targetMsgIdx >= 0 && state.messages[targetMsgIdx]?.content) {
      setInputValue(state.messages[targetMsgIdx].content!)
    }

    updateSession(activeSessionId, (s) => ({
      ...s,
      messages: truncatedMessages,
      fileChangesByTurn: truncatedFileChanges,
      busy: false,
      streaming: false, streamBuffer: '', thinkingBuffer: '', thinkingStartedAt: null,
      pendingPermission: null,
    }))

    const result = await window.api.ai.revert({
      sessionId: activeSessionId,
      userMessageIndex,
      scope: 'conversation',
      cwd: workspacePath,
      ...(targetContent ? { content: targetContent, occurrence } : {}),
    })

    if (!result.success) {
      updateSession(activeSessionId, (s) => ({
        ...s,
        messages: savedMessages,
        fileChangesByTurn: savedFileChanges,
        busy: false,
      }))
    } else {
      aiStore.refreshUserTurns(activeSessionId)
    }
  }, [activeSessionId, workspacePath, state.messages, state.fileChangesByTurn, updateSession, setInputValue])

  const handleRevertAndCode = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !workspacePath) return

    const targetMsgIdx = findMessageIndexForUserMessage(state.messages, userMessageIndex)
    if (targetMsgIdx < 0) return

    const filesToRevert = new Map<string, { filePath: string; action: string; oldContent?: string }>()
    for (let turn = userMessageIndex; turn < state.fileChangesByTurn.length; turn++) {
      const changes = state.fileChangesByTurn[turn]
      if (!changes) continue
      for (const change of changes) {
        if (!filesToRevert.has(change.relativePath)) {
          filesToRevert.set(change.relativePath, {
            filePath: change.filePath,
            action: change.action,
            oldContent: change.oldContent,
          })
        }
      }
    }

    for (const [, info] of filesToRevert) {
      try {
        if (info.action === 'create') {
          await window.api.file.delete(info.filePath)
        } else if (info.oldContent != null) {
          await window.api.file.write(info.filePath, info.oldContent)
        }
      } catch (err) { console.error('file revert failed:', err) }
    }

    await handleRevert(userMessageIndex)
  }, [handleRevert, workspacePath, state.messages, state.fileChangesByTurn])

  const handleFork = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !onForkSession) return
    const targetMsgIdx = findMessageIndexForUserMessage(state.messages, userMessageIndex)
    const targetContent = targetMsgIdx >= 0 ? state.messages[targetMsgIdx]?.content : undefined
    const occurrence = targetContent ? countContentOccurrencesBefore(state.messages, targetMsgIdx, targetContent) : 0
    onForkSession(userMessageIndex, targetContent, occurrence)
  }, [activeSessionId, onForkSession, state.messages])

  // ── Todo list ──
  const todoItems = useMemo(() => deriveTodoList(state.messages), [state.messages])

  // ── Copy entire conversation ──
  const [conversationCopied, setConversationCopied] = useState(false)
  const handleCopyConversation = useCallback(() => {
    const includeThinking = viewMode !== 2
    const includeToolUse = viewMode === 0
    const text = formatConversationMarkdown(
      state.messages, state.userTurns, state.name, includeThinking, includeToolUse
    )
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        setConversationCopied(true)
        setTimeout(() => setConversationCopied(false), 1500)
      })
    }
  }, [state.messages, state.userTurns, state.name, viewMode])

  const lastFile = useMemo(() => {
    if (!lastOpenedFile) return null
    const f = lastOpenedFile
    let relPath = f.path
    if (workspacePath && relPath.startsWith(workspacePath)) {
      relPath = relPath.slice(workspacePath.length).replace(/^[\\\/]+/, '')
    }
    relPath = relPath.replace(/\\/g, '/')
    const fileName = relPath.split('/').pop() || relPath
    let label = fileName
    let ref = relPath
    if (f.line) {
      label += `:${f.line}`
      ref += ` around line ${f.line}`
      if (f.endLine && f.endLine !== f.line) {
        label += `:${f.endLine}`
        ref += `:${f.endLine}`
      }
    }
    return { label, ref }
  }, [lastOpenedFile, workspacePath])

  const showEmptyCenter = state.messages.length === 0 && !state.streaming

  const inputArea = (
      <div className={`ai-tab__input-area shrink-0 w-full max-w-[928px] mx-auto px-2 pt-2 pb-0 ${showEmptyCenter ? 'absolute inset-x-0 top-1/2 -translate-y-1/2' : ''}`}>
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
          {mentionMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-20">
              <MentionAutocomplete
                items={mentionResults}
                selectedIndex={mentionSelectedIndex}
                onSelect={selectMention}
              />
            </div>
          )}

          {/* Pill container */}
          <div className="ai-tab__input-pill rounded-2xl border border-ide-accent/60
                          bg-ide-sidebar shadow-sm
                          transition-colors focus-within:border-ide-accent">

            {/* Textarea zone */}
            <div className="ai-tab__input-zone px-3 pt-1.5 pb-0">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => {
                  const val = e.target.value
                  setInputValue(val)
                  const isSlash = val.startsWith('/')
                  if (isSlash) {
                    const filter = val.slice(1).split(' ')[0]
                    setSlashMenuOpen(true)
                    setSlashFilter(filter)
                    setSlashSelectedIndex(0)
                  } else {
                    setSlashMenuOpen(false)
                    setSlashFilter('')
                  }
                  const el = e.target as HTMLTextAreaElement
                  const caret = el.selectionStart ?? val.length
                  const before = val.slice(0, caret)
                  const m = before.match(/(^|\s)@([^\s@]*)$/)
                  if (m && !isSlash) {
                    mentionTriggerStartRef.current = caret - m[2].length - 1
                    setMentionFilter(m[2])
                    setMentionMenuOpen(true)
                    setMentionSelectedIndex(0)
                  } else if (!m) {
                    setMentionMenuOpen(false)
                  }
                }}
                onKeyDown={(e) => {
                  if (mentionMenuOpen) {
                    if (e.key === 'ArrowDown' && mentionResults.length) {
                      e.preventDefault()
                      setMentionSelectedIndex(prev => (prev + 1) % mentionResults.length)
                      return
                    }
                    if (e.key === 'ArrowUp' && mentionResults.length) {
                      e.preventDefault()
                      setMentionSelectedIndex(prev => (prev - 1 + mentionResults.length) % mentionResults.length)
                      return
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      const item = mentionResults[mentionSelectedIndex]
                      if (item) selectMention(item)
                      else closeMention()
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      closeMention()
                      return
                    }
                  }
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
                    handleEnter()
                  }
                }}
                placeholder={state.ready ? t('Type a message...') : t('Initializing...')}
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
                className="ai-tab__textarea w-full text-sm bg-transparent px-0 pt-0.5 pb-px min-h-[3rem] text-ide-text
                           placeholder:text-ide-text-muted/50 resize-none
                           focus:outline-none disabled:opacity-50 leading-relaxed text-sm"
              />
            </div>

            {/* Bottom toolbar */}
            <div className="ai-tab__input-toolbar flex items-center gap-2 px-2 pt-0 pb-1.5
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
                {lastFile && (
                  <button
                    type="button"
                    onClick={() => {
                      const atRef = `@${lastFile.ref} `
                      setInputValue(inputValue ? inputValue + ' ' + atRef : atRef)
                      inputRef.current?.focus({ preventScroll: true })
                    }}
                    className="ai-tab__last-file-btn flex items-center gap-1 h-7 px-2 rounded-lg
                               bg-ide-accent/10 hover:bg-ide-accent/20 text-ide-accent
                               transition-colors text-[11px] max-w-[180px]"
                    title={lastFile.ref}
                  >
                    <Plug size={12} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{lastFile.label}</span>
                  </button>
                )}
                <ModeSelector
                  value={permissionMode}
                  onChange={onPermissionModeChange}
                />

                {state.busy ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeSessionId) return
                      if (forceArmed) aiStore.forceStop(activeSessionId)
                      else {
                        setInterruptTried(true)
                        window.api.ai.cancel(activeSessionId)
                      }
                    }}
                    className={`ai-tab__stop-btn w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                      forceArmed
                        ? 'bg-ide-danger text-white hover:bg-ide-danger/90'
                        : 'bg-ide-danger/20 hover:bg-ide-danger/30 text-ide-danger'
                    }`}
                    title={forceArmed ? t('Force Stop') : t('Cancel')}
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

  )

  return (
    <div ref={containerRef} tabIndex={-1} className="ai-tab relative flex-1 flex flex-col overflow-hidden outline-none focus:outline-none focus:ring-0">
      {/* Header */}
      <div className="ai-tab__header flex items-center justify-between px-2 py-1 border-b border-ide-border shrink-0 acrylic-titlebar-clean">
        <div className="ai-tab__header-left flex items-center gap-1.5 min-w-0">
            <ClaudeLogoIcon />
            <span className="ai-tab__session-name text-xs font-medium text-ide-text truncate">{state.name || 'untitled'}</span>
          </div>
        <div className="ai-tab__header-actions flex items-center gap-1">
          {/* Copy conversation */}
          <button
            onClick={handleCopyConversation}
            disabled={state.messages.length === 0}
            className="ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('Copy as Markdown (content follows eye filter)')}
          >
            {conversationCopied ? <Check size={14} className="text-ide-accent" /> : <Copy size={14} />}
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
              const { configDir } = readAiCliConfig()
              const result = await window.api.ai.listSessions(workspacePath || undefined, configDir)
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
          {/* Worktree isolation toggle — hidden if already navigated from GitTab */}
          {!worktreeNav?.worktreePath && (
            <button
              onClick={() => {
                if (!activeSessionId || !workspacePath) return
                const next = !worktreeEnabled
                setWorktreeEnabled(next)
                handleDestroySession(activeSessionId)
                const { cliCommand, configDir } = readAiCliConfig()
                aiStore.ensureCreated(activeSessionId, {
                  cwd: workspacePath,
                  autoApprove,
                  permissionMode,
                  cliCommand,
                  configDir,
                  ...(next ? { enableWorktree: true } : {}),
                })
                onViewAi()
              }}
              className={`ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center transition-colors ${
                worktreeEnabled
                  ? 'bg-ide-accent/20 text-ide-accent'
                  : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
              }`}
              title={t('Isolate in worktree')}
            >
              <GitBranch size={14} />
            </button>
          )}
          {/* New session */}
          <button
            onClick={() => {
              if (!activeSessionId || !workspacePath) return
              handleDestroySession(activeSessionId)
              const { cliCommand, configDir } = readAiCliConfig()
              aiStore.ensureCreated(activeSessionId, {
                cwd: workspacePath,
                autoApprove,
                permissionMode,
                cliCommand,
                configDir,
                ...(worktreeEnabled ? { enableWorktree: true } : {}),
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
        <div ref={historyRef} className="ai-tab__history-dropdown absolute top-8 right-2 bg-ide-sidebar border border-ide-border rounded-lg shadow-lg z-20 max-h-[28rem] overflow-y-auto w-80 animate-fade-in">
          {sessionHistoryList.map((s: any) => {
            const timeStr = s.timestamp ? new Date(s.timestamp).toLocaleString() : ''
            return (
              <button
                key={s.session_id || s.id}
                onClick={async () => {
                  setSessionHistoryOpen(false)
                  setSessionHistoryList([])
                  if (activeSessionId) {
                    const { cliCommand, configDir } = readAiCliConfig()
                    const history = await window.api.ai.loadSessionMessages(s.session_id || s.id, workspacePath || '', configDir)
                    const sessionName = s.name && s.name !== s.session_id ? s.name : ''
                    updateSession(activeSessionId, () => ({
                      ...EMPTY_SESSION,
                      messages: history.messages,
                      model: history.model || '',
                      slashCommands: enrichSlashCommands(history.slashCommands || []),
                      name: sessionName,
                      cwd: workspacePath || '',
                      ready: false,
                    }))
                    await window.api.ai.destroy(activeSessionId)
                    window.api.ai.create({
                      sessionId: activeSessionId,
                      cwd: workspacePath || '',
                      autoApprove,
                      permissionMode,
                      resumeSessionId: s.session_id || s.id,
                      ...(cliCommand ? { cliCommand } : {}),
                      ...(configDir ? { configDir } : {}),
                    })
                  }
                }}
                className="ai-tab__history-item w-full px-2.5 py-2 text-xs text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors text-left"
              >
                <div className="ai-tab__history-item-name truncate">{s.name || s.session_id || s.id}</div>
                {timeStr && (
                  <div className="ai-tab__history-item-meta flex items-center justify-between text-[10px] text-ide-text-muted/50 mt-1">
                    <span className="truncate mr-2">{timeStr}</span>
                    {s.sizeBytes > 0 && <span className="shrink-0">{formatBytes(s.sizeBytes)}</span>}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
      {/* New conversation: 输入框居中,上方 icon + prompts 保持原位置 */}
      {showEmptyCenter ? (
        <>
        <div className="ai-tab__empty flex flex-col items-center justify-center text-ide-text-muted text-xs pt-48 space-y-0.5 animate-fade-in">
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
            <div className="ai-tab__empty-prompts flex flex-wrap justify-center gap-1.5 pt-2 max-w-[480px]">
              {EXAMPLE_PROMPTS.map((item, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const text = t(item.prompt)
                    setInputValue(text)
                    const el = inputRef.current
                    if (el) {
                      el.value = text
                      el.dispatchEvent(new Event('input', { bubbles: true }))
                      el.focus()
                      el.selectionStart = el.selectionEnd = text.length
                      el.scrollTop = el.scrollHeight
                    }
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className="ai-tab__example-btn px-3 py-1.5 text-xs border border-ide-border rounded-full text-ide-text-muted hover:text-ide-text hover:bg-ide-hover hover:border-ide-accent/30 transition-colors"
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>
          {inputArea}
        </>
      ) : (
        <>
        <div ref={scrollContainerRef} className="ai-tab__messages flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
        <MessageList
          messages={state.messages}
          userTurns={state.userTurns}
          viewMode={viewMode}
          busy={state.busy}
          workspacePath={workspacePath}
          onOpenFile={onOpenFile}
          onRevert={handleRevert}
          onRevertAndCode={handleRevertAndCode}
          onFork={handleFork}
        />
        {!state.ready && state.messages.length > 0 && (
          <div className="ai-tab__resume flex items-center gap-2 w-full max-w-[896px] mx-auto px-3 py-2 rounded-lg bg-ide-sidebar border border-ide-border/50 text-xs text-ide-text-muted animate-fade-in">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-ide-accent/30 border-t-ide-accent animate-spin shrink-0" />
            <span>{t('Resuming session...')}</span>
          </div>
        )}
        {/* Busy indicator — thinking + streaming + sparkle */}
        {state.busy && (
          <div className="ai-tab__busy w-full max-w-[896px] mx-auto space-y-1.5 animate-fade-in">
            {Object.keys(state.runningTools).length > 0 && (
              <div className="ai-tab__live-tools flex flex-wrap items-center gap-1">
                {Object.entries(state.runningTools).map(([id, rt]) => (
                  <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono bg-ide-hover text-ide-text-muted border border-ide-border/50">
                    <ToolIcon category={getToolCategory(rt.tool)} />
                    <span className="truncate max-w-[160px]">{rt.tool}</span>
                    <span className="text-ide-text-muted/50">{Math.round(rt.elapsed)}s</span>
                  </span>
                ))}
              </div>
            )}
            {state.thinkingBuffer && <ThinkingBlock text={state.thinkingBuffer} defaultOpen autoScroll />}
            {state.streamBuffer ? (
              <div>
                <StreamingMarkdown text={state.streamBuffer} workspacePath={workspacePath} onOpenFile={onOpenFile} />
                <span className="ai-tab__busy-sparkle animate-sparkle ml-0.5 text-sm leading-none align-middle select-none">✻</span>
                <span className="ai-tab__busy-quip ml-0.5 text-xs leading-none align-middle select-none text-ide-accent/60">{busyQuip}{busyTimeLabel}</span>
              </div>
            ) : (
              <div>
                <span className="animate-sparkle text-sm leading-none select-none">✻</span>
                <span className="ml-0.5 text-xs leading-none select-none text-ide-accent/60">{busyQuip}{busyTimeLabel}</span>
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

      {/* Piped prompt — queued while busy, auto-sent when idle, X to dismiss */}
      {state.pipedPrompt && activeSessionId && (
        <div className="ai-tab__piped mx-2 mb-1 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-ide-accent/10 border border-ide-accent/30 animate-fade-in">
          <Plug size={12} className="shrink-0 text-ide-accent" />
          <span className="text-[11px] font-medium text-ide-accent/80 shrink-0">{t('Queued')}</span>
          <span className="text-xs text-ide-text/80 truncate flex-1 min-w-0" title={state.pipedPrompt}>{state.pipedPrompt}</span>
          <button
            type="button"
            onClick={() => updateSession(activeSessionId, s => ({ ...s, pipedPrompt: '' }))}
            className="ai-tab__piped-dismiss shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
            title={t('Remove')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {inputArea}
        </>
      )}

      {/* Plan overlay — covers entire dialog */}
      {state.pendingPermission && activeSessionId && state.pendingPermission.tool === 'ExitPlanMode' && (
        <AiExitPlanModeCard
          perm={state.pendingPermission}
          sessionId={activeSessionId}
          onContinue={handlePlanContinue}
          onClearExecute={handlePlanClearExecute}
          onDeny={aiStore.handlePlanDeny}
          workspacePath={workspacePath}
          onOpenFile={onOpenFile}
          model={state.model}
          brushActive={brushActive}
        />
      )}
    </div>
  )
})

export default AiTab
