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
    // 工作区文件变更同样意味着 git status 可能变化 → 注册统一 git 刷新信号
    registerGitRefresh('status')
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

// ── 统一 git 状态刷新信号 ──
// FS_CHANGED(工作区文件变更，FileTab 树刷新用，保留原通道)与 .git 元数据变更(pull/外部
// commit/分支增删/worktree)在此合流:2s 窗口内去重，窗口结束时按窗口内最高优先级发一次
// GIT_META_CHANGED(full > status)。保证 GitTab 的 git 刷新硬上限 = 任意 2s 窗口 1 次。
// AI busy 期间不注册(风暴源是 AI 每轮裸 git 命令刷 index)，恢复监听时补发一次 full。
const GIT_REFRESH_WINDOW_MS = 2000
let gitRefreshDirty: 'none' | 'status' | 'full' = 'none'
let gitRefreshTimer: NodeJS.Timeout | null = null
let gitRefreshLastFire = 0

function registerGitRefresh(kind: 'status' | 'full') {
  if (metaPaused) return
  if (kind === 'full') gitRefreshDirty = 'full'
  else if (gitRefreshDirty === 'none') gitRefreshDirty = 'status'
  if (gitRefreshTimer) return
  const delay = Math.max(0, GIT_REFRESH_WINDOW_MS - (Date.now() - gitRefreshLastFire))
  gitRefreshTimer = setTimeout(() => {
    gitRefreshTimer = null
    gitRefreshLastFire = Date.now()
    const k = gitRefreshDirty
    gitRefreshDirty = 'none'
    if (k === 'none') return
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send(IPC_CHANNELS.GIT_META_CHANGED, { commonDir: currentMetaCommonDir, kind: k })
    })
  }, delay)
}

// .git 元数据监听(common dir 顶层 + refs/** + worktrees/**)，事件按 kind 归类:
// index 写入(裸 git status/diff 刷 stat cache、git add)只刷 status;refs/HEAD 变化才全套刷新
let metaWatchers: FSWatcher[] = []
let currentMetaCommonDir = ''
let metaPaused = false
let metaResumeTimer: NodeJS.Timeout | null = null

export function notifyGitMeta(): void {
  registerGitRefresh('full')
}

export function stopGitMeta() {
  for (const w of metaWatchers) {
    try { w.close() } catch {}
  }
  metaWatchers = []
}

// AI 忙闲门控：busy(任意 agent running)→ 立即挂起 .git 监听(AI 裸 git 命令刷 index →
// refs → 刷新风暴)；空闲 → 延迟恢复。延迟是防 stop hook 尾巴:最后一轮 result 后 stop hook
// 仍可能跑 stash/status 写 refs/index，立即恢复会再吃一轮刷新。恢复时补发一次 full，
// busy 窗口期漏掉的 worktree/分支变化(如 --worktree 会话建档)一并补刷。
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
    registerGitRefresh('full')
  }, 2500)
}

export function watchGitMeta(commonDir: string) {
  stopGitMeta()
  currentMetaCommonDir = commonDir
  if (!commonDir || !existsSync(commonDir)) return
  if (metaPaused) return

  const onEvent = (_eventType: string, filename: string | Buffer | null) => {
    if (!filename) return
    const f = String(filename).replace(/\\/g, '/')
    // 瞬态锁文件/临时件/fsmonitor daemon 管道不算元数据变更，防自激与重复刷新
    if (/^(index\.lock$|.*\.lock$|.*\.tmp$|\.smbdelete|~HEAD|fsmonitor--daemon)/i.test(f)) return
    const kind = f === 'index' || f.endsWith('/index') ? 'status' : 'full'
    registerGitRefresh(kind)
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
