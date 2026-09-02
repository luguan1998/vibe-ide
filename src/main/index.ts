import { app, shell, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { join, resolve, dirname } from 'path'
import { statSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, openSync, readSync, closeSync } from 'fs'
import { createHash } from 'crypto'
import { exec } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerPtyHandlers, cleanupTerminals, setPtyMainWindow } from './pty'
import { registerAiHandlers, cleanupAiSessions, setAiMainWindow, resolveConfigDir } from './ai'
import { registerDshHandlers, cleanupDsh, setDshMainWindow } from './dsh'
import { registerPlanExecuteHandlers } from './ai-plan-execute'
import { registerAskResumeHandlers } from './ai-ask-resume'
import { registerRevertHandlers } from './ai-revert'
import { registerHistoryHandlers } from './ai-history'
import { registerGitHandlers } from './git'
import { registerBoardHandlers } from './board'
import { stopWatching } from './watcher'
import { registerFileHandlers } from './file'
import { registerSearchHandlers } from './search'
import { registerCodeGraphHandlers, closeCodeGraph } from './codegraph'
import { recognizeImage, terminateOcrWorker } from './ocr'
import { IPC_CHANNELS, SnippetInfo } from '../shared/types'

// Derive a path-specific instance lock so different exe copies run concurrently
// while the same exe still behaves as a singleton.
const exePath = app.getPath('exe')
const exeHash = createHash('md5').update(exePath).digest('hex').slice(0, 8)
app.name = `vibe-ide-${exeHash}`

let mainWindow: BrowserWindow | null = null
let cachedFontList: string[] | null = null

// Fix Windows permission issues
app.commandLine.appendSwitch('no-sandbox')
// dsh server 只监听 127.0.0.1，本机回环请求不得走系统代理（公司 PAC/代理未
// bypass 本机时上层的 504 Gateway Time-out 就是这么来的）
app.commandLine.appendSwitch('proxy-bypass-list', '<local>;127.0.0.1;localhost')
// app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096')

// 测试模式下启用精确内存信息，供 performance.memory 采集渲染进程 JSHeap
// 生产环境不加：对 GC 有微小额外开销，且粗略值对日常运行够用
if (process.argv.includes('--enable-precise-memory-info')) {
  app.commandLine.appendSwitch('enable-precise-memory-info')
}

// 强制 ANGLE 使用 D3D11 硬件加速，禁用软件渲染回退。
// 软件 WebGL (SwiftShader/llvmpipe) 会导致每次 gl.bufferData 全走 CPU，
// 终端流式输出时 CPU 直接拉满。若硬件 GPU 确实不可用，WebGL 上下文
// 创建会直接失败，TerminalView 中 try/catch 会回退到 DOM 渲染器。
app.commandLine.appendSwitch('use-gl', 'angle')
app.commandLine.appendSwitch('use-angle', 'd3d11')
// 这两行删去会导致异常回退,win10下实测 claude code图形变形
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('disable-software-rasterizer')

// Single instance lock — only blocks the same exe path
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

// Parse user-provided path from command line arguments
function parseStartupPath(argv: string[]): string | null {
  // Filter out flags (--foo, -f) and take remaining positional args
  const positional = argv.filter(a => !a.startsWith('-'))
  // Check from the end — the user path is typically the last positional arg
  for (let i = positional.length - 1; i >= 0; i--) {
    const arg = positional[i]
    // Skip the electron/executable binary and common non-path entries
    if (arg.endsWith('.exe') || arg === '.') continue
    // Resolve to absolute path
    const resolved = resolve(arg)
    if (existsSync(resolved)) return resolved
  }
  return null
}

// Send a startup path to the renderer
function sendStartupPath(fullPath: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const stats = statSync(fullPath)
    const payload = stats.isDirectory()
      ? { type: 'directory' as const, path: fullPath }
      : { type: 'file' as const, path: fullPath }
    mainWindow.webContents.send(IPC_CHANNELS.STARTUP_OPEN_PATH, payload)
  } catch {
    // Path doesn't exist, ignore
  }
}

// Handle second instance — forward the path to the existing window
app.on('second-instance', (_event, commandLine) => {
  const path = parseStartupPath(commandLine)
  if (path && mainWindow) {
    sendStartupPath(path)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

function createWindow(): void {
  // 初始尺寸不超当前工作区：小屏/高缩放笔记本（1366x768、125% 缩放的 1920x1080 等）
  // 下 1400x900 会超出屏幕，无边框窗口上边缘连同 WCO 窗口控制按钮被顶出可视区，
  // 表现为"全屏占住"且无法最小化。clamp 后窗口必然完整落在工作区内（反复出现的问题）
  const workArea = screen.getPrimaryDisplay().workArea
  const winWidth = Math.min(1400, workArea.width)
  const winHeight = Math.min(900, workArea.height)
  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: Math.min(900, workArea.width),
    minHeight: Math.min(600, workArea.height),
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',
      symbolColor: '#8888aa',
      height: 34
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: !is.dev,
      webviewTag: true,
    },
    backgroundColor: '#1a1a2e',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(__dirname, '../../build/icon.ico')
  })

  setPtyMainWindow(mainWindow)
  setAiMainWindow(mainWindow)
  setDshMainWindow(mainWindow)

  // Center window within the work area (excludes taskbar) on first launch
  const x = Math.round(workArea.x + (workArea.width - winWidth) / 2)
  const y = Math.round(workArea.y + (workArea.height - winHeight) / 2)
  mainWindow.setBounds({ x, y, width: winWidth, height: winHeight })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('closed', () => {
    cleanupAndExit()
    setPtyMainWindow(null)
    setAiMainWindow(null)
    setDshMainWindow(null)
    mainWindow = null
    if (process.platform !== 'darwin') app.exit()
  })

  // Open DevTools in dev mode for debugging
  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  // Fallback: show window after 2 seconds even if ready-to-show didn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    }
  }, 2000)

  // Intercept Ctrl+= / Ctrl++ / Ctrl+- at the main-process level
  // Chromium eats main-keyboard Ctrl+- before it reaches the renderer, so we
  // must detect it here, block the default zoom, and forward via IPC
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && !input.meta) {
      const isZoomKey = input.key === '=' || input.key === '+' || input.key === '-'
      if (isZoomKey) {
        event.preventDefault()
        const delta = input.key === '-' ? -1 : 1
        mainWindow?.webContents.send(IPC_CHANNELS.FONT_ADJUST, delta)
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow!.webContents.getURL()) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Set app user model id BEFORE ready — Electron docs require this,
// otherwise Windows caches taskbar icon under a default/shared AUMID.
electronApp.setAppUserModelId('com.vibe-ide')

app.whenReady().then(() => {
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType?.() === 'webview') {
      try { require('./browser-use').trackWebview(contents) } catch { /* ignore */ }
      // 网页里的 target=_blank / window.open:先在 webview 内原地打开,而不是静默吞掉
      contents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          contents.loadURL(url)
        }
        return { action: 'deny' }
      })
    }
  })
  // Default sandbox for renderer
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers (git, file, search don't need mainWindow)
  registerGitHandlers()
  registerFileHandlers()
  registerSearchHandlers()
  registerCodeGraphHandlers()

  createWindow()

  // Handle initial startup path from command line
  const startupPath = parseStartupPath(process.argv)
  if (startupPath) {
    // Wait for renderer to mount and register IPC listeners before sending
    mainWindow!.webContents.on('did-finish-load', () => {
      setTimeout(() => sendStartupPath(startupPath), 800)
    })
  }

  // Register PTY handlers after window is created
  registerPtyHandlers()
  registerBoardHandlers()
  registerAiHandlers()
  registerDshHandlers()
  registerPlanExecuteHandlers()
  registerAskResumeHandlers()
  registerRevertHandlers()
  registerHistoryHandlers()

  // Clamp zoom to 100% — prevents Chromium's built-in page zoom from eating Ctrl+= / Ctrl+-
  if (mainWindow) {
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  }

  // Minimal app menu WITHOUT zoomIn/zoomOut/ResetZoom roles
  // so Ctrl+= / Ctrl+- are not eaten as menu accelerators
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [{ role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.FOCUS_SETTINGS)
          }
        }
      ]
    }
  ]))

  // Title bar theme update
  ipcMain.on(IPC_CHANNELS.TITLE_BAR_UPDATE, (_, options) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay(options)
    }
  })

  // App version
  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion())
  ipcMain.handle(IPC_CHANNELS.APP_HOME, () => app.getPath('home'))

  // Claude 配置目录：renderer 无 homedir，由 main 返回路径后用 file 读写 settings.json / 配置组文件。
  // 与 ai.ts 共用 resolveConfigDir：未显式配置时按 ~/.claude → ~/.openclaude → ~/.opencc 探测
  ipcMain.handle(IPC_CHANNELS.CLAUDE_CONFIG_DIR, (_e, configDir?: string) => resolveConfigDir(configDir))

  // CSS snippets — dev 用项目根目录，打包后用 exe 同目录
  const snippetsDir = app.isPackaged
    ? join(dirname(exePath), 'snippets')
    : join(app.getAppPath(), 'snippets')
  const snippetsJsonPath = join(snippetsDir, 'snippets.json')

  function loadSnippetsJson(): Record<string, unknown> {
    try {
      if (existsSync(snippetsJsonPath)) {
        return JSON.parse(readFileSync(snippetsJsonPath, 'utf8'))
      }
    } catch {}
    return {}
  }

  function saveSnippetsJson(state: Record<string, unknown>) {
    try { writeFileSync(snippetsJsonPath, JSON.stringify(state, null, 2), 'utf8') } catch {}
  }

  function resolveCssUrls(css: string, baseDir: string): string {
    return css.replace(/url\(['"]?([^'"()]+)['"]?\)/g, (match, url) => {
      if (/^(data:|https?:|file:)/.test(url)) return match
      const resolved = existsSync(url) ? url : join(baseDir, url)
      const ext = (resolved.match(/\.(\w+)$/)?.[1] || '').toLowerCase()
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
        bmp: 'image/bmp', ico: 'image/x-icon',
      }
      if (!mimeMap[ext] || !existsSync(resolved)) return match
      return `url('file:///${resolved.replace(/\\/g, '/')}')`
    })
  }

  function readSnippetDesc(filePath: string): string | undefined {
    try {
      const line2 = readFileSync(filePath, 'utf8').split(/\r?\n/)[1]
      const trimmed = line2?.trim()
      return trimmed || undefined
    } catch {
      return undefined
    }
  }

  function buildSnippetsResult() {
    if (!existsSync(snippetsDir)) {
      mkdirSync(snippetsDir, { recursive: true })
      return { css: '', snippets: [], dir: snippetsDir }
    }
    const state = loadSnippetsJson()
    const order: string[] = (state.__order__ as string[]) || []
    delete state.__order__

    const diskFiles = readdirSync(snippetsDir)
      .filter(f => f.endsWith('.css'))
      .sort()

    const orderNum = new Map<string, number>()
    let n = 0
    for (const name of order) {
      if (diskFiles.includes(name) && state[name]) {
        n++
        orderNum.set(name, n)
      }
    }
    for (const name of diskFiles) {
      if (!orderNum.has(name) && state[name]) {
        n++
        orderNum.set(name, n)
      }
    }

    const snippets: SnippetInfo[] = diskFiles.map(name => ({
      name,
      enabled: state[name] !== undefined ? !!state[name] : false,
      desc: readSnippetDesc(join(snippetsDir, name)),
      order: orderNum.get(name) || 0,
    }))

    const css = snippets
      .filter(s => s.enabled)
      .sort((a, b) => a.order - b.order)
      .map(s => {
        const raw = readFileSync(join(snippetsDir, s.name), 'utf8')
        return `/* ${s.name} */\n${resolveCssUrls(raw, snippetsDir)}`
      })
      .join('\n\n')

    return { css, snippets, dir: snippetsDir }
  }

  ipcMain.handle(IPC_CHANNELS.SNIPPETS_LOAD, () => {
    try { return buildSnippetsResult() } catch { return { css: '', snippets: [] } }
  })

  ipcMain.handle(IPC_CHANNELS.SNIPPETS_TOGGLE, (_event, filename: string, enabled: boolean) => {
    try {
      const state = loadSnippetsJson()
      state[filename] = enabled
      const order: string[] = (state.__order__ as string[]) || []
      if (enabled) {
        if (!order.includes(filename)) order.push(filename)
      } else {
        const idx = order.indexOf(filename)
        if (idx !== -1) order.splice(idx, 1)
      }
      state.__order__ = order
      saveSnippetsJson(state)
      return buildSnippetsResult()
    } catch {
      return { css: '', snippets: [], dir: snippetsDir }
    }
  })

  // ── Pet (codex-style webp sprite sheet) — 目录策略同 snippets ──
  // 导入方式：把 .webp/.png 扔进 pets/（平铺）即成宠物（按图像尺寸推导网格）；
  // 需自定义网格/帧率则建 pets/<slug>/ 子文件夹放 spritesheet.webp + pet.json 覆盖。
  const petsDir = app.isPackaged
    ? join(dirname(exePath), 'pets')
    : join(app.getAppPath(), 'pets')
  const petsJsonPath = join(petsDir, 'pets.json')

  function loadPetsJson(): Record<string, unknown> {
    try {
      if (existsSync(petsJsonPath)) {
        return JSON.parse(readFileSync(petsJsonPath, 'utf8'))
      }
    } catch {}
    return {}
  }

  function savePetsJson(state: Record<string, unknown>) {
    try { writeFileSync(petsJsonPath, JSON.stringify(state, null, 2), 'utf8') } catch {}
  }

  const DEFAULT_PET_STATES = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']

  const PET_STATE_FRAME_OVERRIDES: Record<string, number> = { waving: 4, jumping: 4 }

  function defaultPetStates(frames: number): Record<string, { row: number; frames: number; loop: boolean }> {
    const o: Record<string, { row: number; frames: number; loop: boolean }> = {}
    DEFAULT_PET_STATES.forEach((name, i) => { o[name] = { row: i, frames: PET_STATE_FRAME_OVERRIDES[name] ?? frames, loop: true } })
    return o
  }

  // canonical 帧单位：从 default/pet.json（数据）读取，字面量仅兜底。
  // 导入宠物的 pet.json 不含网格字段时，按图像尺寸 + 该单位推导 cols/rows/frameSize。
  let _spriteUnit: { fw: number; fh: number; frames: number; cols: number } | null = null
  function getSpriteUnit() {
    if (_spriteUnit) return _spriteUnit
    const fb = { fw: 192, fh: 208, frames: 6, cols: 8 }
    try {
      const p = join(petsDir, 'default', 'pet.json')
      if (existsSync(p)) {
        const r = JSON.parse(readFileSync(p, 'utf8'))
        _spriteUnit = { fw: r.frameWidth ?? 192, fh: r.frameHeight ?? 208, frames: r.states?.idle?.frames ?? 6, cols: r.cols ?? 8 }
        return _spriteUnit
      }
    } catch {}
    _spriteUnit = fb
    return _spriteUnit
  }

  // 读图像真实尺寸：nativeImage 对 VP8L webp 解码失败，改用文件头解析（webp VP8/VP8L/VP8X、PNG IHDR）。
  function readImageSize(absPath: string): { w: number; h: number } {
    let fd: number | undefined
    try {
      fd = openSync(absPath, 'r')
      const head = Buffer.alloc(32)
      readSync(fd, head, 0, 32, 0)
      if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
        return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) }
      }
      if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
        const t = head.toString('ascii', 12, 16)
        if (t === 'VP8X') return { w: (head[24] | (head[25] << 8) | (head[26] << 16)) + 1, h: (head[27] | (head[28] << 8) | (head[29] << 16)) + 1 }
        if (t === 'VP8L') { const v = head.readUInt32LE(21); return { w: (v & 0x3FFF) + 1, h: ((v >> 14) & 0x3FFF) + 1 } }
        if (t === 'VP8 ') return { w: head.readUInt16LE(26) & 0x3FFF, h: head.readUInt16LE(28) & 0x3FFF }
      }
    } catch {} finally { if (fd !== undefined) { try { closeSync(fd) } catch {} } }
    return { w: 0, h: 0 }
  }

  function fileUrl(absPath: string): string {
    return 'file:///' + absPath.replace(/\\/g, '/')
  }

  // 子文件夹宠物：pet.json 可选（缺省走默认 manifest），至少一张图
  function buildPetManifest(slug: string): import('../shared/types').PetManifest | null {
    const petDir = join(petsDir, slug)
    let spriteFile: string | null = null
    try {
      for (const f of readdirSync(petDir)) {
        const lower = f.toLowerCase()
        if (lower.endsWith('.webp')) { spriteFile = f; break }
        if (lower.endsWith('.png') && !spriteFile) spriteFile = f
      }
    } catch { return null }
    if (!spriteFile) return null
    let raw: any = {}
    const petJsonPath = join(petDir, 'pet.json')
    if (existsSync(petJsonPath)) {
      try { raw = JSON.parse(readFileSync(petJsonPath, 'utf8')) } catch { raw = {} }
    }
    const unit = getSpriteUnit()
    const sz = readImageSize(join(petDir, spriteFile))
    const W = sz.w, H = sz.h
    const cols = raw.cols ?? (W > 0 ? Math.max(1, Math.round(W / unit.fw)) : unit.cols)
    const rows = raw.rows ?? (H > 0 ? Math.max(1, Math.round(H / unit.fh)) : 9)
    const frameWidth = raw.frameWidth ?? (W > 0 ? Math.round(W / cols) : unit.fw)
    const frameHeight = raw.frameHeight ?? (H > 0 ? Math.round(H / rows) : unit.fh)
    return {
      id: raw.id ?? slug,
      displayName: raw.displayName ?? raw.id ?? slug,
      description: raw.description,
      spritesheetUrl: fileUrl(join(petDir, spriteFile)),
      frameWidth,
      frameHeight,
      cols,
      rows,
      frameDurationMs: raw.frameDurationMs ?? 183,
      states: raw.states ?? defaultPetStates(unit.frames)
    }
  }

  // 平铺文件宠物：pets/<name>.webp → 默认 manifest
  function buildFlatPetManifest(fileName: string): import('../shared/types').PetManifest | null {
    const lower = fileName.toLowerCase()
    if (!lower.endsWith('.webp') && !lower.endsWith('.png')) return null
    const slug = fileName.replace(/\.[^.]+$/, '')
    if (!slug) return null
    const unit = getSpriteUnit()
    const sz = readImageSize(join(petsDir, fileName))
    const W = sz.w, H = sz.h
    const cols = W > 0 ? Math.max(1, Math.round(W / unit.fw)) : unit.cols
    const rows = H > 0 ? Math.max(1, Math.round(H / unit.fh)) : 9
    const frameWidth = W > 0 ? Math.round(W / cols) : unit.fw
    const frameHeight = H > 0 ? Math.round(H / rows) : unit.fh
    return {
      id: slug,
      displayName: slug,
      spritesheetUrl: fileUrl(join(petsDir, fileName)),
      frameWidth,
      frameHeight,
      cols,
      rows,
      frameDurationMs: 183,
      states: defaultPetStates(unit.frames)
    }
  }

  function buildPetsResult(): import('../shared/types').PetListResult {
    if (!existsSync(petsDir)) {
      mkdirSync(petsDir, { recursive: true })
      return { pets: [], activeId: null, dir: petsDir }
    }
    const state = loadPetsJson()
    const pets: import('../shared/types').PetManifest[] = []
    const seen = new Set<string>()
    try {
      for (const f of readdirSync(petsDir, { withFileTypes: true })) {
        let m: import('../shared/types').PetManifest | null = null
        if (f.isDirectory()) m = buildPetManifest(f.name)
        else if (f.isFile()) m = buildFlatPetManifest(f.name)
        if (m && !seen.has(m.id)) { seen.add(m.id); pets.push(m) }
      }
    } catch {}
    return { pets, activeId: (state.activeId as string) ?? null, dir: petsDir }
  }

  function notifyPetsChanged() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PET_CHANGED)
    }
  }

  ipcMain.handle(IPC_CHANNELS.PET_LIST, () => {
    try { return buildPetsResult() } catch { return { pets: [], activeId: null, dir: petsDir } }
  })

  ipcMain.handle(IPC_CHANNELS.PET_SET_ACTIVE, (_event, id: string) => {
    const state = loadPetsJson()
    state.activeId = id
    savePetsJson(state)
    notifyPetsChanged()
    return buildPetsResult()
  })

  ipcMain.handle(IPC_CHANNELS.PET_DELETE, (_event, id: string) => {
    // 子文件夹或平铺文件两种
    const folder = join(petsDir, id)
    try {
      if (existsSync(folder) && statSync(folder).isDirectory()) rmSync(folder, { recursive: true, force: true })
      else {
        for (const ext of ['.webp', '.png']) {
          const fp = join(petsDir, id + ext)
          if (existsSync(fp)) { rmSync(fp, { force: true }); break }
        }
      }
    } catch {}
    const state = loadPetsJson()
    if (state.activeId === id) { state.activeId = null; savePetsJson(state) }
    notifyPetsChanged()
    return buildPetsResult()
  })

  // System fonts — list installed font families via PowerShell (cached for process lifetime)
  ipcMain.handle(IPC_CHANNELS.FONT_LIST, async () => {
    if (process.platform !== 'win32') return []
    if (cachedFontList) return cachedFontList
    try {
      const psCmd = 'powershell -NoProfile -Command "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; [System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name } | Sort-Object"'
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        exec(psCmd, { timeout: 5000 }, (err, stdout, stderr) => err ? reject(err) : resolve({ stdout, stderr }))
      })
      cachedFontList = Array.from(new Set(stdout.split('\n').map(s => s.trim()).filter(s => s.length > 0)))
      return cachedFontList
    } catch (err) {
      console.error('[FONT_LIST] fetch failed:', err)
      return []
    }
  })

  // OCR — recognize text from image path or buffer
  ipcMain.handle(IPC_CHANNELS.OCR_RECOGNIZE, (_event, input: string | { buffer: Uint8Array; name: string }) => {
    if (typeof input === 'string') {
      return recognizeImage(input)
    }
    return recognizeImage(input.buffer)
  })

  // Perf snapshot — returns per-process memory + CPU usage
  ipcMain.handle(IPC_CHANNELS.PERF_SNAPSHOT, () => ({
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    appMetrics: app.getAppMetrics(),
    timestamp: Date.now()
  }))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

})

function cleanupAndExit(): void {
  cleanupTerminals()
  cleanupAiSessions()
  cleanupDsh()
  stopWatching()
  closeCodeGraph()
  terminateOcrWorker()
}

app.on('before-quit', () => {
  cleanupAndExit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupAndExit()
    app.exit()
  }
})