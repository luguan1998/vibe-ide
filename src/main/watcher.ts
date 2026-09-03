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

// git 元数据监听:common dir 顶层(HEAD/packed-refs/FETCH_HEAD/MERGE_HEAD/ORIG_HEAD) + refs/** + worktrees/**
// 覆盖 pull/外部 commit/分支增删/worktree add-remove-prune，事件驱动 GitTab 刷新。
// 事件按 kind 分流:index 写入(裸 git status/diff 刷 stat cache、git add)只刷 status;
// refs/HEAD 变化才全套刷新。AI busy 期间由 setGitMetaPaused(true) 停掉——AI 每轮跑的裸
// git status/add/commit 刷新 .git/index 会反射放大成刷新风暴；空闲后延迟恢复，pull 等
// 元数据变更感知保留。
type GitMetaKind = 'index' | 'refs'
let metaWatchers: FSWatcher[] = []
let metaDebounceTimer: NodeJS.Timeout | null = null
let metaPendingTimer: NodeJS.Timeout | null = null
let metaPendingKind: GitMetaKind = 'refs'
let lastMetaNotifyTime = 0
let currentMetaCommonDir = ''
let metaPaused = false
let metaResumeTimer: NodeJS.Timeout | null = null

function scheduleGitMetaFire(kind: GitMetaKind = 'refs') {
  const now = Date.now()
  const elapsed = now - lastMetaNotifyTime

  const fire = (k: GitMetaKind) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send(IPC_CHANNELS.GIT_META_CHANGED, { commonDir: currentMetaCommonDir, kind: k })
    })
  }

  if (elapsed >= COOLDOWN_MS) {
    lastMetaNotifyTime = now
    fire(kind)
  } else {
    if (metaPendingTimer) {
      // 延迟期间攒下更重要的 refs 事件时升级 kind
      if (kind === 'refs') metaPendingKind = 'refs'
      return
    }
    metaPendingKind = kind
    metaPendingTimer = setTimeout(() => {
      metaPendingTimer = null
      lastMetaNotifyTime = Date.now()
      fire(metaPendingKind)
    }, COOLDOWN_MS - elapsed)
  }
}

export function notifyGitMeta(): void {
  scheduleGitMetaFire('refs')
}

export function stopGitMeta() {
  for (const w of metaWatchers) {
    try { w.close() } catch {}
  }
  metaWatchers = []
  if (metaDebounceTimer) { clearTimeout(metaDebounceTimer); metaDebounceTimer = null }
  if (metaPendingTimer) { clearTimeout(metaPendingTimer); metaPendingTimer = null }
}

// AI 忙闲门控：busy(任意 AI 会话)→ 立即挂起 .git 监听(AI 裸 git 命令刷 index → meta → 刷新风暴)，
// 空闲 → 延迟恢复。延迟是防 stop hook 尾巴:最后一轮 result 后 stop hook 仍可能跑 stash/status
// 写 refs/index，立即恢复会再吃一轮刷新。恢复时补发一次 refs 通知，busy 窗口期漏掉的
// worktree/分支变化(如 --worktree 会话建档)一并补刷。
export function setGitMetaPaused(paused: boolean): void {
  if (metaResumeTimer) { clearTimeout(metaResumeTimer); metaResumeTimer = null }
  if (paused) {
    if (metaPaused) return
    metaPaused = true
    stopGitMeta()
    return
  }
  if (!metaPaused) return
  metaResumeTimer = setTimeout(() => {
    metaResumeTimer = null
    metaPaused = false
    if (!currentMetaCommonDir) return
    watchGitMeta(currentMetaCommonDir)
    scheduleGitMetaFire('refs')
  }, 2500)
}

export function watchGitMeta(commonDir: string) {
  stopGitMeta()
  if (!commonDir || !existsSync(commonDir)) return
  currentMetaCommonDir = commonDir
  if (metaPaused) return

  const onEvent = (_eventType: string, filename: string | Buffer | null) => {
    if (!filename) return
    const f = String(filename).replace(/\\/g, '/')
    // 瞬态锁文件/临时件/fsmonitor daemon 管道不算元数据变更，防自激与重复刷新
    if (/^(index\.lock$|.*\.lock$|.*\.tmp$|\.smbdelete|~HEAD|fsmonitor--daemon)/i.test(f)) return
    const kind: GitMetaKind = f === 'index' || f.endsWith('/index') ? 'index' : 'refs'
    if (metaDebounceTimer) clearTimeout(metaDebounceTimer)
    metaDebounceTimer = setTimeout(() => {
      metaDebounceTimer = null
      scheduleGitMetaFire(kind)
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
