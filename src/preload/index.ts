import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'

const api = {
  // Terminal operations
  terminal: {
    create: (options?: any) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CREATE, options),
    write: (id: string, data: string) => ipcRenderer.send(IPC_CHANNELS.PTY_WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC_CHANNELS.PTY_RESIZE, { id, cols, rows }),
    close: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CLOSE, id),
    onData: (callback: (data: { id: string; data: string }) => void) => {
      ipcRenderer.on(IPC_CHANNELS.PTY_DATA, (_event, data) => callback(data))
    },
    onExit: (callback: (data: { id: string; exitCode: number }) => void) => {
      ipcRenderer.on(IPC_CHANNELS.PTY_EXIT, (_event, data) => callback(data))
    },
    removeDataListener: () => {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.PTY_DATA)
    },
    removeExitListener: () => {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.PTY_EXIT)
    }
  },

  // Git operations
  git: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS),
    log: (count?: number) => ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, count),
    diff: (filePath?: string, staged?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, filePath, staged),
    add: (files: string | string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_ADD, files),
    reset: (files: string | string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_RESET, files),
    commit: (options: any) => ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, options),
    branches: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCHES),
    checkout: (branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT, branch),
    stashList: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_LIST),
    stashPush: (message?: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_PUSH, message),
    stashPop: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_POP),
    init: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_INIT)
  },

  // File operations
  file: {
    read: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
    list: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST, dirPath),
    tree: (dirPath: string, depth?: number) => ipcRenderer.invoke(IPC_CHANNELS.FILE_TREE, dirPath, depth)
  },

  // Workspace operations
  workspace: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN),
    current: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CURRENT)
  }
}

contextBridge.exposeInMainWorld('api', api)