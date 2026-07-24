// 桌面宠物本地偏好（localStorage + 事件），供 DesktopPet 与外观面板共享。

const SCALE_KEY = 'vibe-ide-pet-scale'
const VISIBLE_KEY = 'vibe-ide-pet-visible'
const POS_KEY = 'vibe-ide-pet-pos'
const EVENT = 'vibe-ide-pet-prefs-changed'

export const PET_SCALE_DEFAULT = 0.5
export const PET_SCALE_MIN = 0.25
export const PET_SCALE_MAX = 1.5

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

export function onPetPrefsChanged(cb: () => void): () => void {
  const h = () => cb()
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
