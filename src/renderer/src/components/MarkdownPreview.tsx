import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStableCodeOverrides } from './MarkdownCodeBlock'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
import { type Frontmatter, parseFrontmatter } from '@renderer/utils/frontmatter'

interface MarkdownPreviewProps {
  fullPath: string
  fileName: string
  onBack?: () => void
  scrollToHeading?: string
  searchTrigger?: number
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

interface TextMatch { node: Text; start: number; end: number }

// Walk every text node under `root`, collecting case-insensitive matches.
// Skips <script>/<style> and mermaid <svg> subtrees (SVG mark breaks rendering).
function collectTextMatches(root: Node, qLower: string): TextMatch[] {
  const matches: TextMatch[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
      if (parent.closest('svg')) return NodeFilter.FILTER_REJECT
      const text = node.nodeValue || ''
      return text.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  let textNode: Text | null
  while ((textNode = walker.nextNode() as Text | null)) {
    const text = textNode.nodeValue || ''
    const lower = text.toLowerCase()
    let from = 0
    let idx = lower.indexOf(qLower, from)
    while (idx !== -1) {
      matches.push({ node: textNode, start: idx, end: idx + qLower.length })
      from = idx + qLower.length
      idx = lower.indexOf(qLower, from)
    }
  }
  return matches
}

// Restore the DOM by unwrapping every mark back into its original text,
// then normalize() to merge adjacent text nodes (keeps React's vdom aligned).
function clearMarks(marks: HTMLElement[]): void {
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    mark.replaceWith(document.createTextNode(mark.textContent || ''))
    parent.normalize()
  }
}

// Wrap each match in <mark>, current item gets an extra class.
// Per-node from-back-to-front so earlier offsets stay valid after splits.
function applyMarks(matches: TextMatch[], currentIdx: number): HTMLElement[] {
  const marks: HTMLElement[] = []
  const byNode = new Map<Text, { start: number; end: number; gi: number }[]>()
  matches.forEach((m, gi) => {
    let list = byNode.get(m.node)
    if (!list) { list = []; byNode.set(m.node, list) }
    list.push({ start: m.start, end: m.end, gi })
  })
  byNode.forEach((list, node) => {
    list.sort((a, b) => b.start - a.start)
    for (const { start, end, gi } of list) {
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      const mark = document.createElement('mark')
      mark.className = 'md-search-match' + (gi === currentIdx ? ' md-search-match-current' : '')
      range.surroundContents(mark)
      marks[gi] = mark
    }
  })
  return marks
}

const MarkdownPreview = React.memo(function MarkdownPreview({
  fullPath,
  fileName,
  onBack,
  scrollToHeading,
  searchTrigger
}: MarkdownPreviewProps) {
  const [content, setContent] = useState('')
  const [frontmatter, setFrontmatter] = useState<Frontmatter | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // in-page search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const marksRef = useRef<HTMLElement[]>([])
  const searchOpenRef = useRef(false)
  searchOpenRef.current = searchOpen
  // 用 ref 同步 query/matchIndex：onColorized 路径直接操作 DOM 重新高亮（不 set React state）。
  // 否则 colorize 完成 → setMatchCount/重渲染 → components.code 引用变 → CodeBlock remount
  // → 又触发 colorize → onColorized … 无限重渲染，页面卡死。
  const queryRef = useRef('')
  const matchIndexRef = useRef(0)
  queryRef.current = query
  matchIndexRef.current = matchIndex

  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    if (window.getSelection()?.toString().trim()) return
    const href = e.currentTarget.getAttribute('href')
    if (!href) return
    if (href.startsWith('#')) {
      const el = contentRef.current?.querySelector(`[id="${href.slice(1)}"]`)
      el?.scrollIntoView({ behavior: 'smooth' })
    } else {
      window.open(href, '_blank')
    }
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
    setMatchIndex(0)
  }, [])

  // Re-run highlight + count whenever query / current index / content / open state changes.
  // 在 contentRef DOM 上重新收集并高亮。updateCount=false 时不 setMatchCount（用于 onColorized：
  // colorize 后只补 mark，避免触发重渲染造成 components 重建 → CodeBlock remount → 死循环）。
  const refreshHighlight = useCallback((updateCount: boolean, scroll: boolean) => {
    const root = contentRef.current
    if (!root) return
    clearMarks(marksRef.current)
    marksRef.current = []
    const q = queryRef.current.trim()
    if (!q) { if (updateCount) setMatchCount(0); return }
    const matches = collectTextMatches(root, q.toLowerCase())
    const cur = matches.length > 0 ? ((matchIndexRef.current % matches.length) + matches.length) % matches.length : 0
    const marks = applyMarks(matches, cur)
    marksRef.current = marks
    if (updateCount) setMatchCount(matches.length)
    if (scroll) marks[cur]?.scrollIntoView({ block: 'center' })
  }, [])

  const runSearch = useCallback(() => {
    refreshHighlight(true, true)
  }, [refreshHighlight])

  // 回调与 overrides 都 memoize：保证 components.code 引用稳定，CodeBlock 不会因
  // MarkdownPreview 重渲染而 remount → 不反复 colorize（fallback↔HTML 闪烁、mark 反复丢失）。
  const handleColorized = useCallback(() => refreshHighlight(false, false), [refreshHighlight])
  const codeOverrides = useStableCodeOverrides(handleColorized)
  // 整个 components + remarkPlugins 都 memoize：MarkdownPreview 每次重渲染时引用不变，
  // ReactMarkdown 不重渲染子树 → CodeBlock/h1/img 都不 remount → 无 colorize 闪烁、图片不重载。
  const remarkPlugins = useMemo(() => [remarkGfm], [])
  const mdComponents = useMemo(() => ({
    ...codeOverrides,
    h1: ({ children }: any) => { const text = extractText(children); return <h1 id={slugify(text)}>{children}</h1> },
    h2: ({ children }: any) => { const text = extractText(children); return <h2 id={slugify(text)}>{children}</h2> },
    h3: ({ children }: any) => { const text = extractText(children); return <h3 id={slugify(text)}>{children}</h3> },
    h4: ({ children }: any) => { const text = extractText(children); return <h4 id={slugify(text)}>{children}</h4> },
    h5: ({ children }: any) => { const text = extractText(children); return <h5 id={slugify(text)}>{children}</h5> },
    h6: ({ children }: any) => { const text = extractText(children); return <h6 id={slugify(text)}>{children}</h6> },
    a: ({ href, children, ...props }: any) => <a href={href} onClick={handleLinkClick} {...props}>{children}</a>,
    img: ({ src, alt, ...props }: any) => {
      const resolvedSrc = useMemo(() => {
        if (!src || /^(https?:|data:|#)/i.test(src)) return src
        const absPath = resolveImagePath(src, fullPath)
        if (!absPath) return src
        const sep = absPath.includes('\\') ? '\\' : '/'
        const parts = absPath.split(sep)
        return 'file:///' + parts.map(p => encodeURIComponent(p)).join('/')
      }, [src, fullPath])
      return <img src={resolvedSrc} alt={alt} {...props} />
    }
  }), [codeOverrides, handleLinkClick, fullPath])

  // Ctrl+F trigger from App.tsx → open search bar.
  // First-open focus is handled by the searchOpen effect below; if the bar
  // is already open, re-focus + select so the user can retype immediately.
  useEffect(() => {
    if (searchTrigger === undefined || searchTrigger === 0) return
    setSearchOpen(true)
    const el = searchInputRef.current
    if (el) { el.focus(); el.select() }
  }, [searchTrigger])

  // Focus the input right after the bar mounts (searchOpen just turned true),
  // so the keyboard can type into it without an extra click.
  useEffect(() => {
    if (!searchOpen) return
    const el = searchInputRef.current
    if (el) { el.focus(); el.select() }
  }, [searchOpen])

  useEffect(() => {
    runSearch()
  }, [runSearch, content, searchOpen, query, matchIndex])

  // Scroll to heading when outline triggers navigation
  useEffect(() => {
    if (!scrollToHeading || !contentRef.current) return
    const id = slugify(scrollToHeading)
    const el = contentRef.current.querySelector(`[id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth' })
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
        setFrontmatter(null)
      } else {
        const raw = typeof result === 'string' ? result : result.content || ''
        const { meta, body } = parseFrontmatter(raw)
        setFrontmatter(meta)
        setContent(body)
      }
      setLoading(false)
    }).catch((err: any) => {
      if (!cancelled) {
        setError(String(err))
        setFrontmatter(null)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [fullPath])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // ① search bar open → close it (do not close the preview)
      if (searchOpenRef.current) {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeSearch()
        return
      }
      // ② otherwise → close preview (existing behavior)
      if (!onBack) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onBack()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onBack, closeSearch])

  const lastSep = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
          const dirPart = lastSep >= 0 ? fullPath.substring(0, lastSep + 1) : ''
          const namePart = lastSep >= 0 ? fullPath.substring(lastSep + 1) : fullPath
          return (
            <div className="flex flex-col h-full animate-fade-in relative">
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
            <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {searchOpen && (
        <div className="absolute top-12 right-3 z-20 flex items-center gap-1 p-1.5 bg-ide-sidebar border border-ide-border rounded-md shadow-lg">
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setMatchIndex(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (matchCount > 0) setMatchIndex(i => (i + (e.shiftKey ? -1 : 1) + matchCount) % matchCount)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                closeSearch()
              }
            }}
            placeholder="查找..."
            className="w-40 px-2 py-1 text-sm bg-ide-bg border border-ide-border rounded text-ide-text outline-none focus:border-ide-accent"
          />
          <span className="text-xs text-ide-text-muted tabular-nums w-12 text-center">
            {matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : '0/0'}
          </span>
          <button
            onClick={() => matchCount > 0 && setMatchIndex(i => (i - 1 + matchCount) % matchCount)}
            disabled={matchCount === 0}
            className="w-6 h-6 flex items-center justify-center rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-sm"
            title="上一个 (Shift+Enter)"
          >↑</button>
          <button
            onClick={() => matchCount > 0 && setMatchIndex(i => (i + 1) % matchCount)}
            disabled={matchCount === 0}
            className="w-6 h-6 flex items-center justify-center rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-sm"
            title="下一个 (Enter)"
          >↓</button>
          <button
            onClick={closeSearch}
            className="w-6 h-6 flex items-center justify-center rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors text-sm"
            title="关闭 (Esc)"
          >×</button>
        </div>
      )}
    </div>
  )
})

export default MarkdownPreview
