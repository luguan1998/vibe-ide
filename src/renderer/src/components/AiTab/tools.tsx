import { useState, useCallback } from 'react'
import type { AiMessage, AiToolUse } from '@shared/types'
import { AI_FILE_EDIT_TOOLS } from '@shared/types'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { useTheme } from '../../themes'
import { ChevronDown, HelpCircle } from 'lucide-react'
// ── Tool type classification ──────────────────────────────────────

const COMMAND_TOOLS = new Set(['Bash', 'bash', 'terminal', 'run_command', 'execute_command'])
const SEARCH_TOOLS = new Set(['Grep', 'grep', 'search', 'Glob', 'glob', 'find', 'ripgrep', 'Read'])
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch'])
const PLAN_TOOLS = new Set(['ExitPlanMode', 'EnterPlanMode'])
const SKILL_TOOLS = new Set(['Skill'])
const AGENT_TOOLS = new Set(['Agent'])
const QUESTION_TOOLS = new Set(['AskUserQuestion'])
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop'])

export function getToolCategory(name: string): 'file' | 'command' | 'search' | 'web' | 'plan' | 'skill' | 'agent' | 'question' | 'task' | 'default' {
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

export function isMergeTool(name: string): boolean {
  const c = getToolCategory(name)
  return c === 'search' || c === 'web' || c === 'command'
}

export function isPureToolMessage(msg: AiMessage): boolean {
  return !msg.parentToolUseId && !msg.error && msg.role !== 'user'
    && !!msg.toolUse && msg.toolUse.length > 0 && !msg.content && !msg.thinking
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
export function ToolIcon({ category }: { category: 'file' | 'command' | 'search' | 'web' | 'plan' | 'skill' | 'agent' | 'question' | 'task' | 'default' }) {
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
      <g transform="translate(12 12) scale(0.96) translate(-12 -12)">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </g>
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

export function AiToolCallCard({ tool }: { tool: AiToolUse }) {
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
    <div className="ai-tab__tool-call block w-full max-w-[960px] mx-auto animate-fade-in">
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
export function CollapsedToolsSummary({ tools }: { tools: AiToolUse[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="ai-tab__tools-summary w-full max-w-[960px] mx-auto animate-fade-in">
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
