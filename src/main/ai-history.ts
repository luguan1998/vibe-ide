import { ipcMain } from 'electron'
import { readFile, readdir, stat, rm } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { IPC_CHANNELS } from '../shared/types'
import type { AiSearchOptions, AiSessionSummary, AiSessionSearchGroup, AiSearchMatch } from '../shared/types'
import { extractSessionMeta, getProjectsRoot, cleanText, loadSessionMessagesFromProject, normalizeCwdToProjectDir } from './ai'

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_MATCHES_PER_SESSION = 20
const DEFAULT_MAX_SESSIONS_PER_PROJECT = 100
const DEFAULT_MAX_TOTAL_MATCHES = 2000
const MAX_SESSIONS_PER_PROJECT_LIST = 100
const MAX_TOTAL_SESSIONS_LIST = 1000
const MATCH_TEXT_MAX = 400

function isWithinProjectsRoot(projectDir: string, projectsRoot: string): boolean {
  const resolved = resolve(projectDir)
  return resolved === projectsRoot || resolved.startsWith(projectsRoot + sep)
}

// 提取单行纯文本：user 行取 content（跳过系统注入），assistant 行只取 text block，
// 避免匹配到 JSON 字段名 / thinking / tool_use 噪音
function extractLineText(msg: any): string | null {
  if (!msg || typeof msg.message !== 'object') return null
  if (msg.type === 'user') {
    const content = msg.message.content
    if (typeof content !== 'string') return null
    if (msg.isMeta === true || content.includes('AskUserQuestionResultBase64:')) return null
    return cleanText(content)
  }
  if (msg.type === 'assistant' && Array.isArray(msg.message.content)) {
    const parts: string[] = []
    for (const block of msg.message.content) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n')
  }
  return null
}

// 逐行匹配；assistant 流式多行（同 message.id）只计第一条，避免重复匹配
function collectMatches(lines: string[], match: (text: string) => boolean, max: number): AiSearchMatch[] {
  const out: AiSearchMatch[] = []
  const seenAssistant = new Set<string>()
  for (const line of lines) {
    if (out.length >= max) break
    let msg: any
    try { msg = JSON.parse(line) } catch { continue }
    const text = extractLineText(msg)
    if (!text) continue
    const msgId = msg.type === 'assistant' ? msg.message?.id : undefined
    if (msgId && seenAssistant.has(msgId)) continue
    if (!match(text)) continue
    if (msgId) seenAssistant.add(msgId)
    out.push({
      role: msg.type === 'user' ? 'user' : 'assistant',
      text: text.length > MATCH_TEXT_MAX ? `${text.slice(0, MATCH_TEXT_MAX)}…` : text,
    })
  }
  return out
}

async function searchSessions(query: string, opts?: AiSearchOptions): Promise<{ sessions: AiSessionSearchGroup[]; truncated: boolean }> {
  const q = (query || '').trim()
  if (!q) return { sessions: [], truncated: false }

  const caseSensitive = !!opts?.caseSensitive
  const needle = caseSensitive ? q : q.toLowerCase()
  const match = (text: string) => (caseSensitive ? text.includes(q) : text.toLowerCase().includes(needle))

  const maxFileBytes = opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxMatchesPerSession = opts?.maxMatchesPerSession ?? DEFAULT_MAX_MATCHES_PER_SESSION
  const maxSessionsPerProject = opts?.maxSessionsPerProject ?? DEFAULT_MAX_SESSIONS_PER_PROJECT
  const maxTotalMatches = opts?.maxTotalMatches ?? DEFAULT_MAX_TOTAL_MATCHES

  const projectsRoot = getProjectsRoot(opts?.configDir)
  const dirs = await readdir(projectsRoot).catch(() => [] as string[])

  const results: AiSessionSearchGroup[] = []
  let totalMatches = 0
  let truncated = false

  outer:
  for (const dirName of dirs) {
    const projectDir = join(projectsRoot, dirName)
    let files: string[]
    try { files = await readdir(projectDir) } catch { continue }
    let projectCount = 0
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      if (projectCount >= maxSessionsPerProject) break
      if (totalMatches >= maxTotalMatches) { truncated = true; break outer }
      const filePath = join(projectDir, f)
      const fileStat = await stat(filePath).catch(() => null)
      if (!fileStat || fileStat.size > maxFileBytes) continue
      let content: string
      try { content = await readFile(filePath, 'utf-8') } catch { continue }
      const lines = content.split('\n').filter(Boolean)
      const meta = await extractSessionMeta(filePath, fileStat.size, lines)
      if (!meta) continue
      const sessionMatches = collectMatches(lines, match, maxMatchesPerSession)
      if (sessionMatches.length === 0) continue
      results.push({ ...meta, projectDir, projectDirName: dirName, inCurrentProject: false, matches: sessionMatches })
      projectCount++
      totalMatches += sessionMatches.length
    }
  }

  results.sort((a, b) => b.timestamp - a.timestamp)
  return { sessions: results, truncated }
}

async function listAllSessions(configDir?: string, currentCwd?: string): Promise<{ sessions: AiSessionSummary[]; total: number }> {
  const projectsRoot = getProjectsRoot(configDir)
  const currentCandidates = currentCwd
    ? [normalizeCwdToProjectDir(currentCwd), normalizeCwdToProjectDir(currentCwd).toLowerCase()]
    : null

  const dirs = await readdir(projectsRoot).catch(() => [] as string[])
  const all: AiSessionSummary[] = []
  for (const dirName of dirs) {
    const projectDir = join(projectsRoot, dirName)
    let files: string[]
    try { files = await readdir(projectDir) } catch { continue }
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
    const inCurrent = currentCandidates ? currentCandidates.includes(dirName) : false
    let count = 0
    for (const f of jsonlFiles) {
      if (count >= MAX_SESSIONS_PER_PROJECT_LIST || all.length >= MAX_TOTAL_SESSIONS_LIST) break
      const filePath = join(projectDir, f)
      const fileStat = await stat(filePath).catch(() => null)
      const sizeBytes = fileStat?.size ?? 0
      const meta = await extractSessionMeta(filePath, sizeBytes)
      if (!meta) continue
      all.push({ ...meta, projectDir, projectDirName: dirName, inCurrentProject: inCurrent })
      count++
    }
    if (all.length >= MAX_TOTAL_SESSIONS_LIST) break
  }

  all.sort((a, b) => b.timestamp - a.timestamp)
  return { sessions: all, total: all.length }
}

export function registerHistoryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_LIST_ALL_SESSIONS, async (_event, configDir?: string, currentCwd?: string) => {
    return listAllSessions(configDir, currentCwd)
  })

  ipcMain.handle(IPC_CHANNELS.AI_SEARCH_SESSIONS, async (_event, query: string, opts?: AiSearchOptions) => {
    return searchSessions(query, opts)
  })

  ipcMain.handle(IPC_CHANNELS.AI_LOAD_SESSION_MESSAGES_BY_DIR, async (_event, resumeSessionId: string, projectDir: string, configDir?: string) => {
    const projectsRoot = getProjectsRoot(configDir)
    if (!isWithinProjectsRoot(projectDir, projectsRoot)) return { messages: [], model: '', slashCommands: [] }
    return loadSessionMessagesFromProject(resumeSessionId, projectDir)
  })

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_SESSION_BY_DIR, async (_event, sessionId: string, projectDir: string, configDir?: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return { success: false, error: 'invalid session id' }
    const projectsRoot = getProjectsRoot(configDir)
    if (!isWithinProjectsRoot(projectDir, projectsRoot)) return { success: false, error: 'invalid project dir' }
    try {
      await rm(join(projectDir, `${sessionId}.jsonl`), { force: true })
      await rm(join(projectDir, sessionId), { force: true, recursive: true })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || '删除失败' }
    }
  })
}
