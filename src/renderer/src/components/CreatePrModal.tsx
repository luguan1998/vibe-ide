import { useState, useEffect, useCallback, useRef } from 'react'
import { useI18n } from '../i18n'
import { ModalOverlay } from './ModalOverlay'
import { PrListItem } from '@shared/types'
import { Check, AlertTriangle, Loader2 } from 'lucide-react'

interface CreatePrModalProps {
  host: string
  repoPath: string
  head: string
  base: string
  title: string
  branches: string[]
  onClose: () => void
  onCreated: (url: string) => void
}

const inputCls = 'w-full bg-ide-bg border border-ide-border rounded px-2 py-1.5 text-xs text-ide-text focus:border-ide-accent focus:outline-none placeholder:text-ide-text-muted/50'
const labelCls = 'block text-[11px] text-ide-text-muted mb-1'

type ConnState = { kind: 'checking' | 'ok' | 'warn' | 'error'; text: string }

export default function CreatePrModal({ host, repoPath, head, base, title, branches, onClose, onCreated }: CreatePrModalProps) {
  const { t } = useI18n()
  const [targetBranch, setTargetBranch] = useState(base)
  const [prTitle, setPrTitle] = useState(title)
  const [body, setBody] = useState('')
  const bodyDirtyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conn, setConn] = useState<ConnState | null>(null)
  const [conflict, setConflict] = useState<boolean | null>(null)
  const [existing, setExisting] = useState<PrListItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.git.prList().then(res => {
      if (!cancelled) setExisting(res.items || [])
    }).catch(() => {
      if (!cancelled) setExisting([])
    })
    return () => { cancelled = true }
  }, [])

  const refreshChecks = useCallback(async () => {
    if (!targetBranch.trim()) { setConn(null); setConflict(null); return }
    setConn({ kind: 'checking', text: t('Checking connection...') })
    setConflict(null)
    const [test, tpl, chk] = await Promise.all([
      window.api.git.prTest({ host, repoPath }),
      window.api.git.prTemplate(targetBranch),
      window.api.git.prCheckConflict(targetBranch)
    ])
    setConn(test.ok
      ? { kind: 'ok', text: `${t('Authenticated as')} ${test.login || '-'} · ${t('repo accessible')}` }
      : { kind: test.login ? 'warn' : 'error', text: test.error || t('Auth check failed') })
    if (!bodyDirtyRef.current && tpl.content) setBody(tpl.content)
    setConflict(chk.ok ? !!chk.conflict : null)
  }, [host, repoPath, targetBranch, t])

  useEffect(() => {
    refreshChecks()
  }, [refreshChecks])

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

  const branchOptions = Array.from(new Set([base, ...branches].filter(Boolean)))

  return (
    <ModalOverlay onClose={busy ? () => {} : onClose}>
      <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] max-h-[85vh] overflow-y-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
          <span className="text-sm font-semibold text-ide-text flex items-center gap-1.5">
            {t('Create Pull Request')}
            <span className="text-[11px] font-normal text-ide-text-muted font-mono truncate max-w-[200px]" title={`${host}/${repoPath}`}>{repoPath}</span>
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
          {existing && existing.length > 0 && (
            <div className="rounded border border-ide-warning/40 bg-ide-warning/10 px-2 py-1.5 space-y-1">
              <div className="text-[11px] text-ide-warning">{t('This branch PRs')}</div>
              {existing.map(it => (
                <button
                  key={it.number}
                  onClick={() => window.open(it.url)}
                  className="w-full text-left text-xs text-ide-text hover:text-ide-accent flex items-center gap-2"
                  title={it.url}
                >
                  <span className="font-mono text-ide-text-muted shrink-0">#{it.number}</span>
                  <span className="truncate">{it.title}</span>
                </button>
              ))}
            </div>
          )}
          <div>
            <span className={labelCls}>{t('Target branch')}</span>
            {branchOptions.length > 0 ? (
              <select
                className={inputCls}
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
              >
                {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
                {!branchOptions.includes(targetBranch) && targetBranch && <option value={targetBranch}>{targetBranch}</option>}
              </select>
            ) : (
              <input className={inputCls} value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} placeholder="main" />
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] min-h-[16px]">
            {conflict === true ? (
              <span className="text-ide-warning flex items-center gap-1"><AlertTriangle size={12} className="shrink-0" />{t('Merge conflict with target branch')}</span>
            ) : conflict === false ? (
              <span className="text-ide-success flex items-center gap-1"><Check size={12} className="shrink-0" />{t('Can merge cleanly')}</span>
            ) : null}
          </div>
          <div>
            <span className={labelCls}>{t('Title')}</span>
            <input className={inputCls} value={prTitle} onChange={(e) => setPrTitle(e.target.value)} placeholder={`${head} → ${targetBranch || 'main'}`} />
          </div>
          <div>
            <span className={labelCls}>{t('Description')}</span>
            <textarea
              className={`${inputCls} h-28 resize-none`}
              value={body}
              onChange={(e) => { setBody(e.target.value); bodyDirtyRef.current = true }}
            />
          </div>
          {conn && (
            <div className={`flex items-center gap-1.5 text-[11px] ${
              conn.kind === 'ok' ? 'text-ide-success' : conn.kind === 'warn' ? 'text-ide-warning' : conn.kind === 'error' ? 'text-ide-danger' : 'text-ide-text-muted'
            }`}>
              {conn.kind === 'checking'
                ? <Loader2 size={12} className="shrink-0 animate-spin" />
                : conn.kind === 'ok'
                ? <Check size={12} className="shrink-0" />
                : <AlertTriangle size={12} className="shrink-0" />}
              <span className="break-all">{conn.text}</span>
              {conn.kind !== 'checking' && (
                <button className="text-ide-text-muted hover:text-ide-text underline shrink-0 ml-auto" onClick={refreshChecks}>
                  {t('Retry')}
                </button>
              )}
            </div>
          )}
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
              disabled={busy || !targetBranch.trim() || conn?.kind === 'error'}
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
