import { useState, useCallback, useRef, useEffect } from 'react'
import type { AiPermissionMode, AiSlashCommand } from '@shared/types'
import { DEFAULT_AI_CONTEXT_WINDOW } from '@shared/types'
import { getFileInfo, FILE_ICON_PATHS } from '../FileIcons'
import { aiStore } from '../../aiStore'
import { Bot, ChevronDown, Check, Folder, Pencil, Plus, X } from 'lucide-react'
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
            cx="7" cy="7" r={CONTEXT_RING_RADIUS} fill="none" stroke="currentColor" strokeWidth="2"
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
type ModelAlias = 'default' | 'opus' | 'sonnet' | 'haiku'
interface ModelRow { alias: ModelAlias; label: string; icon: string; desc: string }

const MODEL_OPTIONS: ModelRow[] = [
  { alias: 'opus', label: 'Opus', icon: '🧠', desc: '最强推理' },
  { alias: 'sonnet', label: 'Sonnet', icon: '⚖️', desc: '均衡' },
  { alias: 'haiku', label: 'Haiku', icon: '⚡', desc: '最快' },
]
const DEFAULT_ROW: ModelRow = { alias: 'default', label: 'Default', icon: '✨', desc: '' }

const CUSTOM_MODELS_KEY = 'vibe.ai.customModels'
const MAX_CUSTOM_MODELS = 3

function loadCustomModels(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_MODELS_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, MAX_CUSTOM_MODELS) : []
  } catch { return [] }
}

const resolvedModelsCache = new Map<string, Record<ModelAlias, string>>()

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
    // 仅当会话已有对话时才留一条 /model 切换记录（显示用途；revert 索引由主进程 userTurns 定位，不依赖此条）。
    // 空对话时切换只更新 badge 与主进程缓存，不插入消息，避免欢迎屏被孤立的 /model 气泡顶掉
    aiStore.updateSession(sessionId, (s) => s.messages.length > 0
      ? { ...s, messages: [...s.messages, { sessionId, type: 'user' as const, role: 'user' as const, content: `/model ${alias}`, timestamp: Date.now() }] }
      : s)
  }, [sessionId, model])

  useEffect(() => {
    if (pendingModel && model && model !== prevModelRef.current) {
      setPendingModel(null)
    }
  }, [model, pendingModel])

  const [customModels, setCustomModels] = useState<string[]>(loadCustomModels)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!open) { setAdding(false); setDraft('') }
  }, [open])

  const persistCustom = useCallback((list: string[]) => {
    setCustomModels(list)
    localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(list))
  }, [])

  const handleAddCustom = useCallback(() => {
    const name = draft.trim()
    setAdding(false)
    setDraft('')
    if (!name) return
    if (!customModels.includes(name)) persistCustom([...customModels, name].slice(-MAX_CUSTOM_MODELS))
    handleSelect(name)
  }, [draft, customModels, persistCustom, handleSelect])

  const handleRemoveCustom = useCallback((name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    persistCustom(customModels.filter(x => x !== name))
  }, [customModels, persistCustom])

  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const [resolved, setResolved] = useState<Record<ModelAlias, string> | null>(
    () => resolvedModelsCache.get(sessionId ?? '') ?? null
  )

  const refreshResolved = useCallback((key: string) => {
    window.api.ai.resolveModels(key || undefined).then(r => {
      if ((sessionIdRef.current ?? '') !== key) return
      resolvedModelsCache.set(key, r)
      setResolved(r)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const key = sessionId ?? ''
    setResolved(resolvedModelsCache.get(key) ?? null)
    if (!resolvedModelsCache.has(key)) refreshResolved(key)
  }, [sessionId, refreshResolved])

  useEffect(() => {
    if (!open) return
    refreshResolved(sessionId ?? '')
  }, [open, sessionId, refreshResolved])

  const resolveAlias = useCallback((alias: ModelAlias) => resolved?.[alias] || alias, [resolved])

  // 直接按 alias 子串匹配档位；勿加 pro/flash 映射，否则 opus 与 sonnet 共享 pro 会误判
  // 档位行（opus/sonnet/haiku）优先：alias 子串 + 实际名精确；default 仅在实际名精确命中或模型为空时用于 badge 显示，不进下拉
  const currentOption = (() => {
    if (!model) return DEFAULT_ROW
    const m = model.toLowerCase()
    const tier = MODEL_OPTIONS.find(o => m === resolveAlias(o.alias).toLowerCase() || m.includes(o.alias))
    if (tier) return tier
    return m === resolveAlias('default').toLowerCase() ? DEFAULT_ROW : undefined
  })()
  const pendingOption = (() => {
    if (!pendingModel) return undefined
    const tier = MODEL_OPTIONS.find(o => pendingModel === o.alias || pendingModel === resolveAlias(o.alias))
    if (tier) return tier
    return pendingModel === 'default' || pendingModel === resolveAlias('default') ? DEFAULT_ROW : undefined
  })()
  const displayOption = pendingOption || currentOption
  const displayLabel = (() => {
    if (pendingModel) return resolved?.[pendingModel as ModelAlias] || pendingModel
    if (displayOption && resolved) return resolved[displayOption.alias]
    return displayOption?.label || model || 'default'
  })()

  return (
    <div ref={ref} className="ai-tab__model relative min-w-0">
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
        <Bot size={14} strokeWidth={2} className="shrink-0" />
        <span className="ai-tab__model-label truncate">{displayLabel}</span>
        {sessionId && <ChevronDown size={12} className={`shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <div className="ai-tab__model-dropdown absolute bottom-full right-0 mb-1.5 z-30
          bg-ide-sidebar border border-ide-border rounded-lg
          shadow-lg min-w-[170px] max-w-[280px] w-max py-0.5 animate-fade-in">
          {MODEL_OPTIONS.map(opt => {
            const name = resolveAlias(opt.alias)
            const isCurrent = !pendingModel && opt.alias === currentOption?.alias
            const isPending = pendingModel === opt.alias || pendingModel === name
            const marked = isCurrent || isPending
            const desc = resolved && resolved[opt.alias] !== opt.alias ? opt.alias : opt.desc
            return (
              <button
                key={opt.alias}
                type="button"
                onClick={() => handleSelect(name)}
                className={`ai-tab__model-option w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                  marked
                    ? 'ai-tab__model-option--selected bg-ide-accent/15 text-ide-accent'
                    : 'text-ide-text hover:bg-ide-hover'
                }`}
              >
                <span className="text-xs leading-none shrink-0">{opt.icon}</span>
                <span className="truncate min-w-0">{resolved ? name : opt.label}</span>
                <span className={`text-[10px] truncate shrink-0 ${marked ? 'text-ide-accent/60' : 'text-ide-text-muted/50'}`}>{desc}</span>
              </button>
            )
          })}
          {customModels.length > 0 && (
            <>
              <div className="my-0.5 border-t border-ide-border" />
              {customModels.map(name => {
                const marked = pendingModel ? pendingModel === name : model === name
                return (
                  <div
                    key={name}
                    className={`ai-tab__model-option group w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors ${
                      marked ? 'ai-tab__model-option--selected bg-ide-accent/15 text-ide-accent' : 'text-ide-text hover:bg-ide-hover'
                    }`}
                    onClick={() => handleSelect(name)}
                    title={name}
                  >
                    <Pencil size={11} strokeWidth={2} className="shrink-0 opacity-60" />
                    <span className="truncate min-w-0">{name}</span>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveCustom(name, e)}
                      className="ml-auto shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-ide-border/40"
                      title="删除"
                    >
                      <X size={11} strokeWidth={2} className="text-ide-text-muted hover:text-ide-text" />
                    </button>
                  </div>
                )
              })}
            </>
          )}
          <div className="my-0.5 border-t border-ide-border" />
          {adding ? (
            <div className="px-2 py-1">
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleAddCustom() }
                  if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setDraft('') }
                }}
                placeholder="输入模型名，回车确认"
                className="ai-tab__model-custom-input w-full bg-transparent text-[11px] text-ide-text border-b border-ide-accent/60
                           focus:outline-none focus:border-ide-accent placeholder:text-ide-text-muted/40"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={customModels.length >= MAX_CUSTOM_MODELS}
              className={`ai-tab__model-option w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                customModels.length >= MAX_CUSTOM_MODELS
                  ? 'text-ide-text-muted/40 cursor-default'
                  : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
              }`}
              title={customModels.length >= MAX_CUSTOM_MODELS ? `最多 ${MAX_CUSTOM_MODELS} 个自定义模型` : '自定义模型'}
            >
              <Plus size={11} strokeWidth={2} className="shrink-0" />
              <span>自定义模型 ({customModels.length}/{MAX_CUSTOM_MODELS})</span>
            </button>
          )}
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
    <div ref={ref} className="ai-tab__mode relative shrink-0">
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
