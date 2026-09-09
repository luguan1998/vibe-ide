import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../i18n'
import { ModalOverlay } from './ModalOverlay'
import { PrProviderView, PrProviderInput, PrProviderType } from '@shared/types'

interface PrProvidersModalProps {
  onClose: () => void
}

const EMPTY_FORM: PrProviderInput = { type: 'gitlab', host: '', baseUrl: '', trustSelfSigned: false, token: '' }

const inputCls = 'w-full bg-ide-bg border border-ide-border rounded px-2 py-1.5 text-xs text-ide-text font-mono focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50'
const labelCls = 'block text-[11px] text-ide-text-muted mb-1'

export default function PrProvidersModal({ onClose }: PrProvidersModalProps) {
  const { t } = useI18n()
  const [providers, setProviders] = useState<PrProviderView[]>([])
  const [editing, setEditing] = useState<PrProviderInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({})

  const refresh = useCallback(async () => {
    setProviders(await window.api.git.prProviders())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const startEdit = (p: PrProviderView) => {
    setEditing({ id: p.id, type: p.type, host: p.host, baseUrl: p.baseUrl, trustSelfSigned: p.trustSelfSigned, token: '' })
  }

  const handleSave = async () => {
    if (!editing || !editing.host.trim() || saving) return
    setSaving(true)
    try {
      setProviders(await window.api.git.prProviderSave(editing))
      setTestResults({})
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setProviders(await window.api.git.prProviderDelete(id))
    if (editing?.id === id) setEditing(null)
  }

  const handleTest = async (id: string) => {
    const p = providers.find(x => x.id === id)
    if (!p) return
    setTestingId(id)
    try {
      const info = await window.api.git.prRemoteInfo().catch(() => null)
      const repoPath = info?.ok && info.host === p.host ? info.repoPath : undefined
      const res = await window.api.git.prTest({ id, repoPath })
      setTestResults(prev => ({
        ...prev,
        [id]: res.ok
          ? { ok: true, text: `${t('Authenticated as')} ${res.login || '-'}${repoPath ? ` · ${t('repo accessible')}` : ''}` }
          : { ok: false, text: res.error || t('Auth check failed') }
      }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
          <span className="text-sm font-semibold text-ide-text">{t('Code Hosting')}</span>
          <button
            className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {providers.length === 0 && !editing && (
            <div className="text-xs text-ide-text-muted text-center py-3">
              {t('No hosting platform. Click "+ New" to add')}
            </div>
          )}
          {providers.map(p => (
            <div key={p.id} className={`border rounded overflow-hidden ${editing?.id === p.id ? 'border-ide-accent/60' : 'border-ide-border'}`}>
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-ide-text truncate font-mono">{p.host}</div>
                  <div className="text-[11px] text-ide-text-muted truncate">
                    {p.type}
                    {p.tokenSet ? '' : ` · ${t('No token')}`}
                    {p.trustSelfSigned ? ` · ${t('Trust self-signed')}` : ''}
                  </div>
                </div>
                <button
                  className="px-2 py-1 text-[11px] text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors disabled:opacity-40"
                  disabled={testingId === p.id || !p.tokenSet}
                  onClick={() => handleTest(p.id)}
                >
                  {testingId === p.id ? t('Testing...') : t('Test')}
                </button>
                <button
                  className="px-2 py-1 text-[11px] text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                  onClick={() => startEdit(p)}
                >
                  {t('Edit')}
                </button>
                <button
                  className="px-2 py-1 text-[11px] text-ide-danger hover:bg-ide-danger/10 rounded transition-colors"
                  onClick={() => handleDelete(p.id)}
                >
                  {t('Delete')}
                </button>
              </div>
              {testResults[p.id] && (
                <div className={`px-3 py-1.5 text-[11px] border-t border-ide-border/50 break-all animate-fade-in ${
                  testResults[p.id].ok ? 'text-ide-success bg-ide-success/5' : 'text-ide-danger bg-ide-danger/10'
                }`}>
                  {testResults[p.id].text}
                </div>
              )}
            </div>
          ))}
          {editing && (
            <div className="space-y-2 border border-ide-accent/40 rounded p-3">
              <div>
                <span className={labelCls}>{t('Provider Type')}</span>
                <select
                  className={inputCls}
                  value={editing.type}
                  onChange={(e) => setEditing({ ...editing, type: e.target.value as PrProviderType })}
                >
                  <option value="github">GitHub / GHES</option>
                  <option value="gitlab">GitLab</option>
                  <option value="codehub">CodeHub (GitLab 兼容)</option>
                </select>
              </div>
              <div>
                <span className={labelCls}>{t('Host')}</span>
                <input
                  className={inputCls}
                  value={editing.host}
                  onChange={(e) => setEditing({ ...editing, host: e.target.value })}
                  placeholder="codehub.xxx.cn"
                />
              </div>
              <div>
                <span className={labelCls}>{t('Base URL')}</span>
                <input
                  className={inputCls}
                  value={editing.baseUrl}
                  onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                  placeholder="https://codehub.xxx.cn"
                />
              </div>
              <div>
                <span className={labelCls}>{t('API Token')}</span>
                <input
                  type="password"
                  className={inputCls}
                  value={editing.token || ''}
                  onChange={(e) => setEditing({ ...editing, token: e.target.value })}
                  placeholder={editing.id ? t('Leave blank to keep current') : t('Personal access token')}
                />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-ide-text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="accent-ide-accent"
                  checked={editing.trustSelfSigned}
                  onChange={(e) => setEditing({ ...editing, trustSelfSigned: e.target.checked })}
                />
                {t('Trust self-signed')}
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                  onClick={() => setEditing(null)}
                >
                  {t('Cancel')}
                </button>
                <button
                  className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40"
                  disabled={saving || !editing.host.trim()}
                  onClick={handleSave}
                >
                  {t('Save')}
                </button>
              </div>
            </div>
          )}
          {!editing && (
            <button
              className="w-full py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded border border-dashed border-ide-border transition-colors"
              onClick={() => setEditing({ ...EMPTY_FORM })}
            >
              + {t('New')}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}
