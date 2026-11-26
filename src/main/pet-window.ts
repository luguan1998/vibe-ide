import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { IPC_CHANNELS, type PetWinLayout, type PetWinRect, type PetWinState, type PetWinPoint, type PetWinDragResult } from '../shared/types'
import { is } from '@electron-toolkit/utils'
import { setAiPetWindow } from './ai-shared'

// 独立宠物窗口：尺寸 = 精灵 + 固定余量（气泡/菜单空间），随精灵平移并在屏幕内 clamp。
// 精灵位置用「全局屏幕 DIP」做主进程唯一真源；渲染层只渲染窗口内的局部坐标。

const POLL_MS = 55
const LEAVE_GRACE_MS = 160
const DRAG_POLL_MS = 16
const DRAG_THRESHOLD = 4
const EDGE_KEEP = 8
const SPRITE_INSET = 8
// 窗口 = 精灵 + 余量：水平两侧各 EXTRA_W/2 给左右弹气泡，垂直 EXTRA_H 全在精灵上方
const EXTRA_W = 360
const EXTRA_H = 320
const DEFAULT_SPRITE_W = 96
const DEFAULT_SPRITE_H = 104

let petWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let cachedState: PetWinState | null = null
let hitRects: PetWinRect[] = []
let spriteRect: PetWinRect | null = null
let ignoring = true
let lastInside = false
let leaveAt = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let currentDisplayId: number | null = null
let lastVisible: boolean | null = null
let spriteScreen: PetWinPoint | null = null
let spriteLocal: PetWinPoint = { x: SPRITE_INSET, y: SPRITE_INSET }

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

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function spriteSize() {
  return {
    w: spriteRect && spriteRect.w > 0 ? spriteRect.w : DEFAULT_SPRITE_W,
    h: spriteRect && spriteRect.h > 0 ? spriteRect.h : DEFAULT_SPRITE_H
  }
}

function windowSize(wa: Electron.Rectangle) {
  const s = spriteSize()
  return {
    w: Math.min(wa.width, s.w + EXTRA_W),
    h: Math.min(wa.height, s.h + EXTRA_H)
  }
}

function sendToPet(channel: string, data?: unknown) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(channel, data)
}

function sendFocus(focused: boolean) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.PETWIN_FOCUS, focused)
}

function setIgnore(ignore: boolean) {
  if (!petWindow || petWindow.isDestroyed()) return
  if (ignore === ignoring) return
  ignoring = ignore
  petWindow.setIgnoreMouseEvents(ignore)
}

// 精灵在窗口内的固定落点：水平居中（左右余量对称，气泡贴边判定才有意义），底部对齐。
// 每次从屏幕坐标重算，不复用上一帧结果 —— 贴边被 clamp 后偏移不会累积。
function spriteLocalFor(w: number, h: number) {
  const s = spriteSize()
  return { x: Math.round((w - s.w) / 2), y: h - s.h - SPRITE_INSET }
}

function applyLayout() {
  if (!petWindow || petWindow.isDestroyed()) return
  const disp = spriteScreen
    ? screen.getDisplayNearestPoint({ x: Math.round(spriteScreen.x), y: Math.round(spriteScreen.y) })
    : defaultDisplay()
  const wa = disp.workArea
  const { w, h } = windowSize(wa)
  const s = spriteSize()
  if (!spriteScreen) {
    spriteScreen = { x: wa.x + SPRITE_INSET, y: wa.y + wa.height - s.h - SPRITE_INSET }
    applyLayout()
    return
  }
  const a = spriteLocalFor(w, h)
  const ox = Math.round(clamp(spriteScreen.x - a.x, wa.x, wa.x + wa.width - w))
  const oy = Math.round(clamp(spriteScreen.y - a.y, wa.y, wa.y + wa.height - h))
  const next = { x: spriteScreen.x - ox, y: spriteScreen.y - oy }
  const b = petWindow.getBounds()
  if (b.width !== w || b.height !== h) petWindow.setBounds({ x: ox, y: oy, width: w, height: h })
  else if (b.x !== ox || b.y !== oy) petWindow.setPosition(ox, oy)
  currentDisplayId = disp.id
  if (next.x !== spriteLocal.x || next.y !== spriteLocal.y) {
    spriteLocal = next
    sendToPet(IPC_CHANNELS.PETWIN_SPRITE_POS, next)
  }
}

function resetSprite() {
  stopDrag()
  spriteScreen = null
  if (!petWindow || petWindow.isDestroyed()) return
  applyLayout()
  sendToPet(IPC_CHANNELS.PETWIN_RESET_POS)
}

function cursorInRects(pt: Electron.Point): boolean {
  if (!petWindow || petWindow.isDestroyed() || hitRects.length === 0) return false
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
  if (!drag) {
    const b = petWindow.getBounds()
    const pt = screen.getCursorScreenPoint()
    const x = pt.x - b.x
    const y = pt.y - b.y
    if (x < 0 || y < 0 || x > b.width || y > b.height) {
      lastInside = false
      leaveAt = 0
      setIgnore(true)
      return
    }
    if (cursorInRects(pt)) {
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
    return
  }
  setIgnore(false)
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
  spriteLocal = { x: rect.x, y: rect.y }
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
    if (display.id !== currentDisplayId) currentDisplayId = display.id
    const wa = display.workArea
    spriteScreen = {
      x: clamp(target.x, wa.x, wa.x + wa.width - EDGE_KEEP),
      y: clamp(target.y, wa.y, wa.y + wa.height - EDGE_KEEP)
    }
    applyLayout()
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
  const { w, h } = windowSize(wa)
  const win = new BrowserWindow({
    x: wa.x,
    y: wa.y + wa.height - h,
    width: w,
    height: h,
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
  win.setBounds({ x: wa.x, y: wa.y + wa.height - h, width: w, height: h })

  currentDisplayId = display.id
  spriteScreen = null
  spriteLocal = spriteLocalFor(w, h)

  win.setMenu(null)
  win.setIgnoreMouseEvents(true)
  ignoring = true
  win.setAlwaysOnTop(true, 'floating')
  win.setSkipTaskbar(true)

  win.on('focus', () => sendFocus(true))
  win.on('blur', () => sendFocus(false))

  win.webContents.on('did-finish-load', () => {
    if (cachedState) win.webContents.send(IPC_CHANNELS.PETWIN_STATE, cachedState)
    sendToPet(IPC_CHANNELS.PETWIN_SPRITE_POS, spriteLocal)
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
    spriteScreen = null
    spriteRect = null
    hitRects = []
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
      stopPolling()
      if (petWindow && !petWindow.isDestroyed()) petWindow.destroy()
      petWindow = null
      setAiPetWindow(null)
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

  ipcMain.on(IPC_CHANNELS.PETWIN_HITS, (_event, layout: PetWinLayout) => {
    hitRects = Array.isArray(layout?.hits) ? layout.hits : []
    const sp = layout?.sprite
    if (sp && sp.w > 0 && sp.h > 0) {
      spriteRect = sp
      if (!spriteScreen && petWindow && !petWindow.isDestroyed()) {
        const b = petWindow.getBounds()
        spriteScreen = { x: b.x + sp.x, y: b.y + sp.y }
      }
      applyLayout()
    }
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
