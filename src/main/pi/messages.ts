import type { AiMessage } from '../../shared/types'
import { asRecord, stringField, textFromContent, thinkingFromContent, toolCallsFromContent } from './protocol'

// pi 的对话记录（RPC get_messages 的 AgentMessage / 会话文件里的 message 行）→ AiMessage。
// resume 历史回放与历史视图预览共用这一份映射。
export function piRecordToMessage(rec: unknown, messageId: string): Omit<AiMessage, 'sessionId' | 'timestamp'> | null {
  const record = asRecord(rec)
  if (!record) return null
  const role = stringField(record, 'role')
  if (role === 'user') {
    const content = textFromContent(record.content)
    if (!content.trim()) return null
    return { type: 'user', role: 'user', messageId, content, isRealUserTurn: true }
  }
  if (role === 'assistant') {
    const content = textFromContent(record.content)
    const thinking = thinkingFromContent(record.content)
    const toolUse = toolCallsFromContent(record.content)
    if (!content.trim() && !thinking.trim() && toolUse.length === 0) return null
    return {
      type: 'assistant',
      role: 'assistant',
      messageId,
      ...(content.trim() ? { content } : {}),
      ...(thinking.trim() ? { thinking } : {}),
      ...(toolUse.length > 0 ? { toolUse } : {}),
    }
  }
  if (role === 'toolResult') {
    const toolCallId = stringField(record, 'toolCallId')
    if (!toolCallId) return null
    return {
      type: 'user',
      role: 'user',
      toolResult: { toolUseId: toolCallId, content: textFromContent(record.content), isError: record.isError === true },
    }
  }
  return null
}
