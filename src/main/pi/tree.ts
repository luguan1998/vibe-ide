import { open, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import type { AiGraph, AiGraphNode, AiGraphBranch } from '../../shared/types'
import { asRecord, textFromContent, toolCallsFromContent } from './protocol'
import { assignDepths, assignForkPoints, clip, normPath } from '../graph-shared'
import { PI_SESSIONS_ROOT } from './history'

// 网状对话（pi 版）：与 claude 的差别是血缘不用猜——
// 每个会话文件首行是 {type:'session', id, cwd, parentSession?}，分叉出来的文件显式指着源文件；
// 文件内每条记录带 id/parentId，本身就是一棵树。所以「同组文件」= 沿 parentSession 的连通分量，
// 无需 ai-tree 那套按头部行签名归纳的启发式。
// 一个文件 = 一条分支（GUI 的 fork 每次都落新文件），与 claude 侧口径一致。

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_HEAD_BYTES = 4096

interface FileIndex {
  path: string
  sessionId: string
  cwd: string
  parentSession: string | null
}

interface ParsedFile extends FileIndex {
  entries: Map<string, { parentId: string | null; timestamp: number }>
  rootId: string | null
  turns: Array<{ id: string; lineIdx: number; content: string; occurrence: number; preview: string; toolCallCount: number }>
}

async function readIndex(filePath: string): Promise<FileIndex | null> {
  let fh
  try {
    fh = await open(filePath, 'r')
    const buf = Buffer.alloc(MAX_HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, MAX_HEAD_BYTES, 0)
    if (bytesRead === 0) return null
    const first = buf.subarray(0, bytesRead).toString('utf-8').split('\n')[0]
    const rec = asRecord(JSON.parse(first))
    if (!rec || rec.type !== 'session') return null
    const sessionId = typeof rec.id === 'string' ? rec.id : ''
    if (!sessionId) return null
    return {
      path: filePath,
      sessionId,
      cwd: typeof rec.cwd === 'string' ? rec.cwd : '',
      parentSession: typeof rec.parentSession === 'string' ? rec.parentSession : null,
    }
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}

function parseFile(index: FileIndex, raw: string): ParsedFile | null {
  const lines = raw.split('\n').filter(Boolean)
  const entries = new Map<string, { parentId: string | null; timestamp: number }>()
  const rootIds: string[] = []
  const userLines: number[] = []
  for (let i = 1; i < lines.length; i++) {
    let rec: any
    try { rec = JSON.parse(lines[i]) } catch { continue }
    const id = typeof rec?.id === 'string' ? rec.id : null
    if (!id) continue
    const parentId = typeof rec.parentId === 'string' ? rec.parentId : null
    const ts = Date.parse(typeof rec.timestamp === 'string' ? rec.timestamp : '')
    entries.set(id, { parentId, timestamp: Number.isNaN(ts) ? 0 : ts })
    if (!parentId) rootIds.push(id)
    if (rec.type === 'message' && asRecord(rec.message)?.role === 'user') userLines.push(i)
  }

  const occurrences = new Map<string, number>()
  const turns: ParsedFile['turns'] = []
  for (const lineIdx of userLines) {
    const rec = JSON.parse(lines[lineIdx])
    const content = textFromContent(asRecord(rec.message)?.content)
    if (!content.trim()) continue
    const occurrence = occurrences.get(content) ?? 0
    occurrences.set(content, occurrence + 1)
    turns.push({ id: rec.id, lineIdx, content, occurrence, preview: '', toolCallCount: 0 })
  }
  if (turns.length === 0) return null

  // 预览：本轮 user 行之后、下一轮 user 行之前的 assistant 文本与工具调用
  for (let i = 0; i < turns.length; i++) {
    const start = turns[i].lineIdx
    const end = i + 1 < turns.length ? turns[i + 1].lineIdx : lines.length
    const texts: string[] = []
    for (let j = start + 1; j < end; j++) {
      let rec: any
      try { rec = JSON.parse(lines[j]) } catch { continue }
      if (rec?.type !== 'message') continue
      const message = asRecord(rec.message)
      if (message?.role !== 'assistant') continue
      const text = textFromContent(message.content)
      if (text.trim()) texts.push(text)
      turns[i].toolCallCount += toolCallsFromContent(message.content).length
    }
    turns[i].preview = texts.join('\n').replace(/\s+/g, ' ').trim()
  }

  return { ...index, entries, rootId: rootIds[0] ?? null, turns }
}

// 组的连通分量：先按 parentSession 上溯祖先，再在同根集合里向下收后代（跨目录也能连上）
function collectGroup(byPath: Map<string, FileIndex>, sourcePath: string): FileIndex[] {
  const group = new Map<string, FileIndex>()
  const queue = [sourcePath]
  const childrenOf = new Map<string, FileIndex[]>()
  for (const entry of byPath.values()) {
    if (!entry.parentSession) continue
    const key = normPath(entry.parentSession)
    const list = childrenOf.get(key) ?? []
    list.push(entry)
    childrenOf.set(key, list)
  }
  while (queue.length > 0) {
    const key = normPath(queue.pop()!)
    if (group.has(key)) continue
    const entry = byPath.get(key)
    if (!entry) continue
    group.set(key, entry)
    if (entry.parentSession) queue.push(entry.parentSession)
    for (const child of childrenOf.get(key) ?? []) queue.push(child.path)
  }
  return [...group.values()]
}

function nearestAncestorTurn(file: ParsedFile, turnIds: Set<string>, fromId: string | null): string | null {
  let cur = fromId
  let guard = 0
  while (cur && guard++ < 100000) {
    if (turnIds.has(cur)) return cur
    const entry = file.entries.get(cur)
    if (!entry) return null
    cur = entry.parentId
  }
  return null
}

async function listAllSessionFiles(): Promise<FileIndex[]> {
  const dirs = await readdir(PI_SESSIONS_ROOT).catch(() => [] as string[])
  const out: FileIndex[] = []
  for (const dirName of dirs) {
    const dir = join(PI_SESSIONS_ROOT, dirName)
    const files = await readdir(dir).catch(() => [] as string[])
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const index = await readIndex(join(dir, file))
      if (index) out.push(index)
    }
  }
  return out
}

// 入参是 pi 侧的会话 id（IPC 层从 GUI 会话解析），保持本模块纯文件读取、可单独测
export async function buildPiSessionGraph(piSessionId: string, cwdOverride?: string): Promise<AiGraph | null> {
  if (!piSessionId) return null

  const all = await listAllSessionFiles()
  const source = all.find((f) => f.sessionId === piSessionId)
  if (!source) return null

  const byPath = new Map<string, FileIndex>(all.map((f) => [normPath(f.path), f]))
  const files: ParsedFile[] = []
  for (const index of collectGroup(byPath, source.path)) {
    try {
      const raw = await readFile(index.path, 'utf-8')
      if (raw.length > MAX_FILE_BYTES) continue
      const parsed = parseFile(index, raw)
      if (parsed) files.push(parsed)
    } catch { /* 单文件失败不影响整图 */ }
  }
  if (files.length === 0) return null

  const nodes = new Map<string, AiGraphNode>()
  const branches: AiGraphBranch[] = []
  for (const file of files) {
    const turnIds = new Set(file.turns.map((t) => t.id))
    for (const turn of file.turns) {
      const existing = nodes.get(turn.id)
      if (existing) {
        if (!existing.branchIds.includes(file.sessionId)) existing.branchIds.push(file.sessionId)
        continue
      }
      nodes.set(turn.id, {
        id: turn.id,
        parentId: nearestAncestorTurn(file, turnIds, file.entries.get(turn.id)?.parentId ?? null),
        title: clip(turn.content.replace(/\s+/g, ' ').trim(), 60),
        preview: clip(turn.preview, 160),
        timestamp: file.entries.get(turn.id)?.timestamp ?? 0,
        toolCallCount: turn.toolCallCount,
        hasReply: turn.preview !== '',
        depth: 0,
        active: false,
        branchIds: [file.sessionId],
        tipBranchIds: [],
        fork: {
          claudeSessionId: file.sessionId,
          sourceCwd: file.cwd || cwdOverride || '',
          content: turn.content,
          occurrence: turn.occurrence,
        },
      })
    }
    const tip = file.turns[file.turns.length - 1]
    const tipNode = nodes.get(tip.id)
    if (tipNode && !tipNode.tipBranchIds.includes(file.sessionId)) tipNode.tipBranchIds.push(file.sessionId)
    branches.push({
      // 复用 claude 的字段名：这里装的是 pi 的 sessionId（图上的分支标识）
      claudeSessionId: file.sessionId,
      cwd: file.cwd || cwdOverride || '',
      worktree: null,
      branch: null,
      turnCount: file.turns.length,
      tipNodeId: tip.id,
      forkNodeId: null,
      createdAt: nodes.get(file.turns[0].id)?.timestamp ?? 0,
    })
  }

  const allNodes = [...nodes.values()]
  const known = new Set(allNodes.map((n) => n.id))
  for (const n of allNodes) if (n.parentId && !known.has(n.parentId)) n.parentId = null
  assignDepths(allNodes)
  assignForkPoints(allNodes, branches)

  const activeTurns = new Set((files.find((f) => f.sessionId === piSessionId)?.turns ?? []).map((t) => t.id))
  for (const n of allNodes) n.active = activeTurns.has(n.id)

  const rootId = files.find((f) => f.sessionId === piSessionId)?.rootId
    ?? files[0].rootId
    ?? ''
  return { rootId, activeClaudeSessionId: piSessionId, nodes: allNodes, branches }
}
