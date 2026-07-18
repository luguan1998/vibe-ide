import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { X, Plus, Split, ListOrdered, StopCircle, Settings, Play } from 'lucide-react'

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

const DEFAULT_KEYPAD_ITEMS: { code: string; key: string; text: string }[] = [
  { code: 'Numpad4', key: '4', text: '说中文' },
  { code: 'Numpad5', key: '5', text: '继续' },
  { code: 'Numpad6', key: '6', text: '还是报错' },
  { code: 'Numpad1', key: '1', text: '先别重构,整理实际需求' },
  { code: 'Numpad2', key: '2', text: '清理死代码' },
  { code: 'Numpad3', key: '3', text: '讲明白点' },
]

const KEYPAD_STORAGE_KEY = 'vibe-ide-keypad-items'

function loadKeypadItems(): { code: string; key: string; text: string }[] {
  try {
    const raw = localStorage.getItem(KEYPAD_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length === 6) {
        return DEFAULT_KEYPAD_ITEMS.map((d, i) => ({ ...d, text: typeof parsed[i]?.text === 'string' ? parsed[i].text : d.text }))
      }
    }
  } catch {}
  return DEFAULT_KEYPAD_ITEMS
}
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
    return `${ref} → ${opinion}`
  }).join('; ')
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

export default function VibeProgramer({ onBack }: { onBack?: () => void }) {
  const [items, setItems] = useState<DraftItem[]>([])
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const stopRef = useRef(false)

  const dragFromRef = useRef<number | null>(null)
  const addInputRef = useRef<HTMLTextAreaElement>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pressedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pressedKey, setPressedKey] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<AnnotationGroup[]>([])
  const annotationsRef = useRef<AnnotationGroup[]>([])
  annotationsRef.current = annotations
  const lastAnnotationIdRef = useRef<string | null>(null)
  const [keypadItems, setKeypadItems] = useState(loadKeypadItems)
  const keypadItemsRef = useRef(keypadItems)
  keypadItemsRef.current = keypadItems
  const [configOpen, setConfigOpen] = useState(false)
  const [configDraft, setConfigDraft] = useState<{ code: string; key: string; text: string }[]>([])

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

  const handleSendItem = useCallback((item: DraftItem) => {
    if (!item.text.trim()) return
    setItems(prev => prev.filter(it => it.id !== item.id))
    ;(window as any).__vibeSendLine?.(item.text)
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
    for (const group of prev) {
      const withOp = group.items.filter(it => it.opinion.trim()).sort((a, b) => a.start - b.start)
      if (withOp.length > 0) {
        const cmd = buildAnnotationCommand({ ...group, items: withOp })
        if (cmd) newItems.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: cmd })
      }
    }
    if (newItems.length === 0) return
    setItems(items => [...items, ...newItems])
    setAnnotations([])
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

  const handleConfigOpen = useCallback(() => {
    setConfigDraft(keypadItemsRef.current.map(k => ({ ...k })))
    setConfigOpen(true)
  }, [])

  const handleConfigDraftChange = useCallback((code: string, text: string) => {
    setConfigDraft(prev => prev.map(k => k.code === code ? { ...k, text } : k))
  }, [])

  const handleConfigSave = useCallback(() => {
    setKeypadItems(configDraft)
    try { localStorage.setItem(KEYPAD_STORAGE_KEY, JSON.stringify(configDraft)) } catch {}
    setConfigOpen(false)
  }, [configDraft])

  useLayoutEffect(() => {
    if (!configOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      setConfigOpen(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [configOpen])

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
      lastAnnotationIdRef.current = newId
    }
    window.addEventListener(ADD_ANNOTATION_EVENT, handler)
    return () => window.removeEventListener(ADD_ANNOTATION_EVENT, handler)
  }, [])
  useLayoutEffect(() => {
    const id = lastAnnotationIdRef.current
    if (!id) return
    const ta = containerRef.current?.querySelector<HTMLTextAreaElement>(`.draft-plan__annotation-opinion[data-id="${id}"]`)
    ta?.focus()
    lastAnnotationIdRef.current = null
  }, [annotations])

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
      if (e.code === 'Numpad0') {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleSingleSendRef.current()
        return
      }
      const item = keypadItemsRef.current.find(k => k.code === e.code)
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
    const prefill: DraftPrefill = { name: 'vibe programer', command, type: 'pipe' }
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

  const handleSingleSend = useCallback(() => {
    const first = items.find(it => it.text.trim())
    if (!first) return
    setItems(prev => prev.filter(it => it.id !== first.id))
    ;(window as any).__vibeSendLine?.(first.text)
  }, [items])
  const handleSingleSendRef = useRef(handleSingleSend)
  handleSingleSendRef.current = handleSingleSend

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
        .draft-plan__add-input {
          border: 3px inset rgb(var(--ide-border)) !important;
          background: rgb(var(--ide-bg)) !important;
          box-shadow: inset 2px 2px 4px rgba(0,0,0,0.5) !important;
        }
        .draft-plan__add-input:focus {
          border-style: ridge !important;
          border-color: rgb(var(--ide-accent)) !important;
        }
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
          <span className="text-xs font-bold text-ide-text-muted tracking-wider draft-plan__title">vibe programer</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleConfigOpen}
            className="text-ide-text-muted hover:text-ide-accent transition-colors"
            title="配置速发键"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={handleConvert}
            disabled={items.length === 0 || sending}
            className="text-ide-text-muted hover:text-ide-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="转为管道命令"
          >
            <ListOrdered size={14} />
          </button>
          {sending ? (
            <button
              onClick={handlePipelineToggle}
              className="text-ide-danger hover:text-ide-danger/80 transition-colors"
              title="终止管道发送"
            >
              <StopCircle size={14} />
            </button>
          ) : (
            <button
              onClick={handlePipelineToggle}
              disabled={items.length === 0}
              className="text-ide-accent hover:text-ide-accent/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="管道发送全部"
            >
              <Play size={14} />
            </button>
          )}
        </div>
      </div>

      {annotations.length > 0 && (
        <div className="shrink-0 border-b border-ide-border max-h-[40%] overflow-y-auto draft-plan__annotations">
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
          <div className="flex justify-end px-3 py-2">
            <button
              onClick={handleAnnotationConvert}
              className="px-5 py-1.5 rounded-[6px_10px_5px_9px] bg-ide-accent text-white text-sm font-bold hover:brightness-110 active:brightness-95 transition-all"
            >
              完成
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 draft-plan__list">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-ide-text-muted/40 draft-plan__empty">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="w-12 h-12" style={{ flex: 'none', lineHeight: 1 }}>
              <title>HuggingFace</title>
              <path d="M2.25 11.535c0-3.407 1.847-6.554 4.844-8.258a9.822 9.822 0 019.687 0c2.997 1.704 4.844 4.851 4.844 8.258 0 5.266-4.337 9.535-9.687 9.535S2.25 16.8 2.25 11.535z" fill="#FF9D0B" />
              <path d="M11.938 20.086c4.797 0 8.687-3.829 8.687-8.551 0-4.722-3.89-8.55-8.687-8.55-4.798 0-8.688 3.828-8.688 8.55 0 4.722 3.89 8.55 8.688 8.55z" fill="#FFD21E" />
              <path d="M11.875 15.113c2.457 0 3.25-2.156 3.25-3.263 0-.576-.393-.394-1.023-.089-.582.283-1.365.675-2.224.675-1.798 0-3.25-1.693-3.25-.586 0 1.107.79 3.263 3.25 3.263h-.003z" fill="#FF323D" />
              <path d="M14.76 9.21c.32.108.445.753.767.585.447-.233.707-.708.659-1.204a1.235 1.235 0 00-.879-1.059 1.262 1.262 0 00-1.33.394c-.322.384-.377.92-.14 1.36.153.283.638-.177.925-.079l-.002.003zm-5.887 0c-.32.108-.448.753-.768.585a1.226 1.226 0 01-.658-1.204c.048-.495.395-.913.878-1.059a1.262 1.262 0 011.33.394c.322.384.377.92.14 1.36-.152.283-.64-.177-.925-.079l.003.003zm1.12 5.34a2.166 2.166 0 011.325-1.106c.07-.02.144.06.219.171l.192.306c.069.1.139.175.209.175.074 0 .15-.074.223-.172l.205-.302c.08-.11.157-.188.234-.165.537.168.986.536 1.25 1.026.932-.724 1.275-1.905 1.275-2.633 0-.508-.306-.426-.81-.19l-.616.296c-.52.24-1.148.48-1.824.48-.676 0-1.302-.24-1.823-.48l-.589-.283c-.52-.248-.838-.342-.838.177 0 .703.32 1.831 1.187 2.56l.18.14z" fill="#3A3B45" />
              <path d="M17.812 10.366a.806.806 0 00.813-.8c0-.441-.364-.8-.813-.8a.806.806 0 00-.812.8c0 .442.364.8.812.8zm-11.624 0a.806.806 0 00.812-.8c0-.441-.364-.8-.812-.8a.806.806 0 00-.813.8c0 .442.364.8.813.8zM4.515 13.073c-.405 0-.765.162-1.017.46a1.455 1.455 0 00-.333.925 1.801 1.801 0 00-.485-.074c-.387 0-.737.146-.985.409a1.41 1.41 0 00-.2 1.722 1.302 1.302 0 00-.447.694c-.06.222-.12.69.2 1.166a1.267 1.267 0 00-.093 1.236c.238.533.81.958 1.89 1.405l.24.096c.768.3 1.473.492 1.478.494.89.243 1.808.375 2.732.394 1.465 0 2.513-.443 3.115-1.314.93-1.342.842-2.575-.274-3.763l-.151-.154c-.692-.684-1.155-1.69-1.25-1.912-.195-.655-.71-1.383-1.562-1.383-.46.007-.889.233-1.15.605-.25-.31-.495-.553-.715-.694a1.87 1.87 0 00-.993-.312zm14.97 0c.405 0 .767.162 1.017.46.216.262.333.588.333.925.158-.047.322-.071.487-.074.388 0 .738.146.985.409a1.41 1.41 0 01.2 1.722c.22.178.377.422.445.694.06.222.12.69-.2 1.166.244.37.279.836.093 1.236-.238.533-.81.958-1.889 1.405l-.239.096c-.77.3-1.475.492-1.48.494-.89.243-1.808.375-2.732.394-1.465 0-2.513-.443-3.115-1.314-.93-1.342-.842-2.575.274-3.763l.151-.154c.695-.684 1.157-1.69 1.252-1.912.195-.655.708-1.383 1.56-1.383.46.007.889.233 1.15.605.25-.31.495-.553.718-.694.244-.162.523-.265.814-.3l.176-.012z" fill="#FF9D0B" />
              <path d="M9.785 20.132c.688-.994.638-1.74-.305-2.667-.945-.928-1.495-2.288-1.495-2.288s-.205-.788-.672-.714c-.468.074-.81 1.25.17 1.971.977.721-.195 1.21-.573.534-.375-.677-1.405-2.416-1.94-2.751-.532-.332-.907-.148-.782.541.125.687 2.357 2.35 2.14 2.707-.218.362-.983-.42-.983-.42S2.953 14.9 2.43 15.46c-.52.558.398 1.026 1.7 1.803 1.308.778 1.41.985 1.225 1.28-.187.295-3.07-2.1-3.34-1.083-.27 1.011 2.943 1.304 2.745 2.006-.2.7-2.265-1.324-2.685-.537-.425.79 2.913 1.718 2.94 1.725 1.075.276 3.813.859 4.77-.522zm4.432 0c-.687-.994-.64-1.74.305-2.667.943-.928 1.493-2.288 1.493-2.288s.205-.788.675-.714c.465.074.807 1.25-.17 1.971-.98.721.195 1.21.57.534.377-.677 1.407-2.416 1.94-2.751.532-.332.91-.148.782.541-.125.687-2.355 2.35-2.137 2.707.215.362.98-.42.98-.42S21.05 14.9 21.57 15.46c.52.558-.395 1.026-1.7 1.803-1.308.778-1.408.985-1.225 1.28.187.295 3.07-2.1 3.34-1.083.27 1.011-2.94 1.304-2.743 2.006.2.7 2.263-1.324 2.685-.537.423.79-2.912 1.718-2.94 1.725-1.077.276-3.815.859-4.77-.522z" fill="#FFD21E" />
            </svg>
            <span className="text-lg text-ide-text-muted/50">组成你的管道序列</span>
            <div className="mt-2 flex flex-col items-center gap-0.5 text-sm text-ide-text-muted/40">
              <span>副键盘 <span className="text-ide-accent/60 tabular-nums">4 5 6 / 1 2 3</span> 速发</span>
              <span className="flex items-center gap-1.5">
                <span><span className="text-ide-accent/60">Numpad7</span> 批注→命令</span>
                <button
                  onClick={handleAnnotationConvert}
                  disabled={annotations.length === 0}
                  className="flex items-center justify-center w-5 h-5 rounded text-ide-text-muted/60 hover:text-ide-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="转为命令 (Numpad7)"
                >
                  <ListOrdered size={12} />
                </button>
              </span>
              <span><span className="text-ide-accent/60">Numpad0</span> 单条发送</span>
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
                className={`group relative flex items-start gap-2 pl-2 pr-1 py-1.5 rounded-[6px_10px_5px_9px] border border-dashed border-ide-border/60 hover:bg-ide-hover/50 hover:border-ide-accent/50 transition-colors cursor-grab active:cursor-grabbing draft-plan__item${isDragOver ? ' draft-plan__item--drag-over ring-1 ring-ide-accent/60 border-ide-accent/60' : ''}${editing ? ' draft-plan__item--editing cursor-default' : ''}`}
              >
                <span className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l bg-ide-accent opacity-0 group-hover:opacity-100 transition-opacity draft-plan__item-accent" />
                <button
                  onClick={() => handleSendItem(item)}
                  className="shrink-0 mt-0.5 w-6 h-6 flex items-center justify-center rounded text-ide-accent font-bold text-xs hover:bg-ide-accent/10 transition-colors draft-plan__item-btn"
                  title="立即发送"
                >
                  &gt;_
                </button>
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

      <div className="shrink-0 px-2 py-1.5 border-t border-ide-border draft-plan__keypad">
        <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-ide-bg/80 border border-ide-border shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)] draft-plan__keypad-frame">
          {keypadItems.map(item => (
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

      {configOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfigOpen(false)}>
          <div
            className="bg-ide-sidebar border border-dashed border-ide-border rounded-[8px_12px_6px_10px] p-4 w-80 max-h-[80%] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-ide-text-muted tracking-wider">配置速发键</span>
              <button onClick={() => setConfigOpen(false)} className="text-ide-text-muted hover:text-ide-text transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {configDraft.map(k => (
                <div key={k.code} className="flex items-center gap-2">
                  <span className="w-5 text-center text-sm font-bold text-ide-accent">{k.key}</span>
                  <input
                    type="text"
                    value={k.text}
                    onChange={(e) => handleConfigDraftChange(k.code, e.target.value)}
                    className="flex-1 min-w-0 text-xs bg-ide-bg border border-dashed border-ide-border rounded-[4px_8px_5px_7px] px-2 py-1 text-ide-text focus:outline-none focus:border-ide-accent"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleConfigSave}
                className="flex-1 h-8 rounded-[6px_10px_5px_9px] border border-dashed border-ide-accent/40 bg-ide-accent/10 hover:bg-ide-accent/20 text-ide-accent text-xs font-medium transition-colors"
              >保存</button>
              <button
                onClick={() => setConfigOpen(false)}
                className="flex-1 h-8 rounded-[6px_10px_5px_9px] border border-dashed border-ide-border bg-ide-bg/30 hover:bg-ide-hover text-ide-text-muted text-xs font-medium transition-colors"
              >取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
