import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Lightbulb } from 'lucide-react'
import { FileNode } from '@shared/types'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
import { parseDocTree, DocTreeItem, DocTreeNode, loadMdContent } from './DocTree'
import { useI18n } from '../i18n'

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

// ──

interface FileTabProps {
  workspacePath: string | null
  onOpenFileFromExplorer?: (fullPath: string) => void
  fileTreeDepth: number
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
      <div className="pr-2 py-0.5 text-xs flex items-center gap-0.5 bg-ide-accent/10" style={{ paddingLeft: 12 }}>
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
        <div style={{ paddingLeft: 12 }} className="py-0.5 text-[11px] text-ide-danger">
          {editingState.error}
        </div>
      )}
    </div>
  )
}

// File tree item component
function FileTreeItem({ node, depth, expandedDirs, onToggle, onOpenFile, onContextMenu, editingState, onEditSubmit, onEditCancel }: {
  node: FileNode
  depth: number
  expandedDirs: Set<string>
  onToggle: (path: string) => void
  onOpenFile: (fullPath: string) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  editingState: { type: 'rename' | 'newFile' | 'newFolder'; nodePath: string; error?: string } | null
  onEditSubmit: (value: string) => void
  onEditCancel: () => void
}) {
  const { t } = useI18n()
  const isDir = node.type === 'directory'
  const isExpanded = expandedDirs.has(node.path)
  const paddingLeft = 12 + depth * 16
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
        className="pr-2 py-0.5 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-0.5 select-none"
        style={{ paddingLeft }}
        onClick={handleClick}
        onContextMenu={(e) => { if (!isRenaming && !isCreating) onContextMenu(e, node) }}
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
          <span className="truncate text-ide-text">{node.name}</span>
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
              style={{ paddingLeft: 12 + (depth + 1) * 16 }}
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
            <div style={{ paddingLeft: 12 + (depth + 1) * 16 }} className="py-0.5 text-[11px] text-ide-danger">
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
            />
          ))}
        </>
      )}
    </>
  )
}

export default function FileTab({ workspacePath, onOpenFileFromExplorer, fileTreeDepth }: FileTabProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [editingState, setEditingState] = useState<{ type: 'rename' | 'newFile' | 'newFolder'; nodePath: string; error?: string } | null>(null)
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: string; filePath: string; fileName: string } | null>(null)
  const [docTree, setDocTree] = useState<DocTreeNode[]>([])
  const [expandedDocDirs, setExpandedDocDirs] = useState<Set<string>>(new Set())
  const [archExpanded, setArchExpanded] = useState(true)
  const { t } = useI18n()

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
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Dismiss context menus on outside click
  useEffect(() => {
    const handleClick = () => { setFileContextMenu(null) }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

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
    setExpandedDirs(prev => { const next = new Set(prev); next.add(dirNode.path); return next })
    setEditingState({ type: 'newFile', nodePath: dirNode.path })
  }, [])

  const handleNewFolder = useCallback((dirNode: FileNode) => {
    setFileContextMenu(null)
    setExpandedDirs(prev => { const next = new Set(prev); next.add(dirNode.path); return next })
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
        setExpandedDirs(prev => { const next = new Set(prev); next.delete(nodePath); return next })
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
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
              />
            ))}
          </div>
        )}
      </div>
      {docTree.length > 0 && (
        <div className="shrink-0 border-t border-ide-border" style={{ maxHeight: '45%', overflowY: 'auto' }}>
          <div
            className={`px-2 py-1 text-[11px] uppercase tracking-wider sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm flex items-center gap-1 cursor-pointer hover:bg-ide-hover select-none ${archExpanded ? 'text-ide-accent' : 'text-ide-text-muted'}`}
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
              {!isRoot && <div className="border-t border-ide-border my-1" />}
            </>
          ) : (
            <>
              <button
                className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
                onClick={() => handleOpenExplorer(fileContextMenu.node)}
              >
                {t('Open in Explorer')}
              </button>
              <div className="border-t border-ide-border my-1" />
            </>
          )}
          {!isRoot && (
            <>
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
        </div>
      )})()}
    </div>
  )
}
