import React, { useState, useEffect, useCallback, useRef } from 'react'
const TerminalView = React.lazy(() => import('./TerminalView'))
import { Lightbulb } from 'lucide-react'
import SearchPanel from './SearchPanel'
import { getShortcuts, eventMatchesBinding } from '../shortcuts'
import { useI18n } from '../i18n'
import { GitStatusResult, GitFileStatus, GitLogEntry, GitBranch, GitCommitFile, TerminalSession, FileNode } from '@shared/types'

interface GitPanelProps {
  workspacePath: string | null
  onFileSelect?: (filePath: string, diffContent: string, isStaged: boolean, commitHash?: string) => void
  refreshKey?: number
  // 右侧终端跳转时，触发中间终端切换到 edit 模式
  onOpenFileFromRightTerminal?: (fullPath: string, lineNumber?: number) => void
  // 搜索跳转时，触发中间终端切换到 edit 模式
  onOpenFileFromSearch?: (fullPath: string, lineNumber?: number) => void
  // 右侧独立终端 session（当前活动 session 的）
  rightTerminalSession?: TerminalSession | null
  activeSessionId?: string | null
  // 创建右侧终端
  onCreateRightTerminal?: (sessionId: string) => void
  // 关闭右侧终端
  onCloseRightTerminal?: (sessionId: string) => void
  // Ctrl+F 触发搜索面板聚焦
  searchFocusTrigger?: number
  // 文件浏览器打开文件
  onOpenFileFromExplorer?: (fullPath: string) => void
  fileTreeDepth?: number
}

type FileKind = 'code' | 'style' | 'markup' | 'data' | 'docs' | 'image' | 'config' | 'script' | 'default'

const FILE_KINDS: Record<string, { kind: FileKind; color: string }> = {
  ts: { kind: 'code', color: 'text-ide-accent' }, tsx: { kind: 'code', color: 'text-ide-accent' },
  js: { kind: 'code', color: 'text-ide-warning' }, jsx: { kind: 'code', color: 'text-ide-warning' }, mjs: { kind: 'code', color: 'text-ide-warning' }, cjs: { kind: 'code', color: 'text-ide-warning' },
  py: { kind: 'code', color: 'text-[#3572A5]' },
  go: { kind: 'code', color: 'text-[#00ADD8]' },
  rs: { kind: 'code', color: 'text-[#dea584]' },
  java: { kind: 'code', color: 'text-[#b07219]' },
  css: { kind: 'style', color: 'text-[#a855f7]' }, scss: { kind: 'style', color: 'text-[#a855f7]' }, less: { kind: 'style', color: 'text-[#a855f7]' },
  html: { kind: 'markup', color: 'text-ide-accent' }, htm: { kind: 'markup', color: 'text-ide-accent' },
  vue: { kind: 'markup', color: 'text-ide-accent' }, svelte: { kind: 'markup', color: 'text-ide-accent' },
  json: { kind: 'data', color: 'text-ide-warning' },
  yml: { kind: 'data', color: 'text-[#cb3d3d]' }, yaml: { kind: 'data', color: 'text-[#cb3d3d]' },
  md: { kind: 'docs', color: 'text-ide-accent' }, mdx: { kind: 'docs', color: 'text-ide-accent' },
  svg: { kind: 'image', color: 'text-[#a855f7]' },
  png: { kind: 'image', color: 'text-ide-success' }, jpg: { kind: 'image', color: 'text-ide-success' }, jpeg: { kind: 'image', color: 'text-ide-success' }, gif: { kind: 'image', color: 'text-ide-success' }, webp: { kind: 'image', color: 'text-ide-success' }, ico: { kind: 'image', color: 'text-ide-success' },
  sh: { kind: 'script', color: 'text-ide-accent' }, bash: { kind: 'script', color: 'text-ide-accent' }, bat: { kind: 'script', color: 'text-ide-accent' },
  env: { kind: 'config', color: 'text-ide-text-muted' }, gitignore: { kind: 'config', color: 'text-ide-text-muted' },
}

function getFileInfo(name: string): { kind: FileKind; color: string } {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return FILE_KINDS[ext] || { kind: 'default', color: 'text-ide-text-muted' }
}

const FILE_ICON_PATHS: Record<FileKind, string> = {
  code: `<path d="M4.75 4.25a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z" /><path fill-rule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2H6a1.5 1.5 0 0 1 1.5 1.5V6A1.5 1.5 0 0 1 6 7.5H3.5A1.5 1.5 0 0 1 2 6V3.5Zm1.5 0H6V6H3.5V3.5Z" clip-rule="evenodd" /><path d="M4.25 11.25a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0Z" /><path fill-rule="evenodd" d="M2 10a1.5 1.5 0 0 1 1.5-1.5H6A1.5 1.5 0 0 1 7.5 10v2.5A1.5 1.5 0 0 1 6 14H3.5A1.5 1.5 0 0 1 2 12.5V10Zm1.5 2.5V10H6v2.5H3.5Z" clip-rule="evenodd" /><path d="M11.25 4.25a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z" /><path fill-rule="evenodd" d="M10 2a1.5 1.5 0 0 0-1.5 1.5V6A1.5 1.5 0 0 0 10 7.5h2.5A1.5 1.5 0 0 0 14 6V3.5A1.5 1.5 0 0 0 12.5 2H10Zm2.5 1.5H10V6h2.5V3.5Z" clip-rule="evenodd" /><path d="M8.5 9.417a.917.917 0 1 1 1.833 0 .917.917 0 0 1-1.833 0ZM8.5 13.083a.917.917 0 1 1 1.833 0 .917.917 0 0 1-1.833 0ZM13.083 8.5a.917.917 0 1 0 0 1.833.917.917 0 0 0 0-1.833ZM12.166 13.084a.917.917 0 1 1 1.833 0 .917.917 0 0 1-1.833 0ZM11.25 10.333a.917.917 0 1 0 0 1.833.917.917 0 0 0 0-1.833Z" />`,
  style: `<path fill-rule="evenodd" d="M3.75 2a.75.75 0 0 0-.75.75v10.5a.75.75 0 0 0 1.28.53L8 10.06l3.72 3.72a.75.75 0 0 0 1.28-.53V2.75a.75.75 0 0 0-.75-.75h-8.5Z" clip-rule="evenodd" />`,
  markup: `<path fill-rule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clip-rule="evenodd" />`,
  data: `<path d="M8 7c3.314 0 6-1.343 6-3s-2.686-3-6-3-6 1.343-6 3 2.686 3 6 3Z" /><path d="M8 8.5c1.84 0 3.579-.37 4.914-1.037A6.33 6.33 0 0 0 14 6.78V8c0 1.657-2.686 3-6 3S2 9.657 2 8V6.78c.346.273.72.5 1.087.683C4.42 8.131 6.16 8.5 8 8.5Z" /><path d="M8 12.5c1.84 0 3.579-.37 4.914-1.037.366-.183.74-.41 1.086-.684V12c0 1.657-2.686 3-6 3s-6-1.343-6-3v-1.22c.346.273.72.5 1.087.683C4.42 12.131 6.16 12.5 8 12.5Z" />`,
  docs: `<path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h4.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .439 1.061V12.5A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5v-9Z" />`,
  image: `<path fill-rule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm10.5 5.707a.5.5 0 0 0-.146-.353l-1-1a.5.5 0 0 0-.708 0L9.354 9.646a.5.5 0 0 1-.708 0L6.354 7.354a.5.5 0 0 0-.708 0l-2 2a.5.5 0 0 0-.146.353V12a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V9.707ZM12 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clip-rule="evenodd" />`,
  config: `<path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v.55a1.5 1.5 0 0 1-.764 1.323l-.476.275a2.5 2.5 0 1 0 2.5 4.33l.476-.275a1.5 1.5 0 0 1 1.528 0l.476.275a2.5 2.5 0 1 0 2.5-4.33l-.476-.275a1.5 1.5 0 0 1-.764-1.323V3.5A2.5 2.5 0 0 0 8 1Zm0 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />`,
  script: `<path fill-rule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clip-rule="evenodd" />`,
  default: `<path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h4.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .439 1.061V12.5A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5v-9Z" />`,
}

function DocTreeItem({ node, depth, expandedDirs, onToggle, onOpenFile, workspacePath }: {
  node: DocTreeNode
  depth: number
  expandedDirs: Set<string>
  onToggle: (path: string) => void
  onOpenFile: (fullPath: string) => void
  workspacePath: string
}) {
  const isExpanded = expandedDirs.has(node.path)
  const paddingLeft = 12 + depth * 14

  return (
    <>
      <div
        className={`pr-2 py-0.5 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-0.5 select-none ${!node.isDir ? 'hover:text-ide-accent' : ''}`}
        style={{ paddingLeft }}
        onClick={() => {
          if (node.isDir) { onToggle(node.path); return }
          const normalizedWs = workspacePath.replace(/\\/g, '/')
          onOpenFile(normalizedWs + '/' + node.path)
        }}
      >
        {node.isDir ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform shrink-0 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {node.isDir ? (
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
                dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] || FILE_ICON_PATHS.default }} />
            )
          })()
        )}
        <span className="text-[11px] truncate text-ide-text">{node.name}</span>
        {node.comment && (
          <span className="text-[10px] text-ide-text-muted/60 truncate ml-2">{node.comment}</span>
        )}
      </div>
      {node.isDir && isExpanded && node.children.map(child => (
        <DocTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          expandedDirs={expandedDirs}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          workspacePath={workspacePath}
        />
      ))}
    </>
  )
}

type GitTab = 'changes' | 'log' | 'branches'
type GitSection = 'git' | 'terminal' | 'search' | 'file'

// File tree item component
function FileTreeItem({ node, depth, expandedDirs, onToggle, onOpenFile }: {
  node: FileNode
  depth: number
  expandedDirs: Set<string>
  onToggle: (path: string) => void
  onOpenFile: (fullPath: string) => void
}) {
  const isDir = node.type === 'directory'
  const isExpanded = expandedDirs.has(node.path)
  const paddingLeft = 12 + depth * 16

  const handleClick = () => {
    if (isDir) {
      onToggle(node.path)
    } else {
      onOpenFile(node.path)
    }
  }

  return (
    <>
      <div
        className="pr-2 py-0.5 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-0.5 select-none"
        style={{ paddingLeft }}
        onClick={handleClick}
      >
        {isDir ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform shrink-0 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDir ? (
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
        )}
        <span className="truncate text-ide-text">{node.name}</span>
      </div>
      {isDir && isExpanded && node.children?.map(child => (
        <FileTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          expandedDirs={expandedDirs}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
        />
      ))}
    </>
  )
}

function parseCommands(md: string): Array<{ command: string; comment: string }> {
  const result: Array<{ command: string; comment: string }> = []
  const normalized = md.replace(/\r\n/g, '\n')
  const startMatch = normalized.match(/^## (?:Commands|命令)\s*$/im)
  if (!startMatch || startMatch.index === undefined) return result
  const rest = normalized.slice(startMatch.index + startMatch[0].length)
  const nextH2 = rest.search(/\n## /)
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2)
  const codeBlockRe = /```[^\n]*\n([\s\S]*?)```/g
  let match
  while ((match = codeBlockRe.exec(section)) !== null) {
    for (const line of match[1].split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const hashIdx = trimmed.indexOf('#')
      if (hashIdx >= 0) {
        result.push({ command: trimmed.slice(0, hashIdx).trim(), comment: trimmed.slice(hashIdx + 1).trim() })
      } else {
        result.push({ command: trimmed, comment: '' })
      }
    }
  }
  return result
}

interface DocTreeNode {
  name: string
  path: string
  comment: string
  isDir: boolean
  children: DocTreeNode[]
}

function parseDocTree(md: string): DocTreeNode[] {
  const root: DocTreeNode[] = []
  const stack: { depth: number; node: DocTreeNode }[] = []
  let rootPrefix = ''
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(/^([\s│]*)[├└]──\s+(\S+)/)
    if (!m) continue

    // Detect root directory from preceding line
    if (rootPrefix === '' && i > 0) {
      const prevLine = lines[i - 1].trim()
      const rootMatch = prevLine.match(/^(\S+?\/)\s*$/)
      if (rootMatch) rootPrefix = rootMatch[1]
    }

    const rawName = m[2]
    const isDir = rawName.endsWith('/')
    const name = rawName.replace(/\/$/, '')
    const comment = (line.match(/#\s*(.+)/) || [])[1] || ''
    const depth = Math.max(0, Math.floor(m[1].length / 4))
    const node: DocTreeNode = { name, path: name, comment, isDir, children: [] }

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length === 0) {
      node.path = rootPrefix + name
      root.push(node)
    } else {
      const parent = stack[stack.length - 1].node
      node.path = parent.path + '/' + name
      parent.children.push(node)
    }
    stack.push({ depth, node })
  }
  return root
}

const GitPanel = React.memo(function GitPanel({ workspacePath, onFileSelect, refreshKey, onOpenFileFromRightTerminal, onOpenFileFromSearch, rightTerminalSession, onCreateRightTerminal, onCloseRightTerminal, searchFocusTrigger, onOpenFileFromExplorer, activeSessionId, fileTreeDepth = 3 }: GitPanelProps) {
  const [activeSection, setActiveSection] = useState<GitSection>('git')
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)
  const [untrackedExpanded, setUntrackedExpanded] = useState(true)
  const [logExpanded, setLogExpanded] = useState(false)
  const [branchesExpanded, setBranchesExpanded] = useState(false)
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [logs, setLogs] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')
  const [diffStaged, setDiffStaged] = useState<boolean>(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [currentGitPath, setCurrentGitPath] = useState<string | null>(null)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  const [commitDiff, setCommitDiff] = useState<string>('')
  const gitChangedHandlerRef = useRef<any>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; branchName: string } | null>(null)
  const [commands, setCommands] = useState<Array<{ command: string; comment: string }>>([])
  const [confirmAction, setConfirmAction] = useState<{ type: string; filePath: string; fileName: string } | null>(null)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [remoteBranches, setRemoteBranches] = useState<{ name: string; remote: string; branch: string }[]>([])
  const [selectedRemote, setSelectedRemote] = useState<string>('')
  const [showPushDropdown, setShowPushDropdown] = useState(false)
  const { t } = useI18n()

  // Switch git workspace when workspacePath changes
  useEffect(() => {
    if (!workspacePath || workspacePath === currentGitPath) return
    const switchWorkspace = async () => {
      const result = await window.api.git.setWorkspace(workspacePath)
      if (result.success) {
        setCurrentGitPath(workspacePath)
        // Refresh all git data for the new workspace
        refreshStatus()
        refreshLog()
        refreshBranches()
      }
    }
    switchWorkspace()
  }, [workspacePath])

  // Handle refreshKey changes (triggered by Ctrl+S in DiffViewer)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refreshStatus()
    }
  }, [refreshKey])

  // Listen for git:changed events from file watcher
  useEffect(() => {
    gitChangedHandlerRef.current = window.api.git.onChanged(() => {
      // Auto refresh when git state changes (external edits, terminal commands, etc.)
      refreshStatus()
      if (logExpanded) refreshLog()
    })

    return () => {
      window.api.git.removeChangedListener(gitChangedHandlerRef.current)
    }
  }, [logExpanded])
  // Dismiss context menu on outside click
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  // Ctrl+Left/Right → switch right panel tabs
  const tabOrder = ['git', 'terminal', 'search', 'file'] as const
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const bindings = getShortcuts()
      if (eventMatchesBinding(e, bindings['panel.tabRight'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const idx = tabOrder.indexOf(activeSection)
        setActiveSection(tabOrder[(idx + 1) % tabOrder.length])
      }
      if (eventMatchesBinding(e, bindings['panel.tabLeft'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const idx = tabOrder.indexOf(activeSection)
        setActiveSection(tabOrder[(idx - 1 + tabOrder.length) % tabOrder.length])
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [activeSection])

  // Refresh git status
  const refreshStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.git.status()
      if (result.error) {
        setError(result.error)
      } else {
        setStatus(result)
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }, [])

  // Refresh git log
  const refreshLog = useCallback(async () => {
    try {
      const result = await window.api.git.log(50)
      if (result.error) {
        setError(result.error)
      } else {
        setLogs(result)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  // Refresh branches
  const refreshBranches = useCallback(async () => {
    try {
      const result = await window.api.git.branches()
      if (result.error) {
        setError(result.error)
      } else {
        setBranches(result)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  // Load diff for a file
  const loadDiff = useCallback(async (filePath: string, staged: boolean) => {
    setLoading(true)
    try {
      const result = await window.api.git.diff(filePath, staged)
      if (result.error) {
        setError(result.error)
        setDiffContent('')
      } else {
        setDiffContent(result.content || '')
        setDiffStaged(staged)
      }
    } catch (err: any) {
      setError(err.message)
      setDiffContent('')
    }
    setLoading(false)
  }, [])

  // Handle file click - show diff
  const handleFileClick = useCallback(async (file: GitFileStatus) => {
    setSelectedFile(file.path)
    await loadDiff(file.path, file.staged)
    if (onFileSelect) {
      const result = await window.api.git.diff(file.path, file.staged)
      onFileSelect(file.path, result.content || '', file.staged)
    }
  }, [loadDiff, onFileSelect])

  // Handle commit click - show expanded files and diff
  const handleCommitClick = useCallback(async (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null)
      setCommitFiles([])
      setCommitDiff('')
      return
    }
    setLoading(true)
    try {
      const result = await window.api.git.show(hash)
      if (result.error) {
        setError(result.error)
      } else {
        setExpandedCommit(hash)
        setCommitFiles(result.files || [])
        setCommitDiff(result.diff || '')
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }, [expandedCommit])

  // Handle commit file click - show diff in main view
  const handleCommitFileClick = useCallback(async (file: GitCommitFile) => {
    if (!file.diff || !onFileSelect) return
    const filePath = file.path
    setSelectedFile(filePath)
    onFileSelect(filePath, file.diff, false, expandedCommit!)
  }, [onFileSelect, expandedCommit])

  // Stage a file
  const handleStage = useCallback(async (filePath: string) => {
    await window.api.git.add(filePath)
    await refreshStatus()
  }, [refreshStatus])

  // Unstage a file
  const handleUnstage = useCallback(async (filePath: string) => {
    await window.api.git.reset(filePath)
    await refreshStatus()
  }, [refreshStatus])

  // Discard changes (git checkout -- file)
  const handleDiscard = useCallback(async (filePath: string) => {
    await window.api.git.discard(filePath)
    await refreshStatus()
  }, [refreshStatus])

  // Delete untracked file
  const handleDeleteFile = useCallback(async (filePath: string) => {
    const fullPath = workspacePath ? `${workspacePath.replace(/\\/g, '/')}/${filePath}` : filePath
    await window.api.file.delete(fullPath)
    await refreshStatus()
  }, [refreshStatus, workspacePath])

  // Stage all files
  const handleStageAll = useCallback(async (filePaths: string[]) => {
    for (const fp of filePaths) {
      await window.api.git.add(fp)
    }
    await refreshStatus()
  }, [refreshStatus])

  // Unstage all files
  const handleUnstageAll = useCallback(async (filePaths: string[]) => {
    for (const fp of filePaths) {
      await window.api.git.reset(fp)
    }
    await refreshStatus()
  }, [refreshStatus])

  // Commit
  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return
    await window.api.git.commit({ message: commitMessage })
    setCommitMessage('')
    await refreshStatus()
    await refreshLog()
  }, [commitMessage, refreshStatus, refreshLog])

  // Checkout branch
  const handleCheckout = useCallback(async (branch: string) => {
    await window.api.git.checkout(branch)
    await refreshBranches()
    await refreshStatus()
  }, [refreshBranches, refreshStatus])

  // Apply worktree branch changes as file modifications (no commits)
  const handleApplyBranch = useCallback(async (branch: string) => {
    try {
      const result = await window.api.git.applyBranch(branch)
      if (result.error) {
        setError(result.error)
      } else {
        if (result.message) {
          setMessage(result.message)
          setTimeout(() => setMessage(null), 3000)
        }
        await refreshBranches()
        await refreshStatus()
      }
    } catch (err: any) {
      setError(err.message)
    }
    setContextMenu(null)
  }, [refreshBranches, refreshStatus])

  // Stash
  const handleStash = useCallback(async () => {
    await window.api.git.stashPush()
    await refreshStatus()
  }, [refreshStatus])

  // Pop stash
  const handlePush = useCallback(async () => {
    if (selectedRemote) {
      const parts = selectedRemote.split('/')
      const remote = parts[0]
      const branch = parts.slice(1).join('/')
      await window.api.git.push(remote, branch)
    } else {
      await window.api.git.push()
    }
    await refreshStatus()
    await refreshLog()
    await refreshBranches()
    setShowPushDropdown(false)
  }, [refreshStatus, refreshLog, refreshBranches, selectedRemote])

  const handleStashPop = useCallback(async () => {
    await window.api.git.stashPop()
    await refreshStatus()
  }, [refreshStatus])

  // Init git repo
  const handleInit = useCallback(async () => {
    const result = await window.api.git.init()
    if (result.success) {
      setError(null)
      setCurrentGitPath(workspacePath)
      await refreshStatus()
      await refreshLog()
      await refreshBranches()
    }
  }, [workspacePath, refreshStatus, refreshLog, refreshBranches])

  // Auto refresh on tab change
  // Initial load of all git data on mount
  useEffect(() => {
    refreshStatus()
    refreshLog()
    refreshBranches()
  }, [])

  // Ctrl+F → 切换到搜索面板
  useEffect(() => {
    if (searchFocusTrigger !== undefined && searchFocusTrigger > 0) {
      setActiveSection('search')
    }
  }, [searchFocusTrigger])

  // Load file tree
  const loadFileTree = useCallback(async () => {
    if (!workspacePath) return
    try {
      const result = await window.api.file.tree(workspacePath, fileTreeDepth)
      if (!result.error) {
        setFileTree(result)
      }
    } catch {}
  }, [workspacePath, fileTreeDepth])

  useEffect(() => {
    if (activeSection === 'file' && workspacePath) {
      loadFileTree()
    }
  }, [activeSection, workspacePath, loadFileTree])

  const [docTree, setDocTree] = useState<DocTreeNode[]>([])
  const [expandedDocDirs, setExpandedDocDirs] = useState<Set<string>>(new Set())

  // Load CLAUDE.md commands & tree
  const loadClaudeCommands = useCallback(async () => {
    if (!workspacePath) { setCommands([]); setDocTree([]); return }
    const mdPath = workspacePath.replace(/\\/g, '/') + '/CLAUDE.md'
    try {
      const res: any = await window.api.file.read(mdPath)
      if (res.error) { setCommands([]); setDocTree([]); return }
      const normalized = res.content.replace(/\r\n/g, '\n')
      setCommands(parseCommands(normalized))
      const docTreeResult = parseDocTree(normalized)
      setDocTree(docTreeResult)
      // Auto-expand first level
      setExpandedDocDirs(new Set(docTreeResult.filter(n => n.isDir).map(n => n.path)))
    } catch { setCommands([]); setDocTree([]) }
  }, [workspacePath])

  // Load on workspace change
  useEffect(() => { loadClaudeCommands() }, [workspacePath])

  // Reload commands every time user switches to Aux tab
  useEffect(() => {
    if (activeSection === 'terminal') loadClaudeCommands()
  }, [activeSection])

  const pendingCommandRef = useRef<string | null>(null)

  // Execute pending command when aux terminal becomes ready
  useEffect(() => {
    if (rightTerminalSession && pendingCommandRef.current) {
      const cmd = pendingCommandRef.current
      pendingCommandRef.current = null
      setTimeout(() => {
        window.api.terminal.write(rightTerminalSession.id, cmd + '\r')
      }, 400)
    }
  }, [rightTerminalSession])

  const handleRunCommand = useCallback((command: string) => {
    if (rightTerminalSession) {
      window.api.terminal.write(rightTerminalSession.id, command + '\r')
    } else if (activeSessionId) {
      pendingCommandRef.current = command
      onCreateRightTerminal?.(activeSessionId)
    }
  }, [rightTerminalSession, activeSessionId, onCreateRightTerminal])

  // Toggle directory expand
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Load remote branches
  useEffect(() => {
    if (activeSection === 'git' && status && workspacePath) {
      window.api.git.remoteBranches().then(result => {
        if (!result.error) {
          setRemoteBranches(result)
        }
      })
    }
  }, [activeSection, status, workspacePath])

  // Dismiss push dropdown on outside click
  useEffect(() => {
    if (!showPushDropdown) return
    const handleClick = () => setShowPushDropdown(false)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [showPushDropdown])

  // Initial load — handled by workspacePath effect above

  // Get status icon for file
  const getStatusIcon = (file: GitFileStatus): string => {
    switch (file.status) {
      case 'added': return 'A'
      case 'modified': return 'M'
      case 'deleted': return 'D'
      case 'renamed': return 'R'
      case 'untracked': return 'U'
      case 'conflicted': return 'C'
      default: return '?'
    }
  }

  const getStatusColor = (file: GitFileStatus): string => {
    switch (file.status) {
      case 'added': return 'text-ide-success'
      case 'modified': return 'ide-warning'
      case 'deleted': return 'text-ide-danger'
      case 'untracked': return 'text-ide-text-muted'
      case 'conflicted': return 'text-ide-danger'
      default: return 'text-ide-text-muted'
    }
  }

  const calcFileStats = (files: GitFileStatus[]) => {
    return files.reduce(
      (acc, f) => {
        acc.additions += f.additions || 0
        acc.deletions += f.deletions || 0
        return acc
      },
      { additions: 0, deletions: 0 }
    )
  }

  const splitPath = (filePath: string): { name: string; dir: string } => {
    const idx = filePath.lastIndexOf('/')
    if (idx === -1) return { name: filePath, dir: '' }
    return { name: filePath.slice(idx + 1), dir: filePath.slice(0, idx + 1) }
  }

  // 右侧终端打开文件的回调 - 触发中间终端切换到 edit
  const handleRightTerminalOpenFile = useCallback(async (fullPath: string, lineNumber?: number) => {
    if (onOpenFileFromRightTerminal) {
      onOpenFileFromRightTerminal(fullPath, lineNumber)
    }
  }, [onOpenFileFromRightTerminal])

  if (!workspacePath) {
    return (
      <div className="flex flex-col h-full">
        {/* 顶部栏目切换 — Codex 风格 */}
        <div className="h-10 flex items-center shrink-0 px-3 border-b border-ide-border">
          <span className="text-xs font-semibold text-ide-text tracking-wide uppercase">
            {activeSection === 'git' ? 'Git' : activeSection === 'terminal' ? 'Aux' : activeSection === 'search' ? 'Find' : activeSection === 'file' ? 'File' : 'Settings'}
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-0.5">
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'git' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
              onClick={() => setActiveSection('git')}
              title="Git"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M6 21V9a9 9 0 0 0 9 9" />
                <path d="M18 3v12" />
              </svg>
            </button>
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'terminal' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
              onClick={() => setActiveSection('terminal')}
              title="Aux"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </button>
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'search' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
              onClick={() => setActiveSection('search')}
              title="Find"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'file' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
              onClick={() => setActiveSection('file')}
              title="File"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">
          No active session
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏目切换 — Codex 风格 */}
      <div className="h-10 flex items-center shrink-0 px-3 border-b border-ide-border">
        <span className="text-xs font-semibold text-ide-text tracking-wide uppercase">
          {activeSection === 'git' ? 'Git' : activeSection === 'terminal' ? 'Aux' : activeSection === 'search' ? 'Find' : activeSection === 'file' ? 'File' : 'Settings'}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          <button
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'git' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            onClick={() => setActiveSection('git')}
            title="Git"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M6 21V9a9 9 0 0 0 9 9" />
              <path d="M18 3v12" />
            </svg>
          </button>
          <button
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'terminal' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            onClick={() => setActiveSection('terminal')}
            title="Aux"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>
          <button
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'search' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            onClick={() => setActiveSection('search')}
            title="Find"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${activeSection === 'file' ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            onClick={() => setActiveSection('file')}
            title="File"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Git 内容 */}
      {activeSection === 'git' && (
        <>
          {/* Branch + Git Tabs — 合并一行 */}
          {status && (
            <div className="h-9 pl-5 pr-3 flex items-center border-b border-ide-border shrink-0 gap-2">
              {/* Left: branch info */}
              <div className="flex items-center gap-1 min-w-0 flex-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 0-9 9" />
                </svg>
                <span className="text-sm text-ide-text font-medium truncate">{status.branch}</span>
                {status.ahead > 0 && <span className="text-ide-success text-[11px]">↑{status.ahead}</span>}
                {status.behind > 0 && <span className="text-ide-warning text-[11px]">↓{status.behind}</span>}
              </div>
              <button
                onClick={() => { refreshStatus(); refreshLog(); refreshBranches() }}
                className="text-ide-text-muted hover:text-ide-text transition-colors shrink-0 w-5 flex items-center justify-center"
                title="Refresh"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                </svg>
              </button>
            </div>
          )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {message && (
          <div className="px-3 py-2 text-sm text-ide-accent bg-ide-accent/10 animate-fade-in">
            <p>{message}</p>
          </div>
        )}
        {error && (
          <div className="px-3 py-2 text-sm text-ide-danger bg-ide-danger/10 animate-fade-in">
            <p className="mb-2">{error}</p>
            {/not a git/i.test(error) && (
              <button
                onClick={handleInit}
                className="px-3 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
              >
                git init
              </button>
            )}
          </div>
        )}

        {status && (
          <div className="flex flex-col">
            {/* Staged Changes */}
            {status && status.files.filter(f => f.staged).length > 0 && (
              <div className="border-b border-ide-border">
                {(() => {
                  const stagedFiles = status.files.filter(f => f.staged)
                  const stats = calcFileStats(stagedFiles)
                  return (
                    <div
                      className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                      onClick={() => setStagedExpanded(!stagedExpanded)}
                    >
                      <div className="flex items-center gap-1">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${stagedExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-success shrink-0">
                          <polyline points="21 8 21 21 3 21 3 8" />
                          <rect x="1" y="3" width="22" height="5" />
                          <line x1="10" y1="12" x2="14" y2="12" />
                        </svg>
                        <span>Staged ({stagedFiles.length})</span>
{stats.additions > 0 && <span className="text-ide-success font-mono">+{stats.additions}</span>}
                      {stats.deletions > 0 && <span className="text-ide-danger font-mono">-{stats.deletions}</span>}
                      </div>
                      {stagedExpanded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnstageAll(stagedFiles.map(f => f.path)) }}
                          className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors inline-flex items-center gap-1"
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fill-rule="evenodd" d="M9.75 3.5A2.75 2.75 0 0 0 7 6.25v5.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V6.25a4.25 4.25 0 0 1 8.5 0v1a.75.75 0 0 1-1.5 0v-1A2.75 2.75 0 0 0 9.75 3.5Z" clip-rule="evenodd" /></svg>
                          全部取消
                        </button>
                      )}
                    </div>
                  )
                })()}
                {stagedExpanded && status.files.filter(f => f.staged).map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`staged-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <span className={`font-bold ${getStatusColor(file)} w-3.5 text-center shrink-0`}>
                      {getStatusIcon(file)}
                    </span>
                    <span className="shrink-0 text-[11px]">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted text-[10px] min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <span className="shrink-0 w-5" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUnstage(file.path) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center"
                      title="取消暂存"
                    >
                      −
                    </button>
                  </div>
                )})}
              </div>
            )}

            {/* Unstaged Changes */}
            {status && status.files.filter(f => !f.staged && f.status !== 'untracked').length > 0 && (
              <div className="border-b border-ide-border">
                {(() => {
                  const modifiedFiles = status.files.filter(f => !f.staged && f.status !== 'untracked')
                  const stats = calcFileStats(modifiedFiles)
                  return (
                    <div
                      className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                      onClick={() => setChangesExpanded(!changesExpanded)}
                    >
                      <div className="flex items-center gap-1">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${changesExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span>Changes ({modifiedFiles.length})</span>
{stats.additions > 0 && <span className="text-ide-success font-mono">+{stats.additions}</span>}
                      {stats.deletions > 0 && <span className="text-ide-danger font-mono">-{stats.deletions}</span>}
                      </div>
                      {changesExpanded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStageAll(modifiedFiles.map(f => f.path)) }}
                          className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors inline-flex items-center gap-1"
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fill-rule="evenodd" d="M6.25 12.5A2.75 2.75 0 0 0 9 9.75V4.56L6.78 6.78a.75.75 0 0 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06L10.5 4.56v5.19a4.25 4.25 0 0 1-8.5 0v-1a.75.75 0 0 1 1.5 0v1a2.75 2.75 0 0 0 2.75 2.75Z" clip-rule="evenodd" /></svg>
                          全部暂存
                        </button>
                      )}
                    </div>
                  )
                })()}
                {changesExpanded && status.files.filter(f => !f.staged && f.status !== 'untracked').map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`unstaged-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <span className={`font-bold ${getStatusColor(file)} w-3.5 text-center shrink-0`}>
                      {getStatusIcon(file)}
                    </span>
                    <span className="shrink-0 text-[11px]">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted text-[10px] min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center"
                      title="暂存修改"
                    >
                      +
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'discard', filePath: file.path, fileName: name }) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center"
                      title="撤销修改"
                    >
                      −
                    </button>
                  </div>
                )})}
              </div>
            )}

            {/* Untracked Files */}
            {status && status.files.filter(f => f.status === 'untracked').length > 0 && (
              <div className="border-b border-ide-border">
                <div
                  className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                  onClick={() => setUntrackedExpanded(!untrackedExpanded)}
                >
                  <div className="flex items-center gap-1">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${untrackedExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-text-muted shrink-0">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                    <span>Untracked ({status.files.filter(f => f.status === 'untracked').length})</span>
                  </div>
                  {untrackedExpanded && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStageAll(status!.files.filter(f => f.status === 'untracked').map(f => f.path)) }}
                      className="text-[11px] font-normal normal-case px-2 py-0.5 rounded border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors inline-flex items-center gap-1"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fill-rule="evenodd" d="M6.25 12.5A2.75 2.75 0 0 0 9 9.75V4.56L6.78 6.78a.75.75 0 0 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06L10.5 4.56v5.19a4.25 4.25 0 0 1-8.5 0v-1a.75.75 0 0 1 1.5 0v1a2.75 2.75 0 0 0 2.75 2.75Z" clip-rule="evenodd" /></svg>
                      全部暂存
                    </button>
                  )}
                </div>
                {untrackedExpanded && status.files.filter(f => f.status === 'untracked').map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`untracked-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 ${
                      selectedFile === file.path ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => handleFileClick(file)}
                  >
                    <span className="font-bold text-ide-text-muted w-3.5 text-center shrink-0">U</span>
                    <span className="shrink-0 text-[11px]">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted text-[10px] min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center"
                      title="暂存修改"
                    >
                      +
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', filePath: file.path, fileName: name }) }}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center"
                      title="删除文件"
                    >
                      −
                    </button>
                  </div>
                )})}
              </div>
            )}

            {/* Clean state */}
            {status && status.clean && (
              <div className="px-2 py-2 text-xs text-ide-text-muted text-center">
                No changes detected
              </div>
            )}
          </div>
        )}

        <div className="mt-auto">
        {/* Commits / Log */}
        <div className="border-b border-ide-border">
          <div
            className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
            onClick={() => setLogExpanded(!logExpanded)}
          >
            <div className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${logExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Commits ({logs.length})</span>
            </div>
          </div>
          {logExpanded && (
            <div className="flex flex-col">
              {logs.length === 0 ? (
                <div className="px-2 py-2 text-xs text-ide-text-muted text-center">No commits yet</div>
              ) : (
                logs.map(entry => (
                <div key={entry.hash}>
                  <div
                    className={`pl-5 pr-2 py-1.5 border-b border-ide-border/50 hover:bg-ide-hover cursor-pointer ${
                      expandedCommit === entry.hash ? 'bg-ide-accent/10' : ''
                    }`}
                    onClick={() => handleCommitClick(entry.hash)}
                  >
                    <div className="text-xs text-ide-text truncate">{entry.message}</div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-ide-text-muted">
                      <span className="text-ide-accent">{entry.hash.slice(0, 7)}</span>
                      <span>{entry.author}</span>
                      <span>{new Date(entry.date).toLocaleDateString()}</span>
                      {entry.refs && <span className="text-ide-warning">{entry.refs}</span>}
                    </div>
                  </div>
                  {expandedCommit === entry.hash && (
                    <div className="bg-ide-bg border-b border-ide-border animate-fade-in">
                      <div className="pl-5 pr-2 py-1 text-[11px] text-ide-text-muted uppercase tracking-wider bg-ide-hover/50">
                        Files ({commitFiles.length})
                      </div>
                      {commitFiles.map(file => {
                        const { name, dir } = splitPath(file.path)
                        return (
                        <div
                          key={file.path}
                          className="pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1"
                          onClick={() => handleCommitFileClick(file)}
                        >
                          <span className={`text-xs font-bold w-3.5 text-center shrink-0 ${
                            file.status === 'added' ? 'text-ide-success' :
                            file.status === 'deleted' ? 'text-ide-danger' :
                            file.status === 'renamed' ? 'text-ide-warning' :
                            'text-ide-text-muted'
                          }`}>
                            {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M'}
                          </span>
                          <span className="shrink-0 text-[11px]">{name}</span>
                          {dir && <span className="truncate text-ide-text-muted text-[10px] min-w-0">{dir}</span>}
                          <span className="shrink-0 ml-auto flex items-center gap-1 text-[11px]">
                            {file.additions > 0 && <span className="text-ide-success font-mono">+{file.additions}</span>}
                            {file.deletions > 0 && <span className="text-ide-danger font-mono">-{file.deletions}</span>}
                          </span>
                        </div>
                      )})}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          )}
        </div>

        {/* Branches */}
        <div className="border-b border-ide-border">
          <div
            className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
            onClick={() => setBranchesExpanded(!branchesExpanded)}
          >
            <div className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${branchesExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                <circle cx="12" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="6" r="3" />
                <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 0-2 2v2" />
              </svg>
              <span>Branches ({branches.length})</span>
            </div>
          </div>
          {branchesExpanded && (
          <div className="flex flex-col">
            {branches.length === 0 ? (
              <div className="px-2 py-2 text-xs text-ide-text-muted text-center">No branches</div>
            ) : (
              branches.map(branch => (
                <div
                  key={branch.name}
                  className={`pl-5 pr-2 py-1.5 text-xs border-b border-ide-border/50 cursor-pointer flex items-center justify-between ${
                    branch.current ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text hover:bg-ide-hover'
                  }`}
                  onClick={() => !branch.current && handleCheckout(branch.name)}
                  onContextMenu={(e) => {
                    if (branch.name.startsWith('worktree-')) {
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, branchName: branch.name })
                    }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 0-9 9" />
                    </svg>
                    <span className="text-xs">{branch.name}</span>
                  </div>
                  {branch.current && (
                    <span className="text-xs text-ide-accent">current</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
      </div>
      </div>

      {/* Commit area */}
          {status && (
            <div className="shrink-0 border-t border-ide-border p-3">
              {/* Quick actions */}
              <div className="flex gap-2 mb-2">
                <button
                  onClick={handleStash}
                  className="text-xs text-ide-text-muted hover:text-ide-text px-2 py-1 rounded bg-ide-hover transition-colors"
                >
                  Stash
                </button>
                <button
                  onClick={handleStashPop}
                  className="text-xs text-ide-text-muted hover:text-ide-text px-2 py-1 rounded bg-ide-hover transition-colors"
                >
                  Pop Stash
                </button>
              </div>
              {status.clean && status.ahead > 0 ? (
                <div className="relative">
                  <div className="flex">
                    <button
                      onClick={handlePush}
                      className="flex-1 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-l transition-colors flex items-center justify-center gap-1.5"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                      Push{status.ahead > 0 ? ` (${status.ahead})` : ''}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowPushDropdown(!showPushDropdown) }}
                      className="py-1.5 px-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-r border-l border-white/20 transition-colors"
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </button>
                  </div>
                  {showPushDropdown && (
                    <div
                      className="absolute bottom-full left-0 right-0 mb-1 bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 max-h-40 overflow-y-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={handlePush}
                        className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${!selectedRemote ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text hover:bg-ide-hover'}`}
                      >
                        origin (default)
                      </button>
                      {remoteBranches.map(rb => (
                        <button
                          key={rb.name}
                          onClick={() => { setSelectedRemote(rb.name); handlePush() }}
                          className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${selectedRemote === rb.name ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text hover:bg-ide-hover'}`}
                        >
                          <span className="text-ide-text-muted">{rb.remote}/</span>{rb.branch}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <textarea
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message..."
                    className="w-full h-20 text-xs bg-ide-bg border border-ide-border rounded px-2 py-1 text-ide-text resize-none focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.ctrlKey) handleCommit()
                    }}
                  />
                  <button
                    onClick={handleCommit}
                    disabled={!commitMessage.trim()}
                    className="mt-2 w-full py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Commit (Ctrl+Enter)
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Aux 栏目 */}
      {activeSection === 'terminal' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTerminalSession ? (
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center text-ide-text-muted text-xs">Loading...</div>}>
                <TerminalView
                  sessionId={rightTerminalSession.id}
                  sessionName="Right Terminal"
                  sessionCwd={rightTerminalSession.cwd}
                  onOpenFile={handleRightTerminalOpenFile}
                  showHeader={false}
                  fontSize={12}
                  isAux={true}
                />
              </React.Suspense>
            ) : workspacePath ? (
              <div className="h-full flex items-center justify-center">
                <button
                  onClick={() => activeSessionId && onCreateRightTerminal?.(activeSessionId)}
                  className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
                >
                  {t('Launch Terminal')}
                </button>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-ide-text-muted text-xs">
                {t('Please select a workspace first')}
              </div>
            )}
          </div>
          {commands.length > 0 && (
            <div className="shrink-0 border-t border-ide-border" style={{ maxHeight: '40%', overflowY: 'auto' }}>
              <div className="px-2 py-1 text-[10px] text-ide-text-muted uppercase tracking-wider sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm">
                {t('Commands')}
              </div>
              {commands.map((cmd, i) => (
                <div key={i} className="px-2 py-0.5 flex items-center gap-1.5 hover:bg-ide-hover group">
                  <button
                    onClick={() => handleRunCommand(cmd.command)}
                    className="w-5 h-5 rounded text-ide-accent hover:bg-ide-accent/20 flex items-center justify-center shrink-0 transition-colors"
                    title={`Run: ${cmd.command}`}
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path fill-rule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clip-rule="evenodd" />
                    </svg>
                  </button>
                  <span className="text-[11px] font-mono font-semibold text-ide-text shrink-0 w-[8.5rem] truncate">{cmd.command}</span>
                  <span className="text-[10px] text-ide-text-muted/60 truncate">{cmd.comment}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search 栏目 */}
      {activeSection === 'search' && (
        <SearchPanel
          cwd={workspacePath}
          onOpenFile={(fullPath, lineNumber) => {
            if (onOpenFileFromSearch) {
              onOpenFileFromSearch(fullPath, lineNumber)
            }
          }}
          focusTrigger={searchFocusTrigger}
        />
      )}

      {/* File 栏目 — 文件浏览器 + 文档目录树 */}
      {activeSection === 'file' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {fileTree.length === 0 ? (
              <div className="flex items-center justify-center h-full text-ide-text-muted text-xs">
                {workspacePath ? 'Empty directory' : 'No workspace'}
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
                  />
                ))}
              </div>
            )}
          </div>
          {docTree.length > 0 && (
            <div className="shrink-0 border-t border-ide-border" style={{ maxHeight: '45%', overflowY: 'auto' }}>
              <div className="px-2 py-1 text-[10px] text-ide-text-muted uppercase tracking-wider sticky top-0 bg-ide-sidebar/95 backdrop-blur-sm flex items-center gap-1">
                <Lightbulb size={12} className="text-ide-text-muted" />
                <span>arch</span>
              </div>
              {docTree.map(node => (
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
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmAction(null)}>
          <div className="bg-ide-bg border border-ide-border rounded shadow-lg p-4 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ide-text mb-4">
              {confirmAction.type === 'discard'
                ? `确定撤销对 ${confirmAction.fileName} 的修改？此操作不可恢复。`
                : `确定删除 ${confirmAction.fileName}？此操作不可恢复。`
              }
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded"
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-ide-danger hover:bg-red-600 text-white rounded"
                onClick={async () => {
                  const { type, filePath } = confirmAction
                  setConfirmAction(null)
                  if (type === 'discard') {
                    await handleDiscard(filePath)
                  } else {
                    await handleDeleteFile(filePath)
                  }
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu for worktree branches */}
      {contextMenu && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => handleApplyBranch(contextMenu.branchName)}
          >
            合并修改
          </button>
        </div>
      )}
    </div>
  )
})

export default GitPanel