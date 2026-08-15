import { getSharedDshContext } from './context'

export interface DshHistorySession {
  id: string
  title: string
  cwd?: string
  updatedAt?: number
  running?: boolean
}

export async function getDshApi(cwd?: string): Promise<any> {
  let port = await window.api.dsh.getPort()
  if (port === null) {
    const started = await window.api.dsh.start(cwd)
    if (!started.ok || started.port === undefined) throw new Error(started.error ?? 'dsh server start failed')
    port = started.port
  }
  const h = await getSharedDshContext(`http://127.0.0.1:${port}`)
  return (h.ctx.get('connection') as any).api
}

export async function fetchDshSessions(cwd?: string): Promise<DshHistorySession[]> {
  const api = await getDshApi(cwd)
  const res = await api.sessions.list({})
  if (!res.result?.ok) throw new Error(res.result?.error?.message ?? 'dsh session list failed')
  const items = (res.result.value?.items ?? []) as any[]
  return items
    .filter((s: any) => !s.blank)
    .map((s: any) => ({
      id: s.sessionId ?? s.id,
      title: s.title || s.displayTitle || s.sessionId || s.id,
      cwd: s.cwd,
      updatedAt: s.updatedAt ?? s.createdAt,
      running: !!s.running,
    }))
}

async function extractLatestReply(api: any, sessionId: string): Promise<{ messageId: string; text: string } | null> {
  const res = await api.sessions.history({ sessionId, maxMessages: 3 })
  if (!res.result?.ok) return null
  const events = ((res.result.value?.events ?? []) as any[]).map((e: any) => e.event)
  if (events.length === 0) return null
  // 最后一条 assistant/message 即最新完整回复（不做 foldSurface，避免引入 node 侧依赖）
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev?.type !== 'assistant/message') continue
    const msg = ev.data?.message
    const text = (msg?.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    if (!text.trim()) continue
    return { messageId: String(msg?.id ?? ev.seq), text }
  }
  return null
}

export async function fetchDshLatestReply(
  sessionId: string,
  cwd?: string,
): Promise<{ messageId: string; text: string } | null> {
  try {
    const api = await getDshApi(cwd)
    // 优先当前会话；无回复时回退到当前目录 updatedAt 最新的会话
    const reply = await extractLatestReply(api, sessionId)
    if (reply) return reply
    if (!cwd) return null
    const listRes = await api.sessions.list({})
    if (!listRes.result?.ok) return null
    const items = ((listRes.result.value?.items ?? []) as any[])
      .filter((s: any) => !s.blank && s.cwd === cwd)
      .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    for (const s of items) {
      const id = s.sessionId ?? s.id
      if (id === sessionId) continue
      const r = await extractLatestReply(api, id)
      if (r) return r
    }
    return null
  } catch {
    return null
  }
}
