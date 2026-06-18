import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile, readdir } from 'fs/promises'
import { join, isAbsolute, relative } from 'path'
import { homedir } from 'os'
import { IPC_CHANNELS, AI_FILE_EDIT_TOOLS } from '../shared/types'
import type { AiCreateOptions, AiToolUse, AiToolResult, AiMessage, AiSendPayload, AiPermissionResponsePayload, AiPermissionMode, AiSetPermissionModePayload } from '../shared/types'

export interface ManagedAiSession {
  process: ChildProcess
  sessionId: string
  cwd: string
  lineBuffer: string
  ready: boolean
  // Cached from system/init event — used by ask-resume to spawn a `--resume` subprocess.
  claudeSessionId?: string
  // Cached from modelUsage in stream-json output — used by calcContextPercent to use the
  // actual model's context window instead of the 200k fallback. GLM-5.2 is 1M, Claude
  // Sonnet/Opus 200k — without this, GLM users see percentage 5× higher than reality.
  contextWindow?: number
  // Permission mode at spawn time — preserved across ask-resume restart.
  permissionMode?: AiPermissionMode
  pendingPermission?: {
    requestId: string
    toolName: string
    toolInput: Record<string, any>
    toolUseId?: string
  }
  // Set when AskUserQuestion arrived — main process kills CLI proactively to
  // prevent LLM from continuing on the auto-filled empty answer (CLI 0.5s
  // auto-timeout fills empty tool_result → LLM calls Write/Edit → overwrites
  // renderer's pendingPermission card). exit handler must NOT emit AI_ERROR
  // for this intentional kill; session must NOT be deleted (claudeSessionId
  // is still needed by ai-ask-resume to spawn `--resume`).
  awaitingUserInput?: boolean
}

export const aiSessions = new Map<string, ManagedAiSession>()
let mainWindow: BrowserWindow | null = null

export function send(channel: string, data: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

const AI_INSTALL_CMD = 'npm install -g @anthropic-ai/claude-code@latest'

export type BinaryResult = { binary: string } | { error: string; installCmd: string }

export function findBinary(): BinaryResult {
  for (const name of ['claude', 'openclaude']) {
    try {
      const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
      execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
      return { binary: name }
    } catch { /* try next */ }
  }
  return { error: `Claude CLI not found. Install with: ${AI_INSTALL_CMD}`, installCmd: AI_INSTALL_CMD }
}

// Sanitize env on Windows: Git Bash / MSYS2 leaks Unix-style vars (HOME, SHELL, OSTYPE, …)
// that confuse the CLI's OS detection. Strip them so the subprocess sees a clean Windows env.
export function sanitizeEnvForCli(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...env }
  if (process.platform === 'win32') {
    const unixVars = [
      'HOME', 'SHELL', 'TERM',
      'MSYSTEM', 'MINGW_PREFIX', 'MINGW_CHOST', 'MSYS',
      'MSYS2_PATH_TYPE', 'MANPATH', 'INFOPATH',
      'HOSTTYPE', 'MACHTYPE', 'OSTYPE',
      'PKG_CONFIG_PATH', 'ORIGINAL_PATH', 'ORIGINAL_TEMP',
      'ORIGINAL_TMP',
    ]
    for (const v of unixVars) delete childEnv[v]
  }
  return childEnv
}

// Build the standard Claude CLI arg list (stream-json + permission-prompt-tool stdio).
// Explicit platform description is appended to --append-system-prompt as a safety net
// in case env sanitization is incomplete.
export function buildClaudeArgs(opts: {
  cwd: string
  permissionMode: AiPermissionMode
  resumeSessionId?: string
}): string[] {
  const platformDesc = process.platform === 'win32'
    ? 'Windows (use paths like C:\\Users\\... with backslashes)'
    : process.platform === 'darwin'
      ? 'macOS (use paths like /Users/...)'
      : 'Linux (use paths like /home/user/...)'

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--permission-prompt-tool', 'stdio',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', opts.permissionMode,
    '--append-system-prompt', `You are running on ${platformDesc}. The workspace directory is: ${opts.cwd}`,
  ]
  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId)
  }
  return args
}

// Spawn a Claude CLI subprocess with the standard args. Returns the ChildProcess on success,
// or the findBinary error result (caller decides how to surface to UI).
export function spawnClaude(opts: {
  cwd: string
  permissionMode: AiPermissionMode
  resumeSessionId?: string
}): ChildProcess | BinaryResult {
  const resolved = findBinary()
  if ('error' in resolved) return resolved

  const args = buildClaudeArgs(opts)
  return spawn(resolved.binary, args, {
    cwd: opts.cwd,
    env: sanitizeEnvForCli(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

function isFileEditTool(toolName: string): boolean {
  return AI_FILE_EDIT_TOOLS.has(toolName)
}

// Calculate context percentage from usage token counts.
// Claude CLI stream-json does NOT include context_window in output;
// only usage (token counts) and modelUsage (with per-model contextWindow) are available.
const DEFAULT_CONTEXT_WINDOW_SIZE = 200000

// Extract the actual contextWindow from CLI's modelUsage block (present on every assistant
// and result message). First model in the map wins — for non-sub-agent turns there's only one.
function extractContextWindow(msg: any): number | undefined {
  const modelUsage = msg?.modelUsage || msg?.message?.modelUsage
  if (!modelUsage || typeof modelUsage !== 'object') return undefined
  const first = Object.values(modelUsage)[0] as any
  return typeof first?.contextWindow === 'number' ? first.contextWindow : undefined
}

function calcContextPercent(usage: any, contextWindow?: number): number | undefined {
  if (!usage) return undefined
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0)
  if (input === 0) return undefined
  const denom = contextWindow || DEFAULT_CONTEXT_WINDOW_SIZE
  return (input / denom) * 100
}

async function extractFileChange(sessionId: string, block: any, cwd: string): Promise<void> {
  const input = block.input || {}
  const filePath = input.file_path || input.path || input.filePath
  if (!filePath) return

  const absPath = isAbsolute(filePath) ? filePath : join(cwd, filePath)
  const relPath = relative(cwd, absPath)
  let oldContent: string | undefined
  try { oldContent = await readFile(absPath, 'utf-8') } catch { /* file may not exist yet */ }
  const newContent = input.content || input.new_content || input.newContent
  send(IPC_CHANNELS.AI_FILE_CHANGE, {
    sessionId,
    filePath: absPath,
    relativePath: relPath,
    action: oldContent !== undefined ? 'edit' : 'create',
    content: newContent,
    oldContent,
  })
}

function handleNdjsonMessage(sessionId: string, msg: any, cwd: string): void {
  switch (msg.type) {
    case 'system': {
      // subtype "init" = session initialized; "status" = requesting/responding (ignore)
      if (msg.subtype === 'status') break
      const s = aiSessions.get(sessionId)
      if (s) {
        s.ready = true
        // Cache CLI's session_id for later --resume (used by ai-ask-resume Kill-and-Resume path)
        if (msg.session_id) s.claudeSessionId = msg.session_id
      }
      send(IPC_CHANNELS.AI_READY, { sessionId, tools: msg.tools, model: msg.model, slashCommands: msg.slash_commands })
      break
    }

    case 'assistant': {
      const content = msg.message?.content
      if (!Array.isArray(content)) break
      const textParts: string[] = []
      const thinkingParts: string[] = []
      const toolUses: AiToolUse[] = []
      for (const block of content) {
        if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'thinking') {
          if (block.thinking) thinkingParts.push(block.thinking)
        } else if (block.type === 'tool_use') {
          toolUses.push({ id: block.id, name: block.name, input: block.input })
          // [PLAN-MODE-DEBUG] spot ExitPlanMode tool_use (should be followed by control_request)
          if (block.name === 'ExitPlanMode' || block.name === 'EnterPlanMode') {
            console.log(`[PLAN-MODE-DEBUG ${sessionId}] tool_use ${block.name} id=${block.id} inputKeys=${Object.keys(block.input || {}).join(',')}`)
          }
          if (isFileEditTool(block.name)) {
            extractFileChange(sessionId, block, cwd)
          }
        }
      }
      // CLI emits intermediate assistant messages after each content block.
      // All are sent through — thinking-only messages preserve per-turn thinking.
      if (textParts.length === 0 && toolUses.length === 0 && thinkingParts.length === 0) break
      const parentToolUseId = msg.message?.parent_tool_use_id
      const session = aiSessions.get(sessionId)
      const cw = extractContextWindow(msg)
      if (session && cw) session.contextWindow = cw
      send(IPC_CHANNELS.AI_MESSAGE, {
        sessionId,
        type: 'assistant',
        role: 'assistant',
        messageId: msg.message?.id,
        content: textParts.join('\n'),
        thinking: thinkingParts.length > 0 ? thinkingParts.join('\n') : undefined,
        toolUse: toolUses.length > 0 ? toolUses : undefined,
        parentToolUseId: parentToolUseId || undefined,
        contextPercent: calcContextPercent(msg.message?.usage, session?.contextWindow),
        timestamp: Date.now(),
      })
      break
    }

    // Streaming text deltas — CLI wraps Anthropic API events inside stream_event:
    // {type:"stream_event", event:{type:"content_block_delta", delta:{type:"text_delta", text:"..."}}, ...}
    case 'stream_event': {
      const innerEvent = msg.event?.type
      if (innerEvent === 'content_block_delta') {
        const delta = msg.event.delta
        const deltaType = delta?.type
        if (deltaType === 'text_delta' && delta.text) {
          send(IPC_CHANNELS.AI_STREAM_TOKEN, { sessionId, token: delta.text })
        } else if (deltaType === 'thinking_delta' && delta.thinking) {
          send(IPC_CHANNELS.AI_STREAM_TOKEN, { sessionId, token: delta.thinking, kind: 'thinking' })
        }
        // Skip signature_delta, input_json_delta — not for live display
      }
      break
    }

    // Anthropic API-style content block deltas (text_delta / input_json_delta)
    case 'content_block_delta': {
      const deltaType = msg.delta?.type
      let token = ''
      if (deltaType === 'text_delta') {
        token = msg.delta?.text || ''
      } else if (deltaType === 'input_json_delta') {
        token = msg.delta?.partial_json || ''
      } else {
        token = msg.delta?.text || msg.delta?.partial_json || ''
      }
      if (token) {
        send(IPC_CHANNELS.AI_STREAM_TOKEN, { sessionId, token })
      }
      break
    }

    // Some CLI versions wrap API events inside an outer message
    case 'content_block_start':
    case 'content_block_stop':
    case 'message_start':
    case 'message_delta':
    case 'message_stop':
    // Heartbeat from CLI — no action needed
    case 'keep_alive':
    // Confirmation that a control_request was cancelled
    case 'control_cancel_request':
      // No text content in these — just metadata markers, ignore
      break

    case 'permission_request':
    case 'control_request': {
      // claude CLI uses 'control_request' with --permission-prompt-tool stdio
      // Format: {type:"control_request", request_id:"...", request:{subtype:"can_use_tool", tool_name, input}}
      const toolName = msg.request?.tool_name || msg.tool_name || 'unknown'
      const toolInput = msg.request?.input || msg.request?.tool_input || msg.tool_input || {}
      const requestId = msg.request_id || msg.tool_use_id || msg.id || `perm-${Date.now()}`
      const command = toolInput.command || toolInput.file_path || ''

      const toolUseId = msg.tool_use_id || msg.request?.tool_use_id || ''

      // Cache in session so control_response can include tool_name + tool_input + toolUseID
      const session = aiSessions.get(sessionId)
      if (session) {
        session.pendingPermission = { requestId, toolName, toolInput, toolUseId }
      }

      // AskUserQuestion is special: Claude CLI auto-fills empty answers ~0.5s after
      // sending the control_request. If we just respond (deny or wait), LLM still
      // sees the auto-filled empty tool_result and proceeds — calls Write/Edit
      // (whose control_request then overwrites renderer's pendingPermission card)
      // or streams text pollution.
      //
      // Fix: kill the subprocess immediately. The CLI never gets to auto-fill an
      // answer, so LLM cannot continue. Real answer arrives via ai-ask-resume
      // (kill is a no-op on an already-dead process; spawn `--resume` + fresh user
      // message carries the user's selection). The card stays displayed because
      // pendingPermission is renderer-side state; session is preserved (not deleted)
      // so ask-resume can read claudeSessionId/cwd/permissionMode.
      if (toolName === 'AskUserQuestion' && session) {
        session.awaitingUserInput = true
        killAiProcess(session.process)
        console.log(`[PLAN-MODE-DEBUG ${sessionId}] AskUserQuestion killed CLI proactively (prevents LLM continuing on auto-filled empty answer); card surfaced, awaiting user answer via ask-resume`)
      }

      // [PLAN-MODE-DEBUG] trace every permission request — this is what should drive the UI card
      const fp = toolInput?.file_path || toolInput?.path || ''
      console.log(`[PLAN-MODE-DEBUG ${sessionId}] control_request tool=${toolName} req_id=${requestId} toolInputKeys=${Object.keys(toolInput || {}).join(',')}${fp ? ` file_path=${fp}` : ''} → sending IPC AI_PERMISSION`)

      send(IPC_CHANNELS.AI_PERMISSION, {
        sessionId,
        requestId,
        tool: toolName,
        description: `${toolName}: ${command}`,
        command,
        toolInput,
      })
      break
    }

    case 'tool_progress':
      send(IPC_CHANNELS.AI_PROGRESS, {
        sessionId,
        toolUseId: msg.tool_use_id,
        tool: msg.tool_name || msg.tool,
        elapsed: msg.elapsed_time_seconds,
      })
      break

    case 'result': {
      // CLI 旧版本可能不带 subtype，按 is_error 兜底
      const subtype = msg.subtype || (msg.is_error ? 'error_during_execution' : 'success')
      send(IPC_CHANNELS.AI_MESSAGE, {
        sessionId,
        type: 'result',
        content: msg.result,
        subtype,
        isAborted: !!msg.is_aborted,
        costUsd: msg.total_cost_usd,
        durationMs: msg.duration_ms,
        numTurns: msg.num_turns,
        contextPercent: calcContextPercent(msg.usage, aiSessions.get(sessionId)?.contextWindow),
        timestamp: Date.now(),
      })
      break
    }

    // 'user' messages (tool_result) — pass through for context display
    case 'user': {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            // [PERMISSION-DEBUG] see what LLM gets back after a permission decision
            const tc = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            console.log(`[PERMISSION-DEBUG ${sessionId}] tool_result id=${block.tool_use_id} is_error=${block.is_error} content=${tc.slice(0, 120)}`)
            send(IPC_CHANNELS.AI_MESSAGE, {
              sessionId,
              type: 'user',
              role: 'user',
              toolResult: {
                toolUseId: block.tool_use_id,
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                isError: block.is_error || false,
              },
              timestamp: Date.now(),
            })
          }
        }
      }
      break
    }

    default:
      // Log unknown message types for debugging new CLI versions
      console.log(`[ai:${sessionId}] unhandled NDJSON type='${msg.type}':`, JSON.stringify(msg).slice(0, 300))
      break
  }
}

// ── Session list: read from ~/.claude/projects/<normalized-cwd>/ ──
// Claude CLI stores sessions as <session-id>.jsonl files under project directories.
// Normalization: D:\path → d--path (:\ → --, \ → -, . → -, lowercase drive)

function normalizeCwdToProjectDir(cwd: string): string {
  let normalized = cwd
  // Windows drive: D:\ → D--
  if (/^[A-Za-z]:[\\\/]/.test(normalized)) {
    normalized = normalized[0] + '--' + normalized.slice(3)
  }
  return normalized.replace(/[\\\/.]/g, '-')
}

async function listSessionsForCwd(cwd: string): Promise<{ sessions: any[] }> {
  const projectsRoot = join(homedir(), '.claude', 'projects')
  let projectDirName = normalizeCwdToProjectDir(cwd).toLowerCase()

  // Try both lowercase and original case
  const allDirs = await readdir(projectsRoot).catch(() => [] as string[])
  const match = allDirs.find(d => d === projectDirName || d === normalizeCwdToProjectDir(cwd))
  if (!match) return { sessions: [] }

  const projectDir = join(projectsRoot, match)
  const files = await readdir(projectDir).catch(() => [] as string[])
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))

  // Read metadata from each session file (first few lines only)
  const sessions: any[] = []
  for (const jsonlFile of jsonlFiles) {
    const sessionId = jsonlFile.replace('.jsonl', '')
    try {
      const content = await readFile(join(projectDir, jsonlFile), 'utf-8')
      const lines = content.split('\n').filter(Boolean)

      let name = sessionId
      let timestamp = 0
      let model = ''
      // Scan first ~20 lines for first user message
      for (const line of lines.slice(0, 20)) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'user' && msg.message?.role === 'user' && typeof msg.message.content === 'string') {
            name = msg.message.content.slice(0, 60)
            timestamp = new Date(msg.timestamp).getTime()
            break
          }
          if (msg.type === 'assistant' && msg.message?.model) {
            model = msg.message.model
          }
        } catch { /* skip malformed lines */ }
      }
      // Skip sessions with no user message
      if (timestamp === 0) continue

      sessions.push({ session_id: sessionId, name, timestamp, model })
    } catch { /* skip unreadable files */ }
  }

  // Sort most recent first
  sessions.sort((a, b) => b.timestamp - a.timestamp)
  return { sessions: sessions.slice(0, 30) }
}

// ── Load full session history from .jsonl for resume display ──

function resolveProjectDir(cwd: string): string | null {
  const projectsRoot = join(homedir(), '.claude', 'projects')
  // Synchronous scan needed here — only a few dirs
  try {
    const allDirs = require('fs').readdirSync(projectsRoot)
    const lowerName = normalizeCwdToProjectDir(cwd).toLowerCase()
    const upperName = normalizeCwdToProjectDir(cwd)
    const match = allDirs.find(d => d === lowerName || d === upperName)
    return match ? join(projectsRoot, match) : null
  } catch { return null }
}

async function loadSessionMessages(resumeSessionId: string, cwd: string): Promise<{
  messages: AiMessage[]
  model: string
  slashCommands: string[]
}> {
  const projectDir = resolveProjectDir(cwd)
  if (!projectDir) return { messages: [], model: '', slashCommands: [] }

  const jsonlPath = join(projectDir, `${resumeSessionId}.jsonl`)
  let content: string
  try { content = await readFile(jsonlPath, 'utf-8') } catch { return { messages: [], model: '', slashCommands: [] } }

  const lines = content.split('\n').filter(Boolean)
  const messages: AiMessage[] = []
  let model = ''
  const slashCommands: string[] = []

  // Track tool_use IDs so we can merge tool_result into them
  const toolUseIndex = new Map<string, { msgIdx: number; toolIdx: number }>()

  for (const line of lines) {
    let msg: any
    try { msg = JSON.parse(line) } catch { continue }

    // Skip non-conversation lines
    if (['permission-mode', 'file-history-snapshot', 'stream_event', 'content_block_delta',
      'content_block_start', 'content_block_stop', 'message_start', 'message_delta',
      'message_stop', 'keep_alive', 'control_cancel_request', 'tool_progress',
      'permission_request', 'control_request', 'attachment'].includes(msg.type)) continue

    const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now()
    const sid = resumeSessionId

    if (msg.type === 'system') {
      if (msg.subtype === 'init') {
        model = msg.model || model
        if (Array.isArray(msg.slash_commands)) {
          for (const c of msg.slash_commands) slashCommands.push(c)
        }
      }
      continue
    }

    if (msg.type === 'assistant') {
      const contentArr = msg.message?.content
      if (!Array.isArray(contentArr)) continue
      const textParts: string[] = []
      const thinkingParts: string[] = []
      const toolUses: AiToolUse[] = []
      for (const block of contentArr) {
        if (block.type === 'text') textParts.push(block.text)
        else if (block.type === 'thinking' && block.thinking) thinkingParts.push(block.thinking)
        else if (block.type === 'tool_use') {
          const tu: AiToolUse = { id: block.id, name: block.name, input: block.input }
          toolUses.push(tu)
          // Record position so we can merge tool_result later
          toolUseIndex.set(block.id, { msgIdx: messages.length, toolIdx: toolUses.length - 1 })
        }
      }
      if (textParts.length === 0 && toolUses.length === 0 && thinkingParts.length === 0) continue
      messages.push({
        sessionId: sid, type: 'assistant', role: 'assistant',
        content: textParts.join('\n') || undefined,
        thinking: thinkingParts.length > 0 ? thinkingParts.join('\n') : undefined,
        toolUse: toolUses.length > 0 ? toolUses : undefined,
        contextPercent: calcContextPercent(msg.message?.usage, aiSessions.get(sid)?.contextWindow),
        timestamp: ts,
      })
      continue
    }

    if (msg.type === 'user') {
      const userContent = msg.message?.content
      // String content: simple user message
      if (typeof userContent === 'string') {
        messages.push({
          sessionId: sid, type: 'user', role: 'user',
          content: userContent, timestamp: ts,
        })
        continue
      }
      // Array content: may contain tool_result blocks
      if (Array.isArray(userContent)) {
        for (const block of userContent) {
          if (block.type === 'tool_result') {
            const toolUseId = block.tool_use_id
            const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            const result: AiToolResult = { toolUseId, content: resultContent, isError: block.is_error || false }

            // Merge into existing assistant message's toolUse if found
            const pos = toolUseIndex.get(toolUseId)
            if (pos) {
              const existingMsg = messages[pos.msgIdx]
              if (existingMsg.toolUse) {
                existingMsg.toolUse[pos.toolIdx] = { ...existingMsg.toolUse[pos.toolIdx], result }
              }
              // No separate AiMessage for merged tool_result
            }
          }
        }
        // If the user content also has a text part (rare), add as user message
        const textPart = userContent.find(b => b.type === 'text')
        if (textPart) {
          messages.push({
            sessionId: sid, type: 'user', role: 'user',
            content: textPart.text, timestamp: ts,
          })
        }
      }
      continue
    }

    if (msg.type === 'result') {
      if (msg.is_error) {
        messages.push({
          sessionId: sid, type: 'result',
          error: msg.errors?.join('\n') || msg.result || 'Unknown error',
          timestamp: ts,
        })
      } else {
        messages.push({
          sessionId: sid, type: 'result',
          content: msg.result,
          costUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
          durationMs: msg.duration_ms,
          contextPercent: calcContextPercent(msg.usage, aiSessions.get(sid)?.contextWindow),
          timestamp: ts,
        })
      }
      continue
    }
  }

  return { messages, model, slashCommands }
}

// Attach all process event handlers (stdout/stderr/error/exit) to a spawned Claude CLI process.
// Shared between initial AI_CREATE spawn and plan-execute restart — extracted so
// the restart path reuses identical NDJSON parsing / error reporting / lifecycle logic.
export function attachAiProcess(sessionId: string, proc: ChildProcess, cwd: string): void {
  const session: ManagedAiSession = {
    process: proc,
    sessionId,
    cwd,
    lineBuffer: '',
    ready: true,
  }
  aiSessions.set(sessionId, session)

  const stderrChunks: string[] = []
  send(IPC_CHANNELS.AI_READY, { sessionId })

  const startupTimer = setTimeout(() => {
    if (session.lineBuffer === '' && aiSessions.has(sessionId)) {
      console.warn(`[ai:${sessionId}] No stdout received in 8s — CLI may not support the given flags`)
    }
  }, 8000)

  proc.stdout!.on('data', (chunk: Buffer) => {
    session.lineBuffer += chunk.toString('utf-8')
    const lines = session.lineBuffer.split('\n')
    session.lineBuffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        handleNdjsonMessage(sessionId, JSON.parse(trimmed), cwd)
      } catch {
        console.warn(`[ai:${sessionId}] NDJSON parse failed:`, trimmed.slice(0, 200))
      }
    }
  })

  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim()
    if (text) {
      stderrChunks.push(text)
      console.error(`[ai:${sessionId}] stderr:`, text.slice(0, 500))
    }
  })

  proc.on('error', (err) => {
    clearTimeout(startupTimer)
    // Only handle if this is still the active process for this session
    // (a new process may have been spawned for the same sessionId via resume)
    const current = aiSessions.get(sessionId)
    if (current?.process.pid === proc.pid) {
      aiSessions.delete(sessionId)
      send(IPC_CHANNELS.AI_ERROR, { sessionId, error: err.message })
    }
  })

  proc.on('exit', (code, signal) => {
    clearTimeout(startupTimer)
    // Only handle if this is still the active process for this session
    const current = aiSessions.get(sessionId)
    if (current?.process.pid === proc.pid) {
      // AskUserQuestion proactive kill: keep session (ask-resume needs claudeSessionId),
      // skip AI_ERROR — this exit is intentional, not a crash.
      if (current!.awaitingUserInput === true) {
        return
      }
      aiSessions.delete(sessionId)
      if (code !== 0 && code !== null) {
        const stderrMsg = stderrChunks.join('\n').trim()
        const baseMsg = `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`
        const errorDetail = stderrMsg ? `${baseMsg}\n\n${stderrMsg}` : baseMsg
        send(IPC_CHANNELS.AI_ERROR, {
          sessionId,
          error: errorDetail,
        })
      }
    }
  })
}

// Kill an active AI subprocess. Uses taskkill /f /t on Windows to terminate the process tree
// (claude.cmd spawns node children; SIGTERM only kills the cmd wrapper).
export function killAiProcess(proc: ChildProcess): void {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'])
    } catch { /* ignore */ }
  } else {
    try { proc.kill('SIGTERM') } catch { /* ignore */ }
  }
}

export function registerAiHandlers(win: BrowserWindow | null): void {
  mainWindow = win

  // List available sessions for resume
  ipcMain.handle(IPC_CHANNELS.AI_LIST_SESSIONS, async (_event, cwd?: string) => {
    return listSessionsForCwd(cwd || '')
  })

  // Load full message history from .jsonl for resume display
  ipcMain.handle(IPC_CHANNELS.AI_LOAD_SESSION_MESSAGES, async (_event, resumeSessionId: string, cwd: string) => {
    return loadSessionMessages(resumeSessionId, cwd)
  })

  // Check if claude/openclaude CLI is available
  ipcMain.handle(IPC_CHANNELS.AI_CHECK_AVAILABLE, () => {
    const result = findBinary()
    if ('binary' in result) {
      return { available: true, binary: result.binary }
    }
    return { available: false, error: result.error, installCmd: result.installCmd }
  })

  // Spawn claude/openclaude subprocess
  ipcMain.handle(IPC_CHANNELS.AI_CREATE, async (_event, options: AiCreateOptions) => {
    const { sessionId, cwd, autoApprove, permissionMode, resumeSessionId } = options

    // Kill existing session if any
    const existing = aiSessions.get(sessionId)
    if (existing) {
      existing.process.kill('SIGTERM')
      aiSessions.delete(sessionId)
    }

    const permMode: AiPermissionMode = permissionMode || (autoApprove ? 'acceptEdits' : 'bypassPermissions')

    const result = spawnClaude({ cwd, permissionMode: permMode, resumeSessionId })
    if ('error' in result) {
      send(IPC_CHANNELS.AI_ERROR, {
        sessionId,
        error: result.error,
        installCmd: result.installCmd,
      })
      return { success: false, error: result.error, installCmd: result.installCmd }
    }

    attachAiProcess(sessionId, result, cwd)

    // Cache spawn-time permissionMode so ai-ask-resume can preserve it across restart
    const created = aiSessions.get(sessionId)
    if (created) created.permissionMode = permMode

    return { success: true }
  })

  // Send user message via stdin
  ipcMain.handle(IPC_CHANNELS.AI_SEND, (_event, payload: AiSendPayload) => {
    const session = aiSessions.get(payload.sessionId)
    if (!session || !session.ready) return { success: false, error: 'AI not ready' }
    const ndjson = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: payload.message },
    }) + '\n'
    session.process.stdin!.write(ndjson)
    return { success: true }
  })

  // Respond to permission request
  ipcMain.handle(IPC_CHANNELS.AI_PERMISSION_RESPONSE, (_event, payload: AiPermissionResponsePayload) => {
    const session = aiSessions.get(payload.sessionId)
    if (!session) return { success: false, error: 'Session not found' }

    const pending = session.pendingPermission
    const requestId = payload.requestId || pending?.requestId || ''
    const toolInput = payload.toolInput || pending?.toolInput || {}
    const toolUseId = pending?.toolUseId || ''

    // Correct NDJSON format for --permission-prompt-tool stdio:
    // {type:"control_response", response:{subtype:"success", request_id:"...", response:{behavior:..., ...}}}
    const decision = payload.approved
      ? { behavior: 'allow', updatedInput: toolInput, toolUseID: toolUseId }
      : { behavior: 'deny', message: payload.feedback || 'User denied permission', toolUseID: toolUseId }

    const ndjson = JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: decision,
      },
    }) + '\n'
    // [PERMISSION-DEBUG] trace exactly what we send to stdin so we can diff against ZodError
    console.log(`[PERMISSION-DEBUG ${payload.sessionId}] control_response → tool=${payload.tool} approved=${payload.approved} req_id=${requestId.slice(0, 8)} pending.req=${(pending?.requestId || '').slice(0, 8)} payload=${JSON.stringify({ behavior: decision.behavior, hasUpdatedInput: !!toolInput, updatedInputKeys: Object.keys(toolInput || {}).join(','), message: (decision as any).message?.slice(0, 60) })}`)
    session.process.stdin!.write(ndjson)

    // Clear cached permission
    session.pendingPermission = undefined
    return { success: true }
  })

  // Switch permission mode at runtime (no subprocess restart).
  // Claude CLI 2.1.139 supports control_request subtype=set_permission_mode via raw stream-json
  // stdin. Without this, switching ModeSelector only updates React state — subprocess keeps the
  // old --permission-mode from spawn time, so "plan" UI display lies about actual mode.
  ipcMain.handle(IPC_CHANNELS.AI_SET_PERMISSION_MODE, (_event, payload: AiSetPermissionModePayload) => {
    const session = aiSessions.get(payload.sessionId)
    if (!session || !session.ready) return { success: false, error: 'AI not ready' }

    const ndjson = JSON.stringify({
      type: 'control_request',
      request_id: `set-mode-${randomUUID()}`,
      request: {
        subtype: 'set_permission_mode',
        mode: payload.mode,
      },
    }) + '\n'
    session.process.stdin!.write(ndjson)
    return { success: true }
  })

  // Cancel current operation
  ipcMain.handle(IPC_CHANNELS.AI_CANCEL, (_event, sessionId: string) => {
    const session = aiSessions.get(sessionId)
    if (!session) return false
    // Send SIGINT for graceful cancellation
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(session.process.pid), '/f', '/t'])
    } else {
      session.process.kill('SIGINT')
    }
    return true
  })

  // Destroy session entirely
  ipcMain.handle(IPC_CHANNELS.AI_DESTROY, (_event, sessionId: string) => {
    const session = aiSessions.get(sessionId)
    if (!session) return false
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(session.process.pid), '/f', '/t'])
    } else {
      session.process.kill('SIGTERM')
    }
    aiSessions.delete(sessionId)
    return true
  })
}

export function cleanupAiSessions(): void {
  for (const [_, session] of aiSessions) {
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(session.process.pid), '/f', '/t'])
      } catch { /* ignore */ }
    } else {
      session.process.kill('SIGTERM')
    }
  }
  aiSessions.clear()
}
