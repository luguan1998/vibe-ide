export function slugify(text: string, max = 30): string {
  return text
    .toLowerCase()
    .split('')
    .map(c => (/[a-z0-9]/.test(c) ? c : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

export function uniqueName(base: string, taken: (name: string) => boolean): string {
  let name = base
  let n = 2
  while (taken(name)) name = `${base}-${n++}`
  return name
}
