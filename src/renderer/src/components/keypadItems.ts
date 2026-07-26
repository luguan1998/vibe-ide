const KEYPAD_STORAGE_KEY = 'vibe-ide-keypad-items'
export const KEYPAD_CHANGED = 'vibe-ide-keypad-changed'

export interface KeypadItem { code: string; key: string; text: string; directSend: boolean }

export const DEFAULT_KEYPAD_ITEMS: KeypadItem[] = [
  { code: 'Numpad4', key: '4', text: '说中文', directSend: true },
  { code: 'Numpad5', key: '5', text: '继续', directSend: true },
  { code: 'Numpad6', key: '6', text: '还是报错', directSend: true },
  { code: 'Numpad1', key: '1', text: '先别重构,整理实际需求', directSend: true },
  { code: 'Numpad2', key: '2', text: '清理死代码', directSend: true },
  { code: 'Numpad3', key: '3', text: '讲明白点', directSend: true },
]

export function loadKeypadItems(): KeypadItem[] {
  try {
    const raw = localStorage.getItem(KEYPAD_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length === 6) {
        return DEFAULT_KEYPAD_ITEMS.map((d, i) => {
          const item = parsed[i]
          return {
            ...d,
            text: typeof item?.text === 'string' ? item.text : d.text,
            directSend: typeof item?.directSend === 'boolean' ? item.directSend : d.directSend,
          }
        })
      }
    }
  } catch {}
  return DEFAULT_KEYPAD_ITEMS
}

export function saveKeypadItems(items: { code: string; key: string; text: string; directSend: boolean }[]) {
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
