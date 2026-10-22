const KEYPAD_STORAGE_KEY = 'vibe-ide-keypad-items'

export type KeypadMode = 'interject' | 'btw'

export interface KeypadItem { code: string; key: string; text: string; mode: KeypadMode }

const DEFAULT_KEYPAD_ITEMS: KeypadItem[] = [
  { code: 'Numpad4', key: '4', text: '用户视角解释', mode: 'btw' },
  { code: 'Numpad5', key: '5', text: '继续', mode: 'interject' },
  { code: 'Numpad6', key: '6', text: '反问我需求', mode: 'interject' },
  { code: 'Numpad1', key: '1', text: '给出多个方案，陈述利弊', mode: 'interject' },
  { code: 'Numpad2', key: '2', text: '清理相关死代码', mode: 'interject' },
  { code: 'Numpad3', key: '3', text: '检视无误并提交', mode: 'interject' },
]

export function getDefaultKeypadItems(): KeypadItem[] {
  return DEFAULT_KEYPAD_ITEMS.map(d => ({ ...d }))
}

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
            mode: item?.mode === 'btw' || item?.mode === 'interject' ? item.mode : d.mode,
          }
        })
      }
    }
  } catch {}
  return DEFAULT_KEYPAD_ITEMS
}

export function saveKeypadItems(items: KeypadItem[]) {
  try { localStorage.setItem(KEYPAD_STORAGE_KEY, JSON.stringify(items)) } catch {}
}

const BTW_PREFIX_KEY = 'vibe-ide-btw-prefix'

export function loadBtwPrefix(): string {
  try {
    const raw = localStorage.getItem(BTW_PREFIX_KEY)
    if (raw && raw.trim()) return raw
  } catch {}
  return ''
}

export function saveBtwPrefix(prefix: string): void {
  try { localStorage.setItem(BTW_PREFIX_KEY, prefix.trim()) } catch {}
}
