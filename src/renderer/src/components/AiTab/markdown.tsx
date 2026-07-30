import React, { useState, useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { AiMessage, AiToolUse, AiSessionState, AiPermissionRequest, AiPermissionMode, AiSlashCommand, RecentFileEntry, UserTurn } from '@shared/types'
import { AI_FILE_EDIT_TOOLS } from '@shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStableCodeOverrides } from '../MarkdownCodeBlock'
import { useI18n } from '../../i18n'
import { FILE_PATH_REGEX, parseFilePath } from '../../utils/filePathUtils'
import { cleanMessageContent, formatConversationMarkdown } from '../../utils/aiConversationFormatter'
import { loadFilterRules } from '../FileTab'
import { getFileInfo, FILE_ICON_PATHS } from '../FileIcons'
import { aiStore, useAiSession, EMPTY_SESSION, enrichSlashCommands, SLASH_COMMAND_DESCRIPTIONS, readAiCliConfig } from '../../aiStore'
import { EXAMPLE_PROMPTS } from '../examplePrompts'
import { SquareArrowUp, Square, ChevronDown, ChevronUp, Check, HelpCircle, FileText, Undo2, MessageSquare, GitFork, MessageSquarePlus, Copy, Circle, Loader2, ListTodo, Eye, EyeOff, Plug, GitBranch, Folder, X } from 'lucide-react'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { useTheme } from '../../themes'
import { displayLabel, getShortcuts } from '../../shortcuts'
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

// During streaming, only render markdown up to the last CLOSED code fence.
// Any open (incomplete) code block is shown as raw text to prevent CodeBlock
// from remounting + re-colorizing on every token (which causes flicker).
export function StreamingMarkdown({ text, className = '', workspacePath, onOpenFile }: {
  text: string; className?: string
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
}) {
  const codeOverrides = useStableCodeOverrides()
  const clean = cleanMessageContent(text)
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
      {safePart && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeOverrides}>
          {safePart}
        </ReactMarkdown>
      )}
      {rawPart && <pre className="ai-tab__markdown-raw whitespace-pre-wrap text-ide-text">{rawPart}</pre>}
    </div>
  )
}
