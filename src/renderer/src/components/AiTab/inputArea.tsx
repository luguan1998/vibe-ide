import { useState, useCallback, useRef, useEffect } from 'react'
import type { AiPermissionMode, AiSlashCommand } from '@shared/types'
import { getFileInfo, FILE_ICON_PATHS } from '../FileIcons'
import { aiStore } from '../../aiStore'
import { Bot, ChevronDown, Check, Folder } from 'lucide-react'
const MODE_OPTIONS: { value: AiPermissionMode; label: string; icon: string }[] = [
  { value: 'plan', label: 'Plan', icon: '📋' },
  { value: 'acceptEdits', label: 'Edit', icon: '🖌️' },
  { value: 'bypassPermissions', label: 'Bypass', icon: '🔓' },
]

// ── ContextBar ──────────────────────────────────────────────────────
export function ContextBar({ percent }: { percent: number | null }) {
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
        className={`ai-tab__model-btn flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full
          transition-colors leading-tight
          ${sessionId
            ? 'bg-ide-border/30 text-ide-text-muted hover:bg-ide-hover hover:text-ide-text cursor-pointer'
            : 'bg-ide-border/15 text-ide-text-muted/40 cursor-default'
          }`}
        title={model || 'Model'}
        disabled={!sessionId}
      >
        {displayOption
          ? <span className="text-xs leading-none">{displayOption.icon}</span>
          : <Bot size={12} strokeWidth={2} className="shrink-0" />}
        <span className="truncate max-w-[80px]">{displayLabel}</span>
        {sessionId && <ChevronDown size={10} className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />}
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
