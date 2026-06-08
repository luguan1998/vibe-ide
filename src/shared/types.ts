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
  PTY_GET_SHELLS: 'pty:getShells',
  PTY_SET_AUTO_APPROVE: 'pty:setAutoApprove',

  // Git
  GIT_STATUS: 'git:status',
  GIT_SET_WORKSPACE: 'git:setWorkspace',
  FS_CHANGED: 'fs:changed',  // Push event when filesystem changes (file watcher)
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
  GIT_PUSH: 'git:push',
  GIT_INIT: 'git:init',
  GIT_SHOW: 'git:show',
  GIT_SHOW_FILE: 'git:showFile',
  GIT_DIFF_COMMIT_FILE: 'git:diffCommitFile',
  GIT_DISCARD: 'git:discard',
  GIT_REMOTE_BRANCHES: 'git:remoteBranches',
  GIT_WORKTREE_PATH: 'git:worktreePath',
  GIT_APPLY_BRANCH_RETRY: 'git:applyBranchRetry',
  GIT_DELETE_WORKTREE: 'git:deleteWorktree',
  GIT_DELETE_BRANCH: 'git:deleteBranch',
  GIT_SET_FILTER_RULES: 'git:setFilterRules',

  // File
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_READ_ENCODING: 'file:readEncoding',
  FILE_WRITE_ENCODING: 'file:writeEncoding',
  FILE_LIST: 'file:list',
  FILE_TREE: 'file:tree',
  FILE_DELETE: 'file:delete',
  FILE_RENAME: 'file:rename',
  FILE_CREATE_DIR: 'file:createDir',
  FILE_OPEN_EXPLORER: 'file:openExplorer',
  FILE_COPY: 'file:copy',
  FILE_MOVE: 'file:move',
  FILE_FIND: 'file:find',

  // Workspace
  WORKSPACE_OPEN: 'workspace:open',
  WORKSPACE_CURRENT: 'workspace:current',
  WORKSPACE_PICK_DIR: 'workspace:pickDir',

  // Search
  SEARCH_GREP: 'search:grep',
  SEARCH_REPLACE: 'search:replace',

  // Theme
  TITLE_BAR_UPDATE: 'titlebar:update',

  // Font
  FONT_ADJUST: 'font:adjust',

  // Focus
  FOCUS_SETTINGS: 'focus:settings',

  // Startup
  STARTUP_OPEN_PATH: 'startup:openPath',

  // CodeGraph
  CODE_SET_WORKSPACE: 'code:setWorkspace',
  CODE_IS_INITIALIZED: 'code:isInitialized',
  CODE_INIT: 'code:init',
  CODE_SEARCH_NODES: 'code:searchNodes',
  CODE_GET_CALLERS: 'code:getCallers',
  CODE_GET_CALLEES: 'code:getCallees',
  CODE_GET_CALL_GRAPH: 'code:getCallGraph',
  CODE_IS_INDEXING: 'code:isIndexing',
  CODE_PROGRESS: 'code:progress',           // push: init/index progress
  CODE_CANCEL_INIT: 'code:cancelInit',       // cancel ongoing init/index
  CODE_GET_STATS: 'code:getStats',
  CODE_INSTALL_MCP: 'code:installMcp',
  CODE_FIND_RELEVANT_CONTEXT: 'code:findRelevantContext',
  CODE_GET_NODE_CODE: 'code:getNodeCode',

  // App
  APP_VERSION: 'app:version'
} as const

// Terminal types
export interface TerminalSession {
  id: string
  name: string
  cwd: string
  shell?: string
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
  shell?: string
  autoUtf8?: boolean
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
  remote?: boolean
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
  fileCount?: number
  diff?: string
  truncated?: boolean
  isRoot?: boolean
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
  truncated: boolean
  totalFiles: number
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

export interface ReplaceOptions {
  query: string
  replacement: string
  cwd: string
  regex?: boolean
  caseSensitive?: boolean
  include?: string
  excludeFiles?: string[]
}

export interface ReplaceResult {
  filesModified: number
  totalReplacements: number
  errors: string[]
}

// CodeGraph types
export interface CodeSymbol {
  id: string
  name: string
  kind: string
  filePath: string
  line: number
  column: number
  signature?: string
}