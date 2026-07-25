import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { loadKeypadItems, saveKeypadItems } from './keypadItems'

export function KeypadConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState(() => loadKeypadItems())
  useEffect(() => { if (open) setDraft(loadKeypadItems()) }, [open])
  if (!open) return null
  const change = (code: string, text: string) => setDraft(prev => prev.map(k => k.code === code ? { ...k, text } : k))
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
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => { saveKeypadItems(draft); onClose() }}
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
