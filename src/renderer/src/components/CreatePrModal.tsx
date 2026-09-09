import { useState } from 'react'
import { useI18n } from '../i18n'
import { ModalOverlay } from './ModalOverlay'

interface CreatePrModalProps {
  host: string
  head: string
  base: string
  title: string
  onClose: () => void
  onCreated: (url: string) => void
}

const inputCls = 'w-full bg-ide-bg border border-ide-border rounded px-2 py-1.5 text-xs text-ide-text focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50'
const labelCls = 'block text-[11px] text-ide-text-muted mb-1'

export default function CreatePrModal({ host, head, base, title, onClose, onCreated }: CreatePrModalProps) {
  const { t } = useI18n()
  const [targetBranch, setTargetBranch] = useState(base)
  const [prTitle, setPrTitle] = useState(title)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.git.createPr({ title: prTitle, body, base: targetBranch })
      if (res.ok) {
        onCreated(res.url || '')
      } else {
        setError(res.error || t('Create failed'))
      }
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? () => {} : onClose}>
      <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
          <span className="text-sm font-semibold text-ide-text flex items-center gap-1.5">
            {t('Create Pull Request')}
            <span className="text-[11px] font-normal text-ide-text-muted font-mono truncate max-w-[200px]">{host}</span>
          </span>
          <button
            className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="p-3 space-y-2">
          <div>
            <span className={labelCls}>{t('Source branch')}</span>
            <div className="px-2 py-1.5 text-xs font-mono text-ide-text-muted border border-ide-border/50 rounded bg-ide-hover/30 truncate">{head}</div>
          </div>
          <div>
            <span className={labelCls}>{t('Target branch')}</span>
            <input className={inputCls} value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} placeholder="main" />
          </div>
          <div>
            <span className={labelCls}>{t('Title')}</span>
            <input className={inputCls} value={prTitle} onChange={(e) => setPrTitle(e.target.value)} placeholder={`${head} → ${targetBranch || 'main'}`} />
          </div>
          <div>
            <span className={labelCls}>{t('Description')}</span>
            <textarea
              className={`${inputCls} h-24 resize-none`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {error && (
            <div className="px-2 py-1.5 text-[11px] text-ide-danger bg-ide-danger/10 rounded animate-fade-in break-all">{error}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
              onClick={onClose}
            >
              {t('Cancel')}
            </button>
            <button
              className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40"
              disabled={busy || !targetBranch.trim()}
              onClick={handleSubmit}
            >
              {busy ? t('Creating...') : t('Create')}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
