import { useState } from 'react'
import { Play, RefreshCw } from 'lucide-react'
import { useI18n } from '../i18n'

export default function DshPluginTab() {
  const [pkg, setPkg] = useState('')
  const [busy, setBusy] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [output, setOutput] = useState('')
  const [done, setDone] = useState(false)
  const { t } = useI18n()

  const run = async (action: string) => {
    const name = pkg.trim()
    if (!name || busy) return
    setBusy(true)
    setDone(false)
    setOutput('')
    const res = await window.api.dsh.plugin([action, name])
    setOutput(res.output)
    setBusy(false)
    setDone(res.ok)
  }

  const restart = async () => {
    if (restarting) return
    setRestarting(true)
    const res = await window.api.dsh.restart()
    setRestarting(false)
    if (res.ok && res.port !== undefined) {
      window.dispatchEvent(new CustomEvent('vibe:dsh-restarted', { detail: { port: res.port } }))
    } else {
      setOutput(res.error ?? 'dsh restart failed')
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '5px 8px',
    fontSize: 13,
    borderRadius: 6,
    background: 'var(--dsw-alias-bg-base, #1e1e1e)',
    border: '1px solid var(--dsw-alias-border-l1, #444)',
    color: 'var(--dsw-alias-text-base, #ddd)',
    outline: 'none',
  }
  const btnStyle = (danger = false): React.CSSProperties => ({
    padding: '5px 12px',
    fontSize: 13,
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    opacity: busy ? 0.5 : 1,
    background: danger
      ? 'var(--dsw-alias-bg-danger, #4a1d1d)'
      : 'var(--dsw-alias-bg-accent, #333)',
    color: 'var(--dsw-alias-text-base, #ddd)',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px' }}>
      <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
        {t('Plugin Bar Hint')}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          style={inputStyle}
          placeholder={t('Plugin Name')}
          value={pkg}
          disabled={busy}
          onChange={(e) => setPkg(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run('add') }}
        />
        <button style={btnStyle()} disabled={busy || !pkg.trim()} onClick={() => void run('add')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Play size={12} />
            {busy ? t('Installing...') : t('Install')}
          </span>
        </button>
        <button style={btnStyle(true)} disabled={busy || !pkg.trim()} onClick={() => void run('remove')}>
          {t('Uninstall')}
        </button>
      </div>
      {done && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--dsw-alias-text-success, #4ade80)' }}>
          {t('Plugins take effect after restarting dsh.')}
          <button style={btnStyle()} disabled={restarting} onClick={() => void restart()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={12} />
              {restarting ? t('Restarting...') : t('Restart dsh')}
            </span>
          </button>
        </div>
      )}
      {output && (
        <pre style={{
          maxHeight: 200,
          overflowY: 'auto',
          fontSize: 11,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          background: 'var(--dsw-alias-bg-base, #1e1e1e)',
          borderRadius: 6,
          padding: 8,
          margin: 0,
          color: 'var(--dsw-alias-text-muted, #999)',
        }}>{output}</pre>
      )}
    </div>
  )
}
