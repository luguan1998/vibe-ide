import React, { useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStableCodeOverrides } from '../MarkdownCodeBlock'
import { FILE_PATH_REGEX, parseFilePath } from '../../utils/filePathUtils'
import { cleanMessageContent } from '../../utils/aiConversationFormatter'
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeOverrides}>
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

// 块级增量渲染（参照 cc GUI IncrementalMarkdownParser 思路，无依赖轻量版）：
// 前缀块文本不变 → 复用缓存的 ReactNode（ReactMarkdown 不再执行，DOM 冻结）；
// 只有尾部活跃块 + 未闭合围栏 raw 每次 flush 重渲染。
export function StreamingMarkdown({ text, className = '', workspacePath, onOpenFile }: {
  text: string; className?: string
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
}) {
  const codeOverrides = useStableCodeOverrides()
  const cacheRef = useRef<{ text: string[]; nodes: ReactNode[] }>({ text: [], nodes: [] })

  const rendered = useMemo(() => {
    const clean = cleanMessageContent(text)
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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeOverrides}>
            {blocks[i]}
          </ReactMarkdown>
        </div>
      )
    }
    if (rawPart) nodes.push(<pre key="raw" className="ai-tab__markdown-raw whitespace-pre-wrap text-ide-text">{rawPart}</pre>)
    cacheRef.current = { text: [...blocks], nodes: [...nodes] }
    return nodes
  }, [text, codeOverrides])

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
