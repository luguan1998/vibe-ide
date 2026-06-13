/**
 * Centralized keyboard shortcut registry.
 *
 * Shortcuts are identified by a stable `id` (e.g. "search.focus").
 * Default keybindings are defined here.  User overrides are stored in
 * localStorage under `vibe-ide-keybindings`.
 *
 * Key format (storage):  "Ctrl+Equal", "Ctrl+Shift+F", "Ctrl+ArrowUp"
 *   → modifier(s) + `KeyboardEvent.code`, joined by `+`.
 *
 * Display format:        "Ctrl+=", "Ctrl+Shift+F", "Ctrl+↑"
 *   → code values mapped to human-readable labels.
 */

// ── types ──────────────────────────────────────────────────────────
export interface ShortcutDef {
  id: string
  label: string // human-readable action name
  defaultKeys: string // e.g. "Ctrl+KeyF"
  readonly?: boolean // display-only, not rebindable
}

export interface ParsedKeybinding {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  code: string // KeyboardEvent.code value
}

// ── code ↔ label maps ──────────────────────────────────────────────

const CODE_TO_LABEL: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  NumpadAdd: 'Numpad +',
  NumpadSubtract: 'Numpad -',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  KeyF: 'F',
  KeyS: 'S',
  Enter: 'Enter',
  Escape: 'Esc',
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  KeyL: 'L',
}

const LABEL_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CODE_TO_LABEL).map(([k, v]) => [v, k]),
)

/** KeyboardEvent.code → human label (falls back to stripping "Key" / "Digit" prefix) */
export function codeToLabel(code: string): string {
  if (CODE_TO_LABEL[code]) return CODE_TO_LABEL[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

/** Human label → KeyboardEvent.code (reverse of above) */
export function labelToCode(label: string): string {
  if (LABEL_TO_CODE[label]) return LABEL_TO_CODE[label]
  if (label.length === 1) return `Key${label.toUpperCase()}`
  return label
}

// ── parse / serialise ──────────────────────────────────────────────

/** Parse a stored keybinding string into its parts */
export function parseKeybinding(raw: string): ParsedKeybinding {
  const parts = raw.split('+')
  const ctrl = parts.includes('Ctrl')
  const shift = parts.includes('Shift')
  const alt = parts.includes('Alt')
  const meta = parts.includes('Meta')
  const code = parts.find((p) => !['Ctrl', 'Shift', 'Alt', 'Meta'].includes(p)) || ''
  return { ctrl, shift, alt, meta, code }
}

/** Build a storage-format keybinding string from a KeyboardEvent */
export function keybindingFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('Meta')
  parts.push(e.code)
  return parts.join('+')
}

/** Storage-format → human-readable display string */
export function displayLabel(raw: string): string {
  const p = parseKeybinding(raw)
  const mods: string[] = []
  if (p.ctrl) mods.push('Ctrl')
  if (p.shift) mods.push('Shift')
  if (p.alt) mods.push('Alt')
  if (p.meta) mods.push('Meta')
  mods.push(codeToLabel(p.code))
  return mods.join('+')
}

/** Check whether a KeyboardEvent matches a stored keybinding */
export function eventMatchesBinding(e: KeyboardEvent, raw: string): boolean {
  const p = parseKeybinding(raw)
  return (
    e.ctrlKey === p.ctrl &&
    e.shiftKey === p.shift &&
    e.altKey === p.alt &&
    e.metaKey === p.meta &&
    e.code === p.code
  )
}

// ── default shortcuts ──────────────────────────────────────────────

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'search.focus',
    label: 'Focus Search',
    defaultKeys: 'Ctrl+KeyF',
  },
  {
    id: 'terminal.next',
    label: 'Next Terminal',
    defaultKeys: 'Ctrl+ArrowDown',
  },
  {
    id: 'terminal.prev',
    label: 'Previous Terminal',
    defaultKeys: 'Ctrl+ArrowUp',
  },
  {
    id: 'font.increase',
    label: 'Font Size Increase',
    defaultKeys: 'Ctrl+Equal',
  },
  {
    id: 'font.decrease',
    label: 'Font Size Decrease',
    defaultKeys: 'Ctrl+Minus',
  },
  {
    id: 'panel.tabRight',
    label: 'Panel Tab Right',
    defaultKeys: 'Ctrl+ArrowRight',
  },
  {
    id: 'panel.tabLeft',
    label: 'Panel Tab Left',
    defaultKeys: 'Ctrl+ArrowLeft',
  },

  {
    id: 'terminal.newline',
    label: 'Terminal Newline',
    defaultKeys: 'Shift+Enter',
  },
  {
    id: 'terminal.pageDown',
    label: 'Terminal Page Down',
    defaultKeys: 'PageDown',
  },
  {
    id: 'terminal.pageUp',
    label: 'Terminal Page Up',
    defaultKeys: 'PageUp',
  },
  {
    id: 'terminal.history',
    label: 'Command History',
    defaultKeys: 'Ctrl+KeyH',
  },
  {
    id: 'terminal.contextMenu',
    label: 'Terminal Copy/Paste',
    defaultKeys: 'Right-click',
    readonly: true,
  },
  {
    id: 'navigate.back',
    label: 'Navigate Back',
    defaultKeys: 'Alt+ArrowLeft',
  },
  {
    id: 'navigate.forward',
    label: 'Navigate Forward',
    defaultKeys: 'Alt+ArrowRight',
  },
  {
    id: 'codegraph.open',
    label: 'Open Code Graph Search',
    defaultKeys: 'Alt+KeyK',
  },
  {
    id: 'terminal.search',
    label: 'Search Terminal',
    defaultKeys: 'Alt+KeyF',
  },
  {
    id: 'terminal.jumpPrevPrompt',
    label: 'Jump to Previous Prompt',
    defaultKeys: 'Alt+ArrowUp',
  },
  {
    id: 'terminal.jumpNextPrompt',
    label: 'Jump to Next Prompt',
    defaultKeys: 'Alt+ArrowDown',
  },
  {
    id: 'diff.close',
    label: 'Close Diff / Back',
    defaultKeys: 'Escape',
    readonly: true,
  },
  {
    id: 'view.togglePreview',
    label: 'Toggle Preview / Edit',
    defaultKeys: 'Ctrl+KeyL',
  },
]

const STORAGE_KEY = 'vibe-ide-keybindings'

// ── public API ─────────────────────────────────────────────────────

/** Get effective keybindings (defaults merged with user overrides) */
export function getShortcuts(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const s of DEFAULT_SHORTCUTS) {
    map[s.id] = s.defaultKeys
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const overrides = JSON.parse(raw) as Record<string, string>
      for (const [id, keys] of Object.entries(overrides)) {
        if (typeof keys !== 'string') continue
        if (map[id] !== undefined) map[id] = keys
      }
    }
  } catch { /* ignore corrupt storage */ }
  return map
}

/** Get all shortcut definitions (for display) */
export function getAllShortcutDefs(): ShortcutDef[] {
  return DEFAULT_SHORTCUTS
}

/** Save a custom keybinding for one shortcut */
export function saveShortcut(id: string, keys: string): void {
  const overrides: Record<string, string> = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) Object.assign(overrides, JSON.parse(raw))
  } catch {}
  overrides[id] = keys
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

/** Reset all keybindings to defaults */
export function resetShortcuts(): void {
  localStorage.removeItem(STORAGE_KEY)
}
