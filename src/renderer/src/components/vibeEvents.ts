export const ADD_ANNOTATION_EVENT = 'vibe-ide-add-annotation'

export function toRelPath(full: string | undefined | null, cwd?: string | null): string {
  const f = (full || '').replace(/\\/g, '/')
  const w = cwd ? cwd.replace(/\\/g, '/').replace(/\/$/, '') : ''
  return w && (f === w || f.startsWith(w + '/')) ? f.slice(w.length).replace(/^\//, '') : f
}
