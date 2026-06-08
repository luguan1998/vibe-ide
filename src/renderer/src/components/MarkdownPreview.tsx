import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownPreviewProps {
  fullPath: string
  fileName: string
  onBack?: () => void
}

function resolveImagePath(src: string, mdFullPath: string): string | null {
  if (!src) return null
  if (/^(https?:|data:|#)/i.test(src)) return null // external / data URL / anchor — not local
  const sep = mdFullPath.includes('\\') ? '\\' : '/'
  const dir = mdFullPath.substring(0, mdFullPath.lastIndexOf(sep))
  // Normalize: resolve relative path against md file directory
  const normalized = src.replace(/\\/g, '/')
  const parts = normalized.split('/')
  const resolved: string[] = dir.split(sep)
  for (const part of parts) {
    if (part === '..') { resolved.pop() }
    else if (part !== '.' && part !== '') { resolved.push(part) }
  }
  return resolved.join(sep)
}

const MarkdownPreview = React.memo(function MarkdownPreview({
  fullPath,
  fileName,
  onBack
}: MarkdownPreviewProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const localImageCache = useRef<Record<string, string>>({})

  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const href = e.currentTarget.getAttribute('href')
    if (!href) return
    if (href.startsWith('#')) {
      const el = contentRef.current?.querySelector(`[id="${href.slice(1)}"]`)
      el?.scrollIntoView({ behavior: 'smooth' })
    } else {
      window.open(href, '_blank')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    localImageCache.current = {}
    window.api.file.read(fullPath).then((result: any) => {
      if (cancelled) return
      if (result.error) {
        setError(result.error)
        setContent('')
      } else {
        setContent(typeof result === 'string' ? result : result.content || '')
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

  const handleImgLoad = useCallback(async (src: string, setSrc: (url: string) => void) => {
    const absPath = resolveImagePath(src, fullPath)
    if (!absPath) return // external/data URL — leave as-is
    const cache = localImageCache.current
    if (cache[absPath]) { setSrc(cache[absPath]); return }
    try {
      const result = await window.api.file.readBase64(absPath)
      if (result.dataUrl) {
        cache[absPath] = result.dataUrl
        setSrc(result.dataUrl)
      }
    } catch {}
  }, [fullPath])

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

      <div className="flex-1 overflow-auto p-6 bg-ide-bg">
        {loading && (
          <div className="flex items-center justify-center h-32 text-ide-text-muted">Loading...</div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32 text-ide-danger">{error}</div>
        )}
        {!loading && !error && (
          <div className="md-preview max-w-4xl mx-auto" ref={contentRef}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              a: ({ href, children, ...props }) => <a href={href} onClick={handleLinkClick} {...props}>{children}</a>,
              img: ({ src, alt, ...props }) => {
                const [imgSrc, setImgSrc] = useState(src)
                useEffect(() => {
                  if (src) handleImgLoad(src, setImgSrc)
                }, [src])
                return <img src={imgSrc} alt={alt} {...props} />
              }
            }}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
})

export default MarkdownPreview