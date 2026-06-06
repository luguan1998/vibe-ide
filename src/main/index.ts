import { app, shell, BrowserWindow, ipcMain, Menu } from 'electron'
import { join, resolve } from 'path'
import { statSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { exec } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerPtyHandlers, cleanupTerminals } from './pty'
import { registerGitHandlers } from './git'
import { stopWatching } from './watcher'
import { registerFileHandlers } from './file'
import { registerSearchHandlers } from './search'
import { IPC_CHANNELS } from '../shared/types'

// Derive a path-specific instance lock so different exe copies run concurrently
// while the same exe still behaves as a singleton.
const exePath = app.getPath('exe')
const exeHash = createHash('md5').update(exePath).digest('hex').slice(0, 8)
app.name = `vibe-ide-${exeHash}`

// Fix GPU cache permission issue on Windows (must be after app.name so userData is correct)
app.setPath('cache', join(app.getPath('userData'), 'Cache'))

let mainWindow: BrowserWindow | null = null

// Fix Windows permission issues
app.commandLine.appendSwitch('no-sandbox')

// 强制 ANGLE 使用 D3D11 硬件加速，禁用软件渲染回退。
// 软件 WebGL (SwiftShader/llvmpipe) 会导致每次 gl.bufferData 全走 CPU，
// 终端流式输出时 CPU 直接拉满。若硬件 GPU 确实不可用，WebGL 上下文
// 创建会直接失败，TerminalView 中 try/catch 会回退到 DOM 渲染器。
app.commandLine.appendSwitch('use-gl', 'angle')
app.commandLine.appendSwitch('use-angle', 'd3d11')
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
      contextIsolation: true
    },
    backgroundColor: '#1a1a2e'
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.vibe-ide')

  // Default sandbox for renderer
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers (git, file, search don't need mainWindow)
  registerGitHandlers()
  registerFileHandlers()
  registerSearchHandlers()

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Warm up Windows COM file dialog — first call to IFileOpenDialog loads
  // shell extensions (OneDrive, Dropbox, etc.) and can take 1-5s cold.
  // Pre-instantiating the WinForms dialog class forces this init in the
  // background so the real showOpenDialog call is instant.
  if (process.platform === 'win32') {
    setTimeout(() => {
      exec(
        'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms"',
        () => {} // fire-and-forget
      )
    }, 3000)
  }
})

app.on('before-quit', () => {
  cleanupTerminals()
  stopWatching()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})