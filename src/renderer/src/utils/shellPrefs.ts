const MAIN_TERM_TYPE_KEY = 'vibe-ide-term-type'
const AUX_TERM_TYPE_KEY = 'vibe-ide-aux-term-type'

export function getMainShellType(): string {
  try { return localStorage.getItem(MAIN_TERM_TYPE_KEY) || 'pwsh' } catch { return 'pwsh' }
}

export function setMainShellType(value: string): void {
  try { localStorage.setItem(MAIN_TERM_TYPE_KEY, value) } catch {}
}

export function getAuxShellType(): string {
  try { return localStorage.getItem(AUX_TERM_TYPE_KEY) || 'cmd' } catch { return 'cmd' }
}

export function setAuxShellType(value: string): void {
  try { localStorage.setItem(AUX_TERM_TYPE_KEY, value) } catch {}
}
