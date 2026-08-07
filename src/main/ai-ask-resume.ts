import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { AiAskResumePayload } from '../shared/types'
import { resumeAfterAsk } from './ai'

// AskUserQuestion answer handling is implemented in resumeAfterAsk (./ai): the CLI auto-fills
// an empty answer ~0.5s after the control_request, so we kill the subprocess and --resume the
// same claude session with the user's answers as a fresh user message. Shared with AI_SEND so
// a message typed into the prompt box while awaiting an answer takes the same path.
export function registerAskResumeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_ASK_RESUME, (_event, payload: AiAskResumePayload) => {
    return resumeAfterAsk(payload.sessionId, payload.answers)
  })
}
