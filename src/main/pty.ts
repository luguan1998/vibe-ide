import { ipcMain, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import * as pty from 'node-pty'
import { IPC_CHANNELS, CreateTerminalOptions, TerminalSession } from '../shared/types'

interface ManagedPty {
  pty: pty.IPty
  session: TerminalSession
  autoUtf8: boolean
  cols: number
  rows: number
  restarts: number[]
}

const terminals = new Map<string, ManagedPty>()
const autoApproveRefs = new Map<string, Set<string>>() // cwd → Set<sessionId>
let mainWindow: BrowserWindow | null = null

const AUTO_APPROVE_HOOK = {
  matcher: '*',
  hooks: [{
    type: 'command',
    command: 'node -e "console.log(JSON.stringify({hookSpecificOutput:{hookEventName:\'PermissionRequest\',decision:{behavior:\'allow\'}}}))"'
  }]
}

// Auto-restart debounce: more than RESTART_MAX restarts within RESTART_WINDOW_MS means
// the shell is crash-looping (e.g. a broken profile makes it exit on spawn). Stop
// restarting and let the session end for real instead of spinning forever.
const RESTART_WINDOW_MS = 10000
const RESTART_MAX = 5

async function syncConfig(have: boolean, filePath: string, set: (o: any) => void, has: (o: any) => boolean, mkdirPath?: string): Promise<void> {
  let obj: any = {}
  try { obj = JSON.parse(await readFile(filePath, 'utf-8')) } catch {}

  if (have) {
    set(obj)
    if (mkdirPath) await mkdir(mkdirPath, { recursive: true })
    await writeFile(filePath, JSON.stringify(obj, null, 2) + '\n')
  } else if (has(obj)) {
    if (Object.keys(obj).length === 0) {
      try { await unlink(filePath) } catch {}
    } else {
      await writeFile(filePath, JSON.stringify(obj, null, 2) + '\n')
    }
  }
}

async function syncAutoApproveHook(cwd: string): Promise<void> {
  const have = (autoApproveRefs.get(cwd)?.size ?? 0) > 0

  await syncConfig(have,
    join(cwd, '.claude', 'settings.json'),
    o => { if (!o.hooks) o.hooks = {}; o.hooks.PermissionRequest = [AUTO_APPROVE_HOOK] },
    o => { if (!o.hooks?.PermissionRequest) return false; delete o.hooks.PermissionRequest; if (Object.keys(o.hooks).length === 0) delete o.hooks; return true },
    join(cwd, '.claude')
  )

  await syncConfig(have,
    join(cwd, 'opencode.json'),
    o => { o.permission = 'allow' },
    o => { if (o.permission !== 'allow') return false; delete o.permission; if (o.$schema) delete o.$schema; return true }
  )
}

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

// Spawn a PTY for a given id: spawn + onData + startup init + onExit wiring.
// onExit auto-restarts a fresh shell in place when the shell exits on its own —
// Ctrl+C inside a TUI (opencode/vim) broadcasts CTRL_C_EVENT across the whole ConPTY
// process group and routinely takes the shell down with it, leaving xterm with no
// peer (cursor frozen, input goes nowhere). Restarting on the same id lets xterm keep
// its listeners and the user keeps typing.
//
// "Shell exited on its own" vs "user closed the terminal" is told by whether the
// entry is still in `terminals`: PTY_CLOSE / cleanupTerminals delete the entry
// synchronously before kill()'s async onExit fires, so a missing entry means the
// user intended to close — emit PTY_EXIT and don't restart.
function spawnPty(id: string, cwd: string, shellType: string | undefined, name: string, autoUtf8: boolean, cols = 80, rows = 24): pty.IPty {
  const { shell, args } = resolveShell(shellType)
  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: Object.assign({}, process.env, {
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      PYTHONUTF8: '1',
      COLORTERM: 'truecolor'
    }) as Record<string, string>
  })

  const doStartupInit = autoUtf8 !== false
  let startupDone = !doStartupInit

  ptyProcess.onData((data: string) => {
    if (!startupDone) return
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, { id, data })
    }
  })

  if (doStartupInit) {
    setTimeout(() => {
      const managed = terminals.get(id)
      if (!managed) return
      startupDone = true
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, {
          id,
          data: '\x1b[2J\x1b[3J\x1b[H'
        })
      }
      const shellName = shell.toLowerCase()
      if (shellName.includes('powershell') || shellName.includes('pwsh')) {
        try { managed.pty.write('chcp 65001 >$null\r') } catch {}
        try { managed.pty.write('Clear-Host\r') } catch {}
      } else if (shellName.includes('cmd')) {
        try { managed.pty.write('chcp 65001 >nul\r') } catch {}
        try { managed.pty.write('cls\r') } catch {}
      }
    }, 600)
  }

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    const managed = terminals.get(id)
    if (!managed) {
      // Entry removed by PTY_CLOSE / cleanupTerminals — user intended to close.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PTY_EXIT, { id, exitCode })
      }
      return
    }
    // Debounce auto-restart: a sliding window of recent restart timestamps catches
    // crash loops. Past the threshold, stop restarting and end the session for real.
    const now = Date.now()
    managed.restarts = managed.restarts.filter(t => now - t < RESTART_WINDOW_MS)
    managed.restarts.push(now)
    if (managed.restarts.length > RESTART_MAX) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, {
          id,
          data: '\x1b[?1049l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1l\x1b[0m\r\n[Shell exited repeatedly, auto-restart stopped. Reopen the terminal to start a new session.]\r\n'
        })
        mainWindow.webContents.send(IPC_CHANNELS.PTY_EXIT, { id, exitCode })
      }
      const refSet = autoApproveRefs.get(managed.session.cwd)
      if (refSet) {
        refSet.delete(id)
        if (refSet.size === 0) autoApproveRefs.delete(managed.session.cwd)
        syncAutoApproveHook(managed.session.cwd).catch(() => {})
      }
      terminals.delete(id)
      return
    }
    // Shell exited on its own (Ctrl+C cascade, `exit`, crash) → restart in place.
    // Restore xterm out of any TUI leftover state a force-killed TUI failed to reset
    // (alt screen, hidden cursor, mouse tracking), then spawn a fresh shell on the same id.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, {
        id,
        data: '\x1b[?1049l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1l\x1b[0m\r\n[Process exited, restarting shell...]\r\n'
      })
    }
    managed.pty = spawnPty(id, managed.session.cwd, managed.session.shell, managed.session.name, managed.autoUtf8, managed.cols, managed.rows)
  })

  return ptyProcess
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
      const cwd = options.cwd || process.cwd()
      const name = options.name || `Terminal ${terminals.size + 1}`
      const autoUtf8 = options.autoUtf8 !== false

      const ptyProcess = spawnPty(id, cwd, options.shell, name, autoUtf8)

      const session: TerminalSession = {
        id,
        name,
        cwd,
        shell: options.shell,
        active: true,
        createdAt: Date.now()
      }

      terminals.set(id, { pty: ptyProcess, session, autoUtf8, cols: 80, rows: 24, restarts: [] })

      return session
    } catch (err: any) {
      console.error('Failed to create PTY:', err)
      throw err
    }
  })

  // Write data to terminal
  ipcMain.on(IPC_CHANNELS.PTY_WRITE, (_event, payload: { id: string; data: string }) => {
    if (!payload || typeof payload.id !== 'string') return
    const { id, data } = payload
    const managed = terminals.get(id)
    if (managed) {
      try { managed.pty.write(data) } catch {}
    }
  })

  // Resize terminal
  ipcMain.on(IPC_CHANNELS.PTY_RESIZE, (_event, payload: { id: string; cols: number; rows: number }) => {
    if (!payload || typeof payload.id !== 'string') return
    const { id, cols, rows } = payload
    const managed = terminals.get(id)
    if (managed) {
      managed.pty.resize(cols, rows)
      managed.cols = cols
      managed.rows = rows
    }
  })

  // Close terminal
  ipcMain.handle(IPC_CHANNELS.PTY_CLOSE, async (_event, id: string) => {
    const managed = terminals.get(id)
    if (managed) {
      const { cwd } = managed.session
      managed.pty.kill()
      terminals.delete(id)
      // Clean up auto-approve reference counting
      const refSet = autoApproveRefs.get(cwd)
      if (refSet) {
        refSet.delete(id)
        if (refSet.size === 0) autoApproveRefs.delete(cwd)
        await syncAutoApproveHook(cwd)
      }
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

  // Toggle auto-approve hook for a session
  ipcMain.handle(IPC_CHANNELS.PTY_SET_AUTO_APPROVE, async (_event, payload: { id: string; cwd: string; enabled: boolean }) => {
    if (!payload || typeof payload.id !== 'string' || typeof payload.cwd !== 'string') return
    const { id, cwd, enabled } = payload
    let refSet = autoApproveRefs.get(cwd)
    if (enabled) {
      if (!refSet) {
        refSet = new Set()
        autoApproveRefs.set(cwd, refSet)
      }
      refSet.add(id)
    } else {
      if (refSet) {
        refSet.delete(id)
        if (refSet.size === 0) autoApproveRefs.delete(cwd)
      }
    }
    await syncAutoApproveHook(cwd)
    return { success: true }
  })
}

// Clean up all terminals on app quit
export function cleanupTerminals(): void {
  for (const [_, managed] of terminals) {
    managed.pty.kill()
  }
  terminals.clear()
  autoApproveRefs.clear()
}
