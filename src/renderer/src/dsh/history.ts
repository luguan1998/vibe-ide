// context 动态导入：dsh client 栈（cordis + 20 插件包 + CSS）整体拆进异步 chunk，
// 避免打进主 bundle 拖慢启动；DshView 自身 lazy 后其依赖图也随异步 chunk 加载。

import type { HistoryTurn } from '../historyUtils'

export interface DshHistorySession {
  id: string
  title: string
  cwd?: string
  updatedAt?: number
  running?: boolean
}

async function getDshHandle(cwd?: string): Promise<any> {
  let port = await window.api.dsh.getPort()
  if (port === null) {
    const started = await window.api.dsh.start(cwd)
    if (!started.ok || started.port === undefined) throw new Error(started.error ?? 'dsh server start failed')
    port = started.port
  }
  const { getSharedDshContext } = await import('./context')
  return getSharedDshContext(`http://127.0.0.1:${port}`)
}

export async function getDshApi(cwd?: string): Promise<any> {
  const h = await getDshHandle(cwd)
  return (h.ctx.get('connection') as any).api
}

export async function fetchDshSessions(cwd?: string): Promise<DshHistorySession[]> {
  const h = await getDshHandle(cwd)
  const sessions = h.ctx.get('sessions') as any
  // 快照只随 host 事件增量更新：删除 jsonl 文件不产生任何事件，列表会永远陈旧。
  // refresh() 走 session.list 重拉服务端基线（single-flight），与磁盘真相对齐。
  try {
    await sessions.refresh()
  } catch {
    // refresh 内部将失败折叠进 listState，不回抛；这里兜底走快照
  }
  // dsh GUI 的「删除」= workspace.archiveSession(只进 registry 归档集，jsonl 留盘)，
  // session.list 服务端不过滤归档集，须在列表侧排除，否则 GUI 删过的会话会一直显示
  const workspaces = h.ctx.get('workspaces') as any
  try {
    await workspaces.refresh()
  } catch {}
  const archived = new Set<string>((workspaces.list.getSnapshot()?.archivedSessionIds ?? []) as string[])
  const deadline = Date.now() + 1500
  let byId: Record<string, any> = {}
  for (;;) {
    const snap = sessions.list.getSnapshot()
    byId = snap?.byId ?? {}
    if (Object.keys(byId).length > 0 || Date.now() >= deadline) break
    await new Promise((r) => setTimeout(r, 100))
  }
  return (Object.values(byId) as any[])
    .filter((s: any) => !s.blank && !archived.has(s.id))
    .map((s: any) => ({
      id: s.id,
      // wire 层 sessions.list 不带 title 字段，用 client runtime 快照：
      // displayTitle 派生规则为 title → cwd 目录名 → id（避免历史列表全是数字 id）
      title: s.title || s.displayTitle || s.id,
      cwd: s.cwd,
      updatedAt: s.updatedAt,
      running: !!s.running,
    }))
    .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function archiveDshSession(sessionId: string, cwd?: string): Promise<void> {
  const h = await getDshHandle(cwd)
  await (h.ctx.get('workspaces') as any).archiveSession(sessionId)
}

export async function fetchDshHistoryTurns(
  sessionId: string,
  cwd?: string,
): Promise<HistoryTurn[]> {
  const api = await getDshApi(cwd)
  const res = await api.sessions.history({ sessionId, maxMessages: 200 })
  if (!res.result?.ok) {
    // 会话已删除/不存在时服务端报 not-found：抛可读错误，不再静默返回空列表
    const code = res.result?.error?.code ?? 'session-history-failed'
    const message = res.result?.error?.message ?? 'session history failed'
    throw new Error(`${code}: ${message}`)
  }
  const events = ((res.result.value?.events ?? []) as any[]).map((e: any) => e.event)
  const turns: HistoryTurn[] = []
  for (const ev of events) {
    if (ev?.type !== 'user/message' && ev?.type !== 'assistant/message') continue
    // user/message 的 data 直接是 message，assistant/message 的 data 包一层 message；
    // 只取用户真实输入（source.kind === 'user'），跳过系统上下文投影/工具结果注入的 user 消息
    if (ev.type === 'user/message' && ev.data?.source?.kind !== 'user') continue
    const msg = ev.type === 'user/message' ? ev.data : ev.data?.message
    const text = (msg?.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    if (!text.trim()) continue
    turns.push({ role: ev.type === 'user/message' ? 'user' : 'assistant', text })
  }
  return turns
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
