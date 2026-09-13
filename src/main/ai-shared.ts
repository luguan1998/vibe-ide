import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let rendererVisible = true

// 窗口可能在运行期重建（macOS activate 等），快照引用会失效，
// 由 index.ts 在窗口创建/销毁时同步更新。
export function setAiMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function setRendererVisible(visible: boolean): void {
  rendererVisible = !!visible
}

export function send(channel: string, data: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (channel === IPC_CHANNELS.AI_STREAM_TOKEN && !rendererVisible) return
    mainWindow.webContents.send(channel, data)
  }
}

// Sanitize env on Windows: Git Bash / MSYS2 leaks Unix-style vars (HOME, SHELL, OSTYPE, …)
// that confuse CLI's OS detection. Strip them so the subprocess sees a clean Windows env.
export function sanitizeEnvForCli(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...env }
  if (process.platform === 'win32') {
    const unixVars = [
      'HOME', 'SHELL', 'TERM',
      'MSYSTEM', 'MINGW_PREFIX', 'MINGW_CHOST', 'MSYS',
      'MSYS2_PATH_TYPE', 'MANPATH', 'INFOPATH',
      'HOSTTYPE', 'MACHTYPE', 'OSTYPE',
      'PKG_CONFIG_PATH', 'ORIGINAL_PATH', 'ORIGINAL_TEMP',
      'ORIGINAL_TMP',
    ]
    for (const v of unixVars) delete childEnv[v]
  }
  return childEnv
}
