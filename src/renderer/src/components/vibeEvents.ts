export const ADD_ANNOTATION_EVENT = 'vibe-ide-add-annotation'
export const QUICK_OPEN_EVENT = 'vibe-ide-quick-open'
export const BTW_REPLY_EVENT = 'vibe-ide-btw-reply'
export const PET_OUTSIDE_CLICK_EVENT = 'vibe-ide-pet-outside-click'

export function toRelPath(full: string | undefined | null, cwd?: string | null): string {
  const f = (full || '').replace(/\\/g, '/')
  const w = cwd ? cwd.replace(/\\/g, '/').replace(/\/$/, '') : ''
  return w && (f === w || f.startsWith(w + '/')) ? f.slice(w.length).replace(/^\//, '') : f
}
