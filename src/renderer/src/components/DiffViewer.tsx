import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { useTheme } from '../themes'
import { registerMonacoThemes } from '../themes'

interface DiffViewerProps {
  filePath: string          // 相对路径（用于 git 操作）
  fullPath: string          // 完整路径（用于 file read/write）
  diffContent: string
  isStaged: boolean
  commitHash?: string       // 查看历史 commit 时的 commit hash
  showSquiggles?: boolean
  lineNumber?: number       // 跳转到指定行
  onStage: (path: string) => Promise<void>
  onUnstage: (path: string) => Promise<void>
  onBack?: () => void
  onSaved?: (path: string) => Promise<void>
  onRefreshDiff?: (path: string, staged: boolean) => Promise<string>
  defaultEdit?: boolean
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

const DiffViewer = React.memo(function DiffViewer({ filePath, fullPath, diffContent, isStaged, commitHash, showSquiggles = true, lineNumber, onStage, onUnstage, onBack, onSaved, onRefreshDiff, defaultEdit }: DiffViewerProps) {
  const { theme: currentTheme } = useTheme()

  const [viewMode, setViewMode] = useState<ViewMode>(defaultEdit ? 'edit' : 'diff')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [modifiedContent, setModifiedContent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number }>({ additions: 0, deletions: 0 })
  const savedContentRef = useRef('')
  const justLoadedRef = useRef(false)

  // Editor refs for imperative line jumping
  const diffEditorRef = useRef<any>(null)
  const editEditorRef = useRef<any>(null)

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
        }
      } else if (viewMode === 'edit' && editEditorRef.current) {
        const count = editEditorRef.current.getModel()?.getLineCount() || 0
        const ln = Math.min(lineNumber, count)
        if (ln > 0) {
          editEditorRef.current.revealLineInCenter(ln)
          editEditorRef.current.setPosition({ lineNumber: ln, column: 1 })
        }
      }
    } catch {}
  }, [lineNumber, viewMode])

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
        const [headResult, currResult] = await Promise.all([
          window.api.git.showFile('HEAD', filePath),
          isStaged
            ? window.api.git.showFile('', filePath)
            : window.api.file.read(fullPath)
        ])
        original = headResult.error ? '' : headResult.content
        modified = currResult.error ? '' : (currResult.content || '')
      }

      const stats = diffContent ? parseDiffStats(diffContent) : { additions: 0, deletions: 0 }
      setOriginalContent(original)
      setModifiedContent(modified)
      setDiffStats(stats)
      savedContentRef.current = modified
      setIsDirty(false)
      justLoadedRef.current = true
    } catch {
      setOriginalContent('')
      setModifiedContent('')
      setDiffStats({ additions: 0, deletions: 0 })
    }
  }, [filePath, fullPath, isStaged, commitHash])

  useEffect(() => {
    loadContents()
  }, [loadContents])

  const loadForEdit = useCallback(async () => {
    try {
      const result = await window.api.file.read(fullPath)
      if (result.error) {
        setModifiedContent('')
      } else {
        setModifiedContent(result.content)
        savedContentRef.current = result.content
        setIsDirty(false)
      }
    } catch (err) {
      setModifiedContent('')
    }
  }, [fullPath])

  useEffect(() => {
    if (viewMode === 'edit') {
      loadForEdit()
    }
  }, [viewMode, loadForEdit])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.file.write(fullPath, modifiedContent)
      if (onSaved) {
        await onSaved(filePath)
      }
    } catch (err) {
    }
    savedContentRef.current = modifiedContent
    setIsDirty(false)
    setSaving(false)
  }, [fullPath, filePath, modifiedContent, onSaved])

  const handleSaveDiff = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.file.write(fullPath, modifiedContent)
      if (onSaved) {
        await onSaved(filePath)
      }
    } catch (err) {
    }
    savedContentRef.current = modifiedContent
    setIsDirty(false)
    setSaving(false)
  }, [fullPath, filePath, modifiedContent, onSaved])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        if (commitHash) return
        e.preventDefault()
        if (viewMode === 'edit') {
          handleSave()
        } else if (viewMode === 'diff') {
          handleSaveDiff()
        }
      }
      if (e.key === 'Escape' && onBack) {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, handleSave, handleSaveDiff, onBack])

  const getLanguageFromFile = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'xml': 'xml',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'md': 'markdown',
      'sql': 'sql',
      'sh': 'shell',
      'bash': 'shell',
      'dockerfile': 'dockerfile',
      'gitignore': 'plaintext',
      'env': 'plaintext',
      'txt': 'plaintext',
      'lock': 'json'
    }
    return langMap[ext] || 'plaintext'
  }

  const configureMonaco = (monaco: any) => {
    registerMonacoThemes(monaco)
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
  }

  return (
    <div className="flex flex-col border-t border-ide-border animate-fade-in">
      <div className="h-10 px-3 flex items-center justify-between bg-ide-hover/30 border-b border-ide-border shrink-0">
        <div className="flex items-center gap-2 text-sm">
          {onBack && (
            <button
              onClick={onBack}
              className="w-6 h-6 rounded text-ide-text-muted hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors"
              title="Esc"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3.5 h-3.5">
                <polyline points="15 4 7 12 15 20" />
              </svg>
            </button>
          )}
          <span className="text-ide-text font-medium truncate max-w-md">{filePath}</span>
          {(diffStats.additions > 0 || diffStats.deletions > 0) && (
            <div className="flex items-center gap-1 text-xs shrink-0">
              {diffStats.additions > 0 && <span className="text-ide-success font-mono">+{diffStats.additions}</span>}
              {diffStats.deletions > 0 && <span className="text-ide-danger font-mono">-{diffStats.deletions}</span>}
            </div>
          )}
          {isStaged && <span className="text-xs text-ide-success">staged</span>}
        </div>

        <div className="flex items-center gap-2">
          {isDirty && <span className="text-[11px] text-ide-warning font-medium">● 未保存</span>}
          {!commitHash && (
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
              renderSideBySide: true,
              readOnly: !!commitHash,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
              lineNumbers: 'on',
              wordWrap: 'on',
              renderIndicators: true,
              scrollbar: {
                vertical: 'hidden',
                horizontal: 'hidden',
                useShadows: false
              }
            }}
            beforeMount={configureMonaco}
            onMount={(editor) => {
              diffEditorRef.current = editor
              const modifiedEditor = editor.getModifiedEditor()
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
            }}
          />
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
              fontSize: 13,
              lineNumbers: 'on',
              wordWrap: 'on',
              tabSize: 2,
              automaticLayout: true,
              padding: { top: 8 }
            }}
            beforeMount={configureMonaco}
            onMount={(editor) => {
              editEditorRef.current = editor
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
            }}
          />
        )}
      </div>
    </div>
  )
})

export default DiffViewer