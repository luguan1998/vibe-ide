import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { useTheme } from '../themes'
import { ENCODING_GROUPS, DEFAULT_ENCODING } from '@shared/encodings'
import { useI18n } from '../i18n'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'

interface DiffViewerProps {
  filePath: string          // 相对路径（用于 git 操作）
  fullPath: string          // 完整路径（用于 file read/write）
  diffContent: string
  isStaged: boolean
  commitHash?: string       // 查看历史 commit 时的 commit hash
  showSquiggles?: boolean
  lineNumber?: number       // 跳转到指定行
  fontSize?: number         // 编辑器字体大小
  wordWrap?: boolean        // 是否自动换行
  scrollTrigger?: number    // PageUp/PageDown 触发滚动，变化时滚动一页
  revision?: number         // 递增以强制重新加载内容
  onBack?: (selection?: { startLine: number; endLine: number }) => void
  onSaved?: (path: string) => Promise<void>
  defaultEdit?: boolean
  inlineDiff?: boolean      // 强制内联 diff 模式
  cursorRef?: React.MutableRefObject<{ fullPath: string; line: number; column: number } | null>
  onContentLoaded?: (content: string) => void  // 回传文件内容给父组件（供 OutlinePanel 使用）
  onOpenCallGraph?: (word: string) => void     // 右键菜单 → 打开 call graph
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

const DiffViewer = React.memo(function DiffViewer({ filePath, fullPath, diffContent, isStaged, commitHash, showSquiggles = true, lineNumber, fontSize = 14, wordWrap = false, scrollTrigger, revision, onBack, onSaved, defaultEdit, inlineDiff = false, cursorRef, onContentLoaded, onOpenCallGraph }: DiffViewerProps) {
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

  // Editor refs for imperative line jumping
  const diffEditorRef = useRef<any>(null)
  const editEditorRef = useRef<any>(null)

  // Dispose Monaco editors before unmount to prevent "TextModel got disposed before DiffEditorWidget model got reset"
  // Use useLayoutEffect so cleanup runs before @monaco-editor/react's useEffect cleanup
  React.useLayoutEffect(() => {
    return () => {
      // Dispose call-graph actions before disposing editors
      try {
        diffEditorRef.current?.getModifiedEditor()?._callGraphActionDisposable?.dispose?.()
      } catch {}
      try {
        editEditorRef.current?._callGraphActionDisposable?.dispose?.()
      } catch {}
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
        }
      } else if (viewMode === 'edit' && editEditorRef.current) {
        const count = editEditorRef.current.getModel()?.getLineCount() || 0
        const ln = Math.min(lineNumber, count)
        if (ln > 0) {
          editEditorRef.current.revealLineInCenter(ln)
          editEditorRef.current.setPosition({ lineNumber: ln, column: 1 })
          if (cursorRef) cursorRef.current = { fullPath, line: ln, column: 1 }
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

      if (commitHash) {
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
  }, [filePath, fullPath, isStaged, commitHash, diffContent, revision])

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
        if (onContentLoaded) onContentLoaded(result.content)
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
      let sel: { startLine: number; endLine: number } | undefined
      try {
        const editor = viewModeRef.current === 'edit'
          ? editEditorRef.current
          : diffEditorRef.current?.getModifiedEditor()
        const range = editor?.getSelection()
        if (range && !range.isEmpty()) {
          sel = { startLine: range.startLineNumber, endLine: range.endLineNumber }
        }
      } catch {}
      onBack(sel)
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

  const getLanguageFromFile = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const langMap: Record<string, string> = {
      // JavaScript/TypeScript
      'ts': 'typescript',
      'tsx': 'typescript',
      'mts': 'typescript',
      'cts': 'typescript',
      'js': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      'jsx': 'javascript',
      // Python
      'py': 'python',
      'pyw': 'python',
      // Rust / Go / Java / Kotlin
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'kt': 'kotlin',
      'kts': 'kotlin',
      // C / C++ / C#
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'csx': 'csharp',
      'cake': 'csharp',
      // Ruby / PHP / Swift / Dart
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'dart': 'dart',
      // Scala / Clojure / F# / Julia / Elixir
      'scala': 'scala',
      'sc': 'scala',
      'sbt': 'scala',
      'clj': 'clojure',
      'cljs': 'clojure',
      'cljc': 'clojure',
      'edn': 'clojure',
      'fs': 'fsharp',
      'fsx': 'fsharp',
      'jl': 'julia',
      'ex': 'elixir',
      'exs': 'elixir',
      // Perl / Lua / R / CoffeeScript
      'pl': 'perl',
      'pm': 'perl',
      'lua': 'lua',
      'r': 'r',
      'coffee': 'coffeescript',
      // Solidity / Protobuf
      'sol': 'sol',
      'proto': 'protobuf',
      // JSON / YAML / TOML / XML
      'json': 'json',
      'lock': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'xml': 'xml',
      // HTML / Vue / Razor
      'html': 'html',
      'htm': 'html',
      'vue': 'html',
      'cshtml': 'razor',
      // CSS / SCSS / Less
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      // Markdown / MDX
      'md': 'markdown',
      'mdx': 'mdx',
      // SQL
      'sql': 'sql',
      // Shell / Batch / PowerShell
      'sh': 'shell',
      'bash': 'shell',
      'bat': 'bat',
      'cmd': 'bat',
      'ps1': 'powershell',
      'psm1': 'powershell',
      'psd1': 'powershell',
      // Docker / Terraform / INI
      'dockerfile': 'dockerfile',
      'tf': 'hcl',
      'tfvars': 'hcl',
      'ini': 'ini',
      'properties': 'ini',
      // GraphQL
      'graphql': 'graphql',
      'gql': 'graphql',
      // Templates
      'handlebars': 'handlebars',
      'hbs': 'handlebars',
      'pug': 'pug',
      'jade': 'pug',
      'twig': 'twig',
      // Hardware
      'sv': 'systemverilog',
      'svh': 'systemverilog',
      'v': 'verilog',
      'vh': 'verilog',
      // Plain text (no highlighting)
      'gitignore': 'plaintext',
      'env': 'plaintext',
      'txt': 'plaintext'
    }
    return langMap[ext] || 'plaintext'
  }

  const configureMonaco = (monaco: any) => {
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      jsx: monaco.languages.typescript.JsxEmit.React,
      noEmit: true
    })
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: !showSquiggles,
      noSyntaxValidation: !showSquiggles
    })
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      allowJs: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      jsx: monaco.languages.typescript.JsxEmit.React,
      noEmit: true
    })
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: !showSquiggles,
      noSyntaxValidation: !showSquiggles
    })
  }

  return (
    <div ref={containerRef} className="flex flex-col animate-fade-in">
      <div
        className="h-10 px-3 flex items-center justify-between bg-ide-sidebar border-b border-ide-border shrink-0"
        onContextMenu={!commitHash ? (e) => { e.preventDefault(); setEncodingContextMenu({ x: e.clientX, y: e.clientY }) } : undefined}
      >
        <div className="flex items-center gap-2 text-sm">
          {onBack && (
            <button
              onClick={() => {
                let sel: { startLine: number; endLine: number } | undefined
                try {
                  const editor = viewModeRef.current === 'edit'
                    ? editEditorRef.current
                    : diffEditorRef.current?.getModifiedEditor()
                  const range = editor?.getSelection()
                  if (range && !range.isEmpty()) {
                    sel = { startLine: range.startLineNumber, endLine: range.endLineNumber }
                  }
                } catch {}
                onBack(sel)
              }}
              className="w-6 h-6 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors"
              title="Esc"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3.5 h-3.5">
                <polyline points="15 4 7 12 15 20" />
              </svg>
            </button>
          )}
          <FilePathDisplay filePath={filePath} />
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
        </div>
      </div>

      <div className="overflow-hidden" style={{ height: 'calc(100vh - 80px)' }}>
        {viewMode === 'diff' ? (
          <DiffEditor
            height="100%"
            language={getLanguageFromFile(filePath)}
            theme={currentTheme.monacoTheme}
            original={originalContent}
            modified={modifiedContent}
            options={{
              renderSideBySide: !inlineDiff,
              readOnly: !!commitHash,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize,
              lineNumbers: 'on',
              wordWrap: wordWrap ? 'on' : 'off',
              renderIndicators: true,
              originalEditable: false,
              renderOverviewRuler: true,
              ignoreTrimWhitespace: false,
              diffAlgorithm: 'advanced',
              scrollbar: {
                verticalScrollbarSize: 5,
                horizontalScrollbarSize: 10,
                useShadows: false
              }
            }}
            beforeMount={configureMonaco}
            onMount={(editor) => {
              diffEditorRef.current = editor
              const modifiedEditor = editor.getModifiedEditor()
              modifiedEditor.onDidChangeCursorPosition((e: any) => {
                if (cursorRef) cursorRef.current = { fullPath, line: e.position.lineNumber, column: e.position.column }
              })
              modifiedEditor.onDidChangeModelContent(() => {
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
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize,
              lineNumbers: 'on',
              wordWrap: wordWrap ? 'on' : 'off',
              automaticLayout: true,
              padding: { top: 8 },
              scrollbar: {
                verticalScrollbarSize: 12,
                horizontalScrollbarSize: 10,
                useShadows: false
              }
            }}
            beforeMount={configureMonaco}
            onMount={(editor) => {
              editEditorRef.current = editor
              editor.onDidChangeCursorPosition((e: any) => {
                if (cursorRef) cursorRef.current = { fullPath, line: e.position.lineNumber, column: e.position.column }
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
            }}
          />
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
    </div>
  )
})

export default DiffViewer