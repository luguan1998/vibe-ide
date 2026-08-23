import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Folder, FolderUp, HardDrive } from 'lucide-react'
import { ModalOverlay } from './ModalOverlay'
import { useI18n } from '../i18n'
import { useRecentDirs } from '../cwdStore'
import { ClaudeLogoIcon } from './ClaudeLogoIcon'
import { DeepSeekLogoIcon } from './DeepSeekLogoIcon'

export type SessionMode = 'term' | 'gui' | 'dsh'

interface DirEntry { name: string; path: string; type: string }

let middleTextCtx: CanvasRenderingContext2D | null = null
const measureMiddleText = (text: string, font: string) => {
  middleTextCtx ||= document.createElement('canvas').getContext('2d')
  if (!middleTextCtx) return text.length * 6
  middleTextCtx.font = font
  return middleTextCtx.measureText(text).width
}

const middleDisplay = (text: string, headLen: number, tailLen: number) =>
  headLen <= 0 && tailLen <= 0 ? '...' : text.slice(0, headLen) + '...' + (tailLen > 0 ? text.slice(text.length - tailLen) : '')

const MiddlePathText = ({ text }: { text: string }) => {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(text)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const fit = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const cs = window.getComputedStyle(el)
        const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        const avail = el.clientWidth
        if (avail <= 0) return
        if (measureMiddleText(text, font) <= avail) { setDisplay(text); return }
        let lo = 0
        let hi = text.length
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2)
          const headLen = Math.ceil(mid / 2)
          const tailLen = mid - headLen
          if (measureMiddleText(middleDisplay(text, headLen, tailLen), font) <= avail) lo = mid
          else hi = mid - 1
        }
        const headLen = Math.ceil(lo / 2)
        const tailLen = lo - headLen
        setDisplay(middleDisplay(text, headLen, tailLen))
      })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [text])
  return <span ref={ref} className="dir-picker__recent-path">{display}</span>
}

export function DirectoryPicker({ initialDir, onConfirm, onCancel }: {
  initialDir: string
  onConfirm: (cwd: string, mode: SessionMode) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const recentDirs = useRecentDirs()
  const [cwd, setCwd] = useState(initialDir)
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<SessionMode>('term')
  const [drives, setDrives] = useState<string[] | null>(null)
  const [editingPath, setEditingPath] = useState(false)
  const [pathText, setPathText] = useState(initialDir)

  useEffect(() => {
    let cancelled = false
    window.api.file.getDrives().then((d: string[]) => {
      if (cancelled) return
      setDrives(d)
      // 全新环境默认 C:\：跳到第一个非系统盘
      if (/^C:[\\/]*$/i.test(initialDir)) {
        const nonC = d.find(x => !/^C:/i.test(x))
        if (nonC) setCwd(nonC)
      }
    })
    return () => { cancelled = true }
  }, [initialDir])

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setError(null)
    window.api.file.list(cwd).then((res: any) => {
      if (cancelled) return
      if (res?.error) { setError(res.error); setEntries([]); return }
      const dirs = ((res as DirEntry[]) || [])
        .filter(e => e.type === 'directory')
        .sort((a, b) => a.name.localeCompare(b.name))
      setEntries(dirs)
    }).catch((e: any) => {
      if (!cancelled) { setError(e?.message ?? String(e)); setEntries([]) }
    })
    return () => { cancelled = true }
  }, [cwd])

  const isRoot = /^[A-Za-z]:[\\/]$/.test(cwd) || /^[\\/]$/.test(cwd) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]$/.test(cwd)
  const parent = cwd.replace(/[\\/][^\\/]+[\\/]?$/, '')

  const crumbs: { label: string; path: string }[] = []
  let accPath = ''
  for (const p of cwd.split(/[\\/]/).filter(Boolean)) {
    accPath = accPath === '' ? p + '\\' : accPath + '\\' + p
    crumbs.push({ label: p, path: accPath })
  }

  // 盘符/列表导航时同步路径文本
  useEffect(() => { setPathText(cwd) }, [cwd])

  const startEdit = () => { setPathText(cwd); setEditingPath(true) }
  const commitPath = () => {
    const p = pathText.trim()
    setEditingPath(false)
    if (p && p !== cwd) setCwd(p)
  }

  const modes: { key: SessionMode; label: string; icon: React.ReactNode }[] = [
    { key: 'term', label: t('Terminal'), icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
        <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
      </svg>
    ) },
    { key: 'gui', label: 'Claude', icon: <ClaudeLogoIcon size={14} /> },
    { key: 'dsh', label: 'dsh', icon: <DeepSeekLogoIcon size={14} /> },
  ]

  return (
    <ModalOverlay onClose={onCancel}>
      <div className="dir-picker bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[480px] h-[560px] min-w-[400px] min-h-[320px] resize flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-ide-border shrink-0">
          <span className="text-sm font-medium text-ide-text">{t('New Workspace')}</span>
        </div>
        {recentDirs.length > 0 && (
          <div className="px-2 py-1.5 border-b border-ide-border shrink-0 grid grid-cols-2 gap-0.5 overflow-y-auto overflow-x-auto max-h-[96px]">
            {recentDirs.map(d => (
              <button
                key={d}
                onClick={() => setCwd(d)}
                title={d}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors min-w-0"
              >
                <Folder size={12} className="text-ide-text-muted shrink-0" />
                <MiddlePathText text={d} />
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-1 min-h-0">
          <div className="w-[88px] shrink-0 border-r border-ide-border overflow-y-auto py-1.5 flex flex-col gap-0.5">
            <div className="px-3 pb-0.5">
              <span className="text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Disks')}</span>
            </div>
            {(drives || []).map(d => {
              const active = cwd.toLowerCase().startsWith(d.toLowerCase())
              return (
                <button
                  key={d}
                  onClick={() => setCwd(d)}
                  title={d}
                  className={`flex items-center gap-1 px-2 py-1 mx-1.5 rounded text-xs font-mono transition-colors ${active ? 'bg-ide-accent/20 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
                >
                  <HardDrive size={12} className={`shrink-0 ${active ? 'text-ide-accent' : 'text-ide-text-muted'}`} />
                  <span className="truncate">{d}</span>
                </button>
              )
            })}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1 px-3 py-2 border-b border-ide-border shrink-0">
          <div className={`flex-1 min-w-0 px-2 py-1 rounded bg-ide-sidebar border font-mono text-xs ${error ? 'border-ide-danger' : 'border-ide-border'}`}>
            {editingPath ? (
              <input
                autoFocus
                value={pathText}
                onChange={e => setPathText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitPath(); else if (e.key === 'Escape') setEditingPath(false) }}
                onBlur={() => setEditingPath(false)}
                spellCheck={false}
                className="w-full bg-transparent text-ide-text outline-none placeholder:text-ide-text-muted"
              />
            ) : (
              <div
                onClick={startEdit}
                className="w-full flex items-center gap-0.5 cursor-text"
                title={cwd}
              >
                {crumbs.map((c, i) => (
                  <React.Fragment key={i}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setCwd(c.path) }}
                      className="shrink-0 px-1 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors max-w-[160px] truncate"
                      title={c.path}
                    >
                      {c.label}
                    </button>
                    {i < crumbs.length - 1 && <span className="text-ide-text-muted shrink-0">/</span>}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setCwd(parent)}
            disabled={isRoot}
            title="上级"
            className={`shrink-0 w-6 h-6 rounded flex items-center justify-center transition-colors ${
              isRoot ? 'text-ide-text-muted opacity-40 cursor-not-allowed' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
            }`}
          >
            <FolderUp size={14} />
          </button>
        </div>
        <div className="px-3 pt-1.5 pb-0.5 shrink-0">
          <span className="text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Folder Selection')}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-0.5">
          {error ? (
            <div className="px-3 py-4 text-sm text-ide-danger text-center">{error}</div>
          ) : entries === null ? (
            <div className="px-3 py-4 text-sm text-ide-text-muted text-center">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-4 text-sm text-ide-text-muted text-center">无子目录</div>
          ) : (
            entries.map(e => (
              <button
                key={e.path}
                onClick={() => setCwd(e.path)}
                className="w-full px-3 py-1 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
              >
                <Folder size={14} className="text-ide-text-muted shrink-0" />
                <span className="truncate">{e.name}</span>
              </button>
            ))
          )}
        </div>
        </div>
        </div>
        <div className="flex items-center gap-1 px-3 py-2 border-t border-ide-border shrink-0">
          <div className="flex items-center rounded-md border border-ide-border overflow-hidden mr-auto">
            {modes.map((m, i) => (
              <button
                key={m.key}
                onClick={() => setSelectedMode(m.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${i > 0 ? 'border-l border-ide-border' : ''} ${
                  selectedMode === m.key
                    ? 'bg-ide-accent/20 text-ide-accent'
                    : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
                }`}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors">
            {t('Cancel')}
          </button>
          <button onClick={() => onConfirm(cwd, selectedMode)} className="px-4 py-1.5 text-sm bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors">
            {t('Confirm')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
