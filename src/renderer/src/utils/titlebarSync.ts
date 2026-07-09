function cssVarToHex(varName: string, fallback = '#888888'): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  const parts = raw.split(/\s+/).map(Number)
  if (parts.length >= 3 && parts.slice(0, 3).every(n => Number.isFinite(n) && n >= 0 && n <= 255)) {
    return '#' + parts.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('')
  }
  if (raw.startsWith('#') && raw.length === 7) return raw
  return fallback
}

export function syncTitleBarOverlay(): void {
  if (!window.api?.theme?.setTitleBar) return
  const color = cssVarToHex('--ide-sidebar', '#1a1a2e')
  const symbolColor = cssVarToHex('--ide-text-muted', '#8888aa')
  window.api.theme.setTitleBar({ color, symbolColor, backgroundColor: color })
}
