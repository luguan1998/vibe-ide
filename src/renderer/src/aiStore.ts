import { useSyncExternalStore, useCallback } from 'react'
import type { AiMessage, AiSessionState, AiSlashCommand, AiPermissionMode, AiPermissionRequest, UserTurn } from '@shared/types'

// ── 纯函数 & 常量(从 AiTab.tsx 抽出,供 store 与组件共用)──

export const EMPTY_SESSION: AiSessionState = {
  ready: false, busy: false, messages: [],
  streaming: false, streamBuffer: '', thinkingBuffer: '', thinkingStartedAt: null, pendingPermission: null,
  slashCommands: [], model: '', contextPercent: null, name: '',
  fileChangesByTurn: [], userTurns: [],
  cwd: '', worktreePath: undefined, pipedPrompt: '',
  runningTools: {},
}

export const SLASH_COMMAND_DESCRIPTIONS: Record<string, { description: string; argumentHint?: string }> = {
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

export function enrichSlashCommands(names: string[]): AiSlashCommand[] {
  return names.map(name => {
    const preset = SLASH_COMMAND_DESCRIPTIONS[name]
    return {
      name,
      description: preset?.description || name,
      argumentHint: preset?.argumentHint,
    }
  })
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

// ── Store 单例 ──
// 进程级单例:N 个 AiTab 实例共享一份 sessionStates,消除"每实例存所有 session 历史"的 N 倍冗余。
// listener 模块级挂一次,不再每实例各挂一份。

let sessionStates: Record<string, AiSessionState> = {}
const listeners = new Set<() => void>()
const createdSessions = new Set<string>()

let pendingTokens = new Map<string, { text: string; thinking: string }>()
let rafScheduled = false
let lastFlush = 0
let throttleTimer: ReturnType<typeof setTimeout> | null = null
const THROTTLE_MS = 200
let activeSid: string | null = null
const BG_FLUSH_MS = 1500
let lastBgFlush = new Map<string, number>()

function emit() {
  for (const l of listeners) l()
}

function setStates(updater: (prev: Record<string, AiSessionState>) => Record<string, AiSessionState>) {
  sessionStates = updater(sessionStates)
  emit()
}

interface EnsureCreatedOpts {
  cwd: string
  autoApprove: boolean
  permissionMode: AiPermissionMode
  resumeSessionId?: string
  cliCommand?: string
  configDir?: string
  enableWorktree?: boolean
  model?: string
  persona?: string
  computerUse?: boolean
}

export function readAiCliConfig(): { cliCommand?: string; configDir?: string; computerUse?: boolean } {
  try {
    return {
      cliCommand: localStorage.getItem('vibe-ide-ai-cli-command') || undefined,
      configDir: localStorage.getItem('vibe-ide-ai-config-dir') || undefined,
      computerUse: localStorage.getItem('vibe-ide-ai-computer-use') === '1' || undefined,
    }
  } catch {
    return {}
  }
}

export const aiStore = {
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  },
  getSnapshot(sid: string | null): AiSessionState {
    if (!sid) return EMPTY_SESSION
    return sessionStates[sid] || EMPTY_SESSION
  },
  getSessionState(sid: string): AiSessionState {
    return sessionStates[sid] || { ...EMPTY_SESSION }
  },
  updateSession(sid: string, updater: (s: AiSessionState) => AiSessionState) {
    setStates(prev => ({
      ...prev,
      [sid]: updater(prev[sid] || { ...EMPTY_SESSION }),
    }))
  },
  clearSession(sid: string) {
    createdSessions.delete(sid)
    pendingTokens.delete(sid)
    lastBgFlush.delete(sid)
    setStates(prev => {
      if (!(sid in prev)) return prev
      const next = { ...prev }
      delete next[sid]
      return next
    })
  },
  setActiveSession(sid: string | null) {
    activeSid = sid
    if (sid) flushSidNow(sid)
  },
  refreshUserTurns(sid: string) {
    const cwd = sessionStates[sid]?.cwd
    if (!cwd) return
    window.api.ai.listUserTurns(sid, cwd).then((turns: UserTurn[]) => {
      aiStore.updateSession(sid, (s) => ({ ...s, userTurns: turns || [] }))
    }).catch(() => { /* ignore */ })
  },
  destroyAll() {
    for (const sid of createdSessions) window.api.ai.destroy(sid)
    createdSessions.clear()
    pendingTokens.clear()
    lastBgFlush.clear()
    if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null }
    setStates(() => ({}))
  },
  ensureCreated(sid: string, opts: EnsureCreatedOpts) {
    if (createdSessions.has(sid)) return
    createdSessions.add(sid)
    const fallback = readAiCliConfig()
    const cliCommand = opts.cliCommand ?? fallback.cliCommand
    const configDir = opts.configDir ?? fallback.configDir
    const computerUse = opts.computerUse ?? fallback.computerUse
    window.api.ai.checkAvailable(cliCommand).then((result: any) => {
      if (!result.available) {
        aiStore.updateSession(sid, () => ({
          ...EMPTY_SESSION,
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
      const finish = (messages: any[], model: string, slashCommands: any[]) => {
        window.api.ai.create({
          sessionId: sid,
          cwd: opts.cwd,
          autoApprove: opts.autoApprove,
          permissionMode: opts.permissionMode,
          ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
          ...(cliCommand ? { cliCommand } : {}),
          ...(configDir ? { configDir } : {}),
          ...(opts.enableWorktree ? { enableWorktree: true } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.persona?.trim() ? { persona: opts.persona } : {}),
          ...(computerUse ? { computerUse: true } : {}),
        })
        aiStore.updateSession(sid, () => ({
          ...EMPTY_SESSION,
          cwd: opts.cwd,
          messages,
          model,
          slashCommands: enrichSlashCommands(slashCommands),
        }))
      }
      if (opts.resumeSessionId) {
        // CLI --resume 不重放历史事件流，须先从 JSONL 预填历史（与 resumeSession 一致），
        // 否则 fork/恢复的新会话渲染空白
        window.api.ai.loadSessionMessages(opts.resumeSessionId, opts.cwd, configDir)
          .then((history: any) => finish(history?.messages || [], history?.model || '', history?.slashCommands || []))
          .catch(() => finish([], '', []))
      } else {
        finish([], '', [])
      }
    }).catch(() => {
      aiStore.updateSession(sid, () => ({
        ...EMPTY_SESSION,
        ready: true,
        messages: [{
          sessionId: sid, type: 'result' as const,
          error: 'Failed to check CLI availability',
          timestamp: Date.now(),
        }],
      }))
    })
  },
  async resumeSession(sid: string, historySessionId: string, cwd: string, opts: {
    autoApprove: boolean
    permissionMode: AiPermissionMode
    name?: string
    cliCommand?: string
    configDir?: string
    computerUse?: boolean
  }) {
    const fallback = readAiCliConfig()
    const cliCommand = opts.cliCommand ?? fallback.cliCommand
    const configDir = opts.configDir ?? fallback.configDir
    const computerUse = opts.computerUse ?? fallback.computerUse
    let messages: any[] = []
    let model = ''
    let slashCommands: any[] = []
    try {
      const history = await window.api.ai.loadSessionMessages(historySessionId, cwd, configDir)
      messages = history.messages || []
      model = history.model || ''
      slashCommands = history.slashCommands || []
    } catch {}
    try { await window.api.ai.destroy(sid) } catch {}
    createdSessions.add(sid)
    window.api.ai.create({
      sessionId: sid,
      cwd,
      autoApprove: opts.autoApprove,
      permissionMode: opts.permissionMode,
      resumeSessionId: historySessionId,
      ...(cliCommand ? { cliCommand } : {}),
      ...(configDir ? { configDir } : {}),
      ...(computerUse ? { computerUse: true } : {}),
    })
    aiStore.updateSession(sid, () => ({
      ...EMPTY_SESSION,
      messages,
      model,
      slashCommands: enrichSlashCommands(slashCommands),
      name: opts.name || '',
      cwd,
      ready: false,
    }))
  },
  handlePermissionResponse(
    sessionId: string, requestId: string, approved: boolean,
    tool: string, toolInput?: Record<string, any>, feedback?: string
  ) {
    window.api.ai.respondPermission(sessionId, requestId, approved, tool, toolInput, feedback)
    aiStore.updateSession(sessionId, s => ({ ...s, pendingPermission: null, busy: true }))
  },
  handlePlanDeny(sessionId: string, requestId: string, feedback: string) {
    window.api.ai.respondPermission(sessionId, requestId, false, 'ExitPlanMode', undefined, feedback || undefined)
    aiStore.updateSession(sessionId, s => ({ ...s, pendingPermission: null, busy: true }))
  },
  handleAskResume(
    sessionId: string, requestId: string, approved: boolean,
    tool: string, toolInput?: Record<string, any>
  ) {
    const answers = (toolInput?.answers || {}) as Record<string, string>
    aiStore.updateSession(sessionId, s => ({
      ...s,
      pendingPermission: null,
      streaming: false,
      streamBuffer: '',
      thinkingBuffer: '',
      thinkingStartedAt: null,
      busy: true,
    }))
    window.api.ai.askResume(sessionId, answers)
  },
  async forceStop(sid: string) {
    const res = await window.api.ai.forceStop(sid)
    if (!res?.success) return
    aiStore.updateSession(sid, (s) => ({
      ...s,
      busy: false,
      streaming: false,
      streamBuffer: '',
      thinkingBuffer: '',
      thinkingStartedAt: null,
      runningTools: {},
    }))
  },
}

// ── Token flush (RAF coalescing + 200ms throttle; inactive sessions throttled to BG_FLUSH_MS) ──

function applyBuf(sid: string, buf: { text: string; thinking: string }) {
  aiStore.updateSession(sid, (s) => ({
    ...s,
    streamBuffer: buf.text ? s.streamBuffer + buf.text : s.streamBuffer,
    thinkingBuffer: buf.thinking ? s.thinkingBuffer + buf.thinking : s.thinkingBuffer,
    thinkingStartedAt: buf.thinking && !s.thinkingBuffer ? Date.now() : s.thinkingStartedAt,
    streaming: true,
  }))
}

function flushSidNow(sid: string) {
  const buf = pendingTokens.get(sid)
  if (!buf) return
  pendingTokens.delete(sid)
  lastBgFlush.delete(sid)
  applyBuf(sid, buf)
}

function flushTokens() {
  const now = Date.now()
  const stillPending = new Map<string, { text: string; thinking: string }>()
  pendingTokens.forEach((buf, sid) => {
    const flush = sid === activeSid || (now - (lastBgFlush.get(sid) ?? 0) >= BG_FLUSH_MS)
    if (flush) {
      if (sid !== activeSid) lastBgFlush.set(sid, now)
      applyBuf(sid, buf)
    } else {
      stillPending.set(sid, buf)
    }
  })
  pendingTokens = stillPending
}

// ── IPC listeners(模块级挂一次)──

let listenersInitialized = false
function initListeners() {
  if (listenersInitialized) return
  listenersInitialized = true

  // ── onMessage ──
  window.api.ai.onMessage((msg: any) => {
    if (!msg.sessionId) return
    aiStore.updateSession(msg.sessionId, (s) => {
      const isAssistant = msg.type === 'assistant' && msg.role === 'assistant'

      // Consume any pending RAF tokens that haven't been flushed to state yet.
      const pending = pendingTokens.get(msg.sessionId)
      let s0 = s
      if (pending) {
        pendingTokens.delete(msg.sessionId)
        s0 = {
          ...s,
          streamBuffer: pending.text ? s.streamBuffer + pending.text : s.streamBuffer,
          thinkingBuffer: pending.thinking ? s.thinkingBuffer + pending.thinking : s.thinkingBuffer,
        }
      }

      const lastMsg = s0.messages[s0.messages.length - 1]
      const isSameMessageId = isAssistant
        && !!msg.messageId
        && !!lastMsg
        && lastMsg.type === 'assistant'
        && lastMsg.messageId === msg.messageId

      // msg.thinking/content 经 cleanText().trim()，而 stream 累积的 buffer 是原始 token（末尾可能残留 \n）。
      // 比较是否被覆盖时按 trim 口径，否则末尾空白会让 includes 失败 → 虚假 extra → 多渲染一条重复 thinking。
      const coveredByMergedThinking = isSameMessageId && !!lastMsg?.thinking && lastMsg.thinking.includes(s0.thinkingBuffer.trim())
      const coveredByMergedText = isSameMessageId && !!lastMsg?.content && lastMsg.content.includes(s0.streamBuffer.trim())
      const extraThinking = s0.thinkingBuffer
        && (!msg.thinking || !msg.thinking.includes(s0.thinkingBuffer.trim()))
        && !coveredByMergedThinking
        ? s0.thinkingBuffer : ''
      const extraText = s0.streamBuffer
        && (!msg.content || !msg.content.includes(s0.streamBuffer.trim()))
        && !coveredByMergedText
        ? s0.streamBuffer : ''
      const hasExtra = extraThinking || extraText

      const flushedMsg = (hasExtra && s0.streaming && (isAssistant || msg.type === 'result'))
        ? [{ sessionId: msg.sessionId, type: 'assistant' as const, role: 'assistant' as const,
            content: extraText || undefined,
            thinking: extraThinking || undefined,
            thinkingDurationMs: extraThinking && s0.thinkingStartedAt ? Date.now() - s0.thinkingStartedAt : undefined,
            parentToolUseId: msg.parentToolUseId,
            timestamp: Date.now() }]
        : []

      const thinkDuration = (isAssistant && msg.thinking && s0.thinkingStartedAt)
        ? Date.now() - s0.thinkingStartedAt : undefined

      let messages: AiMessage[]
      if (isSameMessageId && lastMsg) {
        const mergeContent = (oldC: string | undefined, newC: string | undefined): string | undefined => {
          const o = oldC || ''
          const n = newC || ''
          if (!n) return oldC
          if (!o) return newC
          return n.startsWith(o) ? n : o + n
        }
        const mergeThinking = (oldT: string | undefined, newT: string | undefined): string | undefined => {
          const o = oldT || ''
          const n = newT || ''
          if (!n) return oldT
          if (!o) return newT
          return n.startsWith(o) ? n : o + '\n\n' + n
        }
        const merged: AiMessage = {
          ...lastMsg,
          content: mergeContent(lastMsg.content, msg.content) || undefined,
          thinking: mergeThinking(lastMsg.thinking, msg.thinking) || undefined,
          thinkingDurationMs: lastMsg.thinkingDurationMs ?? thinkDuration,
          toolUse: msg.toolUse?.length ? [...(lastMsg.toolUse || []), ...msg.toolUse] : lastMsg.toolUse,
        }
        messages = [...s0.messages.slice(0, -1), merged, ...flushedMsg]
      } else if (msg.toolResult) {
        const merged = mergeToolResultIntoMessages(s0.messages, msg.toolResult.toolUseId, msg.toolResult)
        messages = merged
          ? [...merged, ...flushedMsg]
          : [...s0.messages, ...flushedMsg, msg]
      } else {
        messages = [...s0.messages, ...flushedMsg, isAssistant ? { ...msg, thinkingDurationMs: thinkDuration } : msg]
      }

      const clearThinking = isAssistant && (!!msg.thinking || (isSameMessageId && !!lastMsg?.thinking))
      const clearText = isAssistant && (!!msg.content || (isSameMessageId && !!lastMsg?.content))

      const isUserMsg = msg.type === 'user' && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()
      const newName = isUserMsg && !s0.name ? msg.content.trim().slice(0, 60) : s0.name

      let runningTools = s0.runningTools
      if (msg.type === 'result') {
        runningTools = {}
      } else if (msg.toolResult) {
        runningTools = { ...runningTools }
        delete runningTools[msg.toolResult.toolUseId]
      } else if (msg.toolUse?.length) {
        const doneIds = msg.toolUse.filter((t: any) => t.result).map((t: any) => t.id)
        if (doneIds.length > 0) {
          runningTools = { ...runningTools }
          for (const id of doneIds) delete runningTools[id]
        }
      }

      return {
        ...s0,
        messages,
        name: newName,
        busy: s0.busy && msg.type !== 'result',
        streaming: msg.type === 'result' ? false : s0.streaming,
        streamBuffer: clearText || msg.type === 'result' ? '' : s0.streamBuffer,
        thinkingBuffer: clearThinking || msg.type === 'result' ? '' : s0.thinkingBuffer,
        thinkingStartedAt: clearThinking || msg.type === 'result' ? null : s0.thinkingStartedAt,
        contextPercent: msg.contextPercent != null ? Math.round(msg.contextPercent) : s0.contextPercent,
        runningTools,
      }
    })
    if (msg.type === 'result') aiStore.refreshUserTurns(msg.sessionId)
  })

  // ── onStreamToken ──
  window.api.ai.onStreamToken(({ sessionId, token, kind }: any) => {
    if (!token) return
    const cur = pendingTokens.get(sessionId) || { text: '', thinking: '' }
    if (kind === 'thinking') cur.thinking += token
    else cur.text += token
    pendingTokens.set(sessionId, cur)
    if (rafScheduled) return
    rafScheduled = true
    requestAnimationFrame(() => {
      rafScheduled = false
      const now = Date.now()
      const elapsed = now - lastFlush
      if (elapsed >= THROTTLE_MS) {
        lastFlush = now
        flushTokens()
      } else if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null
          lastFlush = Date.now()
          flushTokens()
        }, THROTTLE_MS - elapsed)
      }
    })
  })

  // ── onProgress ──
  window.api.ai.onProgress((data: any) => {
    if (!data.sessionId) return
    aiStore.updateSession(data.sessionId, (s) => {
      const prev = s.runningTools[data.toolUseId]
      return {
        ...s,
        runningTools: {
          ...s.runningTools,
          [data.toolUseId]: {
            tool: data.tool || prev?.tool || 'tool',
            elapsed: data.elapsed ?? prev?.elapsed ?? 0,
            updatedAt: Date.now(),
          },
        },
      }
    })
  })

  // ── onPermission ──
  window.api.ai.onPermission((perm: any) => {
    aiStore.updateSession(perm.sessionId, (s) => ({
      ...s,
      pendingPermission: perm as AiPermissionRequest,
      busy: false,
      streaming: false,
      streamBuffer: '',
      thinkingBuffer: '',
      thinkingStartedAt: null,
      runningTools: {},
    }))
  })

  // ── onFileChange ──
  window.api.ai.onFileChange((data: any) => {
    if (!data.sessionId) return
    aiStore.updateSession(data.sessionId, (s) => {
      const turnIndex = Math.max(0, data.turnIndex ?? 0)

      const turnChanges = [...(s.fileChangesByTurn[turnIndex] || [])]
      turnChanges.push({
        toolUseId: data.toolUseId,
        sessionId: data.sessionId,
        filePath: data.filePath,
        relativePath: data.relativePath,
        action: data.action,
        content: data.content,
        oldContent: data.oldContent,
      })

      const newFileChangesByTurn = [...s.fileChangesByTurn]
      newFileChangesByTurn[turnIndex] = turnChanges
      return { ...s, fileChangesByTurn: newFileChangesByTurn }
    })
  })

  // ── onModelChanged ──
  window.api.ai.onModelChanged(({ sessionId, model }: any) => {
    aiStore.updateSession(sessionId, (s) => ({ ...s, model: model || s.model || '' }))
  })

  // ── onReady ──
  window.api.ai.onReady(({ sessionId, slashCommands, model, worktreePath }: any) => {
    const commands = enrichSlashCommands(slashCommands || [])
    aiStore.updateSession(sessionId, (s) => ({
      ...s, ready: true, busy: s.busy, slashCommands: commands,
      model: model || s.model || '',
      worktreePath: worktreePath || s.worktreePath,
    }))
    aiStore.refreshUserTurns(sessionId)
  })

  // ── onError ──
  window.api.ai.onError(({ sessionId, error, installCmd }: any) => {
    aiStore.updateSession(sessionId, (s) => {
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
        busy: false, streaming: false, streamBuffer: '', thinkingBuffer: '', thinkingStartedAt: null,
        runningTools: {},
        messages,
      }
    })
  })

  document.addEventListener('visibilitychange', () => {
    window.api.ai.setVisible(!document.hidden)
  })
  window.api.ai.setVisible(!document.hidden)
}

initListeners()

// ── Hook:每个 AiTab 只订阅自己 activeSessionId 那一片;只有该 sid 状态变化才 re-render ──
export function useAiSession(sid: string | null): AiSessionState {
  const getSnapshot = useCallback(() => aiStore.getSnapshot(sid), [sid])
  return useSyncExternalStore(aiStore.subscribe, getSnapshot)
}
