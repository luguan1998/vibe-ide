import { app, shell, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerPtyHandlers, cleanupTerminals } from './pty'
import { registerGitHandlers, cleanupGitWatcher } from './git'
import { registerFileHandlers } from './file'
import { registerSearchHandlers } from './search'
import { IPC_CHANNELS } from '../shared/types'

// Fix GPU cache permission issue on Windows
app.setPath('cache', join(app.getPath('userData'), 'Cache'))

let mainWindow: BrowserWindow | null = null

// Fix Windows permission issues
app.commandLine.appendSwitch('no-sandbox')

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
      height: 36
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  cleanupTerminals()
  cleanupGitWatcher()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})