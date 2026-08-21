import { useState, useCallback } from 'react'
import type { AiMessage, AiToolUse } from '@shared/types'
import { AI_FILE_EDIT_TOOLS } from '@shared/types'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { useTheme } from '../../themes'
import { Bot, ChevronDown, HelpCircle } from 'lucide-react'
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
export function ToolIcon({ category, className }: { category: 'file' | 'command' | 'search' | 'web' | 'plan' | 'skill' | 'agent' | 'question' | 'task' | 'default'; className?: string }) {
  const cls = className ? `w-3.5 h-3.5 shrink-0 ${className}` : "w-3.5 h-3.5 shrink-0"
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
    <svg viewBox="0 0 14 14" fill="none" className={cls}>
      <path transform="translate(0.6689 1.073)" d="M11.4818 5.57813C11.4818 4.45301 11.4807 3.66237 11.4075 3.05908C11.3359 2.46953 11.2024 2.13852 10.9939 1.89441C10.9247 1.81341 10.8493 1.73801 10.7683 1.66882C10.5242 1.46033 10.1932 1.32686 9.60364 1.25525C9.00034 1.18198 8.20974 1.18091 7.0846 1.18091L5.57813 1.18091C4.45301 1.18091 3.66238 1.18198 3.05908 1.25525C2.46953 1.32686 2.13852 1.46033 1.89441 1.66882C1.81341 1.73801 1.73801 1.81341 1.66882 1.89441C1.46033 2.13852 1.32686 2.46953 1.25525 3.05908C1.18198 3.66238 1.18091 4.45301 1.18091 5.57813L1.18091 6.2771C1.18091 7.40218 1.18197 8.19288 1.25525 8.79614C1.32687 9.38553 1.46036 9.71674 1.66882 9.96082C1.73797 10.0417 1.81347 10.1173 1.89441 10.1864C2.13851 10.3948 2.46965 10.5275 3.05908 10.5991C3.66238 10.6724 4.45298 10.6735 5.57813 10.6735L7.0846 10.6735C8.20977 10.6735 9.00033 10.6724 9.60364 10.5991C10.1931 10.5275 10.5242 10.3948 10.7683 10.1864C10.8493 10.1173 10.9247 10.0417 10.9939 9.96082C11.2024 9.71674 11.3358 9.38553 11.4075 8.79614C11.4808 8.19288 11.4818 7.40218 11.4818 6.2771L11.4818 5.57813ZM12.6627 6.2771C12.6627 7.37222 12.6637 8.247 12.5798 8.93799C12.4942 9.64284 12.3133 10.2359 11.8928 10.7282C11.7834 10.8562 11.6637 10.9751 11.5356 11.0845C11.0434 11.5049 10.4511 11.6867 9.74634 11.7723C9.05525 11.8563 8.17999 11.8552 7.0846 11.8552L5.57813 11.8552C4.48273 11.8552 3.60747 11.8563 2.91638 11.7723C2.21157 11.6867 1.61933 11.5049 1.12708 11.0845C0.99901 10.9751 0.879281 10.8562 0.769898 10.7282C0.349454 10.2359 0.168506 9.64284 0.0828864 8.93799C-0.00101964 8.247 4.88512e-07 7.37222 6.47206e-07 6.2771L6.47206e-07 5.57813C6.47206e-07 4.48273 -0.00106163 3.60747 0.0828864 2.91638C0.168502 2.21168 0.349594 1.61928 0.769898 1.12708C0.879302 0.998981 0.998981 0.879302 1.12708 0.769898C1.61928 0.349594 2.21168 0.168502 2.91638 0.0828864C3.60747 -0.00106163 4.48273 6.47206e-07 5.57813 6.47206e-07L7.0846 6.47206e-07C8.17999 6.47206e-07 9.05525 -0.00106163 9.74634 0.0828864C10.451 0.168505 11.0434 0.349587 11.5356 0.769898C11.6637 0.879302 11.7834 0.998981 11.8928 1.12708C12.3131 1.61928 12.4942 2.21169 12.5798 2.91638C12.6638 3.60747 12.6627 4.48273 12.6627 5.57813L12.6627 6.2771Z" fill="currentColor"/>
      <path transform="translate(0.6689 1.073)" d="M6.02607 5.50955L6.44306 5.9274L3.84284 8.52762L3.425 8.11063L3.00715 7.69278L4.77253 5.9274L3.00715 4.16202L3.84284 3.32633L6.02607 5.50955Z" fill="currentColor"/>
      <path transform="translate(0.6689 1.073)" d="M9.23789 7.35397L9.23789 8.53488L6.96238 8.53488L6.96238 7.35397L9.23789 7.35397Z" fill="currentColor"/>
    </svg>
  )
  if (category === 'search') return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cls}>
      <path d="M10.875 5.532a12.053 12.053 0 0 0-7.308-.785A.72.72 0 0 0 3 5.46v11.991c0 .518.513.882 1.019.768a9.03 9.03 0 0 1 6.856 1.215V5.532ZM13.125 19.434a9.03 9.03 0 0 1 6.857-1.215c.505.113 1.018-.251 1.018-.768V5.46a.72.72 0 0 0-.567-.713 12.051 12.051 0 0 0-7.308.785v13.902Z" />
    </svg>
  )
  if (category === 'agent') return <Bot className={cls} />
  if (category === 'question') return <HelpCircle className={cls} />
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <path d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
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
            scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 6 },
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
          scrollbar: { verticalScrollbarSize: 0, horizontalScrollbarSize: 6 },
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
    <div className="ai-tab__tool-call block w-full max-w-[896px] mx-auto animate-fade-in cursor-pointer select-none" onClick={() => setExpanded(v => !v)}>
      <button
        type="button"
        className={`ai-tab__tool-toggle inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-none font-mono transition-colors max-w-full overflow-hidden ${
          isFileEdit ? 'bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25' : 'bg-ide-hover text-ide-text-muted hover:bg-ide-active'
        }`}
      >
        <span className="shrink-0"><ToolIcon category={category} /></span>
        <span className="shrink-0 leading-none">{tool.name}</span>
        {detail && <span className="ai-tab__tool-detail-preview truncate flex-1 min-w-0 ml-0.5 opacity-60 text-[10px] leading-none">{detail}</span>}
        {hasResult && (
          <span className={`ai-tab__tool-status shrink-0 text-[10px] leading-none ${tool.result!.isError ? 'text-ide-danger' : 'text-ide-success'}`}>
            {tool.result!.isError ? '✗' : '✓'}
          </span>
        )}
      </button>
      {expanded && (
        <div onClick={(e) => e.stopPropagation()} className={`ai-tab__tool-detail-panel select-text mt-0.5 px-2 py-1 text-[11px] font-mono bg-ide-bg border border-ide-border rounded space-y-0.5 ${isFileEdit ? 'p-1' : 'max-h-48 overflow-y-auto'}`}>
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
    <div className="ai-tab__tools-summary w-full max-w-[896px] mx-auto animate-fade-in">
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
