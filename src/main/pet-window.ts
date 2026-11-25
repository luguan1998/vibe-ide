import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { IPC_CHANNELS, type PetWinRect, type PetWinState } from '../shared/types'
import { is } from '@electron-toolkit/utils'
import { setAiPetWindow } from './ai-shared'

// 独立宠物窗口：铺满主屏工作区（同 Codex overlay），透明置顶。
// 窗口本身不移动，精灵在窗口内拖动；是否接收鼠标由主进程轮询光标 + 渲染层命中矩形决定。

const POLL_MS = 55
const LEAVE_GRACE_MS = 160

let petWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let cachedState: PetWinState | null = null
let hitRects: PetWinRect[] = []
let ignoring = true
let lastInside = false
let leaveAt = 0
let pollTimer: ReturnType<typeof setInterval> | null = null

function setIgnore(ignore: boolean) {
  if (!petWindow || petWindow.isDestroyed()) return
  if (ignore === ignoring) return
  ignoring = ignore
  petWindow.setIgnoreMouseEvents(ignore)
}

function cursorInRects(): boolean {
  if (!petWindow || petWindow.isDestroyed() || hitRects.length === 0) return false
  const pt = screen.getCursorScreenPoint()
  const b = petWindow.getBounds()
  const x = pt.x - b.x
  const y = pt.y - b.y
  for (const r of hitRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true
  }
  return false
}

function tick() {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return
  if (cursorInRects()) {
    leaveAt = 0
    lastInside = true
    setIgnore(false)
    return
  }
  if (lastInside) {
    lastInside = false
    leaveAt = Date.now()
    return
  }
  if (leaveAt && Date.now() - leaveAt >= LEAVE_GRACE_MS) {
    leaveAt = 0
    setIgnore(true)
  } else if (!leaveAt) {
    setIgnore(true)
  }
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(tick, POLL_MS)
}

function stopPolling() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

function sendToPet(channel: string, data?: unknown) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(channel, data)
}

function sendFocus(focused: boolean) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.PETWIN_FOCUS, focused)
}

function createPetWindow(): BrowserWindow {
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()
  const wa = display.workArea
  const win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: !is.dev,
      plugins: true
    }
  })

  win.setMenu(null)
  win.setIgnoreMouseEvents(true)
  ignoring = true
  win.setAlwaysOnTop(true, 'floating')
  win.setSkipTaskbar(true)

  win.on('focus', () => sendFocus(true))
  win.on('blur', () => sendFocus(false))

  win.webContents.on('did-finish-load', () => {
    if (cachedState) win.webContents.send(IPC_CHANNELS.PETWIN_STATE, cachedState)
    if (cachedState?.prefs.visible !== false) win.showInactive()
    startPolling()
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  win.on('closed', () => {
    stopPolling()
    petWindow = null
    setAiPetWindow(null)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pet.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer-pet/pet.html'))
  }
  return win
}

function ensurePetWindow(): BrowserWindow {
  if (!petWindow || petWindow.isDestroyed()) petWindow = createPetWindow()
  setAiPetWindow(petWindow)
  return petWindow
}

export function registerPetWindowHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.on(IPC_CHANNELS.PETWIN_PUSH, (_event, state: PetWinState) => {
    cachedState = state
    mainWindow = getMainWindow()
    if (!state.prefs.visible) {
      if (petWindow && !petWindow.isDestroyed()) {
        setIgnore(true)
        lastInside = false
        leaveAt = 0
        petWindow.hide()
      }
      return
    }
    const win = ensurePetWindow()
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.PETWIN_STATE, state)
      if (!win.isVisible() && win.webContents.getURL()) win.showInactive()
    }
  })

  ipcMain.on(IPC_CHANNELS.PETWIN_READY, (event) => {
    mainWindow = getMainWindow()
    if (cachedState) event.sender.send(IPC_CHANNELS.PETWIN_STATE, cachedState)
  })

  ipcMain.on(IPC_CHANNELS.PETWIN_EVENT, (_event, evt) => {
    sendToPet(IPC_CHANNELS.PETWIN_EVENT, evt)
  })

  ipcMain.on(IPC_CHANNELS.PETWIN_INTENT, (_event, intent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.PETWIN_INTENT, intent)
  })

  ipcMain.on(IPC_CHANNELS.PETWIN_REPLY, (_event, payload) => {
    sendToPet(IPC_CHANNELS.PETWIN_REPLY, payload)
  })

  ipcMain.on(IPC_CHANNELS.PETWIN_HITS, (_event, rects: PetWinRect[]) => {
    hitRects = Array.isArray(rects) ? rects : []
    tick()
  })

  ipcMain.on(IPC_CHANNELS.PETWIN_RESET_POS, () => {
    sendToPet(IPC_CHANNELS.PETWIN_RESET_POS)
  })

  app.on('before-quit', stopPolling)
}
