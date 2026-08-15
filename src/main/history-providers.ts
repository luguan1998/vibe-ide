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
  threadId?: string
  name: string
  timestamp: number
  model?: string
  sizeBytes: number
  cwd: string
  workspace?: string
  workspacePath?: string
}

export interface HistoryMessage {
  type: 'user' | 'assistant'
  role: 'user' | 'assistant'
  content: string
}

const PREFIX_BYTES = 64 * 1024
const LIST_CACHE_TTL = 60 * 1000
const listCache = new Map<string, { at: number; sessions: HistorySessionMeta[] }>()

// ── 持久化索引：codex 扫描结果落盘（userData），之后只增量扫新文件 ──
const INDEX_VERSION = 2
let indexPath = ''
let indexLoaded = false
let codexIndex: Record<string, CodexLightMeta> = {}

export function setHistoryIndexPath(p: string): void {
  indexPath = p
}

function loadIndex(): void {
  if (indexLoaded) return
  indexLoaded = true
  if (!indexPath) return
  try {
    const data = JSON.parse(readFileSync(indexPath, 'utf8'))
    codexIndex = data.version === INDEX_VERSION ? (data.codex || {}) : {}
  } catch {
    codexIndex = {}
  }
}

function saveIndex(): void {
  if (!indexPath) return
  try {
    mkdirSync(dirname(indexPath), { recursive: true })
    writeFileSync(indexPath, JSON.stringify({ version: INDEX_VERSION, codex: codexIndex }))
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
  threadId: string
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
      threadId: p.session_id || '',
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
  const prefix = await readPrefix(filePath, 256 * 1024)
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

interface CodexProjectInfo {
  name: string
  path: string
}

// Codex 的“项目”注册表：~/.codex/.codex-global-state.json
//   local-projects: projectId -> { name, rootPaths }；thread-project-assignments: threadId -> { projectId, cwd }
// 会话按 threadId（session_meta 里的 session_id）归属项目；无归属时按 cwd 匹配根路径（最长前缀）。
function readCodexProjectMaps(): { byThread: Map<string, CodexProjectInfo>; list: CodexProjectInfo[] } {
  const byThread = new Map<string, CodexProjectInfo>()
  const byId = new Map<string, CodexProjectInfo>()
  const list: CodexProjectInfo[] = []
  try {
    const raw = readFileSync(join(homedir(), '.codex', '.codex-global-state.json'), 'utf8')
    const data = JSON.parse(raw)
    const projects = data['local-projects'] || {}
    for (const [pid, p] of Object.entries(projects)) {
      const name = String((p as any)?.name || '')
      const roots = ((p as any)?.rootPaths || []) as string[]
      if (!name || roots.length === 0) continue
      const info: CodexProjectInfo = { name, path: roots[0] }
      byId.set(pid, info)
      list.push(info)
    }
    const assignments = data['thread-project-assignments'] || {}
    for (const [tid, a] of Object.entries(assignments)) {
      const info = byId.get(String((a as any)?.projectId || ''))
      if (info) byThread.set(tid, info)
    }
  } catch {}
  list.sort((a, b) => b.path.length - a.path.length)
  return { byThread, list }
}

function resolveCodexProject(maps: { byThread: Map<string, CodexProjectInfo>; list: CodexProjectInfo[] }, threadId: string, cwd: string): CodexProjectInfo | null {
  if (threadId && maps.byThread.has(threadId)) return maps.byThread.get(threadId)!
  const c = (cwd || '').replace(/\/+$/, '')
  if (!c) return null
  for (const p of maps.list) {
    if (c === p.path || c.startsWith(p.path + '/')) return p
  }
  return null
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
  let matched = Object.values(codexIndex)
    .filter(m => (!cwd || m.cwd === cwd) && (cwd ? true : !isScratchCwd(m.cwd)))
    .sort((a, b) => b.timestamp - a.timestamp)
  // 深检名字（未查过的），缓存回索引
  const needName = matched.filter(m => !m.nameChecked)
  if (needName.length > 0) {
    const names = await mapLimit(needName, 8, async (m) => ({ file: m.filePath, name: await deepCodexName(m.filePath) }))
    for (const n of names) {
      const entry = codexIndex[n.file]
      if (entry) { codexIndex[n.file] = { ...entry, name: n.name, nameChecked: true }; changed = true }
    }
    if (changed) saveIndex()
    // 深检更新了索引（新对象），需重新从索引派生 matched
    matched = Object.values(codexIndex)
      .filter(m => (!cwd || m.cwd === cwd) && (cwd ? true : !isScratchCwd(m.cwd)))
      .sort((a, b) => b.timestamp - a.timestamp)
  }
  // 有真实用户消息才算有效会话（过滤 resume 测试等纯系统注入会话）
  matched = matched.filter(m => m.nameChecked && m.name)
  const projMaps = readCodexProjectMaps()
  const result = matched.slice(0, 30).map(m => {
    const proj = resolveCodexProject(projMaps, m.threadId, m.cwd)
    return {
      session_id: m.id, threadId: m.threadId || '', name: m.name, timestamp: m.timestamp, model: m.model, sizeBytes: m.sizeBytes, cwd: m.cwd,
      workspace: proj?.name || basename(m.cwd) || m.cwd, workspacePath: proj?.path || m.cwd,
    }
  })
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
      if (pl.role === 'user' && !isRealUserText(content)) continue
      out.push({ type: pl.role, role: pl.role, content })
    } catch {}
  }
  return out
}

// ── DSH: 会话列表用 harness 自己的索引 ~/.dsh/storages/session_projcache.json ──
// 与 DSH Web UI 同一数据源（id/cwd/createdAt/title/goal/turns），无需解压 zstd；
// 消息仍按需解压 session.jsonl.zstd。
interface DshProjSession {
  id: string
  cwd: string
  createdAt: number
  title: string
  goal: string
  turns: number
}

function readDshProjCache(): DshProjSession[] {
  try {
    const raw = readFileSync(join(homedir(), '.dsh', 'storages', 'session_projcache.json'), 'utf8')
    const data = JSON.parse(raw)
    const sessions = data.tables?.sessions || {}
    return Object.entries(sessions).map(([id, v]: [string, any]) => ({
      id,
      cwd: v.identity?.cwd || '',
      createdAt: v.identity?.createdAt || 0,
      title: String(v.rows?.title?.val || ''),
      goal: String(v.rows?.goal?.val?.goal?.objective || ''),
      turns: Number(v.rows?.sessionStats?.val?.turns || 0),
    }))
  } catch { return [] }
}

interface DshWorkspaceInfo {
  title: string
  path: string
}

// DSH 的“工作区”注册表 ~/.dsh/storages/workspace.json：每个 workspace 记录 title/path 及其 sessionIds。
// 会话只按 sessionIds 归属工作区；不在任何工作区里的会话归入“未分组”，与 DSH Web UI 一致。
const DSH_UNGROUPED_KEY = '__dsh_ungrouped__'
const DSH_UNGROUPED_LABEL = '未分组'

function readDshWorkspaceBySession(): Map<string, DshWorkspaceInfo> {
  const bySession = new Map<string, DshWorkspaceInfo>()
  try {
    const raw = readFileSync(join(homedir(), '.dsh', 'storages', 'workspace.json'), 'utf8')
    const workspaces = (JSON.parse(raw) as any).tables?.workspaces || {}
    for (const ws of Object.values(workspaces) as any[]) {
      const title = String(ws?.title || '')
      const path = String(ws?.path || '')
      if (!path) continue
      const info: DshWorkspaceInfo = { title: title || basename(path), path }
      for (const sid of (ws?.sessionIds || [])) bySession.set(String(sid), info)
    }
  } catch {}
  return bySession
}

function findDshSessionDir(cwd: string, sessionId: string): string | null {
  const root = join(homedir(), '.dsh', 'sessions')
  const target = join(root, normalizeDshCwdDir(cwd))
  if (!existsSync(target)) return null
  const prefixed = sessionId.startsWith('session-') ? sessionId : 'session-' + sessionId
  for (const candidate of [prefixed, sessionId]) {
    const p = join(target, candidate)
    if (existsSync(p) && existsSync(join(p, 'session.jsonl.zstd'))) return p
  }
  return null
}

export async function listDshSessions(cwd: string, force = false): Promise<HistorySessionMeta[]> {
  const key = 'dsh:' + cwd
  if (!force) {
    const cached = getCached(key)
    if (cached) return cached
  }
  const bySession = readDshWorkspaceBySession()
  const result = readDshProjCache()
    .filter(s => s.turns > 0 && (!cwd || s.cwd === cwd) && (cwd ? true : !isScratchCwd(s.cwd)))
    .sort((a, b) => {
      const aU = bySession.has(a.id) ? 0 : 1
      const bU = bySession.has(b.id) ? 0 : 1
      if (aU !== bU) return aU - bU
      return b.createdAt - a.createdAt
    })
    .slice(0, 30)
    .map(s => {
      const ws = bySession.get(s.id)
      return {
        session_id: s.id,
        name: (s.title || s.goal || '').slice(0, 60),
        timestamp: s.createdAt,
        model: '',
        sizeBytes: 0,
        cwd: s.cwd,
        workspace: ws?.title || DSH_UNGROUPED_LABEL,
        workspacePath: ws?.path || DSH_UNGROUPED_KEY,
      }
    })
  listCache.set(key, { at: Date.now(), sessions: result })
  return result
}

export async function loadDshMessages(sessionId: string): Promise<HistoryMessage[]> {
  const proj = readDshProjCache().find(s => s.id === sessionId)
  if (!proj) return []
  const sessionDir = findDshSessionDir(proj.cwd, sessionId)
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
