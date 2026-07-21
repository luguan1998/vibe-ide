import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { useTheme } from '../themes'
import { ENCODING_GROUPS, DEFAULT_ENCODING } from '@shared/encodings'
import { useI18n } from '../i18n'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
import OutlineTrigger from './OutlineTrigger'

let _monacoConfigured = false
let _monacoGlobal: any = null
function configureMonacoBase(monaco: any) {
  _monacoGlobal = monaco
  if (_monacoConfigured) return
  _monacoConfigured = true
  const compilerOpts = {
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monaco.languages.typescript.ModuleKind.CommonJS,
    jsx: monaco.languages.typescript.JsxEmit.React,
    noEmit: true
  }
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOpts)
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ ...compilerOpts, allowJs: true })
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true })
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true })
}

// 语言映射表提至模块层 — 避免每次渲染重建 100+ 键值
const langMap: Record<string, string> = {
  'ts': 'typescript', 'tsx': 'typescript', 'mts': 'typescript', 'cts': 'typescript',
  'js': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript', 'jsx': 'javascript',
  'py': 'python', 'pyw': 'python',
  'rs': 'rust', 'go': 'go', 'java': 'java', 'kt': 'kotlin', 'kts': 'kotlin',
  'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp',
  'cs': 'csharp', 'csx': 'csharp', 'cake': 'csharp',
  'rb': 'ruby', 'php': 'php', 'swift': 'swift', 'dart': 'dart',
  'scala': 'scala', 'sc': 'scala', 'sbt': 'scala',
  'clj': 'clojure', 'cljs': 'clojure', 'cljc': 'clojure', 'edn': 'clojure',
  'fs': 'fsharp', 'fsx': 'fsharp', 'jl': 'julia',
  'ex': 'elixir', 'exs': 'elixir',
  'pl': 'perl', 'pm': 'perl', 'lua': 'lua', 'r': 'r', 'coffee': 'coffeescript',
  'sol': 'sol', 'proto': 'protobuf',
  'json': 'json', 'lock': 'json',
  'yaml': 'yaml', 'yml': 'yaml', 'toml': 'toml', 'xml': 'xml',
  'html': 'html', 'htm': 'html', 'vue': 'html', 'cshtml': 'razor',
  'css': 'css', 'scss': 'scss', 'less': 'less',
  'md': 'markdown', 'mdx': 'mdx',
  'sql': 'sql',
  'sh': 'shell', 'bash': 'shell',
  'bat': 'bat', 'cmd': 'bat',
  'ps1': 'powershell', 'psm1': 'powershell', 'psd1': 'powershell',
  'dockerfile': 'dockerfile',
  'tf': 'hcl', 'tfvars': 'hcl',
  'ini': 'ini', 'properties': 'ini',
  'graphql': 'graphql', 'gql': 'graphql',
  'handlebars': 'handlebars', 'hbs': 'handlebars',
  'pug': 'pug', 'jade': 'pug', 'twig': 'twig',
  'sv': 'systemverilog', 'svh': 'systemverilog',
  'v': 'verilog', 'vh': 'verilog',
  'gitignore': 'plaintext', 'env': 'plaintext', 'txt': 'plaintext'
}
function getLanguageFromFile(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return langMap[ext] || 'plaintext'
}

interface DiffViewerProps {
  filePath: string          // 相对路径（用于 git 操作）
  fullPath: string          // 完整路径（用于 file read/write）
  diffContent: string
  isStaged: boolean
  commitHash?: string       // 查看历史 commit 时的 commit hash
  lineNumber?: number       // 跳转到指定行
  fontSize?: number         // 编辑器字体大小
  wordWrap?: boolean        // 是否自动换行
  scrollTrigger?: number    // PageUp/PageDown 触发滚动，变化时滚动一页
  revision?: number         // 递增以强制重新加载内容
  onBack?: () => void
  onSaved?: (path: string) => Promise<void>
  defaultEdit?: boolean
  inlineDiff?: boolean      // 强制内联 diff 模式
  diffSplitRatio?: number   // 左右分栏占比（0.1~0.9，分隔线位置=左边占比）
  cursorRef?: React.MutableRefObject<{ fullPath: string; line: number; column: number } | null>
  visibleLineRef?: React.MutableRefObject<{ fullPath: string; line: number } | null>  // 视口中间可见行（居中还原用），供最近文件回写行号
  onOpenCallGraph?: (word: string) => void     // 右键菜单 → 打开 call graph
  onViewLineHistory?: (filePath: string, lineNumber: number) => void  // 右键菜单 → 查看这行修改记录
  compareOriginalContent?: string  // 左侧对比文件内容（文件对比模式）
  compareOriginalPath?: string     // 左侧对比文件路径（文件对比模式）
  onAnnotationTrigger?: (start: number, end: number) => void
  brushActive?: boolean
  outlineEnabled?: boolean
  onToggleOutline?: () => void
  onOutlineNavigate?: (line: number, headingName?: string) => void
}

type ViewMode = 'diff' | 'edit'

function parseDiffContent(diff: string): { original: string; modified: string } {
  const originalLines: string[] = []
  const modifiedLines: string[] = []

  const lines = diff.split('\n')
  let inHunk = false

  for (const line of lines) {
    // Skip diff header lines
    if (line.startsWith('diff ') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue
    }

    // Process hunk headers - mark we're in content area
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }

    // Only process lines inside hunks
    if (!inHunk) continue

    // Skip "No newline at end of file" marker — it's metadata, not content
    if (line.startsWith('\\ ')) continue

    // Handle diff content lines
    if (line.startsWith('-')) {
      // Removed line - goes to original only
      originalLines.push(line.slice(1))
    } else if (line.startsWith('+')) {
      // Added line - goes to modified only
      modifiedLines.push(line.slice(1))
    } else if (line.startsWith(' ')) {
      // Context line - goes to both
      originalLines.push(line.slice(1))
      modifiedLines.push(line.slice(1))
    } else if (line === '') {
      // Empty line within hunk - goes to both
      originalLines.push('')
      modifiedLines.push('')
    }
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n')
  }
}

function parseDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0

  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }

  return { additions, deletions }
}

// 单行回退：从 ILineChange[] 构建 modified 侧改动行集合。纯 deleted（mE===0）跳过——
// modified 侧无真实行，inline 模式虚拟行 hover 不可靠，让用户用现有 gutter 圆钮。
function buildChangedModifiedLines(changes: any[]): Set<number> {
  const s = new Set<number>()
  for (const c of changes) {
    const mE = c.modifiedEndLineNumber
    if (!mE || mE === 0) continue
    for (let ln = c.modifiedStartLineNumber; ln <= mE; ln++) s.add(ln)
  }
  return s
}

// 单行回退：计算单个 edit { range, text }，三态（纯 added 删行 / 单行替换 / 多行或 deleted 整块）
function computeRevertEdit(monaco: any, modEd: any, origEd: any, change: any, hoverLn: number): { range: any; text: string } | null {
  const modModel = modEd.getModel()
  const origModel = origEd?.getModel()
  if (!modModel || !origModel) return null
  if (hoverLn > modModel.getLineCount()) return null

  const oS = change.originalStartLineNumber
  const oE = change.originalEndLineNumber
  const mS = change.modifiedStartLineNumber
  const mE = change.modifiedEndLineNumber

  if (oE === 0) {
    const lineCount = modModel.getLineCount()
    if (hoverLn < lineCount) {
      return { range: new monaco.Range(hoverLn, 1, hoverLn + 1, 1), text: '' }
    }
    return { range: new monaco.Range(hoverLn, 1, hoverLn, modModel.getLineMaxColumn(hoverLn)), text: '' }
  }

  if (mS === mE && oS === oE) {
    return {
      range: new monaco.Range(mS, 1, mS, modModel.getLineMaxColumn(mS)),
      text: origModel.getLineContent(oS)
    }
  }

  if (mE === 0) {
    const origText = origModel.getValueInRange(
      new monaco.Range(oS, 1, oE, origModel.getLineMaxColumn(oE))
    )
    const lineCount = modModel.getLineCount()
    const suffix = mS <= lineCount ? '\n' : ''
    return { range: new monaco.Range(mS, 1, mS, 1), text: origText + suffix }
  }
  const offset = hoverLn - mS
  if (offset >= 0 && offset <= oE - oS) {
    const origLine = oS + offset
    return {
      range: new monaco.Range(hoverLn, 1, hoverLn, modModel.getLineMaxColumn(hoverLn)),
      text: origModel.getLineContent(origLine)
    }
  }
  const lineCount = modModel.getLineCount()
  if (hoverLn < lineCount) {
    return { range: new monaco.Range(hoverLn, 1, hoverLn + 1, 1), text: '' }
  }
  return { range: new monaco.Range(hoverLn, 1, hoverLn, modModel.getLineMaxColumn(hoverLn)), text: '' }
}

// 取编辑器实际行高（EditorLayoutInfo.lineHeight 在 0.52 类型上不存在，用 getTopForLineNumber 实测）
function getEditorLineHeight(ed: any): number {
  try {
    const lc = ed?.getModel()?.getLineCount?.() || 0
    if (lc >= 2) {
      const h = ed.getTopForLineNumber(2) - ed.getTopForLineNumber(1)
      if (h > 0) return h
    }
  } catch {}
  return 19
}

// 单行回退浮钮：根据编辑器当前视口计算行的绝对 top
function computeRevertBtnTop(editor: any, ln: number): number {
  const top = editor.getTopForLineNumber(ln) - editor.getScrollTop()
  const lh = getEditorLineHeight(editor)
  return top + (lh - 22) / 2
}

function computeRevertBtnLeft(editorDom: HTMLElement | null, containerDom: HTMLElement | null): number {
  if (!editorDom || !containerDom) return 4
  return editorDom.getBoundingClientRect().left - containerDom.getBoundingClientRect().left + 4
}

function FilePathDisplay({ filePath }: { filePath: string }) {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const dirPart = lastSep >= 0 ? filePath.substring(0, lastSep + 1) : ''
  const namePart = lastSep >= 0 ? filePath.substring(lastSep + 1) : filePath
  const info = getFileInfo(namePart)
  return (
    <span className="truncate flex items-center gap-1.5">
      <svg viewBox="0 0 16 16" fill="currentColor" className={`w-4 h-4 shrink-0 ${info.color}`}
        dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
      <span className="text-ide-text font-medium">{namePart}</span>
      {dirPart && <span className="text-[11px] text-ide-text-muted/50">{dirPart}</span>}
    </span>
  )
}

const DiffViewer = React.memo(function DiffViewer({ filePath, fullPath, diffContent, isStaged, commitHash, lineNumber, fontSize = 14, wordWrap = false, scrollTrigger, revision, onBack, onSaved, defaultEdit, inlineDiff = false, diffSplitRatio = 0.3, cursorRef, visibleLineRef, onOpenCallGraph, onViewLineHistory, compareOriginalContent, compareOriginalPath, onAnnotationTrigger, brushActive, outlineEnabled, onToggleOutline, onOutlineNavigate }: DiffViewerProps) {
  const { theme: currentTheme } = useTheme()
  const { t } = useI18n()

  const [viewMode, setViewMode] = useState<ViewMode>(defaultEdit ? 'edit' : 'diff')
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode

  // Reset viewMode when file changes
  useEffect(() => {
    setViewMode(defaultEdit ? 'edit' : 'diff')
  }, [fullPath, defaultEdit])
  const [originalContent, setOriginalContent] = useState<string>('')
  const [modifiedContent, setModifiedContent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number }>({ additions: 0, deletions: 0 })
  const savedContentRef = useRef('')
  const justLoadedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentEncoding, setCurrentEncoding] = useState<string>(DEFAULT_ENCODING)
  const [encodingInfo, setEncodingInfo] = useState<string>('')
  const [unreadableReason, setUnreadableReason] = useState<string>('')
  const [encodingContextMenu, setEncodingContextMenu] = useState<{ x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [toastPath, setToastPath] = useState<string | null>(null)

  useEffect(() => {
    if (!toastPath) return
    const id = setTimeout(() => setToastPath(null), 1500)
    return () => clearTimeout(id)
  }, [toastPath])

  // Editor refs for imperative line jumping
  const diffEditorRef = useRef<any>(null)
  const editEditorRef = useRef<any>(null)
  const monacoRef = useRef<any>(null)
  const onAnnotationTriggerRef = useRef(onAnnotationTrigger)
  onAnnotationTriggerRef.current = onAnnotationTrigger
  const brushActiveRef = useRef(brushActive)
  brushActiveRef.current = brushActive
  const handleAnnotationClick = useCallback((start: number, end: number) => {
    onAnnotationTriggerRef.current?.(start, end)
  }, [])
  const handleAnnotationClickRef = useRef(handleAnnotationClick)
  handleAnnotationClickRef.current = handleAnnotationClick

  // 单行回退 hover 浮钮
  const revertingRef = useRef(false)
  const lineChangesRef = useRef<any[]>([])
  const changedModifiedLinesRef = useRef<Set<number>>(new Set())
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enabledRef = useRef(false)
  const diffDisposablesRef = useRef<Array<{ dispose?: () => void }>>([])
  // 首次 diff 就绪后自动跳到第一处修改（无指定行号时）；切文件重置
  const autoJumpedRef = useRef(false)
  const [revertBtn, setRevertBtn] = useState<{ visible: boolean; top: number; left: number; ln: number }>({ visible: false, top: 0, left: 56, ln: 0 })
  const revertBtnDomRef = useRef<HTMLButtonElement | null>(null)
  const lastRevertLnRef = useRef<number | null>(null)

  // 仅普通 staged/unstaged diff 启用单行回退（历史只读 / 文件对比 禁用）
  useEffect(() => {
    enabledRef.current = !commitHash && compareOriginalContent === undefined
  }, [commitHash, compareOriginalContent])

  // Dispose Monaco editors before unmount to prevent "TextModel got disposed before DiffEditorWidget model got reset"
  // Use useLayoutEffect so cleanup runs before @monaco-editor/react's useEffect cleanup
  React.useLayoutEffect(() => {
    return () => {
      // Dispose call-graph + line-history actions before disposing editors
      try {
        diffEditorRef.current?.getModifiedEditor()?._callGraphActionDisposable?.dispose?.()
      } catch {}
      try {
        diffEditorRef.current?.getModifiedEditor()?._lineHistoryActionDisposable?.dispose?.()
      } catch {}
      try {
        editEditorRef.current?._callGraphActionDisposable?.dispose?.()
      } catch {}
      try {
        editEditorRef.current?._lineHistoryActionDisposable?.dispose?.()
      } catch {}
      // 单行回退 disposable + hide timer
      for (const d of diffDisposablesRef.current) {
        try { d?.dispose?.() } catch {}
      }
      diffDisposablesRef.current = []
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      // 抓取 model 引用：widget dispose 后 getModel 链路不可靠，必须先抓
      let diffOrigModel: any = null
      let diffModModel: any = null
      let editModel: any = null
      try { diffOrigModel = diffEditorRef.current?.getOriginalEditor?.()?.getModel?.() } catch {}
      try { diffModModel = diffEditorRef.current?.getModifiedEditor?.()?.getModel?.() } catch {}
      try { editModel = editEditorRef.current?.getModel?.() } catch {}
      // DiffEditor widget must be disposed before its models are disposed
      if (diffEditorRef.current) {
        try {
          diffEditorRef.current.dispose?.()
        } catch {}
        diffEditorRef.current = null
      }
      if (editEditorRef.current) {
        try {
          editEditorRef.current.dispose?.()
        } catch {}
        editEditorRef.current = null
      }
      // widget 已 dispose，显式释放 model：库 cleanup 此时拿不到 model，不补则每开一文件泄漏一份
      try { diffOrigModel?.dispose?.() } catch {}
      try { diffModModel?.dispose?.() } catch {}
      try { editModel?.dispose?.() } catch {}
    }
  }, [])

  // PageDown/PageUp 双击跳 diff 区块追踪
  const pageKeyRef = useRef<{ key: string; time: number; timer: ReturnType<typeof setTimeout> | null }>({ key: '', time: 0, timer: null })

  // Jump to lineNumber whenever it changes (handles both mount and prop updates)
  useEffect(() => {
    if (!lineNumber || lineNumber <= 0) return
    try {
      if (viewMode === 'diff' && diffEditorRef.current) {
        const modifiedEditor = diffEditorRef.current.getModifiedEditor()
        const count = modifiedEditor.getModel()?.getLineCount() || 0
        const ln = Math.min(lineNumber, count)
        if (ln > 0) {
          modifiedEditor.revealLineInCenter(ln)
          modifiedEditor.setPosition({ lineNumber: ln, column: 1 })
          if (cursorRef) cursorRef.current = { fullPath, line: ln, column: 1 }
          if (visibleLineRef) visibleLineRef.current = { fullPath, line: ln }
        }
      } else if (viewMode === 'edit' && editEditorRef.current) {
        const count = editEditorRef.current.getModel()?.getLineCount() || 0
        const ln = Math.min(lineNumber, count)
        if (ln > 0) {
          editEditorRef.current.revealLineInCenter(ln)
          editEditorRef.current.setPosition({ lineNumber: ln, column: 1 })
          if (cursorRef) cursorRef.current = { fullPath, line: ln, column: 1 }
          if (visibleLineRef) visibleLineRef.current = { fullPath, line: ln }
        }
      }
    } catch {}
  }, [lineNumber, viewMode])

  // PageUp/PageDown: 滚动 diff 编辑器一页
  const prevScrollTrigger = useRef(scrollTrigger)
  useEffect(() => {
    if (scrollTrigger === undefined || prevScrollTrigger.current === undefined || prevScrollTrigger.current === scrollTrigger) return
    const delta = scrollTrigger - prevScrollTrigger.current
    prevScrollTrigger.current = scrollTrigger
    try {
      const editor = viewMode === 'diff'
        ? diffEditorRef.current?.getModifiedEditor()
        : editEditorRef.current
      if (!editor) return
      const layoutInfo = editor.getLayoutInfo()
      const pageHeight = layoutInfo.height * 0.5
      const newScrollTop = editor.getScrollTop() + delta * pageHeight
      editor.setScrollTop(Math.max(0, newScrollTop))
    } catch {}
  }, [scrollTrigger, viewMode])

  const loadContents = useCallback(async () => {
    try {
      let original: string
      let modified: string

      if (compareOriginalContent !== undefined) {
        // 文件对比模式：左侧 = 对比文件，右侧 = 当前文件
        original = compareOriginalContent
        const result = await window.api.file.read(fullPath)
        modified = result.error ? '' : (result.content || '')
      } else if (commitHash) {
        // 查看历史 commit：左边是 parent 的文件内容，右边是 commit 时的文件内容
        const [parentResult, commitResult] = await Promise.all([
          window.api.git.showFile(`${commitHash}^`, filePath),
          window.api.git.showFile(commitHash, filePath)
        ])
        original = parentResult.error ? '' : parentResult.content
        modified = commitResult.error ? '' : (commitResult.content || '')
      } else {
        // Staged:   HEAD  vs INDEX  (git show '' = index)
        // Unstaged: INDEX vs WORKTREE (file.read = working tree)
        const [stagedResult, currResult] = await Promise.all([
          isStaged
            ? window.api.git.showFile('HEAD', filePath)
            : window.api.git.showFile('', filePath),
          isStaged
            ? window.api.git.showFile('', filePath)
            : window.api.file.read(fullPath)
        ])
        original = stagedResult.error ? '' : stagedResult.content
        modified = currResult.error ? '' : (currResult.content || '')
      }

      const stats = diffContent ? parseDiffStats(diffContent) : { additions: 0, deletions: 0 }
      setOriginalContent(original)
      setModifiedContent(modified)
      setDiffStats(stats)
      savedContentRef.current = modified
      setIsDirty(false)
      // Jump to line after content loads (onMount fires too early)
      if (lineNumber && lineNumber > 0) {
        setTimeout(() => {
          try {
            if (viewMode === 'diff' && diffEditorRef.current) {
              const e = diffEditorRef.current.getModifiedEditor()
              const c = e.getModel()?.getLineCount() || 0
              const ln = Math.min(lineNumber, c)
              if (ln > 0) { e.revealLineInCenter(ln); e.setPosition({ lineNumber: ln, column: 1 }) }
            } else if (viewMode === 'edit' && editEditorRef.current) {
              const c = editEditorRef.current.getModel()?.getLineCount() || 0
              const ln = Math.min(lineNumber, c)
              if (ln > 0) { editEditorRef.current.revealLineInCenter(ln); editEditorRef.current.setPosition({ lineNumber: ln, column: 1 }) }
            }
          } catch {}
        }, 100)
      }
      justLoadedRef.current = true
    } catch {
      setOriginalContent('')
      setModifiedContent('')
      setDiffStats({ additions: 0, deletions: 0 })
    }
  }, [filePath, fullPath, isStaged, commitHash, diffContent, revision, compareOriginalContent])

  useEffect(() => {
    // edit 模式 + 无 diffContent（从文件浏览器直接打开）→ 不需要 diff 版本
    // loadForEdit 的 useEffect[viewMode] 会负责加载文件内容
    if (viewMode === 'edit' && !diffContent) return
    loadContents()
  }, [loadContents, viewMode, diffContent])

  const loadForEdit = useCallback(async (encoding?: string, forceOpen?: boolean) => {
    try {
      const result = await window.api.file.readWithEncoding(fullPath, encoding, forceOpen)
      if (result.error) {
        setModifiedContent('')
        if (forceOpen) {
          setUnreadableReason('')
          setEncodingInfo(result.error)
        } else {
          setUnreadableReason(result.error)
        }
      } else {
        setModifiedContent(result.content)
        savedContentRef.current = result.content
        setUnreadableReason('')
        if (!encoding) {
          setCurrentEncoding(result.encoding)
          if (result.bom) {
            setEncodingInfo(`BOM ${result.encoding.toUpperCase()}`)
          } else if (result.confidence < 1) {
            setEncodingInfo(`${Math.round(result.confidence * 100)}%`)
          } else {
            setEncodingInfo('')
          }
        }
        setIsDirty(false)
        if (lineNumber && lineNumber > 0) {
          setTimeout(() => {
            try {
              if (editEditorRef.current) {
                const c = editEditorRef.current.getModel()?.getLineCount() || 0
                const ln = Math.min(lineNumber, c)
                if (ln > 0) { editEditorRef.current.revealLineInCenter(ln); editEditorRef.current.setPosition({ lineNumber: ln, column: 1 }) }
              }
            } catch {}
          }, 100)
        }
      }
    } catch (err) {
      setModifiedContent('')
      setUnreadableReason('Failed to read file')
    }
    setEditLoading(false)
  }, [fullPath])

  useEffect(() => {
    if (viewMode === 'edit') {
      setEditLoading(true)
      loadForEdit()
    }
  }, [viewMode, loadForEdit])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.file.writeWithEncoding(fullPath, modifiedContent, currentEncoding)
      if (onSaved) {
        await onSaved(filePath)
      }
    } catch (err) {
    }
    savedContentRef.current = modifiedContent
    setIsDirty(false)
    setSaving(false)
  }, [fullPath, filePath, modifiedContent, currentEncoding, onSaved])

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave
  const onOpenCallGraphRef = useRef(onOpenCallGraph)
  onOpenCallGraphRef.current = onOpenCallGraph
  const onViewLineHistoryRef = useRef(onViewLineHistory)
  onViewLineHistoryRef.current = onViewLineHistory

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle keys when visible (not display:none)
      if (!containerRef.current?.offsetParent) return
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        if (commitHash && viewModeRef.current === 'diff') return
        e.preventDefault()
        handleSaveRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack, commitHash])

  // Escape 必须在 capture 阶段拦截，否则 Monaco 会先清掉选区
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !onBack) return
      if (!containerRef.current?.offsetParent) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onBack()
    }
    window.addEventListener('keydown', handleEsc, true)
    return () => window.removeEventListener('keydown', handleEsc, true)
  }, [onBack])

  // PageDown/PageUp 双击 / Ctrl+PageDown/PageUp 跳 diff 区块（对齐 VS Code）
  useEffect(() => {
    const handlePageNav = (e: KeyboardEvent) => {
      if (!containerRef.current?.offsetParent) return
      if (viewModeRef.current !== 'diff') return
      if (e.key !== 'PageDown' && e.key !== 'PageUp') return

      const dir = e.key === 'PageDown' ? 'next' : 'previous'

      // Ctrl+PageDown/PageUp: 直接跳转
      if (e.ctrlKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        try { diffEditorRef.current?.goToDiff(dir) } catch {}
        return
      }

      // 双击跳转
      const now = Date.now()
      const ref = pageKeyRef.current
      if (ref.key === e.key && now - ref.time < 400) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (ref.timer) clearTimeout(ref.timer)
        ref.key = ''
        ref.time = 0
        ref.timer = null
        try { diffEditorRef.current?.goToDiff(dir) } catch {}
      } else {
        if (ref.timer) clearTimeout(ref.timer)
        ref.key = e.key
        ref.time = now
        ref.timer = setTimeout(() => {
          ref.key = ''
          ref.time = 0
          ref.timer = null
        }, 400)
      }
    }
    document.addEventListener('keydown', handlePageNav, true)
    return () => document.removeEventListener('keydown', handlePageNav, true)
  }, [])

  // Encoding context menu outside-click dismissal
  useEffect(() => {
    if (!encodingContextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setEncodingContextMenu(null)
      }
    }
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', handleClick)
    }
  }, [encodingContextMenu])

  // Reset encoding state when file changes
  useEffect(() => {
    setCurrentEncoding(DEFAULT_ENCODING)
    setEncodingInfo('')
    setUnreadableReason('')
    setRevertBtn({ visible: false, top: 0, left: 56, ln: 0 })
    lastRevertLnRef.current = null
    autoJumpedRef.current = false
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }, [fullPath])

  const handleReopenWithEncoding = useCallback(async (encoding: string) => {
    setEncodingContextMenu(null)
    setCurrentEncoding(encoding)
    setEncodingInfo('')
    setSaving(true)
    try {
      const result = await window.api.file.readWithEncoding(fullPath, encoding)
      if (!result.error) {
        setModifiedContent(result.content)
        savedContentRef.current = result.content
        setIsDirty(false)
      }
    } catch {}
    setSaving(false)
  }, [fullPath])

  const handleForceOpen = useCallback(async () => {
    setEditLoading(true)
    await loadForEdit(undefined, true)
  }, [loadForEdit])

  const handleSaveWithEncoding = useCallback(async (encoding: string) => {
    setEncodingContextMenu(null)
    setSaving(true)
    try {
      await window.api.file.writeWithEncoding(fullPath, modifiedContent, encoding)
      setCurrentEncoding(encoding)
      setEncodingInfo('')
      savedContentRef.current = modifiedContent
      setIsDirty(false)
      if (onSaved) await onSaved(filePath)
    } catch {}
    setSaving(false)
  }, [fullPath, filePath, modifiedContent, onSaved])

  const diffOptions = useMemo(() => ({
    renderSideBySide: !inlineDiff,
    splitViewDefaultRatio: diffSplitRatio,
    readOnly: !!commitHash,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize,
    lineNumbers: 'on' as const,
    lineNumbersMinChars: 3,
    glyphMargin: true,
    wordWrap: (wordWrap ? 'on' : 'off') as 'on' | 'off',
    renderIndicators: true,
    originalEditable: false,
    renderOverviewRuler: true,
    ignoreTrimWhitespace: false,
    diffAlgorithm: 'advanced' as const,
    scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 16, useShadows: false }
  }), [inlineDiff, commitHash, fontSize, wordWrap, diffSplitRatio])

  const editOptions = useMemo(() => ({
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize,
    lineNumbers: 'on' as const,
    lineNumbersMinChars: 3,
    glyphMargin: true,
    wordWrap: (wordWrap ? 'on' : 'off') as 'on' | 'off',
    automaticLayout: true,
    padding: { top: 8 },
    scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 16, useShadows: false }
  }), [fontSize, wordWrap])

  // 单行回退浮钮：延迟隐藏（从行移到按钮不闪）
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
        setRevertBtn(s => (s.visible ? { ...s, visible: false } : s))
      lastRevertLnRef.current = null
      hideTimerRef.current = null
    }, 150)
  }, [])

  // 单行回退：查 change → executeEdits → 写盘 → onSaved
  const handleRevertLine = async (ln: number) => {
    if (revertingRef.current) return
    const diffEditor = diffEditorRef.current
    const monaco = monacoRef.current
    if (!diffEditor || !monaco) return
    const modEd = diffEditor.getModifiedEditor()
    const origEd = diffEditor.getOriginalEditor()
    const change = lineChangesRef.current.find((c: any) => {
      const mE = c.modifiedEndLineNumber
      if (!mE || mE === 0) return ln === c.modifiedStartLineNumber
      return ln >= c.modifiedStartLineNumber && ln <= mE
    })
    if (!change) return
    const edit = computeRevertEdit(monaco, modEd, origEd, change, ln)
    if (!edit) return

    revertingRef.current = true
    const pos = modEd.getPosition()
    try {
      modEd.executeEdits('revert-line', [edit])
      lastRevertLnRef.current = null
      setRevertBtn(s => ({ ...s, visible: false }))
      if (pos) modEd.setPosition(pos)
      const val = modEd.getValue()
      setModifiedContent(val)
      await window.api.file.writeWithEncoding(fullPath, val, currentEncoding)
      savedContentRef.current = val
      setIsDirty(false)
      if (onSaved) await onSaved(filePath)
    } catch {
      setIsDirty(true)
    } finally {
      revertingRef.current = false
    }
  }

  return (
    <div ref={containerRef} className={`flex flex-col animate-fade-in center-overlay${brushActive ? ' diff-brush-mode diff-brush-code' : ''}`}>
      <div
        className="diff-titlebar h-10 px-3 flex items-center justify-between bg-ide-sidebar border-b border-ide-border shrink-0"
        onContextMenu={!commitHash ? (e) => { e.preventDefault(); setEncodingContextMenu({ x: e.clientX, y: e.clientY }) } : undefined}
        onClick={(e) => {
          if (!brushActive || !fullPath) return
          e.preventDefault()
          e.stopPropagation()
          setToastPath(fullPath)
          navigator.clipboard.writeText(`@${fullPath}`).catch(() => {})
        }}
      >
        <div className="flex items-center gap-2 text-sm">
          {onBack && (
            <button
              onClick={() => { onBack() }}
              className="w-6 h-6 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors"
              title="Esc"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3.5 h-3.5">
                <polyline points="15 4 7 12 15 20" />
              </svg>
            </button>
          )}
          {compareOriginalPath ? (
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              <FilePathDisplay filePath={compareOriginalPath} />
              <span className="text-ide-accent shrink-0 font-medium">vs</span>
              <FilePathDisplay filePath={filePath} />
            </div>
          ) : (
            <FilePathDisplay filePath={filePath} />
          )}
          {viewMode === 'diff' && (diffStats.additions > 0 || diffStats.deletions > 0) && (
            <div className="flex items-center gap-1 text-xs shrink-0">
              {diffStats.additions > 0 && <span className="text-ide-success font-mono">+{diffStats.additions}</span>}
              {diffStats.deletions > 0 && <span className="text-ide-danger font-mono">-{diffStats.deletions}</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isDirty && <span className="text-[11px] text-ide-warning font-medium">● 未保存</span>}
          {currentEncoding !== DEFAULT_ENCODING && (
            <span className="text-[10px] text-ide-accent font-mono" title={encodingInfo || undefined}>{currentEncoding.toUpperCase()}</span>
          )}
        {!unreadableReason && (
        <div className="flex items-center rounded-md bg-ide-hover overflow-hidden">
          <button
            onClick={() => setViewMode('diff')}
            className={`px-2.5 py-1 text-xs transition-colors ${
              viewMode === 'diff' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text'
            }`}
          >
            Diff
          </button>
          <button
            onClick={() => setViewMode('edit')}
            className={`px-2.5 py-1 text-xs transition-colors ${
              viewMode === 'edit' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text'
            }`}
          >
            Edit
          </button>
        </div>
        )}
          {onToggleOutline && (
            <OutlineTrigger
              outlineEnabled={outlineEnabled}
              onToggle={onToggleOutline}
              content={modifiedContent}
              filePath={filePath}
              fullPath={fullPath}
              onNavigate={onOutlineNavigate}
            />
          )}
        </div>
      </div>

      <div className="relative overflow-hidden" style={{ height: 'calc(100vh - 80px)' }}>
        {viewMode === 'diff' ? (
          <DiffEditor
            height="100%"
            language={getLanguageFromFile(filePath)}
            theme={currentTheme.monacoTheme}
            original={originalContent}
            modified={modifiedContent}
            options={diffOptions}
            beforeMount={(m: any) => { configureMonacoBase(m) }}
            onMount={(editor, monaco) => {
              diffEditorRef.current = editor
              monacoRef.current = monaco
              const modifiedEditor = editor.getModifiedEditor()
              modifiedEditor.onMouseDown((e: any) => {
                if (brushActiveRef.current) {
                  e.event?.preventDefault()
                  e.event?.stopPropagation()
                  const sel = modifiedEditor.getSelection()
                  const clicked = e.target?.position?.lineNumber
                  if (sel && sel.startLineNumber !== sel.endLineNumber) {
                    handleAnnotationClickRef.current?.(sel.startLineNumber, sel.endLineNumber)
                  } else if (clicked) {
                    handleAnnotationClickRef.current?.(clicked, clicked)
                  }
                }
              })
              modifiedEditor.onDidChangeCursorPosition((e: any) => {
                if (cursorRef) cursorRef.current = { fullPath, line: e.position.lineNumber, column: e.position.column }
              })
              // 滚动时回写视口顶部可见行（用户眼睛实际看到的位置）→ 最近文件行号
              modifiedEditor.onDidScrollChange(() => {
                if (!visibleLineRef) return
                const r = modifiedEditor.getVisibleRanges()
                const v = r && r.length ? r[0] : null
                visibleLineRef.current = { fullPath, line: v ? v.startLineNumber + Math.round((v.endLineNumber - v.startLineNumber) / 2) : 1 }
              })
              modifiedEditor.onDidChangeModelContent(() => {
                if (revertingRef.current) return
                const val = modifiedEditor.getValue()
                setModifiedContent(val)
                if (justLoadedRef.current) {
                  justLoadedRef.current = false
                  return
                }
                setIsDirty(val !== savedContentRef.current)
              })
              if (lineNumber && lineNumber > 0) {
                try {
                  const count = modifiedEditor.getModel()?.getLineCount() || 0
                  const ln = Math.min(lineNumber, count)
                  if (ln > 0) {
                    modifiedEditor.revealLineInCenter(ln)
                    modifiedEditor.setPosition({ lineNumber: ln, column: 1 })
                  }
                } catch {}
              }
              ;(modifiedEditor as any)._callGraphActionDisposable = modifiedEditor.addAction({
                id: 'open-call-graph',
                label: t('Open Call Graph'),
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 1.5,
                run: (ed: any) => {
                  let word: string | undefined
                  const sel = ed.getSelection()
                  if (sel && !sel.isEmpty()) {
                    word = ed.getModel()?.getValueInRange(sel)
                  } else {
                    const pos = ed.getPosition()
                    if (pos) word = ed.getModel()?.getWordAtPosition(pos)?.word
                  }
                  if (word && onOpenCallGraphRef.current) {
                    onOpenCallGraphRef.current(word)
                  }
                }
              })
              ;(modifiedEditor as any)._lineHistoryActionDisposable = modifiedEditor.addAction({
                id: 'view-line-history',
                label: t('View Line History'),
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 1.6,
                run: (ed: any) => {
                  const pos = ed.getPosition()
                  if (pos && onViewLineHistoryRef.current) {
                    onViewLineHistoryRef.current(filePath, pos.lineNumber)
                  }
                }
              })
              // 单行回退 hover 浮钮：监听 diff 变更 + 鼠标 hover + 滚动/布局跟随
              // 先清理上一轮 diff 挂载的 disposable（viewMode 切换 edit→diff 时旧 editor 已 dispose）
              for (const d of diffDisposablesRef.current) { try { d?.dispose?.() } catch {} }
              diffDisposablesRef.current = []
              const revertDisposables: Array<{ dispose?: () => void }> = []
              revertDisposables.push(editor.onDidUpdateDiff(() => {
                const changes = editor.getLineChanges()
                lineChangesRef.current = changes ? changes.slice() : []
                changedModifiedLinesRef.current = buildChangedModifiedLines(lineChangesRef.current)
                // 首次 diff 就绪：无指定行号时自动跳到第一处修改
                if (!autoJumpedRef.current && !lineNumber && changes && changes.length > 0) {
                  autoJumpedRef.current = true
                  try { editor.goToDiff('next') } catch {}
                }
              }))
              setTimeout(() => {
                try {
                  const changes = editor.getLineChanges()
                  if (changes) {
                    lineChangesRef.current = changes.slice()
                    changedModifiedLinesRef.current = buildChangedModifiedLines(changes)
                  }
                } catch {}
              }, 0)
              const positionRevertBtn = (ln: number) => {
                lastRevertLnRef.current = ln
                setRevertBtn({
                  visible: true,
                  top: computeRevertBtnTop(modifiedEditor, ln),
                  left: computeRevertBtnLeft(modifiedEditor.getDomNode(), containerRef.current),
                  ln
                })
              }
              revertDisposables.push(modifiedEditor.onMouseMove((e: any) => {
                if (!enabledRef.current || revertingRef.current) return
                const ln = e.target?.position?.lineNumber
                if (!ln || !changedModifiedLinesRef.current.has(ln)) { scheduleHide(); return }
                const dom = modifiedEditor.getDomNode()
                if (dom) {
                  const rect = dom.getBoundingClientRect()
                  if (e.event.browserEvent.clientX - rect.left > rect.width / 2) { scheduleHide(); return }
                }
                if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
                if (lastRevertLnRef.current !== ln) {
                  positionRevertBtn(ln)
                }
              }))
              revertDisposables.push(modifiedEditor.onMouseLeave((e: any) => {
                // 浮钮是编辑器的 DOM 兄弟节点（overlay 层，视觉压在编辑器上），移到按钮会触发编辑器 mouseleave。
                // 仅当鼠标坐标真在浮钮 rect 内时跳过隐藏，否则真离开才隐藏 → 避免移到按钮时闪烁。
                const be = e?.event?.browserEvent
                const btn = revertBtnDomRef.current
                if (be && btn) {
                  const r = btn.getBoundingClientRect()
                  if (be.clientX >= r.left && be.clientX <= r.right && be.clientY >= r.top && be.clientY <= r.bottom) {
                    return
                  }
                }
                scheduleHide()
              }))
              const updateVisibleRevertBtn = () => {
                if (lastRevertLnRef.current === null) return
                setRevertBtn(prev => {
                  if (!prev.visible) { lastRevertLnRef.current = null; return prev }
                  const vr = modifiedEditor.getVisibleRanges()
                  if (!vr?.length || prev.ln < vr[0].startLineNumber || prev.ln > vr[vr.length - 1].endLineNumber) {
                    lastRevertLnRef.current = null
                    return { ...prev, visible: false }
                  }
                  return {
                    ...prev,
                    top: computeRevertBtnTop(modifiedEditor, prev.ln),
                    left: computeRevertBtnLeft(modifiedEditor.getDomNode(), containerRef.current)
                  }
                })
              }
              revertDisposables.push(modifiedEditor.onDidScrollChange(updateVisibleRevertBtn))
              revertDisposables.push(modifiedEditor.onDidLayoutChange(updateVisibleRevertBtn))
              diffDisposablesRef.current = revertDisposables
            }}
          />
        ) : editLoading ? (
          <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm">Loading...</div>
        ) : unreadableReason ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-ide-text-muted">
            <span className="text-sm">{unreadableReason}</span>
            <button
              onClick={handleForceOpen}
              className="px-4 py-1.5 text-xs rounded bg-ide-accent text-white hover:brightness-110 transition-colors"
            >
              {t('Force Open')}
            </button>
          </div>
        ) : (
          <Editor
            height="100%"
            language={getLanguageFromFile(filePath)}
            theme={currentTheme.monacoTheme}
            value={modifiedContent}
            onChange={(value) => {
              setModifiedContent(value || '')
              setIsDirty((value || '') !== savedContentRef.current)
            }}
            options={editOptions}
            beforeMount={(m: any) => { configureMonacoBase(m) }}
            onMount={(editor, monaco) => {
              editEditorRef.current = editor
              monacoRef.current = monaco
              editor.onMouseDown((e: any) => {
                if (brushActiveRef.current) {
                  e.event?.preventDefault()
                  e.event?.stopPropagation()
                  const sel = editor.getSelection()
                  const clicked = e.target?.position?.lineNumber
                  if (sel && sel.startLineNumber !== sel.endLineNumber) {
                    handleAnnotationClickRef.current?.(sel.startLineNumber, sel.endLineNumber)
                  } else if (clicked) {
                    handleAnnotationClickRef.current?.(clicked, clicked)
                  }
                }
              })
              editor.onDidChangeCursorPosition((e: any) => {
                if (cursorRef) cursorRef.current = { fullPath, line: e.position.lineNumber, column: e.position.column }
              })
              // 滚动时回写视口顶部可见行（用户眼睛实际看到的位置）→ 最近文件行号
              editor.onDidScrollChange(() => {
                if (!visibleLineRef) return
                const r = editor.getVisibleRanges()
                const v = r && r.length ? r[0] : null
                visibleLineRef.current = { fullPath, line: v ? v.startLineNumber + Math.round((v.endLineNumber - v.startLineNumber) / 2) : 1 }
              })
              if (lineNumber && lineNumber > 0) {
                try {
                  const count = editor.getModel()?.getLineCount() || 0
                  const ln = Math.min(lineNumber, count)
                  if (ln > 0) {
                    editor.revealLineInCenter(ln)
                    editor.setPosition({ lineNumber: ln, column: 1 })
                  }
                } catch {}
              }
              ;(editor as any)._callGraphActionDisposable = editor.addAction({
                id: 'open-call-graph',
                label: t('Open Call Graph'),
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 1.5,
                run: (ed: any) => {
                  let word: string | undefined
                  const sel = ed.getSelection()
                  if (sel && !sel.isEmpty()) {
                    word = ed.getModel()?.getValueInRange(sel)
                  } else {
                    const pos = ed.getPosition()
                    if (pos) word = ed.getModel()?.getWordAtPosition(pos)?.word
                  }
                  if (word && onOpenCallGraphRef.current) {
                    onOpenCallGraphRef.current(word)
                  }
                }
              })
              ;(editor as any)._lineHistoryActionDisposable = editor.addAction({
                id: 'view-line-history',
                label: t('View Line History'),
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 1.6,
                run: (ed: any) => {
                  const pos = ed.getPosition()
                  if (pos && onViewLineHistoryRef.current) {
                    onViewLineHistoryRef.current(filePath, pos.lineNumber)
                  }
                }
              })
            }}
          />
        )}
        {viewMode === 'diff' && revertBtn.visible && (
          <div className="diff-revert-overlay">
            <button
              ref={revertBtnDomRef}
              className="diff-revert-btn"
              style={{ top: revertBtn.top, left: revertBtn.left }}
              title={t('Revert this line')}
              onMouseEnter={() => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null } }}
              onMouseLeave={() => scheduleHide()}
              onClick={() => handleRevertLine(revertBtn.ln)}
            >
              <span aria-hidden>↩</span>
              <span>{t('单行')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Encoding Context Menu */}
      {encodingContextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[180px] max-h-80 overflow-y-auto"
          style={{ left: encodingContextMenu.x, top: encodingContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] text-ide-text-muted font-semibold uppercase tracking-wider">{t('Reopen With Encoding')}</div>
          {ENCODING_GROUPS.map(group => (
            <div key={group.name}>
              <div className="px-3 py-0.5 text-[10px] text-ide-text-muted">{t(group.name)}</div>
              {group.encodings.map(enc => (
                <button
                  key={enc.value}
                  onClick={() => handleReopenWithEncoding(enc.value)}
                  className={`w-full px-3 py-1 text-xs text-left hover:bg-ide-hover transition-colors flex items-center justify-between ${
                    currentEncoding === enc.value ? 'text-ide-accent' : 'text-ide-text'
                  }`}
                >
                  <span>{enc.label}</span>
                  {currentEncoding === enc.value && (
                    <span className="text-[10px] text-ide-accent">✓</span>
                  )}
                </button>
              ))}
            </div>
          ))}
          <div className="border-t border-ide-border mt-1 pt-1">
            <div className="px-3 py-1 text-[10px] text-ide-text-muted font-semibold uppercase tracking-wider">{t('Save With Encoding')}</div>
            {ENCODING_GROUPS.map(group => (
              <div key={`save-${group.name}`}>
                <div className="px-3 py-0.5 text-[10px] text-ide-text-muted">{t(group.name)}</div>
                {group.encodings.map(enc => (
                  <button
                    key={`save-${enc.value}`}
                    onClick={() => handleSaveWithEncoding(enc.value)}
                    className="w-full px-3 py-1 text-xs text-left hover:bg-ide-hover transition-colors text-ide-text"
                  >
                    {enc.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
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
              <span className="text-xs text-ide-text-muted truncate max-w-[320px]" title={toastPath}>@{toastPath}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default DiffViewer