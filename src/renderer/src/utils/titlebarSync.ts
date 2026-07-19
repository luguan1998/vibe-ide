function cssVarToHex(varName: string, fallback = '#888888'): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  const parts = raw.split(/\s+/).map(Number)
  if (parts.length >= 3 && parts.slice(0, 3).every(n => Number.isFinite(n) && n >= 0 && n <= 255)) {
    return '#' + parts.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('')
  }
  if (raw.startsWith('#') && raw.length === 7) return raw
  return fallback
}

function bgToHex(el: Element | null): string | null {
  if (!el) return null
  const bg = getComputedStyle(el).backgroundColor
  const m = bg.match(/rgba?\(\s*([^)]+)\s*\)/)
  if (!m) return null
  const parts = m[1].split(',').map(s => parseFloat(s.trim()))
  if (parts.length < 3 || !parts.slice(0, 3).every(n => Number.isFinite(n) && n >= 0 && n <= 255)) return null
  const alpha = parts.length >= 4 ? parts[3] : 1
  if (alpha <= 0) return null
  return '#' + parts.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('')
}

export function syncTitleBarOverlay(): void {
  if (!window.api?.theme?.setTitleBar) return
  const fallback = cssVarToHex('--ide-sidebar', '#1a1a2e')
  const color = bgToHex(document.querySelector('.titlebar-drag .no-drag'))
    ?? bgToHex(document.querySelector('.titlebar-drag'))
    ?? fallback
  const symbolColor = cssVarToHex('--ide-titlebar-symbol', '')
    || cssVarToHex('--ide-text-muted', '#8888aa')
  window.api.theme.setTitleBar({ color, symbolColor, backgroundColor: color })
}
