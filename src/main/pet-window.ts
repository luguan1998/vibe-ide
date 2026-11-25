import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { IPC_CHANNELS, type PetWinRect, type PetWinState, type PetWinPoint, type PetWinDragResult } from '../shared/types'
import { is } from '@electron-toolkit/utils'
import { setAiPetWindow } from './ai-shared'

// 独立宠物窗口：铺满某个显示器的工作区（透明置顶）。
// 精灵位置用「全局屏幕 DIP」做主进程唯一真源；拖到另一块屏时窗口整体搬过去，
// 再把屏幕坐标换算成新窗口内的局部坐标推给渲染层。

const POLL_MS = 55
const LEAVE_GRACE_MS = 160
const DRAG_POLL_MS = 16
const DRAG_THRESHOLD = 4
const EDGE_KEEP = 8

let petWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let cachedState: PetWinState | null = null
let hitRects: PetWinRect[] = []
let ignoring = true
let lastInside = false
let leaveAt = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let currentDisplayId: number | null = null
let lastVisible: boolean | null = null
let spriteScreen: PetWinPoint | null = null

interface DragSession {
  grabX: number
  grabY: number
  startSprite: PetWinPoint
  lastX: number
  moved: boolean
  dir: 'left' | 'right' | null
  timer: ReturnType<typeof setInterval> | null
}

let drag: DragSession | null = null

function defaultDisplay() {
  if (mainWindow && !mainWindow.isDestroyed()) return screen.getDisplayMatching(mainWindow.getBounds())
  return screen.getPrimaryDisplay()
}

function clampLocal(p: PetWinPoint, wa: Electron.Rectangle): PetWinPoint {
  return {
    x: Math.max(0, Math.min(wa.width - EDGE_KEEP, p.x)),
    y: Math.max(0, Math.min(wa.height - EDGE_KEEP, p.y))
  }
}

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
  if (drag) {
    setIgnore(false)
    return
  }
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

function moveWindowToDisplay(display: Electron.Display) {
  if (!petWindow || petWindow.isDestroyed()) return
  const wa = display.workArea
  petWindow.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height })
  currentDisplayId = display.id
}

function resetSprite() {
  stopDrag()
  spriteScreen = null
  if (!petWindow || petWindow.isDestroyed()) return
  moveWindowToDisplay(defaultDisplay())
  sendToPet(IPC_CHANNELS.PETWIN_RESET_POS)
}

function stopDrag() {
  if (!drag) return
  if (drag.timer) clearInterval(drag.timer)
  drag = null
}

function startDrag(rect: PetWinPoint) {
  if (!petWindow || petWindow.isDestroyed()) return
  stopDrag()
  const cursor = screen.getCursorScreenPoint()
  const b = petWindow.getBounds()
  const sprite = { x: b.x + rect.x, y: b.y + rect.y }
  const session: DragSession = {
    grabX: cursor.x - sprite.x,
    grabY: cursor.y - sprite.y,
    startSprite: sprite,
    lastX: cursor.x,
    moved: false,
    dir: null,
    timer: null
  }
  drag = session
  spriteScreen = sprite
  session.timer = setInterval(() => {
    if (!drag || !petWindow || petWindow.isDestroyed()) { stopDrag(); return }
    const cur = screen.getCursorScreenPoint()
    const target = { x: cur.x - drag.grabX, y: cur.y - drag.grabY }
    if (!drag.moved) {
      if (Math.abs(target.x - drag.startSprite.x) <= DRAG_THRESHOLD && Math.abs(target.y - drag.startSprite.y) <= DRAG_THRESHOLD) return
      drag.moved = true
      sendToPet(IPC_CHANNELS.PETWIN_DRAG_STATE, { moved: true, dir: null })
    }
    const display = screen.getDisplayNearestPoint(cur)
    if (display.id !== currentDisplayId) moveWindowToDisplay(display)
    const wa = display.workArea
    const local = clampLocal({ x: target.x - wa.x, y: target.y - wa.y }, wa)
    spriteScreen = { x: wa.x + local.x, y: wa.y + local.y }
    sendToPet(IPC_CHANNELS.PETWIN_SPRITE_POS, local)
    const dir = cur.x > drag.lastX ? 'right' : cur.x < drag.lastX ? 'left' : drag.dir
    if (dir !== drag.dir) {
      drag.dir = dir
      sendToPet(IPC_CHANNELS.PETWIN_DRAG_STATE, { moved: true, dir: drag.dir })
    }
    drag.lastX = cur.x
  }, DRAG_POLL_MS)
}

function endDrag(): PetWinDragResult {
  const moved = !!drag?.moved
  const dir = drag?.dir ?? null
  stopDrag()
  lastInside = false
  leaveAt = 0
  setIgnore(true)
  return { moved, dir }
}

function createPetWindow(): BrowserWindow {
  const display = defaultDisplay()
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

  // 构造参数里的尺寸按主屏 DPI 解释，副屏创建时会被缩错；显式 setBounds 一次校正
  win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height })

  currentDisplayId = display.id
  spriteScreen = null

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
    stopDrag()
    stopPolling()
    petWindow = null
    currentDisplayId = null
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
    const wasVisible = lastVisible
    lastVisible = state.prefs.visible
    if (!state.prefs.visible) {
      stopDrag()
      if (petWindow && !petWindow.isDestroyed()) {
        setIgnore(true)
        lastInside = false
        leaveAt = 0
        petWindow.hide()
      }
      return
    }
    const win = ensurePetWindow()
    if (win.isDestroyed()) return
    win.webContents.send(IPC_CHANNELS.PETWIN_STATE, state)
    if (!win.isVisible() && win.webContents.getURL()) win.showInactive()
    if (wasVisible === false) resetSprite()
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

  ipcMain.handle(IPC_CHANNELS.PETWIN_DRAG, (_event, payload: { action: 'start' | 'end'; rect?: PetWinPoint }) => {
    if (payload?.action === 'start') {
      if (payload.rect) startDrag(payload.rect)
      return null
    }
    return endDrag()
  })

  ipcMain.on(IPC_CHANNELS.PETWIN_RESET_POS, () => resetSprite())

  app.on('before-quit', () => {
    stopDrag()
    stopPolling()
  })
}
