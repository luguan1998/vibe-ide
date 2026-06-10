import React, { useState, useEffect } from 'react'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'

interface ImagePreviewProps {
  fullPath: string
  fileName: string
  onBack?: () => void
}

function toFileUrl(localPath: string): string {
  const sep = localPath.includes('\\') ? '\\' : '/'
  const parts = localPath.split(sep)
  return 'file:///' + parts.map(p => encodeURIComponent(p)).join('/')
}

const ImagePreview = React.memo(function ImagePreview({
  fullPath,
  fileName,
  onBack
}: ImagePreviewProps) {
  const [imgSrc] = useState(() => toFileUrl(fullPath))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!onBack) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onBack])

  const lastSep = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
      const dirPart = lastSep >= 0 ? fullPath.substring(0, lastSep + 1) : ''
      const namePart = lastSep >= 0 ? fullPath.substring(lastSep + 1) : fullPath
      return (
        <div className="flex flex-col h-full animate-fade-in">
          <div className="h-10 px-3 flex items-center justify-between bg-ide-sidebar border-b border-ide-border shrink-0">
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              {onBack && (
                <button
                  onClick={onBack}
                  className="w-6 h-6 mr-1 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors shrink-0"
                  title="Esc"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3.5 h-3.5">
                    <polyline points="15 4 7 12 15 20" />
                  </svg>
                </button>
              )}
              {(() => { const info = getFileInfo(namePart); return <svg viewBox="0 0 16 16" fill="currentColor" className={`w-4 h-4 shrink-0 ${info.color}`} dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />; })()}
              <span className="text-ide-text font-medium">{namePart}</span>{dirPart && <span className="text-[11px] text-ide-text-muted/50"> {dirPart}</span>}
            </div>
            <div className="flex items-center rounded-md bg-ide-hover overflow-hidden shrink-0">
              <span className="px-2.5 py-1 text-xs bg-ide-accent/15 text-ide-accent">View</span>
            </div>
          </div>

      <div className="flex-1 overflow-auto flex items-center justify-center p-6 bg-ide-bg">
        {error && (
          <div className="flex items-center justify-center h-32 text-ide-danger">{error}</div>
        )}
        {!error && (
          <img
            src={imgSrc}
            alt={fileName}
            className="max-w-full max-h-full object-contain"
            onError={() => setError('Failed to load image')}
          />
        )}
      </div>
    </div>
  )
})

export default ImagePreview