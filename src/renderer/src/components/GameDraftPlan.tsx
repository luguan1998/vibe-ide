import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Copy, Check, Pencil, X, GripVertical, Plus, ListOrdered, Send } from 'lucide-react'

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
export const EXECUTE_COMMAND_EVENT = 'vibe-ide-execute-command'

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
  const [copiedAll, setCopiedAll] = useState(false)

  const dragFromRef = useRef<number | null>(null)
  const addInputRef = useRef<HTMLTextAreaElement>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { addInputRef.current?.focus() }, [])

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

  const handleCopyAll = useCallback(() => {
    const md = items.map(it => `- ${it.text}`).join('\n')
    if (!md.trim()) return
    navigator.clipboard?.writeText(md).catch(() => {})
    setCopiedAll(true)
    if (copiedAllTimerRef.current) clearTimeout(copiedAllTimerRef.current)
    copiedAllTimerRef.current = setTimeout(() => setCopiedAll(false), 1200)
  }, [items])

  const handleConvert = useCallback(() => {
    const command = items.map(it => it.text).filter(t => t.trim()).join('\n')
    if (!command) return
    const prefill: DraftPrefill = { name: '草稿计划', command, type: 'pipe' }
    window.dispatchEvent(new CustomEvent(OPEN_CMD_MODAL_EVENT, { detail: prefill }))
  }, [items])

  const handleSendNext = useCallback(() => {
    const first = items[0]
    if (!first) return
    window.dispatchEvent(new CustomEvent(EXECUTE_COMMAND_EVENT, { detail: first.text }))
    setItems(prev => prev.slice(1))
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
      if (copiedAllTimerRef.current) clearTimeout(copiedAllTimerRef.current)
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
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none draft-plan" tabIndex={-1}>
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none draft-plan__header">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors" title="Back to menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-text-muted">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="3.5" cy="6" r="1.5" />
            <circle cx="3.5" cy="12" r="1.5" />
            <circle cx="3.5" cy="18" r="1.5" />
          </svg>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider draft-plan__title">草稿计划</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Items</div>
            <div className="text-ide-accent font-bold tabular-nums">{items.length}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 draft-plan__list">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-ide-text-muted/40 draft-plan__empty">
            <span className="text-2xl text-ide-text-muted/20 leading-none">›</span>
            <span className="text-xs">还没有提示词</span>
            <span className="text-[10px] text-ide-text-muted/50">写第一条，组成你的管道序列</span>
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
                className={`group relative flex items-start gap-2 pl-2 pr-1 py-1.5 rounded-md border border-ide-border/60 bg-ide-bg/30 hover:bg-ide-hover hover:border-ide-accent/40 transition-colors draft-plan__item${isDragOver ? ' draft-plan__item--drag-over ring-1 ring-ide-accent/60 border-ide-accent/60' : ''}${editing ? ' draft-plan__item--editing' : ''}`}
              >
                <span className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l bg-ide-accent opacity-0 group-hover:opacity-100 transition-opacity draft-plan__item-accent" />
                <span
                  className="shrink-0 mt-0.5 text-ide-text-muted/30 group-hover:text-ide-text-muted cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity draft-plan__item-handle"
                  title="拖拽排序"
                >
                  <GripVertical size={14} />
                </span>
                <span className="shrink-0 mt-1 text-[10px] tabular-nums text-ide-text-muted/40 w-4 text-right leading-none draft-plan__item-index">{String(i + 1).padStart(2, '0')}</span>
                <span className="shrink-0 mt-0.5 text-sm text-ide-accent/70 leading-none select-none draft-plan__item-sigil">›</span>
                {editing ? (
                  <textarea
                    ref={editInputRef}
                    value={editText}
                    onChange={(e) => { setEditText(e.target.value); autoGrow(e.target) }}
                    onKeyDown={onEditKeyDown}
                    onBlur={handleSaveEdit}
                    rows={1}
                    className="flex-1 min-h-[1.5rem] bg-ide-bg/60 border border-ide-accent/60 rounded px-2 py-1 text-sm text-ide-text focus:outline-none resize-none whitespace-pre-wrap break-words draft-plan__item-edit"
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
                    onClick={() => handleStartEdit(item)}
                    disabled={editing}
                    className="w-6 h-6 flex items-center justify-center rounded text-ide-text-muted/40 hover:text-ide-text hover:bg-ide-hover/60 transition-colors disabled:opacity-30 draft-plan__item-btn"
                    title="编辑"
                  >
                    <Pencil size={13} />
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

      <div className="shrink-0 px-2 py-1.5 border-t border-ide-border draft-plan__add">
        <div className="flex items-start gap-2 bg-ide-bg border border-ide-border rounded-md pl-2 pr-1 py-1 focus-within:border-ide-accent/60 transition-colors">
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
              onClick={handleCopyAll}
              disabled={items.length === 0}
              title="复制全部为 Markdown 列表"
              className="w-7 h-7 inline-flex items-center justify-center rounded bg-ide-accent/15 hover:bg-ide-accent/25 text-ide-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed draft-plan__copy-all-btn"
            >
              {copiedAll ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-2 py-1.5 border-t border-ide-border draft-plan__footer">
        <div className="flex gap-2">
          <button
            onClick={handleConvert}
            disabled={items.length === 0}
            className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-md border border-ide-accent/40 bg-ide-accent/10 hover:bg-ide-accent/20 text-ide-accent text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed draft-plan__convert-btn"
            title="把列表拼成多行管道命令，存为 CustomCommand (pipe)"
          >
            <ListOrdered size={14} />
            转为管道命令
          </button>
          <button
            onClick={handleSendNext}
            disabled={items.length === 0}
            className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-md border border-ide-accent/40 bg-ide-accent/10 hover:bg-ide-accent/20 text-ide-accent text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed draft-plan__send-next-btn"
            title="发送最上面一条到终端并聚焦，然后从列表清除"
          >
            <Send size={14} />
            逐条发送
          </button>
        </div>
      </div>
    </div>
  )
}
