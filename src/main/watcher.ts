import { BrowserWindow } from 'electron'
import { watch, FSWatcher, existsSync } from 'fs'
import { join } from 'path'
import { IPC_CHANNELS } from '../shared/types'

const BASE_SKIP_PATTERNS = ['.git', '.vscode', '.idea', 'node_modules', '.next', 'dist', 'build', 'out', '__pycache__', 'target', '.cache', '.codegraph', '.venv', 'coverage', '.gradle', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo', '.parcel-cache', '.svelte-kit', '.nuxt', '.astro', '.expo', '.output', '.docusaurus', '.terraform', '.serverless', '.vibe/worktrees', '.claude/worktrees', 'Thumbs.db', 'desktop.ini', '.DS_Store']
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

// git 元数据监听：common dir 顶层(HEAD/packed-refs/FETCH_HEAD/MERGE_HEAD/ORIG_HEAD) + refs/** + worktrees/**
// 覆盖 pull/外部 commit/分支增删/worktree add-remove-prune，事件驱动 GitTab 全量刷新
let metaWatchers: FSWatcher[] = []
let metaDebounceTimer: NodeJS.Timeout | null = null
let metaPendingTimer: NodeJS.Timeout | null = null
let lastMetaNotifyTime = 0
let currentMetaCommonDir = ''

function scheduleGitMetaFire() {
  const now = Date.now()
  const elapsed = now - lastMetaNotifyTime

  const fire = () => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send(IPC_CHANNELS.GIT_META_CHANGED, { commonDir: currentMetaCommonDir })
    })
  }

  if (elapsed >= COOLDOWN_MS) {
    lastMetaNotifyTime = now
    fire()
  } else if (!metaPendingTimer) {
    metaPendingTimer = setTimeout(() => {
      metaPendingTimer = null
      lastMetaNotifyTime = Date.now()
      fire()
    }, COOLDOWN_MS - elapsed)
  }
}

export function notifyGitMeta(): void {
  scheduleGitMetaFire()
}

export function stopGitMeta() {
  for (const w of metaWatchers) {
    try { w.close() } catch {}
  }
  metaWatchers = []
  if (metaDebounceTimer) { clearTimeout(metaDebounceTimer); metaDebounceTimer = null }
  if (metaPendingTimer) { clearTimeout(metaPendingTimer); metaPendingTimer = null }
  currentMetaCommonDir = ''
}

export function watchGitMeta(commonDir: string) {
  stopGitMeta()
  if (!commonDir || !existsSync(commonDir)) return
  currentMetaCommonDir = commonDir

  const onEvent = (_eventType: string, filename: string | Buffer | null) => {
    if (!filename) return
    const f = String(filename).replace(/\\/g, '/')
    // 瞬态锁文件/临时件/fsmonitor daemon 管道不算元数据变更，防自激与重复刷新
    if (/^(index\.lock$|.*\.lock$|.*\.tmp$|\.smbdelete|~HEAD|fsmonitor--daemon)/i.test(f)) return
    if (metaDebounceTimer) clearTimeout(metaDebounceTimer)
    metaDebounceTimer = setTimeout(() => {
      metaDebounceTimer = null
      scheduleGitMetaFire()
    }, 300)
  }

  const add = (dir: string, recursive: boolean) => {
    if (!existsSync(dir)) return
    try {
      const w = watch(dir, { recursive }, onEvent)
      w.on('error', () => {})
      metaWatchers.push(w)
    } catch {}
  }
  add(commonDir, false)
  add(join(commonDir, 'refs'), true)
  add(join(commonDir, 'worktrees'), true)
}
