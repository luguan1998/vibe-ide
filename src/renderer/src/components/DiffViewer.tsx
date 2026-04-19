import React, { useState, useEffect, useCallback } from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'

interface DiffViewerProps {
  filePath: string
  diffContent: string
  isStaged: boolean
  showSquiggles?: boolean
  onStage: (path: string) => Promise<void>
  onUnstage: (path: string) => Promise<void>
  onBack?: () => void
  onSaved?: (path: string) => Promise<void>
}

type ViewMode = 'diff' | 'edit'

function parseDiffContent(diff: string): { original: string; modified: string } {
  const originalLines: string[] = []
  const modifiedLines: string[] = []

  const lines = diff.split('\n')
  for (const line of lines) {
    if (line.startsWith('diff ') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ') ||
        line.startsWith('@@')) {
      continue
    }
    if (line.startsWith('-')) {
      originalLines.push(line.slice(1))
    } else if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1))
    } else if (line.trim()) {
      originalLines.push(line)
      modifiedLines.push(line)
    }
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n')
  }
}

function parseDiffStats(diff: string): { additions: number; deletions: number } {
  const lines = diff.split('\n')
  let totalAdditions = 0
  let totalDeletions = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/)
      if (match) {
        const oldLines = parseInt(match[1])
        const oldCount = parseInt(match[2]) || oldLines
        const newLines = parseInt(match[3])
        const newCount = parseInt(match[4]) || newLines

        totalDeletions += oldCount
        totalAdditions += newCount
      }
    }
  }

  return { additions: totalAdditions, deletions: totalDeletions }
}

export default function DiffViewer({ filePath, diffContent, isStaged, showSquiggles = true, onStage, onUnstage, onBack, onSaved }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('diff')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [modifiedContent, setModifiedContent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number }>({ additions: 0, deletions: 0 })

  const loadContents = useCallback(() => {
    if (diffContent) {
      const { original, modified } = parseDiffContent(diffContent)
      const stats = parseDiffStats(diffContent)
      setOriginalContent(original)
      setModifiedContent(modified)
      setDiffStats(stats)
    } else {
      setOriginalContent('')
      setModifiedContent('')
      setDiffStats({ additions: 0, deletions: 0 })
    }
  }, [diffContent])

  useEffect(() => {
    loadContents()
  }, [loadContents])

  const loadForEdit = useCallback(async () => {
    try {
      const result = await window.api.file.read(filePath)
      if (result.error) {
        setModifiedContent('')
      } else {
        setModifiedContent(result.content)
      }
    } catch (err) {
      setModifiedContent('')
    }
  }, [filePath])

  useEffect(() => {
    if (viewMode === 'edit') {
      loadForEdit()
    }
  }, [viewMode, loadForEdit])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.file.write(filePath, modifiedContent)
      if (onSaved) {
        await onSaved(filePath)
      }
    } catch (err) {
    }
    setSaving(false)
  }, [filePath, modifiedContent, onSaved])

  const handleSaveDiff = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.file.write(filePath, modifiedContent)
      if (onSaved) {
        await onSaved(filePath)
      }
    } catch (err) {
    }
    setSaving(false)
  }, [filePath, modifiedContent, onSaved])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault()
        if (viewMode === 'edit') {
          handleSave()
        } else if (viewMode === 'diff') {
          handleSaveDiff()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, handleSave, handleSaveDiff])

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
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true
    })
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: !showSquiggles,
      noSyntaxValidation: !showSquiggles
    })
  }

  return (
    <div className="flex flex-col border-t border-ide-border animate-fade-in">
      <div className="px-3 py-1.5 flex items-center justify-between bg-ide-hover/30 border-b border-ide-border shrink-0">
        <div className="flex items-center gap-2 text-sm">
          {onBack && (
            <button
              onClick={onBack}
              className="text-ide-text-muted hover:text-ide-text mr-2"
            >
              ← Back
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

        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('diff')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              viewMode === 'diff' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
            }`}
          >
            Diff
          </button>
          <button
            onClick={() => setViewMode('edit')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              viewMode === 'edit' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
            }`}
          >
            Edit
          </button>

          {!isStaged ? (
            <button
              onClick={() => onStage(filePath)}
              className="px-2 py-1 text-xs text-ide-success hover:bg-ide-success/10 rounded transition-colors"
            >
              + Stage
            </button>
          ) : (
            <button
              onClick={() => onUnstage(filePath)}
              className="px-2 py-1 text-xs text-ide-danger hover:bg-ide-danger/10 rounded transition-colors"
            >
              − Unstage
            </button>
          )}
        </div>
      </div>

      <div className="overflow-auto" style={{ height: 'calc(100vh - 80px)' }}>
        {viewMode === 'diff' ? (
          <DiffEditor
            height="100%"
            language={getLanguageFromFile(filePath)}
            theme="vs-dark"
            original={originalContent}
            modified={modifiedContent}
            options={{
              renderSideBySide: true,
              readOnly: false,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
              lineNumbers: 'on',
              wordWrap: 'on',
              renderIndicators: true
            }}
            beforeMount={configureMonaco}
          />
        ) : (
          <Editor
            height="100%"
            language={getLanguageFromFile(filePath)}
            theme="vs-dark"
            value={modifiedContent}
            onChange={(value) => setModifiedContent(value || '')}
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
          />
        )}
      </div>
    </div>
  )
}