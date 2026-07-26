import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Lightbulb, Clock, X, Pencil, Search, Filter, FileText } from 'lucide-react'
import { FileNode, RecentFileEntry, GrepMatch, CodeSymbol } from '@shared/types'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
import { trimToMatch, highlightMatches } from './SearchPanel'
import { parseDocTree, DocTreeItem, DocTreeNode, loadMdContent } from './DocTree'
import { useI18n } from '../i18n'

// File clipboard for cut/copy/paste
interface FileClipboard {
  path: string
  name: string
  operation: 'copy' | 'cut'
}

// ── file filter rules ──

const FILTER_RULES_KEY = 'vibe-ide-file-filter-rules'

export const DEFAULT_FILTER_RULES = ['.git', '.vscode', 'node_modules', 'dist', 'build', '.next', 'out', '__pycache__', 'target', '.cache']

export function loadFilterRules(): string[] {
  try {
    const raw = localStorage.getItem(FILTER_RULES_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.every((v: any) => typeof v === 'string')) return arr
    }
  } catch {}
  return [...DEFAULT_FILTER_RULES]
}

export function saveFilterRules(rules: string[]) {
  try { localStorage.setItem(FILTER_RULES_KEY, JSON.stringify(rules)) } catch {}
}

// ── FileTab section visibility (recently / arch) ──

interface FileTabSectionVis { recently: boolean; arch: boolean }

const DEFAULT_SECTION_VIS: FileTabSectionVis = { recently: true, arch: true }

// ──

interface FileTabProps {
  workspacePath: string | null
  onOpenFileFromExplorer?: (fullPath: string) => void
  onCompareWithCurrent?: (fullPath: string) => void
  currentEditFilePath?: string | null
  onPreviewMarkdown?: (fullPath: string, fileName: string) => void
  onPreviewImage?: (fullPath: string, fileName: string) => void
  refreshKey?: number
  navigateToFile?: { trigger: number; filePath: string } | null
  onRefresh?: () => void
  recentFiles?: RecentFileEntry[]
  onOpenRecentFile?: (fullPath: string, lineNumber?: number) => void
  onRemoveRecentFile?: (fullPath: string) => void
  onEditRecentFile?: (fullPath: string, lineNumber?: number) => void
  onOpenFileAtLine?: (fullPath: string, lineNumber?: number) => void
  isActive?: boolean
  brushActive?: boolean
  onExploreNode?: (node: CodeSymbol) => void
}

// Workspace-root inline input (new file/folder at root level)
function RootInput({ editingState, onEditSubmit, onEditCancel, t }: {
  editingState: { type: 'rename' | 'newFile' | 'newFolder'; nodePath: string; error?: string }
  onEditSubmit: (value: string) => void
  onEditCancel: () => void
  t: (key: string) => string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onEditSubmit(inputRef.current?.value || '')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onEditCancel()
    }
  }

  return (
    <div className="flex flex-col py-1">
      <div className="pr-2 py-0.5 text-xs flex items-center gap-0.5 bg-ide-accent/10" style={{ paddingLeft: 16 }}>
        <span className="w-3 shrink-0" />
        {editingState.type === 'newFolder' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon text-ide-warning shrink-0">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="currentColor" className="ft-icon shrink-0 text-ide-text-muted"
            dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS.default }} />
        )}
        <input
          ref={inputRef}
          className="flex-1 min-w-0 bg-ide-bg border border-ide-accent rounded px-1 py-px text-xs text-ide-text outline-none"
          placeholder={editingState.type === 'newFolder' ? t('Folder name') : t('File name')}
          onKeyDown={handleKeyDown}
          onBlur={() => onEditCancel()}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {editingState?.error && (
        <div style={{ paddingLeft: 16 }} className="py-0.5 text-[11px] text-ide-danger">
          {editingState.error}
        </div>
      )}
    </div>
  )
}

// Normalize path separators for cross-platform comparison
function norm(p: string): string {
  return p.replace(/\\/g, '/')
}

function toRelPath(fullPath: string, workspace: string | null): string {
  if (!workspace) return fullPath
  const f = norm(fullPath)
  const w = norm(workspace).replace(/\/+$/, '')
  if (!w) return fullPath
  const lower = w.toLowerCase()
  if (f.toLowerCase() === lower) return fullPath
  if (f.toLowerCase().startsWith(lower + '/')) {
    return f.slice(w.length + 1).replace(/\//g, '\\')
  }
  return fullPath
}

function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  const t = norm(targetPath)
  for (const n of nodes) {
    if (norm(n.path) === t) return n
    if (n.children) {
      const found = findNodeByPath(n.children, targetPath)
      if (found) return found
    }
  }
  return null
}

function setNodeChildren(nodes: FileNode[], targetPath: string, children: FileNode[]): FileNode[] {
  const t = norm(targetPath)
  let changed = false
  const next = nodes.map(n => {
    if (norm(n.path) === t) { changed = true; return { ...n, children } }
    if (n.children && findNodeByPath(n.children, targetPath)) {
      changed = true
      return { ...n, children: setNodeChildren(n.children, targetPath, children) }
    }
    return n
  })
  return changed ? next : nodes
}

function setNodesChildrenMap(nodes: FileNode[], map: Map<string, FileNode[]>): FileNode[] {
  if (map.size === 0) return nodes
  return nodes.map(n => {
    const key = norm(n.path)
    if (map.has(key)) return { ...n, children: setNodesChildrenMap(map.get(key)!, map) }
    return n
  })
}

interface NameMatch { name: string; path: string; type: 'file' | 'directory'; relativePath: string }

function compactFileNodes(nodes: FileNode[]) {
  const compact = (n: FileNode) => {
    if (!n.children) return
    for (const ch of n.children) compact(ch)
    let kids = n.children
    while (kids.length === 1 && kids[0].type === 'directory') {
      const child = kids[0]
      n.name = n.name ? `${n.name}/${child.name}` : child.name
      n.path = child.path
      n.children = child.children
      kids = child.children || []
    }
  }
  nodes.forEach(compact)
}

function buildTreeFromMatches(matches: NameMatch[], cwd: string): FileNode[] {
  const root: FileNode[] = []
  const dirMap = new Map<string, FileNode>()
  const rootPath = norm(cwd).replace(/\/$/, '')
  for (const m of matches) {
    const segs = norm(m.relativePath).split('/').filter(Boolean)
    let level = root
    let cur = rootPath
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      cur = cur + '/' + seg
      if (i === segs.length - 1) {
        if (dirMap.has(cur)) break
        level.push({ name: seg, path: m.path, type: m.type })
      } else {
        let dir = dirMap.get(cur)
        if (!dir) {
          dir = { name: seg, path: cur, type: 'directory', children: [] }
          dirMap.set(cur, dir)
          level.push(dir)
        }
        level = dir.children!
      }
    }
  }
  compactFileNodes(root)
  return root
}

function collectDirPaths(nodes: FileNode[], acc: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.type === 'directory') { acc.add(norm(n.path)); if (n.children) collectDirPaths(n.children, acc) }
    else if (n.children) collectDirPaths(n.children, acc)
  }
  return acc
}

// File tree item component
function FileTreeItem({ node, depth, expandedDirs, onToggle, onOpenFile, onContextMenu, editingState, onEditSubmit, onEditCancel, highlightedFilePath, onPreviewMarkdown, onPreviewImage, onSearchInFolder, inlineSearch, onCopyPath }: {
  node: FileNode
  depth: number
  expandedDirs: Set<string>
  onToggle: (path: string) => void
  onOpenFile: (fullPath: string) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  editingState: { type: 'rename' | 'newFile' | 'newFolder'; nodePath: string; error?: string } | null
  onEditSubmit: (value: string) => void
  onEditCancel: () => void
  highlightedFilePath: string | null
  onPreviewMarkdown?: (fullPath: string, fileName: string) => void
  onPreviewImage?: (fullPath: string, fileName: string) => void
  onSearchInFolder?: (path: string) => void
  inlineSearch?: InlineSearch
  onCopyPath?: (fullPath: string) => void
}) {
  const { t } = useI18n()
  const isDir = node.type === 'directory'
  const isSearchFolder = isDir && !!inlineSearch?.activePath && norm(inlineSearch.activePath) === norm(node.path)
  const isExpanded = expandedDirs.has(norm(node.path))
  const paddingLeft = 16 + depth * 16
  const isRenaming = editingState?.type === 'rename' && editingState.nodePath === node.path
  const isCreating = editingState && editingState.nodePath === node.path && (editingState.type === 'newFile' || editingState.type === 'newFolder')
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if ((isRenaming || isCreating) && inputRef.current) {
      inputRef.current.focus()
      if (isRenaming) {
        const dotIdx = node.name.lastIndexOf('.')
        if (dotIdx > 0) {
          inputRef.current.setSelectionRange(0, dotIdx)
        } else {
          inputRef.current.select()
        }
      }
    }
  }, [isRenaming, isCreating])

  const handleClick = (e: React.MouseEvent) => {
    if (isRenaming || isCreating) return
    if (e.ctrlKey && onCopyPath) {
      e.preventDefault()
      e.stopPropagation()
      onCopyPath(node.path)
      return
    }
    if (isDir) {
      onToggle(node.path)
    } else if (node.name.toLowerCase().endsWith('.md') && onPreviewMarkdown) {
      onPreviewMarkdown(node.path, node.name)
    } else if (getFileInfo(node.name).kind === 'image' && onPreviewImage) {
      onPreviewImage(node.path, node.name)
    } else {
      onOpenFile(node.path)
    }
  }

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onEditSubmit(inputRef.current?.value || '')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onEditCancel()
    }
  }

  return (
    <>
      <div
        className={`group pr-2 py-0.5 ft-fname cursor-pointer hover:bg-ide-hover flex items-center gap-0.5 select-none file-tree-item${isDir ? ' file-tree-item--folder' : ' file-tree-item--file'}${highlightedFilePath === norm(node.path) ? ' file-tree-item--active bg-ide-accent/10' : ''}`}
        style={{ paddingLeft }}
        onClick={handleClick}
        onContextMenu={(e) => { if (!isRenaming && !isCreating) onContextMenu(e, node) }}
        data-file-highlighted={highlightedFilePath === norm(node.path) ? 'true' : undefined}
      >
        {isDir ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform shrink-0 file-tree-item__toggle ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isRenaming ? (
          isDir ? (
            isExpanded ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon text-ide-warning shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <path d="M2 10h12l2 4h6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon text-ide-warning shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )
          ) : (
            (() => {
              const info = getFileInfo(node.name)
              return (
                <svg viewBox="0 0 16 16" fill="currentColor" className={`ft-icon shrink-0 ${info.color}`}
                  dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
              )
            })()
          )
        ) : (
          isDir ? (
            isExpanded ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon text-ide-warning shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <path d="M2 10h12l2 4h6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon text-ide-warning shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )
          ) : (
            (() => {
              const info = getFileInfo(node.name)
              return (
                <svg viewBox="0 0 16 16" fill="currentColor" className={`ft-icon shrink-0 ${info.color}`}
                  dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
              )
            })()
          )
        )}
        {isRenaming ? (
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-ide-hover border border-ide-accent rounded px-1 py-px text-xs text-ide-text outline-none"
            defaultValue={node.name}
            onKeyDown={handleInputKeyDown}
            onBlur={() => onEditCancel()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="truncate text-ide-text file-tree-item__name">{node.name}</span>
            {isSearchFolder && inlineSearch ? (
              <div
                className="ml-1 flex items-center gap-0.5 bg-ide-border/30 border border-ide-border group-focus-within:border-ide-accent rounded-full px-2 py-0.5 shrink-0 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Search className="w-3 h-3 text-ide-text-muted shrink-0" />
                <input
                  ref={inlineSearch.inputRef}
                  value={inlineSearch.query}
                  onChange={(e) => inlineSearch.onQueryChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') inlineSearch.onClose() }}
                  placeholder={t('Search')}
                  className="w-16 bg-transparent text-xs text-ide-text outline-none focus-visible:outline-none caret-ide-accent placeholder:text-ide-text-muted/50"
                />
                <button
                  onClick={() => inlineSearch.onToggleCaseSensitive()}
                  title={t('Match case')}
                  className={`shrink-0 px-1 py-0.5 rounded-full text-[11px] font-mono leading-none transition-colors ${inlineSearch.useCaseSensitive ? 'bg-ide-accent/25 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
                >Aa</button>
                <button
                  onClick={() => inlineSearch.onToggleRegex()}
                  title={t('Use regular expression')}
                  className={`shrink-0 px-1 py-0.5 rounded-full text-[11px] font-mono leading-none transition-colors ${inlineSearch.useRegex ? 'bg-ide-accent/25 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
                >.*</button>
                <button
                  onClick={() => inlineSearch.onClose()}
                  title={t('Close')}
                  className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-ide-text-muted hover:text-ide-danger hover:bg-ide-danger/10 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : isDir && onSearchInFolder ? (
              <button
                className="ml-1 shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-accent hover:bg-ide-accent/10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  onSearchInFolder(node.path)
                }}
                title={t('Search in folder')}
              >
                <Search className="ft-icon" />
              </button>
            ) : null}
          </>
        )}
      </div>
      {isRenaming && editingState?.error && (
        <div style={{ paddingLeft }} className="py-0.5 text-[11px] text-ide-danger">
          {editingState.error}
        </div>
      )}
      {isDir && isExpanded && (
        <>
          {isCreating && (
            <div
              className="pr-2 py-0.5 text-xs flex items-center gap-0.5 bg-ide-accent/10"
              style={{ paddingLeft: 16 + (depth + 1) * 16 }}
            >
              <span className="w-3 shrink-0" />
              {editingState!.type === 'newFolder' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon text-ide-warning shrink-0">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="currentColor" className="ft-icon shrink-0 text-ide-text-muted"
                  dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS.default }} />
              )}
              <input
                ref={inputRef}
                className="flex-1 min-w-0 bg-ide-bg border border-ide-accent rounded px-1 py-px text-xs text-ide-text outline-none"
                placeholder={editingState!.type === 'newFolder' ? t('Folder name') : t('File name')}
                onKeyDown={handleInputKeyDown}
                onBlur={() => onEditCancel()}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {isCreating && editingState?.error && (
            <div style={{ paddingLeft: 16 + (depth + 1) * 16 }} className="py-0.5 text-[11px] text-ide-danger">
              {editingState.error}
            </div>
          )}
          {isSearchFolder && inlineSearch && inlineSearch.query.trim() ? (
            <>
              {inlineSearch.searching && (
                <div style={{ paddingLeft: 16 + (depth + 1) * 16 }} className="pr-2 py-0.5 text-xs text-ide-text-muted">{t('Searching...')}</div>
              )}
              {!inlineSearch.searching && inlineSearch.resultTree.length === 0 && (
                <div style={{ paddingLeft: 16 + (depth + 1) * 16 }} className="pr-2 py-0.5 text-xs text-ide-text-muted">{t('No results')}</div>
              )}
              {inlineSearch.resultTree.map(rn => (
                <ResultTreeItem
                  key={rn.path}
                  node={rn}
                  depth={depth + 1}
                  collapsedDirs={inlineSearch.collapsedResultDirs}
                  expandedFiles={inlineSearch.expandedResultFiles}
                  onToggleDir={inlineSearch.onToggleResultDir}
                  onToggleFile={inlineSearch.onToggleResultFile}
                  onOpenFileAtLine={inlineSearch.onOpenFileAtLine}
                  searchQuery={inlineSearch.query}
                  useRegex={inlineSearch.useRegex}
                  useCaseSensitive={inlineSearch.useCaseSensitive}
                />
              ))}
            </>
          ) : (
            node.children?.map(child => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                onContextMenu={onContextMenu}
                editingState={editingState}
                onEditSubmit={onEditSubmit}
                onEditCancel={onEditCancel}
                highlightedFilePath={highlightedFilePath}
                onPreviewMarkdown={onPreviewMarkdown}
                onPreviewImage={onPreviewImage}
                onSearchInFolder={onSearchInFolder}
                inlineSearch={inlineSearch}
                onCopyPath={onCopyPath}
              />
            ))
          )}
        </>
      )}
    </>
  )
}

// ── in-tree search result tree (reuses FileTreeItem visual style) ──
type ResultNode =
  | { type: 'dir'; name: string; path: string; children: ResultNode[]; matchCount: number }
  | { type: 'file'; name: string; path: string; matches: GrepMatch[]; matchCount: number }

// In-place folder search payload (passed into the target FileTreeItem node).
interface InlineSearch {
  activePath: string
  query: string
  resultTree: ResultNode[]
  useRegex: boolean
  useCaseSensitive: boolean
  searching: boolean
  inputRef: React.RefObject<HTMLInputElement>
  onQueryChange: (v: string) => void
  onToggleRegex: () => void
  onToggleCaseSensitive: () => void
  onClose: () => void
  onToggleResultDir: (p: string) => void
  onToggleResultFile: (p: string) => void
  collapsedResultDirs: Set<string>
  expandedResultFiles: Set<string>
  onOpenFileAtLine?: (fp: string, ln?: number) => void
}

function ResultTreeItem({ node, depth, collapsedDirs, expandedFiles, onToggleDir, onToggleFile, onOpenFileAtLine, searchQuery, useRegex, useCaseSensitive }: {
  node: ResultNode
  depth: number
  collapsedDirs: Set<string>
  expandedFiles: Set<string>
  onToggleDir: (path: string) => void
  onToggleFile: (path: string) => void
  onOpenFileAtLine?: (fullPath: string, lineNumber?: number) => void
  searchQuery: string
  useRegex: boolean
  useCaseSensitive: boolean
}) {
  const isDir = node.type === 'dir'
  const expanded = isDir ? !collapsedDirs.has(node.path) : expandedFiles.has(node.path)
  const paddingLeft = 16 + depth * 16
  return (
    <>
      <div
        className="group pr-2 py-0.5 ft-fname cursor-pointer hover:bg-ide-hover flex items-center gap-0.5 select-none"
        style={{ paddingLeft }}
        onClick={() => isDir ? onToggleDir(node.path) : onToggleFile(node.path)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform shrink-0 ${expanded ? 'rotate-0' : '-rotate-90'}`}>
          <path d="M4 6l4 4 4-4" />
        </svg>
        {isDir ? (
          expanded ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon text-ide-warning shrink-0">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <path d="M2 10h12l2 4h6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon text-ide-warning shrink-0">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          )
        ) : (
          (() => {
            const info = getFileInfo(node.name)
            return (
              <svg viewBox="0 0 16 16" fill="currentColor" className={`ft-icon shrink-0 ${info.color}`}
                dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
            )
          })()
        )}
        <span className="truncate text-ide-text">{node.name}</span>
        <span className="ml-auto shrink-0 px-1.5 rounded-full text-[10px] bg-ide-border/40 text-ide-text-muted">{node.matchCount}</span>
      </div>
      {isDir && expanded && node.children.map(child => (
        <ResultTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          collapsedDirs={collapsedDirs}
          expandedFiles={expandedFiles}
          onToggleDir={onToggleDir}
          onToggleFile={onToggleFile}
          onOpenFileAtLine={onOpenFileAtLine}
          searchQuery={searchQuery}
          useRegex={useRegex}
          useCaseSensitive={useCaseSensitive}
        />
      ))}
      {!isDir && expanded && node.matches.map((match, idx) => {
        const { text, head, tail } = trimToMatch(match.content, match.column)
        return (
          <div
            key={`${match.file}-${match.line}-${match.column}-${idx}`}
            className="pr-2 py-0.5 text-xs cursor-pointer hover:bg-ide-hover flex gap-2 items-start"
            style={{ paddingLeft: 16 + (depth + 1) * 16 }}
            onClick={() => onOpenFileAtLine?.(match.fullPath, match.line)}
          >
            <span className="text-ide-text-muted font-mono shrink-0">{match.line}</span>
            <span className="text-ide-text font-mono overflow-hidden whitespace-nowrap">
              {head && <span className="text-ide-text-muted/50">...</span>}
              {highlightMatches(text, searchQuery, useRegex, useCaseSensitive, false)}
              {tail && <span className="text-ide-text-muted/50">...</span>}
            </span>
          </div>
        )
      })}
    </>
  )
}

export default function FileTab({ workspacePath, onOpenFileFromExplorer, onCompareWithCurrent, currentEditFilePath, onPreviewMarkdown, onPreviewImage, refreshKey, navigateToFile, onRefresh, recentFiles = [], onOpenRecentFile, onRemoveRecentFile, onEditRecentFile, onOpenFileAtLine, isActive, brushActive, onExploreNode }: FileTabProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [editingState, setEditingState] = useState<{ type: 'rename' | 'newFile' | 'newFolder'; nodePath: string; error?: string } | null>(null)
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: string; filePath: string; fileName: string } | null>(null)
  const [highlightedFilePath, setHighlightedFilePath] = useState<string | null>(null)
  // ── in-tree content search (reuses search.grep) ──
  const [searchQuery, setSearchQuery] = useState('')
  const [searchScope, setSearchScope] = useState<string | null>(null)
  const [useRegex, setUseRegex] = useState(false)
  const [useCaseSensitive, setUseCaseSensitive] = useState(false)
  const [searchResults, setSearchResults] = useState<GrepMatch[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [expandedResultFiles, setExpandedResultFiles] = useState<Set<string>>(new Set())
  const [collapsedResultDirs, setCollapsedResultDirs] = useState<Set<string>>(new Set())
  const [searchJustClosed, setSearchJustClosed] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [docTree, setDocTree] = useState<DocTreeNode[]>([])
  const [expandedDocDirs, setExpandedDocDirs] = useState<Set<string>>(new Set())
  const [archExpanded, setArchExpanded] = useState(false)
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null)
  const [toastPath, setToastPath] = useState<string | null>(null)
  const [nameFilter, setNameFilter] = useState('')
  const [nameSearchResults, setNameSearchResults] = useState<FileNode[]>([])
  const [nameSearching, setNameSearching] = useState(false)
  const [nameOnly, setNameOnly] = useState(false)
  const { t } = useI18n()

  useEffect(() => {
    if (!toastPath) return
    const id = setTimeout(() => setToastPath(null), 1500)
    return () => clearTimeout(id)
  }, [toastPath])

  // ── recently file section ──
  const [recentExpanded, setRecentExpanded] = useState(true)
  const [selectedRecentIndex, setSelectedRecentIndex] = useState<number | null>(null)
  const [sectionVis, setSectionVis] = useState<FileTabSectionVis>(DEFAULT_SECTION_VIS)
  const [sectionMenu, setSectionMenu] = useState<{ x: number; y: number } | null>(null)
  const selectedRecentIndexRef = useRef<number | null>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  const treeCacheRef = useRef<Map<string, { tree: FileNode[]; expanded: string[] }>>(new Map())
  const prevWsRef = useRef<string | null>(null)
  const navAbortRef = useRef<AbortController | null>(null)
  const fileTreeRef = useRef<FileNode[]>([])
  fileTreeRef.current = fileTree
  const expandedDirsRef = useRef<Set<string>>(new Set())
  expandedDirsRef.current = expandedDirs

  // recently files filtered to current workspace
  const wsRecent = useMemo(() => recentFiles.filter(f => {
    const p = norm(f.path)
    const w = norm(workspacePath || '').replace(/\/$/, '')
    if (!w) return false
    return p === w || p.startsWith(w + '/')
  }), [recentFiles, workspacePath])

  const nameSearchReqId = useRef(0)
  useEffect(() => {
    const q = nameFilter.trim()
    if (!q || !workspacePath) { setNameSearchResults([]); setNameSearching(false); return }
    const reqId = ++nameSearchReqId.current
    setNameSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.file.searchByName(workspacePath, q, loadFilterRules(), nameOnly)
        if (nameSearchReqId.current !== reqId) return
        if (res && !res.error) setNameSearchResults(buildTreeFromMatches(res.matches || [], workspacePath))
        else setNameSearchResults([])
      } catch {
        if (nameSearchReqId.current === reqId) setNameSearchResults([])
      } finally {
        if (nameSearchReqId.current === reqId) setNameSearching(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [nameFilter, workspacePath, nameOnly])

  const filteredTree = useMemo(() => {
    const q = nameFilter.trim()
    return q ? nameSearchResults : fileTree
  }, [fileTree, nameFilter, nameSearchResults])
  const filteredExpanded = useMemo(() => collectDirPaths(filteredTree), [filteredTree])

  // Load file tree (root level only, depth=1 lazy load).
  const loadFileTree = useCallback(async (): Promise<void> => {
    if (!workspacePath) return
    try {
      const skipPatterns = loadFilterRules()
      const result = await window.api.file.tree(workspacePath, 1, skipPatterns)
      if (!result.error) {
        fileTreeRef.current = result
        setFileTree(result)
        treeCacheRef.current.set(norm(workspacePath), {
          tree: structuredClone(result),
          expanded: [...expandedDirsRef.current],
        })
      }
    } catch {}
  }, [workspacePath])

  // Lazy-load children of a directory (single level); no-op if already loaded.
  // Syncs fileTreeRef before setFileTree so consecutive awaits (navigateToFile) see the latest tree.
  const ensureChildrenLoaded = useCallback(async (dirPath: string, signal?: AbortSignal): Promise<void> => {
    const node = findNodeByPath(fileTreeRef.current, dirPath)
    if (!node || node.children !== undefined) return
    if (signal?.aborted) return
    try {
      const skipPatterns = loadFilterRules()
      const result = await window.api.file.tree(dirPath, 1, skipPatterns)
      if (signal?.aborted) return
      if (!result.error) {
        const next = setNodeChildren(fileTreeRef.current, dirPath, result)
        fileTreeRef.current = next
        setFileTree(next)
      }
    } catch {}
  }, [])

  // Reload a single directory's children (local refresh after file ops); invalidates cwd cache.
  const refreshDir = useCallback(async (dirPath: string): Promise<void> => {
    try {
      const skipPatterns = loadFilterRules()
      const result = await window.api.file.tree(dirPath, 1, skipPatterns)
      if (!result.error) {
        if (workspacePath && norm(dirPath) === norm(workspacePath)) {
          fileTreeRef.current = result
          setFileTree(result)
        } else {
          const next = setNodeChildren(fileTreeRef.current, dirPath, result)
          fileTreeRef.current = next
          setFileTree(next)
        }
      }
    } catch {}
    if (workspacePath) treeCacheRef.current.delete(norm(workspacePath))
  }, [workspacePath])

  // Coarse refresh: reload root + every expanded directory in one pass (filter/refresh/fs events).
  const refreshAllExpanded = useCallback(async (): Promise<void> => {
    if (!workspacePath) return
    const skipPatterns = loadFilterRules()
    let rootTree: FileNode[]
    try {
      const r = await window.api.file.tree(workspacePath, 1, skipPatterns)
      if (r.error) return
      rootTree = r
    } catch { return }
    const expanded = [...expandedDirsRef.current]
    const childrenMap = new Map<string, FileNode[]>()
    for (const dir of expanded) {
      try {
        const r = await window.api.file.tree(dir, 1, skipPatterns)
        if (!r.error) childrenMap.set(norm(dir), r)
      } catch {}
    }
    const next = setNodesChildrenMap(rootTree, childrenMap)
    fileTreeRef.current = next
    setFileTree(next)
    treeCacheRef.current.set(norm(workspacePath), {
      tree: structuredClone(next),
      expanded: [...expandedDirsRef.current],
    })
  }, [workspacePath])

  const handleCopyPath = useCallback((fullPath: string) => {
    const rel = toRelPath(fullPath, workspacePath)
    setToastPath(rel)
    navigator.clipboard.writeText(`@${rel}`).catch(() => {})
  }, [workspacePath])

  useEffect(() => {
    if (!workspacePath) return
    const nws = norm(workspacePath)
    if (prevWsRef.current && prevWsRef.current !== nws && fileTreeRef.current.length > 0) {
      treeCacheRef.current.set(prevWsRef.current, {
        tree: structuredClone(fileTreeRef.current),
        expanded: [...expandedDirsRef.current],
      })
    }
    prevWsRef.current = nws
    const cached = treeCacheRef.current.get(nws)
    if (cached) {
      const restored = structuredClone(cached.tree)
      fileTreeRef.current = restored
      setFileTree(restored)
      setExpandedDirs(new Set(cached.expanded))
    } else {
      loadFileTree()
    }
  }, [workspacePath, loadFileTree])

  // Reload file tree when filter rules change
  useEffect(() => {
    const handler = () => { treeCacheRef.current.clear(); refreshAllExpanded() }
    window.addEventListener('file-filter-rules-changed', handler)
    return () => window.removeEventListener('file-filter-rules-changed', handler)
  }, [refreshAllExpanded])

  // Reload when manual refresh triggered
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refreshAllExpanded()
      loadClaudeDocTree()
    }
  }, [refreshKey])

  // Reload when filesystem changes (file watcher push from main process)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const handler = window.api.file.onChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (workspacePath) treeCacheRef.current.delete(norm(workspacePath))
        refreshAllExpanded()
      }, 300)
    })
    return () => { clearTimeout(timer); window.api.file.removeChangedListener(handler) }
  }, [workspacePath, refreshAllExpanded])

  // Load CLAUDE.md (or AGENTS.md) doc tree
  const loadClaudeDocTree = useCallback(async () => {
    if (!workspacePath) { setDocTree([]); return }
    const content = await loadMdContent(workspacePath)
    if (!content) { setDocTree([]); return }
    const docTreeResult = parseDocTree(content)
    setDocTree(docTreeResult)
    setExpandedDocDirs(new Set(docTreeResult.filter(n => n.isDir).map(n => n.path)))
  }, [workspacePath])

  useEffect(() => { loadClaudeDocTree() }, [workspacePath])

  // Toggle directory expand
  const toggleDir = useCallback(async (path: string) => {
    const n = norm(path)
    const willExpand = !expandedDirsRef.current.has(n)
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
    if (willExpand) await ensureChildrenLoaded(path)
  }, [ensureChildrenLoaded])

  // ── in-tree search handlers (被调先于主调:定义在 return 之前) ──
  const openSearch = useCallback((scope: string | null) => {
    setSearchScope(scope)
    if (scope) setExpandedDirs(prev => { const next = new Set(prev); next.add(norm(scope)); return next })
  }, [])

  // Focus the in-place search input once it renders (display:none can't focus → wait for scope→render).
  useEffect(() => {
    if (searchScope !== null) {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [searchScope])

  const closeSearch = useCallback(() => {
    setSearchQuery('')
    setSearchScope(null)
    setSearchJustClosed(true)
    searchInputRef.current?.blur()
  }, [])

  const toggleResultFileExpand = useCallback((file: string) => {
    setExpandedResultFiles(prev => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }, [])

  const groupedResults = useMemo(() => {
    const groups: Record<string, GrepMatch[]> = {}
    for (const m of searchResults) {
      if (!groups[m.file]) groups[m.file] = []
      groups[m.file].push(m)
    }
    return groups
  }, [searchResults])

  const toggleResultDir = useCallback((path: string) => {
    setCollapsedResultDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const compactResultNodes = (nodes: ResultNode[]) => {
    const compact = (n: ResultNode) => {
      if (n.type !== 'dir') return
      for (const ch of n.children) compact(ch)
      let kids = n.children
      while (kids.length === 1 && kids[0].type === 'dir') {
        const child = kids[0]
        n.name = n.name ? `${n.name}/${child.name}` : child.name
        n.path = child.path
        n.children = child.children
        kids = child.children
      }
    }
    nodes.forEach(compact)
  }

  // Build a directory-nested tree from the flat grouped results (dirs first, then by name asc).
  const resultTree = useMemo<ResultNode[]>(() => {
    const root: ResultNode[] = []
    for (const [file, matches] of Object.entries(groupedResults)) {
      const segs = norm(file).split('/').filter(seg => seg && seg !== '.')
      let level = root
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]
        const path = segs.slice(0, i + 1).join('/')
        if (i === segs.length - 1) {
          level.push({ type: 'file', name: seg, path, matches, matchCount: matches.length })
        } else {
          let dir = level.find((n): n is Extract<ResultNode, { type: 'dir' }> => n.type === 'dir' && n.name === seg)
          if (!dir) {
            dir = { type: 'dir', name: seg, path, children: [], matchCount: 0 }
            level.push(dir)
          }
          dir.matchCount += matches.length
          level = dir.children
        }
      }
    }
    const sortRec = (nodes: ResultNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name < b.name ? -1 : 1
      })
      nodes.forEach(n => { if (n.type === 'dir') sortRec(n.children) })
    }
    sortRec(root)
    compactResultNodes(root)
    return root
  }, [groupedResults])

  // In-place folder search payload (built only when a folder is the search target).
  const inlineSearchPayload = useMemo<InlineSearch | undefined>(() => {
    if (!searchScope) return undefined
    return {
      activePath: searchScope,
      query: searchQuery,
      resultTree,
      useRegex,
      useCaseSensitive,
      searching,
      inputRef: searchInputRef,
      onQueryChange: setSearchQuery,
      onToggleRegex: () => setUseRegex(v => !v),
      onToggleCaseSensitive: () => setUseCaseSensitive(v => !v),
      onClose: closeSearch,
      onToggleResultDir: toggleResultDir,
      onToggleResultFile: toggleResultFileExpand,
      collapsedResultDirs,
      expandedResultFiles,
      onOpenFileAtLine,
    }
  }, [searchScope, searchQuery, resultTree, useRegex, useCaseSensitive, searching, closeSearch, toggleResultDir, toggleResultFileExpand, collapsedResultDirs, expandedResultFiles, onOpenFileAtLine])

  // Debounced content search (reuses search.grep; cwd limits the scope to a folder or the whole workspace)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setSearchTotal(0)
      setSearching(false)
      return
    }
    const cwd = searchScope || workspacePath
    if (!cwd) return
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.search.grep({
          query: searchQuery,
          cwd,
          regex: useRegex,
          caseSensitive: useCaseSensitive,
        })
        if (!cancelled) {
          setSearchResults(res.matches)
          setSearchTotal(res.total)
        }
      } catch {
        if (!cancelled) {
          setSearchResults([])
          setSearchTotal(0)
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery, useRegex, useCaseSensitive, searchScope, workspacePath])

  // Handle navigateToFile prop
  const navTriggerRef = useRef<number>(0)
  useEffect(() => {
    if (!navigateToFile || !workspacePath) return
    if (navigateToFile.trigger === navTriggerRef.current) return
    navTriggerRef.current = navigateToFile.trigger

    const normalizedWs = norm(workspacePath).replace(/\/$/, '')
    const normalizedTarget = norm(navigateToFile.filePath)

    if (!normalizedTarget.startsWith(normalizedWs)) return

    const relPath = normalizedTarget.slice(normalizedWs.length).replace(/^\//, '')
    const segments = relPath.split('/')
    const dirPaths: string[] = []
    for (let i = 0; i < segments.length - 1; i++) {
      dirPaths.push(normalizedWs + '/' + segments.slice(0, i + 1).join('/'))
    }

    navAbortRef.current?.abort()
    const ac = new AbortController()
    navAbortRef.current = ac
    ;(async () => {
      for (const dp of dirPaths) {
        if (ac.signal.aborted) return
        await ensureChildrenLoaded(dp, ac.signal)
      }
      if (ac.signal.aborted) return
      setExpandedDirs(prev => {
        const next = new Set(prev)
        dirPaths.forEach(p => next.add(p))
        return next
      })
      setHighlightedFilePath(normalizedTarget)
    })()
  }, [navigateToFile, workspacePath, ensureChildrenLoaded])

  // Scroll highlighted file into view after it appears in the DOM
  useEffect(() => {
    if (!highlightedFilePath) return
    const tryScroll = () => {
      const el = document.querySelector('[data-file-highlighted="true"]')
      if (el) {
        el.scrollIntoView({ block: 'nearest' })
        return true
      }
      return false
    }
    if (!tryScroll()) {
      const id = setTimeout(() => { if (!tryScroll()) setTimeout(tryScroll, 100) }, 50)
      return () => clearTimeout(id)
    }
  }, [highlightedFilePath])

  // Dismiss context menus on outside click
  useEffect(() => {
    const handleClick = () => { setFileContextMenu(null) }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  // Sync selectedRecentIndex ref (avoid re-registration on every index change)
  useEffect(() => { selectedRecentIndexRef.current = selectedRecentIndex }, [selectedRecentIndex])

  // 切 session / 切走 tab / 切 workspace 时清除 recently 键盘导航高亮（X 移除时另行复位）
  useEffect(() => { setSelectedRecentIndex(null) }, [isActive, workspacePath])

  // Keyboard navigation in recently panel: ArrowUp/Down 选择，Enter 打开，Escape 清除（照抄 AuxTab 模式）
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!isActiveRef.current) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!recentExpanded || !sectionVis.recently || wsRecent.length === 0) return
        e.preventDefault()
        e.stopImmediatePropagation()
        const prev = selectedRecentIndexRef.current
        const next = e.key === 'ArrowDown'
          ? (prev === null ? 0 : Math.min(prev + 1, wsRecent.length - 1))
          : (prev === null ? wsRecent.length - 1 : Math.max(prev - 1, 0))
        selectedRecentIndexRef.current = next  // 同步更新，避免连按时 ref 滞后
        setSelectedRecentIndex(next)
        // 上下移动直接打开对应文件（无需 Enter）
        const f = wsRecent[next]
        if (f) onOpenRecentFile?.(f.path, f.line)
      } else if (e.key === 'Enter') {
        const idx = selectedRecentIndexRef.current
        if (idx !== null && idx < wsRecent.length) {
          e.preventDefault()
          e.stopImmediatePropagation()
          const f = wsRecent[idx]
          onOpenRecentFile?.(f.path, f.line)
        }
      } else if (e.key === 'Escape') {
        setSelectedRecentIndex(null)
      }
    }

    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [recentExpanded, sectionVis.recently, wsRecent, onOpenRecentFile])

  // 选中项滚入视
  useEffect(() => {
    if (selectedRecentIndex === null) return
    const tryScroll = () => {
      const el = document.querySelector(`[data-recent-idx="${selectedRecentIndex}"]`)
      if (el) {
        el.scrollIntoView({ block: 'nearest' })
        return true
      }
      return false
    }
    if (!tryScroll()) {
      const id = setTimeout(() => { if (!tryScroll()) setTimeout(tryScroll, 100) }, 50)
      return () => clearTimeout(id)
    }
  }, [selectedRecentIndex])

  // 切换 recently / arch 显隐（标题栏右键菜单与文件树空白处菜单共享）
  const toggleSection = useCallback((key: 'recently' | 'arch') => {
    setSectionVis(prev => {
      const next = { ...prev, [key]: !prev[key] }
      return next
    })
  }, [])

  // 关闭标题栏右键菜单：外部点击 / ESC（照抄 RightPanel.ContextMenu 的 contains 判定）
  const sectionMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sectionMenu) return
    const handleDown = (e: MouseEvent) => {
      if (sectionMenuRef.current && !sectionMenuRef.current.contains(e.target as Node)) setSectionMenu(null)
    }
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSectionMenu(null) }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleDown), 0)
    window.addEventListener('keydown', handleEsc)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleDown)
      window.removeEventListener('keydown', handleEsc)
    }
  }, [sectionMenu])

  // File context menu handlers
  const handleFileDeleteFromMenu = useCallback((node: FileNode) => {
    setFileContextMenu(null)
    setConfirmAction({ type: 'deleteFile', filePath: node.path, fileName: node.name })
  }, [])

  const handleFileRename = useCallback((node: FileNode) => {
    setFileContextMenu(null)
    setEditingState({ type: 'rename', nodePath: node.path })
  }, [])

  const handleNewFile = useCallback((dirNode: FileNode) => {
    setFileContextMenu(null)
    setExpandedDirs(prev => { const next = new Set(prev); next.add(norm(dirNode.path)); return next })
    setEditingState({ type: 'newFile', nodePath: dirNode.path })
  }, [])

  const handleNewFolder = useCallback((dirNode: FileNode) => {
    setFileContextMenu(null)
    setExpandedDirs(prev => { const next = new Set(prev); next.add(norm(dirNode.path)); return next })
    setEditingState({ type: 'newFolder', nodePath: dirNode.path })
  }, [])

  const handleEditSubmit = useCallback(async (value: string) => {
    if (!editingState || !value.trim()) { setEditingState(null); return }
    const trimmed = value.trim()
    switch (editingState.type) {
      case 'rename': {
        const nodePath = editingState.nodePath
        const sep = nodePath.includes('\\') ? '\\' : '/'
        const oldName = nodePath.split(sep).pop()!
        if (trimmed === oldName) { setEditingState(null); return }
        const dir = nodePath.substring(0, nodePath.lastIndexOf(sep))
        const newPath = dir + sep + trimmed
        const result = await window.api.file.rename(nodePath, newPath)
        if (result.error) {
          setEditingState(prev => prev ? { ...prev, error: result.error } : null)
          return
        }
        setEditingState(null)
        setExpandedDirs(prev => { const next = new Set(prev); next.delete(norm(nodePath)); return next })
        await refreshDir(dir)
        break
      }
      case 'newFile': {
        const sep = editingState.nodePath.includes('\\') ? '\\' : '/'
        const newPath = editingState.nodePath + sep + trimmed
        const result = await window.api.file.write(newPath, '')
        if (result.error) {
          setEditingState(prev => prev ? { ...prev, error: result.error } : null)
          return
        }
        setEditingState(null)
        await refreshDir(editingState.nodePath)
        break
      }
      case 'newFolder': {
        const sep = editingState.nodePath.includes('\\') ? '\\' : '/'
        const newPath = editingState.nodePath + sep + trimmed
        const result = await window.api.file.createDir(newPath)
        if (result.error) {
          setEditingState(prev => prev ? { ...prev, error: result.error } : null)
          return
        }
        setEditingState(null)
        await refreshDir(editingState.nodePath)
        break
      }
    }
  }, [editingState, refreshDir])

  const handleEditCancel = useCallback(() => {
    setEditingState(null)
  }, [])

  const handleOpenExplorer = useCallback(async (node: FileNode) => {
    setFileContextMenu(null)
    await window.api.file.openExplorer(node.path)
  }, [])

  const handleCut = useCallback((node: FileNode) => {
    setFileContextMenu(null)
    setFileClipboard({ path: node.path, name: node.name, operation: 'cut' })
  }, [])

  const handleCopy = useCallback((node: FileNode) => {
    setFileContextMenu(null)
    setFileClipboard({ path: node.path, name: node.name, operation: 'copy' })
  }, [])

  const handlePaste = useCallback(async (destDir: string) => {
    setFileContextMenu(null)
    if (!fileClipboard) return
    const sep = fileClipboard.path.includes('\\') ? '\\' : '/'
    const destPath = destDir + sep + fileClipboard.name
    let result: { error?: string }
    if (fileClipboard.operation === 'cut') {
      result = await window.api.file.move(fileClipboard.path, destPath)
    } else {
      result = await window.api.file.copy(fileClipboard.path, destPath)
    }
    if (!result.error) {
      setFileClipboard(null)
      await refreshDir(destDir)
    }
  }, [fileClipboard, refreshDir])

  return (
    <div className={`flex-1 flex flex-col min-h-0 file-tab${brushActive ? ' brush-copy-mode' : ''}`}>
      {workspacePath && (
        <div className="h-9 pl-5 pr-4 flex items-center border-b border-ide-border shrink-0 gap-2 acrylic-titlebar-clean file-tab__header"
          onContextMenu={(e) => { e.preventDefault(); setSectionMenu({ x: e.clientX, y: e.clientY }) }}
          onMouseLeave={() => setSearchJustClosed(false)}
        >
          <div className="group flex items-center gap-1 min-w-0 flex-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-ide-accent shrink-0">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <line x1="6" y1="12" x2="18" y2="12" />
            </svg>
            <span className="text-sm text-ide-text font-medium truncate">
              {workspacePath.split(/[\\/]/).pop()}
            </span>
            <div
              className={`items-center gap-1 bg-ide-border/30 border border-ide-border group-focus-within:border-ide-accent rounded-full px-2 py-0.5 shrink-0 transition-colors ${nameFilter.trim() ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}
            >
              <Filter className="w-3 h-3 text-ide-text-muted shrink-0" />
              <input
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setNameFilter(''); (e.target as HTMLInputElement).blur() } }}
                placeholder={t('搜索文件名')}
                className="w-20 sm:w-28 bg-transparent text-xs text-ide-text outline-none focus-visible:outline-none caret-ide-accent placeholder:text-ide-text-muted/50"
              />
              <button
                onClick={() => setNameOnly(v => !v)}
                title={t('只匹配文件名（不含路径）')}
                className={`shrink-0 flex items-center justify-center w-4 h-4 rounded-full transition-colors ${nameOnly ? 'bg-ide-accent/25 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
              ><FileText className="w-3 h-3" /></button>
              {nameFilter && (
                <button
                  onClick={() => setNameFilter('')}
                  title={t('Clear')}
                  className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-ide-text-muted hover:text-ide-danger hover:bg-ide-danger/10 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <button
            className="text-ide-text-muted hover:text-ide-text transition-colors shrink-0 w-5 flex items-center justify-center"
            onClick={() => setExpandedDirs(new Set())}
            title={t('Collapse All')}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
              <path fillRule="evenodd" d="M2 2.75A.75.75 0 0 1 2.75 2h9.5a.75.75 0 0 1 0 1.5h-9.5A.75.75 0 0 1 2 2.75ZM2 6.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 2 6.25Zm0 3.5A.75.75 0 0 1 2.75 9h3.5a.75.75 0 0 1 0 1.5h-3.5A.75.75 0 0 1 2 9.75ZM9.22 9.53a.75.75 0 0 1 0-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1-1.06 1.06l-.97-.97v5.69a.75.75 0 0 1-1.5 0V8.56l-.97.97a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
          {onRefresh && (
            <button
              className="text-ide-text-muted hover:text-ide-text transition-colors shrink-0 w-5 flex items-center justify-center"
              onClick={onRefresh}
              title={t('Refresh')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div
        className="flex-1 min-h-0 overflow-y-auto file-tab__tree"
        onContextMenu={(e) => {
          if (!workspacePath) return
          e.preventDefault()
          const rootNode: FileNode = { name: workspacePath.split(/[\\/]/).pop() || workspacePath, path: workspacePath, type: 'directory' }
          setFileContextMenu({ x: e.clientX, y: e.clientY, node: rootNode })
        }}
      >
        {workspacePath && editingState && editingState.nodePath === workspacePath && (
          <RootInput
            editingState={editingState}
            onEditSubmit={handleEditSubmit}
            onEditCancel={handleEditCancel}
            t={t}
          />
        )}
        {(searchScope === null && searchQuery.trim()) ? (
          <div className="flex flex-col py-1">
            {searching && (
              <div className="px-3 py-2 text-xs text-ide-text-muted">{t('Searching...')}</div>
            )}
            {!searching && resultTree.length === 0 && (
              <div className="px-3 py-2 text-xs text-ide-text-muted">{t('No results')}</div>
            )}
            {resultTree.map(node => (
              <ResultTreeItem
                key={node.path}
                node={node}
                depth={0}
                collapsedDirs={collapsedResultDirs}
                expandedFiles={expandedResultFiles}
                onToggleDir={toggleResultDir}
                onToggleFile={toggleResultFileExpand}
                onOpenFileAtLine={onOpenFileAtLine}
                searchQuery={searchQuery}
                useRegex={useRegex}
                useCaseSensitive={useCaseSensitive}
              />
            ))}
            {!searching && searchTotal > searchResults.length && (
              <div className="px-3 py-1 text-[11px] text-ide-text-muted">
                {t('Showing first {n} of {total}').replace('{n}', String(searchResults.length)).replace('{total}', String(searchTotal))}
              </div>
            )}
          </div>
        ) : nameFilter.trim() && nameSearching ? (
          <div className="flex items-center justify-center h-full text-ide-text-muted text-xs">
            {t('Searching...')}
          </div>
        ) : nameFilter.trim() && filteredTree.length === 0 ? (
          <div className="flex items-center justify-center h-full text-ide-text-muted text-xs">
            {t('No matches')}
          </div>
        ) : fileTree.length === 0 && !(editingState && editingState.nodePath === workspacePath) ? (
          <div className="flex items-center justify-center h-full text-ide-text-muted text-xs">
            {workspacePath ? t('Empty directory') : t('No workspace')}
          </div>
        ) : (
          <div className="flex flex-col py-1">
            {(nameFilter.trim() ? filteredTree : fileTree).map(node => (
              <FileTreeItem
                key={node.path}
                node={node}
                depth={0}
                expandedDirs={nameFilter.trim() ? filteredExpanded : expandedDirs}
                onToggle={toggleDir}
                onOpenFile={(fullPath) => onOpenFileFromExplorer?.(fullPath)}
                onContextMenu={(e, node) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setFileContextMenu({ x: e.clientX, y: e.clientY, node })
                }}
                editingState={editingState}
                onEditSubmit={handleEditSubmit}
                onEditCancel={handleEditCancel}
                highlightedFilePath={highlightedFilePath}
                onPreviewMarkdown={onPreviewMarkdown}
                onPreviewImage={onPreviewImage}
                onSearchInFolder={(p) => openSearch(p)}
                inlineSearch={inlineSearchPayload}
                onCopyPath={handleCopyPath}
              />
            ))}
          </div>
        )}
      </div>
      {sectionVis.recently && wsRecent.length > 0 && (
        <div className="shrink-0 border-t border-ide-border max-h-[14rem] overflow-y-auto file-tab__section">
          <div
            className={`pl-5 pr-2 py-1 text-xs uppercase tracking-wider sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm flex items-center gap-1 cursor-pointer hover:bg-ide-hover select-none border-b border-ide-border file-tab__section-header ${recentExpanded ? 'text-ide-accent' : 'text-ide-text-muted'}`}
            onClick={() => setRecentExpanded(v => !v)}
            onContextMenu={(e) => { e.preventDefault(); setSectionMenu({ x: e.clientX, y: e.clientY }) }}
          >
            <Clock size={12} className={recentExpanded ? 'text-ide-accent' : 'text-ide-text-muted'} />
            <span className="file-tab__section-title">{t('Recently Opened')}</span>
          </div>
          {recentExpanded && wsRecent.map((f, i) => {
            const baseName = f.path.split(/[\\/]/).pop() || f.path
            const info = getFileInfo(baseName)
            return (
              <div
                key={f.path}
                data-recent-idx={i}
                className={`group pl-[30px] pr-2 py-0.5 flex items-center gap-1.5 cursor-pointer hover:bg-ide-hover ft-fname ${selectedRecentIndex === i ? 'bg-ide-accent/10 text-ide-text' : ''}`}
                title={`${f.path}${f.line ? ':' + f.line : ''}`}
                onClick={(e) => {
                  if (e.ctrlKey) { e.preventDefault(); handleCopyPath(f.path); return }
                  onOpenRecentFile?.(f.path, f.line)
                }}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className={`ft-icon shrink-0 ${info.color}`}
                  dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
                <span className="truncate text-ide-text min-w-0 flex-1">{baseName}</span>
                {onEditRecentFile && baseName.toLowerCase().endsWith('.md') && (
                  <button
                    className="ml-1 shrink-0 w-4 h-4 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-accent hover:bg-ide-accent/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onEditRecentFile(f.path, f.line) }}
                    title={t('Edit')}
                  >
                    <Pencil size={11} />
                  </button>
                )}
                {f.line && <span className="text-ide-accent shrink-0 text-[10px]">:{f.line}</span>}
                {onRemoveRecentFile && (
                  <button
                    className="ml-1 shrink-0 w-4 h-4 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-danger hover:bg-ide-danger/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onRemoveRecentFile(f.path); setSelectedRecentIndex(null) }}
                    title={t('Remove')}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {sectionVis.arch && docTree.length > 0 && (
        <div className="shrink-0 border-t border-ide-border file-tab__section" style={{ maxHeight: '45%', overflowY: 'auto' }}>
          <div
            className={`pl-5 pr-2 py-1 text-xs uppercase tracking-wider sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm flex items-center gap-1 cursor-pointer hover:bg-ide-hover select-none border-b border-ide-border file-tab__section-header ${archExpanded ? 'text-ide-accent' : 'text-ide-text-muted'}`}
            onClick={() => setArchExpanded(!archExpanded)}
          >
            <Lightbulb size={12} className={archExpanded ? 'text-ide-warning' : 'text-ide-text-muted'} />
            <span className="file-tab__section-title">arch</span>
          </div>
          {archExpanded && docTree.map(node => (
            <DocTreeItem
              key={node.path}
              node={node}
              depth={0}
              expandedDirs={expandedDocDirs}
              onToggle={(path) => setExpandedDocDirs(prev => {
                const next = new Set(prev)
                if (next.has(path)) next.delete(path)
                else next.add(path)
                return next
              })}
              onOpenFile={(fullPath) => onOpenFileFromExplorer?.(fullPath)}
              workspacePath={workspacePath || ''}
            />
          ))}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmAction(null)}>
          <div className="bg-ide-bg border border-ide-border rounded shadow-lg p-4 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ide-text mb-4">
              {t('Delete {fileName}?').replace('{fileName}', confirmAction.fileName)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded"
                onClick={() => setConfirmAction(null)}
              >
                {t('Cancel')}
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-ide-danger hover:bg-red-600 text-white rounded"
                onClick={async () => {
                  const { filePath } = confirmAction
                  setConfirmAction(null)
                  await window.api.file.delete(filePath)
                  const sep = filePath.includes('\\') ? '\\' : '/'
                  const parentDir = filePath.substring(0, filePath.lastIndexOf(sep))
                  await refreshDir(parentDir)
                }}
              >
                {t('Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu for file explorer */}
      {fileContextMenu && (() => {
        const isRoot = fileContextMenu.node.path === workspacePath
        return (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
          style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {fileContextMenu.node.type === 'directory' ? (
            <>
              <button
                className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => handleNewFile(fileContextMenu.node)}
              >
                {t('New File')}
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => handleNewFolder(fileContextMenu.node)}
              >
                {t('New Folder')}
              </button>
              {(fileClipboard || !isRoot) && <div className="border-t border-ide-border my-1" />}
              {fileClipboard && (
                <button
                  className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                  onClick={() => handlePaste(fileContextMenu.node.path)}
                >
                  {t('Paste')} ({fileClipboard.operation === 'cut' ? t('Move') : t('Copy')}: {fileClipboard.name})
                </button>
              )}
              {!isRoot && (
                <>
                  <button
                    className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                    onClick={() => handleCut(fileContextMenu.node)}
                  >
                    {t('Cut')}
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                    onClick={() => handleCopy(fileContextMenu.node)}
                  >
                    {t('Copy')}
                  </button>
                </>
              )}
              {isRoot && onRefresh && (
                <>
                  <div className="border-t border-ide-border my-1" />
                  <button
                    className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                    onClick={() => { onRefresh(); setFileContextMenu(null) }}
                  >
                    {t('Refresh')}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => handleOpenExplorer(fileContextMenu.node)}
              >
                {t('Open in Explorer')}
              </button>
              {onCompareWithCurrent && currentEditFilePath && currentEditFilePath !== fileContextMenu.node.path && (
                <>
                  <div className="border-t border-ide-border my-1" />
                  <button
                    className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                    onClick={() => {
                      onCompareWithCurrent(fileContextMenu.node.path)
                      setFileContextMenu(null)
                    }}
                  >
                    {t('Compare with Current')}
                  </button>
                </>
              )}
              <div className="border-t border-ide-border my-1" />
              <button
                className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => handleCut(fileContextMenu.node)}
              >
                {t('Cut')}
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => handleCopy(fileContextMenu.node)}
              >
                {t('Copy')}
              </button>
            </>
          )}
          {!isRoot && (
            <>
              <div className="border-t border-ide-border my-1" />
              <button
                className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => handleFileRename(fileContextMenu.node)}
              >
                {t('Rename')}
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-xs text-ide-danger hover:bg-ide-hover whitespace-nowrap"
                onClick={() => handleFileDeleteFromMenu(fileContextMenu.node)}
              >
                {t('Delete')}
              </button>
            </>
          )}
          {isRoot && (
            <>
              <div className="border-t border-ide-border my-1" />
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => toggleSection('recently')}
              >
                <span className={`ft-icon flex items-center justify-center ${sectionVis.recently ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
                  {sectionVis.recently ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon opacity-30" />
                  )}
                </span>
                <span>{t('Recently')}</span>
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => toggleSection('arch')}
              >
                <span className={`ft-icon flex items-center justify-center ${sectionVis.arch ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
                  {sectionVis.arch ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon opacity-30" />
                  )}
                </span>
                <span>arch</span>
              </button>
            </>
          )}
        </div>
      )})()}

      {/* 标题栏右键菜单：切换 recently / arch 显隐 */}
      {sectionMenu && (
        <div
          ref={sectionMenuRef}
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[140px]"
          style={{ left: Math.min(sectionMenu.x, window.innerWidth - 180), top: Math.min(sectionMenu.y, window.innerHeight - 120) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => toggleSection('recently')}
          >
            <span className={`ft-icon flex items-center justify-center ${sectionVis.recently ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
              {sectionVis.recently ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon opacity-30" />
              )}
            </span>
            <span>{t('Recently')}</span>
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => toggleSection('arch')}
          >
            <span className={`ft-icon flex items-center justify-center ${sectionVis.arch ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
              {sectionVis.arch ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ft-icon opacity-30" />
              )}
            </span>
            <span>arch</span>
          </button>
        </div>
      )}

      {toastPath && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 px-5 py-3 rounded-xl border shadow-2xl pointer-events-auto animate-fade-in"
            style={{
              backgroundColor: 'rgb(var(--ide-sidebar-bg, 30 30 30))',
              borderColor: 'rgba(34,197,94,0.5)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7 text-emerald-400">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-sm text-emerald-400 font-medium">{t('Copied to clipboard')}</span>
              <span className="text-xs text-ide-text-muted truncate max-w-[280px]" title={toastPath}>@{toastPath}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
