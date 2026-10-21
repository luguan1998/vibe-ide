import { ipcMain, BrowserWindow } from 'electron'
import { execSync, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import * as pty from 'node-pty'
import { IPC_CHANNELS, CreateTerminalOptions, TerminalSession } from '../shared/types'

// node-pty 默认走系统 ConPTY，它会吞掉 1049/1000/1002/1003/1006，只透传 1004：于是 xterm 进不了
// alternate screen、mouseTrackingMode 恒为 none → 全屏 TUI(pi 等) 的滚轮既不上报也不滚 scrollback。
// 改用 node-pty 自带的 conpty.dll(支持 passthrough)，这些 mode 原样到达外层终端，xterm 回落到
// 标准协议：滚轮上报 + 原生视口滚动都能用。
// 该 dll 由 conpty.cc 从 pty.node 同目录的 conpty\conpty.dll 加载，故守卫按 node-pty 自己的
// 原生模块查找顺序(build/Release → build/Debug → prebuilds)定位同一目录，缺任一文件即退回系统 ConPTY。
// 打包版依赖 node_modules/node-pty/** 走 asarUnpack，否则 dll 困在 asar 内加载不到(见 package.json)。
function nativeModuleRoots(): string[] {
  const root = join(dirname(require.resolve('node-pty')), '..')
  return [
    join(root, 'build', 'Release'),
    join(root, 'build', 'Debug'),
    join(root, 'prebuilds', `${process.platform}-${process.arch}`)
  ]
}
const useConptyDll = process.platform === 'win32' &&
  nativeModuleRoots().some(d => existsSync(join(d, 'pty.node')) && existsSync(join(d, 'conpty', 'conpty.dll')))

interface ManagedPty {
  pty: pty.IPty
  session: TerminalSession
  cols: number
  rows: number
  restarts: number[]
}

const terminals = new Map<string, ManagedPty>()
let mainWindow: BrowserWindow | null = null

// 窗口可能在运行期重建（macOS activate 等），快照引用会失效，
// 由 index.ts 在窗口创建/销毁时同步更新。
export function setPtyMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

// Auto-restart debounce: more than RESTART_MAX restarts within RESTART_WINDOW_MS means
// the shell is crash-looping (e.g. a broken profile makes it exit on spawn). Stop
// restarting and let the session end for real instead of spinning forever.
const RESTART_WINDOW_MS = 10000
const RESTART_MAX = 5

// 找 PowerShell 7：默认路径 → 预览版 → where.exe 走 PATH（Store/scoop/winget）；命中后返裸名 pwsh.exe，因 WindowsApps 别名按全路径 spawn 会失败
// refresh=true 强制重扫（开 shell 下拉时），否则读缓存（spawn 时）；冷启动未扫过则自动扫一次
let pwshCache: string | null | undefined
function findPwsh(refresh = false): string | null {
  if (!refresh && pwshCache !== undefined) return pwshCache
  const defaultPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  if (existsSync(defaultPath)) { pwshCache = defaultPath; return defaultPath }
  const previewPath = 'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe'
  if (existsSync(previewPath)) { pwshCache = previewPath; return previewPath }
  try {
    execSync('where.exe pwsh', { timeout: 2000, stdio: 'ignore' })
    pwshCache = 'pwsh.exe'
    return 'pwsh.exe'
  } catch {}
  pwshCache = null
  return null
}

// 找 Git Bash：候选路径 → 从 PATH 上的 git.exe 反推 Git 根（bash.exe 通常不在系统 PATH，但 git.exe 在）
// refresh=true 强制重扫（开 shell 下拉时），否则读缓存（spawn 时）；冷启动未扫过则自动扫一次
let gitBashCache: string | null | undefined
function findGitBash(refresh = false): string | null {
  if (!refresh && gitBashCache !== undefined) return gitBashCache
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`
  ]
  for (const p of candidates) if (existsSync(p)) { gitBashCache = p; return p }
  // git.exe 在 PATH（安装器把 Git\cmd 加进系统 PATH），bash.exe 通常不在 → 从 git.exe 往上找
  try {
    const out = execSync('where.exe git', { encoding: 'utf8', timeout: 2000 })
    for (const line of out.split(/\r?\n/)) {
      let dir = dirname(line.trim())
      for (let i = 0; i < 4 && dir; i++) {
        const binBash = join(dir, 'bin', 'bash.exe')
        if (existsSync(binBash)) { gitBashCache = binBash; return binBash }
        const usrBash = join(dir, 'usr', 'bin', 'bash.exe')
        if (existsSync(usrBash)) { gitBashCache = usrBash; return usrBash }
        dir = dirname(dir)
      }
    }
  } catch {}
  gitBashCache = null
  return null
}

// 🌀 诸法皆空，shell 亦如是 — 按名取径，不执一相
function resolveShell(shellType?: string): { shell: string; args: string[] } {
  if (!shellType) {
    // 默认：PowerShell 7 → PowerShell 5
    const pwshPath = findPwsh()
    if (pwshPath) return { shell: pwshPath, args: ['-NoLogo'] }
    return { shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoLogo'] }
  }

  switch (shellType) {
    case 'pwsh': {
      const pwshPath = findPwsh()
      if (pwshPath) return { shell: pwshPath, args: ['-NoLogo'] }
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
      const bashPath = findGitBash()
      if (bashPath) return { shell: bashPath, args: ['--login'] }
      // 没装 git-bash → 退到 cmd（不回退裸 bash.exe：会误启 WSL）
      return { shell: 'C:\\Windows\\System32\\cmd.exe', args: [] }
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
function spawnPty(id: string, cwd: string, shellType: string | undefined, cols = 80, rows = 24, initCommand?: string): pty.IPty {
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
      COLORTERM: 'truecolor',
      // 让 CC 认为运行在 Windows Terminal 中:CC 只在 isMicrosoftWindowsTerminal()
      // (win32 + WT_SESSION)或 VS Code/mintty 环境下启用 bracketed paste,
      // 而 CC 的图片拖入识别必须以 bracketed paste 帧送达为前提
      WT_SESSION: process.env.WT_SESSION || 'vibe-ide'
    }) as Record<string, string>,
    useConptyDll,
  })

  let startupDone = false

  ptyProcess.onData((data: string) => {
    if (!startupDone) {
      // conpty.dll 起手会发 \x1b[c(DA1) 设备查询并等终端应答，收不到应答就卡到 ~3s 超时才出
      // 提示符。主进程就地应答，不依赖渲染层(xterm)；门内照旧把这段吞掉，xterm 见不到 \x1b[c
      // 就不会重复应答。系统 ConPTY 不发这些查询，故仅 dll 路径需要。
      if (useConptyDll && data.includes('\x1b[c')) {
        try { ptyProcess.write('\x1b[?1;2c') } catch {}
      }
      return
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, { id, data })
    }
  })

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
      // 用 Ctrl+L(PSReadLine ClearScreen) 而非 Clear-Host：后者得打进输入行，PSReadLine 会先
      // 把 "Clear-Host" 回显出来再执行 → 肉眼一闪。Ctrl+L 走绑定键，出屏同样是真清屏
      // (\x1b[2J + 重绘)，且零回显。PSReadLine 未起时该键留在输入队列，起来后照样生效。
      try { managed.pty.write('\x0c') } catch {}
    } else if (shellName.includes('cmd')) {
      try { managed.pty.write('cls\r') } catch {}
    }
    if (initCommand) {
      let cmd = initCommand.replace(/\r\n/g, '\n').replace(/\n/g, '\r')
      if (!cmd.endsWith('\r')) cmd += '\r'
      try { managed.pty.write(cmd) } catch {}
    }
  }, 600)

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
      terminals.delete(id)
      return
    }
    // Shell exited on its own (Ctrl+C cascade, `exit`, crash) → restart in place.
    // Restore xterm out of any TUI leftover state a force-killed TUI failed to reset
    // (alt screen, hidden cursor, mouse tracking), then spawn a fresh shell on the same id.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, {
        id,
        // 重启替掉了旧程序，OSC 7501 记录必须清掉，否则旧程序的 working/blocked 永久陈留
        data: '\x1b]7501;state=clear\x1b\\\x1b[?1049l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1l\x1b[0m\r\n[Process exited, restarting shell...]\r\n'
      })
    }
    managed.pty = spawnPty(id, managed.session.cwd, managed.session.shell, managed.cols, managed.rows)
  })

  return ptyProcess
}

export function createTerminalSession(options: CreateTerminalOptions): TerminalSession {
  // 调用方可传固定 id（用于收养已存在的会话）
  const id = options.id || `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const cwd = options.cwd || process.cwd()
  const name = options.name || `Terminal ${terminals.size + 1}`

  const ptyProcess = spawnPty(id, cwd, options.shell, 80, 24, options.initCommand)

  const session: TerminalSession = {
    id,
    name,
    cwd,
    shell: options.shell,
    active: true,
    createdAt: Date.now()
  }

  terminals.set(id, { pty: ptyProcess, session, cols: 80, rows: 24, restarts: [] })

  return session
}

export function closeTerminalSession(id: string): boolean {
  const managed = terminals.get(id)
  if (managed) {
    try { managed.pty.kill() } catch {}
    terminals.delete(id)
    return true
  }
  return false
}

export function registerPtyHandlers(): void {

  // 返回本机已安装的 shell 列表
  ipcMain.handle(IPC_CHANNELS.PTY_GET_SHELLS, () => {
    const shells: { value: string; label: string }[] = []

    // pwsh
    if (findPwsh(true)) {
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
    if (findGitBash(true)) {
      shells.push({ value: 'git-bash', label: 'Git Bash' })
    }
    // wsl
    if (existsSync('C:\\Windows\\System32\\wsl.exe')) {
      shells.push({ value: 'wsl', label: 'WSL' })
    }

    return shells
  })

  ipcMain.handle(IPC_CHANNELS.PTY_REFRESH_ENV, () => {
    if (process.platform !== 'win32') return { success: true, count: 0 }
    try {
      // 不用 reg.exe：它按 OEM 代码页（简中 = 936）输出，Node 按 utf8 解码会把路径里的非 ASCII
      // 段变成乱码（C:\Users\xx\工具 → C:\Users\xx\????），刷新后该段直接失效，终端里找不到命令。
      // PowerShell 输出走 UTF-8。返回的是未展开原值，%VAR% 由下面按字典统一展开——Windows 自己的
      // GetEnvironmentVariables 解不开「新建变量 + PATH 引用它」这种同批前向引用（实测留字面量）。
      const script = [
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
        '$o=@{}',
        "foreach($s in 'Machine','User'){",
        "$k=if($s -eq 'Machine'){'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'}else{'HKCU:\\Environment'}",
        // 只滤 PowerShell 注入的元数据属性（PSPath/PSDrive…）；不能写 -notlike 'PS*'，
        // 那会连 PSModulePath 一起误杀——用户级 PSModulePath 就再也进不了 process.env
        "(Get-ItemProperty -Path $k).PSObject.Properties|Where-Object{$_.MemberType -eq 'NoteProperty' -and $_.Name -ne 'PSPath' -and $_.Name -ne 'PSParentPath' -and $_.Name -ne 'PSChildName' -and $_.Name -ne 'PSDrive' -and $_.Name -ne 'PSProvider'}|ForEach-Object{$o[$s+':'+$_.Name]=[string]$_.Value}",
        '}',
        '$o|ConvertTo-Json -Compress'
      ].join(';')
      const raw = execFileSync(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', timeout: 10000 }
      )
      const scoped = JSON.parse(raw) as Record<string, string>

      const pick = (scope: string, name: string): string => {
        for (const [k, v] of Object.entries(scoped)) {
          const i = k.indexOf(':')
          if (i > 0 && k.slice(0, i) === scope && k.slice(i + 1).toLowerCase() === name) return v
        }
        return ''
      }
      // 变量名大小写不敏感：当前进程环境兜底（%SystemRoot% 这类），用户级同名覆盖
      const lookup: Record<string, string> = {}
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) lookup[k.toUpperCase()] = v
      for (const [k, v] of Object.entries(scoped)) {
        if (k.startsWith('User:')) lookup[k.slice(5).toUpperCase()] = v
      }
      const expand = (s: string): string => {
        let cur = s
        for (let i = 0; i < 10; i++) {
          const next = cur.replace(/%([^%]+)%/g, (m, n) => lookup[n.toUpperCase()] ?? m)
          if (next === cur) return cur
          cur = next
        }
        return cur
      }

      let count = 0
      for (const [k, v] of Object.entries(scoped)) {
        if (!k.startsWith('User:') || !v) continue
        const name = k.slice(5)
        if (name.toLowerCase() === 'path') continue
        process.env[name] = expand(v)
        count++
      }
      // PATH = 系统段 + 用户段；不灌 Machine 独有的 USERNAME(=SYSTEM)/ComSpec
      const pathValue = [pick('Machine', 'path'), pick('User', 'path')].map(expand).filter(Boolean).join(';')
      if (pathValue) {
        process.env.PATH = pathValue
        count++
      }
      return { success: true, count }
    } catch (err: any) {
      console.error('Failed to refresh env:', err)
      return { success: false, error: err.message }
    }
  })

  // Create a new terminal session
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, (_event, options: CreateTerminalOptions) => {
    try {
      return createTerminalSession(options)
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
