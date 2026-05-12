import { ipcMain, BrowserWindow } from 'electron'
import simpleGit, { SimpleGit } from 'simple-git'
import { IPC_CHANNELS, GitStatusResult, GitLogEntry, GitDiffResult, GitBranch, CommitOptions, GitShowResult, GitCommitFile } from '../shared/types'
import { readFile, writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { watch, FSWatcher, existsSync } from 'fs'

let gitInstance: SimpleGit | null = null
let currentWorkspace: string = process.cwd()
let gitWatcher: FSWatcher | null = null
let debounceTimer: NodeJS.Timeout | null = null

function getGit(): SimpleGit {
  if (!gitInstance) {
    gitInstance = simpleGit(currentWorkspace)
  }
  return gitInstance
}

// Skip patterns for file watcher
const WATCHER_SKIP = /[\\/](\.git|node_modules|\.next|dist|build|out|__pycache__|target|\.cache)[\\/]/

const COOLDOWN_MS = 2000  // Minimum gap between notifications
let lastNotifyTime = 0
let pendingTimer: NodeJS.Timeout | null = null

function notifyGitChanged() {
  const now = Date.now()
  const elapsed = now - lastNotifyTime

  if (elapsed >= COOLDOWN_MS) {
    lastNotifyTime = now
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send(IPC_CHANNELS.GIT_CHANGED)
    })
  } else {
    // In cooldown — schedule one deferred notification at cooldown end
    if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        lastNotifyTime = Date.now()
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send(IPC_CHANNELS.GIT_CHANGED)
        })
      }, COOLDOWN_MS - elapsed)
    }
  }
}

// Setup file watcher on workspace (not .git) to detect external file changes
function setupGitWatcher(workspace: string) {
  if (gitWatcher) {
    gitWatcher.close()
    gitWatcher = null
  }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }

  if (!existsSync(workspace)) return

  gitWatcher = watch(workspace, { recursive: true }, (_eventType, filename) => {
    if (!filename) return
    // Skip .git, node_modules, and other generated dirs
    const normalized = filename.replace(/\\/g, '/')
    if (WATCHER_SKIP.test('/' + normalized + '/')) return

    // Debounce + cooldown: coalesce events, prevent notification storms
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      notifyGitChanged()
    }, 300)
  })
}

function mapStatus(raw: string, index: string): GitStatusResult {
  const files: GitFileStatus[] = []

  // Parse the status output
  const lines = raw.split('\n').filter(Boolean)
  for (const line of lines) {
    const statusCode = line.substring(0, 2)
    const filePath = line.substring(3)
    const staged = statusCode[0] !== ' ' && statusCode[0] !== '?'
    let status: GitFileStatus['status'] = 'unstaged'

    if (statusCode === '??') status = 'untracked'
    else if (statusCode.startsWith('A')) status = 'added'
    else if (statusCode.startsWith('M') || statusCode[1] === 'M') status = 'modified'
    else if (statusCode.startsWith('D') || statusCode[1] === 'D') status = 'deleted'
    else if (statusCode.startsWith('R')) status = 'renamed'
    else if (statusCode.startsWith('C')) status = 'copied'
    else if (statusCode.startsWith('U')) status = 'conflicted'

    files.push({
      path: filePath,
      status,
      staged,
      oldPath: status === 'renamed' ? filePath.split(' -> ')[0] : undefined
    })
  }

  // Parse branch info from index line
  const branchMatch = index.match(/## (.+)/)
  const branchInfo = branchMatch ? branchMatch[1] : ''
  const branch = branchInfo.split('...')[0].replace('[', '').trim()
  const aheadMatch = branchInfo.match(/ahead (\d+)/)
  const behindMatch = branchInfo.match(/behind (\d+)/)

  const stagedCount = files.filter(f => f.staged).length
  const unstagedCount = files.filter(f => !f.staged && f.status !== 'untracked').length
  const untrackedCount = files.filter(f => f.status === 'untracked').length

  return {
    files,
    branch,
    ahead: aheadMatch ? parseInt(aheadMatch[1]) : 0,
    behind: behindMatch ? parseInt(behindMatch[1]) : 0,
    staged: stagedCount,
    unstaged: unstagedCount,
    untracked: untrackedCount,
    clean: files.length === 0
  }
}

export function registerGitHandlers(): void {
  // Set git workspace path — switches git instance to a new directory
  ipcMain.handle(IPC_CHANNELS.GIT_SET_WORKSPACE, async (_event, path: string) => {
    currentWorkspace = path
    gitInstance = simpleGit(currentWorkspace)
    setupGitWatcher(path)  // Start watching the new workspace
    return { success: true, path: currentWorkspace }
  })

  // Get git status
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async () => {
    try {
      const git = getGit()

      const diffStat: Record<string, { additions: number; deletions: number }> = {}
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

      const stagedDiffStat: Record<string, { additions: number; deletions: number }> = {}
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

      const statusShort = await git.status(['-s'])
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
            status: mapShortStatus(indexStatus, f.from),
            staged: true,
            oldPath: getOldPath(f, indexStatus),
            additions: stagedDiffStat[filePath]?.additions || 0,
            deletions: stagedDiffStat[filePath]?.deletions || 0
          })
        }

        if (workdirStatus !== ' ' && workdirStatus !== '?') {
          unstagedFiles.push({
            path: filePath,
            status: mapShortStatus(workdirStatus, f.from),
            staged: false,
            oldPath: getOldPath(f, workdirStatus),
            additions: diffStat[filePath]?.additions || 0,
            deletions: diffStat[filePath]?.deletions || 0
          })
        }
      }

      const result: GitStatusResult = {
        files: [...stagedFiles, ...unstagedFiles, ...untrackedFiles],
        branch: statusShort.current || '',
        ahead: statusShort.ahead,
        behind: statusShort.behind,
        staged: stagedFiles.length,
        unstaged: unstagedFiles.length,
        untracked: untrackedFiles.length,
        clean: stagedFiles.length === 0 && unstagedFiles.length === 0 && untrackedFiles.length === 0
      }
      return result
    } catch (err: any) {
      return { error: err.message, files: [], branch: '', clean: false }
    }
  })

  // Get git log
  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_event, count?: number) => {
    try {
      const git = getGit()
      const log = await git.log({ maxCount: count || 50 })
      return log.all.map(entry => ({
        hash: entry.hash,
        message: entry.message,
        author: entry.author_name,
        date: entry.date,
        refs: entry.refs
      })) as GitLogEntry[]
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Get git diff
  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, async (_event, filePath?: string, staged?: boolean) => {
    try {
      const git = getGit()
      let diffOutput: string

      if (filePath) {
        diffOutput = staged
          ? await git.diff(['--cached', filePath])
          : await git.diff([filePath])
      } else {
        diffOutput = staged
          ? await git.diff(['--cached'])
          : await git.diff()
      }

      return { content: diffOutput } as GitDiffResult
    } catch (err: any) {
      return { error: err.message, content: '' }
    }
  })

  // Git add
  ipcMain.handle(IPC_CHANNELS.GIT_ADD, async (_event, files: string | string[]) => {
    try {
      const git = getGit()
      await git.add(files)
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
      await git.reset(['HEAD', '--', files])
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

  // Git branches
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCHES, async () => {
    try {
      const git = getGit()
      const branches = await git.branch()
      return branches.all.map(name => ({
        name,
        current: name === branches.current
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
      // Step 1: Merge commits from the branch (if any)
      await git.raw(['merge', '--squash', '--no-commit', branch])
      await git.raw(['reset', 'HEAD'])

      // Step 2: Find worktree path and apply its uncommitted changes
      const wtList = await git.raw(['worktree', 'list', '--porcelain'])
      let worktreePath = ''
      const lines = wtList.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('branch ') && lines[i].includes(branch)) {
          // Find preceding worktree path line
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].startsWith('worktree ')) {
              worktreePath = lines[j].replace('worktree ', '').trim()
              break
            }
          }
          break
        }
      }

      if (worktreePath) {
        // Get diff of uncommitted changes from worktree
        const wtGit = simpleGit(worktreePath)
        const diffPatch = await wtGit.raw(['diff', 'HEAD'])
        const untrackedPatch = await wtGit.raw(['diff', '--cached'])
        if (diffPatch.trim() || untrackedPatch.trim()) {
          const patchFile = path.join(tmpdir(), `vibe-apply-${Date.now()}.patch`)
          await writeFile(patchFile, diffPatch + untrackedPatch, 'utf-8')
          try {
            await git.raw(['apply', '--3way', patchFile])
          } finally {
            await unlink(patchFile).catch(() => {})
          }
        }
      }

      // Check if anything actually changed
      const diffResult = await git.raw(['diff', '--name-only'])
      const stagedDiff = await git.raw(['diff', '--cached', '--name-only'])
      if (!diffResult.trim() && !stagedDiff.trim()) {
        return { success: true, message: '该分支没有新的修改需要合并' }
      }
      return { success: true }
    } catch (err: any) {
      try { await git.raw(['merge', '--abort']) } catch {}
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
  ipcMain.handle(IPC_CHANNELS.GIT_PUSH, async (_event, remote?: string, branch?: string) => {
    try {
      const git = getGit()
      if (remote && branch) {
        await git.push(remote, branch)
      } else {
        await git.push()
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
      const showOutput = await git.show([hash, '--stat', '--format=%H%n%s%n%an%n%ad%n', '--date=iso'])
      const lines = showOutput.split('\n')

      const result: GitShowResult = {
        hash: '',
        message: '',
        author: '',
        date: '',
        files: [],
        diff: ''
      }

      let i = 0
      if (lines[i]) result.hash = lines[i++]
      if (lines[i]) result.message = lines[i++]
      if (lines[i]) result.author = lines[i++]
      if (lines[i]) result.date = lines[i++]

      const fileInfos: { path: string; status: GitCommitFile['status'] }[] = []
      for (; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes('|')) {
          const parts = line.split('|')
          const path = parts[0].trim()
          let status: GitCommitFile['status'] = 'modified'

          if (path.startsWith('A ')) {
            status = 'added'
          } else if (path.startsWith('D ')) {
            status = 'deleted'
          } else if (path.startsWith('R ') || line.includes(' -> ')) {
            status = 'renamed'
          }

          const cleanPath = path.includes(' -> ')
            ? path.replace('A ', '').split(' -> ')[1]
            : path.replace(/^[AMD]\s*/, '').trim()
          fileInfos.push({ path: cleanPath, status })
        }
      }

      const files: GitCommitFile[] = []
      for (const info of fileInfos) {
        let fileDiff = ''
        let additions = 0
        let deletions = 0
        try {
          fileDiff = await git.diff([`${hash}^`, hash, '--', info.path])
          for (const diffLine of fileDiff.split('\n')) {
            if (diffLine.startsWith('+') && !diffLine.startsWith('+++')) additions++
            else if (diffLine.startsWith('-') && !diffLine.startsWith('---')) deletions++
          }
        } catch {
          fileDiff = ''
        }
        files.push({ ...info, additions, deletions, diff: fileDiff })
      }

      result.files = files

      return result
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Workspace open - changes the git working directory
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN, async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
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
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_PICK_DIR, async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Directory for Terminal'
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return { path: result.filePaths[0] }
    }
    return { canceled: true }
  })
}

function mapSimpleGitStatus(f: any): GitFileStatus['status'] {
  const workingDir = f.working_dir
  const index = f.index

  if (index === '?' && workingDir === '?') return 'untracked'
  if (index === 'A') return 'added'
  if (index === 'M' || workingDir === 'M') return 'modified'
  if (index === 'D' || workingDir === 'D') return 'deleted'
  if (index === 'R') return 'renamed'
  if (index === 'C') return 'copied'
  if (index === 'U') return 'conflicted'
  if (index !== ' ' && index !== '?') return 'staged'
  return 'unstaged'
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

function getOldPath(f: { from?: string }, status: string): string | undefined {
  if (status === 'R' || status === 'C') {
    return f.from
  }
  return undefined
}