import React, { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ADD_ANNOTATION_EVENT, toRelPath } from './vibeEvents'
import { toFileUrl } from '../utils/filePathUtils'

interface ImagePreviewProps {
  fullPath: string
  fileName: string
  onDismiss?: () => void
  brushActive?: boolean
  headerLeading?: ReactNode
}

const ImagePreview = React.memo(function ImagePreview({
  fullPath,
  fileName,
  onDismiss,
  brushActive = false,
  headerLeading
}: ImagePreviewProps) {
  const [imgSrc] = useState(() => toFileUrl(fullPath))
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!onDismiss) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!containerRef.current?.offsetParent) return
        e.preventDefault()
        e.stopImmediatePropagation()
        onDismiss()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onDismiss])

  return (
        <div ref={containerRef} className={`flex flex-col h-full animate-fade-in center-overlay image-preview${brushActive ? ' diff-brush-mode' : ''}`}>
          <div className="h-8 px-3 flex items-center justify-between gap-2 bg-ide-sidebar border-b border-ide-border shrink-0"
            onClick={(e) => {
              if (!brushActive) return
              e.preventDefault()
              e.stopPropagation()
              const rel = toRelPath(fullPath, null)
              window.dispatchEvent(new CustomEvent(ADD_ANNOTATION_EVENT, { detail: { rel: rel || fileName } }))
            }}>
            {headerLeading}
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