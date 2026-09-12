import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { useTheme } from '../themes'
import { ENCODING_GROUPS, DEFAULT_ENCODING } from '@shared/encodings'
import { useI18n } from '../i18n'
import { FileIcon } from './FileIcons'
import OutlineTrigger from './OutlineTrigger'
import { ADD_ANNOTATION_EVENT } from './vibeEvents'
import { resolveAbsPath } from '../utils/filePathUtils'
import { baseName } from '../fileTabs'
import type { TabSnapshot, TabRuntime } from '../fileTabs'

let _monacoConfigured = false
function configureMonacoBase(monaco: any) {
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
  'gd': 'gdscript', 'gdshader': 'gdshader',
  'tscn': 'ini', 'tres': 'ini',
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
  isStaged: boolean
  commitHash?: string       // 查看历史 commit 时的 commit hash
  lineNumber?: number       // 跳转到指定行
  fontSize?: number         // 编辑器字体大小
  wordWrap?: boolean        // 是否自动换行
  scrollTrigger?: number    // PageUp/PageDown 触发滚动，变化时滚动一页
  revision?: number         // 递增以强制重新加载内容
  onDismiss?: () => void  // 收起文件区回终端（ESC / 标题栏返回钮），tab 保活不关闭
  onSaved?: (path: string) => Promise<void>
  defaultEdit?: boolean
  inlineDiff?: boolean      // 强制内联 diff 模式
  diffSplitRatio?: number   // 左右分栏占比（0.1~0.9，分隔线位置=左边占比）
  cursorRef?: React.MutableRefObject<{ fullPath: string; line: number; column: number } | null>
  visibleLineRef?: React.MutableRefObject<{ fullPath: string; line: number } | null>  // 视口中间可见行（居中还原用），供最近文件回写行号
  onOpenCallGraph?: (word: string) => void     // 右键菜单 → 打开 call graph
  onViewLineHistory?: (filePath: string, lineNumber: number) => void  // 右键菜单 → 查看这行修改记录
  jumpCwd?: string                              // Ctrl+Click 跳转：工作区根目录（grep 兜底 + 相对路径解析）
  onJumpToFile?: (fullPath: string, line: number) => void  // Ctrl+Click 跳转：打开文件并定位
  compareOriginalContent?: string  // 左侧对比文件内容（文件对比模式）
  compareOriginalPath?: string     // 左侧对比文件路径（文件对比模式）
  onAnnotationTrigger?: (start: number, end: number) => void
  brushActive?: boolean
  outlineEnabled?: boolean
  onToggleOutline?: () => void
  onOutlineNavigate?: (line: number, headingName?: string) => void
  headerLeading?: ReactNode   // 容器注入的标题栏左组（tab 条等），null 时非激活 tab
  isActive?: boolean          // display 可见性（多 tab 保活）
  tabId?: string
  jumpNonce?: number          // 递增以强制重复跳转到同一行
  getSnapshot?: () => TabSnapshot | null
  onPushSnapshot?: (s: TabSnapshot) => void
  onRuntimeChange?: (rt: TabRuntime | null) => void
}

type ViewMode = 'diff' | 'edit'

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
  return editorDom.getBoundingClientRect().left - containerDom.getBoundingClientRect().left
}

// 中缝 gutter（内置撤销按钮所在竖框）宽度 Monaco 硬编码 35px（gutterFeature.js const width），无 options 可调：
// 取内部实例同时改写 width 可观测值（布局）与 DOM 宽度，两处必须同源；sash 拖拽条仍按 35px 定位需补差
const MONACO_DIFF_GUTTER_WIDTH = 35
const DIFF_GUTTER_WIDTH = 24

function applyNarrowDiffGutter(editor: any) {
  try {
    const gutter = editor?._gutter?.get?.()
    const width = gutter?.width
    const dom: HTMLElement | undefined = gutter?.elements?.gutter
    if (!width?.read || !dom) return
    if (!gutter.__narrowed) {
      gutter.__narrowed = true
      gutter.width = {
        get: () => (width.get() ? DIFF_GUTTER_WIDTH : 0),
        read: (r: any) => (width.read(r) ? DIFF_GUTTER_WIDTH : 0)
      }
    }
    dom.style.width = DIFF_GUTTER_WIDTH + 'px'
    const sash = editor.getDomNode?.()?.querySelector(':scope > .monaco-sash') as HTMLElement | null
    if (sash) sash.style.marginLeft = MONACO_DIFF_GUTTER_WIDTH - DIFF_GUTTER_WIDTH + 'px'
  } catch {}
}

// Ctrl+Click 跳转：D 兜底定义正则（行首强定义模式，避开调用点）
// 三分支：关键字定义（function/class/def/fn/const…）/ 裸赋值定义（foo = / foo:）/ 类型前置定义（int foo( / pub fn foo(）
// 否定前瞻排除控制流（return foo( 是调用不是定义）
function buildDefRegex(word: string): string {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `^(?!\\s*(?:return|throw|await|yield|new|sizeof)\\b)(?:\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|type|enum|def|fn|func|struct|trait|const|let|var)\\s+${w}\\b|\\s*${w}\\s*(?:[=:]|\\s*=>)|\\s*[\\w<>:,*&]+(?:\\s+[\\w<>:,*&]+){0,3}\\s+${w}\\s*\\()`
}

// Ctrl+Click 跳转：定义类 kind 优先排序
const DEF_KINDS = new Set(['function', 'method', 'constructor', 'class', 'interface', 'type', 'enum', 'struct', 'variable', 'constant', 'field', 'property'])

interface JumpItem {
  fullPath: string
  line: number
  label: string
  detail?: string
}

const DiffViewer = React.memo(function DiffViewer({ filePath, fullPath, isStaged, commitHash, lineNumber, fontSize = 14, wordWrap = false, scrollTrigger, revision, onDismiss, onSaved, defaultEdit, inlineDiff = false, diffSplitRatio = 0.3, cursorRef, visibleLineRef, onOpenCallGraph, onViewLineHistory, jumpCwd, onJumpToFile, compareOriginalContent, compareOriginalPath, onAnnotationTrigger, brushActive, outlineEnabled = false, onToggleOutline, onOutlineNavigate = () => {}, headerLeading, isActive = true, tabId, jumpNonce, getSnapshot, onPushSnapshot, onRuntimeChange }: DiffViewerProps) {
  const { theme: currentTheme } = useTheme()
  const { t } = useI18n()

  // 从容器持续快照读取（仅右栏收起导致 remount 时非空）：恢复 dirty buffer / viewMode / encoding / 滚动行
  const restoreSnapRef = useRef<TabSnapshot | null | undefined>(undefined)
  if (restoreSnapRef.current === undefined) restoreSnapRef.current = getSnapshot ? getSnapshot() : null
  const restoreSnap = restoreSnapRef.current
  const restorePendingRef = useRef(!!restoreSnap)

  const [viewMode, setViewMode] = useState<ViewMode>(restoreSnap?.viewMode ?? (defaultEdit ? 'edit' : 'diff'))
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode

  // Reset viewMode when file changes
  const prevFullPathRef = useRef(fullPath)
  useEffect(() => {
    if (prevFullPathRef.current === fullPath) return
    prevFullPathRef.current = fullPath
    setViewMode(defaultEdit ? 'edit' : 'diff')
  }, [fullPath, defaultEdit])
  const [originalContent, setOriginalContent] = useState<string>('')
  const [modifiedContent, setModifiedContent] = useState<string>('')
  const [, setSaving] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty
  const savedContentRef = useRef('')
  const justLoadedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentEncoding, setCurrentEncoding] = useState<string>(DEFAULT_ENCODING)
  const [encodingInfo, setEncodingInfo] = useState<string>('')
  const [unreadableReason, setUnreadableReason] = useState<string>('')
  const [encodingContextMenu, setEncodingContextMenu] = useState<{ x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

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
  const pendingEditLineRef = useRef<number | null>(null)
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
    const targetLn = (lineNumber && lineNumber > 0) ? lineNumber : (restorePendingRef.current ? restoreSnapRef.current?.line : undefined)
    if (!targetLn || targetLn <= 0) return
    if (!containerRef.current?.offsetParent) return
    try {
      if (viewMode === 'diff' && diffEditorRef.current) {
        const modifiedEditor = diffEditorRef.current.getModifiedEditor()
        const count = modifiedEditor.getModel()?.getLineCount() || 0
        const ln = Math.min(targetLn, count)
        if (ln > 0) {
          modifiedEditor.revealLineInCenter(ln)
          modifiedEditor.setPosition({ lineNumber: ln, column: 1 })
          if (cursorRef) cursorRef.current = { fullPath, line: ln, column: 1 }
          if (visibleLineRef) visibleLineRef.current = { fullPath, line: ln }
        }
      } else if (viewMode === 'edit' && editEditorRef.current) {
        const count = editEditorRef.current.getModel()?.getLineCount() || 0
        const ln = Math.min(targetLn, count)
        if (ln > 0) {
          editEditorRef.current.revealLineInCenter(ln)
          editEditorRef.current.setPosition({ lineNumber: ln, column: 1 })
          if (cursorRef) cursorRef.current = { fullPath, line: ln, column: 1 }
          if (visibleLineRef) visibleLineRef.current = { fullPath, line: ln }
        }
      }
    } catch {}
  }, [lineNumber, jumpNonce, viewMode])

  // PageUp/PageDown: 滚动 diff 编辑器一页
  const prevScrollTrigger = useRef(scrollTrigger)
  useEffect(() => {
    if (scrollTrigger === undefined || prevScrollTrigger.current === undefined || prevScrollTrigger.current === scrollTrigger) return
    if (!containerRef.current?.offsetParent) return
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
    setDiffLoading(true)
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

      const rs = restoreSnapRef.current
      const useRestore = restorePendingRef.current && !!rs?.dirty && rs.buffer !== undefined
      const restoreLine = restorePendingRef.current ? rs?.line : undefined
      restorePendingRef.current = false
      setOriginalContent(original)
      if (useRestore) {
        setModifiedContent(rs!.buffer!)
        savedContentRef.current = modified
        setIsDirty(true)
      } else {
        setModifiedContent(modified)
        savedContentRef.current = modified
        setIsDirty(false)
      }
      // Jump to line after content loads (onMount fires too early)
      const jumpLn = (lineNumber && lineNumber > 0) ? lineNumber : restoreLine
      if (jumpLn && jumpLn > 0) {
        setTimeout(() => {
          try {
            if (viewMode === 'diff' && diffEditorRef.current) {
              const e = diffEditorRef.current.getModifiedEditor()
              const c = e.getModel()?.getLineCount() || 0
              const ln = Math.min(jumpLn, c)
              if (ln > 0) { e.revealLineInCenter(ln); e.setPosition({ lineNumber: ln, column: 1 }) }
            } else if (viewMode === 'edit' && editEditorRef.current) {
              const c = editEditorRef.current.getModel()?.getLineCount() || 0
              const ln = Math.min(jumpLn, c)
              if (ln > 0) { editEditorRef.current.revealLineInCenter(ln); editEditorRef.current.setPosition({ lineNumber: ln, column: 1 }) }
            }
          } catch {}
        }, 100)
      }
      justLoadedRef.current = true
    } catch {
      setOriginalContent('')
      setModifiedContent('')
    } finally {
      setDiffLoading(false)
    }
  }, [filePath, fullPath, isStaged, commitHash, revision, compareOriginalContent])

  useEffect(() => {
    // edit 模式内容由 loadForEdit 负责，切回 diff 时再重新拉取
    if (viewMode === 'edit') return
    loadContents()
  }, [loadContents, viewMode])

  const loadForEdit = useCallback(async (encoding?: string, forceOpen?: boolean, keepBuffer?: boolean) => {
    const restoreLine = restorePendingRef.current ? restoreSnapRef.current?.line : undefined
    restorePendingRef.current = false
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
        if (!keepBuffer) setModifiedContent(result.content)
        savedContentRef.current = result.content
        setUnreadableReason('')
        if (!encoding && !keepBuffer) {
          setCurrentEncoding(result.encoding)
          if (result.bom) {
            setEncodingInfo(`BOM ${result.encoding.toUpperCase()}`)
          } else if (result.confidence < 1) {
            setEncodingInfo(`${Math.round(result.confidence * 100)}%`)
          } else {
            setEncodingInfo('')
          }
        }
        setIsDirty(keepBuffer ? true : false)
        const jumpLn = (lineNumber && lineNumber > 0) ? lineNumber : restoreLine
        if (jumpLn && jumpLn > 0) {
          setTimeout(() => {
            try {
              if (editEditorRef.current) {
                const c = editEditorRef.current.getModel()?.getLineCount() || 0
                const ln = Math.min(jumpLn, c)
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
      const rs = restoreSnapRef.current
      const keep = restorePendingRef.current && !!rs?.dirty && rs.buffer !== undefined
      if (keep) {
        setModifiedContent(rs!.buffer!)
        setIsDirty(true)
        if (rs!.encoding) setCurrentEncoding(rs!.encoding)
      }
      setEditLoading(true)
      loadForEdit(undefined, undefined, keep)
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

  // 运行态注册（容器关 tab 时取 dirty / save）
  const onRuntimeChangeRef = useRef(onRuntimeChange)
  onRuntimeChangeRef.current = onRuntimeChange
  useEffect(() => {
    onRuntimeChangeRef.current?.({ dirty: isDirty, save: () => handleSaveRef.current() })
    return () => onRuntimeChangeRef.current?.(null)
  }, [isDirty])

  // 持续快照推送（ref 写，0 re-render）：右栏收起导致 remount 时供新实例恢复
  const onPushSnapshotRef = useRef(onPushSnapshot)
  onPushSnapshotRef.current = onPushSnapshot
  const buildSnapshot = useCallback((): TabSnapshot => {
    const v = visibleLineRef?.current
    return {
      buffer: isDirtyRef.current ? modifiedContent : undefined,
      dirty: isDirtyRef.current,
      viewMode: viewModeRef.current,
      encoding: currentEncoding,
      line: v && v.fullPath === fullPath ? v.line : undefined,
    }
  }, [modifiedContent, currentEncoding, fullPath, visibleLineRef])
  const buildSnapshotRef = useRef(buildSnapshot)
  buildSnapshotRef.current = buildSnapshot
  const scrollPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pushSnapshot = useCallback(() => {
    if (!tabId) return
    onPushSnapshotRef.current?.(buildSnapshotRef.current())
  }, [tabId])
  const scheduleScrollPush = useCallback(() => {
    if (scrollPushTimerRef.current) clearTimeout(scrollPushTimerRef.current)
    scrollPushTimerRef.current = setTimeout(() => {
      scrollPushTimerRef.current = null
      pushSnapshot()
    }, 250)
  }, [pushSnapshot])
  useEffect(() => {
    pushSnapshot()
  }, [isDirty, modifiedContent, viewMode, currentEncoding, pushSnapshot])
  useEffect(() => () => {
    if (scrollPushTimerRef.current) clearTimeout(scrollPushTimerRef.current)
  }, [])

  // 切回 tab 时 display:none → flex，显式 layout + gutter 重算
  useEffect(() => {
    if (!isActive) return
    try {
      diffEditorRef.current?.layout?.()
      editEditorRef.current?.layout?.()
      if (diffEditorRef.current) applyNarrowDiffGutter(diffEditorRef.current)
    } catch {}
  }, [isActive])

  // Ctrl+Click 跳转：C=codegraph 索引 → D=grep 定义正则兜底
  const jumpCwdRef = useRef(jumpCwd); jumpCwdRef.current = jumpCwd
  const onJumpToFileRef = useRef(onJumpToFile); onJumpToFileRef.current = onJumpToFile
  const [jumpCandidates, setJumpCandidates] = useState<{ word: string; items: JumpItem[]; x: number; y: number } | null>(null)
  const jumpCandidatesRef = useRef(jumpCandidates); jumpCandidatesRef.current = jumpCandidates
  const [jumpSel, setJumpSel] = useState(0)
  const jumpSelRef = useRef(jumpSel); jumpSelRef.current = jumpSel
  const jumpInflightRef = useRef<{ word: string; ts: number } | null>(null)

  const closeJump = useCallback(() => {
    setJumpCandidates(null)
    setJumpSel(0)
  }, [])

  const jumpToItem = useCallback((item: JumpItem) => {
    closeJump()
    onJumpToFileRef.current?.(item.fullPath, item.line)
  }, [closeJump])

  const performJumpQuery = useCallback(async (word: string, x: number, y: number) => {
    const now = Date.now()
    const inflight = jumpInflightRef.current
    if (inflight && inflight.word === word && now - inflight.ts < 300) return
    jumpInflightRef.current = { word, ts: now }
    const cwd = jumpCwdRef.current
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const curFile = norm(filePath)
    let items: JumpItem[] = []
    try {
      const r = await window.api.code.searchNodes(word, { limit: 50 })
      if (r && !r.error && r.nodes?.length) {
        const exact = r.nodes.filter((n: any) => n.name === word)
        exact.sort((a: any, b: any) => {
          const af = norm(a.filePath || '') === curFile ? 0 : 1
          const bf = norm(b.filePath || '') === curFile ? 0 : 1
          if (af !== bf) return af - bf
          const ak = DEF_KINDS.has(a.kind) ? 0 : 1
          const bk = DEF_KINDS.has(b.kind) ? 0 : 1
          if (ak !== bk) return ak - bk
          return (a.line || 0) - (b.line || 0)
        })
        items = exact.slice(0, 8).map((n: any) => ({
          fullPath: resolveAbsPath(n.filePath, cwd),
          line: n.line || 1,
          label: n.filePath || '',
          detail: n.signature || n.kind || ''
        }))
      }
    } catch {}
    if (!items.length && cwd) {
      try {
        const g = await window.api.search.grep({ query: buildDefRegex(word), cwd, regex: true, caseSensitive: true })
        if (g && !g.error && g.matches?.length) {
          items = g.matches.slice(0, 8).map((m: any) => ({
            fullPath: m.fullPath,
            line: m.line,
            label: m.file,
            detail: String(m.content || '').trim()
          }))
        }
      } catch {}
    }
    jumpInflightRef.current = null
    if (!items.length) return
    setJumpCandidates({ word, items, x, y })
    setJumpSel(0)
  }, [filePath])

  const handleJumpMouseDown = useCallback((editor: any, e: any) => {
    const be = e.event
    if (!be || !(be.ctrlKey || be.metaKey) || be.button !== 0) return
    const pos = e.target?.position
    if (!pos) return
    const word = editor.getModel()?.getWordAtPosition(pos)?.word
    if (!word || word.length > 120) return
    performJumpQuery(word, be.clientX, be.clientY)
  }, [performJumpQuery])

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
  }, [onDismiss, commitHash])

  // Escape 必须在 capture 阶段拦截，否则 Monaco 会先清掉选区
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !onDismiss) return
      if (!containerRef.current?.offsetParent) return
      if (jumpCandidatesRef.current) {
        closeJump()
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      e.preventDefault()
      e.stopImmediatePropagation()
      onDismiss()
    }
    window.addEventListener('keydown', handleEsc, true)
    return () => window.removeEventListener('keydown', handleEsc, true)
  }, [onDismiss, closeJump])

  // 跳转候选浮层：↑↓ 选择 + Enter 跳转（浮层开着时拦截）
  useEffect(() => {
    const handleJumpKeys = (e: KeyboardEvent) => {
      const c = jumpCandidatesRef.current
      if (!c) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setJumpSel(i => Math.min(i + 1, c.items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setJumpSel(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        const item = c.items[jumpSelRef.current]
        if (item) jumpToItem(item)
      }
    }
    window.addEventListener('keydown', handleJumpKeys, true)
    return () => window.removeEventListener('keydown', handleJumpKeys, true)
  }, [jumpToItem])

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
  const prevEncFullPathRef = useRef(fullPath)
  useEffect(() => {
    if (prevEncFullPathRef.current === fullPath) return
    prevEncFullPathRef.current = fullPath
    setCurrentEncoding(DEFAULT_ENCODING)
    setEncodingInfo('')
    setUnreadableReason('')
    setRevertBtn({ visible: false, top: 0, left: 56, ln: 0 })
    lastRevertLnRef.current = null
    autoJumpedRef.current = false
    pendingEditLineRef.current = null
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
    // addExtraSpaceOnTop 默认按 Ctrl+F 在首行上方插入 view zone；短文件 scrollTop 钳制后
    // 补偿失效，正文会被顶下去。改为浮动覆盖：bar 由 globals.css top:16px 下移留白
    find: { addExtraSpaceOnTop: false },
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
    // inline 模式下 gutter（Monaco 硬编码 35px）会跑到最左侧成一条空带 + 分隔线；其内置撤销按钮
    // 由本文自带的 React 回退浮钮替代，故 inline 时不渲染；并排模式的中间 gutter（撤销按钮常显）保留
    renderGutterMenu: !inlineDiff,
    automaticLayout: true,
    scrollbar: { verticalScrollbarSize: 0, horizontalScrollbarSize: 16, useShadows: false }
  }), [inlineDiff, commitHash, fontSize, wordWrap, diffSplitRatio])

  const editOptions = useMemo(() => ({
    find: { addExtraSpaceOnTop: false },
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize,
    lineNumbers: 'on' as const,
    lineNumbersMinChars: 3,
    glyphMargin: false,
    wordWrap: (wordWrap ? 'on' : 'off') as 'on' | 'off',
    automaticLayout: true,
    padding: { top: 8 },
    scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 16, useShadows: false }
  }), [fontSize, wordWrap])

  // diff 两侧的 gutter 瘦身：左（原文件）行号两种模式都不显示；glyph 栏本 app 无任何装饰、只归 Monaco 内置回退箭头用，一并关掉让位。
  // Monaco 无分侧 options，且 widget 随 options 重推（本 app 传整个 options 对象）会盖回来，故 diffOptions 变化时重放；child effect 先于本 effect 执行
  const applyDiffPerSideOptions = useCallback((editor: any) => {
    if (!editor) return
    try {
      editor.getOriginalEditor?.().updateOptions({ lineNumbers: 'off', glyphMargin: false })
      editor.getModifiedEditor?.().updateOptions({ glyphMargin: false })
    } catch {}
  }, [])
  useEffect(() => {
    applyDiffPerSideOptions(diffEditorRef.current)
    applyNarrowDiffGutter(diffEditorRef.current)
    // gutter 随 renderGutterMenu 重建，重建若发生在 options 提交后一帧，此处补一次
    const raf = requestAnimationFrame(() => applyNarrowDiffGutter(diffEditorRef.current))
    return () => cancelAnimationFrame(raf)
  }, [applyDiffPerSideOptions, diffOptions])

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

  // diff→edit：把 diff 右侧当前行带到 edit。光标不在视口内（纯滚动过）→ 用视口中间行
  const switchToEdit = () => {
    let target: number | null = null
    try {
      const ed = diffEditorRef.current?.getModifiedEditor()
      if (ed) {
        const vr = ed.getVisibleRanges()
        const v = vr && vr.length ? vr[0] : null
        const pos = ed.getPosition()
        const inView = !!(v && pos && pos.lineNumber >= v.startLineNumber && pos.lineNumber <= v.endLineNumber)
        target = inView && pos ? pos.lineNumber : v ? v.startLineNumber + Math.round((v.endLineNumber - v.startLineNumber) / 2) : (pos?.lineNumber ?? null)
      }
    } catch {}
    pendingEditLineRef.current = target
    setViewMode('edit')
  }

  return (
    <div ref={containerRef} className={`flex flex-col h-full animate-fade-in center-overlay${brushActive ? ' diff-brush-mode diff-brush-code' : ''}`}>
      <div className="diff-titlebar h-8 px-3 flex items-center justify-between gap-2 bg-ide-sidebar border-b border-ide-border shrink-0">
        {headerLeading}

        <div
          className="flex items-center gap-2 shrink-0"
          onContextMenu={!commitHash ? (e) => { e.preventDefault(); setEncodingContextMenu({ x: e.clientX, y: e.clientY }) } : undefined}
          onClick={(e) => {
            if (!brushActive || !fullPath) return
            e.preventDefault()
            e.stopPropagation()
            window.dispatchEvent(new CustomEvent(ADD_ANNOTATION_EVENT, { detail: { rel: filePath } }))
          }}
        >
          {compareOriginalPath && (
            <div className="flex items-center gap-1 text-xs min-w-0" title={`${compareOriginalPath} vs ${fullPath}`}>
              <FileIcon name={baseName(compareOriginalPath)} className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[100px] text-ide-text-muted">{baseName(compareOriginalPath)}</span>
              <span className="text-ide-accent shrink-0">↔</span>
              <FileIcon name={baseName(fullPath)} className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[100px]">{baseName(fullPath)}</span>
            </div>
          )}
          {isDirty && <span className="text-[11px] text-ide-warning font-medium">● 未保存</span>}
          {currentEncoding !== DEFAULT_ENCODING && (
            <span className="text-[10px] text-ide-accent font-mono" title={encodingInfo || undefined}>{currentEncoding.toUpperCase()}</span>
          )}
          {!unreadableReason && (
            viewMode === 'diff' ? (
              <button
                onClick={switchToEdit}
                className="w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
                title="编辑"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z" />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => setViewMode('diff')}
                className="w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
                title="Diff"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                  <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
                  <line x1="8" y1="2.75" x2="8" y2="13.25" />
                </svg>
              </button>
            )
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

      <div className={`relative flex-1 min-h-0 overflow-hidden${inlineDiff ? ' diff-inline' : ''}`}>
        {diffLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-ide-text-muted text-sm bg-ide-bg/60">
            Loading...
          </div>
        )}
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
              applyDiffPerSideOptions(editor)
              applyNarrowDiffGutter(editor)
              const modifiedEditor = editor.getModifiedEditor()
              modifiedEditor.onMouseDown((e: any) => {
                const ctrlClick = !!(e.event?.ctrlKey || e.event?.metaKey)
                const pos = e.target?.position
                const ch = pos ? (modifiedEditor.getModel()?.getLineContent(pos.lineNumber) ?? '')[pos.column - 1] ?? '' : ''
                const onWord = ctrlClick && !!pos && /[\w$_]/.test(ch)
                if (brushActiveRef.current || ctrlClick) {
                  e.event?.preventDefault()
                  e.event?.stopPropagation()
                  const sel = modifiedEditor.getSelection()
                  const clicked = pos?.lineNumber
                  if (sel && sel.startLineNumber !== sel.endLineNumber) {
                    handleAnnotationClickRef.current?.(sel.startLineNumber, sel.endLineNumber)
                  } else if (onWord) {
                    handleJumpMouseDown(modifiedEditor, e)
                  } else if (clicked) {
                    handleAnnotationClickRef.current?.(clicked, clicked)
                  }
                  return
                }
                if (ctrlClick) handleJumpMouseDown(modifiedEditor, e)
              })
              modifiedEditor.onDidChangeCursorPosition((e: any) => {
                if (!containerRef.current?.offsetParent) return
                if (cursorRef) cursorRef.current = { fullPath, line: e.position.lineNumber, column: e.position.column }
              })
              // 滚动时回写视口顶部可见行（用户眼睛实际看到的位置）→ 最近文件行号
              modifiedEditor.onDidScrollChange(() => {
                if (!containerRef.current?.offsetParent) return
                scheduleScrollPush()
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
                const ctrlClick = !!(e.event?.ctrlKey || e.event?.metaKey)
                const pos = e.target?.position
                const ch = pos ? (editor.getModel()?.getLineContent(pos.lineNumber) ?? '')[pos.column - 1] ?? '' : ''
                const onWord = ctrlClick && !!pos && /[\w$_]/.test(ch)
                if (brushActiveRef.current || ctrlClick) {
                  e.event?.preventDefault()
                  e.event?.stopPropagation()
                  const sel = editor.getSelection()
                  const clicked = pos?.lineNumber
                  if (sel && sel.startLineNumber !== sel.endLineNumber) {
                    handleAnnotationClickRef.current?.(sel.startLineNumber, sel.endLineNumber)
                  } else if (onWord) {
                    handleJumpMouseDown(editor, e)
                  } else if (clicked) {
                    handleAnnotationClickRef.current?.(clicked, clicked)
                  }
                  return
                }
                if (ctrlClick) handleJumpMouseDown(editor, e)
              })
              editor.onDidChangeCursorPosition((e: any) => {
                if (!containerRef.current?.offsetParent) return
                if (cursorRef) cursorRef.current = { fullPath, line: e.position.lineNumber, column: e.position.column }
              })
              // 滚动时回写视口顶部可见行（用户眼睛实际看到的位置）→ 最近文件行号
              editor.onDidScrollChange(() => {
                if (!containerRef.current?.offsetParent) return
                scheduleScrollPush()
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
              if (pendingEditLineRef.current) {
                setTimeout(() => {
                  const t = pendingEditLineRef.current
                  if (!t) return
                  pendingEditLineRef.current = null
                  const e = editEditorRef.current
                  const c = e?.getModel()?.getLineCount() || 0
                  const ln = Math.min(t, c)
                  if (e && ln > 0) {
                    e.revealLineInCenter(ln)
                    e.setPosition({ lineNumber: ln, column: 1 })
                  }
                }, 100)
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

      {/* Ctrl+Click 跳转候选浮层 */}
      {jumpCandidates && (
        <div
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[280px] max-w-[520px] max-h-72 overflow-y-auto"
          style={{ left: Math.max(8, Math.min(jumpCandidates.x - 40, window.innerWidth - 540)), top: Math.min(jumpCandidates.y + 16, window.innerHeight - 300) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] text-ide-text-muted font-semibold uppercase tracking-wider truncate">{jumpCandidates.word} →</div>
          {jumpCandidates.items.map((item, i) => (
            <button
              key={`${item.fullPath}:${item.line}:${i}`}
              onClick={() => jumpToItem(item)}
              onMouseEnter={() => setJumpSel(i)}
              className={`w-full px-3 py-1 text-left flex items-center gap-2 transition-colors ${i === jumpSel ? 'bg-ide-accent/15' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs text-ide-text truncate">{item.label}</div>
                {item.detail && <div className="text-[10px] text-ide-text-muted truncate">{item.detail}</div>}
              </div>
              <span className="text-[10px] text-ide-text-muted shrink-0 font-mono">{item.line}</span>
            </button>
          ))}
        </div>
      )}

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
    </div>
  )
})

export default DiffViewer