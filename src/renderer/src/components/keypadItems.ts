const KEYPAD_STORAGE_KEY = 'vibe-ide-keypad-items'
export const KEYPAD_CHANGED = 'vibe-ide-keypad-changed'

export const DEFAULT_KEYPAD_ITEMS: { code: string; key: string; text: string }[] = [
  { code: 'Numpad4', key: '4', text: '说中文' },
  { code: 'Numpad5', key: '5', text: '继续' },
  { code: 'Numpad6', key: '6', text: '还是报错' },
  { code: 'Numpad1', key: '1', text: '先别重构,整理实际需求' },
  { code: 'Numpad2', key: '2', text: '清理死代码' },
  { code: 'Numpad3', key: '3', text: '讲明白点' },
]

export function loadKeypadItems(): { code: string; key: string; text: string }[] {
  try {
    const raw = localStorage.getItem(KEYPAD_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length === 6) {
        return DEFAULT_KEYPAD_ITEMS.map((d, i) => ({ ...d, text: typeof parsed[i]?.text === 'string' ? parsed[i].text : d.text }))
      }
    }
  } catch {}
  return DEFAULT_KEYPAD_ITEMS
}

export function saveKeypadItems(items: { code: string; key: string; text: string }[]) {
  try { localStorage.setItem(KEYPAD_STORAGE_KEY, JSON.stringify(items)) } catch {}
  window.dispatchEvent(new Event(KEYPAD_CHANGED))
}

export function onKeypadChanged(cb: () => void): () => void {
  const h = () => cb()
  window.addEventListener(KEYPAD_CHANGED, h)
  return () => window.removeEventListener(KEYPAD_CHANGED, h)
}

const BTW_PREFIX_KEY = 'vibe-ide-btw-prefix'
const DEFAULT_BTW_PREFIX = ''
export const BTW_PREFIX_CHANGED = 'vibe-ide-btw-prefix-changed'

export function loadBtwPrefix(): string {
  try {
    const raw = localStorage.getItem(BTW_PREFIX_KEY)
    if (raw && raw.trim()) return raw
  } catch {}
  return DEFAULT_BTW_PREFIX
}

export function saveBtwPrefix(prefix: string): void {
  try { localStorage.setItem(BTW_PREFIX_KEY, prefix.trim() || DEFAULT_BTW_PREFIX) } catch {}
  window.dispatchEvent(new Event(BTW_PREFIX_CHANGED))
}

export function onBtwPrefixChanged(cb: () => void): () => void {
  const h = () => cb()
  window.addEventListener(BTW_PREFIX_CHANGED, h)
  return () => window.removeEventListener(BTW_PREFIX_CHANGED, h)
}
