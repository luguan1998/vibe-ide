export const INTERJECT_HISTORY_MAX = 3

export interface InterjectRecord { id: string; text: string; reply?: string }

const store: Record<string, InterjectRecord[]> = {}

export function loadInterjectRecords(sessionId: string): InterjectRecord[] {
  const list = store[sessionId]
  return Array.isArray(list) ? list : []
}

export function addInterjectRecord(sessionId: string, text: string): { records: InterjectRecord[]; id: string } {
  const t = text.trim()
  if (!t) return { records: loadInterjectRecords(sessionId), id: '' }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const next = [
    { id, text: t },
    ...loadInterjectRecords(sessionId).filter(r => r.text !== t),
  ].slice(0, INTERJECT_HISTORY_MAX)
  store[sessionId] = next
  return { records: next, id }
}

export function setInterjectReply(sessionId: string, id: string, reply: string): InterjectRecord[] {
  const next = loadInterjectRecords(sessionId).map(r => r.id === id ? { ...r, reply } : r)
  if (next.length) store[sessionId] = next
  return next
}

export function removeInterjectRecord(sessionId: string, id: string): InterjectRecord[] {
  const next = loadInterjectRecords(sessionId).filter(r => r.id !== id)
  if (next.length) store[sessionId] = next
  else delete store[sessionId]
  return next
}
