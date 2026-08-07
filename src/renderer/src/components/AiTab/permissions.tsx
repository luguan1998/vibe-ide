import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { AiPermissionRequest } from '@shared/types'
import { useI18n } from '../../i18n'
import { ChevronDown, ChevronUp, HelpCircle, Check, FileText } from 'lucide-react'
import { displayLabel, getShortcuts } from '../../shortcuts'
import { ChatMarkdown } from './markdown'
export const AiAskQuestionCard = React.memo(function AiAskQuestionCard({ perm, sessionId, onRespond }: {
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

export const AiPermissionCard = React.memo(function AiPermissionCard({ perm, sessionId, onRespond }: {
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
export const AiExitPlanModeCard = React.memo(function AiExitPlanModeCard({ perm, sessionId, onContinue, onClearExecute, onDeny, workspacePath, onOpenFile, model, brushActive }: {
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
