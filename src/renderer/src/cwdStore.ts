import { useSyncExternalStore } from 'react'

const MAX_RECENT_DIRS = 10
const RECENT_KEY = 'vibe-ide-recent-dirs'
const FAV_KEY = 'vibe-ide-fav-cwds'
const ORDER_KEY = 'vibe-ide-group-order'
const EMPTY_KEY = 'vibe-ide-empty-groups'

function normKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

// 展示组序：groupOrder 定序；有会话的组或「关掉最后一个会话后保留的空组」才显示
export function orderGroups(sessionKeys: string[], order: string[], emptyKeys: string[]): string[] {
  const present = new Set(sessionKeys)
  const kept = new Set(emptyKeys)
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of order.concat(sessionKeys)) {
    if (!k || seen.has(k) || (!present.has(k) && !kept.has(k))) continue
    seen.add(k)
    out.push(k)
  }
  return out
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
let groupOrder: string[] = loadArr(ORDER_KEY)
let emptyGroups: string[] = loadArr(EMPTY_KEY)
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
  getGroupOrder: () => groupOrder,
  getEmptyGroups: () => emptyGroups,
  setGroupOrder(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const k of list) {
      if (seen.has(k)) continue
      seen.add(k)
      next.push(k)
    }
    const sameOrder = next.length === groupOrder.length && next.every((k, i) => k === groupOrder[i])
    const nextEmpty = emptyGroups.filter(k => seen.has(k))
    const sameEmpty = nextEmpty.length === emptyGroups.length
    if (sameOrder && sameEmpty) return
    groupOrder = next
    emptyGroups = nextEmpty
    saveArr(ORDER_KEY, next)
    saveArr(EMPTY_KEY, nextEmpty)
    emit()
  },
  keepEmptyGroup(cwd: string) {
    const n = normKey(cwd)
    if (emptyGroups.includes(n)) return
    emptyGroups = [...emptyGroups, n]
    if (!groupOrder.includes(n)) groupOrder = [...groupOrder, n]
    saveArr(EMPTY_KEY, emptyGroups)
    saveArr(ORDER_KEY, groupOrder)
    emit()
  },
  removeGroup(cwd: string) {
    const n = normKey(cwd)
    if (!groupOrder.includes(n) && !emptyGroups.includes(n)) return
    groupOrder = groupOrder.filter(k => k !== n)
    emptyGroups = emptyGroups.filter(k => k !== n)
    saveArr(ORDER_KEY, groupOrder)
    saveArr(EMPTY_KEY, emptyGroups)
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

export function useGroupOrder(): string[] {
  return useSyncExternalStore(cwdStore.subscribe, cwdStore.getGroupOrder)
}

export function useEmptyGroups(): string[] {
  return useSyncExternalStore(cwdStore.subscribe, cwdStore.getEmptyGroups)
}
