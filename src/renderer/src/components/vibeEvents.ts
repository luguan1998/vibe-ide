export const ADD_ANNOTATION_EVENT = 'vibe-ide-add-annotation'
export const BTW_REPLY_EVENT = 'vibe-ide-btw-reply'

export function toRelPath(full: string | undefined | null, cwd?: string | null): string {
  const f = (full || '').replace(/\\/g, '/')
  const w = cwd ? cwd.replace(/\\/g, '/').replace(/\/$/, '') : ''
  return w && (f === w || f.startsWith(w + '/')) ? f.slice(w.length).replace(/^\//, '') : f
}
