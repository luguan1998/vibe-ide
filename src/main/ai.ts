import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import { readFile, readdir } from 'fs/promises'
import { join, isAbsolute, relative } from 'path'
import { homedir } from 'os'
import { IPC_CHANNELS, AI_FILE_EDIT_TOOLS } from '../shared/types'
import type { AiCreateOptions, AiToolUse, AiToolResult, AiMessage, AiSendPayload, AiPermissionResponsePayload, AiPermissionMode } from '../shared/types'

interface ManagedAiSession {
  process: ChildProcess
  sessionId: string
  cwd: string
  lineBuffer: string
  ready: boolean
  pendingPermission?: {
    requestId: string
    toolName: string
    toolInput: Record<string, any>
    toolUseId?: string
  }
}

const aiSessions = new Map<string, ManagedAiSession>()
let mainWindow: BrowserWindow | null = null

function send(channel: string, data: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

const AI_INSTALL_CMD = 'npm install -g @anthropic-ai/claude-code@latest'

type BinaryResult = { binary: string } | { error: string; installCmd: string }

function findBinary(): BinaryResult {
  for (const name of ['claude', 'openclaude']) {
    try {
      const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
      execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
      return { binary: name }
    } catch { /* try next */ }
  }
  return { error: `Claude CLI not found. Install with: ${AI_INSTALL_CMD}`, installCmd: AI_INSTALL_CMD }
}

function isFileEditTool(toolName: string): boolean {
  return AI_FILE_EDIT_TOOLS.has(toolName)
}

// Calculate context percentage from usage token counts.
// Claude CLI stream-json does NOT include context_window in output;
// only usage (token counts) is available.
const DEFAULT_CONTEXT_WINDOW_SIZE = 200000

function calcContextPercent(usage: any): number | undefined {
  if (!usage) return undefined
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0)
  if (input === 0) return undefined
  return (input / DEFAULT_CONTEXT_WINDOW_SIZE) * 100
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
      if (s) s.ready = true
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
          if (isFileEditTool(block.name)) {
            extractFileChange(sessionId, block, cwd)
          }
        }
      }
      // CLI emits intermediate assistant messages after each content block.
      // All are sent through — thinking-only messages preserve per-turn thinking.
      if (textParts.length === 0 && toolUses.length === 0 && thinkingParts.length === 0) break
      send(IPC_CHANNELS.AI_MESSAGE, {
        sessionId,
        type: 'assistant',
        role: 'assistant',
        content: textParts.join('\n'),
        thinking: thinkingParts.length > 0 ? thinkingParts.join('\n') : undefined,
        toolUse: toolUses.length > 0 ? toolUses : undefined,
        contextPercent: calcContextPercent(msg.message?.usage),
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

    case 'result':
      if (msg.is_error) {
        send(IPC_CHANNELS.AI_ERROR, {
          sessionId,
          error: msg.errors?.join('\n') || msg.result || 'Unknown error',
        })
      }
      send(IPC_CHANNELS.AI_MESSAGE, {
        sessionId,
        type: 'result',
        content: msg.result,
        costUsd: msg.total_cost_usd,
        durationMs: msg.duration_ms,
        numTurns: msg.num_turns,
        contextPercent: calcContextPercent(msg.usage),
        timestamp: Date.now(),
      })
      break

    // 'user' messages (tool_result) — pass through for context display
    case 'user': {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
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
        contextPercent: calcContextPercent(msg.message?.usage),
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
          contextPercent: calcContextPercent(msg.usage),
          timestamp: ts,
        })
      }
      continue
    }
  }

  return { messages, model, slashCommands }
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

    // Pre-check binary availability
    const resolved = findBinary()
    if ('error' in resolved) {
      send(IPC_CHANNELS.AI_ERROR, {
        sessionId,
        error: resolved.error,
        installCmd: resolved.installCmd,
      })
      return { success: false, error: resolved.error, installCmd: resolved.installCmd }
    }
    const bin = resolved.binary

    // Kill existing session if any
    const existing = aiSessions.get(sessionId)
    if (existing) {
      existing.process.kill('SIGTERM')
      aiSessions.delete(sessionId)
    }

    const permMode: AiPermissionMode = permissionMode || (autoApprove ? 'acceptEdits' : 'default')

    // Sanitize env: remove Unix-style / MSYS vars on Windows so the CLI detects the correct OS.
    // (pty.ts already does similar sanitization for encoding)
    const childEnv: NodeJS.ProcessEnv = { ...process.env }
    if (process.platform === 'win32') {
      // Git Bash / MSYS2 leaks Unix-style vars that confuse CLI OS detection
      const unixVars = [
        'HOME', 'SHELL', 'TERM',
        'MSYSTEM', 'MINGW_PREFIX', 'MINGW_CHOST', 'MSYS',
        'MSYS2_PATH_TYPE', 'MANPATH', 'INFOPATH',
        'HOSTTYPE', 'MACHTYPE', 'OSTYPE',
        'PKG_CONFIG_PATH', 'ORIGINAL_PATH', 'ORIGINAL_TEMP',
        'ORIGINAL_TMP',
      ]
      for (const v of unixVars) {
        delete childEnv[v]
      }
    }

    // Explicit platform context so the model always uses correct paths,
    // even if env cleanup above is insufficient.
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
      '--permission-mode', permMode,
      '--append-system-prompt', `You are running on ${platformDesc}. The workspace directory is: ${cwd}`,
    ]
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId)
    }

    const proc = spawn(bin, args, {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    const session: ManagedAiSession = {
      process: proc,
      sessionId,
      cwd,
      lineBuffer: '',
      ready: true,   // ready immediately — process is alive and can accept stdin
    }
    aiSessions.set(sessionId, session)

    // Collect stderr for better error messages when process exits with non-zero code
    const stderrChunks: string[] = []

    // Notify renderer: session is alive, UI can enable the input.
    // Not all claude CLI versions emit a 'system' NDJSON message, so we must
    // signal ready here rather than waiting for one.
    send(IPC_CHANNELS.AI_READY, { sessionId })

    // Fallback: if no stdout arrives within 8s, log a warning (flags/format mismatch).
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
      : { behavior: 'deny', message: 'User denied permission', toolUseID: toolUseId }

    const ndjson = JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: decision,
      },
    }) + '\n'
    session.process.stdin!.write(ndjson)

    // Clear cached permission
    session.pendingPermission = undefined
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
