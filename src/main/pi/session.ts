import { randomUUID } from 'crypto'
import type { ChildProcess } from 'child_process'
import { IPC_CHANNELS, type AiCreateOptions, type AiMessage, type AiPermissionRequest } from '../../shared/types'
import { send } from '../ai-shared'
import { PiRpc } from './rpc'
import { attachPiLineReader, piBinaryForSpawn, killPiProcess, spawnPi, writePiLine } from './process'
import {
  agentEndWillRetry, asRecord, assistantDeltaFromEvent, buildPiSpawnArgs, contextFromSessionStats, contextFromUsage,
  extensionUiResponse, extensionUiTitle, isAbortedAssistant, isAgentSettled, needsExtensionUiReply, parseExtensionUiRequest,
  sessionFromState, stringField, textFromContent, thinkingFromContent, thinkingLevelsFromData, toolCallsFromContent,
  toolExecutionEndFromEvent, toolExecutionStartFromEvent, toolExecutionUpdateFromEvent, turnErrorFromEvent,
  type PiExtensionUiRequest,
} from './protocol'
import { piRecordToMessage } from './messages'

interface PiSession {
  sessionId: string
  cwd: string
  child: ChildProcess | null
  rpc: PiRpc | null
  piSessionId?: string
  contextWindow?: number
  usedTokens?: number
  model?: string
  thinkingLevel?: string
  messageId: string | null
  toolNameById: Map<string, string>
  toolStartedAt: Map<string, number>
  activeTurn: boolean
  settling: boolean
  abortRequested: boolean
  sawAborted: boolean
  turnError: string | null
  retrying: boolean
  compacting: boolean
  pendingUi: Map<string, PiExtensionUiRequest>
}

const piSessions = new Map<string, PiSession>()

export function hasPiSession(sessionId: string): boolean {
  return piSessions.has(sessionId)
}

function contextPercentOf(session: PiSession): number | null {
  if (!session.contextWindow || !session.usedTokens) return null
  return Math.round((session.usedTokens / session.contextWindow) * 100)
}

function emitMessage(session: PiSession, message: Omit<AiMessage, 'sessionId' | 'timestamp'>): void {
  send(IPC_CHANNELS.AI_MESSAGE, { sessionId: session.sessionId, timestamp: Date.now(), ...message })
}

export async function createPiSession(options: AiCreateOptions): Promise<{ success: boolean; error?: string; installCmd?: string }> {
  destroyPiSession(options.sessionId)
  const resolved = piBinaryForSpawn()
  if ('error' in resolved) {
    send(IPC_CHANNELS.AI_ERROR, { sessionId: options.sessionId, error: resolved.error, installCmd: resolved.installCmd })
    return { success: false, error: resolved.error, installCmd: resolved.installCmd }
  }
  let proc: ChildProcess
  try {
    proc = spawnPi(resolved.binary, buildPiSpawnArgs({ resume: options.resumeSessionId, model: options.model }), options.cwd)
  } catch (error: any) {
    const message = error?.message ?? String(error)
    send(IPC_CHANNELS.AI_ERROR, { sessionId: options.sessionId, error: message })
    return { success: false, error: message }
  }
  const session: PiSession = {
    sessionId: options.sessionId,
    cwd: options.cwd,
    child: proc,
    rpc: null,
    messageId: null,
    toolNameById: new Map(),
    toolStartedAt: new Map(),
    activeTurn: false,
    settling: false,
    abortRequested: false,
    sawAborted: false,
    turnError: null,
    retrying: false,
    compacting: false,
    pendingUi: new Map(),
  }
  piSessions.set(options.sessionId, session)
  session.rpc = new PiRpc('Pi', (payload) => writePiLine(proc, payload), (rec) => handleFrame(session, rec))
  attachPiLineReader(proc, (line) => session.rpc?.pushLine(line), (code) => handleProcessExit(session, code))

  // 像 claude 后端一样先放行输入框：pi 启动要 ~1s（Node CLI 冷启），期间 stdin 会缓冲，
  // 首条 prompt 在初始化完成后照常处理，不阻塞用户。session_id/model 稍后补推一次 READY。
  send(IPC_CHANNELS.AI_READY, { sessionId: options.sessionId, cwd: options.cwd, slashCommands: [] })

  try {
    const state = await session.rpc.request({ type: 'get_state' }, 45000)
    const info = sessionFromState(state.data)
    session.piSessionId = info.sessionId
    session.contextWindow = info.contextWindow
    session.model = info.model
    session.thinkingLevel = info.thinkingLevel
  } catch (error: any) {
    const message = error?.message ?? String(error)
    destroyPiSession(options.sessionId)
    send(IPC_CHANNELS.AI_ERROR, { sessionId: options.sessionId, error: `Pi init failed: ${message}` })
    return { success: false, error: message }
  }
  if (options.resumeSessionId) await pushHistory(session)
  send(IPC_CHANNELS.AI_READY, {
    sessionId: options.sessionId,
    session_id: session.piSessionId,
    cwd: session.cwd,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    slashCommands: [],
  })
  if (session.model) send(IPC_CHANNELS.AI_MODEL_CHANGED, { sessionId: options.sessionId, model: session.model })
  return { success: true }
}

// Pi keeps its own session store; replaying get_messages is the only way a
// resumed conversation shows history (there is no Claude-style JSONL to load).
async function pushHistory(session: PiSession): Promise<void> {
  if (!session.rpc) return
  let messages: unknown[] = []
  try {
    const res = await session.rpc.request({ type: 'get_messages' }, 30000)
    const list = asRecord(res.data)?.messages
    if (Array.isArray(list)) messages = list
  } catch {
    return
  }
  for (let i = 0; i < messages.length; i++) {
    const mapped = piRecordToMessage(messages[i], `pi-hist-${i}`)
    if (mapped) emitMessage(session, mapped)
  }
}

export function sendPiTurn(sessionId: string, message: string): { success: boolean; error?: string } {
  const session = piSessions.get(sessionId)
  if (!session?.rpc) return { success: false, error: 'Pi not ready' }
  try {
    if (session.activeTurn) {
      session.rpc.request({ type: 'prompt', message, streamingBehavior: 'steer' }, 15000).catch(() => {})
    } else {
      session.activeTurn = true
      session.sawAborted = false
      session.rpc.request({ type: 'prompt', message }, 15000).catch((error: any) => {
        send(IPC_CHANNELS.AI_ERROR, { sessionId, error: error?.message ?? String(error) })
        void settle(session)
      })
    }
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) }
  }
}

export function cancelPiTurn(sessionId: string): boolean {
  const session = piSessions.get(sessionId)
  if (!session?.rpc) return false
  session.abortRequested = true
  session.rpc.request({ type: 'abort' }, 5000).catch(() => {})
  return true
}

export async function forceStopPi(sessionId: string): Promise<{ success: boolean; error?: string }> {
  const session = piSessions.get(sessionId)
  if (!session) return { success: false, error: 'Session not found' }
  const resumeId = session.piSessionId
  if (!resumeId) return { success: false, error: 'No pi session id cached' }
  const options: AiCreateOptions = {
    sessionId,
    cwd: session.cwd,
    autoApprove: false,
    permissionMode: 'bypassPermissions',
    resumeSessionId: resumeId,
    ...(session.model ? { model: session.model } : {}),
  }
  killPiProcess(session.child)
  session.rpc?.close()
  piSessions.delete(sessionId)
  const result = await createPiSession(options)
  return result.success ? { success: true } : { success: false, error: result.error }
}

export function destroyPiSession(sessionId: string): boolean {
  const session = piSessions.get(sessionId)
  if (!session) return false
  piSessions.delete(sessionId)
  session.rpc?.close()
  killPiProcess(session.child)
  return true
}

export function cleanupPiSessions(): void {
  for (const session of piSessions.values()) {
    session.rpc?.close()
    killPiProcess(session.child)
  }
  piSessions.clear()
}

export function setPiModel(sessionId: string, model: string): { success: boolean; error?: string } {
  const session = piSessions.get(sessionId)
  if (!session?.rpc) return { success: false, error: 'Pi not ready' }
  const separator = model.indexOf('/')
  if (separator <= 0 || separator === model.length - 1) return { success: false, error: `Invalid pi model: ${model}` }
  session.model = model
  session.rpc.request({ type: 'set_model', provider: model.slice(0, separator), modelId: model.slice(separator + 1) }, 15000)
    .then((res) => {
      const data = asRecord(res.data)
      const window = asRecord(data?.model)?.contextWindow ?? data?.contextWindow
      if (typeof window === 'number' && window > 0) session.contextWindow = window
      send(IPC_CHANNELS.AI_MODEL_CHANGED, { sessionId, model })
    })
    .catch((error: any) => {
      console.warn('[pi] set_model failed:', error?.message)
    })
  return { success: true }
}

export async function piThinkingLevels(sessionId: string): Promise<{ levels: string[]; current: string | null } | null> {
  const session = piSessions.get(sessionId)
  if (!session?.rpc) return null
  try {
    const res = await session.rpc.request({ type: 'get_available_thinking_levels' }, 10000)
    return { levels: thinkingLevelsFromData(res.data), current: session.thinkingLevel ?? null }
  } catch {
    return { levels: [], current: session.thinkingLevel ?? null }
  }
}

export async function setPiThinkingLevel(sessionId: string, level: string): Promise<{ success: boolean; error?: string }> {
  const session = piSessions.get(sessionId)
  if (!session?.rpc) return { success: false, error: 'Pi not ready' }
  try {
    await session.rpc.request({ type: 'set_thinking_level', level }, 10000)
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) }
  }
  session.thinkingLevel = level
  return { success: true }
}

export function piContextInfo(sessionId: string): { usedTokens: number | null; contextWindow: number | null } | null {
  const session = piSessions.get(sessionId)
  if (!session) return null
  return { usedTokens: session.usedTokens ?? null, contextWindow: session.contextWindow ?? null }
}

export function setPiContextWindow(sessionId: string, contextWindow: number): { success: boolean; contextPercent: number | null } {
  const session = piSessions.get(sessionId)
  if (!session) return { success: false, contextPercent: null }
  session.contextWindow = Math.max(1000, Math.round(contextWindow))
  return { success: true, contextPercent: contextPercentOf(session) }
}

// ── Inbound permission round trip ────────────────────────────────────────

function emitPermission(session: PiSession, ui: PiExtensionUiRequest): void {
  const requestId = `pi:${ui.id}`
  session.pendingUi.set(requestId, ui)
  const permission: AiPermissionRequest = ui.method === 'confirm'
    ? {
        sessionId: session.sessionId,
        requestId,
        tool: 'Pi',
        description: ui.title,
        ...(ui.message ? { command: ui.message } : {}),
        toolInput: { piUiId: ui.id, piMethod: ui.method },
      }
    : {
        sessionId: session.sessionId,
        requestId,
        tool: 'AskUserQuestion',
        description: extensionUiTitle(ui),
        toolInput: {
          piUiId: ui.id,
          piMethod: ui.method,
          questions: [{
            question: ui.title,
            header: 'Pi',
            multiSelect: false,
            options: ui.method === 'select' ? ui.options.map((label) => ({ label })) : [],
          }],
        },
      }
  send(IPC_CHANNELS.AI_PERMISSION, permission)
}

export function respondPiPermission(
  sessionId: string,
  requestId: string,
  approved: boolean,
  toolInput?: Record<string, any>,
  feedback?: string,
): { success: boolean; error?: string } {
  const session = piSessions.get(sessionId)
  if (!session?.child) return { success: false, error: 'Session not found' }
  const ui = session.pendingUi.get(requestId)
  if (!ui) return { success: false, error: 'No pending Pi request' }
  let value: string | undefined
  const answers = asRecord(toolInput?.answers)
  if (answers) {
    const first = Object.values(answers)[0]
    if (typeof first === 'string' && first.trim()) value = first
  }
  if (value === undefined && feedback?.trim()) value = feedback.trim()
  try {
    writePiLine(session.child, extensionUiResponse(ui, approved ? 'allow' : 'deny', value))
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) }
  }
  session.pendingUi.delete(requestId)
  return { success: true }
}

// ── Frame handling ───────────────────────────────────────────────────────

function handleFrame(session: PiSession, rec: Record<string, any>): void {
  const ui = parseExtensionUiRequest(rec)
  if (ui) {
    if (needsExtensionUiReply(ui)) emitPermission(session, ui)
    else console.debug('[pi]', extensionUiTitle(ui))
    return
  }
  const type = stringField(rec, 'type')
  if (type === 'compaction_start') { session.compacting = true; return }
  if (type === 'compaction_end') { session.compacting = false; return }
  if (type === 'auto_retry_start') { session.retrying = true; return }
  if (type === 'auto_retry_end') { session.retrying = false; return }

  const turnError = turnErrorFromEvent(rec)
  if (turnError !== null) session.turnError = turnError
  if (isAbortedAssistant(rec)) session.sawAborted = true

  const usage = contextFromUsage(rec, session.contextWindow)
  if (usage?.used) session.usedTokens = usage.used
  if (usage?.window) session.contextWindow = usage.window

  const delta = assistantDeltaFromEvent(rec)
  if (delta) {
    send(IPC_CHANNELS.AI_STREAM_TOKEN, {
      sessionId: session.sessionId,
      token: delta.text,
      ...(delta.kind === 'thinking' ? { kind: 'thinking' } : {}),
    })
  }

  if (type === 'message_start') {
    const message = asRecord(rec.message)
    if (stringField(message, 'role') === 'assistant') session.messageId = `pi-${randomUUID()}`
  }

  const execStart = toolExecutionStartFromEvent(rec)
  if (execStart) {
    session.toolNameById.set(execStart.id, execStart.name)
    session.toolStartedAt.set(execStart.id, Date.now())
    send(IPC_CHANNELS.AI_PROGRESS, { sessionId: session.sessionId, toolUseId: execStart.id, tool: execStart.name, elapsed: 0 })
  }
  const execUpdate = toolExecutionUpdateFromEvent(rec)
  if (execUpdate) {
    const startedAt = session.toolStartedAt.get(execUpdate.id)
    send(IPC_CHANNELS.AI_PROGRESS, {
      sessionId: session.sessionId,
      toolUseId: execUpdate.id,
      tool: session.toolNameById.get(execUpdate.id) ?? 'tool',
      elapsed: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
    })
  }
  const execEnd = toolExecutionEndFromEvent(rec)
  if (execEnd) {
    session.toolStartedAt.delete(execEnd.toolCallId)
    emitMessage(session, {
      type: 'user',
      role: 'user',
      toolResult: { toolUseId: execEnd.toolCallId, content: execEnd.content, isError: execEnd.isError },
    })
  }

  if (type === 'message_end') {
    const message = asRecord(rec.message)
    if (message && stringField(message, 'role') === 'assistant') {
      const content = textFromContent(message.content)
      const thinking = thinkingFromContent(message.content)
      const toolUse = toolCallsFromContent(message.content)
      const messageId = session.messageId ?? `pi-${randomUUID()}`
      session.messageId = null
      for (const tool of toolUse) session.toolNameById.set(tool.id, tool.name)
      emitMessage(session, {
        type: 'assistant',
        role: 'assistant',
        messageId,
        ...(content.trim() ? { content } : {}),
        ...(thinking.trim() ? { thinking } : {}),
        ...(toolUse.length > 0 ? { toolUse } : {}),
      })
    }
  }

  if (isAgentSettled(rec)) {
    void settle(session)
    return
  }
  const willRetry = agentEndWillRetry(rec)
  if (willRetry === true) {
    session.turnError = null
    return
  }
  if (willRetry === false && !session.compacting && !session.retrying) void settle(session)
}

async function settle(session: PiSession): Promise<void> {
  if (session.settling || !session.activeTurn) return
  session.settling = true
  try {
    if (session.rpc) {
      try {
        const stats = await session.rpc.request({ type: 'get_session_stats' }, 4000)
        const context = contextFromSessionStats(stats.data)
        if (context?.used) session.usedTokens = context.used
        if (context?.window) session.contextWindow = context.window
      } catch { /* meter keeps the last streamed usage */ }
    }
    const aborted = session.abortRequested || session.sawAborted
    session.activeTurn = false
    session.abortRequested = false
    session.sawAborted = false
    const error = session.turnError
    session.turnError = null
    session.pendingUi.clear()
    if (error) send(IPC_CHANNELS.AI_ERROR, { sessionId: session.sessionId, error })
    emitMessage(session, {
      type: 'result',
      subtype: 'success',
      contextPercent: contextPercentOf(session),
      ...(aborted ? { isAborted: true } : {}),
    })
  } finally {
    session.settling = false
  }
}

function handleProcessExit(session: PiSession, code: number | null): void {
  if (piSessions.get(session.sessionId) !== session) return
  piSessions.delete(session.sessionId)
  session.rpc?.close()
  send(IPC_CHANNELS.AI_ERROR, {
    sessionId: session.sessionId,
    error: `Pi process exited${code === null ? '' : ` (code ${code})`}`,
  })
}
