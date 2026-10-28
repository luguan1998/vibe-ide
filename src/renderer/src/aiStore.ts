import { useSyncExternalStore, useCallback } from 'react'
import type { AiBackend, AiMessage, AiSessionState, AiSlashCommand, AiPermissionMode, AiPermissionRequest, UserTurn } from '@shared/types'

// ── 纯函数 & 常量(从 AiTab.tsx 抽出,供 store 与组件共用)──

export const EMPTY_SESSION: AiSessionState = {
  backend: 'claude',
  ready: false, busy: false, messages: [],
  streaming: false, streamBuffer: '', thinkingBuffer: '', thinkingStartedAt: null, pendingPermission: null,
  slashCommands: [], model: '', contextPercent: null, name: '',
  fileChangesByTurn: [], userTurns: [],
  cwd: '', worktreePath: undefined, worktreeBranch: undefined, pipedPrompt: '',
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

// ── thinking / 正文分段合并 ───────────────────────────────────────
// 同一 messageId 的 assistant 事件是分段到达的（每个 content block 一条），thinking 也随之分片。
// 判定"这段是否已经出现过"要剥掉全部空白再比：主进程把多个 thinking block 用 '\n' 拼起来
// （thinkingParts.join('\n')），而渲染层累积的是原始 token 流（无分隔符），同一段在这两处的换行/缩进
// 必然对不齐；只按 includes 比对会把重复段判成新内容。
function squash(s: string): string {
  return s.replace(/\s+/g, '')
}

function mergePiece(oldS: string | undefined, newS: string | undefined, sep: string): string | undefined {
  const o = oldS || ''
  const n = newS || ''
  if (!n.trim()) return oldS
  if (!o.trim()) return newS
  // 原文就互为包含（流式重发的常见情形）先用 O(n) indexOf 判定，省掉两次去空白复制
  if (n.includes(o)) return n
  if (o.includes(n)) return o
  const os = squash(o)
  const ns = squash(n)
  if (ns === os) return n.length >= o.length ? n : o
  if (ns.includes(os)) return n
  if (os.includes(ns)) return o
  return o + sep + n
}

// 剥掉 thinking 后既无正文、无工具、也无错误：这条只剩空壳，整条丢弃
function isEmptyShell(m: AiMessage): boolean {
  return !m.content && !m.error && !m.toolResult && !(m.toolUse && m.toolUse.length > 0)
}

// 跨消息去重：相邻两条 assistant 消息的 thinking 互为包含（同一段被拆成两条、同一个 block 被重复
// 投递、流式残段被后来的完整段覆盖等）时只保留完整的那段，残段清空 thinking；清空后既无正文又无
// 工具的空壳整条丢弃。
// 只比最新一条与它前面最近的一条：本函数在每个 message 事件后都跑一次，任何一对在"刚成为相邻"
// 那一刻就已判过，重复回扫整个尾部窗口只是白算（实测 3.5 倍开销、结果完全一致）。
// 丢壳会让再前面两条变成新的相邻对，故剥完一轮再回看，直到没有变化
function mergeAdjacentThinking(messages: AiMessage[], i: number): AiMessage[] {
  const cur = messages[i]
  if (i <= 0 || cur.role !== 'assistant' || !cur.thinking) return messages
  let prevIdx = -1
  for (let j = i - 1; j >= 0; j--) {
    const jm = messages[j]
    if (jm.role === 'assistant' && jm.thinking) { prevIdx = j; break }
    // 之间夹着的 tool_result / result 回填不是回合边界，真实用户输入才是；跨回合的两段相同思考
    // （同一句话反复说）不作去重
    if (jm.role === 'user' && jm.type === 'user' && !jm.toolResult && jm.content) return messages
  }
  if (prevIdx < 0) return messages
  const prev = messages[prevIdx]
  if (prev.parentToolUseId !== cur.parentToolUseId) return messages
  const a = squash(prev.thinking!)
  const b = squash(cur.thinking)
  if (!b.includes(a) && !a.includes(b)) return messages
  // 互为包含时留 thinking 更完整的那条；完全相等则留先到的那条（不重排顺序、不丢正文/工具）
  const lostIdx = a !== b && b.includes(a) ? prevIdx : i
  const lost = messages[lostIdx]
  const next = isEmptyShell(lost)
    ? messages.slice(0, lostIdx).concat(messages.slice(lostIdx + 1))
    : (() => { const c = messages.slice(); c[lostIdx] = { ...lost, thinking: undefined }; return c })()
  return mergeAdjacentThinking(next, next.length - 1)
}

function dedupeThinking(messages: AiMessage[]): AiMessage[] {
  return mergeAdjacentThinking(messages, messages.length - 1)
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

// 网状视图投递：切到（或新建）分支会话后，由该会话的 AiTab 在 ready 时把文本发出去
const pendingSends = new Map<string, string>()

export function queuePendingSend(sid: string, text: string): void {
  pendingSends.set(sid, text)
  aiStore.updateSession(sid, (s) => ({ ...s, pendingSendTick: (s.pendingSendTick ?? 0) + 1 }))
}

export function takePendingSend(sid: string): string | undefined {
  const text = pendingSends.get(sid)
  if (text !== undefined) pendingSends.delete(sid)
  return text
}

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
  backend: AiBackend
  resumeSessionId?: string
  cliCommand?: string
  configDir?: string
  enableWorktree?: boolean
  worktreePath?: string
  model?: string
  computerUse?: boolean
  browserUse?: boolean
}

export function readAiCliConfig(): { cliCommand?: string; configDir?: string } {
  try {
    return {
      cliCommand: localStorage.getItem('vibe-ide-ai-cli-command') || undefined,
      configDir: localStorage.getItem('vibe-ide-ai-config-dir') || undefined,
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
      // destroy+重建（worktree/新会话/GUI 开关切换）保留会话级操控标记与后端选择
      next[sid] = { ...EMPTY_SESSION, backend: prev[sid].backend, computerUse: prev[sid].computerUse, browserUse: prev[sid].browserUse }
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
  // 斜杠/+ 菜单打开时按需扫盘（CLI 空会话不发 init，slash_commands 拿不到）。
  // 空表 = 内置表 + 自定义；已有权威表 = 只并入缺的自定义项（新建 skill 免重启可见）
  async fetchSlashCommands(sid: string) {
    if (!sid) return
    const backend = sessionStates[sid]?.backend ?? 'claude'
    try {
      const cwd = sessionStates[sid]?.cwd || ''
      const custom = (await window.api.ai.resolveSkills(sid, cwd)) || []
      if (backend === 'pi') {
        // pi 的斜杠命令全部来自 get_commands 探测，没有 Claude 内置表可并入
        const next = custom
          .filter(c => c.name)
          .map(c => ({ name: c.name, description: c.description || c.name }))
        aiStore.updateSession(sid, (s) => ({ ...s, slashCommands: next }))
        return
      }
      aiStore.updateSession(sid, (s) => {
        const known = new Set(s.slashCommands.map(c => c.name))
        const extra = custom
          .filter(c => c.name && !known.has(c.name))
          .map(c => ({ name: c.name, description: c.description || c.name }))
        if (s.slashCommands.length > 0) {
          return extra.length > 0 ? { ...s, slashCommands: [...s.slashCommands, ...extra] } : s
        }
        const builtin = enrichSlashCommands(Object.keys(SLASH_COMMAND_DESCRIPTIONS))
        const bnames = new Set(Object.keys(SLASH_COMMAND_DESCRIPTIONS))
        return { ...s, slashCommands: [...builtin, ...extra.filter(c => !bnames.has(c.name))] }
      })
    } catch { /* ignore */ }
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
    const backend: AiBackend = opts.backend
    const cliCommand = backend === 'claude' ? (opts.cliCommand ?? fallback.cliCommand) : undefined
    const configDir = opts.configDir ?? fallback.configDir
    window.api.ai.checkAvailable(cliCommand, backend).then((result: any) => {
      if (!result.available) {
        aiStore.updateSession(sid, () => ({
          ...EMPTY_SESSION,
          backend,
          ready: true,
          messages: [{
            sessionId: sid, type: 'result' as const,
            error: result.error || (backend === 'pi' ? 'Pi CLI not found' : 'Claude CLI not found'),
            installCmd: result.installCmd,
            timestamp: Date.now(),
          }],
        }))
        return
      }
      const finish = (messages: any[], model: string, slashCommands: any[], actualCwd?: string) => {
        const createCwd = actualCwd || opts.cwd
        window.api.ai.create({
          sessionId: sid,
          cwd: createCwd,
          autoApprove: opts.autoApprove,
          permissionMode: opts.permissionMode,
          backend,
          ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
          ...(cliCommand ? { cliCommand } : {}),
          ...(configDir ? { configDir } : {}),
          ...(opts.enableWorktree ? { enableWorktree: true } : {}),
          ...(opts.worktreePath ? { worktreePath: opts.worktreePath } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.computerUse ? { computerUse: true } : {}),
          ...(opts.browserUse ? { browserUse: true } : {}),
        })
        aiStore.updateSession(sid, (s) => ({
          ...EMPTY_SESSION,
          backend,
          cwd: createCwd,
          messages,
          model,
          slashCommands: enrichSlashCommands(slashCommands),
          computerUse: s.computerUse,
          browserUse: s.browserUse,
          // resume/fork 后轮次下标域不变（parseUserTurns 全文件域），
          // 保留历史变更数据，否则该会话"回退代码"永远空转
          fileChangesByTurn: s.fileChangesByTurn,
        }))
      }
      if (opts.resumeSessionId && backend === 'claude') {
        // CLI --resume 不重放历史事件流，须先从 JSONL 预填历史（与 resumeSession 一致），
        // 否则 fork/恢复的新会话渲染空白。pi 的历史由主进程 get_messages 回放。
        window.api.ai.loadSessionMessages(opts.resumeSessionId, opts.cwd, configDir)
          .then((history: any) => finish(history?.messages || [], history?.model || '', history?.slashCommands || [], history?.actualCwd))
          .catch(() => finish([], '', []))
      } else {
        finish([], '', [])
      }
    }).catch(() => {
      aiStore.updateSession(sid, () => ({
        ...EMPTY_SESSION,
        backend,
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
    browserUse?: boolean
  }): Promise<{ resumed: boolean; cwd?: string }> {
    const fallback = readAiCliConfig()
    const cliCommand = opts.cliCommand ?? fallback.cliCommand
    const configDir = opts.configDir ?? fallback.configDir
    createdSessions.add(sid)
    let messages: any[] = []
    let model = ''
    let slashCommands: any[] = []
    let resumeCwd = cwd
    let actualCwd: string | undefined
    try {
      const history = await window.api.ai.loadSessionMessages(historySessionId, resumeCwd, configDir)
      messages = history.messages || []
      model = history.model || ''
      slashCommands = history.slashCommands || []
      actualCwd = history.actualCwd
    } catch {}
    // 如果传入的 cwd 找不到 JSONL，可能持久化里存的是 UI 目录而不是会话实际目录
    // （例如 worktree / 子目录启动）。尝试从全量历史里按 session_id 找到真实 cwd 再试一次。
    if (messages.length === 0) {
      try {
        const all = await window.api.ai.listAllSessions(configDir)
        const found = (all?.sessions || []).find((s: any) => s.session_id === historySessionId)
        if (found && typeof found.cwd === 'string' && found.cwd) {
          resumeCwd = found.cwd
          const history = await window.api.ai.loadSessionMessages(historySessionId, resumeCwd, configDir)
          messages = history.messages || []
          model = history.model || ''
          slashCommands = history.slashCommands || []
          actualCwd = history.actualCwd
        }
      } catch {}
    }
    // 如果确实找不到 JSONL，才降级为新建空白 GUI，避免 CLI 报 “No conversation found”。
    const resumed = messages.length > 0
    // 用 JSONL 首行记录的真实 cwd 发起 CLI —— 入参 cwd 可能与真实 cwd 不一致
    // （worktree/符号链接/大小写/尾部斜杠），CLI 推 projectDir 会落空而当成新会话。
    const createCwd = actualCwd || resumeCwd
    try { await window.api.ai.destroy(sid) } catch {}
    window.api.ai.create({
      sessionId: sid,
      cwd: createCwd,
      autoApprove: opts.autoApprove,
      permissionMode: opts.permissionMode,
      backend: 'claude',
      ...(resumed ? { resumeSessionId: historySessionId } : {}),
      ...(cliCommand ? { cliCommand } : {}),
      ...(configDir ? { configDir } : {}),
      ...(opts.computerUse ? { computerUse: true } : {}),
      ...(opts.browserUse ? { browserUse: true } : {}),
    })
    aiStore.updateSession(sid, (s) => ({
      ...EMPTY_SESSION,
      messages,
      model,
      slashCommands: enrichSlashCommands(slashCommands),
      name: opts.name || '',
      cwd: createCwd,
      ready: false,
      fileChangesByTurn: s.fileChangesByTurn,
      computerUse: s.computerUse,
      browserUse: s.browserUse,
    }))
    return { resumed, cwd: createCwd }
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
  handleAskUserQuestion(
    sessionId: string, requestId: string, approved: boolean,
    tool: string, toolInput?: Record<string, any>
  ) {
    // 拒绝 = 暂停本轮：不能给 CLI 回 deny —— 实测模型会把 "User denied" 当成「此题跳过」，
    // 继续把剩下的活干完。走 forceStop 的 kill + --resume 重开，进程停在空闲，
    // 会话保住，等下一条用户消息，且不产生任何模型输出。
    // 补一条 isAborted result：被 kill 的进程不会自己发 result，不补就没有「暂停」标记
    if (!approved) {
      aiStore.updateSession(sessionId, s => ({
        ...s,
        pendingPermission: null,
        messages: [...s.messages, { sessionId, type: 'result', subtype: 'success', isAborted: true, timestamp: Date.now() } as AiMessage],
      }))
      void aiStore.forceStop(sessionId)
      return
    }
    // 同意：answers 塞进 updatedInput 走普通 control_response，进程不重启
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
    window.api.ai.respondPermission(sessionId, requestId, true, tool, { ...toolInput, answers })
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
    // pause 强杀后 CLI --resume 会 fork 出新报文（无 result 事件），
    // 重拉真实轮次，否则回退节点停留在旧报文上。pi 无 JSONL 轮次域，跳过。
    if ((sessionStates[sid]?.backend ?? 'claude') === 'claude') aiStore.refreshUserTurns(sid)
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
    // 子代理（Task/Agent）收尾也发 result（带 parentToolUseId）：只结束子代理，主回合仍在跑
    const isMainResult = msg.type === 'result' && !msg.parentToolUseId
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
      // 差分而非整段补发:streamBuffer 是 token 累积,msg.content/thinking 是 cleanText 后的最终版,
      // 正常应为 buffer 前缀(trim 差异);先 trim 再比对，否则 buffer 首尾换行会让前缀对不上 →
      // 整段补发 → 正文重复；整段已含于 target 时也判覆盖，只补真正的增量尾部
      const tailNotCovered = (buf: string, covered: string | undefined): string => {
        const b = buf.trim()
        if (!b) return ''
        const target = covered ?? ''
        if (target.includes(b)) return ''
        // 只差空白（'A\n\nB' vs 'A\nB'）时逐字符前缀走会停在换行处 → 补出 "B" 这类重复残段，
        // 故再按去空白口径比一次：已覆盖就整段算覆盖
        if (target && squash(target).includes(squash(b))) return ''
        let i = 0
        const max = Math.min(b.length, target.length)
        while (i < max && b[i] === target[i]) i++
        return i >= b.length ? '' : b.slice(i)
      }
      const extraThinking = coveredByMergedThinking ? '' : tailNotCovered(s0.thinkingBuffer, msg.thinking)
      const extraText = coveredByMergedText ? '' : tailNotCovered(s0.streamBuffer, msg.content)
      const hasExtra = extraThinking || extraText

      const flushedMsg = (hasExtra && s0.streaming && (isAssistant || isMainResult))
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
        // 去重:new 与 old 互为包含（含只差空白的重复段）时不拼接，直接取更完整的那份，
        // 防 o+n 拼出重复正文；空白 new 视为无更新
        const merged: AiMessage = {
          ...lastMsg,
          content: mergePiece(lastMsg.content, msg.content, '') || undefined,
          thinking: mergePiece(lastMsg.thinking, msg.thinking, '\n\n') || undefined,
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
      messages = dedupeThinking(messages)

      const clearThinking = isAssistant && (!!msg.thinking || (isSameMessageId && !!lastMsg?.thinking))
      const clearText = isAssistant && (!!msg.content || (isSameMessageId && !!lastMsg?.content))

      const isUserMsg = msg.type === 'user' && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()
      const newName = isUserMsg && !s0.name ? msg.content.trim().slice(0, 60) : s0.name

      let runningTools = s0.runningTools
      if (isMainResult) {
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

      // 插话后 CLI 中断被抓切的 turn：result 带 isAborted，且距插话打点 ≤5s → 视为切轮
      // 而非停止，busy 保持 true（停止按钮两段式武装不因闪烁被重置），直到新 turn 消息流清掉标志
      const interjectCutover = msg.type === 'result' && msg.isAborted
        && s0.interjectingAt != null && Date.now() - s0.interjectingAt < 5000

      return {
        ...s0,
        messages,
        name: newName,
        busy: interjectCutover ? true : (s0.busy && !isMainResult),
        streaming: isMainResult ? false : s0.streaming,
        streamBuffer: clearText || isMainResult ? '' : s0.streamBuffer,
        thinkingBuffer: clearThinking || isMainResult ? '' : s0.thinkingBuffer,
        thinkingStartedAt: clearThinking || isMainResult ? null : s0.thinkingStartedAt,
        // 子代理消息（parentToolUseId）的 percent 是子代理自身上下文，勿覆盖 session 级
        contextPercent: msg.contextPercent != null && !msg.parentToolUseId ? Math.round(msg.contextPercent) : s0.contextPercent,
        runningTools,
        // pi 的权限请求超时由 agent 侧自动 resolve，轮次结束即作废，卡片不滞留
        pendingPermission: isMainResult && s0.backend === 'pi' ? null : s0.pendingPermission,
        interjectingAt: isMainResult ? (interjectCutover ? s0.interjectingAt : undefined) : undefined,
      }
    })
    if (isMainResult) aiStore.refreshUserTurns(msg.sessionId)
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
      // 回退只认「该文件在本回合首次改动前的旧内容」（AiTab 的 filesToRevert 用 Map 取首次命中），
      // 同一回合对同一文件的后续改动再存一份整文件全文纯属重复占用
      if (turnChanges.some(c => c.relativePath === data.relativePath)) return s
      turnChanges.push({
        toolUseId: data.toolUseId,
        sessionId: data.sessionId,
        filePath: data.filePath,
        relativePath: data.relativePath,
        action: data.action,
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
  window.api.ai.onReady(({ sessionId, slashCommands, model, worktreePath, worktreeBranch, thinkingLevel }: any) => {
    const commands = enrichSlashCommands(slashCommands || [])
    aiStore.updateSession(sessionId, (s) => ({
      // spawn 时的空壳 ready（及 revert 的 slashCommands:[]）不得清空已扫出的命令表
      ...s, ready: true, busy: s.busy, slashCommands: commands.length > 0 ? commands : s.slashCommands,
      model: model || s.model || '',
      worktreePath: worktreePath || s.worktreePath,
      // CLI 在 ready 后才建树，晚轮询命中会用同一条 ready 事件补发，这里合并保留
      worktreeBranch: worktreeBranch || s.worktreeBranch,
      thinkingLevel: thinkingLevel || s.thinkingLevel,
    }))
    if ((sessionStates[sessionId]?.backend ?? 'claude') === 'claude') aiStore.refreshUserTurns(sessionId)
  })

  // ── onError ──
  window.api.ai.onError(({ sessionId, error, installCmd }: any) => {
    // 主进程对 "--resume 找不到会话报文" 已自动免 resume 重开 CLI；
    // 渲染层同步把现场重置为新对话，不渲染死错误卡片
    if (typeof error === 'string' && error.includes('No conversation found with session ID')) {
      aiStore.updateSession(sessionId, (s) => ({
        ...EMPTY_SESSION,
        cwd: s.cwd,
        model: s.model,
        slashCommands: s.slashCommands,
        ready: true,
        fileChangesByTurn: s.fileChangesByTurn,
      }))
      return
    }
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
