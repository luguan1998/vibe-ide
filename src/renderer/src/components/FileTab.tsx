import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Lightbulb, Eye, Clock, X, Pencil } from 'lucide-react'
import { FileNode, RecentFileEntry } from '@shared/types'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
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

const SECTION_VIS_KEY = 'vibe-ide-filetab-sections'

interface FileTabSectionVis { recently: boolean; arch: boolean }

export function loadSectionVis(): FileTabSectionVis {
  try {
    const raw = localStorage.getItem(SECTION_VIS_KEY)
    if (raw) {
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') {
        return {
          recently: typeof obj.recently === 'boolean' ? obj.recently : true,
          arch: typeof obj.arch === 'boolean' ? obj.arch : true,
        }
      }
    }
  } catch {}
  return { recently: true, arch: true }
}

export function saveSectionVis(v: FileTabSectionVis) {
  try { localStorage.setItem(SECTION_VIS_KEY, JSON.stringify(v)) } catch {}
}

// ──

interface FileTabProps {
  workspacePath: string | null
  onOpenFileFromExplorer?: (fullPath: string) => void
  onCompareWithCurrent?: (fullPath: string) => void
  currentEditFilePath?: string | null
  onPreviewMarkdown?: (fullPath: string, fileName: string) => void
  onPreviewImage?: (fullPath: string, fileName: string) => void
  fileTreeDepth: number
  refreshKey?: number
  navigateToFile?: { trigger: number; filePath: string } | null
  onRefresh?: () => void
  recentFiles?: RecentFileEntry[]
  onOpenRecentFile?: (fullPath: string, lineNumber?: number) => void
  onRemoveRecentFile?: (fullPath: string) => void
  onEditRecentFile?: (fullPath: string) => void
  isActive?: boolean
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0 text-ide-text-muted"
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

// File tree item component
function FileTreeItem({ node, depth, expandedDirs, onToggle, onOpenFile, onContextMenu, editingState, onEditSubmit, onEditCancel, highlightedFilePath, onPreviewMarkdown, onPreviewImage }: {
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
}) {
  const { t } = useI18n()
  const isDir = node.type === 'directory'
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

  const handleClick = () => {
    if (isRenaming || isCreating) return
    if (isDir) {
      onToggle(node.path)
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
        className={`group pr-2 py-0.5 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-0.5 select-none ${highlightedFilePath === norm(node.path) ? 'bg-ide-accent/20' : ''}`}
        style={{ paddingLeft }}
        onClick={handleClick}
        onContextMenu={(e) => { if (!isRenaming && !isCreating) onContextMenu(e, node) }}
        data-file-highlighted={highlightedFilePath === norm(node.path) ? 'true' : undefined}
      >
        {isDir ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform shrink-0 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isRenaming ? (
          isDir ? (
            isExpanded ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <path d="M2 10h12l2 4h6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )
          ) : (
            (() => {
              const info = getFileInfo(node.name)
              return (
                <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 ${info.color}`}
                  dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
              )
            })()
          )
        ) : (
          isDir ? (
            isExpanded ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <path d="M2 10h12l2 4h6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )
          ) : (
            (() => {
              const info = getFileInfo(node.name)
              return (
                <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 ${info.color}`}
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
            <span className="truncate text-ide-text">{node.name}</span>
            {!isDir && node.name.toLowerCase().endsWith('.md') && onPreviewMarkdown && (
              <button
                className="ml-1 shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-accent hover:bg-ide-accent/10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  onPreviewMarkdown(node.path, node.name)
                }}
                title="Preview Markdown"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
            {!isDir && getFileInfo(node.name).kind === 'image' && onPreviewImage && (
              <button
                className="ml-1 shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-accent hover:bg-ide-accent/10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  onPreviewImage(node.path, node.name)
                }}
                title="Preview Image"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0 text-ide-text-muted"
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
          {node.children?.map(child => (
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
            />
          ))}
        </>
      )}
    </>
  )
}

export default function FileTab({ workspacePath, onOpenFileFromExplorer, onCompareWithCurrent, currentEditFilePath, onPreviewMarkdown, onPreviewImage, fileTreeDepth, refreshKey, navigateToFile, onRefresh, recentFiles = [], onOpenRecentFile, onRemoveRecentFile, onEditRecentFile, isActive }: FileTabProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [editingState, setEditingState] = useState<{ type: 'rename' | 'newFile' | 'newFolder'; nodePath: string; error?: string } | null>(null)
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: string; filePath: string; fileName: string } | null>(null)
  const [highlightedFilePath, setHighlightedFilePath] = useState<string | null>(null)
  const [docTree, setDocTree] = useState<DocTreeNode[]>([])
  const [expandedDocDirs, setExpandedDocDirs] = useState<Set<string>>(new Set())
  const [archExpanded, setArchExpanded] = useState(false)
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null)
  const { t } = useI18n()

  // ── recently file section ──
  const [recentExpanded, setRecentExpanded] = useState(true)
  const [selectedRecentIndex, setSelectedRecentIndex] = useState<number | null>(null)
  const [sectionVis, setSectionVis] = useState<FileTabSectionVis>(loadSectionVis)
  const [sectionMenu, setSectionMenu] = useState<{ x: number; y: number } | null>(null)
  const selectedRecentIndexRef = useRef<number | null>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // recently files filtered to current workspace
  const wsRecent = useMemo(() => recentFiles.filter(f => {
    const p = norm(f.path)
    const w = norm(workspacePath || '').replace(/\/$/, '')
    if (!w) return false
    return p === w || p.startsWith(w + '/')
  }), [recentFiles, workspacePath])

  // Load file tree
  const loadFileTree = useCallback(async () => {
    if (!workspacePath) return
    try {
      const skipPatterns = loadFilterRules()
      const result = await window.api.file.tree(workspacePath, fileTreeDepth, skipPatterns)
      if (!result.error) {
        setFileTree(result)
      }
    } catch {}
  }, [workspacePath, fileTreeDepth])

  useEffect(() => {
    if (workspacePath) {
      loadFileTree()
    }
  }, [workspacePath, loadFileTree])

  // Reload file tree when filter rules change
  useEffect(() => {
    const handler = () => loadFileTree()
    window.addEventListener('file-filter-rules-changed', handler)
    return () => window.removeEventListener('file-filter-rules-changed', handler)
  }, [loadFileTree])

  // Reload when manual refresh triggered
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      loadFileTree()
      loadClaudeDocTree()
    }
  }, [refreshKey])

  // Reload when filesystem changes (file watcher push from main process)
  useEffect(() => {
    const handler = window.api.file.onChanged(() => {
      loadFileTree()
    })
    return () => { window.api.file.removeChangedListener(handler) }
  }, [loadFileTree])

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
  const toggleDir = useCallback((path: string) => {
    const n = norm(path)
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }, [])

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

    setExpandedDirs(prev => {
      const next = new Set(prev)
      dirPaths.forEach(p => next.add(p))
      return next
    })
    setHighlightedFilePath(normalizedTarget)
  }, [navigateToFile, workspacePath])

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
      saveSectionVis(next)
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
        await loadFileTree()
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
        await loadFileTree()
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
        await loadFileTree()
        break
      }
    }
  }, [editingState, loadFileTree])

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
      await loadFileTree()
    }
  }, [fileClipboard, loadFileTree])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {workspacePath && (
        <div className="h-9 pl-5 pr-4 flex items-center border-b border-ide-border shrink-0 gap-2 acrylic-titlebar-clean"
          onContextMenu={(e) => { e.preventDefault(); setSectionMenu({ x: e.clientX, y: e.clientY }) }}
        >
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-ide-accent shrink-0">
              <path d="M14.5 3H7.71L6.86 2.15L6.51 2H1.51L1.01 2.5V6.5V13.5L1.51 14H14.51L15.01 13.5V9V3.5L14.5 3ZM13.99 11.49V13H1.99V11.49V7.49V7H6.48L6.83 6.85L7.69 5.99H14V7.49L13.99 11.49ZM13.99 5H7.49L7.14 5.15L6.28 6.01H2V3.01H6.29L7.14 3.86L7.5 4.01H14L13.99 5Z" />
            </svg>
            <span className="text-sm text-ide-text font-medium truncate">
              {workspacePath.split(/[\\/]/).pop()}
            </span>
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div
        className="flex-1 min-h-0 overflow-y-auto"
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
        {fileTree.length === 0 && !(editingState && editingState.nodePath === workspacePath) ? (
          <div className="flex items-center justify-center h-full text-ide-text-muted text-xs">
            {workspacePath ? t('Empty directory') : t('No workspace')}
          </div>
        ) : (
          <div className="flex flex-col py-1">
            {fileTree.map(node => (
              <FileTreeItem
                key={node.path}
                node={node}
                depth={0}
                expandedDirs={expandedDirs}
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
              />
            ))}
          </div>
        )}
      </div>
      {sectionVis.recently && wsRecent.length > 0 && (
        <div className="shrink-0 border-t border-ide-border max-h-[14rem] overflow-y-auto">
          <div
            className={`pl-5 pr-2 py-1 text-[11px] uppercase tracking-wider sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm flex items-center gap-1 cursor-pointer hover:bg-ide-hover select-none border-b border-ide-border ${recentExpanded ? 'text-ide-accent' : 'text-ide-text-muted'}`}
            onClick={() => setRecentExpanded(v => !v)}
            onContextMenu={(e) => { e.preventDefault(); setSectionMenu({ x: e.clientX, y: e.clientY }) }}
          >
            <Clock size={12} className={recentExpanded ? 'text-ide-accent' : 'text-ide-text-muted'} />
            <span>{t('Recently Opened')}</span>
          </div>
          {recentExpanded && wsRecent.map((f, i) => {
            const baseName = f.path.split(/[\\/]/).pop() || f.path
            const info = getFileInfo(baseName)
            return (
              <div
                key={f.path}
                data-recent-idx={i}
                className={`group pl-[30px] pr-2 py-0.5 flex items-center gap-1.5 cursor-pointer hover:bg-ide-hover text-xs ${selectedRecentIndex === i ? 'bg-ide-accent/10 text-ide-text' : ''}`}
                title={`${f.path}${f.line ? ':' + f.line : ''}`}
                onClick={() => onOpenRecentFile?.(f.path, f.line)}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 ${info.color}`}
                  dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
                <span className="truncate text-ide-text min-w-0 flex-1">{baseName}</span>
                {onEditRecentFile && baseName.toLowerCase().endsWith('.md') && (
                  <button
                    className="ml-1 shrink-0 w-4 h-4 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-accent hover:bg-ide-accent/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onEditRecentFile(f.path) }}
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
        <div className="shrink-0 border-t border-ide-border" style={{ maxHeight: '45%', overflowY: 'auto' }}>
          <div
            className={`pl-5 pr-2 py-1 text-[11px] uppercase tracking-wider sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm flex items-center gap-1 cursor-pointer hover:bg-ide-hover select-none border-b border-ide-border ${archExpanded ? 'text-ide-accent' : 'text-ide-text-muted'}`}
            onClick={() => setArchExpanded(!archExpanded)}
          >
            <Lightbulb size={12} className={archExpanded ? 'text-ide-warning' : 'text-ide-text-muted'} />
            <span>arch</span>
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
                  await loadFileTree()
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
                <span className={`w-3.5 h-3.5 flex items-center justify-center ${sectionVis.recently ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
                  {sectionVis.recently ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 opacity-30" />
                  )}
                </span>
                <span>{t('Recently')}</span>
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => toggleSection('arch')}
              >
                <span className={`w-3.5 h-3.5 flex items-center justify-center ${sectionVis.arch ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
                  {sectionVis.arch ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 opacity-30" />
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
            <span className={`w-3.5 h-3.5 flex items-center justify-center ${sectionVis.recently ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
              {sectionVis.recently ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 opacity-30" />
              )}
            </span>
            <span>{t('Recently')}</span>
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => toggleSection('arch')}
          >
            <span className={`w-3.5 h-3.5 flex items-center justify-center ${sectionVis.arch ? 'text-ide-text' : 'text-ide-text-muted/30'}`}>
              {sectionVis.arch ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 opacity-30" />
              )}
            </span>
            <span>arch</span>
          </button>
        </div>
      )}
    </div>
  )
}
