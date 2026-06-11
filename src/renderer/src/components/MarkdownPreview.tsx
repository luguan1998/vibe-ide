import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getMarkdownCodeOverrides } from './MarkdownCodeBlock'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'


interface MarkdownPreviewProps {
  fullPath: string
  fileName: string
  onBack?: () => void
  scrollToHeading?: string
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '')
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (React.isValidElement(children) && children.props.children) return extractText(children.props.children)
  return ''
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
  onBack,
  scrollToHeading
}: MarkdownPreviewProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

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

  // Scroll to heading when outline triggers navigation
  useEffect(() => {
    if (!scrollToHeading || !contentRef.current) return
    const id = slugify(scrollToHeading)
    const el = contentRef.current.querySelector(`[id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollToHeading])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
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
        e.stopImmediatePropagation()
        onBack()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onBack])

  const handleImgLoad = useCallback((src: string, setSrc: (url: string) => void) => {
    const absPath = resolveImagePath(src, fullPath)
    if (!absPath) return
    const sep = absPath.includes('\\') ? '\\' : '/'
    const parts = absPath.split(sep)
    const fileUrl = 'file:///' + parts.map(p => encodeURIComponent(p)).join('/')
    setSrc(fileUrl)
  }, [fullPath])

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
              ...getMarkdownCodeOverrides(),
              h1: ({ children }) => { const text = extractText(children); return <h1 id={slugify(text)}>{children}</h1> },
              h2: ({ children }) => { const text = extractText(children); return <h2 id={slugify(text)}>{children}</h2> },
              h3: ({ children }) => { const text = extractText(children); return <h3 id={slugify(text)}>{children}</h3> },
              h4: ({ children }) => { const text = extractText(children); return <h4 id={slugify(text)}>{children}</h4> },
              h5: ({ children }) => { const text = extractText(children); return <h5 id={slugify(text)}>{children}</h5> },
              h6: ({ children }) => { const text = extractText(children); return <h6 id={slugify(text)}>{children}</h6> },
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