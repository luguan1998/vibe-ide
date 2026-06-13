export interface Frontmatter {
  [key: string]: string | string[]
}

export function parseFrontmatter(md: string): { meta: Frontmatter | null; body: string } {
  const trimmed = md.trimStart()
  if (!trimmed.startsWith('---')) return { meta: null, body: md }
  const second = trimmed.indexOf('---', 3)
  if (second === -1) return { meta: null, body: md }
  const fmBlock = trimmed.slice(3, second)
  const body = trimmed.slice(second + 3).trimStart()
  const meta: Frontmatter = {}
  for (const line of fmBlock.split('\n')) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue
    const ci = trimmedLine.indexOf(':')
    if (ci === -1) continue
    const key = trimmedLine.slice(0, ci).trim()
    const rawVal = trimmedLine.slice(ci + 1).trim()
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      meta[key] = rawVal.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    } else {
      meta[key] = rawVal.replace(/^['"]|['"]$/g, '')
    }
  }
  return { meta: Object.keys(meta).length > 0 ? meta : null, body }
}
