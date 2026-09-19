import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { appendFile, mkdir, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { IPC_CHANNELS } from '../shared/types'
import { aiSessions, configDirMarker } from './ai'
import { slugify, uniqueName } from './slug'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  })
  return stdout.trim()
}

// 已注册的 linked worktree 在 git add -A 眼里是「embedded git repository」，
// 会被当成 gitlink 塞进快照。逐个排除，而不是只排除自己用的目录——
// CLI 的 .claude/worktrees 同样会踩这个坑。
// 被 .gitignore / .git/info/exclude 覆盖的路径不能再写进排除 pathspec：
// git add 视「显式点名一个被忽略的路径」为错误会直接失败（除非 -f，而 -f 会连
// node_modules 一起加进来）。这类路径交给忽略规则本身处理即可。
async function isIgnored(from: string, relPath: string): Promise<boolean> {
  try {
    await git(['check-ignore', '-q', relPath], from)
    return true
  } catch {
    return false
  }
}

async function worktreeExcludes(from: string): Promise<string[]> {
  const excludes: string[] = []
  try {
    const list = await git(['worktree', 'list', '--porcelain'], from)
    for (const line of list.split('\n')) {
      if (!line.startsWith('worktree ')) continue
      const rel = relative(from, line.slice('worktree '.length).trim())
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue
      const posix = rel.split(sep).join('/')
      if (await isIgnored(from, posix)) continue
      excludes.push(`:(top,exclude)${posix}`)
    }
  } catch { /* 无 worktree 时 list 也可能失败，忽略 */ }
  return excludes
}

// 分支 worktree 落在仓库内，必须让 git status 忽略它，否则 IDE 自己的 GitTab 会一直挂着一条 untracked。
// .git/info/exclude 是本地忽略的标准位置，不进版本库。
async function excludeFromGitStatus(repoRoot: string, marker: string): Promise<void> {
  try {
    const commonDir = await git(['rev-parse', '--git-common-dir'], repoRoot)
    const excludePath = join(resolve(repoRoot, commonDir), 'info', 'exclude')
    const line = `${marker}/branch-worktrees/`
    let existing = ''
    try { existing = await readFile(excludePath, 'utf-8') } catch { /* 文件可能不存在 */ }
    if (existing.split('\n').some(l => l.trim() === line)) return
    await mkdir(dirname(excludePath), { recursive: true })
    await appendFile(excludePath, `${existing === '' || existing.endsWith('\n') ? '' : '\n'}${line}\n`, 'utf-8')
  } catch { /* 尽力而为，失败不影响功能 */ }
}

export interface BranchWorktree {
  path: string
  branch: string
  repoRoot: string
  originalBranch: string
}

// 在仓库里另开一棵工作树，内容 = 当前工作区（含未提交改动与未跟踪文件，尊重 .gitignore）。
// 不走 CLI 的 --worktree：那个只能从 HEAD 开干净检出，拿不到分叉时的工作区状态。
// 快照通过临时 index 生成 commit，主工作区与其索引全程不被触碰。
// name 是给分支/目录起名的语义来源（分叉消息文本），中文等 slug 化后为空时回退时间戳。
export async function createBranchWorktree(cwd: string, configDir?: string, name?: string): Promise<BranchWorktree | { error: string }> {
  // 必须用 --git-common-dir 定位主仓库：从已有分支 worktree 里再分叉时，
  // --show-toplevel 会返回那棵 worktree，新树会套在它里面（嵌套 worktree）
  let repoRoot: string
  try {
    const commonDir = await git(['rev-parse', '--git-common-dir'], cwd)
    repoRoot = dirname(resolve(cwd, commonDir))
  } catch {
    return { error: 'Not a git repository' }
  }

  const marker = configDirMarker(configDir)
  const branches = new Set<string>()
  try {
    const out = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], repoRoot)
    for (const b of out.split('\n')) if (b.trim()) branches.add(b.trim())
  } catch { /* 空仓库 */ }
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fallback = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const slug = uniqueName(slugify(name || '') || fallback, s =>
    branches.has(`worktree-${s}`) || existsSync(join(repoRoot, marker, 'branch-worktrees', s)))
  const branch = `worktree-${slug}`
  const wtPath = join(repoRoot, marker, 'branch-worktrees', slug)
  const indexFile = join(tmpdir(), `vibe-wt-${randomUUID().slice(0, 8)}.index`)

  try {
    // 先确保目录被忽略，再快照：否则第二次创建时上一次的 worktree 会被当成 embedded repo 吞进来
    await excludeFromGitStatus(repoRoot, marker)
    // 快照取源工作区（cwd）的当前状态，不是主工作区——从分支里再分叉时要带上那条分支的改动
    const excludes = await worktreeExcludes(cwd)
    const env = { GIT_INDEX_FILE: indexFile }
    await git(['read-tree', 'HEAD'], cwd, env)
    await git(['add', '-A', '.', ...excludes], cwd, env)
    const tree = await git(['write-tree'], cwd, env)
    const commit = await git(
      ['-c', 'user.name=Vibe IDE', '-c', 'user.email=vibe@local', 'commit-tree', tree, '-p', 'HEAD', '-m', 'vibe: branch snapshot'],
      cwd,
    )
    let originalBranch = ''
    try { originalBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) } catch { /* 空仓库 */ }

    await mkdir(dirname(wtPath), { recursive: true })
    await git(['worktree', 'add', '-b', branch, wtPath, commit], repoRoot)
    return { path: wtPath, branch, repoRoot, originalBranch }
  } catch (err) {
    return { error: (err as Error).message }
  } finally {
    await rm(indexFile, { force: true }).catch(() => {})
  }
}

export function registerWorktreeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_CREATE_BRANCH_WORKTREE, async (_e, payload: { sessionId: string; cwd?: string; configDir?: string; name?: string }) => {
    const live = aiSessions.get(payload.sessionId)
    const cwd = live?.cwd || payload.cwd
    if (!cwd) return { error: 'No workspace path' }
    const result = await createBranchWorktree(cwd, live?.configDir ?? payload.configDir, payload.name)
    if ('error' in result) console.error('[ai-worktree] create failed:', result.error)
    return result
  })
}
