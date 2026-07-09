import { app, shell, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { join, resolve, dirname } from 'path'
import { statSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { createHash } from 'crypto'
import { exec } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerPtyHandlers, cleanupTerminals } from './pty'
import { registerAiHandlers, cleanupAiSessions } from './ai'
import { registerPlanExecuteHandlers } from './ai-plan-execute'
import { registerAskResumeHandlers } from './ai-ask-resume'
import { registerRevertHandlers } from './ai-revert'
import { registerGitHandlers } from './git'
import { stopWatching } from './watcher'
import { registerFileHandlers } from './file'
import { registerSearchHandlers } from './search'
import { registerCodeGraphHandlers, closeCodeGraph } from './codegraph'
import { recognizeImage, terminateOcrWorker } from './ocr'
import { IPC_CHANNELS } from '../shared/types'

// Derive a path-specific instance lock so different exe copies run concurrently
// while the same exe still behaves as a singleton.
const exePath = app.getPath('exe')
const exeHash = createHash('md5').update(exePath).digest('hex').slice(0, 8)
app.name = `vibe-ide-${exeHash}`

let mainWindow: BrowserWindow | null = null
let cachedFontList: string[] | null = null

// Fix Windows permission issues
app.commandLine.appendSwitch('no-sandbox')
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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
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
    },
    backgroundColor: '#1a1a2e',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(__dirname, '../../build/icon.ico')
  })

  // Center window within the work area (excludes taskbar) on first launch
  const workArea = screen.getPrimaryDisplay().workArea
  const x = Math.round(workArea.x + (workArea.width - 1400) / 2)
  const y = Math.round(workArea.y + (workArea.height - 900) / 2)
  mainWindow.setBounds({ x, y, width: 1400, height: 900 })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('closed', () => {
    cleanupAndExit()
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

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Warm up Windows COM file dialog — first call to IFileOpenDialog loads
  // shell extensions (OneDrive, Dropbox, etc.) and can take 1-5s cold.
  // Pre-instantiating the WinForms dialog class forces this init in the
  // background so the real showOpenDialog call is instant.
  if (process.platform === 'win32') {
    exec(
      'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms"',
      () => {} // fire-and-forget
    )
  }
}

// Set app user model id BEFORE ready — Electron docs require this,
// otherwise Windows caches taskbar icon under a default/shared AUMID.
electronApp.setAppUserModelId('com.vibe-ide')

app.whenReady().then(() => {
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
  registerPtyHandlers(mainWindow)
  registerAiHandlers(mainWindow)
  registerPlanExecuteHandlers()
  registerAskResumeHandlers()
  registerRevertHandlers()

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

  // CSS snippets — dev 用项目根目录，打包后用 exe 同目录
  const snippetsDir = app.isPackaged
    ? join(dirname(exePath), 'snippets')
    : join(app.getAppPath(), 'snippets')
  const snippetsJsonPath = join(snippetsDir, 'snippets.json')

  function loadSnippetsJson(): Record<string, boolean> {
    try {
      if (existsSync(snippetsJsonPath)) {
        return JSON.parse(readFileSync(snippetsJsonPath, 'utf8'))
      }
    } catch {}
    return {}
  }

  function saveSnippetsJson(state: Record<string, boolean>) {
    try { writeFileSync(snippetsJsonPath, JSON.stringify(state, null, 2), 'utf8') } catch {}
  }

  function resolveCssUrls(css: string, baseDir: string): string {
    return css.replace(/url\(['"]?([^'"()]+)['"]?\)/g, (match, url) => {
      if (/^(data:|https?:|http?:|file:)/.test(url)) return match
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

  function buildSnippetsResult() {
    if (!existsSync(snippetsDir)) {
      mkdirSync(snippetsDir, { recursive: true })
      return { css: '', snippets: [] }
    }
    const state = loadSnippetsJson()
    const files = readdirSync(snippetsDir)
      .filter(f => f.endsWith('.css'))
      .sort()
    // 新文件默认启用
    const snippets = files.map(name => ({
      name,
      enabled: state[name] !== undefined ? state[name] : false
    }))
    // 仅拼接启用的
    const enabledFiles = snippets.filter(s => s.enabled).map(s => s.name)
    const css = enabledFiles
      .map(f => {
        const raw = readFileSync(join(snippetsDir, f), 'utf8')
        return `/* ${f} */\n${resolveCssUrls(raw, snippetsDir)}`
      })
      .join('\n\n')
    return { css, snippets }
  }

  ipcMain.handle(IPC_CHANNELS.SNIPPETS_LOAD, () => {
    try { return buildSnippetsResult() } catch { return { css: '', snippets: [] } }
  })

  ipcMain.handle(IPC_CHANNELS.SNIPPETS_TOGGLE, (_event, filename: string, enabled: boolean) => {
    try {
      const state = loadSnippetsJson()
      state[filename] = enabled
      saveSnippetsJson(state)
      return buildSnippetsResult()
    } catch {
      return { css: '', snippets: [] }
    }
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