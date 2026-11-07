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

// ── 新会话继续：从渲染层内存直接提取摘要，免整读 3MB 级 JSONL ──
// 用户消息在最前作意图真相源；轮次 N ≤ 6 全保留，N > 6 首 3 轮 + 末 3 轮，中间省略一行。
// pi 无 userTurns（仅 claude 填充），调用方传 deriveUserTurns 的结果兜底。
const DIGEST_TURN_MAX_CHARS = 300
const DIGEST_LAST_REPLY_MAX_CHARS = 1000

export function buildSessionDigest(
  messages: AiMessage[],
  userTurns: UserTurn[],
  transcriptPath: string | null,
  t: (key: string) => string,
): string {
  const isRealTurn = (content: string) => cleanMessageContent(content) !== ''
  const realTurns = userTurns.filter(turn => !turn.isInternal && isRealTurn(turn.content))

  const sections: { title: string; body: string }[] = []
  if (realTurns.length > 0) {
    const quote = (turn: UserTurn) => `- "${truncate(cleanMessageContent(turn.content), DIGEST_TURN_MAX_CHARS)}"`
    const lines = realTurns.length > 6
      ? [...realTurns.slice(0, 3).map(quote), t('({n} middle messages omitted)').replace('{n}', () => String(realTurns.length - 6)), ...realTurns.slice(-3).map(quote)]
      : realTurns.map(quote)
    sections.push({ title: t('All user messages'), body: lines.join('\n') })
  }

  const lastReply = [...messages].reverse().find(m => m.role === 'assistant' && m.type === 'assistant' && m.content?.trim())
  if (lastReply?.content) {
    sections.push({ title: t('Latest reply'), body: truncate(lastReply.content.trim(), DIGEST_LAST_REPLY_MAX_CHARS) })
  }

  if (sections.length === 0 && !transcriptPath) return ''
  let head: string
  if (!transcriptPath) {
    head = t('Continued from previous session. Summary:')
  } else if (sections.length > 0) {
    head = t('Continued from previous session. Full transcript: {path}. Summary:').replace('{path}', () => transcriptPath)
  } else {
    head = t('Continued from previous session. Full transcript: {path}').replace('{path}', () => transcriptPath)
  }
  const parts: string[] = [head]
  sections.forEach(s => parts.push(`## ${s.title}\n${s.body}`))
  return parts.join('\n\n')
}
