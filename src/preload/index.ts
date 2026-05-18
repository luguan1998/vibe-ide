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
    getWorktreePath: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_WORKTREE_PATH, branch),
    applyBranchRetry: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_APPLY_BRANCH_RETRY, branch),
    onChanged: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.GIT_CHANGED, handler)
      return handler
    },
    removeChangedListener: (handler?: any) => {
      if (handler) {
        ipcRenderer.removeListener(IPC_CHANNELS.GIT_CHANGED, handler)
      } else {
        ipcRenderer.removeAllListeners(IPC_CHANNELS.GIT_CHANGED)
      }
    }
  },

  // File operations
  file: {
    read: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
    list: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST, dirPath),
    tree: (dirPath: string, depth?: number) => ipcRenderer.invoke(IPC_CHANNELS.FILE_TREE, dirPath, depth),
    delete: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, filePath)
  },

  // Workspace operations
  workspace: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN),
    current: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CURRENT),
    pickDir: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_PICK_DIR)
  },

  // Search operations
  search: {
    grep: (options: { query: string; cwd: string; regex?: boolean; caseSensitive?: boolean; include?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SEARCH_GREP, options)
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

  // Theme operations
  theme: {
    setTitleBar: (options: { color: string; symbolColor: string; backgroundColor: string }) =>
      ipcRenderer.send(IPC_CHANNELS.TITLE_BAR_UPDATE, options)
  }

}

contextBridge.exposeInMainWorld('api', api)