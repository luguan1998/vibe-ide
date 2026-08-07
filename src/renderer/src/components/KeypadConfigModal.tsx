import { useEffect, useRef, useState } from 'react'
import { X, Send, ClipboardPaste } from 'lucide-react'
import { loadKeypadItems, saveKeypadItems, loadBtwPrefix, saveBtwPrefix, type KeypadItem } from './keypadItems'

export function KeypadConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<KeypadItem[]>(() => loadKeypadItems())
  const [btwPrefix, setBtwPrefix] = useState(() => loadBtwPrefix())
  const listRef = useRef<HTMLDivElement>(null)
  const MAX_TEXT_H = 120
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    const h = el.scrollHeight
    el.style.height = Math.min(h, MAX_TEXT_H) + 'px'
    el.style.overflowY = h > MAX_TEXT_H ? 'auto' : 'hidden'
  }
  useEffect(() => { if (open) { setDraft(loadKeypadItems()); setBtwPrefix(loadBtwPrefix()) } }, [open])
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      listRef.current?.querySelectorAll('textarea').forEach(el => autoGrow(el as HTMLTextAreaElement))
    })
  }, [open, draft])
  if (!open) return null
  const change = (code: string, text: string) => setDraft(prev => prev.map(k => k.code === code ? { ...k, text } : k))
  const toggleDirectSend = (code: string) => setDraft(prev => prev.map(k => k.code === code ? { ...k, directSend: !k.directSend } : k))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-ide-sidebar border border-dashed border-ide-border rounded-[8px_12px_6px_10px] p-4 w-max min-w-56 max-w-[90vw] max-h-[80%] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">配置速发键</span>
          <button onClick={onClose} className="text-ide-text-muted hover:text-ide-text transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center gap-4 mb-2 text-[10px] text-ide-text-muted/70">
          <span className="flex items-center gap-1"><Send size={11} className="-scale-x-100" /> 点击即发送</span>
          <span className="flex items-center gap-1"><ClipboardPaste size={11} /> 仅填入输入框</span>
        </div>
        <div className="flex flex-col gap-2" ref={listRef}>
          {draft.map(k => (
            <div key={k.code} className="flex items-center gap-2">
              <textarea
                value={k.text}
                onChange={(e) => { change(k.code, e.target.value); autoGrow(e.currentTarget) }}
                rows={1}
                className="min-w-56 text-xs leading-4 [field-sizing:content] bg-ide-bg border border-dashed border-ide-border rounded-[4px_8px_5px_7px] px-2 py-1 text-ide-text focus:outline-none focus:border-ide-accent resize-none overflow-hidden"
              />
              <button
                onClick={() => toggleDirectSend(k.code)}
                className={`shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors ${
                  k.directSend
                    ? 'text-ide-accent hover:bg-ide-accent/15'
                    : 'text-ide-text-muted/50 hover:text-ide-text-muted hover:bg-ide-hover'
                }`}
                title={k.directSend ? '这条命令会立刻发送给agent' : '仅填入：只写入输入框，不回车发送'}
              >
                {k.directSend ? (
                  <Send size={14} className="-scale-x-100" />
                ) : (
                  <ClipboardPaste size={14} />
                )}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-dashed border-ide-border">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-ide-text-muted tracking-wider whitespace-nowrap">右键命令前缀</span>
            <input
              type="text"
              value={btwPrefix}
              onChange={(e) => setBtwPrefix(e.target.value)}
              className="flex-1 min-w-0 text-xs bg-ide-bg border border-dashed border-ide-border rounded-[4px_8px_5px_7px] px-2 py-1 text-ide-text focus:outline-none focus:border-ide-accent"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => { saveKeypadItems(draft); saveBtwPrefix(btwPrefix); onClose() }}
            className="flex-1 h-8 rounded-[6px_10px_5px_9px] border border-dashed border-ide-accent/40 bg-ide-accent/10 hover:bg-ide-accent/20 text-ide-accent text-xs font-medium transition-colors"
          >保存</button>
          <button
            onClick={onClose}
            className="flex-1 h-8 rounded-[6px_10px_5px_9px] border border-dashed border-ide-border bg-ide-bg/30 hover:bg-ide-hover text-ide-text-muted text-xs font-medium transition-colors"
          >取消</button>
        </div>
      </div>
    </div>
  )
}
