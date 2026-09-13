import { ipcMain } from 'electron'
import { open, readFile, readdir, rm, stat } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve, sep } from 'path'
import { IPC_CHANNELS, type AiMessage, type AiSearchOptions, type AiSearchMatch, type AiSessionSearchGroup, type AiSessionSummary, type AiSlashCommand } from '../../shared/types'
import { asRecord, stringField, textFromContent } from './protocol'
import { piRecordToMessage } from './messages'

// pi 的会话存储：~/.pi/agent/sessions/<dashed-cwd>/<ISO时间>_<sessionId>.jsonl，
// 首行是 {type:'session', id, cwd, timestamp} 头，其余为 model_change / thinking_level_change / message 行。
const PI_SESSIONS_ROOT = join(homedir(), '.pi', 'agent', 'sessions')
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_SESSIONS_PER_PROJECT = 100
const MAX_TOTAL_SESSIONS = 1000
const MAX_MATCHES_PER_SESSION = 20
const MATCH_TEXT_MAX = 400

function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

function isWithinRoot(projectDir: string): boolean {
  const root = resolve(PI_SESSIONS_ROOT)
  const target = resolve(projectDir)
  return target === root || target.startsWith(root + sep)
}

async function readHeader(filePath: string): Promise<{ sessionId: string; cwd: string; timestamp: number } | null> {
  let handle
  try {
    handle = await open(filePath, 'r')
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0]
    const rec = asRecord(JSON.parse(firstLine))
    if (!rec || stringField(rec, 'type') !== 'session') return null
    const timestamp = Date.parse(stringField(rec, 'timestamp') ?? '')
    return {
      sessionId: stringField(rec, 'id') ?? '',
      cwd: stringField(rec, 'cwd') ?? '',
      timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
    }
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

// 列表/搜索共用的行提取：user 正文（跳过工具回填）、assistant 文本、模型名
function sessionName(lines: string[]): string {
  for (const line of lines) {
    let rec: any
    try { rec = JSON.parse(line) } catch { continue }
    if (rec?.type !== 'message') continue
    const message = asRecord(rec.message)
    if (stringField(message, 'role') !== 'user') continue
    const text = textFromContent(message?.content).replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 60)
  }
  return ''
}

function sessionModel(lines: string[]): string {
  for (const line of lines) {
    let rec: any
    try { rec = JSON.parse(line) } catch { continue }
    if (rec?.type === 'model_change') {
      const provider = stringField(rec, 'provider')
      const modelId = stringField(rec, 'modelId')
      if (provider && modelId) return `${provider}/${modelId}`
    }
    if (rec?.type === 'message') {
      const message = asRecord(rec.message)
      const provider = stringField(message, 'provider')
      const model = stringField(message, 'model')
      if (provider && model) return `${provider}/${model}`
    }
  }
  return ''
}

function lineMatchText(rec: any): string | null {
  if (rec?.type !== 'message') return null
  const message = asRecord(rec.message)
  const role = stringField(message, 'role')
  if (role !== 'user' && role !== 'assistant') return null
  const text = textFromContent(message?.content).replace(/\s+/g, ' ').trim()
  return text || null
}

type PiFileEntry = {
  filePath: string
  projectDir: string
  projectDirName: string
  sessionId: string
  cwd: string
  timestamp: number
  name: string
  model: string
  sizeBytes: number
}

async function listPiFiles(): Promise<PiFileEntry[]> {
  const dirs = await readdir(PI_SESSIONS_ROOT).catch(() => [] as string[])
  const entries: PiFileEntry[] = []
  for (const dirName of dirs) {
    const projectDir = join(PI_SESSIONS_ROOT, dirName)
    const files = await readdir(projectDir).catch(() => [] as string[])
    let count = 0
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      if (count >= MAX_SESSIONS_PER_PROJECT || entries.length >= MAX_TOTAL_SESSIONS) break
      const filePath = join(projectDir, file)
      const fileStat = await stat(filePath).catch(() => null)
      if (!fileStat || fileStat.size === 0 || fileStat.size > MAX_FILE_BYTES) continue
      const header = await readHeader(filePath)
      if (!header?.sessionId) continue
      let lines: string[] = []
      try { lines = (await readFile(filePath, 'utf-8')).split('\n').filter(Boolean) } catch { continue }
      entries.push({
        filePath,
        projectDir,
        projectDirName: header.cwd || dirName,
        sessionId: header.sessionId,
        cwd: header.cwd,
        timestamp: header.timestamp || fileStat.mtimeMs,
        name: sessionName(lines) || header.sessionId,
        model: sessionModel(lines),
        sizeBytes: fileStat.size,
      })
      count++
    }
    if (entries.length >= MAX_TOTAL_SESSIONS) break
  }
  return entries
}

function toSummary(entry: PiFileEntry, currentCwd?: string): AiSessionSummary {
  return {
    session_id: entry.sessionId,
    name: entry.name,
    timestamp: entry.timestamp,
    model: entry.model,
    sizeBytes: entry.sizeBytes,
    cwd: entry.cwd,
    projectDir: entry.projectDir,
    projectDirName: entry.projectDirName,
    inCurrentProject: samePath(entry.cwd, currentCwd),
  }
}

async function listPiSessions(currentCwd?: string): Promise<{ sessions: AiSessionSummary[]; total: number }> {
  const entries = await listPiFiles()
  const sessions = entries
    .map((entry) => toSummary(entry, currentCwd))
    .sort((a, b) => b.timestamp - a.timestamp)
  return { sessions, total: sessions.length }
}

async function searchPiSessions(query: string, opts?: AiSearchOptions): Promise<{ sessions: AiSessionSearchGroup[]; truncated: boolean }> {
  const q = (query || '').trim()
  if (!q) return { sessions: [], truncated: false }
  const caseSensitive = !!opts?.caseSensitive
  const needle = caseSensitive ? q : q.toLowerCase()
  const matches = (text: string) => (caseSensitive ? text.includes(q) : text.toLowerCase().includes(needle))

  const entries = await listPiFiles()
  const results: AiSessionSearchGroup[] = []
  let truncated = false
  for (const entry of entries) {
    if (results.length >= MAX_TOTAL_SESSIONS) { truncated = true; break }
    let lines: string[]
    try { lines = (await readFile(entry.filePath, 'utf-8')).split('\n').filter(Boolean) } catch { continue }
    const found: AiSearchMatch[] = []
    let scanned = 0
    for (const line of lines) {
      if (found.length >= MAX_MATCHES_PER_SESSION) break
      if (++scanned > 5000) { truncated = true; break }
      let rec: any
      try { rec = JSON.parse(line) } catch { continue }
      const text = lineMatchText(rec)
      if (!text || !matches(text)) continue
      const message = asRecord(rec.message)
      found.push({
        role: stringField(message, 'role') === 'user' ? 'user' : 'assistant',
        text: text.length > MATCH_TEXT_MAX ? `${text.slice(0, MATCH_TEXT_MAX)}…` : text,
      })
    }
    if (found.length > 0) results.push({ ...toSummary(entry, opts?.currentCwd), matches: found })
  }
  results.sort((a, b) => b.timestamp - a.timestamp)
  return { sessions: results, truncated }
}

async function loadPiSessionMessages(sessionId: string, projectDir: string): Promise<{ messages: AiMessage[]; model: string; slashCommands: AiSlashCommand[] }> {
  const empty = { messages: [] as AiMessage[], model: '', slashCommands: [] as AiSlashCommand[] }
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId) || !isWithinRoot(projectDir)) return empty
  const files = await readdir(projectDir).catch(() => [] as string[])
  const file = files.find((f) => f.endsWith(`_${sessionId}.jsonl`))
  if (!file) return empty
  let lines: string[]
  try { lines = (await readFile(join(projectDir, file), 'utf-8')).split('\n').filter(Boolean) } catch { return empty }
  const messages: AiMessage[] = []
  for (let i = 0; i < lines.length; i++) {
    let rec: any
    try { rec = JSON.parse(lines[i]) } catch { continue }
    if (rec?.type !== 'message') continue
    const mapped = piRecordToMessage(rec.message, `pi-file-${i}`)
    if (mapped) messages.push({ sessionId, timestamp: typeof rec.timestamp === 'number' ? rec.timestamp : 0, ...mapped })
  }
  return { messages, model: sessionModel(lines), slashCommands: [] }
}

async function deletePiSession(sessionId: string, projectDir: string): Promise<{ success: boolean; error?: string }> {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return { success: false, error: 'invalid session id' }
  if (!isWithinRoot(projectDir)) return { success: false, error: 'invalid project dir' }
  const files = await readdir(projectDir).catch(() => [] as string[])
  const file = files.find((f) => f.endsWith(`_${sessionId}.jsonl`))
  if (!file) return { success: false, error: 'session file not found' }
  try {
    await rm(join(projectDir, file), { force: true })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message || '删除失败' }
  }
}

export function registerPiHistoryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_LIST_PI_SESSIONS, async (_event, currentCwd?: string) => {
    return listPiSessions(currentCwd)
  })

  ipcMain.handle(IPC_CHANNELS.AI_SEARCH_PI_SESSIONS, async (_event, query: string, opts?: AiSearchOptions) => {
    return searchPiSessions(query, opts)
  })

  ipcMain.handle(IPC_CHANNELS.AI_LOAD_PI_SESSION_MESSAGES, async (_event, sessionId: string, projectDir: string) => {
    return loadPiSessionMessages(sessionId, projectDir)
  })

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_PI_SESSION, async (_event, sessionId: string, projectDir: string) => {
    return deletePiSession(sessionId, projectDir)
  })
}
