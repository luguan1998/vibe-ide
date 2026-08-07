import { ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import { IPC_CHANNELS } from '../shared/types'
import type { AiPlanExecutePayload } from '../shared/types'
import { aiSessions, attachAiProcess, killAiProcess, send, spawnClaude } from './ai'

// Format the first user message that re-injects the approved plan into a freshly cleared context.
// Mirrors CLI's native "Approved Plan" tool_result format so the model recognizes the restoration.
function buildPlanExecutePrompt(planContent: string, planFilePath: string): string {
  return [
    'User has approved your plan and cleared the previous context for execution.',
    'The plan was saved to disk and is shown below.',
    '',
    `Plan file: ${planFilePath}`,
    '',
    '## Approved Plan:',
    '',
    planContent.trim(),
    '',
    'Proceed with implementation now.',
  ].join('\n')
}

// ExitPlanMode "Clear + Execute" path.
//
// Why this works as a "/clear + execute":
// - We kill the plan-mode subprocess without responding to its pending ExitPlanMode control_request.
//   No deny feedback is sent, so the model doesn't see "plan rejected" noise — the subprocess just dies.
// - We spawn a new subprocess WITHOUT --resume (so the new session has no inherited conversation).
// - permission-mode is bypassPermissions so subsequent Edit/Write tools don't re-prompt.
// - First user message carries the plan content; model picks up from a clean slate.
//
// Plan content is read from disk (planFilePath came in via ExitPlanMode's input.planFilePath),
// matching CLI's native behavior where plan files live in ~/.claude/plans/.
export function registerPlanExecuteHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_PLAN_EXECUTE, async (_event, payload: AiPlanExecutePayload) => {
    const { sessionId, planFilePath } = payload

    const prev = aiSessions.get(sessionId)
    const cwd = prev?.cwd || process.cwd()
    const model = payload.model || prev?.model

    if (payload.resume) {
      // ── Resume path: kill + --resume respawn → restore full context ──

      const claudeSessionId = prev?.claudeSessionId
      if (!claudeSessionId) {
        return { success: false, error: 'No claudeSessionId cached (system/init not received yet)' }
      }

      if (prev) {
        killAiProcess(prev.process)
        aiSessions.delete(sessionId)
      }

      const result = spawnClaude({ cwd, permissionMode: 'bypassPermissions', model, cliCommand: prev?.cliCommand, configDir: prev?.configDir, resumeSessionId: claudeSessionId, persona: prev?.persona })
      if ('error' in result) {
        send(IPC_CHANNELS.AI_ERROR, {
          sessionId,
          error: result.error,
          installCmd: result.installCmd,
        })
        return { success: false, error: result.error, installCmd: result.installCmd }
      }

      attachAiProcess(sessionId, result, cwd, model, prev?.configDir, prev?.cliCommand)

      const newSession = aiSessions.get(sessionId)
      if (newSession && prev) {
        newSession.claudeSessionId = claudeSessionId
        newSession.permissionMode = 'bypassPermissions'
        newSession.persona = prev.persona
        if (prev.contextWindow) newSession.contextWindow = prev.contextWindow
      }

      result.stdin!.write(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'The plan has been approved. Please proceed with implementation using the existing context.' },
        isMeta: true,
      }) + '\n')

      return { success: true }
    }

    // ── Clear & Execute path: fresh context + plan re-injection ──

    // 1. Read approved plan from disk
    let planContent: string
    try {
      planContent = await readFile(planFilePath, 'utf-8')
    } catch (err) {
      return { success: false, error: `Failed to read plan file: ${(err as Error).message}` }
    }

    // 2. Kill the plan-mode subprocess without responding to its pending control_request.
    if (prev) {
      killAiProcess(prev.process)
      aiSessions.delete(sessionId)
    }

    // 3. Spawn fresh subprocess in bypassPermissions mode (no --resume = clean context)
    const result = spawnClaude({ cwd, permissionMode: 'bypassPermissions', model, cliCommand: prev?.cliCommand, configDir: prev?.configDir, persona: prev?.persona })
    if ('error' in result) {
      send(IPC_CHANNELS.AI_ERROR, {
        sessionId,
        error: result.error,
        installCmd: result.installCmd,
      })
      return { success: false, error: result.error, installCmd: result.installCmd }
    }

    // 4. Attach stdout/stderr/error/exit handlers
    attachAiProcess(sessionId, result, cwd, model, prev?.configDir, prev?.cliCommand)

    if (prev?.contextWindow || prev?.model || prev?.persona) {
      const newSession = aiSessions.get(sessionId)
      if (newSession) {
        if (prev.contextWindow) newSession.contextWindow = prev.contextWindow
        if (prev.model) newSession.model = prev.model
        if (prev.persona) newSession.persona = prev.persona
      }
    }

    // 5. Push plan as first user message — model picks up from clean slate
    const firstMessage = buildPlanExecutePrompt(planContent, planFilePath)
    result.stdin!.write(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: firstMessage },
      isMeta: true,
    }) + '\n')

    return { success: true }
  })
}
