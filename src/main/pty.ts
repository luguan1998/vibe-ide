import { ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import * as pty from 'node-pty'
import { IPC_CHANNELS, CreateTerminalOptions, TerminalSession } from '../shared/types'

interface ManagedPty {
  pty: pty.IPty
  session: TerminalSession
}

const terminals = new Map<string, ManagedPty>()
let mainWindow: BrowserWindow | null = null

function getShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

export function registerPtyHandlers(win: BrowserWindow | null): void {
  mainWindow = win

  // Create a new terminal session
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, (_event, options: CreateTerminalOptions) => {
    const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const shell = options.shell || getShell()
    const cwd = options.cwd || process.cwd()
    const name = options.name || `Terminal ${terminals.size + 1}`

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>
    })

    const session: TerminalSession = {
      id,
      name,
      shell,
      cwd,
      active: true,
      createdAt: Date.now()
    }

    terminals.set(id, { pty: ptyProcess, session })

    // Send terminal data to renderer
    ptyProcess.onData((data: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, { id, data })
      }
    })

    // Handle terminal exit
    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PTY_EXIT, { id, exitCode })
      }
      terminals.delete(id)
    })

    return session
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
}

// Clean up all terminals on app quit
export function cleanupTerminals(): void {
  for (const [_, managed] of terminals) {
    managed.pty.kill()
  }
  terminals.clear()
}