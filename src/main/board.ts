import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join, isAbsolute, resolve, basename, dirname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { BoardCreateOptions, BoardMergeResult, BoardOpResult, BoardRecordsResult, IPC_CHANNELS, WorktreeRecord } from '../shared/types'
import { closeTerminalSession, createTerminalSession } from './pty'
import { notifyGitMeta } from './watcher'

const gitAsync = promisify(execFile)

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
  const file = recordsFile(repoRoot)
  // 最后一条记录被清掉时直接删文件，不留 2 字节的 "[]" 残渣
  if (list.length === 0) {
    recordsCache.delete(repoRoot)
    try { rmSync(file, { force: true }) } catch {}
    return
  }
  recordsCache.set(repoRoot, list)
  try {
    mkdirSync(join(app.getPath('userData'), 'vibe-board'), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8')
    renameSync(tmp, file)
  } catch (err: any) {
    console.warn('[board] save records failed:', err?.message)
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

function genWorktreeTitle(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `worktree-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
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

async function resolveToplevelAsync(entryDir: string): Promise<string | null> {
  try {
    const { stdout } = await gitAsync('git', ['rev-parse', '--show-toplevel'], { cwd: entryDir, timeout: 15000, windowsHide: true })
    return stdout.trim() || null
  } catch {
    return null
  }
}

// linked worktree 里 --show-toplevel 返回的是 worktree 自身，直接当仓库根会导致
// worktree 套 worktree、记录散落在多个哈希文件里。用 --git-common-dir 归位到主仓库根。
async function repoRootFromToplevel(top: string): Promise<string> {
  try {
    const { stdout } = await gitAsync('git', ['rev-parse', '--git-common-dir'], { cwd: top, timeout: 15000, windowsHide: true })
    let cd = stdout.trim()
    if (cd) {
      if (!isAbsolute(cd)) cd = resolve(top, cd)
      if (basename(cd) === '.git') return dirname(cd)
    }
  } catch {}
  return top
}

async function resolveRepoRootAsync(entryDir: string): Promise<string | null> {
  const top = await resolveToplevelAsync(entryDir)
  if (!top) return null
  return repoRootFromToplevel(top)
}

// 旧版本在 worktree 里建任务时，记录写在了以该 worktree 路径为 key 的文件里。
// 查询时遇到这种情况就合并回主仓库根的文件，并删除旧文件。
function migrateLegacyRecords(oldRoot: string, newRoot: string): void {
  const oldFile = recordsFile(oldRoot)
  let list: WorktreeRecord[] = []
  try {
    const parsed = JSON.parse(readFileSync(oldFile, 'utf-8'))
    if (Array.isArray(parsed)) {
      list = parsed.filter((r): r is WorktreeRecord => !!r && typeof r.id === 'string' && typeof r.worktreePath === 'string')
    }
  } catch {
    recordsCache.delete(oldRoot)
    return
  }
  try { rmSync(oldFile, { force: true }) } catch {}
  recordsCache.delete(oldRoot)
  if (list.length === 0) return
  const target = loadRecords(newRoot)
  for (const rec of list) {
    if (!target.some(t => t.id === rec.id)) target.push({ ...rec, repoRoot: newRoot })
  }
  saveRecords(newRoot, target)
}

// 启动时清扫垃圾记录文件：空数组 []、repoRoot 目录已不存在的、损坏的 JSON
function sweepStaleRecords(): void {
  const dir = join(app.getPath('userData'), 'vibe-board')
  let files: string[] = []
  try { files = readdirSync(dir) } catch { return }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const fp = join(dir, f)
    let stale = false
    try {
      const parsed = JSON.parse(readFileSync(fp, 'utf-8'))
      if (!Array.isArray(parsed) || parsed.length === 0) stale = true
      else {
        const root = parsed.find((r: any) => typeof r?.repoRoot === 'string')?.repoRoot
        if (!root || !existsSync(root)) stale = true
      }
    } catch {
      stale = true
    }
    if (stale) {
      try { rmSync(fp, { force: true }) } catch {}
    }
  }
}

async function createBoardSession(options: BoardCreateOptions): Promise<BoardOpResult> {
  const repoRoot = await resolveRepoRootAsync(options.workspacePath)
  if (!repoRoot) return { error: '当前工作区不是 git 仓库,无法创建 worktree' }

  const records = loadRecords(repoRoot)
  let baseBranch = ''
  try { baseBranch = (await gitAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, timeout: 15000, windowsHide: true })).stdout.trim() } catch {}

  const title = options.title?.trim() || genWorktreeTitle()
  const slug = uniqueSlug(slugify(title), records)
  const worktreesDir = join(repoRoot, '.vibe', 'worktrees')
  mkdirSync(worktreesDir, { recursive: true })
  const worktreePath = join(worktreesDir, slug)
  if (existsSync(worktreePath)) return { error: `目录已存在: ${worktreePath}` }

  // 分支统一 worktree- 开头供 GitTab 分辨；slug 本身已是 worktree- 开头时不再叠加前缀
  const branchName = slug.startsWith('worktree-') ? slug : `worktree-${slug}`
  // Windows 下每个新文件落盘有固定开销(杀软实时扫描)，串行检出 9000+ 文件需 5-27s；
  // 先 --no-checkout 秒建元数据，再用并行 checkout(workers=8) 重叠该延迟，实测稳定 ~2.2s。
  // 必须走异步 execFile：execFileSync 会阻塞主进程事件循环，冻结全部终端输出与 IPC
  try {
    await gitAsync('git', ['worktree', 'add', '--no-checkout', '-b', branchName, worktreePath], { cwd: repoRoot, timeout: 30000, windowsHide: true })
  } catch (err: any) {
    return { error: `worktree 创建失败: ${String(err?.message ?? err).split('\n')[0]}` }
  }
  try {
    await gitAsync('git', ['-c', 'checkout.workers=8', '-c', 'checkout.threshold=10000', 'checkout', 'HEAD'], { cwd: worktreePath, timeout: 60000, windowsHide: true })
  } catch (err: any) {
    try { await gitAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, timeout: 15000, windowsHide: true }) } catch {}
    try { await gitAsync('git', ['branch', '-D', branchName], { cwd: repoRoot, timeout: 15000, windowsHide: true }) } catch {}
    return { error: `worktree 检出失败: ${String(err?.message ?? err).split('\n')[0]}` }
  }
  ensureVibeExcluded(repoRoot)
  notifyGitMeta()

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
    createTerminalSession({ id, cwd: worktreePath, name: title, initCommand: record.launchCommand })
  } catch (err: any) {
    console.warn('[board] terminal spawn failed:', err?.message)
  }
  return { ok: true, record }
}

async function cleanupWorktree(repoRoot: string, rec: WorktreeRecord): Promise<void> {
  // pty.kill 后 shell 进程退出有延迟，立即删目录会被其 cwd 句柄锁住，稍等再动手
  await new Promise(r => setTimeout(r, 500))
  let removed = !existsSync(rec.worktreePath)
  if (!removed) {
    try {
      await gitAsync('git', ['worktree', 'remove', '--force', rec.worktreePath], { cwd: repoRoot, timeout: 60000, windowsHide: true })
    } catch {
      try {
        await gitAsync('git', ['worktree', 'remove', '--force', '--force', rec.worktreePath], { cwd: repoRoot, timeout: 60000, windowsHide: true })
      } catch {
        try { rmSync(rec.worktreePath, { recursive: true, force: true }) } catch {}
      }
    }
    removed = !existsSync(rec.worktreePath)
  }
  // 目录确实没了才动 git 元数据；否则保留记录，等下次重试，避免"卡片复活但分支已删"
  if (removed) {
    try { await gitAsync('git', ['worktree', 'prune'], { cwd: repoRoot, timeout: 15000, windowsHide: true }) } catch {}
    try { await gitAsync('git', ['branch', '-D', rec.branchName], { cwd: repoRoot, timeout: 15000, windowsHide: true }) } catch {}
    notifyGitMeta()
  } else {
    const records = loadRecords(repoRoot)
    if (!records.some(r => r.id === rec.id)) {
      records.push(rec)
      saveRecords(repoRoot, records)
    }
  }
}

async function finishBoardSession(workspacePath: string, recordId: string): Promise<BoardOpResult> {
  const repoRoot = await resolveRepoRootAsync(workspacePath)
  if (!repoRoot) return { error: '当前工作区不是 git 仓库' }
  const records = loadRecords(repoRoot)
  const idx = records.findIndex(r => r.id === recordId)
  if (idx < 0) return { error: '记录不存在(可能属于其他仓库)' }
  const rec = records[idx]

  closeTerminalSession(rec.id)

  // 先删记录让卡片立即消失，6s+ 的目录删除放后台异步做，不阻塞主进程事件循环；
  // 清理失败时把记录塞回去，用户可重试 finish 或 clear
  records.splice(idx, 1)
  saveRecords(repoRoot, records)
  void cleanupWorktree(repoRoot, rec)
  return { ok: true }
}

async function clearBoardRecord(workspacePath: string, recordId: string): Promise<BoardOpResult> {
  const repoRoot = await resolveRepoRootAsync(workspacePath)
  if (!repoRoot) return { error: '当前工作区不是 git 仓库' }
  const records = loadRecords(repoRoot)
  const idx = records.findIndex(r => r.id === recordId)
  if (idx < 0) return { error: '记录不存在' }
  const rec = records[idx]
  // 与 finishBoardSession 对齐:清记录必须一并关闭 board 终端,否则 shell 进程 + 终端 tab 永久泄漏
  closeTerminalSession(rec.id)
  records.splice(idx, 1)
  saveRecords(repoRoot, records)
  void cleanupWorktree(repoRoot, rec)
  return { ok: true }
}

// 把 worktree 分支合入创建时的基线分支(baseBranch)。
// 未提交修改不进 merge(先提示而非自动 commit);冲突时不回滚、不删 worktree/分支,保留冲突状态供用户在 GitTab 解决。
async function mergeBoardSession(workspacePath: string, recordId: string): Promise<BoardMergeResult> {
  const repoRoot = await resolveRepoRootAsync(workspacePath)
  if (!repoRoot) return { error: '当前工作区不是 git 仓库' }
  const records = loadRecords(repoRoot)
  const rec = records.find(r => r.id === recordId)
  if (!rec) return { error: '记录不存在(可能属于其他仓库)' }

  // worktree 未提交修改不会随 merge 进入主分支,先报错提示,避免用户误以为已合入
  try {
    const { stdout } = await gitAsync('git', ['status', '--porcelain'], { cwd: rec.worktreePath, timeout: 15000, windowsHide: true })
    if (stdout.trim()) {
      return { error: `worktree 存在未提交的修改,不会随合并进入主分支。请先提交或丢弃后再合并。(${stdout.trim().split('\n').length} 个文件)` }
    }
  } catch {}

  let current = ''
  try { current = (await gitAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, timeout: 15000, windowsHide: true })).stdout.trim() } catch {}

  if (current !== rec.baseBranch) {
    try {
      await gitAsync('git', ['checkout', rec.baseBranch], { cwd: repoRoot, timeout: 20000, windowsHide: true })
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      if (/local changes|would be overwritten|uncommitted|untracked/i.test(msg)) {
        return { error: `主工作区有未提交修改,无法切换到 ${rec.baseBranch} 进行合并。请先提交或暂存。` }
      }
      return { error: `切换到 ${rec.baseBranch} 失败:${msg.split('\n')[0]}` }
    }
  }

  try {
    await gitAsync('git', ['merge', '--no-edit', rec.branchName], { cwd: repoRoot, timeout: 60000, windowsHide: true })
    notifyGitMeta()
    return { ok: true, message: '', branch: rec.branchName, target: rec.baseBranch }
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    if (/CONFLICT|conflict/i.test(msg)) {
      notifyGitMeta()
      return { conflict: true, message: msg, branch: rec.branchName, target: rec.baseBranch }
    }
    return { error: msg.split('\n')[0] }
  }
}

async function abortMergeSession(workspacePath: string): Promise<BoardOpResult> {
  const repoRoot = await resolveToplevelAsync(workspacePath)
  if (!repoRoot) return { error: '当前工作区不是 git 仓库' }
  try {
    await gitAsync('git', ['merge', '--abort'], { cwd: repoRoot, timeout: 30000, windowsHide: true })
    return { ok: true }
  } catch (err: any) {
    return { error: `中止合并失败:${String(err?.message ?? err).split('\n')[0]}` }
  }
}

export function registerBoardHandlers(): void {
  sweepStaleRecords()
  ipcMain.handle(IPC_CHANNELS.BOARD_RECORDS, async (_e, workspacePath?: string): Promise<BoardRecordsResult> => {
    if (!workspacePath) return { repoRoot: null, records: [] }
    const top = await resolveToplevelAsync(workspacePath)
    if (!top) return { repoRoot: null, records: [] }
    const repoRoot = await repoRootFromToplevel(top)
    if (repoRoot !== top) migrateLegacyRecords(top, repoRoot)
    return { repoRoot, records: loadRecords(repoRoot).map(r => ({ ...r, orphan: !existsSync(r.worktreePath) })) }
  })

  ipcMain.handle(IPC_CHANNELS.BOARD_CREATE, async (_e, options?: BoardCreateOptions): Promise<BoardOpResult> => {
    if (!options || typeof options.workspacePath !== 'string') return { error: '参数缺失' }
    try {
      return await createBoardSession(options)
    } catch (err: any) {
      console.error('[board] create error:', err)
      return { error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BOARD_FINISH, async (_e, workspacePath?: string, recordId?: string): Promise<BoardOpResult> => {
    if (!workspacePath || !recordId) return { error: '参数缺失' }
    try {
      return await finishBoardSession(workspacePath, recordId)
    } catch (err: any) {
      console.error('[board] finish error:', err)
      return { error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BOARD_CLEAR, async (_e, workspacePath?: string, recordId?: string): Promise<BoardOpResult> => {
    if (!workspacePath || !recordId) return { error: '参数缺失' }
    try {
      return await clearBoardRecord(workspacePath, recordId)
    } catch (err: any) {
      return { error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BOARD_MERGE, async (_e, workspacePath?: string, recordId?: string): Promise<BoardMergeResult> => {
    if (!workspacePath || !recordId) return { error: '参数缺失' }
    try {
      return await mergeBoardSession(workspacePath, recordId)
    } catch (err: any) {
      console.error('[board] merge error:', err)
      return { error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BOARD_MERGE_ABORT, async (_e, workspacePath?: string): Promise<BoardOpResult> => {
    if (!workspacePath) return { error: '参数缺失' }
    try {
      return await abortMergeSession(workspacePath)
    } catch (err: any) {
      return { error: err?.message ?? String(err) }
    }
  })
}
