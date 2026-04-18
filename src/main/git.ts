import { ipcMain } from 'electron'
import simpleGit, { SimpleGit } from 'simple-git'
import { IPC_CHANNELS, GitStatusResult, GitLogEntry, GitDiffResult, GitBranch, CommitOptions } from '../shared/types'
import { readFile, writeFile } from 'fs/promises'

let gitInstance: SimpleGit | null = null
let currentWorkspace: string = process.cwd()

function getGit(): SimpleGit {
  if (!gitInstance) {
    gitInstance = simpleGit(currentWorkspace)
  }
  return gitInstance
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
    return { success: true, path: currentWorkspace }
  })

  // Get git status
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async () => {
    try {
      const git = getGit()
      const status = await git.status()
      const result: GitStatusResult = {
        files: status.files.map(f => ({
          path: f.path,
          status: mapSimpleGitStatus(f),
          staged: f.index !== '?' && f.index !== ' ',
          oldPath: f.from
        })),
        branch: status.current || '',
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged.length,
        unstaged: status.modified.length + status.deleted.length,
        untracked: status.not_added.length,
        clean: status.isClean()
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