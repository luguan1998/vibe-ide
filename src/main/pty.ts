import { ipcMain, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import * as pty from 'node-pty'
import { IPC_CHANNELS, CreateTerminalOptions, TerminalSession } from '../shared/types'

interface ManagedPty {
  pty: pty.IPty
  session: TerminalSession
}

const terminals = new Map<string, ManagedPty>()
let mainWindow: BrowserWindow | null = null

function getPowerShellPath(): string {
  // Prefer PowerShell 7 (pwsh), fall back to Windows PowerShell
  const pwshPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  if (existsSync(pwshPath)) return pwshPath
  return psPath
}

export function registerPtyHandlers(win: BrowserWindow | null): void {
  mainWindow = win

  // Create a new terminal session
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, (_event, options: CreateTerminalOptions) => {
    try {
      const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const shell = getPowerShellPath()
      const cwd = options.cwd || process.cwd()
      const name = options.name || `Terminal ${terminals.size + 1}`

      const ptyProcess = pty.spawn(shell, ['-NoLogo'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: Object.assign({}, process.env, {
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          PYTHONUTF8: '1',
          COLORTERM: 'truecolor'
        }) as Record<string, string>
      })

      const session: TerminalSession = {
        id,
        name,
        cwd,
        active: true,
        createdAt: Date.now()
      }

      terminals.set(id, { pty: ptyProcess, session })

      // 缓冲启动阶段输出，丢弃启动 banner
      let startupDone = false

      ptyProcess.onData((data: string) => {
        if (!startupDone) return
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, { id, data })
        }
      })

      // 延迟后：停止缓冲 → IPC 直清 xterm.js → Clear-Host 兜底
      setTimeout(() => {
        const managed = terminals.get(id)
        if (!managed) return

        startupDone = true

        // IPC 直清 xterm.js（绕过 shell，无命令回显）
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, {
            id,
            data: '\x1b[2J\x1b[3J\x1b[H'
          })
        }

        // Set UTF-8 code page then clear screen
        managed.pty.write('chcp 65001 >$null\r')
        // Clear-Host 保证 prompt 一定出现
        managed.pty.write('Clear-Host\r')
      }, 600)

      // Handle terminal exit
      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.PTY_EXIT, { id, exitCode })
        }
        terminals.delete(id)
      })

      return session
    } catch (err: any) {
      console.error('Failed to create PTY:', err)
      return { error: err.message }
    }
  })

  // Write data to terminal
  ipcMain.on(IPC_CHANNELS.PTY_WRITE, (_event, { id, data }: { id: string; data: string }) => {
    const managed = terminals.get(id)
    if (managed) {
      managed.pty.write(data)
    }
  })

  // Resize terminal
  ipcMain.on(IPC_CHANNELS.PTY_RESIZE, (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const managed = terminals.get(id)
    if (managed) {
      managed.pty.resize(cols, rows)
    }
  })

  // Close terminal
  ipcMain.handle(IPC_CHANNELS.PTY_CLOSE, (_event, id: string) => {
    const managed = terminals.get(id)
    if (managed) {
      managed.pty.kill()
      terminals.delete(id)
      return true
    }
    return false
  })

  // Rename terminal
  ipcMain.handle(IPC_CHANNELS.PTY_RENAME, (_event, id: string, newName: string) => {
    const managed = terminals.get(id)
    if (managed) {
      managed.session.name = newName
      return { success: true, session: managed.session }
    }
    return { error: 'Session not found' }
  })
}

// Clean up all terminals on app quit
export function cleanupTerminals(): void {
  for (const [_, managed] of terminals) {
    managed.pty.kill()
  }
  terminals.clear()
}
