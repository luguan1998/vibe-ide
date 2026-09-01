import { ipcMain } from 'electron'
import simpleGit, { SimpleGit } from 'simple-git'
import { IPC_CHANNELS, GitStatusResult, GitFileStatus, GitLogEntry, GitBranch, CommitOptions, AmendOptions, GitShowResult, GitCommitFile, GitLineLogEntry, GitGraphEntry } from '../shared/types'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import path, { isAbsolute, resolve as resolvePath } from 'path'
import { startWatching, updateSkipPatterns, watchGitMeta, notifyGitMeta } from './watcher'

let gitInstance: SimpleGit | null = null
let currentWorkspace: string = process.cwd()

function getGit(): SimpleGit {
  if (!gitInstance) {
    gitInstance = simpleGit(currentWorkspace)
  }
  return gitInstance
}

export function registerGitHandlers(): void {
  // Set git workspace path — switches git instance to a new directory
  ipcMain.handle(IPC_CHANNELS.GIT_SET_WORKSPACE, async (_event, path: string) => {
    if (typeof path !== 'string' || !path) return { error: 'Invalid workspace path' }
    try {
      currentWorkspace = path
      gitInstance = simpleGit(currentWorkspace)
      let gitRoot = path
      let gitCommonDir = ''
      try {
        const root = (await gitInstance.raw(['rev-parse', '--show-toplevel'])).trim()
        if (root) gitRoot = root.replace(/\\/g, '/')
      } catch {}
      try {
        let cd = (await gitInstance.raw(['rev-parse', '--git-common-dir'])).trim()
        if (cd) {
          if (!isAbsolute(cd)) cd = resolvePath(currentWorkspace, cd)
          gitCommonDir = cd.replace(/\\/g, '/')
        }
      } catch {}
      startWatching(path)
      watchGitMeta(gitCommonDir)
      return { success: true, path: currentWorkspace, gitRoot, gitCommonDir }
    } catch (err: any) {
      return { error: err.message || 'Failed to set workspace' }
    }
  })

  // Get git status
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async () => {
    try {
      const git = getGit()

      // porcelain v2: 一次拿全 分支/upstream/ahead-behind/条目/冲突；--no-optional-locks 必须在子命令前(全局选项)，且防刷新自写 index 触发 meta 回环
      const rawStatus = await git.raw(['--no-optional-locks', 'status', '--porcelain=v2', '--branch'])
      const statusShort = parsePorcelainV2(rawStatus)

      // 检查是否有非 untracked 的变更，无则跳过两次 diff --numstat
      const hasTrackedChanges = statusShort.files.some(
        f => f.index !== '?' || f.working_dir !== '?'
      )

      const diffStat: Record<string, { additions: number; deletions: number }> = {}
      const stagedDiffStat: Record<string, { additions: number; deletions: number }> = {}

      if (hasTrackedChanges) {
        try {
          const diffNumstat = await git.diff(['--numstat'])
          for (const line of diffNumstat.split('\n')) {
            if (line.includes('\t')) {
              const parts = line.split('\t')
              const addPart = parts[0].trim()
              const delPart = parts[1].trim()
              const filePath = parts[2]?.trim() || ''
              if (filePath) {
                diffStat[filePath] = {
                  additions: addPart === '-' ? 0 : parseInt(addPart) || 0,
                  deletions: delPart === '-' ? 0 : parseInt(delPart) || 0
                }
              }
            }
          }
        } catch {
        }

        try {
          const stagedNumstat = await git.diff(['--cached', '--numstat'])
          for (const line of stagedNumstat.split('\n')) {
            if (line.includes('\t')) {
              const parts = line.split('\t')
              const addPart = parts[0].trim()
              const delPart = parts[1].trim()
              const filePath = parts[2]?.trim() || ''
              if (filePath) {
                stagedDiffStat[filePath] = {
                  additions: addPart === '-' ? 0 : parseInt(addPart) || 0,
                  deletions: delPart === '-' ? 0 : parseInt(delPart) || 0
                }
              }
            }
          }
        } catch {
        }
      }

      const stagedFiles: GitFileStatus[] = []
      const unstagedFiles: GitFileStatus[] = []
      const untrackedFiles: GitFileStatus[] = []

      for (const f of statusShort.files) {
        const indexStatus = f.index
        const workdirStatus = f.working_dir
        const filePath = f.path

        if (indexStatus === '?' && workdirStatus === '?') {
          untrackedFiles.push({
            path: filePath,
            status: 'untracked',
            staged: false,
            additions: 0,
            deletions: 0
          })
          continue
        }

        if (indexStatus !== '?' && indexStatus !== ' ') {
          stagedFiles.push({
            path: filePath,
            status: f.conflicted ? 'conflicted' : mapShortStatus(indexStatus, f.from),
            staged: true,
            oldPath: getOldPath(f, indexStatus),
            additions: stagedDiffStat[filePath]?.additions || 0,
            deletions: stagedDiffStat[filePath]?.deletions || 0
          })
        }

        if (workdirStatus !== ' ' && workdirStatus !== '?') {
          unstagedFiles.push({
            path: filePath,
            status: f.conflicted ? 'conflicted' : mapShortStatus(workdirStatus, f.from),
            staged: false,
            oldPath: getOldPath(f, workdirStatus),
            additions: diffStat[filePath]?.additions || 0,
            deletions: diffStat[filePath]?.deletions || 0
          })
        }
      }

      // Check staged files for conflict markers via cached diff (not disk read)
      const stagedForConflictCheck = stagedFiles.map(f => f.path)
      if (stagedForConflictCheck.length > 0) {
        try {
          const cachedDiff = await git.raw(['diff', '--cached'])
          const conflictPaths = parseConflictFilesFromDiff(cachedDiff)
          for (const f of stagedFiles) {
            if (conflictPaths.has(f.path)) {
              f.status = 'conflicted'
            }
          }
        } catch {}
      }

      const MAX_STATUS_FILES = 5000
      const allFiles = [...stagedFiles, ...unstagedFiles, ...untrackedFiles]
      const totalFiles = allFiles.length
      const truncated = totalFiles > MAX_STATUS_FILES

      const result: GitStatusResult = {
        files: truncated ? allFiles.slice(0, MAX_STATUS_FILES) : allFiles,
        branch: statusShort.current || '',
        ahead: statusShort.ahead,
        behind: statusShort.behind,
        staged: stagedFiles.length,
        unstaged: unstagedFiles.length,
        untracked: untrackedFiles.length,
        clean: stagedFiles.length === 0 && unstagedFiles.length === 0 && untrackedFiles.length === 0,
        truncated,
        totalFiles
      }
      return result
    } catch (err: any) {
      return { error: err.message, files: [], branch: '', clean: false }
    }
  })

  // Get git log — opts.skip 跳过已加载的新提交，支持懒加载"加载更多"
  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_event, opts?: { count?: number; skip?: number }) => {
    try {
      const git = getGit()
      const count = opts?.count ?? 50
      const skip = opts?.skip ?? 0
      // %B=完整消息(含换行) %H=hash %aN=作者(应用 mailmap) %aI=ISO日期 %D=refs
      // %x00 字段分隔 %x1e 记录分隔，--pretty=format: 不自动补换行，靠 %x1e 切分
      const output = await git.raw(['log', `--skip=${skip}`, `--max-count=${count}`, '--pretty=format:%H%x00%B%x00%aN%x00%aI%x00%D%x1e'])
      const entries: GitLogEntry[] = []
      for (const rec of output.split('\x1e')) {
        if (!rec.trim()) continue
        const [hash, body, author, date, refs] = rec.split('\x00')
        // format: 在记录间补 \n，会落到下条 %H 前，trim 各字段去除
        entries.push({
          hash: (hash || '').trim(),
          message: (body || '').trim(),
          author: (author || '').trim(),
          date: (date || '').trim(),
          refs: refs || ''
        })
      }
      return entries
    } catch (err: any) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_GRAPH, async (_event, opts?: { count?: number; skip?: number }) => {
    try {
      const git = getGit()
      const count = opts?.count ?? 50
      const skip = opts?.skip ?? 0
      const output = await git.raw([
        'log', '--all', '--topo-order', '--date-order',
        `--skip=${skip}`, `--max-count=${count}`,
        '--pretty=format:%H%x00%P%x00%D%x00%s%x00%aN%x00%aI%x1e'
      ])
      const entries: GitGraphEntry[] = []
      for (const rec of output.split('\x1e')) {
        if (!rec.trim()) continue
        const [hash, parents, refs, message, author, date] = rec.split('\x00')
        const parentList = (parents || '').trim()
        entries.push({
          hash: (hash || '').trim(),
          parents: parentList ? parentList.split(/\s+/) : [],
          refs: (refs || '').trim(),
          message: (message || '').trim(),
          author: (author || '').trim(),
          date: (date || '').trim()
        })
      }
      return entries
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git line log - get commit history for a specific line range
  ipcMain.handle(IPC_CHANNELS.GIT_LINE_LOG, async (_event, filePath: string, startLine: number, endLine: number) => {
    try {
      const git = getGit()
      // git log -Lstart,end:file — trace line-level history
      const output = await git.raw(['log', `-L${startLine},${endLine}:${filePath}`, '--format=%H%x00%an%x00%ad%x00%s%x00', '--date=iso'])
      const entries: GitLineLogEntry[] = []
      for (const line of output.split('\n')) {
        const parts = line.split('\0')
        if (parts.length >= 4 && /^[0-9a-f]{40}$/.test(parts[0])) {
          entries.push({
            hash: parts[0],
            author: parts[1],
            date: parts[2],
            message: parts[3]
          })
        }
      }
      return entries
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git add
  ipcMain.handle(IPC_CHANNELS.GIT_ADD, async (_event, files: string | string[]) => {
    try {
      const git = getGit()
      if (files === '.') {
        await git.raw(['add', '.'])
      } else if (files === '-u') {
        await git.raw(['add', '-u'])
      } else if (Array.isArray(files) && files.length > 0) {
        await git.raw(['add', '--', ...files])
      } else if (typeof files === 'string') {
        await git.raw(['add', '--', files])
      }
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git show file (get file content at a ref)
  ipcMain.handle(IPC_CHANNELS.GIT_SHOW_FILE, async (_event, ref: string, filePath: string) => {
    try {
      const git = getGit()
      const result = await git.show([`${ref}:${filePath}`])
      return { content: result }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git discard (checkout file to discard changes)
  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD, async (_event, filePath: string) => {
    try {
      const git = getGit()
      await git.checkout(['--', filePath])
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git reset (unstage)
  ipcMain.handle(IPC_CHANNELS.GIT_RESET, async (_event, files: string | string[]) => {
    try {
      const git = getGit()
      const fileList = Array.isArray(files) ? files : [files]
      await git.reset(['HEAD', '--', ...fileList])
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git commit
  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_event, options: CommitOptions) => {
    try {
      const git = getGit()
      if (options.files) {
        await git.add(options.files)
      }
      await git.commit(options.message)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git amend — 有 message 用 -m 改写信息，无 message 用 --no-edit 保留原信息
  ipcMain.handle(IPC_CHANNELS.GIT_AMEND, async (_event, options: AmendOptions) => {
    try {
      const git = getGit()
      const msg = options?.message?.trim()
      if (msg) {
        await git.raw(['commit', '--amend', '-m', msg])
      } else {
        await git.raw(['commit', '--amend', '--no-edit'])
      }
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git branches
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCHES, async () => {
    try {
      const git = getGit()
      const branches = await git.branch(['-a'])
      return branches.all
        .filter(name => !name.includes('HEAD'))
        .map(name => ({
          name,
          current: name === branches.current,
          remote: name.startsWith('remotes/')
        })) as GitBranch[]
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git checkout
  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_event, branch: string) => {
    try {
      const git = getGit()
      await git.checkout(branch)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git apply branch changes as file modifications (no commits)
  ipcMain.handle(IPC_CHANNELS.GIT_APPLY_BRANCH, async (_event, branch: string) => {
    const git = getGit()
    try {
      let mergeBase = ''
      try {
        mergeBase = (await git.raw(['merge-base', 'HEAD', branch])).trim()
      } catch {
        mergeBase = ''
      }
      const base = mergeBase || 'HEAD'
      const committedDiff = await git.raw(['diff', '--full-index', base, branch])

      const wtList = await git.raw(['worktree', 'list', '--porcelain'])
      let worktreePath = ''
      const lines = wtList.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('branch ') && lines[i].includes(branch)) {
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].startsWith('worktree ')) {
              worktreePath = lines[j].replace('worktree ', '').trim()
              break
            }
          }
          break
        }
      }

      let uncommittedDiff = ''
      let stagedDiff = ''
      if (worktreePath) {
        const wtGit = simpleGit(worktreePath)
        uncommittedDiff = await wtGit.raw(['diff', '--full-index', 'HEAD'])
        stagedDiff = await wtGit.raw(['diff', '--cached', '--full-index'])
      }

      const fullPatch = [committedDiff, uncommittedDiff, stagedDiff]
        .filter(s => s.trim())
        .join('\n')
      if (!fullPatch.trim()) {
        return { success: true, message: '该分支没有新的修改需要合并' }
      }

      const patchFile = path.join(tmpdir(), `vibe-apply-${Date.now()}.patch`)
      await writeFile(patchFile, fullPatch, 'utf-8')

      try {
        await git.raw(['apply', '--3way', patchFile])
        await unlink(patchFile).catch(() => {})
        await git.raw(['reset', 'HEAD']).catch(() => {})
      } catch (applyErr: any) {
        await unlink(patchFile).catch(() => {})
        return { conflict: true, message: applyErr.message }
      }

      notifyGitMeta()
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Retry apply after syncing index — called from "保留冲突" dialog button
  ipcMain.handle(IPC_CHANNELS.GIT_APPLY_BRANCH_RETRY, async (_event, branch: string) => {
    const git = getGit()
    try {
      // 同步 index 与 worktree，消除 "does not match index" 错误
      await git.raw(['add', '-A'])

      let mergeBase = ''
      try {
        mergeBase = (await git.raw(['merge-base', 'HEAD', branch])).trim()
      } catch {
        mergeBase = ''
      }
      const base = mergeBase || 'HEAD'
      const committedDiff = await git.raw(['diff', '--full-index', base, branch])

      const wtList = await git.raw(['worktree', 'list', '--porcelain'])
      let worktreePath = ''
      const lines = wtList.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('branch ') && lines[i].includes(branch)) {
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].startsWith('worktree ')) {
              worktreePath = lines[j].replace('worktree ', '').trim()
              break
            }
          }
          break
        }
      }

      let uncommittedDiff = ''
      let stagedDiff = ''
      if (worktreePath) {
        const wtGit = simpleGit(worktreePath)
        uncommittedDiff = await wtGit.raw(['diff', '--full-index', 'HEAD'])
        stagedDiff = await wtGit.raw(['diff', '--cached', '--full-index'])
      }

      const fullPatch = [committedDiff, uncommittedDiff, stagedDiff]
        .filter(s => s.trim())
        .join('\n')
      if (!fullPatch.trim()) {
        return { success: true, message: '该分支没有新的修改需要合并' }
      }

      const patchFile = path.join(tmpdir(), `vibe-apply-${Date.now()}.patch`)
      await writeFile(patchFile, fullPatch, 'utf-8')

      try {
        await git.raw(['apply', '--3way', patchFile])
        await unlink(patchFile).catch(() => {})
        await git.raw(['reset', 'HEAD']).catch(() => {})
      } catch (applyErr: any) {
        await unlink(patchFile).catch(() => {})
        return { conflict: true, message: applyErr.message }
      }

      notifyGitMeta()
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git stash list
  ipcMain.handle(IPC_CHANNELS.GIT_STASH_LIST, async () => {
    try {
      const git = getGit()
      const stashList = await git.stashList()
      return stashList.all
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git push
  ipcMain.handle(IPC_CHANNELS.GIT_PUSH, async (_event, remote?: string, branch?: string, force?: boolean) => {
    try {
      const git = getGit()
      const opts = force ? ['--force'] : []
      if (remote && branch) {
        await git.push(remote, branch, opts)
      } else {
        await git.push(opts)
      }
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git remote branches
  ipcMain.handle(IPC_CHANNELS.GIT_REMOTE_BRANCHES, async () => {
    try {
      const git = getGit()
      const result = await git.branch(['-r'])
      return result.all
        .filter((name: string) => !name.includes('HEAD'))
        .map((name: string) => {
          const parts = name.split('/')
          const remote = parts[0]
          const branch = parts.slice(1).join('/')
          return { name: name.trim(), remote, branch }
        })
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git worktree path — get filesystem path for a worktree branch
  ipcMain.handle(IPC_CHANNELS.GIT_WORKTREE_PATH, async (_event, branch: string) => {
    try {
      const git = getGit()
      const wtList = await git.raw(['worktree', 'list', '--porcelain'])
      let worktreePath = ''
      const lines = wtList.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('branch ') && lines[i].includes(branch)) {
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].startsWith('worktree ')) {
              worktreePath = lines[j].replace('worktree ', '').trim()
              break
            }
          }
          break
        }
      }
      if (!worktreePath) {
        return { error: `找不到分支 ${branch} 对应的 worktree 路径` }
      }
      return { path: worktreePath }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git stash push
  ipcMain.handle(IPC_CHANNELS.GIT_STASH_PUSH, async (_event, message?: string) => {
    try {
      const git = getGit()
      const args = message ? ['-m', message] : []
      await git.stash(['push', ...args])
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git stash pop
  ipcMain.handle(IPC_CHANNELS.GIT_STASH_POP, async () => {
    try {
      const git = getGit()
      await git.stash(['pop'])
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git stash drop
  ipcMain.handle(IPC_CHANNELS.GIT_STASH_DROP, async () => {
    try {
      const git = getGit()
      await git.stash(['drop'])
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git init
  ipcMain.handle(IPC_CHANNELS.GIT_INIT, async () => {
    try {
      const git = getGit()
      await git.init()
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git show - get commit details with files and diff
  ipcMain.handle(IPC_CHANNELS.GIT_SHOW, async (_event, hash: string) => {
    try {
      const git = getGit()

      // 获取 show 格式的消息头，%P 父 hash 为空即 root commit，无额外 IPC
      const showOutput = await git.show([hash, '--format=%H%n%P%n%s%n%an%n%ad%n', '--date=iso', '--no-patch'])
      const lines = showOutput.trimEnd().split('\n')
      const isRoot = lines[1] === ''

      // 用 --name-status 获取可靠的文件状态 (A/D/M/R)
      const nameStatusOutput = isRoot
        ? await git.raw(['diff-tree', '--root', '--name-status', hash])
        : await git.diff([`${hash}^`, hash, '--name-status'])
      const statusMap = new Map<string, GitCommitFile['status']>()
      const statusLines = nameStatusOutput ? nameStatusOutput.split('\n').filter(Boolean) : []
      for (const line of statusLines) {
        const tab = line.indexOf('\t')
        if (tab < 0) continue
        const rawStatus = line.slice(0, tab).trim()
        const filePath = line.slice(tab + 1).trim()
        let status: GitCommitFile['status'] = 'modified'
        if (rawStatus.startsWith('A')) status = 'added'
        else if (rawStatus.startsWith('D')) status = 'deleted'
        else if (rawStatus.startsWith('R')) status = 'renamed'
        else if (rawStatus.startsWith('M')) status = 'modified'
        statusMap.set(filePath, status)
      }

      // 用 --numstat 获取每文件增删行数（不依赖于 --stat 解析）
      const numstatOutput = isRoot
        ? await git.raw(['diff-tree', '--root', '--numstat', hash])
        : await git.diff([`${hash}^`, hash, '--numstat'])
      const statMap = new Map<string, { additions: number; deletions: number }>()
      const numstatLines = numstatOutput ? numstatOutput.split('\n').filter(Boolean) : []
      for (const line of numstatLines) {
        const parts = line.split('\t')
        if (parts.length < 3) continue
        const adds = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0
        const dels = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0
        const filePath = parts[2].trim()
        statMap.set(filePath, { additions: adds, deletions: dels })
      }

      const result: GitShowResult = {
        hash: '',
        message: '',
        author: '',
        date: '',
        files: [],
        diff: ''
      }

      if (lines[0]) result.hash = lines[0]
      if (lines[2]) result.message = lines[2]
      if (lines[3]) result.author = lines[3]
      if (lines[4]) result.date = lines[4]
      result.isRoot = isRoot

      // 合并 status 和 stat 信息构建文件列表（diff 在点击文件时按需加载）
      const allPaths = [...new Set([...statusMap.keys(), ...statMap.keys()])]
      const MAX_COMMIT_FILES = 500
      const truncated = allPaths.length > MAX_COMMIT_FILES
      const displayPaths = truncated ? allPaths.slice(0, MAX_COMMIT_FILES) : allPaths
      const files: GitCommitFile[] = []
      for (const filePath of displayPaths) {
        const status = statusMap.get(filePath) || 'modified'
        const stat = statMap.get(filePath) || { additions: 0, deletions: 0 }
        files.push({ path: filePath, status, additions: stat.additions, deletions: stat.deletions })
      }

      result.files = files
      result.fileCount = allPaths.length
      result.truncated = truncated

      return result
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Git delete worktree + branch
  ipcMain.handle(IPC_CHANNELS.GIT_DELETE_WORKTREE, async (_event, branch: string, force?: boolean) => {
    const git = getGit()
    try {
      // 1. Find worktree path
      const wtList = await git.raw(['worktree', 'list', '--porcelain'])
      let worktreePath = ''
      const lines = wtList.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('branch ') && lines[i].includes(branch)) {
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].startsWith('worktree ')) {
              worktreePath = lines[j].replace('worktree ', '').trim()
              break
            }
          }
          break
        }
      }

      if (!worktreePath) {
        // worktree 目录已被删除（手动删除 / 崩溃清理），git 仍留有引用
        // prune 清除 stale 引用，然后直接删分支
        await git.raw(['worktree', 'prune'])
        await git.raw(['branch', '-D', branch])
        notifyGitMeta()
        return { success: true }
      }

      // 2. Remove worktree — locked（如 claude session 持锁）需 -f -f，否则只跳过未提交检查
      try {
        const removeArgs = force
          ? ['worktree', 'remove', worktreePath, '--force', '--force']
          : ['worktree', 'remove', worktreePath, '--force']
        await git.raw(removeArgs)
      } catch (removeErr: any) {
        const msg = removeErr.message || ''
        if (!force && /locked working tree/i.test(msg)) {
          const reasonMatch = msg.match(/lock reason:\s*(.+?)\s*use 'remove/i)
          return { locked: true, lockReason: reasonMatch ? reasonMatch[1] : msg }
        }
        throw removeErr
      }

      // 3. Delete the branch
      await git.raw(['branch', '-D', branch])

      notifyGitMeta()
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Delete a local branch
  ipcMain.handle(IPC_CHANNELS.GIT_DELETE_BRANCH, async (_event, branch: string) => {
    const git = getGit()
    try {
      await git.raw(['branch', '-D', branch])
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Sync file filter rules from renderer — delegates to watcher module
  ipcMain.handle(IPC_CHANNELS.GIT_SET_FILTER_RULES, (_event, rules: string[]) => {
    updateSkipPatterns(rules || [])
  })

  // Workspace open - changes the git working directory
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN, async (event) => {
    const { dialog, BrowserWindow } = require('electron')
    const parentWin = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const opts = { properties: ['openDirectory'] }
    const result = parentWin
      ? await dialog.showOpenDialog(parentWin, opts)
      : await dialog.showOpenDialog(opts)
    if (!result.canceled && result.filePaths.length > 0) {
      currentWorkspace = result.filePaths[0]
      gitInstance = simpleGit(currentWorkspace)
      return { path: currentWorkspace }
    }
    return { canceled: true }
  })

  // Get current workspace
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CURRENT, () => {
    return { path: currentWorkspace }
  })

  // Pick directory - just shows dialog, does NOT change global workspace
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_PICK_DIR, async (event) => {
    const { dialog, BrowserWindow } = require('electron')
    const parentWin = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const opts = { properties: ['openDirectory'], title: 'Select Directory for Terminal' }
    const result = parentWin
      ? await dialog.showOpenDialog(parentWin, opts)
      : await dialog.showOpenDialog(opts)
    if (!result.canceled && result.filePaths.length > 0) {
      return { path: result.filePaths[0] }
    }
    return { canceled: true }
  })
}


function mapShortStatus(code: string, from?: string): GitFileStatus['status'] {
  switch (code) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'U': return 'conflicted'
    case ' ':
    case '?':
    default: return 'unstaged'
  }
}

interface V2FileEntry {
  index: string
  working_dir: string
  path: string
  from?: string
  conflicted?: boolean
}

// porcelain v2 条目行字段数经实测：1=8 后为 path，2=9 后为 path<TAB>origPath，u=10 后为 path
function parsePorcelainV2(output: string): { files: V2FileEntry[]; current: string; ahead: number; behind: number } {
  const files: V2FileEntry[] = []
  let current = ''
  let ahead = 0
  let behind = 0
  for (const line of output.split('\n')) {
    if (!line) continue
    const type = line[0]
    if (type === '#') {
      if (line.startsWith('# branch.head ')) {
        current = line.slice(14)
      } else if (line.startsWith('# branch.ab ')) {
        const m = line.match(/\+(\d+) -(\d+)/)
        if (m) {
          ahead = parseInt(m[1], 10)
          behind = parseInt(m[2], 10)
        }
      }
      continue
    }
    if (type === '?') {
      files.push({ index: '?', working_dir: '?', path: line.slice(2) })
      continue
    }
    if (type === '!') continue
    const tokens = line.split(' ')
    const xy = tokens[1] || '..'
    const index = xy[0] === '.' ? ' ' : xy[0]
    const workdir = xy[1] === '.' ? ' ' : xy[1]
    if (type === '1' && tokens.length >= 9) {
      files.push({ index, working_dir: workdir, path: tokens.slice(8).join(' ') })
    } else if (type === '2' && tokens.length >= 10) {
      const tail = tokens.slice(9).join(' ')
      const tab = tail.indexOf('\t')
      if (tab >= 0) files.push({ index, working_dir: workdir, path: tail.slice(0, tab), from: tail.slice(tab + 1) })
      else files.push({ index, working_dir: workdir, path: tail })
    } else if (type === 'u' && tokens.length >= 11) {
      files.push({ index, working_dir: workdir, path: tokens.slice(10).join(' '), conflicted: true })
    }
  }
  return { files, current, ahead, behind }
}

function getOldPath(f: { from?: string }, status: string): string | undefined {
  if (status === 'R' || status === 'C') {
    return f.from
  }
  return undefined
}

// 从 git diff --cached 输出中扫描冲突标记，返回包含冲突的文件路径集合
const CONFLICT_MARKER_RE = /^\+<{7}(?: |$)|^\+={7}$|^\+>{7}(?: |$)/
function parseConflictFilesFromDiff(diff: string): Set<string> {
  const conflictPaths = new Set<string>()
  let currentFile = ''
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)/)
    if (fileMatch) {
      currentFile = fileMatch[1]
      continue
    }
    if (CONFLICT_MARKER_RE.test(line)) {
      if (currentFile) conflictPaths.add(currentFile)
    }
  }
  return conflictPaths
}