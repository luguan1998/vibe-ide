import { useSyncExternalStore } from 'react'

const MAX_RECENT_DIRS = 10
const RECENT_KEY = 'vibe-ide-recent-dirs'
const FAV_KEY = 'vibe-ide-fav-cwds'
const LAST_OPEN_KEY = 'vibe-ide-last-open-cwds'

function normalizeCwd(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '')
}

// .app 包内的路径（如 <app>.app/Contents/MacOS）不可能是合法工作区，过滤掉
function isBundlePath(cwd: string): boolean {
  return /\.app\/Contents/i.test(cwd) || /\/Contents\/MacOS/i.test(cwd)
}

function loadArr(key: string, max?: number): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const filtered = arr.filter((d: unknown) => typeof d === 'string' && d.length > 0 && !isBundlePath(d))
        if (filtered.length !== arr.length) saveArr(key, filtered)
        return max ? filtered.slice(0, max) : filtered
      }
    }
  } catch {}
  return []
}

function saveArr(key: string, arr: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(arr)) } catch {}
}

let recentDirs: string[] = loadArr(RECENT_KEY, MAX_RECENT_DIRS)
let favCwds: string[] = loadArr(FAV_KEY)
let lastOpenCwds: string[] = loadArr(LAST_OPEN_KEY)
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }

export const cwdStore = {
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  },
  getRecentDirs: () => recentDirs,
  getFavCwds: () => favCwds,
  getLastOpenCwds: () => lastOpenCwds,
  addRecentDir(dir: string) {
    const n = normalizeCwd(dir)
    if (isBundlePath(n)) return
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
  setLastOpenCwds(cwds: string[]) {
    const clean = cwds.filter(c => !isBundlePath(c))
    lastOpenCwds = clean
    saveArr(LAST_OPEN_KEY, clean)
    emit()
  },
}

export function useRecentDirs(): string[] {
  return useSyncExternalStore(cwdStore.subscribe, cwdStore.getRecentDirs)
}

export function useFavCwds(): string[] {
  return useSyncExternalStore(cwdStore.subscribe, cwdStore.getFavCwds)
}

export function useLastOpenCwds(): string[] {
  return useSyncExternalStore(cwdStore.subscribe, cwdStore.getLastOpenCwds)
}
