import { useSyncExternalStore } from 'react'

const MAX_RECENT_DIRS = 10
const RECENT_KEY = 'vibe-ide-recent-dirs'
const FAV_KEY = 'vibe-ide-fav-cwds'

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

function saveArr(key: string, arr: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(arr)) } catch {}
}

let recentDirs: string[] = loadArr(RECENT_KEY, MAX_RECENT_DIRS).filter(d => !isVibeDir(d))
let favCwds: string[] = loadArr(FAV_KEY)
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
