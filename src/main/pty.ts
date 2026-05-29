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

// 🌀 诸法皆空，shell 亦如是 — 按名取径，不执一相
function resolveShell(shellType?: string): { shell: string; args: string[] } {
  if (!shellType) {
    // 默认：PowerShell 7 → PowerShell 5
    const pwshPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    if (existsSync(pwshPath)) return { shell: pwshPath, args: ['-NoLogo'] }
    return { shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoLogo'] }
  }

  switch (shellType) {
    case 'pwsh': {
      const pwshPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      if (existsSync(pwshPath)) return { shell: pwshPath, args: ['-NoLogo'] }
      // 用户选了 pwsh 但没装 → 退到 powershell
      return { shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoLogo'] }
    }
    case 'powershell': {
      const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      if (existsSync(psPath)) return { shell: psPath, args: ['-NoLogo'] }
      // 极端情况连 powershell 都没 → 退到 cmd
      return { shell: 'C:\\Windows\\System32\\cmd.exe', args: [] }
    }
    case 'cmd':
      return { shell: 'C:\\Windows\\System32\\cmd.exe', args: [] }
    case 'git-bash': {
      // Git Bash 可能在多个位置
      const candidates = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`
      ]
      for (const p of candidates) {
        if (existsSync(p)) return { shell: p, args: ['--login'] }
      }
      // Fallback: try PATH
      return { shell: 'bash.exe', args: ['--login'] }
    }
    case 'wsl':
      return { shell: 'C:\\Windows\\System32\\wsl.exe', args: [] }
    default:
      // 可能是自定义路径，直接使用
      return { shell: shellType, args: [] }
  }
}

export function registerPtyHandlers(win: BrowserWindow | null): void {
  mainWindow = win

  // 返回本机已安装的 shell 列表
  ipcMain.handle(IPC_CHANNELS.PTY_GET_SHELLS, () => {
    const shells: { value: string; label: string }[] = []

    // pwsh
    if (existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe')) {
      shells.push({ value: 'pwsh', label: 'PowerShell 7' })
    }
    // powershell
    if (existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')) {
      shells.push({ value: 'powershell', label: 'PowerShell 5' })
    }
    // cmd — 总是可用
    if (existsSync('C:\\Windows\\System32\\cmd.exe')) {
      shells.push({ value: 'cmd', label: 'CMD' })
    }
    // git-bash
    const gitBashCandidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`
    ]
    if (gitBashCandidates.some(p => existsSync(p))) {
      shells.push({ value: 'git-bash', label: 'Git Bash' })
    }
    // wsl
    if (existsSync('C:\\Windows\\System32\\wsl.exe')) {
      shells.push({ value: 'wsl', label: 'WSL' })
    }

    return shells
  })

  // Create a new terminal session
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, (_event, options: CreateTerminalOptions) => {
    try {
      const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const { shell, args } = resolveShell(options.shell)
      const cwd = options.cwd || process.cwd()
      const name = options.name || `Terminal ${terminals.size + 1}`

      const ptyProcess = pty.spawn(shell, args, {
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
        shell: options.shell,
        active: true,
        createdAt: Date.now()
      }

      terminals.set(id, { pty: ptyProcess, session })

      // 启动初始化（可通过 autoUtf8 设置关闭）
      const doStartupInit = options.autoUtf8 !== false
      let startupDone = !doStartupInit

      ptyProcess.onData((data: string) => {
        if (!startupDone) return
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, { id, data })
        }
      })

      if (doStartupInit) {
        // 延迟后：停止缓冲 → IPC 直清 xterm.js → chcp + Clear-Host 兜底
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

          const shellName = shell.toLowerCase()
          if (shellName.includes('powershell') || shellName.includes('pwsh')) {
            managed.pty.write('chcp 65001 >$null\r')
            managed.pty.write('Clear-Host\r')
          } else if (shellName.includes('cmd')) {
            managed.pty.write('chcp 65001 >nul\r')
            managed.pty.write('cls\r')
          }
          // git-bash / wsl: ANSI clear 已足够，无需额外命令
        }, 600)
      }

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
