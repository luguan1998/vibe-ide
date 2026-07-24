import React, { useState, useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { AiMessage, AiToolUse, AiSessionState, AiPermissionRequest, AiPermissionMode, AiSlashCommand, RecentFileEntry } from '@shared/types'
import { AI_FILE_EDIT_TOOLS } from '@shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStableCodeOverrides } from './MarkdownCodeBlock'
import { useI18n } from '../i18n'
import { FILE_PATH_REGEX, parseFilePath } from '../utils/filePathUtils'
import { cleanMessageContent, formatConversationMarkdown } from '../utils/aiConversationFormatter'
import { loadFilterRules } from './FileTab'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
import { aiStore, useAiSession, EMPTY_SESSION, enrichSlashCommands, SLASH_COMMAND_DESCRIPTIONS } from '../aiStore'
import { EXAMPLE_PROMPTS } from './examplePrompts'
import { SquareArrowUp, Square, ChevronDown, ChevronUp, Check, HelpCircle, FileText, Undo2, MessageSquare, GitFork, MessageSquarePlus, Copy, Circle, Loader2, ListTodo, Eye, EyeOff, Plug, GitBranch, Folder, X } from 'lucide-react'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { useTheme } from '../themes'
import { displayLabel, getShortcuts } from '../shortcuts'

function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  if (n < 1000000) return `${(n / 1000).toFixed(1)} kB`
  return `${(n / 1000000).toFixed(1)} MB`
}

interface AiTabProps {
  activeSessionId: string | null
  workspacePath: string | null
  isActive: boolean
  autoApprove: boolean
  permissionMode: AiPermissionMode
  onPermissionModeChange: (mode: AiPermissionMode) => void
  onViewAi: () => void
  onRenameSession: (name: string) => void
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  onForkSession?: (userMessageIndex: number) => void
  onAgentStatusChange?: (sessionId: string, status: 'running' | 'idle') => void
  resumeSessionId?: string
  brushActive?: boolean
  lastOpenedFile?: RecentFileEntry | null
  worktreeNav?: { originalPath: string; worktreePath: string; originalBranch: string } | null
  onWorktreeNavChange?: React.Dispatch<React.SetStateAction<Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>>>
  onCommand?: (command: string) => void
}

export interface AiTabHandle {
  focus: () => void
  setValue: (text: string) => void
  appendText: (text: string) => void
}

// ── Tool type classification ──────────────────────────────────────

const COMMAND_TOOLS = new Set(['Bash', 'bash', 'terminal', 'run_command', 'execute_command'])
const SEARCH_TOOLS = new Set(['Grep', 'grep', 'search', 'Glob', 'glob', 'find', 'ripgrep', 'Read'])
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch'])
const PLAN_TOOLS = new Set(['ExitPlanMode', 'EnterPlanMode'])
const SKILL_TOOLS = new Set(['Skill'])
const AGENT_TOOLS = new Set(['Agent'])
const QUESTION_TOOLS = new Set(['AskUserQuestion'])
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop'])

function getToolCategory(name: string): 'file' | 'command' | 'search' | 'web' | 'plan' | 'skill' | 'agent' | 'question' | 'task' | 'default' {
  if (AI_FILE_EDIT_TOOLS.has(name)) return 'file'
  if (COMMAND_TOOLS.has(name)) return 'command'
  if (SEARCH_TOOLS.has(name)) return 'search'
  if (WEB_TOOLS.has(name)) return 'web'
  if (PLAN_TOOLS.has(name)) return 'plan'
  if (SKILL_TOOLS.has(name)) return 'skill'
  if (AGENT_TOOLS.has(name)) return 'agent'
  if (QUESTION_TOOLS.has(name)) return 'question'
  if (TASK_TOOLS.has(name)) return 'task'
  return 'default'
}

const DIFF_LANG_MAP: Record<string, string> = {
  'ts': 'typescript', 'tsx': 'typescript', 'mts': 'typescript', 'cts': 'typescript',
  'js': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript', 'jsx': 'javascript',
  'py': 'python', 'pyw': 'python',
  'rs': 'rust', 'go': 'go', 'java': 'java', 'kt': 'kotlin', 'kts': 'kotlin',
  'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp',
  'cs': 'csharp', 'rb': 'ruby', 'php': 'php', 'swift': 'swift', 'dart': 'dart',
  'json': 'json', 'yaml': 'yaml', 'yml': 'yaml', 'toml': 'toml', 'xml': 'xml',
  'html': 'html', 'css': 'css', 'scss': 'scss', 'less': 'less',
  'md': 'markdown', 'sql': 'sql',
  'sh': 'shell', 'bash': 'shell', 'bat': 'bat', 'cmd': 'bat',
  'ps1': 'powershell', 'dockerfile': 'dockerfile',
  'tf': 'hcl', 'tfvars': 'hcl',
  'ini': 'ini', 'graphql': 'graphql', 'gql': 'graphql',
  'gitignore': 'plaintext', 'env': 'plaintext', 'txt': 'plaintext',
}
function getLanguageFromFilePath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return DIFF_LANG_MAP[ext] || 'plaintext'
}

interface TodoItem {
  id: string
  subject: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  parentToolUseId?: string
}

function deriveTodoList(messages: AiMessage[]): TodoItem[] {
  const tasks = new Map<string, TodoItem>()
  for (const msg of messages) {
    if (!msg.toolUse) continue
    for (const tool of msg.toolUse) {
      if (tool.name === 'TaskCreate') {
        const id = String(tasks.size + 1)
        tasks.set(id, {
          id,
          subject: tool.input?.subject || '',
          description: tool.input?.description,
          status: 'pending',
          parentToolUseId: msg.parentToolUseId,
        })
      } else if (tool.name === 'TaskUpdate') {
        const taskId = String(tool.input?.taskId || '')
        const newStatus = tool.input?.status as TodoItem['status'] | undefined
        const existing = tasks.get(taskId)
        if (existing && newStatus) {
          existing.status = newStatus
        }
      }
    }
  }
  return [...tasks.values()].filter(t => t.status !== 'deleted')
}

// ── Sub-components (被调先于主调) ──────────────────────────────

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
    <div className={`ai-tab__markdown md-preview text-sm ${className}`} onClick={handleClick}>
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
    <div className={`ai-tab__markdown ai-tab__markdown--streaming md-preview text-sm ${className}`} onClick={handleClick}>
      {safePart && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeOverrides}>
          {safePart}
        </ReactMarkdown>
      )}
      {rawPart && <pre className="ai-tab__markdown-raw whitespace-pre-wrap text-ide-text">{rawPart}</pre>}
    </div>
  )
}

function ToolIcon({ category }: { category: 'file' | 'command' | 'search' | 'web' | 'plan' | 'skill' | 'agent' | 'question' | 'task' | 'default' }) {
  const cls = "w-3.5 h-3.5 shrink-0"
  if (category === 'skill') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <path d="M12 3c-5 3-9 8-9 14 3-2 6-2 9 0 3-2 6-2 9 0 0-6-4-11-9-14Z" />
      <path d="M19 17c-3 0-5 1-7 4-2-3-4-4-7-4" />
    </svg>
  )
  if (category === 'web') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
  if (category === 'plan') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  )
  if (category === 'file') return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cls}>
      <path d="M20.232 3.77a2.625 2.625 0 0 0-3.713 0l-6.394 6.392a4.125 4.125 0 0 0-.894 1.338l-1.272 3.071a1.125 1.125 0 0 0 1.47 1.47l3.07-1.272a4.125 4.125 0 0 0 1.34-.894l6.39-6.393a2.625 2.625 0 0 0 0-3.712Z" />
      <path d="M7.125 5.25c-1.035 0-1.875.84-1.875 1.875v9.75c0 1.035.84 1.875 1.875 1.875h9.75c1.035 0 1.875-.84 1.875-1.875V13.5a1.125 1.125 0 0 1 2.25 0v3.375A4.125 4.125 0 0 1 16.875 21h-9.75A4.125 4.125 0 0 1 3 16.875v-9.75A4.125 4.125 0 0 1 7.125 3H10.5a1.125 1.125 0 0 1 0 2.25H7.125Z" />
    </svg>
  )
  if (category === 'task') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <line x1="11" y1="5" x2="19" y2="5" /><circle cx="5.5" cy="5" r="1.5" />
      <line x1="11" y1="12" x2="19" y2="12" /><circle cx="5.5" cy="12" r="1.5" />
      <line x1="11" y1="19" x2="19" y2="19" /><circle cx="5.5" cy="19" r="1.5" />
    </svg>
  )
  if (category === 'command') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
  if (category === 'search') return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cls}>
      <path d="M10.875 5.532a12.053 12.053 0 0 0-7.308-.785A.72.72 0 0 0 3 5.46v11.991c0 .518.513.882 1.019.768a9.03 9.03 0 0 1 6.856 1.215V5.532ZM13.125 19.434a9.03 9.03 0 0 1 6.857-1.215c.505.113 1.018-.251 1.018-.768V5.46a.72.72 0 0 0-.567-.713 12.051 12.051 0 0 0-7.308.785v13.902Z" />
    </svg>
  )
  if (category === 'agent') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <circle cx="9" cy="14" r="1.5" />
      <circle cx="15" cy="14" r="1.5" />
      <path d="M9 18h6" />
    </svg>
  )
  if (category === 'question') return <HelpCircle className={cls} />
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function AiInlineDiff({ oldContent, newContent, filePath }: {
  oldContent?: string
  newContent: string
  filePath: string
}) {
  const { theme } = useTheme()
  const [height, setHeight] = useState<number | null>(null)

  const language = getLanguageFromFilePath(filePath)

  const handleDiffMount = useCallback((editor: any) => {
    try {
      const modEd = editor.getModifiedEditor()
      const ch = modEd.getContentHeight()
      setHeight(Math.min(Math.max(ch + 20, 80), 300))
    } catch {
      setHeight(200)
    }
  }, [])

  const handleEditorMount = useCallback((editor: any) => {
    try {
      const ch = editor.getContentHeight()
      setHeight(Math.min(Math.max(ch + 20, 80), 300))
    } catch {
      setHeight(200)
    }
  }, [])

  const h = height ?? 200

  if (newContent.length > 100_000) {
    return (
      <div className="ai-tab__inline-diff flex items-center justify-center text-ide-text-muted text-[11px]" style={{ height: 80 }}>
        File too large to display inline ({Math.round(newContent.length / 1024)}KB)
      </div>
    )
  }

  if (!oldContent) {
    return (
      <div className="ai-tab__inline-diff" style={{ height: h }}>
        <Editor
          height={h}
          language={language}
          theme={theme.monacoTheme}
          value={newContent}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: 'on',
            lineNumbersMinChars: 2,
            automaticLayout: true,
            padding: { top: 4, bottom: 4 },
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
          }}
          onMount={handleEditorMount}
        />
      </div>
    )
  }

  return (
    <div className="ai-tab__inline-diff" style={{ height: h }}>
      <DiffEditor
        height={h}
        language={language}
        theme={theme.monacoTheme}
        original={oldContent}
        modified={newContent}
        options={{
          renderSideBySide: false,
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineNumbers: 'on',
          lineNumbersMinChars: 2,
          automaticLayout: true,
          renderIndicators: true,
          originalEditable: false,
          ignoreTrimWhitespace: false,
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
        }}
        onMount={handleDiffMount}
      />
    </div>
  )
}

function getFileEditContent(tool: AiToolUse): { filePath: string; oldContent?: string; newContent?: string } | null {
  const input = tool.input || {}
  const fp = input.file_path || input.path || input.filePath || ''
  if (!fp) return null

  // Write / write_file / create_file: newContent = content
  const writeContent = input.content || input.new_content || input.newContent
  if (writeContent !== undefined) {
    return { filePath: fp, newContent: writeContent }
  }

  // Edit / edit_file / replace: oldContent = old_string, newContent = new_string
  const oldStr = input.old_string || input.old_str || input.oldString
  const newStr = input.new_string || input.new_str || input.newString
  if (oldStr !== undefined || newStr !== undefined) {
    return { filePath: fp, oldContent: oldStr, newContent: newStr }
  }

  return { filePath: fp }
}

function AiToolCallCard({ tool }: { tool: AiToolUse }) {
  const [expanded, setExpanded] = useState(false)
  const category = getToolCategory(tool.name)
  const isFileEdit = category === 'file'
  const hasResult = !!tool.result
  const rawPath = tool.input?.file_path || ''
  const detail = rawPath.length > 32
    ? rawPath.slice(0, 15) + '...' + rawPath.slice(-14)
    : rawPath || tool.input?.command || ''

  const editContent = (expanded && isFileEdit) ? getFileEditContent(tool) : null
  const oldContent = editContent?.oldContent
  const newContent = editContent?.newContent

  return (
    <div className="ai-tab__tool-call inline-block max-w-full animate-fade-in">
      <button
        onClick={() => setExpanded(v => !v)}
        className={`ai-tab__tool-toggle inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono transition-colors max-w-full overflow-hidden ${
          isFileEdit ? 'bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25' : 'bg-ide-hover text-ide-text-muted hover:bg-ide-active'
        }`}
      >
        <span className="shrink-0"><ToolIcon category={category} /></span>
        <span className="shrink-0 leading-none">{tool.name}{' '}</span>
        {detail && <span className="ai-tab__tool-detail-preview truncate flex-1 min-w-0 opacity-60 text-[10px] leading-none">{detail}</span>}
        {hasResult && (
          <span className={`ai-tab__tool-status shrink-0 text-[10px] leading-none ${tool.result!.isError ? 'text-ide-danger' : 'text-ide-success'}`}>
            {tool.result!.isError ? '✗' : '✓'}
          </span>
        )}
      </button>
      {expanded && (
        <div className={`ai-tab__tool-detail-panel mt-0.5 px-2 py-1 text-[11px] font-mono bg-ide-bg border border-ide-border rounded space-y-0.5 ${isFileEdit ? 'p-1' : 'max-h-48 overflow-y-auto'}`}>
          {isFileEdit && newContent ? (
            <>
              <div className="ai-tab__tool-file-header text-ide-text-muted text-[10px] font-sans">
                {!oldContent ? 'Creating' : 'Editing'} <span className="text-ide-text">{editContent?.filePath}</span>
              </div>
              <AiInlineDiff
                oldContent={oldContent}
                newContent={newContent}
                filePath={editContent?.filePath || ''}
              />
              {hasResult && (
                <div className={`pt-1 border-t border-ide-border/30 ${tool.result!.isError ? 'text-ide-danger/80' : 'text-ide-text'}`}>
                  <pre className="whitespace-pre-wrap break-words text-[11px]">{tool.result!.content}</pre>
                </div>
              )}
            </>
          ) : isFileEdit && !newContent ? (
            <div className="text-ide-text-muted text-[11px] py-2 text-center">Waiting for content...</div>
          ) : (
            <>
              {hasResult && (
                <div className={tool.result!.isError ? 'text-ide-danger/80' : 'text-ide-text'}>
                  <pre className="whitespace-pre-wrap break-words text-[11px]">{tool.result!.content}</pre>
                </div>
              )}
              <div className="text-ide-text-muted">
                <pre className="whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(tool.input, null, 2)}</pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const AiAskQuestionCard = React.memo(function AiAskQuestionCard({ perm, sessionId, onRespond }: {
  perm: AiPermissionRequest
  sessionId: string
  onRespond: (sid: string, rid: string, approved: boolean, tool: string, toolInput?: Record<string, any>) => void
}) {
  const { t } = useI18n()

  const questions = (perm.toolInput?.questions || []) as Array<{
    question: string
    header: string
    multiSelect: boolean
    options: Array<{ label: string; description?: string; preview?: string }>
  }>

  // 单题单选 → 点击选项立即提交；多题或多选 → Submit 统一提交
  const quickSubmit = questions.length === 1 && !questions[0].multiSelect

  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {}
    for (const q of questions) init[q.question] = new Set<string>()
    return init
  })

  const allAnswered = questions.every(q => (selections[q.question]?.size ?? 0) >= 1)

  const buildAnswers = (selOverride?: Record<string, Set<string>>): Record<string, string> => {
    const sel = selOverride ?? selections
    const answers: Record<string, string> = {}
    for (const q of questions) {
      answers[q.question] = [...(sel[q.question] || [])].join(', ')
    }
    return answers
  }

  const handleSubmit = () => {
    onRespond(sessionId, perm.requestId, true, perm.tool, { ...perm.toolInput, answers: buildAnswers() })
  }

  const toggle = (qText: string, label: string, multi: boolean) => {
    const prevSet = selections[qText] || new Set<string>()
    const next = new Set<string>(multi ? prevSet : [])
    if (multi) {
      if (prevSet.has(label)) next.delete(label)
      else next.add(label)
    } else {
      next.add(label)
    }
    setSelections(prev => ({ ...prev, [qText]: next }))

    // quickSubmit 模式下，单题单选点击即提交
    if (quickSubmit) {
      onRespond(sessionId, perm.requestId, true, perm.tool, {
        ...perm.toolInput,
        answers: { [qText]: label },
      })
    }
  }

  return (
    <div className="ai-tab__question-card shrink-0 border-t border-ide-accent/40 bg-ide-accent/5 px-3 py-2.5 animate-fade-in">
      <div className="flex items-center gap-1.5 mb-1.5">
        <HelpCircle size={15} className="text-ide-accent shrink-0" />
        <span className="ai-tab__question-title text-[13px] font-medium text-ide-accent">{t('AI has a question')}</span>
      </div>

      {questions.map((q, qi) => (
        <div key={qi} className="mb-3 last:mb-0">
          <div className="ai-tab__question-header flex items-center gap-1.5 mb-1">
            <span className="px-2 py-1 text-[11px] font-medium rounded bg-ide-accent/15 text-ide-accent border border-ide-accent/25">
              {q.header}
            </span>
            {q.multiSelect && (
              <span className="text-[11px] text-ide-text-muted/60">{t('multi-select')}</span>
            )}
          </div>
          <div className="text-[13px] text-ide-text mb-1.5">{q.question}</div>
          <div className="flex flex-wrap gap-1">
            {q.options.map((opt, oi) => {
              const selected = selections[q.question]?.has(opt.label) ?? false
              return (
                <button
                  key={oi}
                  title={opt.description}
                  onClick={() => toggle(q.question, opt.label, q.multiSelect)}
                  className={`ai-tab__question-option px-3 py-1.5 text-[12px] rounded border transition-colors ${
                    selected
                      ? 'ai-tab__question-option--selected bg-ide-accent/20 border-ide-accent/50 text-ide-text'
                      : 'border-ide-border hover:bg-ide-hover text-ide-text-muted'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="flex gap-1.5 mt-2">
        {!quickSubmit && (
          <button
            disabled={!allAnswered}
            onClick={handleSubmit}
            className={`ai-tab__question-submit-btn px-4 py-1.5 text-[13px] font-medium rounded transition-colors ${
              allAnswered
                ? 'bg-ide-accent hover:bg-ide-accent-hover text-white'
                : 'bg-ide-accent/30 text-white/50 cursor-not-allowed'
            }`}
          >
            {t('Submit')}
          </button>
        )}
        <button
          onClick={() => onRespond(sessionId, perm.requestId, false, perm.tool, perm.toolInput)}
          className="ai-tab__question-deny-btn px-4 py-1.5 text-[13px] font-medium border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
        >
          {t('Deny')}
        </button>
      </div>
    </div>
  )
})

const AiPermissionCard = React.memo(function AiPermissionCard({ perm, sessionId, onRespond }: {
  perm: AiPermissionRequest
  sessionId: string
  onRespond: (sid: string, rid: string, approved: boolean, tool: string, toolInput?: Record<string, any>) => void
}) {
  const { t } = useI18n()
  return (
    <div className="ai-tab__permission-card shrink-0 border-t border-ide-warning/40 bg-ide-warning/5 px-3 py-2.5 animate-fade-in">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-ide-warning shrink-0 mt-0.5">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="ai-tab__permission-title text-[13px] font-medium text-ide-warning">{t('AI wants permission to run:')}</div>
          <div className="ai-tab__permission-cmd mt-1 px-1.5 py-1 bg-ide-bg/80 rounded text-[12px] font-mono text-ide-text truncate">
            <span className="text-ide-accent">{perm.tool}</span>
            {perm.command && <span className="text-ide-text-muted"> → {perm.command}</span>}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5 mt-2 ml-7">
        <button
          onClick={() => onRespond(sessionId, perm.requestId, true, perm.tool, perm.toolInput)}
          className="ai-tab__permission-approve-btn px-4 py-1.5 text-[13px] font-medium bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
        >
          {t('Approve')}
        </button>
        <button
          onClick={() => onRespond(sessionId, perm.requestId, false, perm.tool, perm.toolInput)}
          className="ai-tab__permission-deny-btn px-4 py-1.5 text-[13px] font-medium border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
        >
          {t('Deny')}
        </button>
      </div>
    </div>
  )
})

function getSectionReference(el: HTMLElement): { heading: string | null; snippet: string } {
  const BLOCK_TAGS = new Set(['P', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'DD', 'DT', 'FIGCAPTION', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

  let blockEl: HTMLElement | null = el
  while (blockEl && !BLOCK_TAGS.has(blockEl.tagName)) {
    blockEl = blockEl.parentElement
  }
  const snippet = ((blockEl || el).textContent || '').trim().slice(0, 80)

  let node: HTMLElement | null = blockEl || el
  while (node) {
    if (/^H[1-6]$/.test(node.tagName)) {
      const heading = (node.textContent || '').trim()
      return { heading: heading !== snippet ? heading : null, snippet }
    }
    let prev = node.previousElementSibling as HTMLElement | null
    while (prev) {
      if (/^H[1-6]$/.test(prev.tagName)) {
        const heading = (prev.textContent || '').trim()
        return { heading, snippet }
      }
      prev = prev.previousElementSibling as HTMLElement | null
    }
    node = node.parentElement
  }
  return { heading: null, snippet }
}

export function InlineAnnotationInput({ top, left, containerRef, onSubmit, onDismiss }: {
  top: number; left: number; containerRef: React.RefObject<HTMLDivElement | null>
  onSubmit: (text: string) => void; onDismiss: () => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const commit = useCallback(() => {
    const t = value.trim()
    if (t) onSubmit(t)
    else onDismiss()
  }, [value, onSubmit, onDismiss])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onDismiss()
    }
  }, [commit, onDismiss])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = () => onDismiss()
    container.addEventListener('scroll', handler, { once: true })
    return () => container.removeEventListener('scroll', handler)
  }, [containerRef, onDismiss])

  return (
    <div className="ai-tab__annotation-input absolute z-30 animate-fade-in" style={{ top, left }}>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onDismiss}
        rows={2}
        placeholder={t('Write annotation, Enter to confirm...')}
        className="w-56 bg-ide-sidebar border border-ide-accent/60 rounded-lg px-2.5 py-1.5 text-xs text-ide-text placeholder:text-ide-text-muted/50 resize-none focus:outline-none focus:border-ide-accent shadow-lg leading-relaxed"
      />
    </div>
  )
}

// ExitPlanMode approval card. Plan content is already on disk (perm.toolInput.planFilePath);
// "Clear & Execute" kills the plan-mode subprocess and respawns in bypassPermissions mode with the
// plan re-injected as first message — clears the inflated context from exploration.
// "Send Feedback" denies with a feedback message so the model revises the plan.
const AiExitPlanModeCard = React.memo(function AiExitPlanModeCard({ perm, sessionId, onContinue, onClearExecute, onDeny, workspacePath, onOpenFile, model, brushActive }: {
  perm: AiPermissionRequest
  sessionId: string
  onContinue: (sessionId: string, requestId: string, modelOverride?: string) => void
  onClearExecute: (sessionId: string, planFilePath: string, model?: string) => void
  onDeny: (sessionId: string, requestId: string, feedback: string) => void
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  model: string
  brushActive?: boolean
}) {
  const { t } = useI18n()
  const plan = (perm.toolInput?.plan as string) || ''
  const planFilePath = (perm.toolInput?.planFilePath as string) || ''
  const [feedback, setFeedback] = useState('')
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const [switchOpen, setSwitchOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const switchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = feedbackRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = 120
    const newH = Math.min(el.scrollHeight, maxH)
    el.style.height = `${newH}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [feedback])
  const [annotationInput, setAnnotationInput] = useState<{ top: number; left: number; heading: string | null; snippet: string } | null>(null)
  const planContentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!switchOpen) return
    const handler = (e: MouseEvent) => {
      if (switchRef.current && !switchRef.current.contains(e.target as Node)) setSwitchOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [switchOpen])

  useEffect(() => {
    if (!switchOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSwitchOpen(false); e.stopPropagation() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [switchOpen])

  const handleAnnotationSubmit = useCallback((text: string) => {
    setAnnotationInput(null)
    if (!text.trim()) return
    const ref = annotationInput
    let line: string
    if (ref?.heading) {
      line = `**${ref.heading}** "${ref.snippet}" → ${text.trim()}`
    } else if (ref?.snippet) {
      line = `"${ref.snippet}" → ${text.trim()}`
    } else {
      line = text.trim()
    }
    setFeedback(prev => prev ? `${prev}\n\n${line}` : line)
  }, [annotationInput])

  const handlePlanClick = useCallback((e: React.MouseEvent) => {
    if (!brushActive) return
    const target = e.target as HTMLElement
    if (target.closest('a, pre')) return
    if (window.getSelection()?.toString().trim()) return
    e.preventDefault()
    e.stopPropagation()
    const container = planContentRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const { heading, snippet } = getSectionReference(target)
    setAnnotationInput({
      top: e.clientY - rect.top + container.scrollTop,
      left: e.clientX - rect.left,
      heading,
      snippet
    })
  }, [brushActive])

  const brushClass = brushActive ? ' diff-brush-mode' : ''
  const [collapsed, setCollapsed] = useState(false)
  const renderActions = (compact: boolean) => (
    <div className={`flex items-center gap-1.5 ${compact ? '' : 'shrink-0'}`}>
      <button
        onClick={() => onContinue(sessionId, perm.requestId, selectedModel || undefined)}
        className="px-4 py-1.5 text-[13px] font-medium bg-ide-success hover:brightness-110 text-white rounded transition-colors"
      >
        {t('Execute')}
      </button>
      <button
        onClick={() => onClearExecute(sessionId, planFilePath, selectedModel || undefined)}
        className="px-4 py-1.5 text-[13px] font-medium border border-ide-accent/40 hover:bg-ide-accent/10 text-ide-accent rounded transition-colors"
        title={t('Clear & Execute Tooltip')}
      >
        {t('Clear & Execute')}
      </button>
      {!compact && (
        <div ref={switchRef} className="relative">
          <button
            onClick={() => setSwitchOpen(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium bg-ide-accent/20 hover:bg-ide-accent/30 text-ide-accent rounded-full transition-colors"
          >
            <span className="truncate">{selectedModel || t('Switch Model')}</span>
            <ChevronDown size={10} className={`shrink-0 opacity-50 transition-transform ${switchOpen ? 'rotate-180' : ''}`} />
          </button>
          {switchOpen && (
            <div className="absolute bottom-full left-0 mb-1 bg-ide-sidebar border border-ide-border rounded-lg shadow-lg min-w-[130px] py-0.5 animate-fade-in z-30">
              {['opus', 'sonnet', 'haiku'].map(alias => {
                const isSelected = selectedModel === alias
                return (
                  <button
                    key={alias}
                    onClick={() => { setSwitchOpen(false); setSelectedModel(isSelected ? null : alias) }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                      isSelected
                        ? 'bg-ide-accent/15 text-ide-accent'
                        : 'text-ide-text hover:bg-ide-hover'
                    }`}
                  >
                    <span className="truncate">{alias}</span>
                    {isSelected && <Check size={10} className="ml-auto shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      {!compact && <div className="flex-1" />}
      {feedback.trim() && !compact && (
        <button
          onClick={() => onDeny(sessionId, perm.requestId, feedback)}
          className="px-4 py-1.5 text-[13px] font-medium bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
        >
          {t('Send Feedback')}
        </button>
      )}
      <button
        onClick={() => onDeny(sessionId, perm.requestId, '')}
        className="px-4 py-1.5 text-[13px] font-medium border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
      >
        {t('Cancel')}
      </button>
    </div>
  )

  return (
    <div className={`ai-tab__plan-overlay absolute z-20 flex flex-col bg-ide-bg/95 backdrop-blur-sm px-3 py-2.5 animate-fade-in ${collapsed ? 'top-0 left-0 right-0' : 'inset-0'}`}>
      <div className={`flex items-center gap-1.5 shrink-0 ${collapsed ? '' : 'mb-1.5'}`}>
        <FileText size={15} className="text-ide-accent shrink-0" />
        <span className="text-[13px] font-medium text-ide-accent">{t('Plan Ready')}</span>
        {!collapsed && (
          <span className="text-[11px] text-ide-text-muted italic ml-1.5">{t('Hold {key} + click to annotate').replace('{key}', displayLabel(getShortcuts()['brush.activate']))}</span>
        )}
        <div className="flex-1" />
        {collapsed && renderActions(true)}
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? t('Expand') : t('Collapse')}
          className="ai-tab__plan-collapse-btn flex items-center justify-center w-6 h-6 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors shrink-0"
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        <>
          <div
            ref={planContentRef}
            className={`ai-tab__plan-content flex-1 min-h-0 overflow-y-auto mb-1.5 bg-ide-bg/60 rounded px-2 py-1.5 border border-ide-border/40${brushClass}`}
            onClickCapture={handlePlanClick}
          >
            <ChatMarkdown text={plan} workspacePath={workspacePath} onOpenFile={onOpenFile} />
            {annotationInput && (
              <InlineAnnotationInput
                top={annotationInput.top}
                left={annotationInput.left}
                containerRef={planContentRef}
                onSubmit={handleAnnotationSubmit}
                onDismiss={() => setAnnotationInput(null)}
              />
            )}
          </div>

          <div className="rounded-2xl border border-ide-accent/60 bg-ide-sidebar shadow-sm transition-colors focus-within:border-ide-accent mb-1.5 shrink-0">
            <div className="px-3 pt-2.5 pb-1.5">
              <textarea
                ref={feedbackRef}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={t('Feedback for revision (optional)')}
                className="ai-tab__plan-feedback w-full text-sm bg-transparent px-0 py-0.5 text-ide-text placeholder:text-ide-text-muted/50 resize-none focus:outline-none disabled:opacity-50 leading-relaxed"
              />
            </div>
          </div>

          {renderActions(false)}
        </>
      )}
    </div>
  )
})

function findMessageIndexForUserMessage(messages: AiMessage[], userMessageIndex: number): number {
  let count = 0
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user' && m.content && m.type === 'user') {
      if (count === userMessageIndex) return i
      count++
    }
  }
  return -1
}

function AiUserMessage({ message, userMessageIndex, totalUserMessages, isBusy, onRevert, onRevertAndCode, onFork, isInternal }: {
  message: AiMessage
  userMessageIndex: number
  totalUserMessages: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
  isInternal?: boolean
}) {
  const { t } = useI18n()
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHideTimer = () => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }

  useEffect(() => {
    if (!showPopover) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPopover])

  const cleanedContent = cleanMessageContent(message.content || '')
  if (!cleanedContent) return null

  return (
    <div className="ai-tab__message ai-tab__message--user flex justify-end animate-fade-in">
      <div className="ai-tab__message-wrap max-w-[85%] relative"
        onMouseEnter={() => { clearHideTimer(); setShowPopover(true) }}
        onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setShowPopover(false), 300) }}
      >
        <div className="ai-tab__user-bubble px-3 py-2 rounded-2xl bg-ide-accent/12 border-2 border-ide-accent/30 text-ide-text text-sm whitespace-pre-wrap">
          {cleanedContent}
        </div>

        {showPopover && userMessageIndex > 0 && !isInternal && (
          <div ref={popoverRef}
            className="ai-tab__user-popover absolute right-0 top-full mt-1 z-40
                       bg-ide-sidebar border border-ide-border rounded-lg shadow-lg
                       py-1 min-w-[170px] animate-fade-in"
          >
            <button
              onClick={() => { setShowPopover(false); onRevertAndCode(userMessageIndex) }}
              disabled={isBusy}
              className="ai-tab__user-popover-item w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left text-ide-text-muted
                         hover:bg-ide-hover hover:text-ide-text
                         disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Undo2 size={12} className="shrink-0" />
              {t('Revert conversation & code')}
            </button>
            <button
              onClick={() => { setShowPopover(false); onRevert(userMessageIndex) }}
              disabled={isBusy}
              className="ai-tab__user-popover-item w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left text-ide-text-muted
                         hover:bg-ide-hover hover:text-ide-text
                         disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <MessageSquare size={12} className="shrink-0" />
              {t('Revert conversation only')}
            </button>
            <button
              onClick={() => { setShowPopover(false); onFork(userMessageIndex) }}
              disabled={isBusy}
              className="ai-tab__user-popover-item w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left text-ide-text-muted
                         hover:bg-ide-hover hover:text-ide-text
                         disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <GitFork size={12} className="shrink-0" />
              {t('Fork to new session')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBlock({ text, defaultOpen = false, durationMs, autoScroll }: { text: string; defaultOpen?: boolean; durationMs?: number; autoScroll?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const contentRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const label = durationMs != null
    ? `Thinking for ${(durationMs / 1000).toFixed(1)}s`
    : 'Thinking'

  useEffect(() => {
    if (!autoScroll) return
    const el = contentRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledUpRef.current = distFromBottom > 20
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [autoScroll])

  useEffect(() => {
    if (!autoScroll) return
    const el = contentRef.current
    if (!el || userScrolledUpRef.current) return
    el.scrollTop = el.scrollHeight
  }, [text, autoScroll])

  return (
    <div className="ai-tab__thinking max-w-full animate-fade-in">
      <button
        onClick={() => setOpen(v => !v)}
        className="ai-tab__thinking-toggle inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 border border-ide-accent/20 transition-colors"
      >
        <span className="shrink-0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3" aria-labelledby="lightBulbIconTitle">
          <title id="lightBulbIconTitle">Light Bulb</title>
          <path d="M16 12C15.3333333 12.6666667 15 14 15 16L15 17 9 17 9 16C9 14 8.66666667 12.6666667 8 12 5.6739597 9.6739597 5.41421356 6.10050506 7.75735931 3.75735931 10.1005051 1.41421356 13.8994949 1.41421356 16.2426407 3.75735931 18.5857864 6.10050506 18.4068484 9.59315157 16 12zM10 21L14 21"/>
        </svg></span>
        <span className="shrink-0 leading-none">{label}</span>
      </button>
      {open && (
        <div ref={contentRef} className="ai-tab__thinking-content mt-1 px-3 py-2 text-xs bg-ide-accent/5 border border-ide-accent/15 rounded space-y-1 max-h-64 overflow-y-auto">
          <pre className="ai-tab__thinking-text whitespace-pre-wrap break-words text-[13px] text-ide-text-muted">{cleanMessageContent(text)}</pre>
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 opacity-0 group-hover/meta:opacity-100 transition-opacity hover:text-ide-accent"
      title="Copy"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function CollapsibleAgentGroup({ messages, workspacePath, onOpenFile, viewMode }: {
  messages: AiMessage[]
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  viewMode?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const toolCount = messages.reduce((acc, m) => acc + (m.toolUse ? m.toolUse.length : 0), 0)
  return (
    <div className="ai-tab__agent-group border-l-[3px] border-ide-accent/40 pl-2 ml-2 space-y-1 animate-fade-in">
      <button
        onClick={() => setExpanded(v => !v)}
        className="ai-tab__agent-toggle inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 border border-ide-accent/20 transition-colors"
      >
        <span className="shrink-0"><ToolIcon category="agent" /></span>
        <span className="shrink-0 leading-none">Agent{(toolCount > 0) && ` (${toolCount} tools)`}</span>
        <ChevronDown size={10} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-1">
          {messages.map((msg, i) => (
            <AiMessageBubble
              key={i}
              message={msg}
              msgIndex={-1}
              allMessages={messages}
              workspacePath={workspacePath}
              onOpenFile={onOpenFile}
              userMessageIndex={-1}
              totalUserMessages={0}
              isBusy={false}
              onRevert={() => {}}
              onRevertAndCode={() => {}}
              onFork={() => {}}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CollapsedToolsSummary({ tools }: { tools: AiToolUse[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="ai-tab__tools-summary animate-fade-in">
      <button
        onClick={() => setExpanded(v => !v)}
        className="ai-tab__tools-summary-toggle inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono bg-ide-accent/10 text-ide-accent hover:bg-ide-accent/20 border border-ide-accent/20 transition-colors"
      >
        <span className="shrink-0"><ToolIcon category="default" /></span>
        <span className="shrink-0 leading-none">Tools * {tools.length}</span>
        <ChevronDown size={10} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="ai-tab__tools-summary-list mt-px flex flex-col gap-px animate-fade-in">
          {tools.map(tool => <AiToolCallCard key={tool.id} tool={tool} />)}
        </div>
      )}
    </div>
  )
}

function AiAssistantMessage({ message, workspacePath, onOpenFile, copyText, viewMode }: {
  message: AiMessage
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  copyText?: string
  viewMode?: number
}) {
  const { t } = useI18n()
  const hideTools = viewMode === 1 || viewMode === 2
  const hideThink = viewMode === 2
  const showMeta = message.type === 'result' && (message.costUsd != null || message.numTurns != null || message.isAborted || message.durationMs != null)
  const showContent = message.type !== 'result'
  const hasContent = showContent && (message.content || message.thinking || (message.toolUse && message.toolUse.length > 0))

  const errorStatus = !message.isAborted && message.subtype === 'error_max_tokens'
    ? { label: t('Max tokens reached'), color: 'text-ide-warning' }
    : !message.isAborted && message.subtype === 'error_during_execution'
      ? { label: t('Execution failed'), color: 'text-ide-danger' }
      : null

  return (
    <div className="ai-tab__message ai-tab__message--assistant space-y-1 animate-fade-in">
      {errorStatus && (
        <div className={`ai-tab__status-pill text-[9px] font-medium px-1 ${errorStatus.color}`}>
          {errorStatus!.label}
        </div>
      )}
      {hasContent && (
        <div className="ai-tab__message-content max-w-[92%] space-y-1.5">
          {!hideThink && message.thinking && <ThinkingBlock text={message.thinking} durationMs={message.thinkingDurationMs} />}
          {!hideTools && message.toolUse && message.toolUse.length >= 2 && <CollapsedToolsSummary tools={message.toolUse} />}
          {!hideTools && message.toolUse && message.toolUse.length === 1 && (
            <AiToolCallCard key={message.toolUse[0].id} tool={message.toolUse[0]} />
          )}
          {message.content && <ChatMarkdown text={message.content} workspacePath={workspacePath} onOpenFile={onOpenFile} />}
        </div>
      )}
      {showMeta && (
        <div className="ai-tab__message-meta flex items-center gap-2 text-[11px] text-ide-text-muted/50 px-1 group/meta">
          <span className="inline-flex items-center gap-0.5">
            <span className="text-sm">✻</span>
            <span>Churned for {((message.durationMs || 0) / 1000).toFixed(1)}s</span>
            {message.isAborted && <span className="text-ide-text-muted/40"> · paused by user</span>}
          </span>
          {copyText && <CopyButton text={copyText} />}
        </div>
      )}
    </div>
  )
}

function AiErrorMessage({ message }: { message: AiMessage }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const handleCopyCmd = useCallback(() => {
    if (message.installCmd) {
      navigator.clipboard.writeText(message.installCmd).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }, [message.installCmd])

  return (
    <div className="ai-tab__error px-3 py-2 rounded-2xl rounded-tl-md bg-ide-danger/10 border border-ide-danger/25 text-ide-danger text-xs animate-fade-in">
      {message.error}
      {message.installCmd && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <code className="ai-tab__error-cmd px-1.5 py-0.5 bg-ide-bg/60 rounded text-[10px] font-mono text-ide-text-muted flex-1 truncate">
            {message.installCmd}
          </code>
          <button
            onClick={handleCopyCmd}
            className="ai-tab__error-copy-btn shrink-0 px-1.5 py-0.5 text-[10px] border border-ide-border hover:bg-ide-hover text-ide-text-muted rounded transition-colors"
          >
            {copied ? '✓' : t('Copy')}
          </button>
        </div>
      )}
    </div>
  )
}

function TodoListPanel({ items }: { items: TodoItem[] }) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const completed = items.filter(i => i.status === 'completed').length
  const total = items.length

  return (
    <div className="ai-tab__todo-panel shrink-0 border-b border-ide-border/30 animate-fade-in">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="ai-tab__todo-toggle w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-ide-hover/30 transition-colors"
      >
        <ListTodo size={13} className="text-ide-accent shrink-0" />
        <span className="text-[11px] font-medium text-ide-text-muted">
          {t('Tasks')} ({completed}/{total})
        </span>
        <ChevronDown size={11} className={`ml-auto text-ide-text-muted/50 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && (
        <div className="px-2 pb-1.5 space-y-0.5">
          {items.map(item => {
            const isCompleted = item.status === 'completed'
            const isInProgress = item.status === 'in_progress'
            return (
              <div key={item.id} className="ai-tab__todo-item flex items-center gap-2 px-1 py-0.5 text-xs">
                {isCompleted ? (
                  <Check size={12} className="text-ide-success shrink-0" />
                ) : isInProgress ? (
                  <Loader2 size={12} className="text-ide-accent shrink-0 animate-spin" />
                ) : (
                  <Circle size={12} className="text-ide-text-muted/40 shrink-0" />
                )}
                <span className={`ai-tab__todo-text truncate ${isCompleted ? 'ai-tab__todo-text--completed line-through text-ide-text-muted/40' : 'text-ide-text'}`}>
                  {item.subject}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const AiMessageBubble = React.memo(function AiMessageBubble({ message, workspacePath, onOpenFile, userMessageIndex, totalUserMessages, isBusy, onRevert, onRevertAndCode, onFork, msgIndex, allMessages, viewMode, isInternal }: {
  message: AiMessage
  workspacePath: string | null
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  userMessageIndex: number
  totalUserMessages: number
  isBusy: boolean
  onRevert: (idx: number) => void
  onRevertAndCode: (idx: number) => void
  onFork: (idx: number) => void
  msgIndex: number
  allMessages: AiMessage[]
  viewMode?: number
  isInternal?: boolean
}) {
  let copyText: string | undefined
  if (message.type === 'result' && message.numTurns != null) {
    for (let j = msgIndex - 1; j >= 0; j--) {
      const prev = allMessages[j]
      if (prev.type === 'assistant' && prev.content) { copyText = prev.content; break }
      if (prev.type !== 'assistant') break
    }
  }
  let inner: React.ReactNode
  if (message.error) {
    inner = <AiErrorMessage message={message} />
  } else if (message.role === 'user') {
    inner = <AiUserMessage message={message} userMessageIndex={userMessageIndex} totalUserMessages={totalUserMessages} isBusy={isBusy} onRevert={onRevert} onRevertAndCode={onRevertAndCode} onFork={onFork} isInternal={isInternal} />
  } else if (
    message.type === 'result'
    && message.costUsd == null
    && message.numTurns == null
    && message.subtype !== 'error_max_tokens'
    && message.subtype !== 'error_during_execution'
    && !message.isAborted
  ) {
    // success 且无 meta → 重复消息，不渲染
    return null
  } else {
    inner = <AiAssistantMessage message={message} workspacePath={workspacePath} onOpenFile={onOpenFile} copyText={copyText} viewMode={viewMode} />
  }

  return <>{inner}</>
})

const MODE_OPTIONS: { value: AiPermissionMode; label: string; icon: string }[] = [
  { value: 'plan', label: 'Plan', icon: '📋' },
  { value: 'acceptEdits', label: 'Edit', icon: '✏️' },
  { value: 'bypassPermissions', label: 'Auto', icon: '🔓' },
]

// ── ContextBar ──────────────────────────────────────────────────────
function ContextBar({ percent }: { percent: number | null }) {
  const pct = percent ?? 0
  const TOTAL = 10
  const filled = Math.round(pct / 100 * TOTAL)

  const colorClass =
    pct >= 80 ? 'bg-ide-danger'
    : pct >= 50 ? 'bg-ide-warning'
    : 'bg-ide-success'

  const textColor =
    pct >= 80 ? 'text-ide-danger'
    : pct >= 50 ? 'text-ide-warning'
    : 'text-ide-success'

  return (
    <div
      className="ai-tab__context-bar flex items-center gap-1.5 shrink-0"
      title={`${pct}% context used`}
    >
      {/* energy bar frame */}
      <div className="ai-tab__context-bar-frame flex gap-[2px] border-2 border-ide-border/80 rounded-md px-[3px] py-[3px]">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <div
            key={i}
            className={`ai-tab__context-bar-cell w-[5px] h-3 rounded-[2px] transition-all duration-500 ${
              i < filled ? `ai-tab__context-bar-cell--filled ${colorClass}` : 'bg-ide-border/25'
            }`}
          />
        ))}
      </div>
      <span className={`ai-tab__context-bar-pct text-[10px] font-mono leading-none tabular-nums ${textColor}`}>
        {pct}%
      </span>
    </div>
  )
}

// ── ModelBadge ──────────────────────────────────────────────────────
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku']

function ModelBadge({
  model,
  sessionId,
}: {
  model: string
  sessionId: string | null
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const prevModelRef = useRef(model)

  const displayModel = pendingModel || model

  const shortName = (() => {
    if (!displayModel) return ''
    return displayModel
  })()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); e.stopPropagation() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleSelect = useCallback((alias: string) => {
    if (!sessionId) return
    prevModelRef.current = model
    setPendingModel(alias)
    setOpen(false)
    window.api.ai.setModel(sessionId, alias)
    // 在对话内显示一条 /model 切换记录（仅显示用途；revert 索引由主进程 userTurns 定位，不依赖此条）
    aiStore.updateSession(sessionId, (s) => ({
      ...s,
      messages: [...s.messages, { sessionId, type: 'user' as const, role: 'user' as const, content: `/model ${alias}`, timestamp: Date.now() }],
    }))
  }, [sessionId, model])

  useEffect(() => {
    if (pendingModel && model && model !== prevModelRef.current) {
      setPendingModel(null)
    }
  }, [model, pendingModel])

  const currentAlias = MODEL_ALIASES.find(a => {
    if (!model) return false
    const resolved = model.toLowerCase()
    return resolved.includes(a) || resolved.includes({ opus: 'pro', sonnet: 'pro', haiku: 'flash' }[a] || '')
  })

  return (
    <div ref={ref} className="ai-tab__model relative shrink-0">
      <button
        type="button"
        onClick={() => sessionId && setOpen(v => !v)}
        className={`ai-tab__model-btn flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full
          transition-colors leading-tight
          ${sessionId
            ? 'bg-ide-border/30 text-ide-text-muted hover:bg-ide-hover hover:text-ide-text cursor-pointer'
            : 'bg-ide-border/15 text-ide-text-muted/40 cursor-default'
          }`}
        title={model || 'Model'}
        disabled={!sessionId}
      >
        <span className="truncate max-w-[160px]">{shortName || 'default'}</span>
        {sessionId && <ChevronDown size={10} className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <div className="ai-tab__model-dropdown absolute bottom-full right-0 mb-1.5 z-30
          bg-ide-sidebar border border-ide-border rounded-lg
          shadow-lg min-w-[110px] py-0.5 animate-fade-in">
          {MODEL_ALIASES.map(alias => {
            const isCurrent = !pendingModel && alias === currentAlias
            return (
              <button
                key={alias}
                type="button"
                onClick={() => handleSelect(alias)}
                className={`ai-tab__model-option w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                  isCurrent
                    ? 'ai-tab__model-option--selected bg-ide-accent/15 text-ide-accent'
                    : 'text-ide-text hover:bg-ide-hover'
                }`}
              >
                <span className="truncate">{alias}</span>
                {isCurrent && <Check size={10} className="ml-auto shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── ModeSelector ──────────────────────────────────────────────────────
function ModeSelector({
  value,
  onChange,
}: {
  value: AiPermissionMode
  onChange: (mode: AiPermissionMode) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = MODE_OPTIONS.find(o => o.value === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); e.stopPropagation() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div ref={ref} className="ai-tab__mode relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="ai-tab__mode-btn flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg
                   text-ide-text-muted hover:text-ide-text hover:bg-ide-hover
                   transition-colors"
        title={`${current?.label} mode`}
      >
        <span className="text-sm">{current?.icon}</span>
        <span className="max-w-[60px] truncate">{current?.label}</span>
        <ChevronDown size={12} className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="ai-tab__mode-dropdown absolute bottom-full right-0 mb-1.5 z-30
                        bg-ide-sidebar border border-ide-border rounded-lg
                        shadow-lg min-w-[130px] py-0.5 animate-fade-in">
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`ai-tab__mode-option w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                opt.value === value
                  ? 'ai-tab__mode-option--selected bg-ide-accent/15 text-ide-accent'
                  : 'text-ide-text hover:bg-ide-hover'
              }`}
            >
              <span className="text-xs shrink-0">{opt.icon}</span>
              <span className="truncate">{opt.label}</span>
              {opt.value === value && <Check size={10} className="ml-auto shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SlashCommandAutocomplete ──────────────────────────────────────

function SlashCommandAutocomplete({
  commands,
  filter,
  selectedIndex,
  onSelect,
  onClose,
}: {
  commands: AiSlashCommand[]
  filter: string
  selectedIndex: number
  onSelect: (cmd: AiSlashCommand) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement>(null)
  const filtered = commands.filter(c => c.name.toLowerCase().startsWith(filter.toLowerCase()))
  useEffect(() => {
    listRef.current?.querySelector(`[data-slash-idx="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, filter])
  if (filtered.length === 0) return null

  return (
    <div ref={listRef} className="ai-tab__slash-menu absolute bottom-full left-0 right-0 mb-1 bg-ide-sidebar border border-ide-border rounded shadow-lg z-20 max-h-48 overflow-y-auto animate-fade-in">
      {filtered.map((cmd, i) => {
        const globalIndex = commands.filter(c => c.name.toLowerCase().startsWith(filter.toLowerCase())).indexOf(cmd)
        return (
          <button
            key={cmd.name}
            data-slash-idx={globalIndex}
            onClick={() => onSelect(cmd)}
            className={`ai-tab__slash-menu-item w-full flex items-center gap-2 px-2 py-1.5 text-[11px] transition-colors ${
              globalIndex === selectedIndex
                ? 'ai-tab__slash-menu-item--selected bg-ide-accent/15 text-ide-accent'
                : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
            }`}
          >
            <span className="ai-tab__slash-menu-cmd font-mono text-ide-accent shrink-0">/{cmd.name}</span>
            {cmd.argumentHint && <span className="text-ide-text-muted/50 text-[10px] shrink-0">{cmd.argumentHint}</span>}
            <span className="truncate">{cmd.description}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── MentionAutocomplete ───────────────────────────────────────────

interface MentionItem {
  name: string
  path: string
  type: 'file' | 'directory'
  relativePath: string
}

function FileMentionIcon({ name }: { name: string }) {
  const info = getFileInfo(name)
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 shrink-0 ${info.color}`}
         dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
  )
}

function MentionAutocomplete({
  items,
  selectedIndex,
  onSelect,
}: {
  items: MentionItem[]
  selectedIndex: number
  onSelect: (item: MentionItem) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector(`[data-mention-idx="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, items])
  if (items.length === 0) return null
  return (
    <div ref={listRef} className="ai-tab__slash-menu absolute bottom-full left-0 right-0 mb-1 bg-ide-sidebar border border-ide-border rounded shadow-lg z-20 max-h-48 overflow-y-auto animate-fade-in">
      {items.map((item, i) => (
        <button
          key={item.path}
          data-mention-idx={i}
          onClick={() => onSelect(item)}
          className={`ai-tab__slash-menu-item w-full flex items-center gap-2 px-2 py-1.5 text-[11px] transition-colors ${
            i === selectedIndex
              ? 'ai-tab__slash-menu-item--selected bg-ide-accent/15 text-ide-accent'
              : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
          }`}
        >
          {item.type === 'directory'
            ? <Folder size={12} strokeWidth={2} className="shrink-0 text-ide-accent" />
            : <FileMentionIcon name={item.name} />}
          <span className="truncate font-mono">{item.relativePath}</span>
        </button>
      ))}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────

const BUSY_QUIPS = [
  'Forging the digital frontier…',
  'The empire, long divided, must unite…',
  'Defending the sacred source…',
  'Decrypting the matrix, one token at a time…',
  'Wrestling with the thought daemons…',
  'Aligning the cosmic bits…',
  'The bytes must flow…',
  'Resisting the centralized compiler…',
  'A bug in time saves nine…',
  'Long live the open-source rebellion…',
]

const AiTab = forwardRef<AiTabHandle, AiTabProps>(function AiTab({ activeSessionId, workspacePath, isActive, autoApprove, permissionMode, onPermissionModeChange, onViewAi, onRenameSession, onOpenFile, onForkSession, onAgentStatusChange, resumeSessionId, brushActive, lastOpenedFile, worktreeNav, onWorktreeNavChange, onCommand }, ref) {
  const { t } = useI18n()
  const busyQuip = useMemo(() => BUSY_QUIPS[Math.floor(Math.random() * BUSY_QUIPS.length)], [])
  const containerRef = useRef<HTMLDivElement>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // AI session state — shared singleton store (进程级单例,消除 N 倍冗余)
  const state = useAiSession(activeSessionId)

  const busyStartRef = useRef<number>(0)
  const [busySeconds, setBusySeconds] = useState(0)
  useEffect(() => {
    if (state.busy) {
      if (!busyStartRef.current) busyStartRef.current = Date.now()
      const tick = () => setBusySeconds(Math.floor((Date.now() - busyStartRef.current) / 1000))
      tick()
      const id = setInterval(tick, 1000)
      return () => clearInterval(id)
    }
    busyStartRef.current = 0
    setBusySeconds(0)
  }, [state.busy])
  const busyTimeLabel = busySeconds >= 10
    ? busySeconds >= 60
      ? ` (${Math.floor(busySeconds / 60)}m ${busySeconds % 60}s)`
      : ` (${busySeconds}s)`
    : ''

  // Sync AI busy state to parent agentStatus (OR with terminal detection)
  useEffect(() => {
    if (!activeSessionId || !onAgentStatusChange) return
    onAgentStatusChange(activeSessionId, state.busy ? 'running' : 'idle')
  }, [activeSessionId, state.busy, onAgentStatusChange])

  // Auto-rename session from first user message — store 只设 state.name,
  // 副作用(持久化 rename)在此触发。用 ref 持有 onRenameSession,避免
  // 内联 prop 引用变化导致 effect 频繁重跑(只在 name 真正变化时触发)。
  const onRenameSessionRef = useRef(onRenameSession)
  onRenameSessionRef.current = onRenameSession
  useEffect(() => {
    if (!activeSessionId || !state.name) return
    onRenameSessionRef.current?.(state.name)
  }, [activeSessionId, state.name])

  // Session history
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false)
  const [sessionHistoryList, setSessionHistoryList] = useState<any[]>([])
  const [viewMode, setViewMode] = useState(0) // 0=all, 1=hide tools, 2=hide tools+think
  const [worktreeEnabled, setWorktreeEnabled] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  // Close session history on outside click + Escape
  useEffect(() => {
    if (!sessionHistoryOpen) return
    const handleClick = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setSessionHistoryOpen(false)
        setSessionHistoryList([])
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSessionHistoryOpen(false)
        setSessionHistoryList([])
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [sessionHistoryOpen])

  // Input
  // Per-session draft keyed by sessionId — survives session switching.
  // Uses activeSessionIdRef so setInputValue identity stays stable across sessionId
  // changes (matters for memoized child components consuming the setter).
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const inputValue = activeSessionId ? (inputValues[activeSessionId] || '') : ''
  const setInputValue = useCallback((v: string) => {
    const sid = activeSessionIdRef.current
    if (!sid) return
    setInputValues(prev => ({ ...prev, [sid]: v }))
  }, [])
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [mentionMenuOpen, setMentionMenuOpen] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)
  const [mentionResults, setMentionResults] = useState<MentionItem[]>([])
  const mentionTriggerStartRef = useRef(0)
  const mentionReqIdRef = useRef(0)

  const closeMention = useCallback(() => {
    setMentionMenuOpen(false)
    setMentionFilter('')
    setMentionResults([])
    setMentionSelectedIndex(0)
  }, [])

  const selectMention = useCallback((item: MentionItem) => {
    const el = inputRef.current
    if (el) {
      const start = mentionTriggerStartRef.current
      const end = el.selectionStart ?? el.value.length
      const insert = `@${item.relativePath} `
      el.setRangeText(insert, start, end, 'end')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.focus({ preventScroll: true })
    }
    closeMention()
  }, [closeMention])

  useEffect(() => {
    if (!mentionMenuOpen || !workspacePath) { setMentionResults([]); return }
    const query = mentionFilter
    if (!query) { setMentionResults([]); return }
    const reqId = ++mentionReqIdRef.current
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.file.searchByName(workspacePath, query, loadFilterRules())
        if (mentionReqIdRef.current !== reqId) return
        if (res && !res.error) {
          setMentionResults(res.matches || [])
          setMentionSelectedIndex(0)
        } else {
          setMentionResults([])
        }
      } catch {
        if (mentionReqIdRef.current === reqId) setMentionResults([])
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [mentionMenuOpen, mentionFilter, workspacePath])

  useEffect(() => { closeMention() }, [activeSessionId, closeMention])

  useImperativeHandle(ref, () => ({
    focus: () => { inputRef.current?.focus({ preventScroll: true }) },
    setValue: (text: string) => { setInputValue(text) },
    appendText: (text: string) => {
      const sid = activeSessionIdRef.current
      if (!sid) return
      setInputValues(prev => {
        const cur = prev[sid] || ''
        const sep = cur.trim() ? ';\n' : ''
        return { ...prev, [sid]: cur + sep + text }
      })
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
        el.focus({ preventScroll: true })
        el.selectionStart = el.selectionEnd = el.value.length
        el.scrollTop = el.scrollHeight
      })
    },
  }), [setInputValue, setInputValues])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = 200
    const newH = Math.min(el.scrollHeight, maxH)
    el.style.height = `${newH}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [inputValue])

  // ── Update session state helper(委托给单例 store)──
  const updateSession = useCallback((sessionId: string, updater: (s: AiSessionState) => AiSessionState) => {
    aiStore.updateSession(sessionId, updater)
  }, [])

  // ── IPC listeners(sessionStates / onMessage / onStreamToken / onPermission /
  // onReady / onError)已上提到 aiStore 单例,此处不再重复注册。──

  // ── Session lifecycle: check availability then auto-create AI session ──
  useEffect(() => {
    if (!activeSessionId || !workspacePath) return
    const cliCommand = (() => {
      try { return localStorage.getItem('vibe-ide-ai-cli-command') || undefined } catch { return undefined }
    })()
    aiStore.ensureCreated(activeSessionId, {
      cwd: workspacePath,
      autoApprove,
      permissionMode,
      ...(resumeSessionId ? { resumeSessionId } : {}),
      cliCommand,
      ...(worktreeEnabled ? { enableWorktree: true } : {}),
    })
  }, [activeSessionId, workspacePath, worktreeEnabled])

  // ── Cleanup destroyed sessions ──
  const handleDestroySession = useCallback((sessionId: string) => {
    window.api.ai.destroy(sessionId)
    aiStore.clearSession(sessionId)
    onWorktreeNavChange?.(prev => {
      if (!prev[sessionId]) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [onWorktreeNavChange])

  useEffect(() => {
    if (!activeSessionId || !workspacePath || !state.worktreePath || !onWorktreeNavChange) return
    const wtp = state.worktreePath
    onWorktreeNavChange(prev => {
      if (prev[activeSessionId]?.worktreePath === wtp) return prev
      return {
        ...prev,
        [activeSessionId]: {
          originalPath: workspacePath,
          worktreePath: wtp,
          originalBranch: '',
        }
      }
    })
  }, [activeSessionId, workspacePath, state.worktreePath, onWorktreeNavChange])

  // ── Smart auto-scroll: passive listener + threshold ──
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledUpRef.current = distFromBottom > 40
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const scrollRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (userScrolledUpRef.current) return
    if (scrollRafRef.current != null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      if (!userScrolledUpRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
      }
    })
  }, [state.messages.length, state.streamBuffer, state.thinkingBuffer])

  // ── Focus input when tab becomes active ──
  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus({ preventScroll: true })
    }
  }, [isActive])

  // ── Dispatch a message to the subprocess (shared core) ──
  // Immediate send and piped auto-send both funnel through here.
  const dispatchMessage = useCallback(async (message: string) => {
    if (!activeSessionId || !message.trim()) return
    const isSlash = message.startsWith('/')
    const isClear = message.startsWith('/clear')
    onCommand?.(message)
    updateSession(activeSessionId, (s) => {
      const newName = !s.name && !isSlash ? message.slice(0, 60) : s.name
      const userMsg = { sessionId: activeSessionId, type: 'user' as const, role: 'user' as const, content: message, timestamp: Date.now() }
      return {
        ...s, busy: true, name: newName, pipedPrompt: '',
        messages: isClear ? [] : [...s.messages, userMsg],
        ...(isClear ? { fileChangesByTurn: [], userTurns: [] } : {}),
      }
    })
    await window.api.ai.send(activeSessionId, message)
  }, [activeSessionId, updateSession])

  // ── Send handler (immediate, idle only) ──
  const handleSend = useCallback(async () => {
    if (!activeSessionId || !inputValue.trim() || state.busy) return
    const message = inputValue.trim()
    setInputValue('')
    await dispatchMessage(message)
  }, [activeSessionId, inputValue, state.busy, setInputValue, dispatchMessage])

  // ── Enter key: pipe while busy, send when idle ──
  // While the agent is running, Enter appends the draft to a per-session
  // pipedPrompt buffer (shown as a "piped" chip) instead of sending; the
  // buffer is auto-dispatched when the session returns to idle.
  const handleEnter = useCallback(() => {
    if (!activeSessionId || !inputValue.trim()) return
    if (state.busy) {
      const text = inputValue.trim()
      setInputValue('')
      updateSession(activeSessionId, (s) => {
        const prev = s.pipedPrompt || ''
        const sep = prev ? '\n' : ''
        return { ...s, pipedPrompt: prev + sep + text }
      })
      return
    }
    handleSend()
  }, [activeSessionId, inputValue, state.busy, setInputValue, updateSession, handleSend])

  // ── Auto-dispatch piped prompt when session returns to idle ──
  // busy true→false (turn done) and no pending permission → flush piped.
  const prevBusyRef = useRef(state.busy)
  useEffect(() => {
    const wasBusy = prevBusyRef.current
    prevBusyRef.current = state.busy
    if (!wasBusy || state.busy || state.pendingPermission || !activeSessionId) return
    const piped = (state.pipedPrompt || '').trim()
    if (!piped) return
    dispatchMessage(piped)
  }, [state.busy, state.pendingPermission, activeSessionId, dispatchMessage, state.pipedPrompt])

  // ── ExitPlanMode "Clear & Execute": kill plan-mode subprocess, respawn in bypassPermissions,
  // re-inject plan from disk as first message. onDeny 委托 aiStore.handlePlanDeny;
  // onClearExecute 需切 UI permission mode 故留组件内(被调先于主调)。
  const modelRef = useRef(state.model)
  modelRef.current = state.model
  const handlePlanClearExecute = useCallback(async (sessionId: string, planFilePath: string, modelOverride?: string) => {
    if (!planFilePath) return
    updateSession(sessionId, (s) => ({
      ...s,
      pendingPermission: null,
      streaming: false,
      streamBuffer: '',
      thinkingBuffer: '',
      thinkingStartedAt: null,
      busy: true,
      ready: false,
    }))
    onPermissionModeChange('bypassPermissions')
    const model = modelOverride || modelRef.current
    await window.api.ai.clearAndExecutePlan(sessionId, planFilePath, model)
  }, [updateSession, onPermissionModeChange])

  // ── ExitPlanMode "Continue": kill + --resume respawn → restore full context ──
  const handlePlanContinue = useCallback(async (sessionId: string, requestId: string, modelOverride?: string) => {
    if (!requestId) return
    updateSession(sessionId, (s) => ({
      ...s,
      pendingPermission: null,
      streaming: false,
      streamBuffer: '',
      thinkingBuffer: '',
      thinkingStartedAt: null,
      busy: true,
      ready: false,
    }))
    onPermissionModeChange('bypassPermissions')
    const model = modelOverride || modelRef.current
    await window.api.ai.clearAndExecutePlan(sessionId, '', model, true)
  }, [updateSession, onPermissionModeChange])

  // ── Revert / Fork handlers ──────────────────────────────────────

  const handleRevert = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !workspacePath) return

    const targetMsgIdx = findMessageIndexForUserMessage(state.messages, userMessageIndex)
    if (targetMsgIdx < 0) return

    const savedMessages = state.messages
    const savedFileChanges = state.fileChangesByTurn

    const truncatedMessages = state.messages.slice(0, targetMsgIdx)
    const truncatedFileChanges = state.fileChangesByTurn.slice(0, userMessageIndex)

    if (targetMsgIdx >= 0 && state.messages[targetMsgIdx]?.content) {
      setInputValue(state.messages[targetMsgIdx].content!)
    }

    updateSession(activeSessionId, (s) => ({
      ...s,
      messages: truncatedMessages,
      fileChangesByTurn: truncatedFileChanges,
      busy: false,
      streaming: false, streamBuffer: '', thinkingBuffer: '', thinkingStartedAt: null,
      pendingPermission: null,
    }))

    const result = await window.api.ai.revert({
      sessionId: activeSessionId,
      userMessageIndex,
      scope: 'conversation',
      cwd: workspacePath,
    })

    if (!result.success) {
      updateSession(activeSessionId, (s) => ({
        ...s,
        messages: savedMessages,
        fileChangesByTurn: savedFileChanges,
        busy: false,
      }))
    } else {
      aiStore.refreshUserTurns(activeSessionId)
    }
  }, [activeSessionId, workspacePath, state.messages, state.fileChangesByTurn, updateSession, setInputValue])

  const handleRevertAndCode = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !workspacePath) return

    const targetMsgIdx = findMessageIndexForUserMessage(state.messages, userMessageIndex)
    if (targetMsgIdx < 0) return

    const filesToRevert = new Map<string, { filePath: string; action: string; oldContent?: string }>()
    for (let turn = userMessageIndex; turn < state.fileChangesByTurn.length; turn++) {
      const changes = state.fileChangesByTurn[turn]
      if (!changes) continue
      for (const change of changes) {
        if (!filesToRevert.has(change.relativePath)) {
          filesToRevert.set(change.relativePath, {
            filePath: change.filePath,
            action: change.action,
            oldContent: change.oldContent,
          })
        }
      }
    }

    for (const [, info] of filesToRevert) {
      try {
        if (info.action === 'create') {
          await window.api.file.delete(info.filePath)
        } else if (info.oldContent != null) {
          await window.api.file.write(info.filePath, info.oldContent)
        }
      } catch (err) { console.error('file revert failed:', err) }
    }

    await handleRevert(userMessageIndex)
  }, [handleRevert, workspacePath, state.messages, state.fileChangesByTurn])

  const handleFork = useCallback(async (userMessageIndex: number) => {
    if (!activeSessionId || !onForkSession) return
    onForkSession(userMessageIndex)
  }, [activeSessionId, onForkSession])

  // ── Todo list ──
  const todoItems = useMemo(() => deriveTodoList(state.messages), [state.messages])

  // ── Status text ──
  const statusText = !state.ready
    ? t('Connecting...')
    : state.streaming
      ? t('Streaming...')
      : null

  // ── Copy entire conversation ──
  const [conversationCopied, setConversationCopied] = useState(false)
  const handleCopyConversation = useCallback(() => {
    const includeThinking = viewMode !== 2
    const includeToolUse = viewMode === 0
    const text = formatConversationMarkdown(
      state.messages, state.userTurns, state.name, includeThinking, includeToolUse
    )
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        setConversationCopied(true)
        setTimeout(() => setConversationCopied(false), 1500)
      })
    }
  }, [state.messages, state.userTurns, state.name, viewMode])

  const lastFile = useMemo(() => {
    if (!lastOpenedFile) return null
    const f = lastOpenedFile
    let relPath = f.path
    if (workspacePath && relPath.startsWith(workspacePath)) {
      relPath = relPath.slice(workspacePath.length).replace(/^[\\\/]+/, '')
    }
    relPath = relPath.replace(/\\/g, '/')
    const fileName = relPath.split('/').pop() || relPath
    let label = fileName
    let ref = relPath
    if (f.line) {
      label += `:${f.line}`
      ref += ` around line ${f.line}`
      if (f.endLine && f.endLine !== f.line) {
        label += `:${f.endLine}`
        ref += `:${f.endLine}`
      }
    }
    return { label, ref }
  }, [lastOpenedFile, workspacePath])

  return (
    <div ref={containerRef} tabIndex={-1} className="ai-tab relative flex-1 flex flex-col overflow-hidden outline-none focus:outline-none focus:ring-0">
      {/* Header */}
      <div className="ai-tab__header flex items-center justify-between px-2 py-1 border-b border-ide-border shrink-0 acrylic-titlebar-clean">
        <div className="ai-tab__header-left flex items-center gap-1.5 min-w-0">
            <span className="ai-tab__session-name text-xs font-medium text-ide-text truncate">{state.name || 'untitled'}</span>
          </div>
        <div className="ai-tab__header-actions flex items-center gap-1">
          {/* Copy conversation */}
          <button
            onClick={handleCopyConversation}
            disabled={state.messages.length === 0}
            className="ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('Copy as Markdown (content follows eye filter)')}
          >
            {conversationCopied ? <Check size={14} className="text-ide-accent" /> : <Copy size={14} />}
          </button>
          {/* Toggle tool visibility */}
          <button
            onClick={() => setViewMode(v => (v + 1) % 3)}
            className={`ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors ${viewMode === 2 ? 'ai-tab__header-btn--active bg-ide-active' : ''}`}
            title={viewMode === 0 ? t('Show All') : viewMode === 1 ? t('Hide Tools') : t('Hide Tools & Think')}
          >
            {viewMode === 0 ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          {/* Session history */}
          <button
            onClick={async () => {
              const result = await window.api.ai.listSessions(workspacePath || undefined)
              if (result.sessions?.length > 0) {
                setSessionHistoryList(result.sessions)
                setSessionHistoryOpen(true)
              }
            }}
            className="ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
            title={t('Session History')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          {/* Worktree isolation toggle — hidden if already navigated from GitTab */}
          {!worktreeNav?.worktreePath && (
            <button
              onClick={() => {
                if (!activeSessionId || !workspacePath) return
                const next = !worktreeEnabled
                setWorktreeEnabled(next)
                handleDestroySession(activeSessionId)
                const cliCommand = (() => {
                  try { return localStorage.getItem('vibe-ide-ai-cli-command') || undefined } catch { return undefined }
                })()
                aiStore.ensureCreated(activeSessionId, {
                  cwd: workspacePath,
                  autoApprove,
                  permissionMode,
                  cliCommand,
                  ...(next ? { enableWorktree: true } : {}),
                })
                onViewAi()
              }}
              className={`ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center transition-colors ${
                worktreeEnabled
                  ? 'bg-ide-accent/20 text-ide-accent'
                  : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
              }`}
              title={t('Isolate in worktree')}
            >
              <GitBranch size={14} />
            </button>
          )}
          {/* New session */}
          <button
            onClick={() => {
              if (!activeSessionId || !workspacePath) return
              handleDestroySession(activeSessionId)
              const cliCommand = (() => {
                try { return localStorage.getItem('vibe-ide-ai-cli-command') || undefined } catch { return undefined }
              })()
              aiStore.ensureCreated(activeSessionId, {
                cwd: workspacePath,
                autoApprove,
                permissionMode,
                cliCommand,
                ...(worktreeEnabled ? { enableWorktree: true } : {}),
              })
              onViewAi()
            }}
            className="ai-tab__header-btn w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
            title={t('New Session')}
          >
            <MessageSquarePlus size={14} />
          </button>
        </div>
      </div>
      {/* Session history dropdown */}
      {sessionHistoryOpen && sessionHistoryList.length > 0 && (
        <div ref={historyRef} className="ai-tab__history-dropdown absolute top-8 right-2 bg-ide-sidebar border border-ide-border rounded-lg shadow-lg z-20 max-h-[28rem] overflow-y-auto w-80 animate-fade-in">
          {sessionHistoryList.map((s: any) => {
            const timeStr = s.timestamp ? new Date(s.timestamp).toLocaleString() : ''
            return (
              <button
                key={s.session_id || s.id}
                onClick={async () => {
                  if (activeSessionId) {
                    // Load conversation history from .jsonl before resuming
                    const history = await window.api.ai.loadSessionMessages(s.session_id || s.id, workspacePath || '')
                    const sessionName = s.name && s.name !== s.session_id ? s.name : ''
                    updateSession(activeSessionId, () => ({
                      ...EMPTY_SESSION,
                      messages: history.messages,
                      model: history.model || '',
                      slashCommands: enrichSlashCommands(history.slashCommands || []),
                      name: sessionName,
                      cwd: workspacePath || '',
                      ready: false,
                      resumeSessionId: s.session_id || s.id,
                    }))
                    await window.api.ai.destroy(activeSessionId)
                    const cliCommand = (() => {
                      try { return localStorage.getItem('vibe-ide-ai-cli-command') || undefined } catch { return undefined }
                    })()
                    window.api.ai.create({
                      sessionId: activeSessionId,
                      cwd: workspacePath || '',
                      autoApprove,
                      permissionMode,
                      resumeSessionId: s.session_id || s.id,
                      ...(cliCommand ? { cliCommand } : {}),
                    })
                  }
                  setSessionHistoryOpen(false)
                  setSessionHistoryList([])
                }}
                className="ai-tab__history-item w-full px-2.5 py-2 text-xs text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors text-left"
              >
                <div className="ai-tab__history-item-name truncate">{s.name || s.session_id || s.id}</div>
                {timeStr && (
                  <div className="ai-tab__history-item-meta flex items-center justify-between text-[10px] text-ide-text-muted/50 mt-1">
                    <span className="truncate mr-2">{timeStr}</span>
                    {s.sizeBytes > 0 && <span className="shrink-0">{formatBytes(s.sizeBytes)}</span>}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
      {/* Messages */}
      <div ref={scrollContainerRef} className="ai-tab__messages flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
        {state.messages.length === 0 && !state.streaming && (
          <div className="ai-tab__empty flex flex-col items-center justify-center text-ide-text-muted text-xs pt-8 space-y-3 animate-fade-in">
            <div className="ai-tab__empty-icon animate-zap-glow text-ide-accent">
              <svg
                fill="currentColor"
                fillRule="evenodd"
                height={64}
                width={64}
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  clipRule="evenodd"
                  d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
                />
              </svg>
            </div>
            <div className="ai-tab__empty-prompts flex flex-wrap justify-center gap-1.5 pt-2 max-w-[280px]">
              {EXAMPLE_PROMPTS.map((item, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const text = t(item.prompt)
                    setInputValue(text)
                    const el = inputRef.current
                    if (el) {
                      el.value = text
                      el.dispatchEvent(new Event('input', { bubbles: true }))
                      el.focus()
                      el.selectionStart = el.selectionEnd = text.length
                      el.scrollTop = el.scrollHeight
                    }
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className="ai-tab__example-btn px-3 py-1.5 text-xs border border-ide-border rounded-full text-ide-text-muted hover:text-ide-text hover:bg-ide-hover hover:border-ide-accent/30 transition-colors"
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>
        )}
        {(() => {
          const userMessages = state.messages.filter(m => m.role === 'user' && m.content && m.type === 'user')
          const totalUserMessages = userMessages.length

          const groups: Array<{ type: 'agent'; messages: AiMessage[]; parentId: string; startIndex: number } | { type: 'msg'; message: AiMessage; index: number }> = []
          for (let i = 0; i < state.messages.length; i++) {
            const msg = state.messages[i]
            if (msg.parentToolUseId) {
              const prev = groups[groups.length - 1]
              if (prev && prev.type === 'agent' && prev.parentId === msg.parentToolUseId) {
                prev.messages.push(msg)
              } else {
                groups.push({ type: 'agent', messages: [msg], parentId: msg.parentToolUseId, startIndex: i })
              }
            } else {
              groups.push({ type: 'msg', message: msg, index: i })
            }
          }

          return groups.map((item, gi) => {
            if (item.type === 'agent') {
              return <CollapsibleAgentGroup key={`agent-${item.startIndex}`} messages={item.messages} workspacePath={workspacePath} onOpenFile={onOpenFile} viewMode={viewMode} />
            }
            const msg = item.message
            const uIdx = msg.role === 'user' && msg.content && msg.type === 'user'
              ? userMessages.indexOf(msg)
              : -1
            return (
              <AiMessageBubble
                key={item.index}
                message={msg}
                msgIndex={item.index}
                allMessages={state.messages}
                workspacePath={workspacePath}
                onOpenFile={onOpenFile}
                userMessageIndex={uIdx}
                totalUserMessages={totalUserMessages}
                isBusy={state.busy}
                onRevert={handleRevert}
                onRevertAndCode={handleRevertAndCode}
                onFork={handleFork}
                viewMode={viewMode}
                isInternal={state.userTurns[uIdx]?.isInternal ?? false}
              />
            )
          })
        })()}
        {/* Busy indicator — thinking + streaming + sparkle */}
        {state.busy && (
          <div className="ai-tab__busy max-w-[92%] space-y-1.5 animate-fade-in">
            {state.thinkingBuffer && <ThinkingBlock text={state.thinkingBuffer} defaultOpen autoScroll />}
            {state.streamBuffer ? (
              <div>
                <StreamingMarkdown text={state.streamBuffer} workspacePath={workspacePath} onOpenFile={onOpenFile} />
                <span className="ai-tab__busy-sparkle animate-sparkle ml-0.5 text-sm leading-none align-middle select-none">✻</span>
                <span className="ai-tab__busy-quip ml-0.5 text-xs leading-none align-middle select-none text-ide-accent/60">{busyQuip}{busyTimeLabel}</span>
              </div>
            ) : (
              <div>
                <span className="animate-sparkle text-sm leading-none select-none">✻</span>
                <span className="ml-0.5 text-xs leading-none select-none text-ide-accent/60">{busyQuip}{busyTimeLabel}</span>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Permission popup — floats above input, not inside scroll area */}
      {state.pendingPermission && activeSessionId && (
        state.pendingPermission.tool === 'AskUserQuestion' ? (
          <AiAskQuestionCard
            perm={state.pendingPermission}
            sessionId={activeSessionId}
            onRespond={aiStore.handleAskResume}
          />
        ) : (
          <AiPermissionCard
            perm={state.pendingPermission}
            sessionId={activeSessionId}
            onRespond={aiStore.handlePermissionResponse}
          />
        )
      )}

      {/* Todo list — pins above input so it stays visible */}
      {todoItems.length > 0 && <TodoListPanel items={todoItems} />}

      {/* Piped prompt — queued while busy, auto-sent when idle, X to dismiss */}
      {state.pipedPrompt && activeSessionId && (
        <div className="ai-tab__piped mx-2 mb-1 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-ide-accent/10 border border-ide-accent/30 animate-fade-in">
          <Plug size={12} className="shrink-0 text-ide-accent" />
          <span className="text-[11px] font-medium text-ide-accent/80 shrink-0">{t('Queued')}</span>
          <span className="text-xs text-ide-text/80 truncate flex-1 min-w-0" title={state.pipedPrompt}>{state.pipedPrompt}</span>
          <button
            type="button"
            onClick={() => updateSession(activeSessionId, s => ({ ...s, pipedPrompt: '' }))}
            className="ai-tab__piped-dismiss shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors"
            title={t('Remove')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="ai-tab__input-area shrink-0 p-2">
        <div className="relative">
          {slashMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-20">
              <SlashCommandAutocomplete
                commands={state.slashCommands.length > 0 ? state.slashCommands : enrichSlashCommands(Object.keys(SLASH_COMMAND_DESCRIPTIONS))}
                filter={slashFilter}
                selectedIndex={slashSelectedIndex}
                onSelect={(cmd) => {
                  setInputValue(`/${cmd.name} `)
                  setSlashMenuOpen(false)
                  setSlashFilter('')
                  setSlashSelectedIndex(0)
                  inputRef.current?.focus({ preventScroll: true })
                }}
                onClose={() => {
                  setSlashMenuOpen(false)
                  setSlashFilter('')
                  setSlashSelectedIndex(0)
                }}
              />
            </div>
          )}
          {mentionMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-20">
              <MentionAutocomplete
                items={mentionResults}
                selectedIndex={mentionSelectedIndex}
                onSelect={selectMention}
              />
            </div>
          )}

          {/* Pill container */}
          <div className="ai-tab__input-pill rounded-2xl border border-ide-accent/60
                          bg-ide-sidebar shadow-sm
                          transition-colors focus-within:border-ide-accent">

            {/* Textarea zone */}
            <div className="ai-tab__input-zone px-3 pt-2.5 pb-1.5">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => {
                  const val = e.target.value
                  setInputValue(val)
                  const isSlash = val.startsWith('/')
                  if (isSlash) {
                    const filter = val.slice(1).split(' ')[0]
                    setSlashMenuOpen(true)
                    setSlashFilter(filter)
                    setSlashSelectedIndex(0)
                  } else {
                    setSlashMenuOpen(false)
                    setSlashFilter('')
                  }
                  const el = e.target as HTMLTextAreaElement
                  const caret = el.selectionStart ?? val.length
                  const before = val.slice(0, caret)
                  const m = before.match(/(^|\s)@([^\s@]*)$/)
                  if (m && !isSlash) {
                    mentionTriggerStartRef.current = caret - m[2].length - 1
                    setMentionFilter(m[2])
                    setMentionMenuOpen(true)
                    setMentionSelectedIndex(0)
                  } else if (!m) {
                    setMentionMenuOpen(false)
                  }
                }}
                onKeyDown={(e) => {
                  if (mentionMenuOpen) {
                    if (e.key === 'ArrowDown' && mentionResults.length) {
                      e.preventDefault()
                      setMentionSelectedIndex(prev => (prev + 1) % mentionResults.length)
                      return
                    }
                    if (e.key === 'ArrowUp' && mentionResults.length) {
                      e.preventDefault()
                      setMentionSelectedIndex(prev => (prev - 1 + mentionResults.length) % mentionResults.length)
                      return
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      const item = mentionResults[mentionSelectedIndex]
                      if (item) selectMention(item)
                      else closeMention()
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      closeMention()
                      return
                    }
                  }
                  if (slashMenuOpen) {
                    const activeCommands = state.slashCommands.length > 0 ? state.slashCommands : enrichSlashCommands(Object.keys(SLASH_COMMAND_DESCRIPTIONS))
                    const filtered = activeCommands.filter(c => c.name.toLowerCase().startsWith(slashFilter.toLowerCase()))
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSlashSelectedIndex(prev => (prev + 1) % filtered.length)
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSlashSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length)
                      return
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      if (filtered[slashSelectedIndex]) {
                        setInputValue(`/${filtered[slashSelectedIndex].name} `)
                      }
                      setSlashMenuOpen(false)
                      setSlashFilter('')
                      setSlashSelectedIndex(0)
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setSlashMenuOpen(false)
                      setSlashFilter('')
                      setSlashSelectedIndex(0)
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleEnter()
                  }
                }}
                placeholder={state.ready ? t('Type a message...') : t('Initializing...')}
                disabled={!state.ready}
                onContextMenu={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const el = e.currentTarget as HTMLTextAreaElement
                  el.focus()
                  if (document.execCommand('paste')) return
                  try {
                    const text = await navigator.clipboard.readText()
                    if (text) el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end')
                  } catch {}
                  el.dispatchEvent(new Event('input', { bubbles: true }))
                }}
                className="ai-tab__textarea w-full text-sm bg-transparent px-0 py-0.5 text-ide-text
                           placeholder:text-ide-text-muted/50 resize-none
                           focus:outline-none disabled:opacity-50 leading-relaxed text-sm"
              />
            </div>

            {/* Bottom toolbar */}
            <div className="ai-tab__input-toolbar flex items-center gap-2 px-2 py-1.5
                            border-t border-ide-border/30">
              {/* LEFT: Context bar + model badge */}
              <div className="ai-tab__toolbar-left flex items-center gap-2 shrink-0">
                <ContextBar percent={state.contextPercent} />
                <ModelBadge model={state.model} sessionId={activeSessionId} />
              </div>

              {/* CENTER: flex spacer */}
              <div className="flex-1" />

              {/* RIGHT: Mode selector + Send/Cancel */}
              <div className="ai-tab__toolbar-right flex items-center gap-1 shrink-0">
                {lastFile && (
                  <button
                    type="button"
                    onClick={() => {
                      const atRef = `@${lastFile.ref} `
                      setInputValue(inputValue ? inputValue + ' ' + atRef : atRef)
                      inputRef.current?.focus({ preventScroll: true })
                    }}
                    className="ai-tab__last-file-btn flex items-center gap-1 h-7 px-2 rounded-lg
                               bg-ide-accent/10 hover:bg-ide-accent/20 text-ide-accent
                               transition-colors text-[11px] max-w-[180px]"
                    title={lastFile.ref}
                  >
                    <Plug size={12} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{lastFile.label}</span>
                  </button>
                )}
                <ModeSelector
                  value={permissionMode}
                  onChange={onPermissionModeChange}
                />

                {state.busy ? (
                  <button
                    type="button"
                    onClick={() => activeSessionId && window.api.ai.cancel(activeSessionId)}
                    className="ai-tab__stop-btn w-7 h-7 flex items-center justify-center rounded-lg
                               bg-ide-danger/20 hover:bg-ide-danger/30 text-ide-danger
                               transition-colors"
                    title={t('Cancel')}
                  >
                    <Square size={13} strokeWidth={2.5} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || !state.ready}
                    className="ai-tab__send-btn w-7 h-7 flex items-center justify-center rounded-lg
                               bg-ide-accent hover:bg-ide-accent-hover text-white
                               transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t('Send')}
                  >
                    <SquareArrowUp size={14} strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Plan overlay — covers entire dialog */}
      {state.pendingPermission && activeSessionId && state.pendingPermission.tool === 'ExitPlanMode' && (
        <AiExitPlanModeCard
          perm={state.pendingPermission}
          sessionId={activeSessionId}
          onContinue={handlePlanContinue}
          onClearExecute={handlePlanClearExecute}
          onDeny={aiStore.handlePlanDeny}
          workspacePath={workspacePath}
          onOpenFile={onOpenFile}
          model={state.model}
          brushActive={brushActive}
        />
      )}
    </div>
  )
})

export default AiTab
