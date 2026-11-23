import React, { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toFileUrl } from '../utils/filePathUtils'

interface PdfPreviewProps {
  fullPath: string
  fileName: string
  onDismiss?: () => void
  headerLeading?: ReactNode
}

const PdfPreview = React.memo(function PdfPreview({
  fullPath,
  fileName,
  onDismiss,
  headerLeading
}: PdfPreviewProps) {
  const [src] = useState(() => toFileUrl(fullPath))
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!onDismiss) return
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'escape') return
      if (!containerRef.current?.offsetParent) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onDismiss()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onDismiss])

  return (
    <div ref={containerRef} className="flex flex-col h-full animate-fade-in">
      <div className="h-8 px-3 flex items-center justify-between gap-2 bg-ide-sidebar border-b border-ide-border shrink-0">
        {headerLeading}
      </div>
      <iframe src={src} title={fileName} className="flex-1 w-full border-0 bg-ide-bg" />
    </div>
  )
})

export default PdfPreview
