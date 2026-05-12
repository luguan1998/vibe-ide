import { app, shell, BrowserWindow, ipcMain } from 'electron'
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