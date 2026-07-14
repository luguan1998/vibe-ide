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
  GIT_AMEND: 'git:amend',
  GIT_ADD: 'git:add',
  GIT_RESET: 'git:reset',
  GIT_CHECKOUT: 'git:checkout',
  GIT_APPLY_BRANCH: 'git:applyBranch',
  GIT_BRANCHES: 'git:branches',
  GIT_STASH_LIST: 'git:stashList',
  GIT_STASH_PUSH: 'git:stashPush',
  GIT_STASH_POP: 'git:stashPop',
  GIT_STASH_DROP: 'git:stashDrop',
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
  GIT_LINE_LOG: 'git:lineLog',
  GIT_GRAPH: 'git:graph',

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

  // Claude config (model/provider groups switcher)
  CLAUDE_CONFIG_DIR: 'claudeConfig:dir',

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
  FONT_LIST: 'font:list',

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
  CODE_IS_INDEXING: 'code:isIndexing',
  CODE_PROGRESS: 'code:progress',           // push: init/index progress
  CODE_CANCEL_INIT: 'code:cancelInit',       // cancel ongoing init/index
  CODE_GET_STATS: 'code:getStats',
  CODE_INSTALL_MCP: 'code:installMcp',
  CODE_FIND_RELEVANT_CONTEXT: 'code:findRelevantContext',
  CODE_EXPLORE: 'code:explore',
  CODE_SET_ENABLED: 'code:setEnabled',
  CODE_CHECK_AVAILABLE: 'code:checkAvailable',

  // Perf
  PERF_SNAPSHOT: 'perf:snapshot',

  // OCR
  OCR_RECOGNIZE: 'ocr:recognize',

  // AI (OpenClaude)
  AI_CREATE: 'ai:create',
  AI_SEND: 'ai:send',
  AI_CANCEL: 'ai:cancel',
  AI_DESTROY: 'ai:destroy',
  AI_CHECK_AVAILABLE: 'ai:checkAvailable',
  AI_LIST_SESSIONS: 'ai:listSessions',
  AI_LOAD_SESSION_MESSAGES: 'ai:loadSessionMessages',
  AI_PERMISSION_RESPONSE: 'ai:permissionResponse',
  AI_PLAN_EXECUTE: 'ai:planExecute',
  AI_SET_PERMISSION_MODE: 'ai:setPermissionMode',
  AI_SET_MODEL: 'ai:setModel',
  AI_SET_VISIBLE: 'ai:setVisible',       // invoke: renderer hidden → main drops stream tokens
  AI_ASK_RESUME: 'ai:askResume',
  AI_REVERT: 'ai:revert',
  AI_FORK: 'ai:fork',
  AI_LIST_USER_TURNS: 'ai:listUserTurns',  // invoke: real user turns from JSONL (single source of truth for revert index)
  AI_MESSAGE: 'ai:message',               // push: full message (assistant text/tool_use)
  AI_STREAM_TOKEN: 'ai:streamToken',      // push: partial token for streaming display
  AI_PROGRESS: 'ai:progress',             // push: tool_progress events
  AI_PERMISSION: 'ai:permission',         // push: permission_request events
  AI_READY: 'ai:ready',                   // push: subprocess started, system init received
  AI_MODEL_CHANGED: 'ai:modelChanged',   // push: model switched via setModel
  AI_ERROR: 'ai:error',                   // push: process error or crash
  AI_FILE_CHANGE: 'ai:fileChange',        // push: tool_use with file edit detected

  // App
  APP_VERSION: 'app:version',
  SNIPPETS_LOAD: 'app:snippetsLoad',
  SNIPPETS_TOGGLE: 'app:snippetsToggle'
} as const

// Snippet types
export interface SnippetInfo {
  name: string
  enabled: boolean
}

export interface SnippetsLoadResult {
  css: string
  snippets: SnippetInfo[]
  dir: string
}

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

export interface GitGraphEntry {
  hash: string
  parents: string[]
  refs: string
  message: string
  author: string
  date: string
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

export interface AmendOptions {
  message?: string
}

export interface GitLineLogEntry {
  hash: string
  message: string
  author: string
  date: string
}

// File types
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

// Recently opened file entry (global, persisted in localStorage)
export interface RecentFileEntry {
  path: string      // fullPath
  line?: number     // 1-based line number
  endLine?: number  // 1-based end line for selection range
}

// Search types
export interface GrepSearchOptions {
  query: string
  cwd: string
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
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
  wholeWord?: boolean
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

// AI (Claude CLI) types
export type AiMessageType =
  | 'system'
  | 'assistant'
  | 'user'
  | 'result'
  | 'stream_event'
  | 'permission_request'
  | 'tool_progress'

export interface AiMessage {
  sessionId: string
  type: AiMessageType
  role?: 'assistant' | 'user'
  // Stable across multi-block assistant messages. CLI's stream-json emits one assistant
  // message per content block (thinking, then text, then tool_use) but the underlying
  // message.id is the same. Without this, renderer appends each block as a separate
  // message → same sentence shows twice.
  messageId?: string
  content?: string
  thinking?: string
  thinkingDurationMs?: number
  model?: string
  toolUse?: AiToolUse[]
  toolResult?: AiToolResult
  error?: string
  installCmd?: string
  costUsd?: number
  numTurns?: number
  durationMs?: number
  contextPercent?: number | null
  subtype?: 'success' | 'error_max_tokens' | 'error_during_execution'
  isAborted?: boolean
  parentToolUseId?: string
  timestamp: number
}

export const AI_FILE_EDIT_TOOLS = new Set([
  'write_file', 'edit_file', 'file_write', 'file_edit',
  'create_file', 'replace', 'insert', 'Write', 'Edit', 'NotebookEdit',
])

export interface AiToolUse {
  id: string
  name: string
  input: Record<string, any>
  result?: AiToolResult
}

export interface AiToolResult {
  toolUseId: string
  content: string
  isError: boolean
}

export interface AiFileChange {
  toolUseId: string
  sessionId: string
  filePath: string
  relativePath: string
  action: 'create' | 'edit' | 'delete'
  content?: string
  oldContent?: string
}

// A real user turn in the JSONL — single source of truth for revert/fork indexing.
// Slash command groups (caveat/command-name/args/stdout) collapse to one turn with
// isInternal=true; plain user text is one turn with isInternal=false. lineIdx is the
// JSONL line index of the turn's first line, used by truncate to locate the cut point.
export interface UserTurn {
  lineIdx: number
  content: string
  isInternal: boolean
}

export interface AiPermissionRequest {
  sessionId: string
  requestId: string       // tool_use_id from control_request
  tool: string            // tool_name
  description: string
  command?: string
  toolInput?: Record<string, any>  // original tool_input, needed for control_response
}

export interface AiSlashCommand {
  name: string
  description: string
  argumentHint?: string
}

export interface AiExamplePrompt {
  label: string
  prompt: string
}

export interface AiSessionState {
  ready: boolean
  busy: boolean
  messages: AiMessage[]
  streaming: boolean
  streamBuffer: string
  thinkingBuffer: string
  thinkingStartedAt: number | null
  pendingPermission: AiPermissionRequest | null
  slashCommands: AiSlashCommand[]
  model: string
  contextPercent: number | null
  name: string
  fileChangesByTurn: AiFileChange[][]
  userTurns: UserTurn[]
  cwd: string
  worktreePath?: string
  resumeSessionId?: string
}

export type AiPermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions'

export interface AiCreateOptions {
  sessionId: string
  cwd: string
  autoApprove: boolean
  permissionMode: AiPermissionMode
  resumeSessionId?: string
  cliCommand?: string
  enableWorktree?: boolean
}

export interface AiSendPayload {
  sessionId: string
  message: string
}

export interface AiPermissionResponsePayload {
  sessionId: string
  requestId: string
  approved: boolean
  tool?: string
  toolInput?: Record<string, any>
  feedback?: string  // For deny path: shown to model as reason. For ExitPlanMode keep-planning feedback.
}

// Clear conversation context + restart in acceptEdits mode + send plan as first message.
// Used by ExitPlanMode "Clear + Execute" path: plan is already on disk (input.planFilePath).
export interface AiPlanExecutePayload {
  sessionId: string
  planFilePath: string
  model?: string
  resume?: boolean
}

// Switch permission mode at runtime via control_request subtype=set_permission_mode
// (no subprocess restart). Validated against Claude CLI 2.1.139 raw stream-json input.
export interface AiSetPermissionModePayload {
  sessionId: string
  mode: AiPermissionMode
}

// Switch model at runtime via control_request subtype=set_model
// (same pattern as set_permission_mode). CLI resolves aliases (opus/sonnet/haiku)
// via ANTHROPIC_DEFAULT_*_MODEL env vars.
export interface AiSetModelPayload {
  sessionId: string
  model: string
}

// Kill-and-resume for AskUserQuestion. Claude CLI auto-fills empty answers after ~0.5s when
// waiting on a control_response in stream-json input mode, so we can't rely on the normal
// control_response path. Instead: kill the subprocess, respawn with --resume <claudeSessionId>,
// and send the user's answers as a fresh user message. This avoids the "I didn't receive a
// selection" noise message. Pattern copied from desktop-cc-gui-main (Tauri reference impl).
export interface AiAskResumePayload {
  sessionId: string
  answers: Record<string, string>  // { [questionText]: "selected label" }
}

// Revert conversation to a specific user message by truncating the JSONL and restarting CLI.
// Scope 'conversation' only rewinds messages; 'both' also reverts file changes via git checkout.
export interface AiRevertPayload {
  sessionId: string
  userMessageIndex: number   // index of the target user message among real user messages
  scope: 'conversation' | 'both'
  cwd: string
}

// Fork conversation at a specific user message: create a new truncated JSONL with a fresh
// session ID. The renderer spawns a new CLI process via --resume to the forked session.
export interface AiForkPayload {
  sessionId: string
  userMessageIndex: number
  cwd: string
}