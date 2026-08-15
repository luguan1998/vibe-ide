import { homedir } from 'os'
import { join, basename, dirname } from 'path'
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { open, stat } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

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

const PREFIX_BYTES = 64 * 1024
const LIST_CACHE_TTL = 60 * 1000
const listCache = new Map<string, { at: number; sessions: HistorySessionMeta[] }>()

// ── 持久化索引：扫描结果落盘（userData），之后只增量扫新文件 ──
let indexPath = ''
let indexLoaded = false
let codexIndex: Record<string, CodexLightMeta> = {}
let dshIndex: Record<string, DshLightMeta> = {}

export function setHistoryIndexPath(p: string): void {
  indexPath = p
}

function loadIndex(): void {
  if (indexLoaded) return
  indexLoaded = true
  if (!indexPath) return
  try {
    const data = JSON.parse(readFileSync(indexPath, 'utf8'))
    codexIndex = data.codex || {}
    dshIndex = data.dsh || {}
  } catch {
    codexIndex = {}
    dshIndex = {}
  }
}

function saveIndex(): void {
  if (!indexPath) return
  try {
    mkdirSync(dirname(indexPath), { recursive: true })
    writeFileSync(indexPath, JSON.stringify({ codex: codexIndex, dsh: dshIndex }))
  } catch {}
}

function getCached(key: string): HistorySessionMeta[] | null {
  const hit = listCache.get(key)
  return hit && Date.now() - hit.at < LIST_CACHE_TTL ? hit.sessions : null
}

function normalizeDshCwdDir(cwd: string): string {
  return '-' + cwd.replace(/[^a-zA-Z0-9_]/g, '-') + '--'
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

async function readPrefix(file: string, maxBytes: number): Promise<string> {
  try {
    const fh = await open(file, 'r')
    try {
      const size = (await fh.stat()).size
      const buf = Buffer.alloc(Math.min(maxBytes, size))
      if (buf.length > 0) await fh.read(buf, 0, buf.length, 0)
      return buf.toString('utf8')
    } finally { await fh.close() }
  } catch { return '' }
}

async function decompressZstdPrefix(file: string, maxBytes: number): Promise<string> {
  try {
    const { stdout } = await execFileP('sh', ['-c', `zstd -d -c '${file}' 2>/dev/null | head -c ${maxBytes}`], { maxBuffer: maxBytes + 4096 })
    return stdout
  } catch { return '' }
}

function extractTextBlocks(content: any, kinds: string[]): string {
  return (Array.isArray(content) ? content : [])
    .map((b: any) => kinds.includes(b?.type) ? (b.text || '') : '')
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function isRealUserText(text: string): boolean {
  return !!text && !text.startsWith('<') && !text.startsWith('# AGENTS.md') && !text.startsWith('The following is the Codex')
}

function isScratchCwd(cwd: string): boolean {
  if (!cwd) return false
  const c = cwd.replace(/\\/g, '/')
  return /\/var\/folders\/[^/]+\/[^/]+\/T\//.test(c) || c.startsWith('/tmp/') || c.includes('/Temp/')
}

// ── Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl ──
// 存储按日期分目录，cwd 只在每个文件首行 session_meta 里——扫描时只读首行做 cwd 匹配，
// 命中当前目录的会话才进一步读前缀提取名字。
interface CodexLightMeta {
  filePath: string
  id: string
  name: string
  nameChecked?: boolean
  cwd: string
  timestamp: number
  model: string
  sizeBytes: number
}

async function readCodexMetaLight(filePath: string): Promise<CodexLightMeta | null> {
  try {
    const prefix = await readPrefix(filePath, PREFIX_BYTES)
    const lines = prefix.split('\n')
    const first = JSON.parse(lines[0] || '')
    if (first.type !== 'session_meta' || !first.payload?.id) return null
    const p = first.payload
    let name = ''
    for (const line of lines.slice(1)) {
      try {
        const ev = JSON.parse(line)
        const pl = ev.payload
        if (ev.type === 'response_item' && pl?.type === 'message' && pl.role === 'user') {
          const text = extractTextBlocks(pl.content, ['text', 'input_text'])
          if (isRealUserText(text)) { name = text.slice(0, 60); break }
        }
      } catch {}
    }
    return {
      filePath,
      id: p.id,
      name,
      nameChecked: name !== '',
      cwd: p.cwd || '',
      timestamp: new Date(p.timestamp).getTime(),
      model: p.model || p.model_provider || '',
      sizeBytes: (await stat(filePath).catch(() => null))?.size ?? 0,
    }
  } catch { return null }
}

async function deepCodexName(filePath: string): Promise<string> {
  const prefix = await readPrefix(filePath, 512 * 1024)
  for (const line of prefix.split('\n').slice(1)) {
    try {
      const ev = JSON.parse(line)
      const pl = ev.payload
      if (ev.type === 'response_item' && pl?.type === 'message' && pl.role === 'user') {
        const text = extractTextBlocks(pl.content, ['text', 'input_text'])
        if (isRealUserText(text)) return text.slice(0, 60)
      }
    } catch {}
  }
  return ''
}

export async function listCodexSessions(cwd: string, force = false): Promise<HistorySessionMeta[]> {
  const key = 'codex:' + cwd
  if (!force) {
    const cached = getCached(key)
    if (cached) return cached
  }
  const root = join(homedir(), '.codex', 'sessions')
  if (!existsSync(root)) return []
  loadIndex()
  const files: string[] = []
  walkDirs(root, (p, name) => { if (name.startsWith('rollout-') && name.endsWith('.jsonl')) files.push(p) })
  // 清理已删除 + 只增量扫新文件
  const diskSet = new Set(files)
  let changed = false
  for (const k of Object.keys(codexIndex)) if (!diskSet.has(k)) { delete codexIndex[k]; changed = true }
  const newFiles = files.filter(f => !codexIndex[f])
  if (newFiles.length > 0) {
    const metas = await mapLimit(newFiles, 32, readCodexMetaLight)
    for (const m of metas) if (m) { codexIndex[m.filePath] = m; changed = true }
  }
  if (changed) saveIndex()
  const matched = Object.values(codexIndex)
    .filter(m => (!cwd || m.cwd === cwd) && (cwd ? true : !isScratchCwd(m.cwd)))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30)
  let saved = false
  const result = await mapLimit(matched, 8, async (m) => {
    let name = m.name
    if (!m.nameChecked) {
      name = await deepCodexName(m.filePath)
      codexIndex[m.filePath] = { ...m, name, nameChecked: true }
      saved = true
    }
    return { session_id: m.id, name, timestamp: m.timestamp, model: m.model, sizeBytes: m.sizeBytes, cwd: m.cwd }
  })
  if (saved) saveIndex()
  listCache.set(key, { at: Date.now(), sessions: result })
  return result
}

export async function loadCodexMessages(sessionId: string): Promise<HistoryMessage[]> {
  const root = join(homedir(), '.codex', 'sessions')
  if (!existsSync(root)) return []
  let file: string | null = null
  walkDirs(root, (p, name) => {
    if (file) return
    if (name.startsWith('rollout-') && name.endsWith('.jsonl') && name.includes(sessionId)) file = p
  })
  if (!file) return []
  const out: HistoryMessage[] = []
  const text = await import('fs/promises').then(m => m.readFile(file as string, 'utf8')).catch(() => '')
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      const pl = ev.payload
      if (ev.type !== 'response_item' || !pl || pl.type !== 'message') continue
      if (pl.role !== 'user' && pl.role !== 'assistant') continue
      const content = extractTextBlocks(pl.content, ['text', 'input_text', 'output_text'])
      if (!content) continue
      out.push({ type: pl.role, role: pl.role, content })
    } catch {}
  }
  return out
}

// ── DSH: ~/.dsh/sessions/<cwd>/session-<uuid>/session.jsonl.zstd ──
interface DshLightMeta {
  dir: string
  id: string
  name: string
  cwd: string
  timestamp: number
  sizeBytes: number
}

async function readDshMeta(sessionDir: string): Promise<DshLightMeta | null> {
  const file = join(sessionDir, 'session.jsonl.zstd')
  if (!existsSync(file)) return null
  try {
    const prefix = await decompressZstdPrefix(file, PREFIX_BYTES)
    const lines = prefix.split('\n')
    const first = JSON.parse(lines[0] || '')
    if (first.type !== 'session') return null
    let name = ''
    for (const line of lines.slice(1)) {
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'session/title' && ev.data?.title) { name = String(ev.data.title).slice(0, 60); break }
      } catch {}
    }
    const size = (await stat(file).catch(() => null))?.size ?? 0
    return { dir: sessionDir, id: first.id || basename(sessionDir), name, cwd: first.cwd || '', timestamp: first.createdAt || 0, sizeBytes: size }
  } catch { return null }
}

export async function listDshSessions(cwd: string, force = false): Promise<HistorySessionMeta[]> {
  const key = 'dsh:' + cwd
  if (!force) {
    const cached = getCached(key)
    if (cached) return cached
  }
  const root = join(homedir(), '.dsh', 'sessions')
  if (!existsSync(root)) return []
  loadIndex()
  const dirs: string[] = []
  if (cwd) {
    // DSH 按 cwd 目录存储：-<normalized-cwd>--/session-*
    const target = join(root, normalizeDshCwdDir(cwd))
    if (!existsSync(target)) return []
    let entries: { name: string; isDirectory(): boolean }[]
    try { entries = readdirSync(target, { withFileTypes: true }) } catch { return [] }
    for (const e of entries) if (e.isDirectory() && e.name.startsWith('session-')) dirs.push(join(target, e.name))
  } else {
    walkDirsOnly(root, (p, name) => { if (name.startsWith('session-')) dirs.push(p) })
    // 全量视图才清理已删除会话
    const diskSet = new Set(dirs)
    for (const k of Object.keys(dshIndex)) if (!diskSet.has(k)) delete dshIndex[k]
  }
  const newDirs = dirs.filter(d => !dshIndex[d])
  if (newDirs.length > 0) {
    const metas = await mapLimit(newDirs, 8, readDshMeta)
    let changed = false
    for (const m of metas) if (m) { dshIndex[m.dir] = m; changed = true }
    if (changed) saveIndex()
  }
  const result = Object.values(dshIndex)
    .filter(m => (!cwd || m.cwd === cwd) && (cwd ? true : !isScratchCwd(m.cwd)))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30)
    .map(m => ({ session_id: m.id, name: m.name, timestamp: m.timestamp, model: '', sizeBytes: m.sizeBytes, cwd: m.cwd }))
  listCache.set(key, { at: Date.now(), sessions: result })
  return result
}

export async function loadDshMessages(sessionId: string): Promise<HistoryMessage[]> {
  const root = join(homedir(), '.dsh', 'sessions')
  if (!existsSync(root)) return []
  let sessionDir: string | null = null
  walkDirsOnly(root, (p, name) => {
    if (sessionDir) return
    if (name.startsWith('session-') && (name === sessionId || name.includes(sessionId))) sessionDir = p
  })
  if (!sessionDir) return []
  const { stdout } = await execFileP('zstd', ['-d', '-c', join(sessionDir, 'session.jsonl.zstd')], { maxBuffer: 128 * 1024 * 1024 }).catch(() => ({ stdout: '' }))
  const out: HistoryMessage[] = []
  const seen = new Set<string>()
  for (const line of stdout.split('\n')) {
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
