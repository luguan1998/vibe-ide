import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { loadKeypadItems, saveKeypadItems, loadBtwPrefix, saveBtwPrefix, type KeypadItem } from './keypadItems'

export function KeypadConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<KeypadItem[]>(() => loadKeypadItems())
  const [btwPrefix, setBtwPrefix] = useState(() => loadBtwPrefix())
  useEffect(() => { if (open) { setDraft(loadKeypadItems()); setBtwPrefix(loadBtwPrefix()) } }, [open])
  if (!open) return null
  const change = (code: string, text: string) => setDraft(prev => prev.map(k => k.code === code ? { ...k, text } : k))
  const toggleDirectSend = (code: string) => setDraft(prev => prev.map(k => k.code === code ? { ...k, directSend: !k.directSend } : k))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-ide-sidebar border border-dashed border-ide-border rounded-[8px_12px_6px_10px] p-4 w-80 max-h-[80%] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">配置速发键</span>
          <button onClick={onClose} className="text-ide-text-muted hover:text-ide-text transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {draft.map(k => (
            <div key={k.code} className="flex items-center gap-2">
              <span className="w-5 text-center text-sm font-bold text-ide-accent">{k.key}</span>
              <input
                type="text"
                value={k.text}
                onChange={(e) => change(k.code, e.target.value)}
                className="flex-1 min-w-0 text-xs bg-ide-bg border border-dashed border-ide-border rounded-[4px_8px_5px_7px] px-2 py-1 text-ide-text focus:outline-none focus:border-ide-accent"
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
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M3.5 2.75a.75.75 0 0 0-1.5 0v14.5a.75.75 0 0 0 1.5 0V12a.75.75 0 0 1 .75-.75h9.69l-2.22 2.22a.75.75 0 1 0 1.06 1.06l3.5-3.5a.75.75 0 0 0 0-1.06l-3.5-3.5a.75.75 0 1 0-1.06 1.06l2.22 2.22H4.25a.75.75 0 0 1-.75-.75V2.75Z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <rect x="7.5" y="2.5" width="2" height="12" rx="0.5" />
                    <rect x="6" y="15.5" width="5" height="2" rx="0.5" />
                    <path d="M11.5 6h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
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
