// IPC Channel definitions
export const IPC_CHANNELS = {
  // Terminal
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_RENAME: 'pty:rename',
  PTY_CLOSE: 'pty:close',
  PTY_DATA: 'pty:data',
  PTY_EXIT: 'pty:exit',

  // Git
  GIT_STATUS: 'git:status',
  GIT_SET_WORKSPACE: 'git:setWorkspace',
  GIT_CHANGED: 'git:changed',  // Push event when git state changes (file watcher)
  GIT_LOG: 'git:log',
  GIT_DIFF: 'git:diff',
  GIT_COMMIT: 'git:commit',
  GIT_ADD: 'git:add',
  GIT_RESET: 'git:reset',
  GIT_CHECKOUT: 'git:checkout',
  GIT_APPLY_BRANCH: 'git:applyBranch',
  GIT_BRANCHES: 'git:branches',
  GIT_STASH_LIST: 'git:stashList',
  GIT_STASH_PUSH: 'git:stashPush',
  GIT_STASH_POP: 'git:stashPop',
  GIT_INIT: 'git:init',
  GIT_SHOW: 'git:show',

  // File
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_LIST: 'file:list',
  FILE_TREE: 'file:tree',

  // Workspace
  WORKSPACE_OPEN: 'workspace:open',
  WORKSPACE_CURRENT: 'workspace:current',
  WORKSPACE_PICK_DIR: 'workspace:pickDir',

  // Search
  SEARCH_GREP: 'search:grep',

  // Theme
  TITLE_BAR_UPDATE: 'titlebar:update'
} as const

// Terminal types
export interface TerminalSession {
  id: string
  name: string
  cwd: string
  active: boolean
  createdAt: number
}

export interface RenameTerminalResult {
  success: boolean
  session?: TerminalSession
  error?: string
}

export interface CreateTerminalOptions {
  cwd?: string
  name?: string
}

// Git types
export interface GitFileStatus {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'staged' | 'unstaged' | 'conflicted'
  staged: boolean
  oldPath?: string
  additions?: number
  deletions?: number
}

export interface GitLogEntry {
  hash: string
  message: string
  author: string
  date: string
  refs?: string
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitCommitFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  diff?: string
}

export interface GitShowResult {
  hash: string
  message: string
  author: string
  date: string
  files: GitCommitFile[]
  diff?: string
}

export interface GitDiffResult {
  file: string
  content: string
  oldContent: string
  hunks: GitDiffHunk[]
}

export interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content: string
}

export interface GitStatusResult {
  files: GitFileStatus[]
  branch: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  clean: boolean
}

export interface CommitOptions {
  message: string
  files?: string[]
}

// File types
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

// Search types
export interface GrepSearchOptions {
  query: string
  cwd: string
  regex?: boolean
  caseSensitive?: boolean
  include?: string
}

export interface GrepMatch {
  file: string
  fullPath: string
  line: number
  column: number
  content: string
}

export interface GrepSearchResult {
  matches: GrepMatch[]
  total: number
  truncated: boolean
}