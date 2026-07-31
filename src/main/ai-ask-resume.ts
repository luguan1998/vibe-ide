import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { AiAskResumePayload } from '../shared/types'
import { aiSessions, attachAiProcess, killAiProcess, send, spawnClaude } from './ai'

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

export function registerAskResumeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_ASK_RESUME, async (_event, payload: AiAskResumePayload) => {
    console.log(`[ASK-RESUME ${payload.sessionId}] invoked answers=${JSON.stringify(payload.answers)}`)
    const session = aiSessions.get(payload.sessionId)
    if (!session) {
      console.log(`[ASK-RESUME ${payload.sessionId}] ABORT: session not in aiSessions`)
      return { success: false, error: 'Session not found' }
    }
    console.log(`[ASK-RESUME ${payload.sessionId}] session found: claudeSessionId=${session.claudeSessionId} permissionMode=${session.permissionMode} cwd=${session.cwd}`)

    const claudeSessionId = session.claudeSessionId
    const cwd = session.cwd
    const permissionMode = session.permissionMode || 'bypassPermissions'

    if (!claudeSessionId) {
      console.log(`[ASK-RESUME ${payload.sessionId}] ABORT: no claudeSessionId cached`)
      return { success: false, error: 'No claudeSessionId cached (system/init not received yet)' }
    }

    // Kill the auto-filling subprocess. Safe to call even if AskUserQuestion
    // handler already killed it (Windows taskkill /f /t is a no-op on dead PID;
    // Unix kill is wrapped in try/catch inside killAiProcess). Clear the flag
    // so the new subprocess's eventual exit is not misclassified as proactive.
    killAiProcess(session.process)
    session.awaitingUserInput = false
    aiSessions.delete(payload.sessionId)
    console.log(`[ASK-RESUME ${payload.sessionId}] killed old subprocess, spawning with --resume ${claudeSessionId}`)

    const result = spawnClaude({ cwd, permissionMode, model: session.model, cliCommand: session.cliCommand, configDir: session.configDir, resumeSessionId: claudeSessionId, persona: session.persona })
    if ('error' in result) {
      console.log(`[ASK-RESUME ${payload.sessionId}] ABORT: spawnClaude failed: ${result.error}`)
      send(IPC_CHANNELS.AI_ERROR, {
        sessionId: payload.sessionId,
        error: result.error,
        installCmd: result.installCmd,
      })
      return { success: false, error: result.error, installCmd: result.installCmd }
    }
    console.log(`[ASK-RESUME ${payload.sessionId}] new subprocess spawned, attaching handlers`)

    attachAiProcess(payload.sessionId, result, cwd, session.model, session.configDir, session.cliCommand)

    const newSession = aiSessions.get(payload.sessionId)
    if (newSession) {
      newSession.claudeSessionId = claudeSessionId
      newSession.permissionMode = permissionMode
      newSession.contextWindow = session.contextWindow
      newSession.persona = session.persona
      if (session.model) newSession.model = session.model
    }

    const prompt = formatAskUserAnswer(payload.answers)
    console.log(`[ASK-RESUME ${payload.sessionId}] sending prompt (${prompt.length} chars): ${prompt.slice(0, 120)}...`)
    result.stdin!.write(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    }) + '\n')

    return { success: true }
  })
}
