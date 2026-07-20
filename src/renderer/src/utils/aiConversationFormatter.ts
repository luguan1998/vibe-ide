import type { AiMessage, UserTurn } from '@shared/types'

export function cleanMessageContent(raw: string): string {
  return raw
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim()
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '\n... (truncated)'
}

function blockquote(text: string): string {
  return text.split('\n').map(l => `> ${l}`).join('\n')
}

export function formatConversationMarkdown(
  messages: AiMessage[],
  userTurns: UserTurn[],
  sessionName: string | undefined,
  includeThinking: boolean,
  includeToolUse: boolean
): string {
  const userMessages = messages.filter(m => m.role === 'user' && m.content && m.type === 'user')
  const internalSet = new Set<AiMessage>()
  userMessages.forEach((um, idx) => {
    if (userTurns[idx]?.isInternal) internalSet.add(um)
  })

  const parts: string[] = []
  parts.push(`# ${sessionName || 'Conversation'}`)
  parts.push('')

  for (const m of messages) {
    if (internalSet.has(m)) continue
    if (m.type === 'result') continue
    if (m.role !== 'user' && m.role !== 'assistant') continue

    if (m.role === 'user') {
      const content = cleanMessageContent(m.content || '')
      if (!content) continue
      parts.push('---')
      parts.push('')
      parts.push('## User')
      parts.push('')
      parts.push(content)
      parts.push('')
      continue
    }

    const thinking = includeThinking ? m.thinking : undefined
    const tools = includeToolUse ? m.toolUse : undefined
    if (!m.content && !thinking && !(tools && tools.length > 0)) continue
    parts.push('---')
    parts.push('')
    parts.push('## Assistant')
    parts.push('')
    if (thinking) {
      parts.push(blockquote(thinking))
      parts.push('')
    }
    if (m.content) {
      parts.push(m.content)
      parts.push('')
    }
    if (tools && tools.length > 0) {
      for (const tool of tools) {
        parts.push(`**Tool: ${tool.name}**`)
        parts.push('Input:')
        parts.push('```json')
        parts.push(JSON.stringify(tool.input ?? {}, null, 2))
        parts.push('```')
        const result = tool.result
        if (result) {
          parts.push(`Result (${result.isError ? 'error' : 'ok'}):`)
          parts.push('```')
          parts.push(truncate(result.content || '', 2000))
          parts.push('```')
        }
        parts.push('')
      }
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
