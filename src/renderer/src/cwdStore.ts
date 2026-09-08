import { useSyncExternalStore } from 'react'

const MAX_RECENT_DIRS = 10
const RECENT_KEY = 'vibe-ide-recent-dirs'
const FAV_KEY = 'vibe-ide-fav-cwds'
const KEPT_KEY = 'vibe-ide-kept-groups'

// 分组模式空组保留位：最后一个 session 关闭后 cwd 不消失，idx 为记录时在组序中的下标
export interface KeptGroup {
  cwd: string
  idx: number
}

function normKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

function loadKeptGroups(): KeptGroup[] {
  try {
    const raw = localStorage.getItem(KEPT_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return arr
          .filter((e: any) => e && typeof e.cwd === 'string' && e.cwd.length > 0)
          .map((e: any) => ({ cwd: normKey(e.cwd), idx: typeof e.idx === 'number' && e.idx >= 0 ? e.idx : 0 }))
      }
    }
  } catch {}
  return []
}

// 组序合并：会话组按会话序，保留位（空组/回填组）按记录的 idx 插回原位
export function mergeGroupOrder(sessionKeys: string[], kept: KeptGroup[]): string[] {
  const merged = [...sessionKeys]
  for (const e of [...kept].sort((a, b) => a.idx - b.idx)) {
    const cur = merged.indexOf(e.cwd)
    if (cur >= 0) merged.splice(cur, 1)
    merged.splice(Math.min(Math.max(e.idx, 0), merged.length), 0, e.cwd)
  }
  return merged
}

function normalizeCwd(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '')
}

function isVibeDir(path: string): boolean {
  return /(^|\/)\.vibe(\/|$)/i.test(normalizeCwd(path))
}

function loadArr(key: string, max?: number): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const filtered = arr.filter((d: unknown) => typeof d === 'string' && d.length > 0)
        return max ? filtered.slice(0, max) : filtered
      }
    }
  } catch {}
  return []
}

function saveArr<T>(key: string, arr: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(arr)) } catch {}
}

let recentDirs: string[] = loadArr(RECENT_KEY, MAX_RECENT_DIRS).filter(d => !isVibeDir(d))
let favCwds: string[] = loadArr(FAV_KEY)
let keptGroups: KeptGroup[] = loadKeptGroups()
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }

export const cwdStore = {
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  },
  getRecentDirs: () => recentDirs,
  getFavCwds: () => favCwds,
  addRecentDir(dir: string) {
    const n = normalizeCwd(dir)
    if (isVibeDir(n)) return
    const next = [n, ...recentDirs.filter(d => d !== n)].slice(0, MAX_RECENT_DIRS)
    recentDirs = next
    saveArr(RECENT_KEY, next)
    emit()
  },
  removeRecentDir(dir: string) {
    const n = normalizeCwd(dir)
    const next = recentDirs.filter(d => d !== n)
    recentDirs = next
    saveArr(RECENT_KEY, next)
    emit()
  },
  getKeptGroups: () => keptGroups,
  upsertKeptGroup(cwd: string, idx: number) {
    const n = normKey(cwd)
    const i = Math.max(0, idx)
    const cur = keptGroups.find(e => e.cwd === n)
    if (cur && cur.idx === i) return
    keptGroups = cur ? keptGroups.map(e => (e.cwd === n ? { cwd: n, idx: i } : e)) : [...keptGroups, { cwd: n, idx: i }]
    saveArr(KEPT_KEY, keptGroups)
    emit()
  },
  removeKeptGroup(cwd: string) {
    const n = normKey(cwd)
    if (!keptGroups.some(e => e.cwd === n)) return
    keptGroups = keptGroups.filter(e => e.cwd !== n)
    saveArr(KEPT_KEY, keptGroups)
    emit()
  },
  setKeptGroups(list: KeptGroup[]) {
    keptGroups = list
    saveArr(KEPT_KEY, keptGroups)
    emit()
  },
  isFav(dir: string) {
    return favCwds.includes(normalizeCwd(dir))
  },
  toggleFav(dir: string) {
    const n = normalizeCwd(dir)
    const next = favCwds.includes(n) ? favCwds.filter(d => d !== n) : [...favCwds, n]
    favCwds = next
    saveArr(FAV_KEY, next)
    emit()
  },
}

export function useRecentDirs(): string[] {
  return useSyncExternalStore(cwdStore.subscribe, cwdStore.getRecentDirs)
}

export function useFavCwds(): string[] {
  return useSyncExternalStore(cwdStore.subscribe, cwdStore.getFavCwds)
}

export function useKeptGroups(): KeptGroup[] {
  return useSyncExternalStore(cwdStore.subscribe, cwdStore.getKeptGroups)
}
