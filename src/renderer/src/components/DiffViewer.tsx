import React, { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'

interface DiffViewerProps {
  filePath: string
  diffContent: string
  isStaged: boolean
  onStage: (path: string) => Promise<void>
  onUnstage: (path: string) => Promise<void>
  onBack?: () => void
}

type ViewMode = 'diff' | 'edit'

export default function DiffViewer({ filePath, diffContent, isStaged, onStage, onUnstage, onBack }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('diff')
  const [fileContent, setFileContent] = useState<string>('')
  const [modifiedContent, setModifiedContent] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Load original file content for editing
  const loadFileContent = useCallback(async () => {
    try {
      // Try to get the file content from git or from the actual file
      const result = await window.api.file.read(filePath)
      if (result.error) {
        setFileContent('')
      } else {
        setFileContent(result.content)
        setModifiedContent(result.content)
      }
    } catch (err) {
      setFileContent('')
      setModifiedContent('')
    }
  }, [filePath])

  // Load content when switching to edit mode
  useEffect(() => {
    if (viewMode === 'edit') {
      loadFileContent()
    }
  }, [viewMode, loadFileContent])

  // Save file content
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.file.write(filePath, modifiedContent)
      setFileContent(modifiedContent)
    } catch (err) {
      // Handle error silently
    }
    setSaving(false)
  }, [filePath, modifiedContent])

  // Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's' && viewMode === 'edit') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, handleSave])

  // Parse diff content for inline display
  const renderInlineDiff = () => {
    const lines = diffContent.split('\n')
    return (
      <div className="font-mono text-xs leading-5 overflow-auto">
        {lines.map((line, i) => {
          let className = 'text-ide-text-muted'
          if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
            className = 'text-ide-accent font-bold'
          } else if (line.startsWith('@@')) {
            className = 'text-ide-warning bg-ide-warning/10'
          } else if (line.startsWith('+') && !line.startsWith('+++')) {
            className = 'text-ide-success bg-ide-success/10'
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            className = 'text-ide-danger bg-ide-danger/10'
          }

          return (
            <div key={i} className={`${className} px-2 whitespace-pre`}>
              {line}
            </div>
          )
        })}
      </div>
    )
  }

  // Monaco diff editor view
  const renderMonacoDiff = () => {
    // Parse original and modified content from diff
    let originalContent = ''
    let modifiedContentStr = ''

    // Try to extract content from diff
    const lines = diffContent.split('\n')
    const originalLines: string[] = []
    const modifiedLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('-') && !line.startsWith('---') && !line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('@@')) {
        originalLines.push(line.substring(1))
      } else if (line.startsWith('+') && !line.startsWith('+++') && !line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('@@')) {
        modifiedLines.push(line.substring(1))
      } else if (!line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('@@') && !line.startsWith('-') && !line.startsWith('+')) {
        // Context line
        originalLines.push(line)
        modifiedLines.push(line)
      }
    }

    // If we can't parse diff properly, use file content as original
    originalContent = fileContent || originalLines.join('\n')
    modifiedContentStr = modifiedLines.join('\n') || fileContent

    return (
      <Editor
        height="100%"
        language={getLanguageFromFile(filePath)}
        theme="vs-dark"
        options={{
          renderSideBySide: true,
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineNumbers: 'on',
          contextmenu: false,
          folding: false,
          wordWrap: 'on'
        }}
        original={originalContent}
        modified={modifiedContentStr}
        diffEditor={true}
      />
    )
  }

  // Monaco edit view
  const renderEditor = () => {
    return (
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
      />
    )
  }

  // Detect language from file extension
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

  return (
    <div className="flex flex-col border-t border-ide-border animate-fade-in">
      {/* Diff Header */}
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
          <span className="text-ide-text font-medium truncate max-w-[200px]">{filePath}</span>
          {isStaged && <span className="text-xs text-ide-success">staged</span>}
        </div>

        <div className="flex items-center gap-1">
          {/* View mode toggle */}
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

          {/* Stage/Unstage buttons */}
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

      {/* Content */}
      <div className="overflow-auto" style={{ height: 'calc(100vh - 80px)' }}>
        {viewMode === 'diff' ? renderInlineDiff() : renderEditor()}
      </div>
    </div>
  )
}