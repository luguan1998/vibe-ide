import { homedir } from 'os'
import { join, basename } from 'path'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'

export type HistorySource = 'claude' | 'codex' | 'dsh'

export interface HistorySessionMeta {
  session_id: string
  name: string
  timestamp: number
  model?: string
  sizeBytes: number
  cwd: string
}

export interface HistoryMessage {
  type: 'user' | 'assistant'
  role: 'user' | 'assistant'
  content: string
}

function walkDirs(root: string, visitFile: (path: string, name: string) => void): void {
  let entries: { name: string; isDirectory(): boolean }[]
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = join(root, e.name)
    if (e.isDirectory()) walkDirs(p, visitFile)
    else visitFile(p, e.name)
  }
}

function walkDirsOnly(root: string, visitDir: (path: string, name: string) => void): void {
  let entries: { name: string; isDirectory(): boolean }[]
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = join(root, e.name)
    visitDir(p, e.name)
    walkDirsOnly(p, visitDir)
  }
}

function extractTextBlocks(content: any, kinds: string[]): string {
  return (Array.isArray(content) ? content : [])
    .map((b: any) => kinds.includes(b?.type) ? (b.text || '') : '')
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

// ── Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl ──
function readCodexMeta(filePath: string): HistorySessionMeta | null {
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n')
    const first = JSON.parse(lines[0] || '')
    if (first.type !== 'session_meta' || !first.payload?.id) return null
    const p = first.payload
    let name = ''
    for (const line of lines.slice(1, 300)) {
      try {
        const ev = JSON.parse(line)
        const pl = ev.payload
        if (ev.type === 'response_item' && pl?.type === 'message' && pl.role === 'user') {
          const text = extractTextBlocks(pl.content, ['text', 'input_text'])
          if (text && !text.startsWith('<')) { name = text.slice(0, 60); break }
        }
      } catch {}
    }
    return {
      session_id: p.id,
      name,
      timestamp: new Date(p.timestamp).getTime(),
      model: p.model || p.model_provider || '',
      sizeBytes: statSync(filePath).size,
      cwd: p.cwd || '',
    }
  } catch { return null }
}

export function listCodexSessions(cwd: string): HistorySessionMeta[] {
  const root = join(homedir(), '.codex', 'sessions')
  if (!existsSync(root)) return []
  const out: HistorySessionMeta[] = []
  walkDirs(root, (p, name) => {
    if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) return
    const meta = readCodexMeta(p)
    if (meta && (!cwd || meta.cwd === cwd)) out.push(meta)
  })
  out.sort((a, b) => b.timestamp - a.timestamp)
  return out.slice(0, 30)
}

export function loadCodexMessages(sessionId: string): HistoryMessage[] {
  const root = join(homedir(), '.codex', 'sessions')
  if (!existsSync(root)) return []
  let file: string | null = null
  walkDirs(root, (p, name) => {
    if (file) return
    if (name.startsWith('rollout-') && name.endsWith('.jsonl') && name.includes(sessionId)) file = p
  })
  if (!file) return []
  const out: HistoryMessage[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      const pl = ev.payload
      if (ev.type !== 'response_item' || !pl || pl.type !== 'message') continue
      if (pl.role !== 'user' && pl.role !== 'assistant') continue
      const text = extractTextBlocks(pl.content, ['text', 'input_text', 'output_text'])
      if (!text) continue
      out.push({ type: pl.role, role: pl.role, content: text })
    } catch {}
  }
  return out
}

// ── DSH: ~/.dsh/sessions/<cwd>/session-<uuid>/session.jsonl.zstd ──
function decompressZstd(file: string): string[] {
  try {
    const buf = execFileSync('zstd', ['-d', '-c', file], { maxBuffer: 128 * 1024 * 1024 })
    return buf.toString('utf8').split('\n')
  } catch { return [] }
}

function readDshMeta(sessionDir: string): HistorySessionMeta | null {
  const file = join(sessionDir, 'session.jsonl.zstd')
  if (!existsSync(file)) return null
  try {
    const lines = decompressZstd(file)
    const first = JSON.parse(lines[0] || '')
    if (first.type !== 'session') return null
    let name = ''
    for (const line of lines.slice(1, 200)) {
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'session/title' && ev.data?.title) { name = String(ev.data.title).slice(0, 60); break }
      } catch {}
    }
    return {
      session_id: first.id || basename(sessionDir),
      name,
      timestamp: first.createdAt || 0,
      model: '',
      sizeBytes: statSync(file).size,
      cwd: first.cwd || '',
    }
  } catch { return null }
}

export function listDshSessions(cwd: string): HistorySessionMeta[] {
  const root = join(homedir(), '.dsh', 'sessions')
  if (!existsSync(root)) return []
  const out: HistorySessionMeta[] = []
  walkDirsOnly(root, (p, name) => {
    if (!name.startsWith('session-')) return
    const meta = readDshMeta(p)
    if (meta && (!cwd || meta.cwd === cwd)) out.push(meta)
  })
  out.sort((a, b) => b.timestamp - a.timestamp)
  return out.slice(0, 30)
}

export function loadDshMessages(sessionId: string): HistoryMessage[] {
  const root = join(homedir(), '.dsh', 'sessions')
  if (!existsSync(root)) return []
  let sessionDir: string | null = null
  walkDirsOnly(root, (p, name) => {
    if (sessionDir) return
    if (name.startsWith('session-') && (name === sessionId || name.includes(sessionId))) sessionDir = p
  })
  if (!sessionDir) return []
  const lines = decompressZstd(join(sessionDir, 'session.jsonl.zstd'))
  const out: HistoryMessage[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      if (ev.type === 'user/message' && ev.data) {
        const id = ev.data.id
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        const text = extractTextBlocks(ev.data.content, ['text'])
        if (text) out.push({ type: 'user', role: 'user', content: text })
      } else if (ev.type === 'agent/inbox/spliced' && Array.isArray(ev.data?.inserted)) {
        for (const m of ev.data.inserted) {
          if (m.role !== 'user' && m.role !== 'assistant') continue
          const id = m.id
          if (id && seen.has(id)) continue
          if (id) seen.add(id)
          const text = extractTextBlocks(m.content, ['text'])
          if (text) out.push({ type: m.role, role: m.role, content: text })
        }
      }
    } catch {}
  }
  return out
}
