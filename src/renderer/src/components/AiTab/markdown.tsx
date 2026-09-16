import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStableCodeOverrides } from '../MarkdownCodeBlock'
import { FILE_PATH_REGEX, parseFilePath } from '../../utils/filePathUtils'
import { cleanMessageContent } from '../../utils/aiConversationFormatter'

// singleTilde:false 防 "4~7 xx 7~8" 这类范围写法被误配成删除线；del 直通彻底不渲染删除线
const GFM_PLUGINS: [[typeof remarkGfm, { singleTilde: boolean }]] = [[remarkGfm, { singleTilde: false }]]
const DelPassthrough = ({ children }: { children?: ReactNode }) => <>{children}</>

function findFilePathAtPoint(x: number, y: number, cwd: string): { fullPath: string; lineNumber?: number } | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  const range = doc.caretRangeFromPoint?.(x, y) ?? null
  const node = range?.startContainer
  if (!node || node.nodeType !== Node.TEXT_NODE || !range) return null
  const text = (node as Text).nodeValue || ''
  const offset = range.startOffset
  FILE_PATH_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_PATH_REGEX.exec(text)) !== null) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      const parsed = parseFilePath(match[0], cwd)
      if (parsed) return parsed
    }
  }
  return null
}

export const ChatMarkdown = React.memo(function ChatMarkdown({ text, className = '', workspacePath, onOpenFile }: {
  text: string; className?: string
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
}) {
  const codeOverrides = useStableCodeOverrides()
  const components = useMemo(() => ({ ...codeOverrides, del: DelPassthrough }), [codeOverrides])
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!workspacePath || !onOpenFile) return
    const target = e.target as HTMLElement
    if (target.closest('a, pre')) return
    if (window.getSelection()?.toString().trim()) return
    const parsed = findFilePathAtPoint(e.clientX, e.clientY, workspacePath)
    if (!parsed) return
    e.preventDefault()
    onOpenFile(parsed.fullPath, parsed.lineNumber)
  }, [workspacePath, onOpenFile])

  return (
    <div className={`ai-tab__markdown md-preview ${className}`} onClick={handleClick}>
      <ReactMarkdown remarkPlugins={GFM_PLUGINS} components={components}>
        {cleanMessageContent(text)}
      </ReactMarkdown>
    </div>
  )
})

// 流式渲染：只渲染到最后一个 CLOSED 代码围栏，未闭合代码块按 raw 展示，
// 防止每个 token 导致 CodeBlock remount + 重新 colorize（闪烁）。
function splitStreamSegments(clean: string): { blocks: string[]; rawPart: string } {
  const fenceRe = /```/g
  let count = 0
  let lastCloseIdx = -1
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(clean)) !== null) {
    count++
    if (count % 2 === 0) lastCloseIdx = m.index + 3
  }
  const isCodeOpen = count % 2 !== 0
  const safePart = isCodeOpen ? (lastCloseIdx >= 0 ? clean.slice(0, lastCloseIdx) : '') : clean
  const rawPart = isCodeOpen ? clean.slice(lastCloseIdx >= 0 ? lastCloseIdx : 0) : ''

  const blocks: string[] = []
  let cur = ''
  let fenceOpen = false
  const lines = safePart.split('\n')
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenceOpen = !fenceOpen
    if (fenceOpen || line.trim() !== '') {
      cur += line + '\n'
    } else {
      if (cur.trim()) blocks.push(cur)
      cur = ''
    }
  }
  if (cur.trim()) blocks.push(cur)
  return { blocks: blocks.map((b) => b.replace(/\n$/, '')), rawPart }
}

// 打字机揭示：streamBuffer 每 200ms 批量到齐，直接渲染会"一片一片"蹦字。
// 这里让已显示长度以指数追赶（τ≈200ms，积压多自动加速、下限 60 字/s 逐字吐出），
// 切点吸附到词边界（前瞻 ≤12 字符，CJK 无空格则按字切）压掉半词闪烁。
// 揭示只作用于流式期；提交时 result 清 buffer，整条消息已由 ChatMarkdown 全量接管，
// 稳态滞后 = 输入速率×τ ≈ 20 字，交接处的 pop 不可感知。
function useTypewriterReveal(target: string): string {
  const [, setTick] = useState(0)
  const stRef = useRef({ target: '', shown: 0, raf: 0, last: 0 })
  const st = stRef.current
  st.target = target
  if (st.shown > target.length) st.shown = target.length
  useEffect(() => {
    const s = stRef.current
    if (s.raf || s.shown >= s.target.length) return
    s.last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(now - s.last, 250)
      s.last = now
      const lag = s.target.length - s.shown
      if (lag <= 0) { s.raf = 0; return }
      let next = Math.min(s.target.length, s.shown + Math.max((lag * dt) / 200, dt * 0.06))
      if (next < s.target.length) {
        const floor = Math.floor(next)
        // 有界扫描代替 slice+search：避免每帧分配剩余全文子串的 O(n) 垃圾
        let rel = -1
        for (let i = floor; i - floor <= 12 && i < s.target.length; i++) {
          const c = s.target.charCodeAt(i)
          if (c === 32 || (c >= 9 && c <= 13)) { rel = i - floor; break }
        }
        if (rel >= 0) next = floor + rel + 1
      }
      s.shown = next
      setTick((t) => t + 1)
      s.raf = s.shown < s.target.length ? requestAnimationFrame(tick) : 0
    }
    s.raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(s.raf); s.raf = 0 }
  })
  return target.slice(0, st.shown)
}

// 块级增量渲染（参照 cc GUI IncrementalMarkdownParser 思路，无依赖轻量版）：
// 前缀块文本不变 → 复用缓存的 ReactNode（ReactMarkdown 不再执行，DOM 冻结）；
// 只有尾部活跃块 + 未闭合围栏 raw 每次 flush 重渲染。
export function StreamingMarkdown({ text, className = '', workspacePath, onOpenFile }: {
  text: string; className?: string
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
}) {
  const codeOverrides = useStableCodeOverrides()
  const components = useMemo(() => ({ ...codeOverrides, del: DelPassthrough }), [codeOverrides])
  const cacheRef = useRef<{ text: string[]; nodes: ReactNode[] }>({ text: [], nodes: [] })
  const revealed = useTypewriterReveal(text)

  const rendered = useMemo(() => {
    const clean = cleanMessageContent(revealed)
    const { blocks, rawPart } = splitStreamSegments(clean)

    const cache = cacheRef.current
    const maxPrefix = Math.min(cache.text.length, blocks.length)
    let prefix = 0
    while (prefix < maxPrefix && cache.text[prefix] === blocks[prefix]) prefix++

    const nodes: React.ReactNode[] = []
    for (let i = 0; i < prefix; i++) nodes.push(cache.nodes[i])
    for (let i = prefix; i < blocks.length; i++) {
      nodes.push(
        <div key={`${i}`} className="md-block md-block-enter" style={{ '--enter-delay': `${Math.min(i - prefix, 6) * 24}ms` } as React.CSSProperties}>
          <ReactMarkdown remarkPlugins={GFM_PLUGINS} components={components}>
            {blocks[i]}
          </ReactMarkdown>
        </div>
      )
    }
    if (rawPart) nodes.push(<pre key="raw" className="ai-tab__markdown-raw whitespace-pre-wrap text-ide-text">{rawPart}</pre>)
    cacheRef.current = { text: [...blocks], nodes: [...nodes] }
    return nodes
  }, [revealed, components])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!workspacePath || !onOpenFile) return
    const target = e.target as HTMLElement
    if (target.closest('a, pre')) return
    if (window.getSelection()?.toString().trim()) return
    const parsed = findFilePathAtPoint(e.clientX, e.clientY, workspacePath)
    if (!parsed) return
    e.preventDefault()
    onOpenFile(parsed.fullPath, parsed.lineNumber)
  }, [workspacePath, onOpenFile])

  return (
    <div className={`ai-tab__markdown ai-tab__markdown--streaming md-preview ${className}`} onClick={handleClick}>
      {rendered}
    </div>
  )
}
