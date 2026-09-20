import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, readdir, open } from 'fs/promises'
import { join, resolve } from 'path'
import { IPC_CHANNELS, type AiGraph, type AiGraphNode, type AiGraphBranch } from '../shared/types'
import { aiSessions, parseUserTurns, resolveProjectDir, worktreeKind } from './ai'
import { assignDepths, assignForkPoints, clip, exclusiveFirstOf } from './graph-shared'
import { piSessionMeta } from './pi/session'
import { buildPiSessionGraph } from './pi/tree'

const execFileAsync = promisify(execFile)

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
  dirCwd: string
  dirBranch: string | null
  entries: Map<string, Entry>
  turns: Turn[]
}

function parseBranchFile(claudeSessionId: string, raw: string, dirCwd: string, dirBranch: string | null): BranchFile | null {
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

  return { claudeSessionId, dirCwd, dirBranch, entries, turns }
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

interface CandidateDir { dir: string; cwd: string; branch: string | null }

const normKey = (p: string): string => {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

// 分支 worktree 各自有自己的项目目录（CLI 按进程 cwd 落盘），整张图会跨目录。
// 逐个 worktree 路径推出目录，用 worktree 路径本身当"该文件的 cwd"，fork 才找得到源文件；
// 顺带解析 porcelain 的 branch 行——目录名不等于分支名，图上要显示的是分支名。
async function candidateDirs(cwd: string, configDir?: string): Promise<CandidateDir[]> {
  const worktrees: Array<{ path: string; branch: string | null }> = []
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd, windowsHide: true, timeout: 15000 })
    let current: { path: string; branch: string | null } | null = null
    for (const line of stdout.split('\n')) {
      const t = line.trim()
      if (line.startsWith('worktree ')) {
        current = { path: line.slice('worktree '.length).trim(), branch: null }
        worktrees.push(current)
      } else if (current && t.startsWith('branch refs/heads/')) {
        current.branch = t.slice('branch refs/heads/'.length)
      }
    }
  } catch { /* 非 git 工作区：只有主目录 */ }

  const branchOf = new Map(worktrees.map(w => [normKey(w.path), w.branch]))
  const out: CandidateDir[] = []
  const push = (d: string | null, c: string) => {
    if (d && !out.some(x => x.dir === d)) out.push({ dir: d, cwd: c, branch: branchOf.get(normKey(c)) ?? null })
  }
  push(resolveProjectDir(cwd, configDir), cwd)
  for (const w of worktrees) push(resolveProjectDir(w.path, configDir), w.path)
  return out
}

export async function buildSessionGraph(sessionId: string, cwdOverride?: string, configDirOverride?: string): Promise<AiGraph | null> {
  const live = aiSessions.get(sessionId)
  const cwd = live?.cwd || cwdOverride || ''
  const configDir = live?.configDir ?? configDirOverride
  const selfClaudeId = live?.claudeSessionId || sessionId
  if (!cwd) return null

  const dirs = await candidateDirs(cwd, configDir)
  if (dirs.length === 0) return null

  const selfHead = await readHeadKey(join(dirs.find(d => d.cwd === cwd)?.dir ?? dirs[0].dir, `${selfClaudeId}.jsonl`))
  if (!selfHead) return null

  const files: BranchFile[] = []
  for (const { dir, cwd: dirCwd, branch } of dirs) {
    for (const n of await listGroupFiles(dir, selfHead)) {
      try {
        const parsed = parseBranchFile(n.replace(/\.jsonl$/, ''), await readFile(join(dir, n), 'utf-8'), dirCwd, branch)
        if (parsed) files.push(parsed)
      } catch { /* 单文件失败不影响整图 */ }
    }
  }
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
        fork: { claudeSessionId: file.claudeSessionId, sourceCwd: file.dirCwd, content: turn.content, occurrence: turn.occurrence },
      })
    }
    const tipNodeId = file.turns[file.turns.length - 1].uuid
    const tipNode = nodes.get(tipNodeId)
    if (tipNode && !tipNode.tipBranchIds.includes(file.claudeSessionId)) tipNode.tipBranchIds.push(file.claudeSessionId)
    branches.push({
      claudeSessionId: file.claudeSessionId,
      cwd: file.dirCwd,
      worktree: worktreeKind(file.dirCwd, configDir),
      branch: file.dirBranch,
      turnCount: file.turns.length,
      tipNodeId,
      forkNodeId: null,
      createdAt: nodes.get(file.turns[0].uuid)?.timestamp ?? 0,
    })
  }

  const all = [...nodes.values()]
  const byId = new Set(all.map(n => n.id))
  for (const n of all) if (n.parentId && !byId.has(n.parentId)) n.parentId = null
  assignDepths(all)

  // 分叉点 = 该分支第一个「只属于自己」的轮次的父节点（沿链 depth 最小者即入口）；
  // 还没长出独占轮次（刚分叉就停手）时退化为 tip —— 两种情况下都是"这条分支从这里开始"。
  // 快照必须在插 worktree 起点节点之前取，下面 worktree 段还要复用它。
  const exclusiveFirstOfNode = exclusiveFirstOf(all)
  const exclusiveFirst = (b: AiGraphBranch): AiGraphNode | null => exclusiveFirstOfNode(b.claudeSessionId)
  assignForkPoints(all, branches)

  // worktree 分支的起点单独成节点：源路径那一轮（原路径的节点）原样留在原分支，
  // worktree 的轮次改挂到起点下 —— 两个节点都在，才看得出 worktree 从哪开始
  for (const b of branches) {
    if (!b.worktree) continue
    const first = exclusiveFirst(b)
    const id = `wt:${b.claudeSessionId}`
    nodes.set(id, {
      id,
      parentId: b.forkNodeId,
      title: clip(b.branch ?? 'worktree', 60),
      // 同一个 worktree 里可以有好几条分支（在里面再分叉），分支名/目录都一样，
      // 副标题必须用分支自己的第一句轮次才能区分；还没发言时才退回显示目录
      preview: first ? first.title : clip(b.cwd, 160),
      // 时间用分支的最后活动，而不是分叉点时间
      timestamp: b.tipNodeId ? nodes.get(b.tipNodeId)?.timestamp ?? 0 : 0,
      toolCallCount: 0,
      hasReply: false,
      depth: 0,
      active: b.claudeSessionId === selfClaudeId,
      branchIds: [b.claudeSessionId],
      tipBranchIds: first ? [] : [b.claudeSessionId],
      fork: null,
      worktreeStart: true,
    })
    if (first) first.parentId = id
    else {
      const prevTip = b.tipNodeId ? nodes.get(b.tipNodeId) : null
      if (prevTip) prevTip.tipBranchIds = prevTip.tipBranchIds.filter(x => x !== b.claudeSessionId)
      b.tipNodeId = id
    }
  }

  const finalNodes = [...nodes.values()]
  assignDepths(finalNodes)

  const activeTurns = new Set((files.find(f => f.claudeSessionId === selfClaudeId)?.turns ?? []).map(t => t.uuid))
  for (const n of finalNodes) if (!n.worktreeStart) n.active = activeTurns.has(n.id)

  return { rootId: selfHead, activeClaudeSessionId: selfClaudeId, nodes: finalNodes, branches }
}

export function registerTreeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_GRAPH, async (_e, payload: { sessionId: string; cwd?: string; configDir?: string }) => {
    try {
      const piMeta = piSessionMeta(payload.sessionId)
      if (piMeta) return await buildPiSessionGraph(piMeta.piSessionId, piMeta.cwd)
      return await buildSessionGraph(payload.sessionId, payload.cwd, payload.configDir)
    } catch (err) {
      console.error('[ai-tree] build failed:', (err as Error).message)
      return null
    }
  })
}
