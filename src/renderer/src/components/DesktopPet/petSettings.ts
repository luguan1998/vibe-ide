// 桌面宠物本地偏好（localStorage + 事件），供 DesktopPet 与外观面板共享。

const SCALE_KEY = 'vibe-ide-pet-scale'
const VISIBLE_KEY = 'vibe-ide-pet-visible'
const POS_KEY = 'vibe-ide-pet-pos'
const EVENT = 'vibe-ide-pet-prefs-changed'

const PET_SCALE_DEFAULT = 0.5
export const PET_SCALE_MIN = 0.25
export const PET_SCALE_MAX = 1.5
const PET_FRAME_RATE_DEFAULT = 1
export const PET_FRAME_RATE_MIN = 0.25
export const PET_FRAME_RATE_MAX = 3

function readNum(key: string, def: number): number {
  try {
    const v = parseFloat(localStorage.getItem(key) ?? '')
    return Number.isFinite(v) ? v : def
  } catch { return def }
}

function readBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? def : v === 'true'
  } catch { return def }
}

function emit() {
  window.dispatchEvent(new Event(EVENT))
}

export function getPetScale(): number {
  return Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, readNum(SCALE_KEY, PET_SCALE_DEFAULT)))
}
export function setPetScale(v: number) {
  try { localStorage.setItem(SCALE_KEY, String(v)) } catch {}
  emit()
}

const FRAME_RATE_KEY = 'vibe-ide-pet-frame-rate'

export function getPetFrameRate(): number {
  return Math.min(PET_FRAME_RATE_MAX, Math.max(PET_FRAME_RATE_MIN, readNum(FRAME_RATE_KEY, PET_FRAME_RATE_DEFAULT)))
}
export function setPetFrameRate(v: number) {
  try { localStorage.setItem(FRAME_RATE_KEY, String(v)) } catch {}
  emit()
}

export function getPetVisible(): boolean { return readBool(VISIBLE_KEY, true) }
export function setPetVisible(v: boolean) {
  try { localStorage.setItem(VISIBLE_KEY, String(v)) } catch {}
  emit()
}

export interface PetPos { left: number; top: number }

export function getPetPos(): PetPos | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p.left === 'number' && typeof p.top === 'number') return p
  } catch {}
  return null
}

export function setPetPos(p: PetPos) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch {}
}

export function resetPetPos() {
  try { localStorage.removeItem(POS_KEY) } catch {}
  emit()
}

// 逻辑状态 → manifest state 名映射（用户可在设置里为 idle/busy/warn/unfocused 各选一个 row）。
// 只做存储，类型与默认值由 stateMap.ts 持有，避免循环依赖。
const LOGICAL_STATE_KEY = 'vibe-ide-pet-logical-states'

export function getPetLogicalStateOverride(logical: string): string | undefined {
  try {
    const raw = localStorage.getItem(LOGICAL_STATE_KEY)
    if (!raw) return undefined
    const p = JSON.parse(raw)
    if (p && typeof p === 'object') return p[logical]
  } catch {}
  return undefined
}

export function setPetLogicalState(logical: string, stateName: string) {
  try {
    let cur: Record<string, unknown> = {}
    const raw = localStorage.getItem(LOGICAL_STATE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') cur = parsed as Record<string, unknown>
    }
    cur[logical] = stateName
    localStorage.setItem(LOGICAL_STATE_KEY, JSON.stringify(cur))
  } catch {}
  emit()
}

const LOGICAL_FRAMES_KEY = 'vibe-ide-pet-logical-frames'

export function getPetLogicalFramesOverride(logical: string): number | undefined {
  try {
    const raw = localStorage.getItem(LOGICAL_FRAMES_KEY)
    if (!raw) return undefined
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && typeof p[logical] === 'number') return p[logical]
  } catch {}
  return undefined
}

export function setPetLogicalFrames(logical: string, frames: number) {
  try {
    let cur: Record<string, unknown> = {}
    const raw = localStorage.getItem(LOGICAL_FRAMES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') cur = parsed as Record<string, unknown>
    }
    cur[logical] = frames
    localStorage.setItem(LOGICAL_FRAMES_KEY, JSON.stringify(cur))
  } catch {}
  emit()
}

const LISTEN_AI_KEY = 'vibe-ide-pet-listen-ai'
const LISTEN_DSH_KEY = 'vibe-ide-pet-listen-dsh'

export function getPetListenAi(): boolean { return readBool(LISTEN_AI_KEY, false) }
export function setPetListenAi(v: boolean) {
  try { localStorage.setItem(LISTEN_AI_KEY, String(v)) } catch {}
  emit()
}

export function getPetListenDsh(): boolean { return readBool(LISTEN_DSH_KEY, false) }
export function setPetListenDsh(v: boolean) {
  try { localStorage.setItem(LISTEN_DSH_KEY, String(v)) } catch {}
  emit()
}

export function onPetPrefsChanged(cb: () => void): () => void {
  const h = () => cb()
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
