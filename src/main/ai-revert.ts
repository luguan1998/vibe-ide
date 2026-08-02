import { ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  IPC_CHANNELS,
  type AiRevertPayload,
  type AiForkPayload,
  type UserTurn,
} from '../shared/types'
import {
  aiSessions,
  attachAiProcess,
  killAiProcess,
  send,
  spawnClaude,
  resolveProjectDir,
  parseUserTurns,
} from './ai'

// ── JSONL truncation ──────────────────────────────────────────────

async function truncateJsonlAtUserMessage(
  claudeSessionId: string,
  cwd: string,
  userMessageIndex: number,
  keepTarget: boolean,
  configDir?: string,
): Promise<{ truncated: string[] } | { error: string }> {
  const projectDir = resolveProjectDir(cwd, configDir)
  if (!projectDir) return { error: 'Project directory not found under ~/.claude/projects/' }

  const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`)
  let content: string
  try { content = await readFile(jsonlPath, 'utf-8') } catch {
    return { error: `Session file not found: ${jsonlPath}` }
  }

  const lines = content.split('\n').filter(Boolean)
  const turns = parseUserTurns(lines)
  if (userMessageIndex < 0 || userMessageIndex >= turns.length) {
    return { error: `User message index ${userMessageIndex} not found (found ${turns.length} user turns)` }
  }
  const targetLineIdx = turns[userMessageIndex].lineIdx

  // keepTarget=false (revert): truncate BEFORE the target (exclude it).
  // keepTarget=true (fork): keep the ENTIRE turn (user message + its assistant reply + result),
  // up to (but not including) the next user message — fork from the meta row points at the
  // turn's user message, so cutting at the user line alone would drop the finished reply.
  let endIdx = targetLineIdx
  if (keepTarget) {
    const nextTurnStart = userMessageIndex + 1 < turns.length
      ? turns[userMessageIndex + 1].lineIdx
      : lines.length
    endIdx = nextTurnStart - 1
  }
  const truncated = keepTarget ? lines.slice(0, endIdx + 1) : lines.slice(0, targetLineIdx)

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
    const result = await truncateJsonlAtUserMessage(claudeSessionId, effectiveCwd, userMessageIndex, false, prev?.configDir)
    if ('error' in result) {
      return { success: false, error: result.error }
    }

    // 2. Write truncated JSONL back
    const projectDir = resolveProjectDir(effectiveCwd, prev?.configDir)!
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
      cliCommand: prev?.cliCommand,
      configDir: prev?.configDir,
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

    attachAiProcess(sessionId, spawnResult, effectiveCwd, prev?.model, prev?.configDir, prev?.cliCommand)

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
    const result = await truncateJsonlAtUserMessage(claudeSessionId, effectiveCwd, userMessageIndex, true, prev?.configDir)
    if ('error' in result) {
      return { success: false, error: result.error }
    }

    // 2. Generate new session ID and write to new JSONL
    const newClaudeSessionId = randomUUID()
    const projectDir = resolveProjectDir(effectiveCwd, prev?.configDir)!
    const newJsonlPath = join(projectDir, `${newClaudeSessionId}.jsonl`)
    try {
      await writeFile(newJsonlPath, result.truncated.join('\n') + '\n', 'utf-8')
    } catch (err) {
      return { success: false, error: `Failed to write forked session: ${(err as Error).message}` }
    }

    return { success: true, newClaudeSessionId }
  })

  // ── LIST USER TURNS ─────────────────────────────────────────────
  // Single source of truth for the renderer's revert-node list: read the JSONL and run
  // parseUserTurns. The renderer calls this on ready / after each result / after revert /
  // after resume to align its revert indices with the real JSONL turns.
  ipcMain.handle(IPC_CHANNELS.AI_LIST_USER_TURNS, async (_event, payload: { sessionId: string; cwd: string }) => {
    const { sessionId, cwd } = payload
    const prev = aiSessions.get(sessionId)
    const claudeSessionId = prev?.claudeSessionId
    if (!claudeSessionId) return [] as UserTurn[]
    const effectiveCwd = prev?.cwd || cwd
    const projectDir = resolveProjectDir(effectiveCwd, prev?.configDir)
    if (!projectDir) return [] as UserTurn[]
    const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`)
    let content: string
    try { content = await readFile(jsonlPath, 'utf-8') } catch { return [] as UserTurn[] }
    const lines = content.split('\n').filter(Boolean)
    return parseUserTurns(lines)
  })
}
