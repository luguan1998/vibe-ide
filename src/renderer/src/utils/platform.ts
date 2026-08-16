export const isMac = /Mac/i.test(navigator.userAgent)
export const DEFAULT_MONO_FONT = isMac ? 'Menlo' : 'Consolas'
export function resolveStoredFont(stored: string | null): string {
  if (stored && stored !== 'Consolas') return stored
  return DEFAULT_MONO_FONT
}
