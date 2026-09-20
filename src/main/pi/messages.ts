import type { AiMessage } from '../../shared/types'
import { asRecord, stringField, textFromContent, thinkingFromContent, toolCallsFromContent } from './protocol'

// pi 的对话记录（RPC get_messages 的 AgentMessage / 会话文件里的 message 行）→ AiMessage。
// resume 历史回放与历史视图预览共用这一份映射。记录自带毫秒 timestamp，
// 历史回放要用它（否则 meta 行 hover 出来的时间是"会话加载时刻"，同一会话全一样）。
export function piRecordToMessage(rec: unknown, messageId: string): Omit<AiMessage, 'sessionId'> | null {
  const record = asRecord(rec)
  if (!record) return null
  const timestamp = typeof record.timestamp === 'number' ? record.timestamp : 0
  const role = stringField(record, 'role')
  if (role === 'user') {
    const content = textFromContent(record.content)
    if (!content.trim()) return null
    return { type: 'user', role: 'user', messageId, content, isRealUserTurn: true, timestamp }
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
      timestamp,
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
      timestamp,
      toolResult: { toolUseId: toolCallId, content: textFromContent(record.content), isError: record.isError === true },
    }
  }
  return null
}
