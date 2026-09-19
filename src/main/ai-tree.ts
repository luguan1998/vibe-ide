import { ipcMain } from 'electron'
import { readFile, readdir, open } from 'fs/promises'
import { join } from 'path'
import { IPC_CHANNELS, type AiGraph, type AiGraphNode, type AiGraphBranch } from '../shared/types'
import { aiSessions, parseUserTurns, resolveProjectDir } from './ai'

// 网状对话：把「同一条对话的所有分叉文件」合并成一棵树。
// fork 是逐行复制前缀到新 JSONL（uuid 原样保留），所以同组文件的 uuid 互相包含；
// 按 uuid 去重合并即得完整树，无需额外元数据。
// 与 PiX 的差别：那边一轮 = 一个 worker 进程，这边一个分支文件 = 一个 GUI 会话。

const HEAD_BYTES = 16384

async function readHeadKey(filePath: string): Promise<string | null> {
  let fh
  try {
    fh = await open(filePath, 'r')
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
    if (bytesRead === 0) return null
    for (const line of buf.subarray(0, bytesRead).toString('utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        const o = JSON.parse(line)
        if (o?.uuid) return String(o.uuid)
      } catch { /* 头部可能截断到半行 */ }
    }
    return null
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}

interface Entry {
  parentUuid: string | null
  timestamp: string
}

interface Turn {
  uuid: string
  lineIdx: number
  content: string
  occurrence: number
  preview: string
  toolCallCount: number
}

interface BranchFile {
  claudeSessionId: string
  entries: Map<string, Entry>
  turns: Turn[]
}

function parseBranchFile(claudeSessionId: string, raw: string): BranchFile | null {
  const lines = raw.split('\n').filter(Boolean)
  const entries = new Map<string, Entry>()
  for (const line of lines) {
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    if (!o?.uuid) continue
    entries.set(String(o.uuid), {
      parentUuid: o.parentUuid == null ? null : String(o.parentUuid),
      timestamp: String(o.timestamp || ''),
    })
  }

  // 复用 parseUserTurns：与 revert/fork 的轮次口径保持一致
  const occurrences = new Map<string, number>()
  const turns: Turn[] = []
  for (const t of parseUserTurns(lines)) {
    let uuid: string | null = null
    try { uuid = JSON.parse(lines[t.lineIdx])?.uuid ?? null } catch { /* ignore */ }
    if (!uuid || !entries.has(uuid)) continue
    const occurrence = occurrences.get(t.content) ?? 0
    occurrences.set(t.content, occurrence + 1)
    turns.push({ uuid, lineIdx: t.lineIdx, content: t.content, occurrence, preview: '', toolCallCount: 0 })
  }
  if (turns.length === 0) return null

  // 预览：本轮 user 行之后、下一轮 user 行之前的 assistant 文本与 tool_use
  for (let i = 0; i < turns.length; i++) {
    const start = turns[i].lineIdx
    const end = i + 1 < turns.length ? turns[i + 1].lineIdx : lines.length
    const texts: string[] = []
    for (let j = start + 1; j < end; j++) {
      let o: any
      try { o = JSON.parse(lines[j]) } catch { continue }
      if (o?.type !== 'assistant' || o.isSidechain) continue
      const content = o.message?.content
      if (typeof content === 'string') { texts.push(content); continue }
      if (!Array.isArray(content)) continue
      for (const b of content) {
        if (b?.type === 'text' && b.text) texts.push(b.text)
        else if (b?.type === 'tool_use') turns[i].toolCallCount++
      }
    }
    turns[i].preview = texts.join('\n').replace(/\s+/g, ' ').trim()
  }

  return { claudeSessionId, entries, turns }
}

// 节点的父节点 = 该轮 user 行的 parentUuid 沿链上溯遇到的第一个 user 轮次
function nearestAncestorTurn(file: BranchFile, turnUuids: Set<string>, fromUuid: string | null): string | null {
  let cur = fromUuid
  let guard = 0
  while (cur && guard++ < 100000) {
    if (turnUuids.has(cur)) return cur
    const e = file.entries.get(cur)
    if (!e) return null
    cur = e.parentUuid
  }
  return null
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

async function listGroupFiles(projectDir: string, headKey: string): Promise<string[]> {
  let names: string[]
  try { names = await readdir(projectDir) } catch { return [] }
  const candidates = names.filter(n => n.endsWith('.jsonl'))
  const heads = await Promise.all(candidates.map(async (n) => {
    const h = await readHeadKey(join(projectDir, n))
    return h === headKey ? n : null
  }))
  return heads.filter((n): n is string => !!n)
}

export async function buildSessionGraph(sessionId: string, cwdOverride?: string, configDirOverride?: string): Promise<AiGraph | null> {
  const live = aiSessions.get(sessionId)
  const cwd = live?.cwd || cwdOverride || ''
  const configDir = live?.configDir ?? configDirOverride
  const selfClaudeId = live?.claudeSessionId || sessionId
  if (!cwd) return null

  const projectDir = resolveProjectDir(cwd, configDir)
  if (!projectDir) return null

  const headKey = await readHeadKey(join(projectDir, `${selfClaudeId}.jsonl`))
  if (!headKey) return null

  const fileNames = await listGroupFiles(projectDir, headKey)
  if (fileNames.length === 0) return null

  const parsed = await Promise.all(fileNames.map(async (n) => {
    try {
      return parseBranchFile(n.replace(/\.jsonl$/, ''), await readFile(join(projectDir, n), 'utf-8'))
    } catch { return null }
  }))
  const files = parsed.filter((f): f is BranchFile => !!f)
  if (files.length === 0) return null

  const nodes = new Map<string, AiGraphNode>()
  const branches: AiGraphBranch[] = []

  for (const file of files) {
    const turnUuids = new Set(file.turns.map(t => t.uuid))
    for (const turn of file.turns) {
      const existing = nodes.get(turn.uuid)
      if (existing) {
        if (!existing.branchIds.includes(file.claudeSessionId)) existing.branchIds.push(file.claudeSessionId)
        continue
      }
      const entry = file.entries.get(turn.uuid)!
      nodes.set(turn.uuid, {
        id: turn.uuid,
        parentId: nearestAncestorTurn(file, turnUuids, entry.parentUuid),
        title: clip(turn.content.replace(/\s+/g, ' ').trim(), 60),
        preview: clip(turn.preview, 160),
        timestamp: Date.parse(entry.timestamp) || 0,
        toolCallCount: turn.toolCallCount,
        hasReply: turn.preview !== '',
        depth: 0,
        active: false,
        branchIds: [file.claudeSessionId],
        tipBranchIds: [],
        fork: { claudeSessionId: file.claudeSessionId, content: turn.content, occurrence: turn.occurrence },
      })
    }
    const tipNodeId = file.turns[file.turns.length - 1].uuid
    const tipNode = nodes.get(tipNodeId)
    if (tipNode && !tipNode.tipBranchIds.includes(file.claudeSessionId)) tipNode.tipBranchIds.push(file.claudeSessionId)
    branches.push({
      claudeSessionId: file.claudeSessionId,
      turnCount: file.turns.length,
      tipNodeId,
      createdAt: nodes.get(file.turns[0].uuid)?.timestamp ?? 0,
    })
  }

  const all = [...nodes.values()]
  const byId = new Set(all.map(n => n.id))
  for (const n of all) if (n.parentId && !byId.has(n.parentId)) n.parentId = null

  const childrenOf = new Map<string | null, AiGraphNode[]>()
  for (const n of all) {
    const list = childrenOf.get(n.parentId) ?? []
    list.push(n)
    childrenOf.set(n.parentId, list)
  }
  const stack = [...(childrenOf.get(null) ?? [])].map(n => ({ n, d: 0 }))
  while (stack.length) {
    const { n, d } = stack.pop()!
    n.depth = d
    for (const c of childrenOf.get(n.id) ?? []) stack.push({ n: c, d: d + 1 })
  }

  const activeTurns = new Set((files.find(f => f.claudeSessionId === selfClaudeId)?.turns ?? []).map(t => t.uuid))
  for (const n of all) n.active = activeTurns.has(n.id)

  return { rootId: headKey, activeClaudeSessionId: selfClaudeId, nodes: all, branches }
}

export function registerTreeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_GRAPH, async (_e, payload: { sessionId: string; cwd?: string; configDir?: string }) => {
    try {
      return await buildSessionGraph(payload.sessionId, payload.cwd, payload.configDir)
    } catch (err) {
      console.error('[ai-tree] build failed:', (err as Error).message)
      return null
    }
  })
}
