import React, { useState, useEffect, useCallback } from 'react'

interface ImagePreviewProps {
  fullPath: string
  fileName: string
  onBack?: () => void
}

const ImagePreview = React.memo(function ImagePreview({
  fullPath,
  fileName,
  onBack
}: ImagePreviewProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api.file.readBase64(fullPath).then((result: any) => {
      if (cancelled) return
      if (result.error) {
        setError(result.error)
        setImgSrc(null)
      } else {
        setImgSrc(result.dataUrl)
      }
      setLoading(false)
    }).catch((err: any) => {
      if (!cancelled) {
        setError(String(err))
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [fullPath])

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
            <div className="flex items-center text-sm min-w-0">
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
              {dirPart && <span className="text-ide-text-muted/50">{dirPart}</span>}
              <span className="text-ide-text font-medium">{namePart}</span>
            </div>
            <div className="flex items-center rounded-md bg-ide-hover overflow-hidden shrink-0">
              <span className="px-2.5 py-1 text-xs bg-ide-accent/15 text-ide-accent">View</span>
            </div>
          </div>

      <div className="flex-1 overflow-auto flex items-center justify-center p-6 bg-ide-bg">
        {loading && (
          <div className="flex items-center justify-center h-32 text-ide-text-muted">Loading...</div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32 text-ide-danger">{error}</div>
        )}
        {!loading && !error && imgSrc && (
          <img
            src={imgSrc}
            alt={fileName}
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>
    </div>
  )
})

export default ImagePreview