import { BrowserWindow } from 'electron'
import { watch, FSWatcher, existsSync } from 'fs'
import { IPC_CHANNELS } from '../shared/types'

const BASE_SKIP_PATTERNS = ['.git', '.vscode', 'node_modules', '.next', 'dist', 'build', 'out', '__pycache__', 'target', '.cache']
let userSkipPatterns: string[] = []
let watcherSkipRegex: RegExp
let watcher: FSWatcher | null = null
let debounceTimer: NodeJS.Timeout | null = null
let pendingTimer: NodeJS.Timeout | null = null
let lastNotifyTime = 0
const COOLDOWN_MS = 2000

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSkipRegex(): RegExp {
  const all = [...new Set([...BASE_SKIP_PATTERNS, ...userSkipPatterns.map(escapeRegex)])]
  return new RegExp(`[\\\\/](${all.join('|')})[\\\\/]`)
}

watcherSkipRegex = buildSkipRegex()

type ChangeListener = () => void
let changeListeners: ChangeListener[] = []

export function onChanged(listener: ChangeListener): () => void {
  changeListeners.push(listener)
  return () => {
    changeListeners = changeListeners.filter(l => l !== listener)
  }
}

function notifyChanged() {
  const now = Date.now()
  const elapsed = now - lastNotifyTime

  const fire = () => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send(IPC_CHANNELS.FS_CHANGED)
    })
    for (const cb of changeListeners) {
      cb()
    }
  }

  if (elapsed >= COOLDOWN_MS) {
    lastNotifyTime = now
    fire()
  } else {
    if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        lastNotifyTime = Date.now()
        fire()
      }, COOLDOWN_MS - elapsed)
    }
  }
}

export function startWatching(workspace: string) {
  stopWatching()
  if (!existsSync(workspace)) return

  watcher = watch(workspace, { recursive: true }, (_eventType, filename) => {
    if (!filename) return
    const normalized = filename.replace(/\\/g, '/')
    if (watcherSkipRegex.test('/' + normalized + '/')) return

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      notifyChanged()
    }, 300)
  })
}

export function stopWatching() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
}

export function updateSkipPatterns(patterns: string[]) {
  userSkipPatterns = patterns || []
  watcherSkipRegex = buildSkipRegex()
}
