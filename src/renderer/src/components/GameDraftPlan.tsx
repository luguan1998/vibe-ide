import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { Copy, Check, X, GripVertical, Plus, Split, ListOrdered, Send, StopCircle } from 'lucide-react'

interface DraftItem {
  id: string
  text: string
}

interface DraftPrefill {
  name?: string
  command?: string
  type?: 'simple' | 'init' | 'pipe'
}

const OPEN_CMD_MODAL_EVENT = 'vibe-ide-open-custom-command-modal'

const KEYPAD_ITEMS: { code: string; key: string; text: string }[] = [
  { code: 'Numpad4', key: '4', text: '说中文' },
  { code: 'Numpad5', key: '5', text: '继续' },
  { code: 'Numpad6', key: '6', text: '还是报错' },
  { code: 'Numpad1', key: '1', text: '先别重构' },
  { code: 'Numpad2', key: '2', text: '回滚回滚' },
  { code: 'Numpad3', key: '3', text: '讲明白点' },
]
export const EXECUTE_COMMAND_EVENT = 'vibe-ide-execute-command'
export const DRAFT_PIPE_STOP = 'vibe-ide-draft-pipe-stop'
export const FOCUS_GAME_DRAFT = 'vibe-ide-focus-game-draft'
export const ADD_ANNOTATION_EVENT = 'vibe-ide-add-annotation'

export function toRelPath(full: string | undefined | null, cwd?: string | null): string {
  const f = (full || '').replace(/\\/g, '/')
  const w = cwd ? cwd.replace(/\\/g, '/').replace(/\/$/, '') : ''
  return w && (f === w || f.startsWith(w + '/')) ? f.slice(w.length).replace(/^\//, '') : f
}

interface AnnotationEntry { id: string; start: number; end: number; opinion: string }
interface AnnotationGroup { fullPath: string; rel: string; items: AnnotationEntry[] }

function buildAnnotationCommand(group: AnnotationGroup): string {
  const valid = group.items.filter(it => it.opinion.trim()).sort((a, b) => a.start - b.start)
  if (valid.length === 0) return ''
  return valid.map(it => {
    const ref = it.start === it.end ? `@${group.rel}:${it.start}` : `@${group.rel}:${it.start}-${it.end}`
    const opinion = it.opinion.trim().replace(/[\r\n]+/g, ' ').replace(/;/g, '，')
    return `${ref} ${opinion}`
  }).join('; ')
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

export default function GameDraftPlan({ onBack }: { onBack?: () => void }) {
  const [items, setItems] = useState<DraftItem[]>([])
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const stopRef = useRef(false)

  const dragFromRef = useRef<number | null>(null)
  const addInputRef = useRef<HTMLTextAreaElement>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pressedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pressedKey, setPressedKey] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<AnnotationGroup[]>([])
  const annotationsRef = useRef<AnnotationGroup[]>([])
  annotationsRef.current = annotations

  useEffect(() => { requestAnimationFrame(() => addInputRef.current?.focus()) }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { focus?: 'add' | 'annotation' } | undefined
      if (detail?.focus === 'annotation') return
      requestAnimationFrame(() => addInputRef.current?.focus())
    }
    window.addEventListener(FOCUS_GAME_DRAFT, handler)
    return () => window.removeEventListener(FOCUS_GAME_DRAFT, handler)
  }, [])

  useEffect(() => {
    return () => {
      if (sendingRef.current) {
        stopRef.current = true
        window.dispatchEvent(new CustomEvent(DRAFT_PIPE_STOP))
      }
    }
  }, [])

  const handleAdd = useCallback(() => {
    const text = draft.replace(/\r\n/g, '\n')
    if (!text.trim()) return
    const item: DraftItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text,
    }
    setItems(prev => [...prev, item])
    setDraft('')
    requestAnimationFrame(() => { addInputRef.current?.focus(); autoGrow(addInputRef.current) })
  }, [draft])

  const handleDelete = useCallback((id: string) => {
    setItems(prev => prev.filter(it => it.id !== id))
    if (editingId === id) setEditingId(null)
  }, [editingId])

  const handleStartEdit = useCallback((item: DraftItem) => {
    setEditingId(item.id)
    setEditText(item.text)
    requestAnimationFrame(() => { editInputRef.current?.focus(); autoGrow(editInputRef.current) })
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (editingId === null) return
    const text = editText.replace(/\r\n/g, '\n')
    setItems(prev => prev.map(it => it.id === editingId ? { ...it, text } : it))
    setEditingId(null)
  }, [editingId, editText])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  const handleCopy = useCallback((item: DraftItem) => {
    navigator.clipboard?.writeText(item.text).catch(() => {})
    setCopiedId(item.id)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1200)
  }, [])

  const handleKeypadSend = useCallback((item: { code: string; text: string }) => {
    setPressedKey(item.code)
    if (pressedTimerRef.current) clearTimeout(pressedTimerRef.current)
    pressedTimerRef.current = setTimeout(() => setPressedKey(null), 140)
    ;(window as any).__vibeSendLine?.(item.text)
  }, [])

  const handleAnnotationConvert = useCallback(() => {
    const prev = annotationsRef.current
    if (prev.length === 0) return
    const newItems: DraftItem[] = []
    const remaining: AnnotationGroup[] = []
    for (const group of prev) {
      const withOp = group.items.filter(it => it.opinion.trim()).sort((a, b) => a.start - b.start)
      const noOp = group.items.filter(it => !it.opinion.trim())
      if (withOp.length > 0) {
        const cmd = buildAnnotationCommand({ ...group, items: withOp })
        if (cmd) newItems.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: cmd })
      }
      if (noOp.length > 0) remaining.push({ ...group, items: noOp })
    }
    if (newItems.length === 0) return
    setItems(items => [...items, ...newItems])
    setAnnotations(remaining)
    setPressedKey('Numpad7')
    if (pressedTimerRef.current) clearTimeout(pressedTimerRef.current)
    pressedTimerRef.current = setTimeout(() => setPressedKey(null), 140)
  }, [])

  const handleAnnotationDelete = useCallback((fullPath: string, entryId: string) => {
    setAnnotations(prev => prev.map(g =>
      g.fullPath === fullPath
        ? { ...g, items: g.items.filter(it => it.id !== entryId) }
        : g
    ).filter(g => g.items.length > 0))
  }, [])

  const handleAnnotationOpinionChange = useCallback((fullPath: string, entryId: string, opinion: string) => {
    setAnnotations(prev => prev.map(g =>
      g.fullPath === fullPath
        ? { ...g, items: g.items.map(it => it.id === entryId ? { ...it, opinion } : it) }
        : g
    ))
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { fullPath, rel, start, end } = (e as CustomEvent).detail as { fullPath: string; rel: string; start: number; end: number }
      const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      setAnnotations(prev => {
        const idx = prev.findIndex(g => g.fullPath === fullPath)
        if (idx >= 0) {
          if (prev[idx].items.some(it => it.start === start && it.end === end)) return prev
          const next = [...prev]
          next[idx] = { ...next[idx], items: [...next[idx].items, { id: newId, start, end, opinion: '' }] }
          return next
        }
        return [...prev, { fullPath, rel, items: [{ id: newId, start, end, opinion: '' }] }]
      })
      requestAnimationFrame(() => {
        const ta = containerRef.current?.querySelector<HTMLTextAreaElement>(`.draft-plan__annotation-opinion[data-id="${newId}"]`)
        ta?.focus()
      })
    }
    window.addEventListener(ADD_ANNOTATION_EVENT, handler)
    return () => window.removeEventListener(ADD_ANNOTATION_EVENT, handler)
  }, [])

  useLayoutEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const active = document.activeElement
      if (active?.classList.contains('draft-plan__annotation-opinion')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ;(active as HTMLTextAreaElement).blur()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = containerRef.current
      if (!el || el.offsetParent === null) return
      if (e.code === 'Numpad7') {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleAnnotationConvert()
        return
      }
      const item = KEYPAD_ITEMS.find(k => k.code === e.code)
      if (!item) return
      e.preventDefault()
      e.stopImmediatePropagation()
      handleKeypadSend(item)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [handleKeypadSend, handleAnnotationConvert])

  const handleSplit = useCallback(() => {
    const lines = draft.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    const newItems: DraftItem[] = lines.map(text => ({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text,
    }))
    setItems(prev => [...prev, ...newItems])
    setDraft('')
    requestAnimationFrame(() => { addInputRef.current?.focus(); autoGrow(addInputRef.current) })
  }, [draft])

  const handleConvert = useCallback(() => {
    const command = items.map(it => it.text).filter(t => t.trim()).join('\n')
    if (!command) return
    const prefill: DraftPrefill = { name: '草稿计划', command, type: 'pipe' }
    window.dispatchEvent(new CustomEvent(OPEN_CMD_MODAL_EVENT, { detail: prefill }))
  }, [items])

  const handlePipelineToggle = useCallback(async () => {
    if (sendingRef.current) {
      stopRef.current = true
      sendingRef.current = false
      setSending(false)
      window.dispatchEvent(new CustomEvent(DRAFT_PIPE_STOP))
      return
    }
    const snapshot = items.filter(it => it.text.trim())
    if (snapshot.length === 0) return
    sendingRef.current = true
    setSending(true)
    stopRef.current = false

    for (const item of snapshot) {
      if (stopRef.current) break
      await (window as any).__vibeWaitIdle?.()
      if (stopRef.current) break
      setItems(prev => prev.filter(it => it.id !== item.id))
      await (window as any).__vibeSendLine?.(item.text)
    }

    sendingRef.current = false
    setSending(false)
  }, [items])

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragFromRef.current = index
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    const el = e.currentTarget as HTMLElement
    requestAnimationFrame(() => { el.style.opacity = '0.35' })
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '1'
    dragFromRef.current = null
    setDragOverIndex(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragFromRef.current !== null && dragFromRef.current !== index) {
      setDragOverIndex(index)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    const from = dragFromRef.current
    setDragOverIndex(null)
    dragFromRef.current = null
    if (from === null || from === index) return
    setItems(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(index, 0, moved)
      return next
    })
  }, [])

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      if (pressedTimerRef.current) clearTimeout(pressedTimerRef.current)
    }
  }, [])

  const onAddKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  const onEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none draft-plan" tabIndex={-1}>
      <style>{`
        .draft-plan__key {
          background: rgb(var(--ide-sidebar) / 0.45);
          border: 1.5px dashed rgb(var(--ide-border));
          border-radius: 8px 12px 6px 10px;
          transition: transform 80ms ease, border-color 120ms, background 120ms;
          cursor: pointer;
        }
        .draft-plan__key:hover {
          border-color: rgb(var(--ide-accent) / 0.6);
          background: rgb(var(--ide-accent) / 0.1);
          transform: translateY(-1px);
        }
        .draft-plan__key:active,
        .draft-plan__key--pressed {
          transform: translateY(1px);
          background: rgb(var(--ide-accent) / 0.16);
          border-color: rgb(var(--ide-accent) / 0.7);
        }
        .draft-plan__key--wide { width: 100%; }
      `}</style>
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none draft-plan__header">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors" title="Back to menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <span className="text-[13px] leading-none">📝</span>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider draft-plan__title">草稿计划</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Items</div>
            <div className="text-ide-accent font-bold tabular-nums">{items.length}</div>
          </div>
        </div>
      </div>

      {annotations.length > 0 && (
        <div className="shrink-0 border-b border-ide-border max-h-[40%] overflow-y-auto draft-plan__annotations">
          <div className="flex items-center justify-between px-3 h-7 sticky top-0 bg-ide-sidebar z-[1] border-b border-ide-border/60">
            <span className="text-[10px] uppercase tracking-wider text-ide-text-muted/60">
              批注 <span className="text-ide-accent tabular-nums">{annotations.reduce((n, g) => n + g.items.length, 0)}</span>
            </span>
            <span className="text-[10px] text-ide-text-muted/40">Numpad7 → 转为命令</span>
          </div>
          {annotations.map(group => (
            <div key={group.fullPath} className="draft-plan__annotation-group">
              <div className="px-3 py-1 text-[11px] font-mono text-ide-text-muted truncate bg-ide-hover/30">
                {group.rel}
              </div>
              {[...group.items].sort((a, b) => a.start - b.start).map(ann => (
                <div key={ann.id} className="group flex items-start gap-1.5 px-2 py-1 mx-1 rounded hover:bg-ide-hover/40">
                  <span className="shrink-0 text-[11px] font-mono text-ide-accent pt-1 w-14 text-right">
                    :{ann.start === ann.end ? ann.start : `${ann.start}-${ann.end}`}
                  </span>
                  <textarea
                    data-id={ann.id}
                    className="draft-plan__annotation-opinion flex-1 min-w-0 text-xs p-1 bg-ide-bg border border-dashed border-ide-border rounded-[4px_8px_5px_7px] resize-none focus:outline-none focus:border-ide-accent text-ide-text"
                    rows={1}
                    placeholder="批注意见…"
                    value={ann.opinion}
                    onChange={(e) => { autoGrow(e.target); handleAnnotationOpinionChange(group.fullPath, ann.id, e.target.value) }}
                  />
                  <button
                    className="shrink-0 text-ide-text-muted hover:text-ide-danger text-xs pt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除"
                    onClick={() => handleAnnotationDelete(group.fullPath, ann.id)}
                  >✕</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 draft-plan__list">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-ide-text-muted/40 draft-plan__empty">
            <span className="text-[10px] text-ide-text-muted/50">组成你的管道序列</span>
            <div className="mt-2 flex flex-col items-center gap-0.5 text-[10px] text-ide-text-muted/40">
              <span>副键盘 <span className="text-ide-accent/60 tabular-nums">4 5 6 / 1 2 3</span> 速发</span>
              <span><span className="text-ide-accent/60">Numpad7</span> 批注→命令</span>
            </div>
          </div>
        ) : (
          items.map((item, i) => {
            const editing = editingId === item.id
            const isDragOver = dragOverIndex === i && dragFromRef.current !== null && dragFromRef.current !== i
            return (
              <div
                key={item.id}
                draggable={!editing}
                onDragStart={(e) => !editing && handleDragStart(e, i)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={(e) => handleDrop(e, i)}
                className={`group relative flex items-start gap-2 pl-2 pr-1 py-1.5 rounded-[6px_10px_5px_9px] border border-dashed border-ide-border/60 hover:bg-ide-hover/50 hover:border-ide-accent/50 transition-colors draft-plan__item${isDragOver ? ' draft-plan__item--drag-over ring-1 ring-ide-accent/60 border-ide-accent/60' : ''}${editing ? ' draft-plan__item--editing' : ''}`}
              >
                <span className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l bg-ide-accent opacity-0 group-hover:opacity-100 transition-opacity draft-plan__item-accent" />
                <span
                  className="shrink-0 mt-0.5 text-ide-text-muted/30 group-hover:text-ide-text-muted cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity draft-plan__item-handle"
                  title="拖拽排序"
                >
                  <GripVertical size={14} />
                </span>
                <span className="shrink-0 mt-0.5 text-sm text-ide-accent/70 leading-none select-none draft-plan__item-sigil">›</span>
                {editing ? (
                  <textarea
                    ref={editInputRef}
                    value={editText}
                    onChange={(e) => { setEditText(e.target.value); autoGrow(e.target) }}
                    onKeyDown={onEditKeyDown}
                    onBlur={handleSaveEdit}
                    rows={1}
                    className="flex-1 min-h-[1.5rem] bg-ide-bg/60 border border-dashed border-ide-accent/60 rounded-[4px_8px_5px_7px] px-2 py-1 text-sm text-ide-text focus:outline-none resize-none whitespace-pre-wrap break-words draft-plan__item-edit"
                  />
                ) : (
                  <div
                    onDoubleClick={() => handleStartEdit(item)}
                    className="flex-1 min-w-0 py-0.5 text-sm text-ide-text whitespace-pre-wrap break-words cursor-text draft-plan__item-text"
                  >
                    {item.text || <span className="text-ide-text-muted/40">(空)</span>}
                  </div>
                )}
                <div className="shrink-0 flex items-center gap-0.5 draft-plan__item-actions">
                  <button
                    onClick={() => handleCopy(item)}
                    className="w-6 h-6 flex items-center justify-center rounded text-ide-text-muted/40 hover:text-ide-text hover:bg-ide-hover/60 transition-colors draft-plan__item-btn"
                    title="复制"
                  >
                    {copiedId === item.id ? <Check size={13} className="text-ide-accent" /> : <Copy size={13} />}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="w-6 h-6 flex items-center justify-center rounded text-ide-text-muted/40 hover:text-ide-danger hover:bg-ide-hover/60 transition-colors draft-plan__item-btn"
                    title="删除"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="shrink-0 px-2 py-1.5 border-t border-ide-border draft-plan__keypad">
        <div className="grid grid-cols-3 gap-1">
          {KEYPAD_ITEMS.map(item => (
            <button
              key={item.code}
              onClick={() => handleKeypadSend(item)}
              className={`group flex flex-col items-center gap-0.5 px-1.5 py-1 draft-plan__key${pressedKey === item.code ? ' draft-plan__key--pressed' : ''}`}
              title={`Numpad ${item.key} → ${item.text}`}
            >
              <span className="text-xs font-bold text-ide-accent leading-none draft-plan__key-num">{item.key}</span>
              <span className="text-[10px] text-ide-text-muted group-hover:text-ide-text leading-tight truncate w-full text-center draft-plan__key-text">{item.text}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-2 py-1.5 border-t border-ide-border draft-plan__add">
        <div className="flex items-start gap-2 bg-ide-bg border border-dashed border-ide-border rounded-[6px_10px_5px_9px] pl-2 pr-1 py-1 focus-within:border-ide-accent/60 transition-colors">
          <textarea
            ref={addInputRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); autoGrow(e.target) }}
            onKeyDown={onAddKeyDown}
            placeholder={"写一条提示词…\nCtrl+Enter 添加 · 双击编辑 · 拖拽排序"}
            rows={3}
            className="flex-1 min-h-[4.5rem] max-h-[10rem] bg-transparent py-1 text-sm text-ide-text placeholder:text-ide-text-muted/40 focus:outline-none resize-none whitespace-pre-wrap break-words draft-plan__add-input"
          />
          <div className="flex flex-col gap-1 shrink-0 self-start mt-0.5">
            <button
              onClick={handleAdd}
              disabled={!draft.trim()}
              title="添加 (Ctrl+Enter)"
              className="w-7 h-7 inline-flex items-center justify-center rounded bg-ide-accent/15 hover:bg-ide-accent/25 text-ide-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed draft-plan__add-btn"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={handleSplit}
              disabled={!draft.trim()}
              title="按行拆分并添加到列表"
              className="w-7 h-7 inline-flex items-center justify-center rounded bg-ide-accent/15 hover:bg-ide-accent/25 text-ide-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed draft-plan__split-btn"
            >
              <Split size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-2 py-1.5 border-t border-ide-border draft-plan__footer">
        <div className="flex gap-2">
          <button
            onClick={handleConvert}
            disabled={items.length === 0 || sending}
            className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-md border border-ide-accent/40 bg-ide-accent/10 hover:bg-ide-accent/20 text-ide-accent text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed draft-plan__convert-btn"
            title="把列表拼成多行管道命令，存为 CustomCommand (pipe)"
          >
            <ListOrdered size={14} />
            转为管道命令
          </button>
          {sending ? (
            <button
              onClick={handlePipelineToggle}
              className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-md border border-ide-danger/40 bg-ide-danger/10 hover:bg-ide-danger/20 text-ide-danger text-xs font-medium transition-colors draft-plan__pipe-stop-btn"
            >
              <StopCircle size={14} />
              终止发送
            </button>
          ) : (
            <button
              onClick={handlePipelineToggle}
              disabled={items.length === 0}
              className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-md border border-ide-accent/40 bg-ide-accent/10 hover:bg-ide-accent/20 text-ide-accent text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed draft-plan__pipe-start-btn"
              title="将全部提示词以管道方式依次发送到终端"
            >
              <Send size={14} />
              管道发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
