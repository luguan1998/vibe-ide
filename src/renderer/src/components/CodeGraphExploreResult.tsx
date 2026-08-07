import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStableCodeOverrides } from './MarkdownCodeBlock'
import { parseFrontmatter } from '@renderer/utils/frontmatter'

interface Props {
  query: string
  content: string
  onClose: () => void
}

function CodeGraphExploreResult({ query, content, onClose }: Props) {
  const { meta: frontmatter, body: mdBody } = parseFrontmatter(content)
  const contentRef = useRef<HTMLDivElement>(null)
  const codeOverrides = useStableCodeOverrides()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        const el = contentRef.current?.parentElement // overflow-auto container
        if (el) el.scrollBy({ top: e.key === 'PageUp' ? -el.clientHeight * 0.85 : el.clientHeight * 0.85 })
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [onClose])

  const title = query.length > 40 ? query.slice(0, 40) + '...' : query

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in"
      onClick={onClose}>
      <div className="bg-ide-sidebar border border-ide-border rounded-lg shadow-2xl flex flex-col"
        style={{ width: '80vw', maxWidth: 960, maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="h-10 px-3 flex items-center justify-between border-b border-ide-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-accent shrink-0">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="text-sm text-ide-text font-medium truncate">Explore: {title}</span>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors shrink-0"
            title="Esc">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-ide-bg">
          <div className="md-preview max-w-4xl mx-auto" ref={contentRef}>
            {frontmatter && (
              <div className="md-frontmatter mb-6">
                {Object.entries(frontmatter).map(([key, val]) => (
                  <div key={key} className="md-fm-row">
                    <span className="md-fm-key">{key}</span>
                    <span className="md-fm-val">
                      {Array.isArray(val) ? val.join(', ') : val}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeOverrides}>
              {mdBody}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

export { CodeGraphExploreResult }