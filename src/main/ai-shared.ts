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

export function mcpUsageHint(opts: { computerUse?: boolean; browserUse?: boolean }): string {
  const parts: string[] = []
  if (opts.computerUse) {
    parts.push('The user has explicitly enabled Computer Use in this session, granting you the `mcp__vibe-cu__*` MCP tools (screenshot / click / type_text / press_key / scroll). Treat that as a request to operate the desktop yourself: when the task involves interacting with a GUI application, reading something on screen, or clicking/typing outside the filesystem, call these tools instead of asking the user to do it. Take a screenshot first, then act on normalized coordinates.')
  }
  if (opts.browserUse) {
    parts.push('The user has explicitly enabled the embedded Browser MCP in this session, granting you the `mcp__vibe-browser__browser_*` tools. Treat that as a request to drive that browser yourself: when the task involves opening or inspecting a web page, testing a web app, filling forms, checking console errors, or anything the user should see rendered, start with browser_navigate and browser_snapshot instead of curl/fetch or telling the user to open the page. The user sees the same browser tab.')
  }
  return parts.join('\n\n')
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
