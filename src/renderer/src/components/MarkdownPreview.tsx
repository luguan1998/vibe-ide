import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { FileDown } from 'lucide-react'
import { useStableCodeOverrides } from './MarkdownCodeBlock'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
import { type Frontmatter } from '@renderer/utils/frontmatter'
import { useAdaptiveMenuPos } from '@renderer/utils/useAdaptiveMenuPos'
import { ADD_ANNOTATION_EVENT, toRelPath } from './vibeEvents'
import OutlineTrigger from './OutlineTrigger'

export const MD_SEARCH_OPEN = 'md-search-open'

interface MarkdownPreviewProps {
  fullPath: string
  fileName: string
  onBack?: () => void
  scrollToHeading?: string
  brushActive?: boolean
  outlineEnabled?: boolean
  onToggleOutline?: () => void
  onOutlineNavigate?: (line: number, headingName?: string) => void
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

interface BlockInfo {
  start: number
  end: number
  source: string
}

function locateBody(raw: string): { meta: Frontmatter | null; body: string; bodyStart: number } {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) return { meta: null, body: raw, bodyStart: 0 }
  const leadWs = raw.length - trimmed.length
  const second = trimmed.indexOf('---', 3)
  if (second === -1) return { meta: null, body: raw, bodyStart: 0 }
  const fmBlock = trimmed.slice(3, second)
  const bodyRaw = trimmed.slice(second + 3)
  const bodyStart = leadWs + second + 3
  const meta: Frontmatter = {}
  for (const line of fmBlock.split('\n')) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue
    const ci = trimmedLine.indexOf(':')
    if (ci === -1) continue
    const key = trimmedLine.slice(0, ci).trim()
    const rawVal = trimmedLine.slice(ci + 1).trim()
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      meta[key] = rawVal.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''))
    } else {
      meta[key] = rawVal.replace(/^['"]|['"]$/g, '')
    }
  }
  return { meta: Object.keys(meta).length > 0 ? meta : null, body: bodyRaw, bodyStart }
}

function serializeFrontmatterKey(key: string, val: string | string[]): string {
  if (Array.isArray(val)) return `${key}: [${val.map((v: string) => `'${v}'`).join(', ')}]`
  return `${key}: ${val}`
}

function serializeFrontmatter(fm: Frontmatter): string {
  return Object.entries(fm).map(([k, v]) => serializeFrontmatterKey(k, v)).join('\n')
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
  brushActive = false,
  outlineEnabled,
  onToggleOutline,
  onOutlineNavigate
}: MarkdownPreviewProps) {
  const [rawContent, setRawContent] = useState('')
  const [bodyStart, setBodyStart] = useState(0)
  const [frontmatter, setFrontmatter] = useState<Frontmatter | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [editingBlock, setEditingBlock] = useState<{ start: number; end: number; rect: { top: number; left: number; width: number } } | null>(null)
  const [savedRawContent, setSavedRawContent] = useState('')
  const isDirty = rawContent !== savedRawContent
  const editingBlockRef = useRef(editingBlock)
  editingBlockRef.current = editingBlock
  const pendingValueRef = useRef('')

  const body = useMemo(() => rawContent.slice(bodyStart), [rawContent, bodyStart])

  const blocks = useMemo<BlockInfo[]>(() => {
    if (!body) return []
    try {
      const root = unified().use(remarkParse).parse(body)
      return (root.children || []).map((node: any) => ({
        start: node.position?.start?.offset ?? 0,
        end: node.position?.end?.offset ?? 0,
        source: body.slice(node.position?.start?.offset ?? 0, node.position?.end?.offset ?? 0)
      }))
    } catch {
      return []
    }
  }, [body])

  const handleBlockDoubleClick = useCallback((block: BlockInfo, e: React.MouseEvent) => {
    if (editingBlockRef.current) return
    const el = e.currentTarget as HTMLElement
    const scrollContainer = scrollRef.current
    const containerRect = scrollContainer?.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    pendingValueRef.current = block.source
    setEditingBlock({
      start: block.start,
      end: block.end,
      rect: {
        top: elRect.top - containerRect.top + (scrollContainer?.scrollTop ?? 0),
        left: elRect.left - containerRect.left,
        width: elRect.width
      }
    })
  }, [])

  const handleBrushClick = useCallback((e: React.MouseEvent) => {
    if (!brushActive) return
    const target = e.target as HTMLElement
    if (target.closest('a, pre')) return
    if (window.getSelection()?.toString().trim()) return
    e.preventDefault()
    e.stopPropagation()

    const wrapper = (target as HTMLElement).closest('.md-block') as HTMLElement | null
    const idx = wrapper ? parseInt(wrapper.getAttribute('data-block-idx') || '', 10) : -1
    const snippet = ((target as HTMLElement).textContent || '').trim().slice(0, 80)
    let heading: string | null = null
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        const src = blocks[i].source.trimStart()
        if (/^#{1,6}\s/.test(src)) {
          heading = src.replace(/^#{1,6}\s+/, '').split('\n')[0].trim()
          break
        }
      }
    }

    const ref = heading ? `**${heading}** "${snippet}"` : `"${snippet}"`
    window.dispatchEvent(new CustomEvent(ADD_ANNOTATION_EVENT, { detail: { rel: `${fileName} ${ref}` } }))
  }, [brushActive, blocks, fullPath, fileName])

  const handleBlockSave = useCallback(() => {
    if (!editingBlock) return
    const newValue = pendingValueRef.current
    const absStart = bodyStart + editingBlock.start
    const absEnd = bodyStart + editingBlock.end
    const original = rawContent.slice(absStart, absEnd)
    const crlf = original.includes('\r\n')
    const normalized = crlf ? newValue.replace(/\n/g, '\r\n') : newValue
    setRawContent(prev => prev.slice(0, absStart) + normalized + prev.slice(absEnd))
    setEditingBlock(null)
  }, [editingBlock, bodyStart, rawContent])

  const handleBlockCancel = useCallback(() => {
    setEditingBlock(null)
  }, [])

  const handleBlockSaveRef = useRef(handleBlockSave)
  handleBlockSaveRef.current = handleBlockSave
  const handleBlockCancelRef = useRef(handleBlockCancel)
  handleBlockCancelRef.current = handleBlockCancel

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!editingBlockRef.current) return
      if (e.ctrlKey && e.key.toLowerCase() === 'enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleBlockSaveRef.current()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleBlockCancelRef.current()
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 's') return
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  const editContainerRef = useRef<HTMLDivElement>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editingBlock || !editTextareaRef.current) return
    const el = editTextareaRef.current
    el.value = blocks.find(b => b.start === editingBlock.start)?.source || ''
    pendingValueRef.current = el.value
    el.style.height = 'auto'
    el.style.height = `${Math.max(60, el.scrollHeight)}px`
    el.focus()
  }, [editingBlock, blocks])

  useEffect(() => {
    if (!editingBlock) return
    const handler = (e: MouseEvent) => {
      if (editContainerRef.current?.contains(e.target as Node)) return
      handleBlockSave()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [editingBlock, handleBlockSave])

  const handleSaveFile = useCallback(async () => {
    if (!isDirty) return
    await window.api.file.write(fullPath, rawContent)
    setSavedRawContent(rawContent)
  }, [isDirty, fullPath, rawContent])

  const handleSaveFileRef = useRef(handleSaveFile)
  handleSaveFileRef.current = handleSaveFile

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 's') return
      if (editingBlockRef.current) return
      if (!containerRef.current?.offsetParent) return
      e.preventDefault()
      handleSaveFileRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null)
  const exportMenuRef = useRef(false)
  exportMenuRef.current = !!exportMenu
  const [exportStatus, setExportStatus] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [exporting, setExporting] = useState(false)
  const exportStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exportMenuPos = useAdaptiveMenuPos(!!exportMenu, exportMenu?.x ?? 0, exportMenu?.y ?? 0)

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
    a: ({ href, children, ...props }: any) => <a href={href} onClick={handleLinkClick} onAuxClick={handleLinkClick} {...props}>{children}</a>,
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

  const collectExportCss = useCallback((): string => {
    let css = ''
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null
      try { rules = sheet.cssRules } catch { continue }
      if (!rules) continue
      for (let i = 0; i < rules.length; i++) css += rules[i].cssText + '\n'
    }
    return css
  }, [])

  const buildExportHtml = useCallback((): string => {
    const root = contentRef.current
    if (!root) return ''
    const clone = root.cloneNode(true) as HTMLElement
    clone.querySelectorAll('mark.md-search-match').forEach(m => {
      m.replaceWith(document.createTextNode(m.textContent || ''))
    })
    const headings: { id: string; level: number; text: string }[] = []
    clone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      const el = h as HTMLElement
      const id = el.getAttribute('id')
      if (!id) return
      headings.push({ id, level: parseInt(el.tagName.substring(1), 10), text: el.textContent || '' })
    })
    const toc = headings.length > 0
      ? `<aside class="md-export-toc"><nav>${headings.map(h =>
          `<a class="md-toc-item md-toc-l${h.level}" href="#${h.id}" style="padding-left:${(h.level - 1) * 14 + 12}px">${escapeHtml(h.text)}</a>`
        ).join('')}</nav></aside>`
      : ''
    const title = fileName.replace(/\.md$/i, '') || 'export'
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${collectExportCss()}
:root { ${document.documentElement.style.cssText} }
html, body { height: auto !important; max-height: none !important; overflow: visible !important; }
body { background: rgb(var(--ide-bg)); color: rgb(var(--ide-text)); margin: 0; padding: 0; box-sizing: border-box; min-height: 100vh; }
.md-export-layout { display: flex; align-items: flex-start; }
.md-export-toc { position: sticky; top: 0; align-self: flex-start; width: 240px; flex-shrink: 0; max-height: 100vh; overflow-y: auto; padding: 16px 10px; border-right: 1px solid rgb(var(--ide-border)); background: rgb(var(--ide-sidebar)); }
.md-export-content { flex: 1 1 0; min-width: 0; padding: 24px calc(240px + 24px) 24px 24px; }
.md-toc-item { display: block; color: rgb(var(--ide-text-muted)); text-decoration: none; font-size: 13px; line-height: 1.6; padding-top: 2px; padding-bottom: 2px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.md-toc-item:hover { color: rgb(var(--ide-accent)); background: rgb(var(--ide-hover)); }
.md-toc-l1 { font-weight: 600; color: rgb(var(--ide-text)); }
</style>
</head>
<body>
<div class="md-export-layout">
${toc}
<main class="md-export-content">
<div class="md-preview max-w-4xl mx-auto">
${clone.innerHTML}
</div>
</main>
</div>
</body>
</html>`
  }, [collectExportCss, fileName])

  const getExportDefaultName = useCallback((): string => {
    const base = fileName.replace(/\.[^.]+$/, '') || 'export'
    return base + '.html'
  }, [fileName])

  const handleExportHtml = useCallback(async () => {
    setExportMenu(null)
    if (exporting) return
    setExporting(true)
    try {
      const html = buildExportHtml()
      if (!html) {
        setExportStatus({ text: '无可导出内容', type: 'error' })
        return
      }
      const dirResult = await window.api.workspace.pickDir()
      if (dirResult.canceled) return
      const dir = dirResult.path
      const sep = dir.includes('\\') ? '\\' : '/'
      const outPath = dir + sep + getExportDefaultName()
      const result = await window.api.file.write(outPath, html)
      if (result?.error) {
        setExportStatus({ text: '导出失败: ' + result.error, type: 'error' })
      } else {
        setExportStatus({ text: '已导出: ' + outPath, type: 'success' })
      }
    } catch (err: any) {
      setExportStatus({ text: '导出失败: ' + String(err?.message || err), type: 'error' })
    } finally {
      setExporting(false)
      if (exportStatusTimerRef.current) clearTimeout(exportStatusTimerRef.current)
      exportStatusTimerRef.current = setTimeout(() => setExportStatus(null), 3000)
    }
  }, [exporting, buildExportHtml, getExportDefaultName])

  // Ctrl+F 从 App.tsx 派发瞬时事件 → 开搜索栏。事件不累积、mount 不重放，
  // 新开的 md 天然不弹。已开时直接 focus+select 便于重输；首次开 input 未挂载，
  // 靠下面 [searchOpen] effect 兜底聚焦。
  useEffect(() => {
    const open = () => {
      setSearchOpen(true)
      const el = searchInputRef.current
      if (el) { el.focus(); el.select() }
    }
    window.addEventListener(MD_SEARCH_OPEN, open)
    return () => window.removeEventListener(MD_SEARCH_OPEN, open)
  }, [])

  // Focus the input right after the bar mounts (searchOpen just turned true),
  // so the keyboard can type into it without an extra click.
  useEffect(() => {
    if (!searchOpen) return
    const el = searchInputRef.current
    if (el) { el.focus(); el.select() }
  }, [searchOpen])

  useEffect(() => {
    runSearch()
  }, [runSearch, body, searchOpen, query, matchIndex])

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
    setEditingBlock(null)
    window.api.file.read(fullPath).then((result: any) => {
      if (cancelled) return
      if (result.error) {
        setError(result.error)
        setRawContent('')
        setFrontmatter(null)
        setBodyStart(0)
      } else {
        const raw = typeof result === 'string' ? result : result.content || ''
        const { meta, body, bodyStart: bs } = locateBody(raw)
        setFrontmatter(meta)
        setRawContent(raw)
        setBodyStart(bs)
        setSavedRawContent(raw)
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
      if (exportMenuRef.current) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setExportMenu(null)
        return
      }
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

  useEffect(() => {
    if (!exportMenu) return
    const close = () => setExportMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [exportMenu])

  useEffect(() => () => {
    if (exportStatusTimerRef.current) clearTimeout(exportStatusTimerRef.current)
  }, [])

  const lastSep = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
          const dirPart = lastSep >= 0 ? fullPath.substring(0, lastSep + 1) : ''
          const namePart = lastSep >= 0 ? fullPath.substring(lastSep + 1) : fullPath
          return (
            <div className={`flex flex-col h-full animate-fade-in relative center-overlay${brushActive ? ' diff-brush-mode' : ''}`} ref={containerRef}>
              <div className="h-10 px-3 flex items-center justify-between bg-ide-sidebar border-b border-ide-border shrink-0" title="Ctrl+L 切换编辑模式 · 双击段落进入编辑"
                onClick={(e) => {
                  if (!brushActive) return
                  e.preventDefault()
                  e.stopPropagation()
                  window.dispatchEvent(new CustomEvent(ADD_ANNOTATION_EVENT, { detail: { rel: fileName } }))
                }}>
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
                <div className="flex items-center gap-2 shrink-0">
                  {isDirty && (
                    <span className="text-[10px] text-ide-warning font-medium">● 未保存</span>
                  )}
                  <div
                    className="flex items-center rounded-md bg-ide-hover overflow-hidden shrink-0 cursor-context-menu select-none"
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setExportMenu({ x: e.clientX, y: e.clientY })
                    }}
                  >
                                          <span className="px-2.5 py-1 text-xs bg-ide-accent/15 text-ide-accent">View</span>
                  </div>
                  {onToggleOutline && (
                    <OutlineTrigger
                      outlineEnabled={outlineEnabled}
                      onToggle={onToggleOutline}
                      filePath={fileName}
                      fullPath={fullPath}
                      onNavigate={onOutlineNavigate}
                    />
                  )}
                </div>
              </div>
      <div className="flex-1 overflow-auto p-6 bg-ide-bg relative" ref={scrollRef}>
        {loading && (
          <div className="flex items-center justify-center h-32 text-ide-text-muted">Loading...</div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32 text-ide-danger">{error}</div>
        )}
        {!loading && !error && (
          <div className="md-preview max-w-4xl mx-auto relative" ref={contentRef} onClickCapture={handleBrushClick}>
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
            {blocks.length > 0 ? (
              blocks.map((block, i) => (
                <div
                  key={i}
                  className="md-block group hover:bg-ide-hover/30 rounded transition-colors -ml-1 -mr-1 px-1"
                  data-block-idx={i}
                  onDoubleClick={(e) => handleBlockDoubleClick(block, e)}
                >
                  <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
                    {block.source}
                  </ReactMarkdown>
                </div>
              ))
            ) : (
              <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
                {body}
              </ReactMarkdown>
            )}
          </div>
        )}
        {editingBlock && (
          <div
            ref={editContainerRef}
            className="absolute z-10 left-6 right-6"
            style={{
              top: editingBlock.rect.top - 6,
            }}
          >
            <textarea
              ref={editTextareaRef}
              onChange={(e) => {
                pendingValueRef.current = e.target.value
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.max(60, e.target.scrollHeight)}px`
              }}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault()
                  handleBlockSave()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleBlockCancel()
                } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
                  e.preventDefault()
                }
              }}
              className="w-full resize-none outline-none text-ide-text bg-ide-bg px-3 py-2"
              style={{
                fontFamily: 'var(--ide-font-family, "Cascadia Code", monospace)',
                fontSize: 14,
                lineHeight: 1.7,
                border: 'none',
              }}
              spellCheck={false}
            />
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

      {exportStatus && (
        <div
          className={`absolute top-12 left-3 z-20 px-3 py-1.5 rounded-md text-xs border shadow-lg max-w-[70%] truncate ${
            exportStatus.type === 'success'
              ? 'bg-ide-success/15 text-ide-success border-ide-success/30'
              : 'bg-ide-danger/15 text-ide-danger border-ide-danger/30'
          }`}
          title={exportStatus.text}
        >
          {exportStatus.text}
        </div>
      )}

      {exportMenu && (
        <div
          ref={exportMenuPos.ref}
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[160px]"
          style={exportMenuPos.style}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2 disabled:opacity-50"
            onClick={handleExportHtml}
            disabled={exporting}
          >
            <FileDown size={14} className="text-ide-text-muted" />
            <span>{exporting ? '导出中...' : '导出 HTML'}</span>
          </button>
        </div>
      )}
    </div>
  )
})

export default MarkdownPreview
