import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { BoardCreateOptions, BoardOpResult, BoardRecordsResult, IPC_CHANNELS, WorktreeRecord } from '../shared/types'
import { closeTerminalSession, createTerminalSession } from './pty'

const recordsCache = new Map<string, WorktreeRecord[]>()

function hashKey(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

function recordsFile(repoRoot: string): string {
  return join(app.getPath('userData'), 'vibe-board', `${hashKey(repoRoot.toLowerCase())}.json`)
}

function loadRecords(repoRoot: string): WorktreeRecord[] {
  const cached = recordsCache.get(repoRoot)
  if (cached) return cached
  let list: WorktreeRecord[] = []
  try {
    const parsed = JSON.parse(readFileSync(recordsFile(repoRoot), 'utf-8'))
    if (Array.isArray(parsed)) {
      list = parsed.filter((r): r is WorktreeRecord => !!r && typeof r.id === 'string' && typeof r.worktreePath === 'string')
    }
  } catch {}
  recordsCache.set(repoRoot, list)
  return list
}

function saveRecords(repoRoot: string, list: WorktreeRecord[]): void {
  recordsCache.set(repoRoot, list)
  try {
    mkdirSync(join(app.getPath('userData'), 'vibe-board'), { recursive: true })
    const file = recordsFile(repoRoot)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8')
    renameSync(tmp, file)
  } catch (err: any) {
    console.warn('[board] save records failed:', err?.message)
  }
}

function git(cwd: string, args: string[], timeoutMs = 15000): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function resolveToplevel(entryDir: string): string | null {
  try {
    return git(entryDir, ['rev-parse', '--show-toplevel']) || null
  } catch {
    return null
  }
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .split('')
    .map(c => (/[a-z0-9]/.test(c) ? c : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '')
  return slug || 'task'
}

function uniqueSlug(base: string, records: WorktreeRecord[]): string {
  let slug = base
  let n = 2
  while (records.some(r => r.slug === slug)) slug = `${base}-${n++}`
  return slug
}

function genTaskTitle(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `task-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function ensureVibeExcluded(repoRoot: string): void {
  try {
    const infoDir = join(repoRoot, '.git', 'info')
    mkdirSync(infoDir, { recursive: true })
    const excludePath = join(infoDir, 'exclude')
    let content = ''
    try { content = readFileSync(excludePath, 'utf-8') } catch {}
    if (!content.split(/\r?\n/).some(l => l.trim() === '.vibe/')) {
      const sep = content && !content.endsWith('\n') ? '\n' : ''
      writeFileSync(excludePath, `${content}${sep}.vibe/\n`, 'utf-8')
    }
  } catch (err: any) {
    console.warn('[board] exclude .vibe failed:', err?.message)
  }
}

function createBoardSession(options: BoardCreateOptions): BoardOpResult {
  const repoRoot = resolveToplevel(options.workspacePath)
  if (!repoRoot) return { error: '当前工作区不是 git 仓库,无法创建 worktree' }

  const records = loadRecords(repoRoot)
  let baseBranch = ''
  try { baseBranch = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) } catch {}

  const title = options.title?.trim() || genTaskTitle()
  const slug = uniqueSlug(slugify(title), records)
  const worktreesDir = join(repoRoot, '.vibe', 'worktrees')
  mkdirSync(worktreesDir, { recursive: true })
  const worktreePath = join(worktreesDir, slug)
  if (existsSync(worktreePath)) return { error: `目录已存在: ${worktreePath}` }

  const branchName = `task/${slug}`
  try {
    git(repoRoot, ['worktree', 'add', '-b', branchName, worktreePath], 30000)
  } catch (err: any) {
    return { error: `worktree 创建失败: ${String(err?.message ?? err).split('\n')[0]}` }
  }
  ensureVibeExcluded(repoRoot)

  const id = `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const record: WorktreeRecord = {
    id,
    title,
    slug,
    launchCommand: options.launchCommand?.trim() || undefined,
    worktreePath,
    branchName,
    baseBranch,
    repoRoot,
    createdAt: Date.now()
  }
  records.push(record)
  saveRecords(repoRoot, records)

  try {
    createTerminalSession({ id, cwd: worktreePath, name: `▶ ${title}`, initCommand: record.launchCommand })
  } catch (err: any) {
    console.warn('[board] terminal spawn failed:', err?.message)
  }
  return { ok: true, record }
}

function finishBoardSession(workspacePath: string, recordId: string): BoardOpResult {
  const repoRoot = resolveToplevel(workspacePath)
  if (!repoRoot) return { error: '当前工作区不是 git 仓库' }
  const records = loadRecords(repoRoot)
  const idx = records.findIndex(r => r.id === recordId)
  if (idx < 0) return { error: '记录不存在(可能属于其他仓库)' }
  const rec = records[idx]

  closeTerminalSession(rec.id)

  if (existsSync(rec.worktreePath)) {
    try {
      git(repoRoot, ['worktree', 'remove', '--force', rec.worktreePath], 30000)
    } catch {
      try {
        git(repoRoot, ['worktree', 'remove', '--force', '--force', rec.worktreePath], 30000)
      } catch {
        try {
          rmSync(rec.worktreePath, { recursive: true, force: true })
          try { git(repoRoot, ['worktree', 'prune']) } catch {}
        } catch (err2: any) {
          return { error: `worktree 清理失败(已停止,记录保留): ${String(err2?.message ?? err2).split('\n')[0]}` }
        }
      }
    }
  } else {
    try { git(repoRoot, ['worktree', 'prune']) } catch {}
  }

  try { git(repoRoot, ['branch', '-D', rec.branchName]) } catch {}

  records.splice(idx, 1)
  saveRecords(repoRoot, records)
  return { ok: true }
}

function clearBoardRecord(workspacePath: string, recordId: string): BoardOpResult {
  const repoRoot = resolveToplevel(workspacePath)
  if (!repoRoot) return { error: '当前工作区不是 git 仓库' }
  const records = loadRecords(repoRoot)
  const idx = records.findIndex(r => r.id === recordId)
  if (idx < 0) return { error: '记录不存在' }
  records.splice(idx, 1)
  saveRecords(repoRoot, records)
  try { git(repoRoot, ['worktree', 'prune']) } catch {}
  return { ok: true }
}

export function registerBoardHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BOARD_RECORDS, (_e, workspacePath?: string): BoardRecordsResult => {
    if (!workspacePath) return { repoRoot: null, records: [] }
    const repoRoot = resolveToplevel(workspacePath)
    if (!repoRoot) return { repoRoot: null, records: [] }
    return { repoRoot, records: loadRecords(repoRoot).map(r => ({ ...r, orphan: !existsSync(r.worktreePath) })) }
  })

  ipcMain.handle(IPC_CHANNELS.BOARD_CREATE, (_e, options?: BoardCreateOptions): BoardOpResult => {
    if (!options || typeof options.workspacePath !== 'string') return { error: '参数缺失' }
    try {
      return createBoardSession(options)
    } catch (err: any) {
      console.error('[board] create error:', err)
      return { error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BOARD_FINISH, (_e, workspacePath?: string, recordId?: string): BoardOpResult => {
    if (!workspacePath || !recordId) return { error: '参数缺失' }
    try {
      return finishBoardSession(workspacePath, recordId)
    } catch (err: any) {
      console.error('[board] finish error:', err)
      return { error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BOARD_CLEAR, (_e, workspacePath?: string, recordId?: string): BoardOpResult => {
    if (!workspacePath || !recordId) return { error: '参数缺失' }
    try {
      return clearBoardRecord(workspacePath, recordId)
    } catch (err: any) {
      return { error: err?.message ?? String(err) }
    }
  })
}
