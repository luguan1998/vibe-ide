import { useSyncExternalStore, useCallback } from 'react'

// ── 定时任务共享 store ──
// 会话行首 ⏰ 状态（scheduled）由 SessionPanel 与 BoardView 共用。
// 任务按 session id 存 localStorage，随会话恢复接上；会话关闭后由 prune 清理。
// 会话行首 emoji 已收进 SessionTab.emoji（见 sessionRestore.ts），不在此处。

export interface SchedTask {
  cron: string
  command: string
  lastFired: string
}

const STORAGE_KEY = 'vibe-ide-sched-tasks'

function load(): Record<string, SchedTask> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return {}
    const out: Record<string, SchedTask> = {}
    for (const [k, v] of Object.entries(data)) {
      if (!v || typeof v !== 'object') continue
      const t = v as Record<string, unknown>
      if (typeof t.cron !== 'string' || typeof t.command !== 'string') continue
      out[k] = { cron: t.cron, command: t.command, lastFired: typeof t.lastFired === 'string' ? t.lastFired : '' }
    }
    return out
  } catch {
    return {}
  }
}

function persist() {
  try {
    if (Object.keys(schedTasks).length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(schedTasks))
  } catch {}
}

let schedTasks: Record<string, SchedTask> = load()
const listeners = new Set<() => void>()

function emit() {
  persist()
  for (const l of listeners) l()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function setSchedTask(sid: string, task: SchedTask) {
  schedTasks = { ...schedTasks, [sid]: task }
  emit()
}

export function deleteSchedTask(sid: string) {
  if (!(sid in schedTasks)) return
  schedTasks = { ...schedTasks }
  delete schedTasks[sid]
  emit()
}

// 定时器命中：仅当任务仍存在且本分钟未触发时置 lastFired
export function markSchedFired(sid: string, stamp: string): boolean {
  const task = schedTasks[sid]
  if (!task || task.lastFired === stamp) return false
  schedTasks = { ...schedTasks, [sid]: { ...task, lastFired: stamp } }
  emit()
  return true
}

// session 关闭后清理其定时任务（保留仍存活的 id）
export function pruneSchedTasks(aliveIds: Set<string>) {
  const next: Record<string, SchedTask> = {}
  for (const [k, v] of Object.entries(schedTasks)) if (aliveIds.has(k)) next[k] = v
  if (Object.keys(next).length === Object.keys(schedTasks).length) return
  schedTasks = next
  emit()
}

function useStoreValue<T>(get: () => T): T {
  const getSnapshot = useCallback(get, [])
  return useSyncExternalStore(subscribe, getSnapshot)
}

export const useSchedTasks = () => useStoreValue(() => schedTasks)