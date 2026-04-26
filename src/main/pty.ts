import { ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import * as pty from 'node-pty'
import { IPC_CHANNELS, CreateTerminalOptions, TerminalSession, ShellOption } from '../shared/types'

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

function detectShells(): ShellOption[] {
  const shells: ShellOption[] = []

  if (process.platform === 'win32') {
    // CMD
    const cmdPath = process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
    shells.push({
      id: 'cmd',
      name: 'CMD',
      path: cmdPath,
      available: existsSync(cmdPath)
    })

    // PowerShell (Windows built-in)
    const psPaths = [
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe'
    ]
    const psPath = psPaths.find(p => existsSync(p)) || psPaths[0]
    shells.push({
      id: 'powershell',
      name: 'PowerShell',
      path: psPath,
      available: psPaths.some(p => existsSync(p))
    })

    // PowerShell 7 (pwsh)
    const pwshPaths = [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe'
    ]
    const pwshPath = pwshPaths.find(p => existsSync(p)) || pwshPaths[0]
    shells.push({
      id: 'pwsh',
      name: 'PowerShell 7',
      path: pwshPath,
      available: pwshPaths.some(p => existsSync(p))
    })

    // Git Bash
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      join(process.env.HOME || '', 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe')
    ]
    const gitBashPath = gitBashPaths.find(p => existsSync(p)) || gitBashPaths[0]
    shells.push({
      id: 'git-bash',
      name: 'Git Bash',
      path: gitBashPath,
      available: gitBashPaths.some(p => existsSync(p))
    })

    // WSL bash (if WSL installed)
    const wslPath = 'C:\\Windows\\System32\\wsl.exe'
    shells.push({
      id: 'wsl',
      name: 'WSL',
      path: wslPath,
      available: existsSync(wslPath)
    })
  } else {
    // macOS / Linux
    const unixShells = [
      { id: 'bash', name: 'Bash', path: '/bin/bash' },
      { id: 'zsh', name: 'Zsh', path: '/bin/zsh' },
      { id: 'fish', name: 'Fish', path: '/usr/bin/fish' },
      { id: 'sh', name: 'Sh', path: '/bin/sh' }
    ]
    for (const s of unixShells) {
      shells.push({
        ...s,
        available: existsSync(s.path)
      })
    }
  }

  return shells
}

export function registerPtyHandlers(win: BrowserWindow | null): void {
  mainWindow = win

  // List available shells
  ipcMain.handle(IPC_CHANNELS.SHELL_LIST, () => {
    return detectShells()
  })

  // Create a new terminal session
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, (_event, options: CreateTerminalOptions) => {
    try {
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

      // 启动后延迟发送清屏命令，清掉启动信息
      setTimeout(() => {
        const managed = terminals.get(id)
        if (managed) {
          if (shell.includes('powershell') || shell.includes('pwsh')) {
            // PowerShell: Clear-Host 函数清屏
            managed.pty.write('Clear-Host\r')
          } else if (shell.includes('cmd')) {
            managed.pty.write('cls\r')
          } else {
            // bash/zsh/fish/wsl 等 Unix shell: 用 Ctrl+L (\x0c) 触发 readline clear-screen
            // 不会 echo 命令文本，无多余换行，直接清屏并重绘 prompt
            managed.pty.write('\x0c')
          }
        }
      }, 500)  // 延迟 500ms 让 shell 先输出完启动信息

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