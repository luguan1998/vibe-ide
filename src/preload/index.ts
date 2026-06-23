import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'

const api = {
  // Terminal operations
  terminal: {
    create: (options?: any) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CREATE, options),
    write: (id: string, data: string) => ipcRenderer.send(IPC_CHANNELS.PTY_WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC_CHANNELS.PTY_RESIZE, { id, cols, rows }),
    close: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CLOSE, id),
    rename: (id: string, newName: string) => ipcRenderer.invoke(IPC_CHANNELS.PTY_RENAME, id, newName),
    getShells: () => ipcRenderer.invoke(IPC_CHANNELS.PTY_GET_SHELLS),
    setAutoApprove: (id: string, cwd: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.PTY_SET_AUTO_APPROVE, { id, cwd, enabled }),
    onData: (callback: (data: { id: string; data: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.PTY_DATA, handler)
      return handler
    },
    onExit: (callback: (data: { id: string; exitCode: number }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.PTY_EXIT, handler)
      return handler
    },
    removeDataListener: (handler?: any) => {
      if (handler) {
        ipcRenderer.removeListener(IPC_CHANNELS.PTY_DATA, handler)
      } else {
        ipcRenderer.removeAllListeners(IPC_CHANNELS.PTY_DATA)
      }
    },
    removeExitListener: (handler?: any) => {
      if (handler) {
        ipcRenderer.removeListener(IPC_CHANNELS.PTY_EXIT, handler)
      } else {
        ipcRenderer.removeAllListeners(IPC_CHANNELS.PTY_EXIT)
      }
    }
  },

  // Git operations
  git: {
    setWorkspace: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_SET_WORKSPACE, path),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS),
    log: (count?: number) => ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, count),
    diff: (filePath?: string, staged?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, filePath, staged),
    add: (files: string | string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_ADD, files),
    reset: (files: string | string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_RESET, files),
    commit: (options: any) => ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, options),
    branches: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCHES),
    checkout: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT, branch),
    applyBranch: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_APPLY_BRANCH, branch),
    discard: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DISCARD, filePath),
    stashList: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_LIST),
    stashPush: (message?: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_PUSH, message),
    stashPop: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_POP),
    push: (remote?: string, branch?: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_PUSH, remote, branch),
    remoteBranches: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_REMOTE_BRANCHES),
    init: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_INIT),
    show: (hash: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_SHOW, hash),
    showFile: (ref: string, filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_SHOW_FILE, ref, filePath),
    diffCommitFile: (hash: string, filePath: string, isRoot: boolean) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF_COMMIT_FILE, hash, filePath, isRoot),
    getWorktreePath: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_WORKTREE_PATH, branch),
    applyBranchRetry: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_APPLY_BRANCH_RETRY, branch),
    deleteWorktree: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DELETE_WORKTREE, branch),
    deleteBranch: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DELETE_BRANCH, branch),
    setFilterRules: (rules: string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_SET_FILTER_RULES, rules),
    lineLog: (filePath: string, startLine: number, endLine: number) => ipcRenderer.invoke(IPC_CHANNELS.GIT_LINE_LOG, filePath, startLine, endLine)
  },

  // File operations
  file: {
    read: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
    readWithEncoding: (filePath: string, encoding?: string, forceOpen?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_ENCODING, filePath, encoding, forceOpen),
    writeWithEncoding: (filePath: string, content: string, encoding?: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE_ENCODING, filePath, content, encoding),
    list: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST, dirPath),
    tree: (dirPath: string, depth?: number, skipPatterns?: string[]) => ipcRenderer.invoke(IPC_CHANNELS.FILE_TREE, dirPath, depth, skipPatterns),
    delete: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, filePath),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_RENAME, oldPath, newPath),
    createDir: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_CREATE_DIR, dirPath),
    openExplorer: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_EXPLORER, filePath),
    copy: (srcPath: string, destPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_COPY, srcPath, destPath),
    move: (srcPath: string, destPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_MOVE, srcPath, destPath),
    find: (cwd: string, filename: string, skipPatterns?: string[]) => ipcRenderer.invoke(IPC_CHANNELS.FILE_FIND, cwd, filename, skipPatterns),
        onChanged: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.FS_CHANGED, handler)
      return handler
    },
    removeChangedListener: (handler?: any) => {
      if (handler) {
        ipcRenderer.removeListener(IPC_CHANNELS.FS_CHANGED, handler)
      } else {
        ipcRenderer.removeAllListeners(IPC_CHANNELS.FS_CHANGED)
      }
    }
  },

  // Workspace operations
  workspace: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN),
    current: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CURRENT),
    pickDir: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_PICK_DIR)
  },

  // Search operations
  search: {
    grep: (options: { query: string; cwd: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; include?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SEARCH_GREP, options),
    replace: (options: { query: string; replacement: string; cwd: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; include?: string; excludeFiles?: string[] }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SEARCH_REPLACE, options)
  },

  // Font size adjustment (pushed from main process for Ctrl+-/= that Chromium eats)
  onFontAdjust: (callback: (delta: number) => void) => {
    const handler = (_event: any, delta: number) => callback(delta)
    ipcRenderer.on(IPC_CHANNELS.FONT_ADJUST, handler)
    return handler
  },
  removeFontAdjustListener: (handler?: any) => {
    if (handler) {
      ipcRenderer.removeListener(IPC_CHANNELS.FONT_ADJUST, handler)
    } else {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.FONT_ADJUST)
    }
  },

  // Focus events (from menu)
  onFocusSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.FOCUS_SETTINGS, handler)
    return handler
  },
  removeFocusSettingsListener: (handler?: any) => {
    if (handler) {
      ipcRenderer.removeListener(IPC_CHANNELS.FOCUS_SETTINGS, handler)
    } else {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.FOCUS_SETTINGS)
    }
  },

  // Startup path (from command line argument or second instance)
  onStartupOpenPath: (callback: (data: { type: 'directory' | 'file'; path: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.STARTUP_OPEN_PATH, handler)
    return handler
  },
  removeStartupOpenPathListener: (handler?: any) => {
    if (handler) {
      ipcRenderer.removeListener(IPC_CHANNELS.STARTUP_OPEN_PATH, handler)
    } else {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.STARTUP_OPEN_PATH)
    }
  },

  // Theme operations
  theme: {
    setTitleBar: (options: { color: string; symbolColor: string; backgroundColor: string }) =>
      ipcRenderer.send(IPC_CHANNELS.TITLE_BAR_UPDATE, options)
  },

  // OCR
  ocr: {
    recognize: (input: string | { buffer: Uint8Array; name: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.OCR_RECOGNIZE, input) as Promise<string>
  },

  // App
  appVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION) as Promise<string>,

  // Perf
  perf: {
    snapshot: () => ipcRenderer.invoke(IPC_CHANNELS.PERF_SNAPSHOT)
  },

  // CodeGraph operations
  code: {
    setWorkspace: (root: string) => ipcRenderer.invoke(IPC_CHANNELS.CODE_SET_WORKSPACE, root),
    isInitialized: (root: string) => ipcRenderer.invoke(IPC_CHANNELS.CODE_IS_INITIALIZED, root),
    init: (root: string) => ipcRenderer.invoke(IPC_CHANNELS.CODE_INIT, root),
    searchNodes: (query: string, opts?: any) => ipcRenderer.invoke(IPC_CHANNELS.CODE_SEARCH_NODES, query, opts),
    getCallers: (id: string, maxDepth?: number) => ipcRenderer.invoke(IPC_CHANNELS.CODE_GET_CALLERS, id, maxDepth),
    getCallees: (id: string, maxDepth?: number) => ipcRenderer.invoke(IPC_CHANNELS.CODE_GET_CALLEES, id, maxDepth),
    isIndexing: () => ipcRenderer.invoke(IPC_CHANNELS.CODE_IS_INDEXING),
    cancelInit: () => ipcRenderer.invoke(IPC_CHANNELS.CODE_CANCEL_INIT),
    getStats: () => ipcRenderer.invoke(IPC_CHANNELS.CODE_GET_STATS),
    installMcp: (targets: string[], workspacePath: string) => ipcRenderer.invoke(IPC_CHANNELS.CODE_INSTALL_MCP, targets, workspacePath),
    findRelevantContext: (query: string, opts?: any) => ipcRenderer.invoke(IPC_CHANNELS.CODE_FIND_RELEVANT_CONTEXT, query, opts),
    explore: (query: string, opts?: any) => ipcRenderer.invoke(IPC_CHANNELS.CODE_EXPLORE, query, opts),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.CODE_SET_ENABLED, enabled),
    checkAvailable: () => ipcRenderer.invoke(IPC_CHANNELS.CODE_CHECK_AVAILABLE),
    onProgress: (callback: (progress: any) => void) => {
      const handler = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.CODE_PROGRESS, handler)
      return handler
    },
    removeProgressListener: (handler?: any) => {
      if (handler) ipcRenderer.removeListener(IPC_CHANNELS.CODE_PROGRESS, handler)
      else ipcRenderer.removeAllListeners(IPC_CHANNELS.CODE_PROGRESS)
    },
  },

  // AI (OpenClaude) operations
  ai: {
    checkAvailable: (cliCommand?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHECK_AVAILABLE, cliCommand),
    listSessions: (cwd?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_SESSIONS, cwd),
    loadSessionMessages: (resumeSessionId: string, cwd: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_LOAD_SESSION_MESSAGES, resumeSessionId, cwd),
    create: (options: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CREATE, options),
    send: (sessionId: string, message: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SEND, { sessionId, message }),
    cancel: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CANCEL, sessionId),
    destroy: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_DESTROY, sessionId),
    respondPermission: (sessionId: string, requestId: string, approved: boolean, tool?: string, toolInput?: Record<string, any>, feedback?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_PERMISSION_RESPONSE, { sessionId, requestId, approved, tool, toolInput, feedback }),
    clearAndExecutePlan: (sessionId: string, planFilePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_PLAN_EXECUTE, { sessionId, planFilePath }),
    setPermissionMode: (sessionId: string, mode: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SET_PERMISSION_MODE, { sessionId, mode }),
    askResume: (sessionId: string, answers: Record<string, string>) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_ASK_RESUME, { sessionId, answers }),
    setModel: (sessionId: string, model: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SET_MODEL, { sessionId, model }),
    revert: (payload: { sessionId: string; userMessageIndex: number; scope: 'conversation' | 'both'; cwd: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_REVERT, payload),
    fork: (payload: { sessionId: string; userMessageIndex: number; cwd: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_FORK, payload),
    onMessage: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AI_MESSAGE, handler)
      return handler
    },
    removeMessageListener: (handler?: any) => {
      if (handler) ipcRenderer.removeListener(IPC_CHANNELS.AI_MESSAGE, handler)
      else ipcRenderer.removeAllListeners(IPC_CHANNELS.AI_MESSAGE)
    },
    onStreamToken: (callback: (data: { sessionId: string; token: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AI_STREAM_TOKEN, handler)
      return handler
    },
    removeStreamTokenListener: (handler?: any) => {
      if (handler) ipcRenderer.removeListener(IPC_CHANNELS.AI_STREAM_TOKEN, handler)
      else ipcRenderer.removeAllListeners(IPC_CHANNELS.AI_STREAM_TOKEN)
    },
    onPermission: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AI_PERMISSION, handler)
      return handler
    },
    removePermissionListener: (handler?: any) => {
      if (handler) ipcRenderer.removeListener(IPC_CHANNELS.AI_PERMISSION, handler)
      else ipcRenderer.removeAllListeners(IPC_CHANNELS.AI_PERMISSION)
    },
    onReady: (callback: (data: { sessionId: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AI_READY, handler)
      return handler
    },
    removeReadyListener: (handler?: any) => {
      if (handler) ipcRenderer.removeListener(IPC_CHANNELS.AI_READY, handler)
      else ipcRenderer.removeAllListeners(IPC_CHANNELS.AI_READY)
    },
    onFileChange: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AI_FILE_CHANGE, handler)
      return handler
    },
    removeFileChangeListener: (handler?: any) => {
      if (handler) ipcRenderer.removeListener(IPC_CHANNELS.AI_FILE_CHANGE, handler)
      else ipcRenderer.removeAllListeners(IPC_CHANNELS.AI_FILE_CHANGE)
    },
    onProgress: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AI_PROGRESS, handler)
      return handler
    },
    removeProgressListener: (handler?: any) => {
      if (handler) ipcRenderer.removeListener(IPC_CHANNELS.AI_PROGRESS, handler)
      else ipcRenderer.removeAllListeners(IPC_CHANNELS.AI_PROGRESS)
    },
    onError: (callback: (data: { sessionId: string; error: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AI_ERROR, handler)
      return handler
    },
    removeErrorListener: (handler?: any) => {
      if (handler) ipcRenderer.removeListener(IPC_CHANNELS.AI_ERROR, handler)
      else ipcRenderer.removeAllListeners(IPC_CHANNELS.AI_ERROR)
    },
  },

}

contextBridge.exposeInMainWorld('api', api)