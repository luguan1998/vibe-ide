const STORAGE_KEY = 'vibe-ide-pet-interjects'
export const INTERJECT_HISTORY_MAX = 3

export interface InterjectRecord { id: string; text: string; reply?: string }

type Store = Record<string, InterjectRecord[]>

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Store
  } catch {}
  return {}
}

function writeStore(store: Store): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)) } catch {}
}

export function loadInterjectRecords(sessionId: string): InterjectRecord[] {
  const list = readStore()[sessionId]
  if (!Array.isArray(list)) return []
  return list
    .filter(r => r && typeof r.id === 'string' && typeof r.text === 'string' && r.text.trim())
    .slice(0, INTERJECT_HISTORY_MAX)
}

export function addInterjectRecord(sessionId: string, text: string): { records: InterjectRecord[]; id: string } {
  const t = text.trim()
  if (!t) return { records: loadInterjectRecords(sessionId), id: '' }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const next = [
    { id, text: t },
    ...loadInterjectRecords(sessionId).filter(r => r.text !== t),
  ].slice(0, INTERJECT_HISTORY_MAX)
  const store = readStore()
  store[sessionId] = next
  writeStore(store)
  return { records: next, id }
}

export function setInterjectReply(sessionId: string, id: string, reply: string): InterjectRecord[] {
  const next = loadInterjectRecords(sessionId).map(r => r.id === id ? { ...r, reply } : r)
  const store = readStore()
  if (next.length) store[sessionId] = next
  writeStore(store)
  return next
}

export function removeInterjectRecord(sessionId: string, id: string): InterjectRecord[] {
  const next = loadInterjectRecords(sessionId).filter(r => r.id !== id)
  const store = readStore()
  if (next.length) store[sessionId] = next
  else delete store[sessionId]
  writeStore(store)
  return next
}
