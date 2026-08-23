import { useState, useCallback, useRef, useEffect } from 'react'
import type { AiPermissionMode, AiSlashCommand } from '@shared/types'
import { DEFAULT_AI_CONTEXT_WINDOW } from '@shared/types'
import { getFileInfo, FILE_ICON_PATHS } from '../FileIcons'
import { aiStore } from '../../aiStore'
import { Bot, ChevronDown, Check, Folder, Pencil } from 'lucide-react'
const MODE_OPTIONS: { value: AiPermissionMode; label: string; icon: string }[] = [
  { value: 'plan', label: 'Plan', icon: '📋' },
  { value: 'acceptEdits', label: 'Edit', icon: '🖌️' },
  { value: 'bypassPermissions', label: 'Bypass', icon: '🔓' },
]

// ── ContextBar ──────────────────────────────────────────────────────
const CONTEXT_RING_RADIUS = 5.5
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS

function parseContextWindowInput(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(k|m)?$/i)
  if (!m) return null
  const unit = m[2]?.toLowerCase()
  const n = parseFloat(m[1]) * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1)
  return n >= 1000 ? Math.round(n) : null
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return `${n}`
}

export function ContextBar({ percent, sessionId }: { percent: number | null; sessionId: string | null }) {
  const pct = Math.min(100, Math.round(percent ?? 0))
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [info, setInfo] = useState<{ usedTokens: number | null; contextWindow: number | null } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

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

  const toggleOpen = useCallback(() => {
    if (!sessionId) return
    const next = !open
    setOpen(next)
    setEditing(false)
    setDraft('')
    if (next) {
      window.api.ai.getContextInfo(sessionId).then(setInfo).catch(() => {})
    }
  }, [sessionId, open])

  const startEdit = useCallback(() => {
    setDraft(info?.contextWindow != null ? fmtTokens(info.contextWindow) : '')
    setEditing(true)
  }, [info])

  const handleSave = useCallback(async () => {
    if (!sessionId) return
    const tokens = parseContextWindowInput(draft)
    if (!tokens) return
    try {
      const res = await window.api.ai.setContextWindow(sessionId, tokens)
      const nextPercent = res?.contextPercent
      if (res?.success && nextPercent != null) {
        aiStore.updateSession(sessionId, s => ({ ...s, contextPercent: Math.round(nextPercent) }))
      }
      setInfo(prev => ({ usedTokens: prev?.usedTokens ?? null, contextWindow: tokens }))
    } catch {}
    setEditing(false)
  }, [sessionId, draft])

  const ringColorClass =
    pct >= 80 ? 'text-ide-danger'
    : pct >= 50 ? 'text-ide-warning'
    : 'text-ide-success'

  const usedLabel = info?.usedTokens != null ? fmtTokens(info.usedTokens) : '–'
  const maxLabel = info?.contextWindow != null ? fmtTokens(info.contextWindow) : fmtTokens(DEFAULT_AI_CONTEXT_WINDOW)

  return (
    <span ref={ref} className="ai-tab__context relative shrink-0">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={!sessionId}
        title={`${pct}% context used`}
        className={`ai-tab__context-btn w-7 h-7 grid place-items-center rounded-full transition-colors ${
          sessionId
            ? 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text cursor-pointer'
            : 'opacity-40 cursor-default'
        }`}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          <circle cx="7" cy="7" r={CONTEXT_RING_RADIUS} fill="none" stroke="currentColor" strokeWidth="2" className="opacity-25" />
          <circle
            cx="7" cy="7" r={CONTEXT_RING_RADIUS} fill="none" strokeWidth="2"
            strokeLinecap="round"
            className={`${ringColorClass} transition-all duration-500`}
            strokeDasharray={`${CONTEXT_RING_CIRCUMFERENCE * pct / 100} ${CONTEXT_RING_CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      </button>
      {open && (
        <div className="ai-tab__context-panel absolute bottom-full right-0 mb-1.5 z-30 w-max
                        bg-ide-sidebar border border-ide-border rounded-lg shadow-lg px-1.5 py-1 animate-fade-in">
          {editing ? (
            <div className="ai-tab__context-edit flex items-center gap-1.5 h-5 text-[11px] leading-none whitespace-nowrap">
              <span className={`${ringColorClass} tabular-nums font-medium`}>{pct}%</span>
              <span className="text-ide-text-muted tabular-nums">{usedLabel} /</span>
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
                }}
                placeholder={maxLabel}
                className="ai-tab__context-input w-[56px] bg-transparent text-ide-text border-b border-ide-accent/60
                           focus:outline-none focus:border-ide-accent placeholder:text-ide-text-muted/40"
              />
            </div>
          ) : (
            <div className="ai-tab__context-view flex items-center gap-1.5 h-5 text-[11px] leading-none whitespace-nowrap">
              <span className={`${ringColorClass} tabular-nums font-medium`}>{pct}%</span>
              <span className="ai-tab__context-figures text-ide-text-muted tabular-nums">{usedLabel} / {maxLabel}</span>
              <button
                type="button"
                onClick={startEdit}
                title="Edit max context"
                className="ai-tab__context-edit-btn text-ide-text-muted hover:text-ide-text transition-colors"
              >
                <Pencil size={10} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  )
}

// ── ModelBadge ──────────────────────────────────────────────────────
const MODEL_OPTIONS = [
  { alias: 'opus', label: 'Opus', icon: '🧠', desc: '最强推理' },
  { alias: 'sonnet', label: 'Sonnet', icon: '⚖️', desc: '均衡' },
  { alias: 'haiku', label: 'Haiku', icon: '⚡', desc: '最快' },
] as const

export function ModelBadge({
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

  // 直接按 alias 子串匹配档位；勿加 pro/flash 映射，否则 opus 与 sonnet 共享 pro 会误判
  const currentOption = (() => {
    if (!model) return undefined
    const m = model.toLowerCase()
    return MODEL_OPTIONS.find(o => m.includes(o.alias))
  })()
  const pendingOption = pendingModel ? MODEL_OPTIONS.find(o => o.alias === pendingModel) : undefined
  const displayOption = pendingOption || currentOption
  const displayLabel = displayOption?.label || model || 'default'

  return (
    <div ref={ref} className="ai-tab__model relative shrink-0">
      <button
        type="button"
        onClick={() => sessionId && setOpen(v => !v)}
        className={`ai-tab__model-btn flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg
          transition-colors
          ${sessionId
            ? 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover cursor-pointer'
            : 'bg-ide-border/15 text-ide-text-muted/40 cursor-default'
          }`}
        title={model || 'Model'}
        disabled={!sessionId}
      >
        {displayOption
          ? <span className="text-sm">{displayOption.icon}</span>
          : <Bot size={14} strokeWidth={2} className="shrink-0" />}
        <span className="truncate max-w-[200px]">{displayLabel}</span>
        {sessionId && <ChevronDown size={12} className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <div className="ai-tab__model-dropdown absolute bottom-full right-0 mb-1.5 z-30
          bg-ide-sidebar border border-ide-border rounded-lg
          shadow-lg min-w-[170px] py-0.5 animate-fade-in">
          {MODEL_OPTIONS.map(opt => {
            const isCurrent = !pendingModel && opt.alias === currentOption?.alias
            const isPending = pendingModel === opt.alias
            const marked = isCurrent || isPending
            return (
              <button
                key={opt.alias}
                type="button"
                onClick={() => handleSelect(opt.alias)}
                className={`ai-tab__model-option w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                  marked
                    ? 'ai-tab__model-option--selected bg-ide-accent/15 text-ide-accent'
                    : 'text-ide-text hover:bg-ide-hover'
                }`}
              >
                <span className="text-xs leading-none shrink-0">{opt.icon}</span>
                <span className="truncate shrink-0">{opt.label}</span>
                <span className={`text-[10px] truncate ${marked ? 'text-ide-accent/60' : 'text-ide-text-muted/50'}`}>{opt.desc}</span>
                {marked && <Check size={10} className="ml-auto shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── ModeSelector ──────────────────────────────────────────────────────
export function ModeSelector({
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

export function SlashCommandAutocomplete({
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

export interface MentionItem {
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

export function MentionAutocomplete({
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
