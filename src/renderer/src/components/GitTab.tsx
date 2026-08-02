import React, { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { useI18n } from '../i18n'
import { GitStatusResult, GitFileStatus, GitGraphEntry, GitBranch, GitCommitFile, GitLineLogEntry, TerminalSession } from '@shared/types'
import GitGraph from './GitGraph'

interface GitTabProps {
  workspacePath: string | null
  effectiveGitPath: string | null
  worktreeNav: { originalPath: string; worktreePath: string; originalBranch: string } | null
  onFileSelect?: (filePath: string, diffContent: string, isStaged: boolean, commitHash?: string, fullPath?: string) => void
  refreshKey?: number
  activeSessionId?: string | null
  isActive?: boolean
  rightTerminalSession?: TerminalSession | null
  onCloseRightTerminal?: (sessionId: string) => void
  onWorktreeNavChange: (updater: (prev: Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>) => Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>) => void
  onDiffScroll?: (delta: number) => void
  onNavigateToFile?: (filePath: string) => void
  lineHistoryPayload?: { filePath: string; lineNumber: number } | null
}

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
    case 'modified': return 'text-ide-warning'
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

type Section = 'staged' | 'unstaged' | 'untracked'

interface TreeNode {
  name: string
  path: string
  file?: GitFileStatus
  children?: TreeNode[]
  leafCount?: number
}

const buildFileTree = (files: GitFileStatus[]): TreeNode[] => {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLeaf = i === parts.length - 1
      const childPath = node.path ? `${node.path}/${part}` : part
      if (!node.children) node.children = []
      let child = node.children.find(c => c.name === part)
      if (!child) {
        child = isLeaf ? { name: part, path: childPath, file } : { name: part, path: childPath, children: [] }
        node.children.push(child)
      }
      node = child
    }
  }
  const sortNode = (n: TreeNode) => {
    if (!n.children) return
    n.children.sort((a, b) => {
      const aFile = !!a.file
      const bFile = !!b.file
      if (aFile !== bFile) return aFile ? 1 : -1
      return a.name.localeCompare(b.name)
    })
    n.children.forEach(sortNode)
  }
  const countLeaves = (n: TreeNode): number => {
    if (n.file) { n.leafCount = 1; return 1 }
    let c = 0
    for (const ch of n.children!) c += countLeaves(ch)
    n.leafCount = c
    return c
  }
  const compactNode = (n: TreeNode) => {
    if (!n.children) return
    for (const ch of n.children) compactNode(ch)
    let kids = n.children
    while (kids.length === 1 && !kids[0].file) {
      const child = kids[0]
      n.name = n.name ? `${n.name}/${child.name}` : child.name
      n.path = child.path
      n.children = child.children
      kids = child.children!
    }
  }
  sortNode(root)
  root.children!.forEach(compactNode)
  root.children!.forEach(countLeaves)
  return root.children || []
}

const collectLeafPaths = (node: TreeNode): string[] => {
  if (node.file) return [node.file.path]
  const paths: string[] = []
  if (node.children) {
    for (const ch of node.children) paths.push(...collectLeafPaths(ch))
  }
  return paths
}

const GRAPH_PAGE_SIZE = 50

export default function GitTab({ workspacePath, effectiveGitPath, worktreeNav, onFileSelect, refreshKey, activeSessionId, isActive, rightTerminalSession, onCloseRightTerminal, onWorktreeNavChange, onDiffScroll, onNavigateToFile, lineHistoryPayload }: GitTabProps) {
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)
  const [untrackedExpanded, setUntrackedExpanded] = useState(true)
  const [logExpanded, setLogExpanded] = useState(false)
  const [branchesExpanded, setBranchesExpanded] = useState(false)
  const [showRemoteBranches, setShowRemoteBranches] = useState(false)
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status

  // 大列表默认折叠（阈值 500），仅首次触发，后续由用户手动控制
  const largeSectionCollapsedRef = useRef(false)
  const LARGE_SECTION = 500
  useEffect(() => {
    if (largeSectionCollapsedRef.current || !status) return
    largeSectionCollapsedRef.current = true
    if (status.untracked > LARGE_SECTION) setUntrackedExpanded(false)
    if (status.unstaged > LARGE_SECTION) setChangesExpanded(false)
    if (status.staged > LARGE_SECTION) setStagedExpanded(false)
  }, [status])
  const [graphEntries, setGraphEntries] = useState<GitGraphEntry[]>([])
  const [hasMoreGraph, setHasMoreGraph] = useState(true)
  const [loadingMoreGraph, setLoadingMoreGraph] = useState(false)
  const loadingMoreRef = useRef(false)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')
  const [diffStaged, setDiffStaged] = useState<boolean>(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const pendingGitPathRef = useRef<string | null>(null)
  const notGitRef = useRef<boolean>(false)
  const notGitPathRef = useRef<string | null>(null)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitIsRoot, setCommitIsRoot] = useState(false)
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  const [commitFileCount, setCommitFileCount] = useState(0)
  const [commitDiff, setCommitDiff] = useState<string>('')
  const fsChangedHandlerRef = useRef<any>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; branchName: string } | null>(null)
  const [commitContextMenu, setCommitContextMenu] = useState<{ x: number; y: number; hash: string; message: string } | null>(null)
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; filePath: string; fullPath: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: string; filePath?: string; fileName?: string; filePaths?: string[]; count?: number; branch?: string; message?: string } | null>(null)
  const [conflictApply, setConflictApply] = useState<{ branch: string; message: string } | null>(null)
  const [remoteBranches, setRemoteBranches] = useState<{ name: string; remote: string; branch: string }[]>([])
  const [selectedRemote, setSelectedRemote] = useState<string>('')
  const [showPushDropdown, setShowPushDropdown] = useState(false)
  const [stashCount, setStashCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const gitRootRef = useRef<string | null>(null)
  const resolveFullPath = useCallback((filePath: string) => {
    const base = gitRootRef.current || effectiveGitPath
    return base ? `${base.replace(/\\/g, '/')}/${filePath}` : filePath
  }, [effectiveGitPath])

  const handleCopyFilePath = useCallback((path: string) => {
    navigator.clipboard.writeText(path)
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => {
      setCopied(false)
      setFileContextMenu(null)
    }, 600)
  }, [])
  const [treeView, setTreeView] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set())
  const toggleFolder = useCallback((key: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Line history (git log -L) state
  const [lineHistoryExpanded, setLineHistoryExpanded] = useState(false)
  const [lineHistoryEntries, setLineHistoryEntries] = useState<GitLineLogEntry[]>([])
  const [lineHistoryLoading, setLineHistoryLoading] = useState(false)
  const [lineHistoryFilePath, setLineHistoryFilePath] = useState<string | null>(null)
  const [lineHistoryLine, setLineHistoryLine] = useState<number | null>(null)

  // Error auto-dismiss after 5 seconds
  useEffect(() => {
    if (!error) return
    if (/not a git/i.test(error)) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error])

  // Line history: react to payload changes
  useEffect(() => {
    if (!lineHistoryPayload || !lineHistoryPayload.filePath || !lineHistoryPayload.lineNumber) return
    const fp = lineHistoryPayload.filePath
    const ln = lineHistoryPayload.lineNumber
    setLineHistoryFilePath(fp)
    setLineHistoryLine(ln)
    setLineHistoryExpanded(true)
    setLineHistoryLoading(true)
    setExpandedCommit(null)
    setLineHistoryEntries([])
    window.api.git.lineLog(fp, ln, ln).then(result => {
      if (Array.isArray(result)) {
        setLineHistoryEntries(result)
      } else if (result?.error) {
        setError(result.error)
        setLineHistoryEntries([])
      }
      setLineHistoryLoading(false)
    }).catch(() => {
      setLineHistoryLoading(false)
    })
  }, [lineHistoryPayload])

  const stagedTree = useMemo(() => buildFileTree(status?.files?.filter(f => f.staged) || []), [status])
  const unstagedTree = useMemo(() => buildFileTree(status?.files?.filter(f => !f.staged && f.status !== 'untracked') || []), [status])
  const untrackedTree = useMemo(() => buildFileTree(status?.files?.filter(f => f.status === 'untracked') || []), [status])

  // 可导航项：section 标题栏 + 文件行（树型含文件夹节点），从上往下
  type NavItem = { type: 'header'; section: Section } | { type: 'file'; file: GitFileStatus; section: Section } | { type: 'folder'; section: Section; folderPath: string } | { type: 'commit' }
  const navigableItems = useMemo(() => {
    if (!status?.files) return [] as NavItem[]
    const items: NavItem[] = []
    const stagedFiles = status.files.filter(f => f.staged)
    const unstagedFiles = status.files.filter(f => !f.staged && f.status !== 'untracked')
    const untrackedFiles = status.files.filter(f => f.status === 'untracked')
    const walk = (nodes: TreeNode[], section: Section) => {
      for (const n of nodes) {
        if (n.file) {
          items.push({ type: 'file', file: n.file, section })
        } else {
          items.push({ type: 'folder', section, folderPath: n.path })
          if (!collapsedFolders.has(`${section}:${n.path}`) && n.children) walk(n.children, section)
        }
      }
    }
    const addSection = (section: Section, files: GitFileStatus[], tree: TreeNode[], expanded: boolean) => {
      if (files.length === 0) return
      items.push({ type: 'header', section })
      if (!expanded) return
      if (treeView) walk(tree, section)
      else files.forEach(f => items.push({ type: 'file', file: f, section }))
    }
    addSection('staged', stagedFiles, stagedTree, stagedExpanded)
    addSection('unstaged', unstagedFiles, unstagedTree, changesExpanded)
    addSection('untracked', untrackedFiles, untrackedTree, untrackedExpanded)
    if (!(status.clean && status.ahead > 0)) {
      items.push({ type: 'commit' })
    }
    return items
  }, [status, stagedTree, unstagedTree, untrackedTree, stagedExpanded, changesExpanded, untrackedExpanded, treeView, collapsedFolders])

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const focusedIndexRef = useRef<number | null>(null)
  useEffect(() => { focusedIndexRef.current = focusedIndex }, [focusedIndex])
  const navigableItemsRef = useRef(navigableItems)
  navigableItemsRef.current = navigableItems

  // 切 session 或切走 tab 时清除键盘导航高亮
  useEffect(() => { setFocusedIndex(null) }, [activeSessionId])
  useEffect(() => { if (!isActive) setFocusedIndex(null) }, [isActive])


  // 当前高亮的标题栏：仅当 focusedIndex 指向 header 类型时
  const focusedHeaderSection = useMemo(() => {
    if (focusedIndex === null) return null
    const item = navigableItems[focusedIndex]
    return item?.type === 'header' ? item.section : null
  }, [focusedIndex, navigableItems])

  // 当前高亮的文件 key（section:path，避免同文件在 staged+unstaged 并行命中）
  const focusedFileKey = useMemo(() => {
    if (focusedIndex === null) return null
    const item = navigableItems[focusedIndex]
    return item?.type === 'file' ? `${item.section}:${item.file.path}` : null
  }, [focusedIndex, navigableItems])

  // 当前高亮的文件夹 key（section:folderPath）
  const focusedFolderKey = useMemo(() => {
    if (focusedIndex === null) return null
    const item = navigableItems[focusedIndex]
    return item?.type === 'folder' ? `${item.section}:${item.folderPath}` : null
  }, [focusedIndex, navigableItems])

  const focusedCommit = useMemo(() => {
    if (focusedIndex === null) return false
    const item = navigableItems[focusedIndex]
    return item?.type === 'commit'
  }, [focusedIndex, navigableItems])

  // Refresh git status
  const refreshStatus = useCallback(async () => {
    if (notGitRef.current && notGitPathRef.current === effectiveGitPath) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.git.status()
      if (result.error) {
        setError(result.error)
        setStatus(null)
        const isNotGit = /not a git/i.test(result.error)
        notGitRef.current = isNotGit
        notGitPathRef.current = isNotGit ? effectiveGitPath : null
      } else {
        setStatus(result)
        notGitRef.current = false
        notGitPathRef.current = null
      }
    } catch (err: any) {
      setError(err.message)
      setStatus(null)
      const isNotGit = /not a git/i.test(err.message)
      notGitRef.current = isNotGit
      notGitPathRef.current = isNotGit ? effectiveGitPath : null
    }
    setLoading(false)
  }, [effectiveGitPath])

  const refreshGraph = useCallback(async () => {
    try {
      const result = await window.api.git.graph({ count: GRAPH_PAGE_SIZE, skip: 0 })
      if (result.error) {
        if (!/does not have any commits/.test(result.error)) {
          setError(result.error)
        }
      } else {
        setGraphEntries(result)
        setHasMoreGraph(result.length >= GRAPH_PAGE_SIZE)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  const loadMoreGraph = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreGraph) return
    loadingMoreRef.current = true
    setLoadingMoreGraph(true)
    try {
      const result = await window.api.git.graph({ count: GRAPH_PAGE_SIZE, skip: graphEntries.length })
      if (result.error) {
        if (!/does not have any commits/.test(result.error)) {
          setError(result.error)
        }
      } else if (result.length > 0) {
        setGraphEntries(prev => [...prev, ...result])
        setHasMoreGraph(result.length >= GRAPH_PAGE_SIZE)
      } else {
        setHasMoreGraph(false)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      loadingMoreRef.current = false
      setLoadingMoreGraph(false)
    }
  }, [hasMoreGraph, graphEntries.length])

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

  const refreshStashCount = useCallback(async () => {
    const list = await window.api.git.stashList()
    if (Array.isArray(list)) {
      setStashCount(list.length)
    }
  }, [])

  // Handle file click - show diff
  const handleFileClick = useCallback(async (file: GitFileStatus) => {
    setSelectedFile(file.path)
    setLoading(true)
    try {
      const result = await window.api.git.diff(file.path, file.staged)
      if (result.error) {
        setError(result.error)
        setDiffContent('')
      } else {
        setDiffContent(result.content || '')
        setDiffStaged(file.staged)
      }
      if (onFileSelect) {
        const resolvedFullPath = resolveFullPath(file.path)
        onFileSelect(file.path, result.content || '', file.staged, undefined, resolvedFullPath)
      }
    } catch (err: any) {
      setError(err.message)
      setDiffContent('')
    }
    setLoading(false)
  }, [onFileSelect, effectiveGitPath])
  const handleFileClickRef = useRef(handleFileClick)
  handleFileClickRef.current = handleFileClick

  // Handle commit click - show expanded files and diff
  const handleCommitClick = useCallback(async (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null)
      setCommitIsRoot(false)
      setCommitFiles([])
      setCommitFileCount(0)
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
        setCommitIsRoot(result.isRoot || false)
        setCommitFiles(result.files || [])
        setCommitFileCount(result.fileCount || result.files?.length || 0)
        setCommitDiff(result.diff || '')
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }, [expandedCommit])

  // Handle commit file click - load diff on demand, then show in main view
  const handleCommitFileClick = useCallback(async (file: GitCommitFile) => {
    if (!onFileSelect || !expandedCommit) return
    setSelectedFile(file.path)
    setLoading(true)
    try {
      const result = await window.api.git.diffCommitFile(expandedCommit, file.path, commitIsRoot)
      const diff = result.error ? '' : (result.diff || '')
      const resolvedFullPath = resolveFullPath(file.path)
      onFileSelect(file.path, diff, false, expandedCommit, resolvedFullPath)
    } catch {
      onFileSelect(file.path, '', false, expandedCommit, resolveFullPath(file.path))
    }
    setLoading(false)
  }, [onFileSelect, expandedCommit, commitIsRoot, resolveFullPath])

  // Stage a file
  const handleStage = useCallback(async (filePath: string) => {
    setBusy(true)
    try { await window.api.git.add(filePath); await refreshStatus() }
    finally { setBusy(false) }
  }, [refreshStatus])

  // Unstage a file
  const handleUnstage = useCallback(async (filePath: string) => {
    setBusy(true)
    try { await window.api.git.reset(filePath); await refreshStatus() }
    finally { setBusy(false) }
  }, [refreshStatus])

  // Discard changes (git checkout -- file)
  const handleDiscard = useCallback(async (filePath: string) => {
    setBusy(true)
    try { await window.api.git.discard(filePath); await refreshStatus() }
    finally { setBusy(false) }
  }, [refreshStatus])

  // Delete untracked file
  const handleDeleteFile = useCallback(async (filePath: string) => {
    setBusy(true)
    try {
      const fullPath = resolveFullPath(filePath)
      await window.api.file.delete(fullPath)
      await refreshStatus()
    } finally { setBusy(false) }
  }, [refreshStatus, resolveFullPath])

  // Stage all files — accepts string sentinels ('-u' / '.') for fast bulk staging, or file path arrays
  const handleStageAll = useCallback(async (files: string | string[]) => {
    if (Array.isArray(files) && files.length === 0) return
    setBusy(true)
    try { await window.api.git.add(files); await refreshStatus() }
    finally { setBusy(false) }
  }, [refreshStatus])

  // Unstage all files
  const handleUnstageAll = useCallback(async (filePaths: string[]) => {
    if (filePaths.length === 0) return
    setBusy(true)
    try { await window.api.git.reset(filePaths); await refreshStatus() }
    finally { setBusy(false) }
  }, [refreshStatus])

  // Discard all unstaged changes
  const handleDiscardAll = useCallback(async (filePaths: string[]) => {
    if (filePaths.length === 0) return
    setBusy(true)
    try {
      for (const p of filePaths) { await window.api.git.discard(p) }
      await refreshStatus()
    } finally { setBusy(false) }
  }, [refreshStatus])

  // Delete all untracked files
  const handleDeleteAllUntracked = useCallback(async (filePaths: string[]) => {
    if (filePaths.length === 0) return
    setBusy(true)
    try {
      for (const p of filePaths) {
        const fullPath = resolveFullPath(p)
        await window.api.file.delete(fullPath)
      }
      await refreshStatus()
    } finally { setBusy(false) }
  }, [refreshStatus, resolveFullPath])

  // Commit
  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return
    setBusy(true)
    try {
      await window.api.git.commit({ message: commitMessage })
      setCommitMessage('')
      await refreshStatus()
      await refreshGraph()
    } finally { setBusy(false) }
  }, [commitMessage, refreshStatus, refreshGraph])

  // Amend — 有暂存或新信息时执行：有新信息用 -m 改写，否则 --no-edit 保留原信息
  const handleAmend = useCallback(async () => {
    setBusy(true)
    try {
      const msg = commitMessage.trim()
      await window.api.git.amend(msg ? { message: msg } : {})
      setCommitMessage('')
      await refreshStatus()
      await refreshGraph()
    } finally { setBusy(false) }
  }, [commitMessage, refreshStatus, refreshGraph])

  // Checkout branch
  const handleCheckout = useCallback(async (branch: string) => {
    setBusy(true)
    try {
      await window.api.git.checkout(branch)
      await refreshBranches()
      await refreshStatus()
    } finally { setBusy(false) }
  }, [refreshBranches, refreshStatus])

  // Navigate to worktree
  const handleNavigateToWorktree = useCallback(async (branch: string) => {
    setBusy(true)
    try {
      const result = await window.api.git.getWorktreePath(branch)
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.path) {
        if (rightTerminalSession && activeSessionId) {
          onCloseRightTerminal?.(activeSessionId)
        }
        onWorktreeNavChange(prev => {
          const existing = prev[activeSessionId!]
          return {
            ...prev,
            [activeSessionId!]: {
              originalPath: existing?.originalPath || workspacePath!,
              worktreePath: result.path,
              originalBranch: existing?.originalBranch || statusRef.current?.branch || ''
            }
          }
        })
      }
    } catch (err: any) {
      setError(err.message)
    } finally { setBusy(false) }
  }, [workspacePath, rightTerminalSession, activeSessionId, onCloseRightTerminal, onWorktreeNavChange])

  // Return from worktree navigation
  const handleBackFromWorktree = useCallback(() => {
    if (rightTerminalSession && activeSessionId) {
      onCloseRightTerminal?.(activeSessionId)
    }
    onWorktreeNavChange(prev => {
      const next = { ...prev }
      delete next[activeSessionId!]
      return next
    })
  }, [rightTerminalSession, activeSessionId, onCloseRightTerminal, onWorktreeNavChange])

  // Delete worktree branch
  const handleDeleteWorktree = useCallback(async (branch: string, force = false) => {
    setContextMenu(null)
    setBusy(true)
    try {
      if (!force && worktreeNav && worktreeNav.worktreePath) {
        const wtListResult = await window.api.git.getWorktreePath(branch)
        if (wtListResult.path && wtListResult.path === worktreeNav.worktreePath) {
          handleBackFromWorktree()
        }
      }
      const result = await window.api.git.deleteWorktree(branch, force)
      if (result.locked) {
        setConfirmAction({ type: 'forceDeleteWorktree', branch, message: result.lockReason })
      } else if (result.error) {
        setError(result.error)
      } else {
        await refreshBranches()
        await refreshStatus()
      }
    } catch (err: any) {
      setError(err.message)
    } finally { setBusy(false) }
  }, [worktreeNav, handleBackFromWorktree, refreshBranches, refreshStatus])

  // Delete a regular local branch
  const handleDeleteBranch = useCallback(async (branch: string) => {
    setContextMenu(null)
    setBusy(true)
    try {
      const result = await window.api.git.deleteBranch(branch)
      if (result.error) {
        setError(result.error)
      } else {
        await refreshBranches()
        await refreshStatus()
      }
    } catch (err: any) {
      setError(err.message)
    } finally { setBusy(false) }
  }, [refreshBranches, refreshStatus])

  // Apply worktree branch changes
  const handleApplyBranch = useCallback(async (branch: string) => {
    setContextMenu(null)
    setBusy(true)
    try {
      const result = await window.api.git.applyBranch(branch)
      if (result.conflict) {
        setConflictApply({ branch, message: result.message })
        return
      }
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
    } finally { setBusy(false) }
  }, [refreshBranches, refreshStatus])

  // Stash
  const handleStash = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.git.stashPush()
      await refreshStatus()
      await refreshStashCount()
    } finally { setBusy(false) }
  }, [refreshStatus, refreshStashCount])

  // Pop stash
  const handleStashPop = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.git.stashPop()
      await refreshStatus()
      await refreshStashCount()
    } finally { setBusy(false) }
  }, [refreshStatus, refreshStashCount])

  // Drop stash
  const handleStashDrop = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.git.stashDrop()
      await refreshStatus()
      await refreshStashCount()
    } finally { setBusy(false) }
  }, [refreshStatus, refreshStashCount])

  // Push
  const handlePush = useCallback(async (force = false) => {
    setBusy(true)
    try {
      if (selectedRemote) {
        const parts = selectedRemote.split('/')
        const remote = parts[0]
        const branch = parts.slice(1).join('/')
        await window.api.git.push(remote, branch, force)
      } else {
        await window.api.git.push(undefined, undefined, force)
      }
      await refreshStatus()
      await refreshGraph()
      await refreshBranches()
      setShowPushDropdown(false)
    } finally { setBusy(false) }
  }, [refreshStatus, refreshGraph, refreshBranches, selectedRemote])

  // Init git repo
  const handleInit = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.api.git.init()
      if (result.success) {
        setError(null)
        notGitRef.current = false
        notGitPathRef.current = null
        pendingGitPathRef.current = workspacePath
        await refreshStatus()
        await refreshGraph()
        await refreshBranches()
      }
    } finally { setBusy(false) }
  }, [workspacePath, refreshStatus, refreshGraph, refreshBranches])

  // Switch git workspace when effective path changes
  useEffect(() => {
    if (!effectiveGitPath || pendingGitPathRef.current === effectiveGitPath) return

    pendingGitPathRef.current = effectiveGitPath
    notGitRef.current = false
    notGitPathRef.current = null
    const targetPath = effectiveGitPath

    setGraphEntries([])
    setHasMoreGraph(true)
    setBranches([])
    setError(null)
    setSelectedFile(null)
    setDiffContent('')
    setLoading(true)

    const switchWorkspace = async () => {
      const result = await window.api.git.setWorkspace(targetPath)
      if (pendingGitPathRef.current !== targetPath) return
      if (result.success) {
        gitRootRef.current = result.gitRoot || targetPath
        await refreshStatus()
        refreshGraph()
        refreshBranches()
        refreshStashCount()
      }
      setLoading(false)
    }
    switchWorkspace()
  }, [effectiveGitPath])

  // Handle refreshKey changes (triggered by Ctrl+S in DiffViewer)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refreshStatus()
    }
  }, [refreshKey])

  // Listen for fs:changed events from file watcher
  useEffect(() => {
    fsChangedHandlerRef.current = window.api.file.onChanged(() => {
      refreshStatus()
      if (logExpanded) refreshGraph()
    })

    return () => {
      window.api.file.removeChangedListener(fsChangedHandlerRef.current)
    }
  }, [logExpanded])

  // Dismiss context menus on outside click
  useEffect(() => {
    const handleClick = () => { setContextMenu(null); setCommitContextMenu(null); setFileContextMenu(null) }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  // Load remote branches
  useEffect(() => {
    if (status && workspacePath) {
      window.api.git.remoteBranches().then(result => {
        if (result && !result.error) {
          setRemoteBranches(result)
        }
      }).catch(() => {})
    }
  }, [status, workspacePath])

  // Dismiss push dropdown on outside click
  useEffect(() => {
    if (!showPushDropdown) return
    const handleClick = () => setShowPushDropdown(false)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [showPushDropdown])

  // Keyboard navigation: ArrowUp/Down 遍历标题栏+文件行，文件行自动打开 diff；Enter 触发标题栏批量操作
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!isActiveRef.current) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        onDiffScroll?.(e.key === 'PageDown' ? 1 : -1)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (navigableItems.length === 0) return
        e.preventDefault()
        setFocusedIndex(prev => {
          const next = e.key === 'ArrowDown'
            ? (prev === null ? 0 : Math.min(prev + 1, navigableItems.length - 1))
            : (prev === null ? navigableItems.length - 1 : Math.max(prev - 1, 0))
          return next
        })
      } else if (e.key === 'Enter') {
        const idx = focusedIndexRef.current
        if (idx === null) return
        const item = navigableItems[idx]
        if (item?.type === 'header' && statusRef.current?.files) {
          e.preventDefault()
          const files = statusRef.current.files
          if (item.section === 'staged') {
            handleUnstageAll(files.filter(f => f.staged).map(f => f.path))
          } else if (item.section === 'unstaged') {
            handleStageAll('-u')
          } else if (item.section === 'untracked') {
            const untrackedPaths = files.filter(f => f.status === 'untracked').map(f => f.path)
            const hasUnstaged = files.some(f => !f.staged && f.status !== 'untracked')
            handleStageAll(hasUnstaged ? untrackedPaths : '.')
          }
        } else if (item?.type === 'folder') {
          e.preventDefault()
          toggleFolder(`${item.section}:${item.folderPath}`)
        } else if (item?.type === 'commit') {
          e.preventDefault()
          textareaRef.current?.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [navigableItems, onDiffScroll])

  // focusedIndex 落到文件行时自动打开 diff（仅响应用户键盘导航）
  useEffect(() => {
    if (focusedIndex === null) return
    if (!isActive) return
    const items = navigableItemsRef.current
    if (focusedIndex >= items.length) return
    const item = items[focusedIndex]
    if (item?.type === 'file') handleFileClickRef.current(item.file)
  }, [focusedIndex])

  // Detect conflict markers in staged files
  const hasConflictInStaged = status?.files?.some(f => f.staged && f.status === 'conflicted') ?? false

  // Amend 四场景：暂存区有无 × 提交信息有无
  const stagedFileCount = status?.files?.filter(f => f.staged).length ?? 0
  const hasStaged = stagedFileCount > 0
  const hasMessage = !!commitMessage.trim()
  const hasCommits = graphEntries.length > 0
  const amendDisabled = busy || !hasCommits || hasConflictInStaged || (!hasStaged && !hasMessage)
  const amendTooltip = !hasCommits
    ? t('Nothing to amend (no commits yet)')
    : (!hasStaged && !hasMessage)
    ? t('Nothing to amend (no staged changes and no new message)')
    : hasStaged && hasMessage
    ? t('Amend: fold {count} staged file(s) into last commit and rewrite message').replace('{count}', String(stagedFileCount))
    : hasStaged
    ? t('Amend: fold {count} staged file(s) into last commit, keep original message').replace('{count}', String(stagedFileCount))
    : t('Amend: rewrite last commit message only')

  const renderFileRow = (file: GitFileStatus, section: Section, depth: number) => {
    const { name } = splitPath(file.path)
    const focused = focusedFileKey === `${section}:${file.path}`
    return (
      <div
        key={`${section}-${file.path}`}
        style={{ paddingLeft: 4 + depth * 12 + 16 }}
        className={`pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 git-tab__file-item ${focused ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'}`}
        onClick={() => { const idx = navigableItems.findIndex(item => item.type === 'file' && item.section === section && item.file.path === file.path); if (idx >= 0) setFocusedIndex(idx); handleFileClick(file) }}
        onContextMenu={(e) => {
          e.preventDefault()
          const fullPath = resolveFullPath(file.path)
          setFileContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path, fullPath })
        }}
      >
        <span className={`font-bold ${getStatusColor(file)} w-3.5 text-center shrink-0`}>
          {getStatusIcon(file)}
        </span>
        <span className="shrink-0 git-fname">{name}</span>
        <span className="flex-1" />
        {section === 'staged' && (
          <>
            <span className="shrink-0 w-5" />
            <button
              onClick={(e) => { e.stopPropagation(); handleUnstage(file.path) }}
              disabled={busy}
              className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
              title={t('Unstage')}
            >
              −
            </button>
          </>
        )}
        {section === 'unstaged' && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
              disabled={busy}
              className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center disabled:opacity-40"
              title={t('Stage')}
            >
              +
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'discard', filePath: file.path, fileName: name }) }}
              disabled={busy}
              className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
              title={t('Discard')}
            >
              −
            </button>
          </>
        )}
        {section === 'untracked' && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
              disabled={busy}
              className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center disabled:opacity-40"
              title={t('Stage')}
            >
              +
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', filePath: file.path, fileName: name }) }}
              disabled={busy}
              className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
              title={t('Delete')}
            >
              −
            </button>
          </>
        )}
      </div>
    )
  }

  const renderTree = (nodes: TreeNode[], section: Section, depth: number) => {
    return nodes.map(node => {
      if (node.file) return renderFileRow(node.file, section, depth)
      const key = `${section}:${node.path}`
      const collapsed = collapsedFolders.has(key)
      const focused = focusedFolderKey === key
      return (
        <Fragment key={`folder-${key}`}>
          <div
            className={`pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 git-tab__file-item git-tab__folder-item ${focused ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'}`}
            style={{ paddingLeft: 4 + depth * 12 }}
            onClick={() => toggleFolder(key)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}><path d="M4 6l4 4 4-4" /></svg>
            {collapsed ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <path d="M2 10h12l2 4h6" />
              </svg>
            )}
            <span className="shrink-0 git-fname">{node.name}</span>
            {(node.leafCount ?? 0) > 1 && <span className="text-[11px] text-ide-text-muted">({node.leafCount})</span>}
            <span className="flex-1" />
            {section === 'staged' && (
              <>
                <span className="shrink-0 w-5" />
                <button
                  onClick={(e) => { e.stopPropagation(); handleUnstageAll(collectLeafPaths(node)) }}
                  disabled={busy}
                  className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
                  title={t('Unstage')}
                >
                  −
                </button>
              </>
            )}
            {section === 'unstaged' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleStageAll(collectLeafPaths(node)) }}
                  disabled={busy}
                  className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center disabled:opacity-40"
                  title={t('Stage')}
                >
                  +
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); const paths = collectLeafPaths(node); setConfirmAction({ type: 'discardAll', filePaths: paths, count: paths.length }) }}
                  disabled={busy}
                  className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
                  title={t('Discard')}
                >
                  −
                </button>
              </>
            )}
            {section === 'untracked' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleStageAll(collectLeafPaths(node)) }}
                  disabled={busy}
                  className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center disabled:opacity-40"
                  title={t('Stage')}
                >
                  +
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); const paths = collectLeafPaths(node); setConfirmAction({ type: 'deleteAll', filePaths: paths, count: paths.length }) }}
                  disabled={busy}
                  className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
                  title={t('Delete')}
                >
                  −
                </button>
              </>
            )}
          </div>
          {!collapsed && node.children && renderTree(node.children, section, depth + 1)}
        </Fragment>
      )
    })
  }

  const visibleBranches = showRemoteBranches ? branches : branches.filter(b => !b.remote)

  return (
    <>
      {/* Branch info bar */}
      {status && (
        <div className="h-9 pl-5 pr-4 flex items-center border-b border-ide-border shrink-0 gap-2 acrylic-titlebar-clean git-tab__header">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-ide-accent shrink-0">
              <path d="M21 8.25C21 6.1815 19.3185 4.5 17.25 4.5C15.1815 4.5 13.5 6.1815 13.5 8.25C13.5 10.023 14.739 11.5035 16.395 11.892C16.116 12.819 15.2655 13.5 14.25 13.5H9.75C8.9025 13.5 8.1285 13.7925 7.5 14.268V7.4235C9.21 7.0755 10.5 5.5605 10.5 3.75C10.5 1.6815 8.8185 0 6.75 0C4.6815 0 3 1.6815 3 3.75C3 5.562 4.29 7.0755 6 7.4235V16.575C4.29 16.923 3 18.438 3 20.2485C3 22.317 4.6815 23.9985 6.75 23.9985C8.8185 23.9985 10.5 22.317 10.5 20.2485C10.5 18.4755 9.261 16.995 7.605 16.6065C7.884 15.6795 8.7345 14.9985 9.75 14.9985H14.25C16.0845 14.9985 17.61 13.6725 17.931 11.9295C19.674 11.607 21 10.0845 21 8.25ZM4.5 3.75C4.5 2.5095 5.5095 1.5 6.75 1.5C7.9905 1.5 9 2.5095 9 3.75C9 4.9905 7.9905 6 6.75 6C5.5095 6 4.5 4.9905 4.5 3.75ZM9 20.25C9 21.4905 7.9905 22.5 6.75 22.5C5.5095 22.5 4.5 21.4905 4.5 20.25C4.5 19.0095 5.5095 18 6.75 18C7.9905 18 9 19.0095 9 20.25ZM17.25 10.5C16.0095 10.5 15 9.4905 15 8.25C15 7.0095 16.0095 6 17.25 6C18.4905 6 19.5 7.0095 19.5 8.25C19.5 9.4905 18.4905 10.5 17.25 10.5Z" />
            </svg>
            <span className="text-sm text-ide-text font-medium truncate git-tab__branch-name">{status.branch}</span>
            {status.ahead > 0 && <span className="text-ide-success text-[11px]">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="text-ide-warning text-[11px]">↓{status.behind}</span>}
          </div>
          <button
            onClick={() => setTreeView(v => !v)}
            className={`transition-colors shrink-0 w-5 flex items-center justify-center ${treeView ? 'text-ide-accent' : 'text-ide-text-muted hover:text-ide-text'}`}
            title={t('Toggle Tree View')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <rect x="9" y="2" width="6" height="5" rx="1" />
              <rect x="2" y="17" width="6" height="5" rx="1" />
              <rect x="16" y="17" width="6" height="5" rx="1" />
              <path d="M12 7v4M5 17v-6h14v6" />
            </svg>
          </button>
          <button
            onClick={() => { refreshStatus(); refreshGraph(); refreshBranches() }}
            className="text-ide-text-muted hover:text-ide-text transition-colors shrink-0 w-5 flex items-center justify-center"
            title={t('Refresh')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      <div ref={containerRef} tabIndex={-1} className="git-tab-container flex-1 min-h-0 overflow-y-auto flex flex-col outline-none focus:outline-none focus:ring-0 git-tab">
        {message && (
          <div className="px-3 py-2 text-sm text-ide-accent bg-ide-accent/10 animate-fade-in">
            <p>{message}</p>
          </div>
        )}
        {error && !/not a git/i.test(error) && (
          <div className="px-3 py-2 text-sm text-ide-danger bg-ide-danger/10 animate-fade-in">
            <p>{error}</p>
          </div>
        )}
        {error && /not a git/i.test(error) && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-4">
              <div className="mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 text-ide-text-muted mx-auto mb-3 opacity-50">
                  <circle cx="18" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <path d="M6 21V9a9 9 0 0 0 9 9" />
                  <path d="M18 3v12" />
                </svg>
                <p className="text-sm text-ide-text-muted">{t('No git repository found in this workspace')}</p>
              </div>
              <button
                onClick={handleInit}
                disabled={busy}
                className="px-4 py-2 text-sm bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                git init
              </button>
            </div>
          </div>
        )}

        {status && (
          <div className="flex flex-col">
            {/* Staged Changes */}
            {status?.files?.filter(f => f.staged).length > 0 && (
              <div className="border-b border-ide-border git-tab__section">
                {(() => {
                  const stagedFiles = status.files.filter(f => f.staged)
                  const stats = calcFileStats(stagedFiles)
                  return (
                    <div
                      className={`pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between git-tab__section-header ${focusedHeaderSection === 'staged' ? 'bg-ide-accent/10' : ''}`}
                      onClick={() => setStagedExpanded(!stagedExpanded)}
                    >
                      <div className="flex items-center gap-1">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${stagedExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-success shrink-0">
                          <polyline points="21 8 21 21 3 21 3 8" />
                          <rect x="1" y="3" width="22" height="5" />
                          <line x1="10" y1="12" x2="14" y2="12" />
                        </svg>
                        <span>{status?.truncated && status.staged > stagedFiles.length
                          ? `${t('Staged ({count})').replace('{count}', String(stagedFiles.length))} / ${status.staged}`
                          : t('Staged ({count})').replace('{count}', String(stagedFiles.length))}</span>
                        {stats.additions > 0 && <span className="git-stats text-ide-success font-mono">+{stats.additions}</span>}
                        {stats.deletions > 0 && <span className="git-stats text-ide-danger font-mono">-{stats.deletions}</span>}
                      </div>
                      {stagedExpanded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnstageAll(stagedFiles.map(f => f.path)) }}
                          disabled={busy}
                          className={`text-[11px] font-normal normal-case px-2 py-0.5 rounded border transition-colors inline-flex items-center gap-1 ${focusedHeaderSection === 'staged' ? 'text-ide-accent border-ide-accent' : 'text-ide-text-muted border-ide-border hover:text-ide-text hover:bg-ide-hover'} disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fillRule="evenodd" d="M9.75 3.5A2.75 2.75 0 0 0 7 6.25v5.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V6.25a4.25 4.25 0 0 1 8.5 0v1a.75.75 0 0 1-1.5 0v-1A2.75 2.75 0 0 0 9.75 3.5Z" clipRule="evenodd" /></svg>
                          {t('Clear All')}
                        </button>
                      )}
                    </div>
                  )
                })()}
                {stagedExpanded && !treeView && status.files.filter(f => f.staged).map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`staged-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 git-tab__file-item ${
                      focusedFileKey === `staged:${file.path}` ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => { const idx = navigableItems.findIndex(item => item.type === 'file' && item.section === 'staged' && item.file.path === file.path); if (idx >= 0) setFocusedIndex(idx); handleFileClick(file) }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const fullPath = resolveFullPath(file.path)
                      setFileContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path, fullPath })
                    }}
                  >
                    <span className={`font-bold ${getStatusColor(file)} w-3.5 text-center shrink-0`}>
                      {getStatusIcon(file)}
                    </span>
                    <span className="shrink-0 git-fname">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted git-fdir min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <span className="shrink-0 w-5" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUnstage(file.path) }}
                      disabled={busy}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
                      title={t('Unstage')}
                    >
                      −
                    </button>
                  </div>
                )})}
                {stagedExpanded && treeView && renderTree(stagedTree, 'staged', 0)}
              </div>
            )}

            {/* Unstaged Changes */}
            {status?.files?.filter(f => !f.staged && f.status !== 'untracked').length > 0 && (
              <div className="border-b border-ide-border git-tab__section">
                {(() => {
                  const modifiedFiles = status.files.filter(f => !f.staged && f.status !== 'untracked')
                  const stats = calcFileStats(modifiedFiles)
                  return (
                    <div
                      className={`pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between git-tab__section-header ${focusedHeaderSection === 'unstaged' ? 'bg-ide-accent/10' : ''}`}
                      onClick={() => setChangesExpanded(!changesExpanded)}
                    >
                      <div className="flex items-center gap-1">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${changesExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span>{status?.truncated && status.unstaged > modifiedFiles.length
                          ? `${t('Changes ({count})').replace('{count}', String(modifiedFiles.length))} / ${status.unstaged}`
                          : t('Changes ({count})').replace('{count}', String(modifiedFiles.length))}</span>
                        {stats.additions > 0 && <span className="git-stats text-ide-success font-mono">+{stats.additions}</span>}
                        {stats.deletions > 0 && <span className="git-stats text-ide-danger font-mono">-{stats.deletions}</span>}
                      </div>
                      {changesExpanded && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'discardAll', filePaths: modifiedFiles.map(f => f.path), count: modifiedFiles.length }) }}
                            disabled={busy}
                            title={t('Discard All')}
                            className={`text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40`}
                          >
                            −
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStageAll('-u') }}
                            disabled={busy}
                            className={`text-[11px] font-normal normal-case px-2 py-0.5 rounded border transition-colors inline-flex items-center gap-1 ${focusedHeaderSection === 'unstaged' ? 'text-ide-accent border-ide-accent' : 'text-ide-text-muted border-ide-border hover:text-ide-text hover:bg-ide-hover'} disabled:opacity-40 disabled:cursor-not-allowed`}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fillRule="evenodd" d="M6.25 12.5A2.75 2.75 0 0 0 9 9.75V4.56L6.78 6.78a.75.75 0 0 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06L10.5 4.56v5.19a4.25 4.25 0 0 1-8.5 0v-1a.75.75 0 0 1 1.5 0v1a2.75 2.75 0 0 0 2.75 2.75Z" clipRule="evenodd" /></svg>
                            {t('Stage All')}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })()}
                {changesExpanded && !treeView && status.files.filter(f => !f.staged && f.status !== 'untracked').map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`unstaged-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 git-tab__file-item ${
                      focusedFileKey === `unstaged:${file.path}` ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => { const idx = navigableItems.findIndex(item => item.type === 'file' && item.section === 'unstaged' && item.file.path === file.path); if (idx >= 0) setFocusedIndex(idx); handleFileClick(file) }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const fullPath = resolveFullPath(file.path)
                      setFileContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path, fullPath })
                    }}
                  >
                    <span className={`font-bold ${getStatusColor(file)} w-3.5 text-center shrink-0`}>
                      {getStatusIcon(file)}
                    </span>
                    <span className="shrink-0 git-fname">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted git-fdir min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                      disabled={busy}
                      className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center disabled:opacity-40"
                      title={t('Stage')}
                    >
                      +
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'discard', filePath: file.path, fileName: name }) }}
                      disabled={busy}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
                      title={t('Discard')}
                    >
                      −
                    </button>
                  </div>
                )})}
                {changesExpanded && treeView && renderTree(unstagedTree, 'unstaged', 0)}
              </div>
            )}

            {/* Untracked Files */}
            {status?.files?.filter(f => f.status === 'untracked').length > 0 && (
              <div className="border-b border-ide-border git-tab__section">
                <div
                  className={`pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between git-tab__section-header ${focusedHeaderSection === 'untracked' ? 'bg-ide-accent/10' : ''}`}
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
                    <span>{(() => {
                      const shown = status.files.filter(f => f.status === 'untracked').length
                      return status.truncated && status.untracked > shown
                        ? `${t('Untracked ({count})').replace('{count}', String(shown))} / ${status.untracked}`
                        : t('Untracked ({count})').replace('{count}', String(shown))
                    })()}</span>
                  </div>
                  {untrackedExpanded && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); const untrackedPaths = status!.files.filter(f => f.status === 'untracked').map(f => f.path); setConfirmAction({ type: 'deleteAll', filePaths: untrackedPaths, count: untrackedPaths.length }) }}
                        disabled={busy}
                        title={t('Delete All')}
                        className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
                      >
                        −
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStageAll(status!.unstaged === 0 ? '.' : status!.files.filter(f => f.status === 'untracked').map(f => f.path)) }}
                        disabled={busy}
                        className={`text-[11px] font-normal normal-case px-2 py-0.5 rounded border transition-colors inline-flex items-center gap-1 ${focusedHeaderSection === 'untracked' ? 'text-ide-accent border-ide-accent' : 'text-ide-text-muted border-ide-border hover:text-ide-text hover:bg-ide-hover'} disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0"><path fillRule="evenodd" d="M6.25 12.5A2.75 2.75 0 0 0 9 9.75V4.56L6.78 6.78a.75.75 0 0 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06L10.5 4.56v5.19a4.25 4.25 0 0 1-8.5 0v-1a.75.75 0 0 1 1.5 0v1a2.75 2.75 0 0 0 2.75 2.75Z" clipRule="evenodd" /></svg>
                        {t('Stage All')}
                      </button>
                    </div>
                  )}
                </div>
                {untrackedExpanded && !treeView && status.files.filter(f => f.status === 'untracked').map(file => {
                  const { name, dir } = splitPath(file.path)
                  return (
                  <div
                    key={`untracked-${file.path}`}
                    className={`pl-5 pr-2 py-1 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-1 git-tab__file-item ${
                      focusedFileKey === `untracked:${file.path}` ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-text'
                    }`}
                    onClick={() => { const idx = navigableItems.findIndex(item => item.type === 'file' && item.section === 'untracked' && item.file.path === file.path); if (idx >= 0) setFocusedIndex(idx); handleFileClick(file) }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const fullPath = resolveFullPath(file.path)
                      setFileContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path, fullPath })
                    }}
                  >
                    <span className="font-bold text-ide-text-muted w-3.5 text-center shrink-0">U</span>
                    <span className="shrink-0 git-fname">{name}</span>
                    {dir && <span className="truncate text-ide-text-muted git-fdir min-w-0">{dir}</span>}
                    <span className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                      disabled={busy}
                      className="text-[11px] text-ide-text-muted hover:text-ide-success shrink-0 w-5 text-center disabled:opacity-40"
                      title={t('Stage')}
                    >
                      +
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', filePath: file.path, fileName: name }) }}
                      disabled={busy}
                      className="text-[11px] text-ide-text-muted hover:text-ide-danger shrink-0 w-5 text-center disabled:opacity-40"
                      title={t('Delete')}
                    >
                      −
                    </button>
                  </div>
                )})}
                {untrackedExpanded && treeView && renderTree(untrackedTree, 'untracked', 0)}
              </div>
            )}

            {/* Clean state */}
            {status && status.clean && (
              <div className="px-2 py-2 text-xs text-ide-text-muted text-center">
                {t('No changes detected')}
              </div>
            )}
          </div>
        )}

        <div className="mt-auto">
          {/* Line History */}
          {lineHistoryFilePath && (
            <div className="border-b border-ide-border">
              <div
                className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between"
                onClick={() => setLineHistoryExpanded(!lineHistoryExpanded)}
              >
                <div className="flex items-center gap-1">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform ${lineHistoryExpanded ? 'rotate-0' : '-rotate-90'}`}><path d="M4 6l4 4 4-4" /></svg>
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                    <path d="M2 1h12v2H2V1zm0 4h12v2H2V5zm0 4h12v2H2V9zm0 4h12v2H2v-2z" />
                  </svg>
                  <span>{t('Line History ({file}:{line})').replace('{file}', lineHistoryFilePath.split('/').pop() || lineHistoryFilePath).replace('{line}', String(lineHistoryLine))}</span>
                </div>
                <button
                  className="text-ide-text-muted hover:text-ide-text text-xs px-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    setLineHistoryFilePath(null)
                    setLineHistoryLine(null)
                    setLineHistoryEntries([])
                    setLineHistoryExpanded(false)
                  }}
                >
                  ✕
                </button>
              </div>
              {lineHistoryExpanded && (
                <div className="flex flex-col">
                  {lineHistoryLoading ? (
                    <div className="px-2 py-2 text-xs text-ide-text-muted text-center">{t('Loading...')}</div>
                  ) : lineHistoryEntries.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-ide-text-muted text-center">{t('No line history')}</div>
                  ) : (
                    lineHistoryEntries.map(entry => (
                      <div key={entry.hash}>
                        <div
                          className={`pl-5 pr-2 py-1.5 border-b border-ide-border/50 hover:bg-ide-hover cursor-pointer ${
                            expandedCommit === entry.hash ? 'bg-ide-accent/10' : ''
                          }`}
                          onClick={() => handleCommitClick(entry.hash)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setCommitContextMenu({ x: e.clientX, y: e.clientY, hash: entry.hash, message: entry.message })
                          }}
                        >
                          <div className="text-xs text-ide-text truncate">{entry.message}</div>
                          <div className="flex items-center gap-1 mt-1 text-xs text-ide-text-muted">
                            <span className="text-ide-accent">{entry.hash.slice(0, 7)}</span>
                            <span>{entry.author}</span>
                            <span>{new Date(entry.date).toLocaleDateString()}</span>
                          </div>
                        </div>
                        {expandedCommit === entry.hash && (() => {
                          const MAX_RENDER_FILES = 200
                          const totalCount = commitFileCount || commitFiles.length
                          const displayFiles = commitFiles.slice(0, MAX_RENDER_FILES)
                          const renderTruncated = totalCount - MAX_RENDER_FILES
                          return (
                          <div className="bg-ide-bg border-b border-ide-border animate-fade-in">
                            <div className="pl-5 pr-2 py-1 text-[11px] text-ide-text-muted uppercase tracking-wider bg-ide-hover/50">
                              {t('Files ({count})').replace('{count}', String(totalCount))}
                            </div>
                            {displayFiles.map(file => {
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
                                <span className="shrink-0 git-fname">{name}</span>
                                {dir && <span className="truncate text-ide-text-muted git-fdir min-w-0">{dir}</span>}
                                <span className="shrink-0 ml-auto flex items-center gap-1 text-[11px]">
                                  {file.additions > 0 && <span className="text-ide-success font-mono">+{file.additions}</span>}
                                  {file.deletions > 0 && <span className="text-ide-danger font-mono">-{file.deletions}</span>}
                                </span>
                              </div>
                              )
                            })}
                            {renderTruncated > 0 && (
                              <div className="pl-5 pr-2 py-1 text-[11px] text-ide-text-muted">
                                {t('... {n} more files').replace('{n}', String(renderTruncated))}
                              </div>
                            )}
                          </div>
                          )
                        })()}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Commits / Graph */}
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
                <span>{t('Commits ({count})').replace('{count}', String(graphEntries.length))}</span>
              </div>
            </div>
            {logExpanded && (
              <GitGraph
                entries={graphEntries}
                hasMore={hasMoreGraph}
                loadingMore={loadingMoreGraph}
                expandedHash={expandedCommit}
                onCommitClick={handleCommitClick}
                onContextMenu={(e, hash, message) => {
                  e.preventDefault()
                  setCommitContextMenu({ x: e.clientX, y: e.clientY, hash, message })
                }}
                onLoadMore={loadMoreGraph}
                renderExpanded={(hash) => {
                  const MAX_RENDER_FILES = 200
                  const totalCount = commitFileCount || commitFiles.length
                  const displayFiles = commitFiles.slice(0, MAX_RENDER_FILES)
                  const renderTruncated = totalCount - MAX_RENDER_FILES
                  return (
                    <div className="bg-ide-bg border-b border-ide-border animate-fade-in">
                      <div className="pl-5 pr-2 py-1 text-[11px] text-ide-text-muted uppercase tracking-wider bg-ide-hover/50">
                        {t('Files ({count})').replace('{count}', String(totalCount))}
                      </div>
                      {displayFiles.map(file => {
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
                          <span className="shrink-0 git-fname">{name}</span>
                          {dir && <span className="truncate text-ide-text-muted git-fdir min-w-0">{dir}</span>}
                          <span className="shrink-0 ml-auto flex items-center gap-1 text-[11px]">
                            {file.additions > 0 && <span className="text-ide-success font-mono">+{file.additions}</span>}
                            {file.deletions > 0 && <span className="text-ide-danger font-mono">-{file.deletions}</span>}
                          </span>
                        </div>
                      )})}
                      {renderTruncated > 0 && (
                        <div className="pl-5 pr-2 py-1 text-xs text-ide-text-muted bg-ide-hover/30 text-center">
                          + {renderTruncated} {t('more files')}
                        </div>
                      )}
                    </div>
                  )
                }}
              />
            )}
          </div>

          {/* Branches */}
          <div className="border-b border-ide-border">
            <div
              className="pl-1 pr-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-ide-hover flex items-center justify-between group"
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
                <span>{t('Branches ({count})').replace('{count}', String(visibleBranches.length))}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setShowRemoteBranches(v => !v) }}
                title={t('Show remote')}
                className={`shrink-0 w-4 h-4 flex items-center justify-center rounded transition-opacity ${showRemoteBranches ? 'opacity-100 text-ide-accent' : 'opacity-0 group-hover:opacity-100 text-ide-text-muted hover:text-ide-accent hover:bg-ide-accent/10'}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
                </svg>
              </button>
            </div>
            {branchesExpanded && (
            <div className="flex flex-col">
              {visibleBranches.length === 0 ? (
                <div className="px-2 py-2 text-xs text-ide-text-muted text-center">{t('No branches')}</div>
              ) : (
                visibleBranches.map(branch => {
                  const isOriginalBranch = worktreeNav && branch.name === worktreeNav.originalBranch
                  return (
                  <div
                    key={branch.name}
                    className={`pl-5 pr-2 py-1.5 text-xs border-b border-ide-border/50 cursor-pointer flex items-center justify-between ${
                      isOriginalBranch ? 'bg-ide-success/10 text-ide-text' : branch.current ? 'bg-ide-accent/10 text-ide-text' : branch.remote ? 'text-ide-text-muted cursor-not-allowed' : 'text-ide-text hover:bg-ide-hover'
                    }`}
                    onClick={() => {
                      if (busy) return
                      if (isOriginalBranch) { handleBackFromWorktree(); return }
                      if (branch.current || branch.remote) return
                      if (branch.name.startsWith('worktree-')) {
                        handleNavigateToWorktree(branch.name)
                      } else {
                        handleCheckout(branch.name)
                      }
                    }}
                    onContextMenu={(e) => {
                      if (branch.remote) return
                      if (branch.current && !branch.name.startsWith('worktree-')) return
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, branchName: branch.name })
                    }}
                  >
                    <div className="flex items-center gap-1">
                      {isOriginalBranch ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0 text-ide-success">
                          <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                          <line x1="6" y1="3" x2="6" y2="15" />
                          <circle cx="18" cy="6" r="3" />
                          <circle cx="6" cy="18" r="3" />
                          <path d="M18 9a9 9 0 0 0-9 9" />
                        </svg>
                      )}
                      <span className="text-xs">{branch.name}</span>
                    </div>
                    {isOriginalBranch ? (
                      <span className="text-xs text-ide-success">{t('main')}</span>
                    ) : branch.current && (
                      <span className="text-xs text-ide-accent">{t('current')}</span>
                    )}
                  </div>
                )})
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Commit area */}
      {status && (
        <div className="shrink-0 border-t border-ide-border p-3 git-tab__commit-area">
          {/* Quick actions */}
          <div className="flex gap-2 mb-2">
            <button
              onClick={handleStash}
              disabled={busy || status.clean}
              title={status.clean ? t('No changes to stash') : t('Stash all changes')}
              className="text-xs text-ide-text-muted hover:text-ide-text px-2 py-1 rounded bg-ide-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed git-tab__stash-btn"
            >
              Stash
            </button>
            <div className="relative inline-flex group">
              <button
                onClick={handleStashPop}
                disabled={busy || stashCount === 0}
                title={stashCount === 0 ? t('No stash to pop') : t('Pop latest stash')}
                className="text-xs text-ide-text-muted hover:text-ide-text px-2 py-1 rounded bg-ide-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed git-tab__stash-btn"
              >
                Pop Stash{stashCount > 0 ? ` (${stashCount})` : ''}
              </button>
              {stashCount > 0 && (
                <button
                  onClick={() => setConfirmAction({ type: 'stashDrop' })}
                  disabled={busy}
                  title={t('Drop stash')}
                  className="absolute -top-1.5 -right-1.5 text-[10px] leading-none text-ide-text-muted hover:text-ide-danger bg-ide-bg border border-ide-border rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 disabled:cursor-not-allowed"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              onClick={handleAmend}
              disabled={amendDisabled}
              title={amendTooltip}
              className="text-xs text-ide-text-muted hover:text-ide-text px-2 py-1 rounded bg-ide-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed git-tab__amend-btn"
            >
              Amend</button>
          </div>
          <textarea
            ref={textareaRef}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            disabled={busy}
            placeholder={t('Commit message...')}
            onContextMenu={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              const el = e.currentTarget as HTMLTextAreaElement
              el.focus()
              if (document.execCommand('paste')) return
              try {
                const text = await navigator.clipboard.readText()
                if (text) el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end')
              } catch {}
              el.dispatchEvent(new Event('input', { bubbles: true }))
            }}
            className={`w-full h-20 text-xs bg-ide-bg border rounded px-2 py-1 text-ide-text resize-none focus:border-ide-accent focus:outline-none focus:outline-none focus:ring-0 placeholder:text-ide-text-muted/50 disabled:opacity-40 git-tab__commit-input ${focusedCommit ? 'border-ide-accent bg-ide-accent/5' : 'border-ide-border'}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) handleCommit()
              if (e.key === 'Escape') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
          />
          {hasConflictInStaged && (
            <div className="mt-2 px-2 py-1.5 text-[11px] text-ide-danger bg-ide-danger/10 rounded animate-fade-in flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {t('Conflicted files in staged area. Please resolve conflicts before committing.')}
            </div>
          )}
          {!hasStaged && status.ahead > 0 ? (
            <div className="relative mt-2">
              <div className="flex git-tab__push-group">
                <button
                  onClick={() => handlePush()}
                  disabled={busy}
                  className="flex-1 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-l transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                  </svg>
                  Push{status.ahead > 0 ? ` (${status.ahead})` : ''}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowPushDropdown(!showPushDropdown) }}
                  disabled={busy}
                  className="py-1.5 px-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-r border-l border-white/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                    onClick={() => handlePush()}
                    disabled={busy}
                    className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${!selectedRemote ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text hover:bg-ide-hover'} disabled:opacity-40`}
                  >
                    origin (default)
                  </button>
                  {remoteBranches.map(rb => (
                    <button
                      key={rb.name}
                      onClick={() => { setSelectedRemote(rb.name); handlePush() }}
                      disabled={busy}
                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${selectedRemote === rb.name ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text hover:bg-ide-hover'} disabled:opacity-40`}
                    >
                      <span className="text-ide-text-muted">{rb.remote}/</span>{rb.branch}
                    </button>
                  ))}
                  <div className="border-t border-ide-border my-1" />
                  <button
                    onClick={() => { setShowPushDropdown(false); setConfirmAction({ type: 'forcePush' }) }}
                    disabled={busy}
                    className="w-full px-3 py-1.5 text-left text-xs transition-colors text-ide-danger hover:bg-ide-danger/10 disabled:opacity-40"
                  >
                    Force Push (-f)
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={handleCommit}
              disabled={busy || !commitMessage.trim() || !status?.files?.some(f => f.staged) || hasConflictInStaged}
              className="mt-2 w-full py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed git-tab__commit-btn"
            >
              {t('Commit (Ctrl+Enter)')}
            </button>
          )}
        </div>
      )}

      {/* Context Menu for branches */}
      {contextMenu && (() => {
        const isWorktree = contextMenu.branchName.startsWith('worktree-')
        return (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {isWorktree && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
              onClick={() => handleApplyBranch(contextMenu.branchName)}
            >
              {t('Merge Changes')}
            </button>
          )}
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-ide-danger hover:bg-ide-hover whitespace-nowrap"
            onClick={() => isWorktree ? handleDeleteWorktree(contextMenu.branchName) : handleDeleteBranch(contextMenu.branchName)}
          >
            {t('Delete Branch')}
          </button>
        </div>
        )})()}

      {/* Context Menu for commit entries */}
      {commitContextMenu && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
          style={{ left: commitContextMenu.x, top: commitContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => {
              const msg = commitContextMenu.message.replace(/\n/g, '\r\n')
              navigator.clipboard.writeText(msg)
              setCommitContextMenu(null)
            }}
          >
            {t('Copy Message')}
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
            onClick={() => {
              navigator.clipboard.writeText(commitContextMenu.hash)
              setCommitContextMenu(null)
            }}
          >
            {t('Copy Hash')}
          </button>
        </div>
      )}

      {/* Context Menu for file rows */}
      {fileContextMenu && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
          style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center">
            <button
              className="flex-1 px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
              onClick={() => {
                window.api.file.openExplorer(fileContextMenu.fullPath)
                setFileContextMenu(null)
              }}
            >
              {t('Open Containing Folder')}
            </button>
            <button
              className="px-2 py-1.5 text-ide-text-muted hover:text-ide-accent hover:bg-ide-hover shrink-0"
              title={t('Copy Path')}
              onClick={() => handleCopyFilePath(fileContextMenu.fullPath)}
            >
              {copied ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-ide-success">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              )}
            </button>
          </div>
          {onNavigateToFile && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover whitespace-nowrap"
              onClick={() => {
                onNavigateToFile(fileContextMenu.fullPath)
                setFileContextMenu(null)
              }}
            >
              {t('Open in File Panel')}
            </button>
          )}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmAction(null)}>
          <div className="bg-ide-bg border border-ide-border rounded shadow-lg p-4 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ide-text mb-4">
              {confirmAction.type === 'forceDeleteWorktree'
                ? t('Worktree is locked by another process ({reason}). Force remove anyway?').replace('{reason}', confirmAction.message ?? '')
                : confirmAction.type === 'discard'
                ? t('Discard changes to {fileName}? This cannot be undone.').replace('{fileName}', confirmAction.fileName!)
                : confirmAction.type === 'discardAll'
                ? t('Discard all {count} changes? This cannot be undone.').replace('{count}', String(confirmAction.count))
                : confirmAction.type === 'stashDrop'
                ? t('Drop the latest stash? This cannot be undone.')
                : confirmAction.type === 'deleteAll'
                ? t('Delete all {count} untracked files?').replace('{count}', String(confirmAction.count))
                : confirmAction.type === 'forcePush'
                ? t('Force push? This overwrites remote history and cannot be undone.')
                : t('Delete {fileName}?').replace('{fileName}', confirmAction.fileName!)
              }
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
                  const { type, filePath, filePaths, branch } = confirmAction
                  setConfirmAction(null)
                  if (type === 'forceDeleteWorktree') {
                    await handleDeleteWorktree(branch!, true)
                  } else if (type === 'discard') {
                    await handleDiscard(filePath!)
                  } else if (type === 'discardAll') {
                    await handleDiscardAll(filePaths!)
                  } else if (type === 'stashDrop') {
                    await handleStashDrop()
                  } else if (type === 'deleteAll') {
                    await handleDeleteAllUntracked(filePaths!)
                  } else if (type === 'forcePush') {
                    await handlePush(true)
                  } else {
                    await handleDeleteFile(filePath!)
                  }
                }}
              >
                {t('Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict Dialog */}
      {conflictApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConflictApply(null)}>
          <div className="bg-ide-bg border border-ide-border rounded shadow-lg p-4 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ide-text mb-2">
              {t('Conflicts detected while merging {branch}').replace('{branch}', conflictApply.branch)}
            </p>
            <p className="text-[11px] text-ide-text-muted mb-4 max-h-24 overflow-y-auto">
              {conflictApply.message.slice(0, 300)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded"
                onClick={() => setConflictApply(null)}
              >
                {t('Abort')}
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded"
                onClick={async () => {
                  const branch = conflictApply.branch
                  setConflictApply(null)
                  await window.api.git.applyBranchRetry(branch)
                  await refreshBranches()
                  await refreshStatus()
                }}
              >
                {t('Keep Conflicts')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
