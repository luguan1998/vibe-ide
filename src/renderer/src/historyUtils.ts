export interface HistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

export function buildHistoryTurns(messages: any[]): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  for (const m of messages || []) {
    if (m.type !== 'user' && m.type !== 'assistant') continue
    const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant'
    const text = typeof m.content === 'string' ? m.content.replace(/\s+/g, ' ').trim() : ''
    if (!text) continue
    const last = turns[turns.length - 1]
    // 连续同角色合并；答只取最后一段正文，中间的工具调用/思考不算正文
    if (last && last.role === role) last.text = role === 'assistant' ? text : `${last.text} ${text}`
    else turns.push({ role, text })
  }
  return turns
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  if (n < 1000000) return `${(n / 1000).toFixed(1)} kB`
  return `${(n / 1000000).toFixed(1)} MB`
}
