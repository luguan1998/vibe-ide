import { getFileInfo } from './components/FileIcons'

export type FileTabKind = 'diff' | 'markdown' | 'image'

export interface FileTabCommon {
  id: string
  kind: FileTabKind
  fullPath: string
  fileName: string
  lineNumber?: number
  jumpNonce?: number
}

export interface DiffFileTab extends FileTabCommon {
  kind: 'diff'
  filePath: string
  isStaged: boolean
  commitHash?: string
  gitStats?: { additions: number; deletions: number }
  defaultEdit?: boolean
  viewMode?: 'diff' | 'edit'
  revision: number
  compareOriginalContent?: string
  compareOriginalPath?: string
}

export interface MarkdownFileTab extends FileTabCommon {
  kind: 'markdown'
}

export interface ImageFileTab extends FileTabCommon {
  kind: 'image'
}

export type FileTab = DiffFileTab | MarkdownFileTab | ImageFileTab

export const MAX_FILE_TABS = 7

const normTabPath = (p: string) => p.replace(/\\/g, '/')

export const baseName = (fullPath: string) => fullPath.split(/[\\/]/).pop() || fullPath

export function tabKey(t: FileTab): string {
  if (t.kind !== 'diff') return `${t.kind}|${normTabPath(t.fullPath)}`
  const variant = t.commitHash ?? (t.isStaged ? 'staged' : 'working')
  const cmp = t.compareOriginalPath ? normTabPath(t.compareOriginalPath) : ''
  return `diff|${normTabPath(t.fullPath)}|${variant}|${cmp}`
}

export const makeTabId = (kind: FileTabKind) =>
  `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function autoViewKind(fullPath: string): FileTabKind {
  const name = baseName(fullPath)
  if (/\.(md|mdx|markdown)$/i.test(name)) return 'markdown'
  if (getFileInfo(name).kind === 'image') return 'image'
  return 'diff'
}

export interface TabSnapshot {
  buffer?: string
  dirty: boolean
  viewMode?: 'diff' | 'edit'
  encoding?: string
  line?: number
}

export interface TabRuntime {
  dirty: boolean
  save: () => Promise<void> | void
}
