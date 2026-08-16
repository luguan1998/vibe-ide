import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile, readdir, stat, rm } from 'fs/promises'
import { join, isAbsolute, relative, basename } from 'path'
import { homedir } from 'os'
import { IPC_CHANNELS, AI_FILE_EDIT_TOOLS } from '../shared/types'
import type { AiCreateOptions, AiToolUse, AiToolResult, AiMessage, AiSendPayload, AiPermissionResponsePayload, AiPermissionMode, AiSetPermissionModePayload, AiSetModelPayload, UserTurn, AiReply, AiSessionSummary } from '../shared/types'

export interface ManagedAiSession {
  process: ChildProcess
  sessionId: string
  cwd: string
  lineBuffer: string
  ready: boolean
  claudeSessionId?: string
  contextWindow?: number
  permissionMode?: AiPermissionMode
  model?: string
  configDir?: string
  cliCommand?: string
  pendingPermission?: {
    requestId: string
    toolName: string
    toolInput: Record<string, any>
    toolUseId?: string
  }
  cancelRequested?: boolean
  awaitingUserInput?: boolean
  seenToolUseIds?: Set<string>
  revertAwaitingReady?: boolean
  enableWorktree?: boolean
  worktreePath?: string
  preWorktreeSnapshot?: Set<string>
  persona?: string
  computerUse?: boolean
}

const LOCAL_CMD_TAG_RE = /<local-command-caveat>[\s\S]*?<\/local-command-caveat>|<command-name>[\s\S]*?<\/command-name>|<command-message>[\s\S]*?<\/command-message>|<command-args>[\s\S]*?<\/command-args>|<local-command-stdout>[\s\S]*?<\/local-command-stdout>|<system-reminder>[\s\S]*?<\/system-reminder>/g

export function cleanText(s: string): string {
  return s.replace(LOCAL_CMD_TAG_RE, '').trim()
}

const COMMAND_NAME_RE = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/

// 从 slash 命令的 caveat/command/stdout 组行重建纯文本（如 "/model haiku"）。
// command-name 内容已含 `/`，不另补。无 command-name 返回 ''。
function reconstructSlashCommand(groupContents: string[]): string {
  let name = ''
  let args = ''
  for (const c of groupContents) {
    const nm = c.match(COMMAND_NAME_RE)
    if (nm) name = nm[1].trim()
    const am = c.match(COMMAND_ARGS_RE)
    if (am) args = am[1].trim()
  }
  if (!name) return ''
  return args ? `${name} ${args}` : name
}

// Parse JSONL lines into user turns — single source of truth for revert/fork indexing,
// shared by truncateJsonlAtUserMessage, loadSessionMessages, and the listUserTurns IPC.
// A slash group = consecutive user-string lines with empty cleanText (caveat/command/stdout
// wrappers); reconstructSlashCommand rebuilds "/model haiku" from them, counting the group
// as 1 turn. Non-user lines (system/attachment/queue-operation) interspersed within a group
// do NOT break it: a failing /model that emits its error as a mid-group type=system line must
// still count as 1, not 2 (the bug that corrupted revert indices). A group ends only at a
// cleanText-non-empty user text or a new isMeta caveat.
export function parseUserTurns(lines: string[]): UserTurn[] {
  const turns: UserTurn[] = []
  let i = 0
  while (i < lines.length) {
    let msg: any
    try { msg = JSON.parse(lines[i]) } catch { i++; continue }
    const isUserStr = msg.type === 'user' && typeof msg.message?.content === 'string'
    if (!isUserStr) { i++; continue }

    const cleaned = cleanText(msg.message.content)
    if (cleaned !== '') {
      // 系统注入消息（AskUserQuestion 回答、plan 批准、continuation）带 isMeta，
      // 只存在于 JSONL，不计入用户轮次，否则重载渲染成用户气泡且 revert 索引错位。
      // 兜底：修复前写入的旧会话无 isMeta 标记，按内容特征识别
      if (msg.isMeta === true
        || cleaned.includes('AskUserQuestionResultBase64:')
        || cleaned.startsWith('The user skipped this AskUserQuestion')) {
        i++; continue
      }
      turns.push({ lineIdx: i, content: cleaned, isInternal: false })
      i++
      continue
    }

    const groupStart = i
    const groupContents: string[] = [msg.message.content]
    let j = i + 1
    while (j < lines.length) {
      let nxt: any
      try { nxt = JSON.parse(lines[j]) } catch { break }
      const nxtUserStr = nxt.type === 'user' && typeof nxt.message?.content === 'string'
      if (!nxtUserStr) { j++; continue }
      if (cleanText(nxt.message.content) !== '') break
      if (nxt.isMeta) break
      groupContents.push(nxt.message.content)
      j++
    }
    const reconstructed = reconstructSlashCommand(groupContents)
    if (reconstructed) {
      turns.push({ lineIdx: groupStart, content: reconstructed, isInternal: true })
    }
    i = j
  }
  return turns
}

export const aiSessions = new Map<string, ManagedAiSession>()
// Reverse map: CLI session ID (e.g. "claude-xxx") → renderer session ID ("term-xxxxx")
// Used by loadSessionMessages to look up contextWindow from the correct aiSessions entry.
const cliSessionToRenderer = new Map<string, string>()
let mainWindow: BrowserWindow | null = null

// 窗口可能在运行期重建（macOS activate 等），快照引用会失效，
// 由 index.ts 在窗口创建/销毁时同步更新。
export function setAiMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}
let rendererVisible = true

export function send(channel: string, data: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (channel === IPC_CHANNELS.AI_STREAM_TOKEN && !rendererVisible) return
    mainWindow.webContents.send(channel, data)
  }
}

const AI_INSTALL_CMD = 'npm install -g @anthropic-ai/claude-code@latest'

type BinaryResult = { binary: string } | { error: string; installCmd: string }
type SpawnError = { error: string; installCmd: string }

function findBinary(customCommand?: string): BinaryResult {
  const names = customCommand ? [customCommand] : ['claude', 'openclaude', 'opencc']
  for (const name of names) {
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
function sanitizeEnvForCli(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
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
function buildClaudeArgs(opts: {
  cwd: string
  permissionMode: AiPermissionMode
  resumeSessionId?: string
  model?: string
  enableWorktree?: boolean
  persona?: string
  mcpConfigPath?: string
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
  if (opts.model) {
    args.push('--model', opts.model)
  }
  if (opts.enableWorktree) {
    args.push('--worktree')
  }
  if (opts.persona?.trim()) {
    args.push('--append-system-prompt', opts.persona.trim())
  }
  if (opts.mcpConfigPath) {
    args.push('--mcp-config', opts.mcpConfigPath)
  }
  return args
}

// Spawn a Claude CLI subprocess with the standard args. Returns the ChildProcess on success,
// or the findBinary error result (caller decides how to surface to UI).
function snapshotWorktrees(cwd: string): Set<string> {
  try {
    const output = execSync('git worktree list --porcelain', { cwd, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
    const paths = new Set<string>()
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) paths.add(line.replace('worktree ', '').trim())
    }
    return paths
  } catch { return new Set() }
}

// The CLI mirrors the config-dir name inside the repo as its project-local folder (claude →
// ./.claude/worktrees, openclaude → ./.openclaude/worktrees, a custom ".opencc" → ./.opencc/worktrees).
// Deriving the marker from the config dir keeps one field driving both history lookup
// (~/.opencc/projects) and worktree detection — no per-binary hard-coding.
function configDirMarker(configDir?: string): string {
  return basename(resolveConfigDir(configDir))
}

function isCliWorktree(p: string, marker: string): boolean {
  return p.includes(`${marker}/worktrees/`) || p.includes(`${marker}\\worktrees\\`)
}

function detectNewWorktree(cwd: string, before: Set<string>, marker: string): string | null {
  try {
    const after = snapshotWorktrees(cwd)
    for (const p of after) {
      if (!before.has(p) && isCliWorktree(p, marker)) return p
    }
  } catch { /* ignore */ }
  return null
}

// Destroy fallback: find any worktree spawned since preSnapshot that ready-detection
// never recorded (path lacks <config-dir>/worktrees, e.g. cwd is not the repo root).
function detectUnmanagedWorktree(cwd: string, before: Set<string>): string | null {
  try {
    const after = snapshotWorktrees(cwd)
    for (const p of after) {
      if (!before.has(p)) return p
    }
  } catch { /* ignore */ }
  return null
}

// The CLI creates the worktree a moment after the ready message, so poll every
// 500ms (up to ~4s) to record it for destroy cleanup.
function trackWorktreeLater(sessionId: string, attempts: number): void {
  setTimeout(() => {
    const cur = aiSessions.get(sessionId)
    if (!cur || cur.worktreePath) return
    const wt = detectNewWorktree(cur.cwd, cur.preWorktreeSnapshot!, configDirMarker(cur.configDir))
    if (wt) {
      cur.worktreePath = wt
      cur.cwd = wt
    } else if (attempts > 0) {
      trackWorktreeLater(sessionId, attempts - 1)
    }
  }, 500)
}

// Best-effort worktree teardown: taskkill leaves the dying process holding files for
// a few hundred ms on Windows, so the remove is retried. Also deletes the linked branch
// (git worktree remove never touches it), run from the main repo so it works after
// removal. Silently gives up after 3 tries.
async function removeWorktree(wtPath: string): Promise<void> {
  let branch = ''
  let repoCwd = wtPath
  try {
    const out = execSync('git worktree list --porcelain', { cwd: wtPath, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
    // porcelain blocks are separated by blank lines; find the block whose worktree
    // line matches wtPath so branch belongs to THIS worktree, not some other one.
    for (const block of out.split(/\n\s*\n/)) {
      const wtLine = block.split('\n').find(l => l.startsWith('worktree '))
      if (wtLine && wtLine.replace('worktree ', '').trim().toLowerCase() === wtPath.toLowerCase()) {
        const br = block.split('\n').find(l => l.startsWith('branch '))
        if (br) branch = br.replace('branch ', '').trim().replace(/^refs\/heads\//, '')
        break
      }
    }
    const first = out.split('\n').find(l => l.startsWith('worktree '))
    if (first) repoCwd = first.replace('worktree ', '').trim()
  } catch {
    // git record already gone, but the directory may be orphaned → fs.rm sweep below
  }
  let removed = false
  for (let i = 0; i < 3; i++) {
    try {
      execSync(`git worktree remove --force "${wtPath}"`, { cwd: repoCwd, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' })
      removed = true
      break
    } catch (e: any) {
      // "is not a working tree" means git removed its record on a prior attempt —
      // only the directory (and branch) remain
      if ((e?.message || '').includes('is not a working tree')) { removed = true; break }
      if (i === 2) break
      await new Promise(r => setTimeout(r, 300))
    }
  }
  if (removed && branch) {
    try { execSync(`git branch -D "${branch}"`, { cwd: repoCwd, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }) } catch { /* branch already gone */ }
  }
  // Once the git record is gone the dir can only be swept directly; locked files
  // (right after taskkill) release within a second or two, so retry before giving up.
  for (let i = 0; i < 3; i++) {
    try {
      await rm(wtPath, { recursive: true, force: true })
      return
    } catch {
      if (i === 2) return // give up — directory left behind
      await new Promise(r => setTimeout(r, 400))
    }
  }
}

export function spawnClaude(opts: {
  cwd: string
  permissionMode: AiPermissionMode
  resumeSessionId?: string
  cliCommand?: string
  configDir?: string
  model?: string
  enableWorktree?: boolean
  persona?: string
  computerUse?: boolean
  mcpConfigPath?: string
}): ChildProcess | SpawnError {
  const resolved = findBinary(opts.cliCommand)
  if ('error' in resolved) return resolved

  const args = buildClaudeArgs(opts)
  const env = sanitizeEnvForCli()
  if (opts.configDir) env.CLAUDE_CONFIG_DIR = resolveConfigDir(opts.configDir)
  if (opts.computerUse) {
    env.ENABLE_TOOL_SEARCH = 'false'
  }
  return spawn(resolved.binary, args, {
    cwd: opts.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

function isFileEditTool(toolName: string): boolean {
  return AI_FILE_EDIT_TOOLS.has(toolName)
}

// Calculate context percentage from usage token counts.
// Claude CLI stream-json does NOT include context_window in output.
// modelUsage block (used by newer CLI versions) has not been observed in practice.
// Fallback: parse context window from model name (e.g. "deepseek-v4-pro[1m]" → 1M).
const DEFAULT_CONTEXT_WINDOW_SIZE = 200000

function parseContextWindowFromModel(model: string): number | undefined {
  const m = model.match(/\[(\d+(?:\.\d+)?)\s*(k|m)\]/i)
  if (!m) return undefined
  const num = parseFloat(m[1])
  return m[2].toLowerCase() === 'm' ? num * 1_000_000 : num * 1_000
}

function calcContextPercent(usage: any, contextWindow?: number): number | undefined {
  if (!usage) return undefined
  const input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0)
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

  // turnIndex = the user turn this edit belongs to (last completed user turn), computed from
  // the live JSONL via parseUserTurns — the same single source revert uses. File edits run
  // during the assistant response, so the user turn is already on disk.
  const session = aiSessions.get(sessionId)
  const claudeSessionId = session?.claudeSessionId
  let turnIndex = 0
  if (claudeSessionId) {
    const projectDir = resolveProjectDir(cwd, session?.configDir)
    if (projectDir) {
      try {
        const jsonl = await readFile(join(projectDir, `${claudeSessionId}.jsonl`), 'utf-8')
        const turns = parseUserTurns(jsonl.split('\n').filter(Boolean))
        if (turns.length > 0) turnIndex = turns.length - 1
      } catch { /* jsonl not yet written; leave turnIndex 0 */ }
    }
  }

  send(IPC_CHANNELS.AI_FILE_CHANGE, {
    toolUseId: block.id,
    sessionId,
    filePath: absPath,
    relativePath: relPath,
    action: oldContent !== undefined ? 'edit' : 'create',
    content: newContent,
    oldContent,
    turnIndex,
  })
}

function handleNdjsonMessage(sessionId: string, msg: any, cwd: string): void {
  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'status') break
      const s = aiSessions.get(sessionId)
      if (s) {
        s.ready = true
        s.revertAwaitingReady = false
        if (msg.session_id) {
          s.claudeSessionId = msg.session_id
          cliSessionToRenderer.set(msg.session_id, sessionId)
        }
        if (msg.model) {
          const parsed = parseContextWindowFromModel(msg.model)
          if (parsed) s.contextWindow = parsed
        }
      }
      const payload: any = { sessionId, tools: msg.tools, model: msg.model, slashCommands: msg.slash_commands }
      if (s?.claudeSessionId) payload.session_id = s.claudeSessionId
      if (s?.cwd) payload.cwd = s.cwd
      if (s?.enableWorktree && !s.worktreePath && s.preWorktreeSnapshot) {
        const wtPath = detectNewWorktree(s.cwd, s.preWorktreeSnapshot, configDirMarker(s.configDir))
        if (wtPath) {
          s.worktreePath = wtPath
          s.cwd = wtPath
          payload.worktreePath = wtPath
        } else {
          // CLI creates the worktree after the ready message — poll briefly so
          // destroy can clean it up without relying on the snapshot fallback
          // (which mis-attributes worktrees when several agents spawn together)
          trackWorktreeLater(sessionId, 8)
        }
      }
      send(IPC_CHANNELS.AI_READY, payload)
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
            const session = aiSessions.get(sessionId)
            // Plan mode: never open diff for file-edit tools — the model is only describing
            // a plan, not actually executing. If a Write/Edit slips through the CLI's plan-mode
            // enforcement, skip the diff and log a warning so the user knows something is off.
            if (session?.permissionMode === 'plan') {
              console.warn(`[ai:${sessionId}] SKIP extractFileChange for ${block.name} (plan mode)`)
            } else {
              // --include-partial-messages replays the same tool_use across partial messages;
              // deduplicate so the diff viewer opens only once per tool call.
              if (!session?.seenToolUseIds) {
                if (session) session.seenToolUseIds = new Set()
              }
              if (!session?.seenToolUseIds?.has(block.id)) {
                session?.seenToolUseIds?.add(block.id)
                extractFileChange(sessionId, block, cwd)
              }
            }
          }
        }
      }
      // CLI emits intermediate assistant messages after each content block.
      // All are sent through — thinking-only messages preserve per-turn thinking.
      if (textParts.length === 0 && toolUses.length === 0 && thinkingParts.length === 0) break
      // Sub-agent (Task/Agent) assistant messages carry parent_tool_use_id. The CLI transcript
      // uses top-level linking fields (isSidechain/parentUuid), so the stream field may sit at
      // top level (msg.parent_tool_use_id) rather than under msg.message — read both.
      const parentToolUseId = msg.message?.parent_tool_use_id || msg.parent_tool_use_id
      const session = aiSessions.get(sessionId)
      send(IPC_CHANNELS.AI_MESSAGE, {
        sessionId,
        type: 'assistant',
        role: 'assistant',
        messageId: msg.message?.id,
        model: msg.message?.model,
        content: cleanText(textParts.join('\n')),
        thinking: thinkingParts.length > 0 ? cleanText(thinkingParts.join('\n')) : undefined,
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
          // Sub-agent thinking would otherwise stream into the main thinkingBuffer and expand
          // live at top level. Skip it when the sub-agent marker (top-level parent_tool_use_id,
          // same as assistant messages) is present — the thinking survives in the completed
          // sub-agent message (collapsed ThinkingBlock) inside its agent group. Main-agent
          // thinking (no marker) streams as before.
          if (!(msg.parent_tool_use_id || msg.message?.parent_tool_use_id)) {
            send(IPC_CHANNELS.AI_STREAM_TOKEN, { sessionId, token: delta.thinking, kind: 'thinking' })
          }
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

    case 'result': {
      // CLI 旧版本可能不带 subtype，按 is_error 兜底
      const subtype = msg.subtype || (msg.is_error ? 'error_during_execution' : 'success')
      const session = aiSessions.get(sessionId)
      // User-initiated cancel: treat result as aborted, not error
      const wasCancelled = session?.cancelRequested
      if (wasCancelled) session!.cancelRequested = false
      const parentToolUseId = msg.message?.parent_tool_use_id || msg.parent_tool_use_id
      send(IPC_CHANNELS.AI_MESSAGE, {
        sessionId,
        type: 'result',
        content: msg.result,
        subtype,
        isAborted: !!msg.is_aborted || wasCancelled,
        costUsd: msg.total_cost_usd,
        durationMs: msg.duration_ms,
        numTurns: msg.num_turns,
        parentToolUseId: parentToolUseId || undefined,
        // result.usage is cumulative across the turn — omit so renderer keeps last assistant value
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
            const parentToolUseId = msg.message?.parent_tool_use_id || msg.parent_tool_use_id
            const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            send(IPC_CHANNELS.AI_MESSAGE, {
              sessionId,
              type: 'user',
              role: 'user',
              toolResult: {
                toolUseId: block.tool_use_id,
                content: resultContent,
                isError: block.is_error || false,
              },
              parentToolUseId: parentToolUseId || undefined,
              timestamp: Date.now(),
            })
            // Backgrounded agents (async_launched) return "Async agent launched successfully...
            // agentId: <hex>" but stream their transcript only to a sidecar file; watch it
            // so the live UI shows the sub-agent's tool calls. (Completed foreground agents
            // also embed an "agentId:" trailer — matching the launch marker excludes them.)
            const launchMatch = /Async agent launched successfully[\s\S]*?agentId:\s*([0-9a-f]{8,})/i.exec(resultContent)
            if (launchMatch) {
              const session = aiSessions.get(sessionId)
              const cliSessionId = msg.sessionId || session?.claudeSessionId
              if (cliSessionId) {
                startSidecarWatcher(sessionId, cliSessionId, launchMatch[1], block.tool_use_id, cwd, session?.configDir)
              }
            }
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

// ── Live sub-agent sidecar watchers ──────────────────────────────
// Backgrounded agents write their transcript to <projectDir>/<cliSessionId>/
// subagents/agent-<agentId>.jsonl — never into the main stream. Poll the sidecar
// and forward new lines as AI_MESSAGE events (parentToolUseId = spawning Agent
// tool_use id) so the live agent group shows the sub-agent's tool calls in real time.
interface SidecarWatcher {
  sessionId: string       // renderer session id (AI_MESSAGE routing)
  sidecarPath: string
  parentToolUseId: string // spawning Agent tool_use id
  lastLineIdx: number     // sidecar lines already forwarded
  unchangedPolls: number  // consecutive polls with no new lines
  misses: number          // consecutive polls where the file was missing/unreadable
  timer: NodeJS.Timeout
}
const sidecarWatchers = new Map<string, SidecarWatcher>()
const SIDECAR_POLL_MS = 1000
const SIDECAR_STOP_UNCHANGED_POLLS = 180 // 3min of silence → agent finished (covers long silent tools)
const SIDECAR_STOP_MISS_POLLS = 10      // sidecar never appeared → nothing to watch

function stopSidecarWatcher(key: string): void {
  const w = sidecarWatchers.get(key)
  if (!w) return
  clearInterval(w.timer)
  sidecarWatchers.delete(key)
}

function stopSidecarWatchersForSession(sessionId: string): void {
  for (const [key, w] of sidecarWatchers) {
    if (w.sessionId === sessionId) stopSidecarWatcher(key)
  }
}

function emitSidecarMessage(sessionId: string, msg: any, parentToolUseId: string): void {
  switch (msg.type) {
    case 'assistant': {
      const content = msg.message?.content
      if (!Array.isArray(content)) return
      const textParts: string[] = []
      const thinkingParts: string[] = []
      const toolUses: AiToolUse[] = []
      for (const block of content) {
        if (block.type === 'text') textParts.push(block.text)
        else if (block.type === 'thinking' && block.thinking) thinkingParts.push(block.thinking)
        else if (block.type === 'tool_use') toolUses.push({ id: block.id, name: block.name, input: block.input })
      }
      if (textParts.length === 0 && toolUses.length === 0 && thinkingParts.length === 0) return
      send(IPC_CHANNELS.AI_MESSAGE, {
        sessionId,
        type: 'assistant',
        role: 'assistant',
        messageId: msg.message?.id,
        model: msg.message?.model,
        content: cleanText(textParts.join('\n')) || undefined,
        thinking: thinkingParts.length > 0 ? cleanText(thinkingParts.join('\n')) : undefined,
        toolUse: toolUses.length > 0 ? toolUses : undefined,
        parentToolUseId,
        timestamp: Date.now(),
      })
      break
    }
    case 'user': {
      const content = msg.message?.content
      if (!Array.isArray(content)) return
      for (const block of content) {
        if (block.type !== 'tool_result') continue
        send(IPC_CHANNELS.AI_MESSAGE, {
          sessionId,
          type: 'user',
          role: 'user',
          toolResult: {
            toolUseId: block.tool_use_id,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            isError: block.is_error || false,
          },
          parentToolUseId,
          timestamp: Date.now(),
        })
      }
      break
    }
  }
}

function pollSidecarWatcher(key: string): void {
  const w = sidecarWatchers.get(key)
  if (!w) return
  readFile(w.sidecarPath, 'utf-8').then((content) => {
    const watcher = sidecarWatchers.get(key)
    if (!watcher) return
    watcher.misses = 0
    // A trailing segment without '\n' may be a line still being written — hold it back
    // so a mid-write read doesn't permanently drop that line.
    const segments = content.endsWith('\n') ? content.split('\n') : content.split('\n').slice(0, -1)
    const lines = segments.filter(Boolean)
    if (lines.length <= watcher.lastLineIdx) {
      watcher.unchangedPolls++
      if (watcher.unchangedPolls >= SIDECAR_STOP_UNCHANGED_POLLS) stopSidecarWatcher(key)
      return
    }
    watcher.unchangedPolls = 0
    for (let i = watcher.lastLineIdx; i < lines.length; i++) {
      let lineMsg: any
      try { lineMsg = JSON.parse(lines[i]) } catch { continue }
      if (lineMsg.type !== 'assistant' && lineMsg.type !== 'user') continue
      emitSidecarMessage(watcher.sessionId, lineMsg, watcher.parentToolUseId)
    }
    watcher.lastLineIdx = lines.length
  }).catch(() => {
    const watcher = sidecarWatchers.get(key)
    if (!watcher) return
    watcher.misses++
    if (watcher.misses >= SIDECAR_STOP_MISS_POLLS) stopSidecarWatcher(key)
  })
}

function startSidecarWatcher(sessionId: string, cliSessionId: string, agentId: string, parentToolUseId: string, cwd: string, configDir?: string): void {
  const key = `${sessionId}:${parentToolUseId}`
  if (sidecarWatchers.has(key)) return
  const projectDir = resolveProjectDir(cwd, configDir)
  if (!projectDir) return
  const sidecarPath = join(projectDir, cliSessionId, 'subagents', `agent-${agentId}.jsonl`)
  const watcher: SidecarWatcher = {
    sessionId,
    sidecarPath,
    parentToolUseId,
    lastLineIdx: 0,
    unchangedPolls: 0,
    misses: 0,
    timer: setInterval(() => pollSidecarWatcher(key), SIDECAR_POLL_MS),
  }
  sidecarWatchers.set(key, watcher)
  pollSidecarWatcher(key)
}

// ── Session list: read from ~/.claude/projects/<normalized-cwd>/ ──
// Claude CLI stores sessions as <session-id>.jsonl files under project directories.
// Normalization must match CLI: replace(/[^a-zA-Z0-9]/g, "-"), truncate at 200 + hash.

const CLI_PROJECT_DIR_MAX = 200

function djb2Hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0
  return h
}

export function normalizeCwdToProjectDir(cwd: string): string {
  let t = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (t.length <= CLI_PROJECT_DIR_MAX) return t
  return `${t.slice(0, CLI_PROJECT_DIR_MAX)}-${Math.abs(djb2Hash(cwd)).toString(36)}`
}

export type AiSessionMeta = Omit<AiSessionSummary, 'projectDir' | 'projectDirName' | 'inCurrentProject'>

// Read metadata from a single session JSONL file (first few lines only).
// Shared by listSessionsForCwd and the cross-project history/搜索 IPC in ai-history.ts.
// `lines` may be passed in when the caller already read the file (search), avoiding a double read.
export async function extractSessionMeta(filePath: string, sizeBytes: number, lines?: string[]): Promise<AiSessionMeta | null> {
  try {
    if (!lines) {
      const content = await readFile(filePath, 'utf-8')
      lines = content.split('\n').filter(Boolean)
    }
    const sessionId = basename(filePath).replace('.jsonl', '')

    // parseUserTurns 跳过 <local-command-*> 等命令标签，优先取真实正文作 name
    const turns = parseUserTurns(lines.slice(0, 40))
    if (turns.length === 0) return null
    const nameTurn = turns.find(t => !t.isInternal) ?? turns[0]
    const name = nameTurn.content.slice(0, 60)

    const firstTurnLine = JSON.parse(lines[turns[0].lineIdx])
    const timestamp = firstTurnLine.timestamp ? new Date(firstTurnLine.timestamp).getTime() : 0
    if (!timestamp || Number.isNaN(timestamp)) return null
    const cwd = typeof firstTurnLine.cwd === 'string' ? firstTurnLine.cwd : ''

    let model = ''
    for (const line of lines.slice(0, 20)) {
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'assistant' && msg.message?.model) { model = msg.message.model; break }
      } catch { /* skip malformed */ }
    }

    return { session_id: sessionId, name, timestamp, model, sizeBytes, cwd }
  } catch { return null }
}

async function listSessionsForCwd(cwd: string, configDir?: string): Promise<{ sessions: any[] }> {
  const projectsRoot = getProjectsRoot(configDir)
  let projectDirName = normalizeCwdToProjectDir(cwd).toLowerCase()

  // Try both lowercase and original case
  const allDirs = await readdir(projectsRoot).catch(() => [] as string[])
  const match = allDirs.find(d => d === projectDirName || d === normalizeCwdToProjectDir(cwd))
  if (!match) return { sessions: [] }

  const projectDir = join(projectsRoot, match)
  const files = await readdir(projectDir).catch(() => [] as string[])
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))

  const sessions: any[] = []
  for (const jsonlFile of jsonlFiles) {
    const filePath = join(projectDir, jsonlFile)
    const fileStat = await stat(filePath).catch(() => null)
    const sizeBytes = fileStat?.size ?? 0
    const meta = await extractSessionMeta(filePath, sizeBytes)
    if (meta) sessions.push(meta)
  }

  // Sort most recent first
  sessions.sort((a, b) => b.timestamp - a.timestamp)
  return { sessions: sessions.slice(0, 30) }
}

// ── Load full session history from .jsonl for resume display ──

// Resolve the Claude config dir: user-configured directory (with ~ expansion) wins,
// otherwise ~/.claude. Shared by spawn-side CLAUDE_CONFIG_DIR and all JSONL read paths.
function resolveConfigDir(configDir?: string): string {
  const home = homedir()
  if (configDir && configDir.trim()) {
    const v = configDir.trim()
    if (v === '~') return home
    if (v.startsWith('~/') || v.startsWith('~\\')) return join(home, v.slice(2))
    return isAbsolute(v) ? v : join(home, v)
  }
  return join(home, '.claude')
}

export function getProjectsRoot(configDir?: string): string {
  return join(resolveConfigDir(configDir), 'projects')
}

export function resolveProjectDir(cwd: string, configDir?: string): string | null {
  const projectsRoot = getProjectsRoot(configDir)
  // Synchronous scan needed here — only a few dirs
  try {
    const allDirs = require('fs').readdirSync(projectsRoot)
    const lowerName = normalizeCwdToProjectDir(cwd).toLowerCase()
    const upperName = normalizeCwdToProjectDir(cwd)
    const match = allDirs.find((d: string) => d === lowerName || d === upperName)
    return match ? join(projectsRoot, match) : null
  } catch { return null }
}

// ── Pet AI-reply cursor ─────────────────────────────────────────
// 宠物气泡的统一数据源：TUI（终端里直接跑 claude）与 AI tab 都会把会话写入
// <configDir>/projects/<normalized-cwd>/ 下的 <uuid>.jsonl。渲染进程检测到后台会话
// busy→idle（warn 场景）时调 readReplyIncrement，扫描该目录下 mtime 最新的 jsonl，
// 取最后一条 assistant 回复 push AI_REPLY——与"显示最新回复"按钮同一取数逻辑
// （无状态快照，renderer 按 messageId 去重），不依赖增量游标。
// cursor 只记录会话 → projectDir 映射，不监听任何东西。

const replyCursors = new Map<string, string>() // sessionId → projectDir

function extractReplyText(msg: any): { messageId: string; text: string } | null {
  if (!msg || msg.type !== 'assistant' || !msg.message) return null
  const content = msg.message.content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  let askQuestion: string | null = null
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text)
    } else if (block?.type === 'tool_use' && block.input && block.name === 'Ask' && typeof block.input.question === 'string' && block.input.question.trim()) {
      askQuestion = block.input.question
    }
  }
  if (askQuestion) return { messageId: msg.message.id || '', text: cleanText(`🤔 ${askQuestion}`) }
  if (parts.length === 0) return null
  return { messageId: msg.message.id || '', text: cleanText(parts.join('\n')) }
}

function readJsonlLines(filePath: string): Promise<string[] | null> {
  return readFile(filePath, 'utf-8').then((content) => content.split('\n').filter(Boolean)).catch(() => null)
}

// 扫项目目录，返回 mtime 最新 jsonl 的最后一条 assistant 回复（快照用）。
// 不做 size 跳过：TUI 模式的 CLI 可能整文件重写 jsonl（非 append），size 相同不等于内容未变。
// 事件驱动触发频率低，每次全量读的成本可接受。未闭合行 JSON.parse 失败自动跳过。
async function scanActiveJsonl(projectDir: string): Promise<{ messageId: string; text: string } | null> {
  const files = await readdir(projectDir).catch(() => [] as string[])
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
  if (jsonlFiles.length === 0) return null
  let best: { name: string; mtime: number } | null = null
  for (const f of jsonlFiles) {
    const st = await stat(join(projectDir, f)).catch(() => null)
    if (!st) continue
    if (!best || st.mtimeMs > best.mtime) best = { name: f, mtime: st.mtimeMs }
  }
  if (!best) return null
  const lines = await readJsonlLines(join(projectDir, best.name))
  if (lines === null) return null
  for (let i = lines.length - 1; i >= 0; i--) {
    let msg: any
    try { msg = JSON.parse(lines[i]) } catch { continue }
    const r = extractReplyText(msg)
    if (r) return r
  }
  return null
}

// 事件驱动读取：后台会话 busy→idle（warn 场景）时调用，取最新 jsonl 的最后一条
// 回复 push AI_REPLY（与"显示最新回复"按钮同一取数逻辑）。
// 游标未注册（监听未开启）时直接返回，零 IO。
function readReplyIncrement(sessionId: string): void {
  const projectDir = replyCursors.get(sessionId)
  if (!projectDir) return
  scanActiveJsonl(projectDir).then((reply) => {
    if (!reply) return
    send(IPC_CHANNELS.AI_REPLY, { sessionId, messageId: reply.messageId, text: reply.text, timestamp: Date.now() })
  }).catch(() => { /* project dir missing → 下次触发再试 */ })
}

function clearReplyCursor(sessionId: string): void {
  replyCursors.delete(sessionId)
}

async function initReplyCursor(sessionId: string, cwd: string, configDir?: string): Promise<AiReply | null> {
  clearReplyCursor(sessionId)
  const projectDir = resolveProjectDir(cwd, configDir)
  if (!projectDir) return null
  replyCursors.set(sessionId, projectDir)
  const reply = await scanActiveJsonl(projectDir)
  if (reply) return { sessionId, messageId: reply.messageId, text: reply.text, timestamp: Date.now() }
  return null
}

// Resolve contextWindow for a CLI session ID via the reverse map to a renderer session.
function getContextWindowForCliSession(cliSessionId: string): number | undefined {
  const rendererId = cliSessionToRenderer.get(cliSessionId)
  return rendererId ? aiSessions.get(rendererId)?.contextWindow : undefined
}

interface TranscriptParseResult {
  messages: AiMessage[]
  model: string
  slashCommands: string[]
}

// Parse transcript JSONL lines (main session or sub-agent sidecar) into AiMessage[].
// Local toolUseIndex per call → no id collisions across main + sidecars. parentToolUseId
// stamps sub-agent messages so MessageList groups them under the parent Agent tool_use.
// allowSidechain=false (main) skips stray isSidechain lines; true (sidecar) keeps them
// (sidecar lines are all isSidechain). turnByLine (main only) emits reconstructed user turns
// at their line index for revert-index alignment; absent (sidecar) → user-string lines
// (the sub-agent task prompt) are skipped.
function parseTranscriptLines(
  lines: string[],
  sid: string,
  opts: { parentToolUseId?: string; allowSidechain?: boolean; turnByLine?: Map<number, UserTurn> }
): TranscriptParseResult {
  const messages: AiMessage[] = []
  let model = ''
  const slashCommands: string[] = []
  const toolUseIndex = new Map<string, { msgIdx: number; toolIdx: number }>()
  const allowSidechain = opts.allowSidechain ?? false

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    let msg: any
    try { msg = JSON.parse(line) } catch { continue }

    if (['permission-mode', 'file-history-snapshot', 'stream_event', 'content_block_delta',
      'content_block_start', 'content_block_stop', 'message_start', 'message_delta',
      'message_stop', 'keep_alive', 'control_cancel_request', 'tool_progress',
      'permission_request', 'control_request', 'attachment'].includes(msg.type)) continue

    if (!allowSidechain && msg.isSidechain === true) continue

    const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now()

    if (msg.type === 'system') {
      if (msg.subtype === 'init') {
        model = msg.model || model
        if (Array.isArray(msg.slash_commands)) {
          for (const c of msg.slash_commands) slashCommands.push(c)
        }
      }
      continue
    }

    // User turn (plain text or reconstructed slash group) — sourced from parseUserTurns so
    // the count matches revert truncation exactly; slash-group continuation lines are skipped
    // in the msg.type==='user' branch below.
    if (opts.turnByLine && opts.turnByLine.has(lineIdx)) {
      const turn = opts.turnByLine.get(lineIdx)!
      messages.push({
        sessionId: sid, type: 'user', role: 'user',
        messageId: msg.message?.id,
        content: turn.content, timestamp: ts,
      })
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
          toolUseIndex.set(block.id, { msgIdx: messages.length, toolIdx: toolUses.length - 1 })
        }
      }
      if (textParts.length === 0 && toolUses.length === 0 && thinkingParts.length === 0) continue
      const assistantContent = cleanText(textParts.join('\n')) || undefined
      const assistantThinking = thinkingParts.length > 0 ? cleanText(thinkingParts.join('\n')) : undefined
      if (!assistantContent && !assistantThinking && toolUses.length === 0) continue
      messages.push({
        sessionId: sid, type: 'assistant', role: 'assistant',
        messageId: msg.message?.id,
        model: msg.message?.model,
        content: assistantContent,
        thinking: assistantThinking,
        toolUse: toolUses.length > 0 ? toolUses : undefined,
        parentToolUseId: opts.parentToolUseId,
        contextPercent: calcContextPercent(msg.message?.usage, getContextWindowForCliSession(sid)),
        timestamp: ts,
      })
      continue
    }

    if (msg.type === 'user') {
      const userContent = msg.message?.content
      // String user lines: plain text and slash-group heads are already emitted by the
      // turnByLine branch above; slash-group continuation lines (cleanText empty) are skipped.
      if (typeof userContent === 'string') continue
      if (Array.isArray(userContent)) {
        for (const block of userContent) {
          if (block.type === 'tool_result') {
            const toolUseId = block.tool_use_id
            const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            const result: AiToolResult = { toolUseId, content: resultContent, isError: block.is_error || false }

            const pos = toolUseIndex.get(toolUseId)
            if (pos) {
              const existingMsg = messages[pos.msgIdx]
              if (existingMsg.toolUse) {
                existingMsg.toolUse[pos.toolIdx] = { ...existingMsg.toolUse[pos.toolIdx], result }
              }
            }
          }
        }
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
          parentToolUseId: opts.parentToolUseId,
          timestamp: ts,
        })
      } else {
        messages.push({
          sessionId: sid, type: 'result',
          content: msg.result,
          costUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
          durationMs: msg.duration_ms,
          parentToolUseId: opts.parentToolUseId,
          timestamp: ts,
        })
      }
      continue
    }
  }

  return { messages, model, slashCommands }
}

// Recursively inline sub-agent sidecar transcripts under their parent Agent tool_use.
// The CLI stores each sub-agent's full transcript in
// <projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl (isSidechain:true), NOT inline in
// the main jsonl. The Agent tool_result text carries "agentId: <hex>" which maps to the
// sidecar filename. We parse each sidecar with parentToolUseId = the Agent tool_use id so
// MessageList groups the sub-agent's messages under the Agent card. Depth-limited (5) as a
// runaway-recursion backstop. Missing/unreadable sidecars are skipped (graceful degradation).
async function inlineSubagents(
  messages: AiMessage[],
  projectDir: string,
  parentSessionId: string,
  depth: number
): Promise<void> {
  if (depth > 5) return

  const insertions: Array<{ afterIdx: number; msgs: AiMessage[] }> = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg.toolUse) continue
    for (const tool of msg.toolUse) {
      if (tool.name !== 'Agent' || !tool.result?.content) continue
      const m = /agentId:\s*([0-9a-f]{8,})/i.exec(tool.result.content)
      if (!m) continue
      const sidecarPath = join(projectDir, parentSessionId, 'subagents', `agent-${m[1]}.jsonl`)
      let sidecarContent: string
      try { sidecarContent = await readFile(sidecarPath, 'utf-8') } catch { continue }
      const parsed = parseTranscriptLines(sidecarContent.split('\n').filter(Boolean), parentSessionId, {
        parentToolUseId: tool.id,
        allowSidechain: true,
      })
      insertions.push({ afterIdx: i, msgs: parsed.messages })
      await inlineSubagents(parsed.messages, projectDir, parentSessionId, depth + 1)
    }
  }

  for (let k = insertions.length - 1; k >= 0; k--) {
    messages.splice(insertions[k].afterIdx + 1, 0, ...insertions[k].msgs)
  }
}

export async function loadSessionMessagesFromProject(resumeSessionId: string, projectDir: string): Promise<{
  messages: AiMessage[]
  model: string
  slashCommands: string[]
}> {
  const jsonlPath = join(projectDir, `${resumeSessionId}.jsonl`)
  let content: string
  try { content = await readFile(jsonlPath, 'utf-8') } catch { return { messages: [], model: '', slashCommands: [] } }

  const lines = content.split('\n').filter(Boolean)
  const turnByLine = new Map<number, UserTurn>()
  for (const t of parseUserTurns(lines)) turnByLine.set(t.lineIdx, t)

  const parsed = parseTranscriptLines(lines, resumeSessionId, { allowSidechain: false, turnByLine })
  await inlineSubagents(parsed.messages, projectDir, resumeSessionId, 0)

  return { messages: parsed.messages, model: parsed.model, slashCommands: parsed.slashCommands }
}

async function loadSessionMessages(resumeSessionId: string, cwd: string, configDir?: string): Promise<{
  messages: AiMessage[]
  model: string
  slashCommands: string[]
}> {
  const projectDir = resolveProjectDir(cwd, configDir)
  if (!projectDir) return { messages: [], model: '', slashCommands: [] }
  return loadSessionMessagesFromProject(resumeSessionId, projectDir)
}

// Computer-use pipe lifecycle helpers. stop 幂等（session 不存在即 no-op）;
// start 失败返回 undefined（spawn 不带 --mcp-config，工具静默缺失但会话不崩）。
// 所有 kill+重建路径必须 stop 旧 + start 新，否则 pipe server / temp json 泄漏。
export function stopCuForSession(sessionId: string, enabled: boolean | undefined): void {
  if (!enabled) return
  try { require('./computer-use').stopForSession(sessionId) } catch { /* ignore */ }
}

export function startCuForSession(sessionId: string, enabled: boolean | undefined): string | undefined {
  if (!enabled) return undefined
  try {
    const r = require('./computer-use').startForSession(sessionId)
    console.log(`[ai:${sessionId}] computer-use started: pipe=${r.pipeName} mcpConfig=${r.mcpConfigPath}`)
    return r.mcpConfigPath
  } catch (e) {
    console.error(`[ai:${sessionId}] computer-use start failed:`, e)
    return undefined
  }
}

// Attach all process event handlers (stdout/stderr/error/exit) to a spawned Claude CLI process.
// Shared between initial AI_CREATE spawn and plan-execute restart — extracted so
// the restart path reuses identical NDJSON parsing / error reporting / lifecycle logic.
export function attachAiProcess(sessionId: string, proc: ChildProcess, cwd: string, model?: string, configDir?: string, cliCommand?: string, computerUse?: boolean): void {
  const session: ManagedAiSession = {
    process: proc,
    sessionId,
    cwd,
    lineBuffer: '',
    ready: true,
    model,
    configDir,
    cliCommand,
    computerUse,
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
    if (current && current.process.pid === proc.pid) {
      if (current.computerUse) { try { require('./computer-use').stopForSession(sessionId) } catch {} }
      stopSidecarWatchersForSession(sessionId)
      aiSessions.delete(sessionId)
      send(IPC_CHANNELS.AI_ERROR, { sessionId, error: err.message })
    }
  })

  proc.on('exit', (code, signal) => {
    clearTimeout(startupTimer)
    // Only handle if this is still the active process for this session
    const current = aiSessions.get(sessionId)
    if (current && current.process.pid === proc.pid) {
      // AskUserQuestion proactive kill: keep session (ask-resume needs claudeSessionId),
      // skip AI_ERROR — this exit is intentional, not a crash.
      if (current!.awaitingUserInput === true) {
        return
      }
      if (current.computerUse) { try { require('./computer-use').stopForSession(sessionId) } catch {} }
      stopSidecarWatchersForSession(sessionId)
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

// Format the user's AskUserQuestion answers into a follow-up prompt message sent via --resume.
// Port of desktop-cc-gui-main/src-tauri/src/engine/claude_message_content.rs:format_ask_user_answer.
//
// Why this exists: Claude CLI in stream-json input mode auto-fills an empty answer ~0.5s after
// sending an AskUserQuestion control_request, regardless of --permission-prompt-tool stdio.
// Sending a real control_response arrives too late — the LLM already saw "User has answered:
// ." and proceeded. Kill-and-resume dodges this: we kill the auto-fill path, then --resume the
// same claude session with the real answers as a fresh user message.
function formatAskUserAnswer(answers: Record<string, string>): string {
  const entries = Object.entries(answers).filter(([, v]) => v && v.trim())
  if (entries.length === 0) {
    return 'The user skipped this AskUserQuestion without selecting an option. Do not ask the same question again; continue the original task using the available context and reasonable assumptions.'
  }
  // Match reference impl: "questionText=answer" pairs joined by "; "
  // Keys here are question text (not question IDs) — LLM only uses these for natural-language hint
  const parts = entries.map(([q, a]) => `${q}=${a}`)

  const structuredAnswers: Record<string, string[]> = {}
  for (const [q, a] of entries) structuredAnswers[q] = [a]
  const payload = JSON.stringify({ answers: structuredAnswers, skippedQuestionIds: [] })
  const base64 = Buffer.from(payload, 'utf-8').toString('base64')

  return `The user answered the AskUserQuestion: ${parts.join('; ')}. Please continue based on this selection. AskUserQuestionResultBase64:${base64}`
}

// Kill-and-resume for AskUserQuestion. Shared by the ai:askResume IPC (answer via the question
// card) and by AI_SEND (a message typed into the prompt box while awaitingUserInput — the
// subprocess is already dead, so a raw stdin write would vanish silently). The old session's
// worktree fields are carried onto the resumed session so AI_DESTROY still cleans up the
// original worktree after a question/answer round-trip.
export function resumeAfterAsk(sessionId: string, answers: Record<string, string>): { success: boolean; error?: string; installCmd?: string } {
  const session = aiSessions.get(sessionId)
  if (!session) return { success: false, error: 'Session not found' }

  const claudeSessionId = session.claudeSessionId
  const cwd = session.cwd
  const permissionMode = session.permissionMode || 'bypassPermissions'

  if (!claudeSessionId) return { success: false, error: 'No claudeSessionId cached (system/init not received yet)' }

  // Kill the auto-filling subprocess. Safe to call even if the AskUserQuestion
  // control_request handler already killed it (Windows taskkill /f /t is a no-op on
  // a dead PID; Unix kill is wrapped in try/catch inside killAiProcess). Clear the
  // flag so the new subprocess's eventual exit is not misclassified as proactive.
  killAiProcess(session.process)
  stopCuForSession(sessionId, session.computerUse)
  session.awaitingUserInput = false
  stopSidecarWatchersForSession(sessionId)
  aiSessions.delete(sessionId)

  const mcpConfigPath = startCuForSession(sessionId, session.computerUse)
  const result = spawnClaude({ cwd, permissionMode, model: session.model, cliCommand: session.cliCommand, configDir: session.configDir, resumeSessionId: claudeSessionId, persona: session.persona, computerUse: session.computerUse, mcpConfigPath })
  if ('error' in result) {
    stopCuForSession(sessionId, session.computerUse)
    send(IPC_CHANNELS.AI_ERROR, {
      sessionId,
      error: result.error,
      installCmd: result.installCmd,
    })
    return { success: false, error: result.error, installCmd: result.installCmd }
  }

  attachAiProcess(sessionId, result, cwd, session.model, session.configDir, session.cliCommand, session.computerUse)

  const newSession = aiSessions.get(sessionId)
  if (newSession) {
    newSession.claudeSessionId = claudeSessionId
    newSession.permissionMode = permissionMode
    newSession.contextWindow = session.contextWindow
    newSession.persona = session.persona
    if (session.model) newSession.model = session.model
    // Preserve worktree tracking so destroy() still removes the original worktree
    newSession.enableWorktree = session.enableWorktree
    newSession.worktreePath = session.worktreePath
    newSession.preWorktreeSnapshot = session.preWorktreeSnapshot
  }

  const prompt = formatAskUserAnswer(answers)
  result.stdin!.write(JSON.stringify({
    type: 'user',
    message: { role: 'user', content: prompt },
    isMeta: true,
  }) + '\n')

  return { success: true }
}

export function registerAiHandlers(): void {

  ipcMain.handle(IPC_CHANNELS.AI_SET_VISIBLE, (_event, visible: boolean) => {
    rendererVisible = !!visible
  })

  // List available sessions for resume
  ipcMain.handle(IPC_CHANNELS.AI_LIST_SESSIONS, async (_event, cwd?: string, configDir?: string) => {
    return listSessionsForCwd(cwd || '', configDir)
  })

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_SESSION, async (_event, sessionId: string, cwd: string, configDir?: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return { success: false, error: 'invalid session id' }
    const projectDir = resolveProjectDir(cwd, configDir)
    if (!projectDir) return { success: false, error: 'project dir not found' }
    try {
      await rm(join(projectDir, `${sessionId}.jsonl`), { force: true })
      await rm(join(projectDir, sessionId), { force: true, recursive: true })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || '删除失败' }
    }
  })

  // Load full message history from .jsonl for resume display
  ipcMain.handle(IPC_CHANNELS.AI_LOAD_SESSION_MESSAGES, async (_event, resumeSessionId: string, cwd: string, configDir?: string) => {
    return loadSessionMessages(resumeSessionId, cwd, configDir)
  })

  // Pet bubble: reply cursor over JSONL (TUI + AI tab unified source)
  ipcMain.handle(IPC_CHANNELS.AI_REPLY_INIT, async (_event, sessionId: string, cwd: string, configDir?: string) => {
    return initReplyCursor(sessionId, cwd, configDir)
  })
  ipcMain.handle(IPC_CHANNELS.AI_REPLY_STOP, (_event, sessionId: string) => {
    clearReplyCursor(sessionId)
    return true
  })
  ipcMain.handle(IPC_CHANNELS.AI_REPLY_READ, (_event, sessionId: string) => {
    readReplyIncrement(sessionId)
    return true
  })

  // Check if claude/openclaude/opencc CLI is available
  ipcMain.handle(IPC_CHANNELS.AI_CHECK_AVAILABLE, (_event, cliCommand?: string) => {
    const result = findBinary(cliCommand || undefined)
    if ('binary' in result) {
      return { available: true, binary: result.binary }
    }
    return { available: false, error: result.error, installCmd: result.installCmd }
  })

  // Resolve a config-dir input (bare name → ~/name, ~/x → home-relative, absolute → as-is) to
  // the absolute path. History sessions live under this resolved dir; the worktree marker in
  // the repo is its basename. Shared so the tui launch command and the history/worktree logic
  // agree on the same resolved path.
  ipcMain.handle(IPC_CHANNELS.AI_RESOLVE_CONFIG_DIR, (_event, configDir?: string) => {
    return resolveConfigDir(configDir)
  })

  // Spawn claude/openclaude/opencc subprocess
  ipcMain.handle(IPC_CHANNELS.AI_CREATE, async (_event, options: AiCreateOptions) => {
    const { sessionId, cwd, autoApprove, permissionMode, resumeSessionId, cliCommand, configDir, enableWorktree, persona, computerUse } = options

    const existing = aiSessions.get(sessionId)
    if (existing) {
      stopCuForSession(sessionId, existing.computerUse)
      killAiProcess(existing.process)
      aiSessions.delete(sessionId)
    }

    const permMode: AiPermissionMode = permissionMode || (autoApprove ? 'acceptEdits' : 'bypassPermissions')

    const preSnapshot = enableWorktree ? snapshotWorktrees(cwd) : undefined

    const mcpConfigPath = startCuForSession(sessionId, computerUse)

    const result = spawnClaude({ cwd, permissionMode: permMode, resumeSessionId, cliCommand, configDir, enableWorktree, persona, computerUse, mcpConfigPath })
    if ('error' in result) {
      stopCuForSession(sessionId, computerUse)
      send(IPC_CHANNELS.AI_ERROR, {
        sessionId,
        error: result.error,
        installCmd: result.installCmd,
      })
      return { success: false, error: result.error, installCmd: result.installCmd }
    }

    attachAiProcess(sessionId, result, cwd, undefined, configDir, cliCommand, computerUse)

    const created = aiSessions.get(sessionId)
    if (created) {
      created.permissionMode = permMode
      created.persona = persona?.trim() || undefined
      if (enableWorktree && preSnapshot) {
        created.enableWorktree = true
        created.preWorktreeSnapshot = preSnapshot
      }
    }

    return { success: true }
  })

  // Send user message via stdin
  ipcMain.handle(IPC_CHANNELS.AI_SEND, (_event, payload: AiSendPayload) => {
    const session = aiSessions.get(payload.sessionId)
    if (!session || !session.ready) return { success: false, error: 'AI not ready' }
    // AskUserQuestion kills the subprocess while waiting for an answer — stdin is a dead
    // pipe, so a raw write would vanish silently. Route the typed message through
    // kill-and-resume as the free-text answer so the conversation actually continues.
    if (session.awaitingUserInput) {
      const questions = (session.pendingPermission?.toolInput?.questions || []) as Array<{ question: string }>
      const answers: Record<string, string> = {}
      for (const q of questions) answers[q.question] = payload.message
      return resumeAfterAsk(payload.sessionId, answers)
    }
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
    session.permissionMode = payload.mode
    return { success: true }
  })

  // Switch model at runtime via control_request subtype=set_model.
  // CLI resolves aliases (opus/sonnet/haiku) via ANTHROPIC_DEFAULT_*_MODEL env vars.
  ipcMain.handle(IPC_CHANNELS.AI_SET_MODEL, (_event, payload: AiSetModelPayload) => {
    const session = aiSessions.get(payload.sessionId)
    if (!session) return { success: false, error: 'Session not found' }

    // Parse context window from model name (e.g. "deepseek-v4-pro[1m]" → 1M) and cache
    // immediately regardless of ready state, since the CLI doesn't echo [1m] in system/init.
    const parsed = parseContextWindowFromModel(payload.model)
    if (parsed) session.contextWindow = parsed
    session.model = payload.model

    if (!session.ready) return { success: false, error: 'AI not ready' }

    const ndjson = JSON.stringify({
      type: 'control_request',
      request_id: `set-model-${randomUUID()}`,
      request: {
        subtype: 'set_model',
        model: payload.model,
      },
    }) + '\n'
    session.process.stdin!.write(ndjson)
    send(IPC_CHANNELS.AI_MODEL_CHANGED, { sessionId: payload.sessionId, model: payload.model })
    return { success: true }
  })

  // Cancel current operation — send interrupt via stdin (CLI handles it gracefully)
  ipcMain.handle(IPC_CHANNELS.AI_CANCEL, (_event, sessionId: string) => {
    const session = aiSessions.get(sessionId)
    if (!session || !session.ready) return false
    session.cancelRequested = true
    session.process.stdin!.write(JSON.stringify({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' },
    }) + '\n')
    return true
  })

  // Force stop — kill + --resume respawn so the conversation survives even when the CLI
  // is stuck in a long tool/sub-agent that ignores interrupt.
  ipcMain.handle(IPC_CHANNELS.AI_FORCE_STOP, (_event, sessionId: string) => {
    const session = aiSessions.get(sessionId)
    if (!session) return { success: false, error: 'Session not found' }
    const claudeSessionId = session.claudeSessionId
    if (!claudeSessionId) return { success: false, error: 'No claudeSessionId cached' }
    const cwd = session.cwd
    const permissionMode = session.permissionMode || 'bypassPermissions'
    session.cancelRequested = true
    killAiProcess(session.process)
    stopCuForSession(sessionId, session.computerUse)
    stopSidecarWatchersForSession(sessionId)
    aiSessions.delete(sessionId)

    const mcpConfigPath = startCuForSession(sessionId, session.computerUse)
    const result = spawnClaude({ cwd, permissionMode, model: session.model, cliCommand: session.cliCommand, configDir: session.configDir, resumeSessionId: claudeSessionId, persona: session.persona, computerUse: session.computerUse, mcpConfigPath })
    if ('error' in result) {
      stopCuForSession(sessionId, session.computerUse)
      send(IPC_CHANNELS.AI_ERROR, {
        sessionId,
        error: result.error,
        installCmd: result.installCmd,
      })
      return { success: false, error: result.error, installCmd: result.installCmd }
    }

    attachAiProcess(sessionId, result, cwd, session.model, session.configDir, session.cliCommand, session.computerUse)

    const newSession = aiSessions.get(sessionId)
    if (newSession) {
      newSession.claudeSessionId = claudeSessionId
      newSession.permissionMode = permissionMode
      newSession.contextWindow = session.contextWindow
      newSession.persona = session.persona
      if (session.model) newSession.model = session.model
      newSession.enableWorktree = session.enableWorktree
      newSession.worktreePath = session.worktreePath
      newSession.preWorktreeSnapshot = session.preWorktreeSnapshot
    }
    return { success: true }
  })

  // Destroy session entirely
  ipcMain.handle(IPC_CHANNELS.AI_DESTROY, async (_event, sessionId: string) => {
    const session = aiSessions.get(sessionId)
    if (!session) return false
    // Deregister first so a concurrent create with the same id (mujica respawn)
    // can't be clobbered by the async worktree cleanup below.
    stopCuForSession(sessionId, session.computerUse)
    stopSidecarWatchersForSession(sessionId)
    aiSessions.delete(sessionId)
    for (const [cliId, rendererId] of cliSessionToRenderer) {
      if (rendererId === sessionId) { cliSessionToRenderer.delete(cliId); break }
    }
    // execSync taskkill so the process tree is gone before the worktree remove runs
    // (async spawn leaves files locked on Windows → remove fails → worktree leaks).
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${session.process.pid} /f /t`, { timeout: 5000, stdio: 'pipe' })
      } catch { /* already dead */ }
    } else {
      try { session.process.kill('SIGTERM') } catch { /* already dead */ }
    }
    let wt: string | null = session.worktreePath ?? null
    if (!wt && session.enableWorktree && session.preWorktreeSnapshot) {
      // trackWorktreeLater may not have fired if the agent was deleted quickly —
      // give the CLI a short window to create the worktree before the fallback
      for (let i = 0; i < 5 && !wt; i++) {
        await new Promise(r => setTimeout(r, 200))
        wt = session.worktreePath ?? detectNewWorktree(session.cwd, session.preWorktreeSnapshot, configDirMarker(session.configDir))
      }
      if (!wt) wt = detectUnmanagedWorktree(session.cwd, session.preWorktreeSnapshot)
    }
    if (wt) await removeWorktree(wt)
    return true
  })
}

export function cleanupAiSessions(): void {
  for (const [sid, session] of aiSessions) {
    if (session.computerUse) { try { require('./computer-use').stopForSession(sid) } catch {} }
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(session.process.pid), '/f', '/t'])
      } catch { /* ignore */ }
    } else {
      session.process.kill('SIGTERM')
    }
  }
  aiSessions.clear()
  cliSessionToRenderer.clear()
}
