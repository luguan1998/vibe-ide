import { ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  IPC_CHANNELS,
  type AiRevertPayload,
  type AiForkPayload,
  isRealUserMessage,
} from '../shared/types'
import {
  aiSessions,
  attachAiProcess,
  killAiProcess,
  send,
  spawnClaude,
  resolveProjectDir,
} from './ai'

// ── JSONL truncation ──────────────────────────────────────────────

async function truncateJsonlAtUserMessage(
  claudeSessionId: string,
  cwd: string,
  userMessageIndex: number,
  keepTarget: boolean,
): Promise<{ truncated: string[] } | { error: string }> {
  const projectDir = resolveProjectDir(cwd)
  if (!projectDir) return { error: 'Project directory not found under ~/.claude/projects/' }

  const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`)
  let content: string
  try { content = await readFile(jsonlPath, 'utf-8') } catch {
    return { error: `Session file not found: ${jsonlPath}` }
  }

  const lines = content.split('\n').filter(Boolean)
  let userMsgCount = 0
  let targetLineIdx = -1

  for (let i = 0; i < lines.length; i++) {
    let msg: any
    try { msg = JSON.parse(lines[i]) } catch { continue }

    // Count "real" user messages (string content, not tool_result arrays)
    if (msg.type === 'user' && typeof msg.message?.content === 'string' && isRealUserMessage(msg.message.content)) {
      if (userMsgCount === userMessageIndex) {
        targetLineIdx = i
        break
      }
      userMsgCount++
    }
  }

  if (targetLineIdx === -1) {
    return { error: `User message index ${userMessageIndex} not found (found ${userMsgCount} user messages)` }
  }

  // keepTarget=false (revert): truncate BEFORE the target line (exclude it)
  // keepTarget=true (fork): truncate AFTER the target line (include it)
  const truncated = keepTarget ? lines.slice(0, targetLineIdx + 1) : lines.slice(0, targetLineIdx)

  return { truncated }
}

// ── IPC handlers ──────────────────────────────────────────────────

export function registerRevertHandlers(): void {

  // ── REVERT ──────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AI_REVERT, async (_event, payload: AiRevertPayload) => {
    const { sessionId, userMessageIndex, cwd } = payload

    const prev = aiSessions.get(sessionId)
    const claudeSessionId = prev?.claudeSessionId
    if (!claudeSessionId) {
      return { success: false, error: 'No active Claude session' }
    }

    const effectiveCwd = prev?.cwd || cwd

    // 1. Truncate JSONL
    const result = await truncateJsonlAtUserMessage(claudeSessionId, effectiveCwd, userMessageIndex, false)
    if ('error' in result) {
      return { success: false, error: result.error }
    }

    // 2. Write truncated JSONL back
    const projectDir = resolveProjectDir(effectiveCwd)!
    const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`)
    try {
      await writeFile(jsonlPath, result.truncated.join('\n') + '\n', 'utf-8')
    } catch (err) {
      return { success: false, error: `Failed to write truncated session: ${(err as Error).message}` }
    }

    // 3. Kill old subprocess
    if (prev) {
      killAiProcess(prev.process)
      aiSessions.delete(sessionId)
    }

    // 4. Spawn new subprocess
    const hasHistory = result.truncated.length > 0
    const spawnResult = spawnClaude({
      cwd: effectiveCwd,
      permissionMode: prev?.permissionMode || 'bypassPermissions',
      model: prev?.model,
      ...(hasHistory ? { resumeSessionId: claudeSessionId } : {}),
    })
    if ('error' in spawnResult) {
      send(IPC_CHANNELS.AI_ERROR, {
        sessionId,
        error: spawnResult.error,
        installCmd: spawnResult.installCmd,
      })
      return { success: false, error: spawnResult.error, installCmd: spawnResult.installCmd }
    }

    attachAiProcess(sessionId, spawnResult, effectiveCwd, prev?.model)

    if (prev?.contextWindow || prev?.model) {
      const s = aiSessions.get(sessionId)
      if (s) {
        if (prev.contextWindow) s.contextWindow = prev.contextWindow
        if (prev.model) s.model = prev.model
      }
    }

    const model = prev?.model || ''
    if (hasHistory) {
      const s = aiSessions.get(sessionId)
      if (s) s.revertAwaitingReady = true
      setTimeout(() => {
        const cur = aiSessions.get(sessionId)
        if (cur?.revertAwaitingReady) {
          cur.revertAwaitingReady = false
          send(IPC_CHANNELS.AI_READY, { sessionId, tools: [], model, slashCommands: [] })
        }
      }, 3000)
    } else {
      send(IPC_CHANNELS.AI_READY, { sessionId, tools: [], model, slashCommands: [] })
    }

    return { success: true }
  })

  // ── FORK ────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AI_FORK, async (_event, payload: AiForkPayload) => {
    const { sessionId, userMessageIndex, cwd } = payload

    const prev = aiSessions.get(sessionId)
    const claudeSessionId = prev?.claudeSessionId
    if (!claudeSessionId) {
      return { success: false, error: 'No active Claude session' }
    }

    const effectiveCwd = prev?.cwd || cwd

    // 1. Truncate JSONL (keep target message for fork)
    const result = await truncateJsonlAtUserMessage(claudeSessionId, effectiveCwd, userMessageIndex, true)
    if ('error' in result) {
      return { success: false, error: result.error }
    }

    // 2. Generate new session ID and write to new JSONL
    const newClaudeSessionId = randomUUID()
    const projectDir = resolveProjectDir(effectiveCwd)!
    const newJsonlPath = join(projectDir, `${newClaudeSessionId}.jsonl`)
    try {
      await writeFile(newJsonlPath, result.truncated.join('\n') + '\n', 'utf-8')
    } catch (err) {
      return { success: false, error: `Failed to write forked session: ${(err as Error).message}` }
    }

    return { success: true, newClaudeSessionId }
  })
}
