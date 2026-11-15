import { baseName } from '../fileTabs'

export function hasExternalFileDrag(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

export function droppedFilePaths(e: { dataTransfer: DataTransfer | null }): string[] {
  if (!e.dataTransfer) return []
  return Array.from(e.dataTransfer.files)
    .map(f => window.api.file.getPathForFile(f))
    .filter((p): p is string => !!p)
}

export async function copyExternalFilesInto(paths: string[], destDir: string): Promise<void> {
  const sep = destDir.includes('\\') ? '\\' : '/'
  const base = destDir.replace(/[\\/]+$/, '')
  for (const src of paths) {
    const name = baseName(src)
    if (!name) continue
    await window.api.file.copy(src, base + sep + name)
  }
}
