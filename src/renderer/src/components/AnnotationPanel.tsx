import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

export interface Annotation { start: number; end: number; opinion: string }

export function toRelPath(full: string | undefined | null, cwd?: string | null): string {
  const f = (full || '').replace(/\\/g, '/')
  const w = cwd ? cwd.replace(/\\/g, '/').replace(/\/$/, '') : ''
  return w && (f === w || f.startsWith(w + '/')) ? f.slice(w.length).replace(/^\//, '') : f
}

export function buildAnnotationMarkdown(rel: string, annos: Annotation[]): string {
  const sorted = [...annos].sort((a, b) => a.start - b.start)
  const body = sorted.map(a => {
    const ref = a.start === a.end ? `@${rel}:${a.start}` : `@${rel}:${a.start}-${a.end}`
    return `${ref}\n${a.opinion}`
  }).join('\n\n')
  return `# 批注：${rel}\n\n${body}`
}

interface AnnotationPanelProps {
  activeRange: { start: number; end: number } | null
  fullPath: string | undefined
  cwd: string | null
  onClose: () => void
}

export default function AnnotationPanel({ activeRange, fullPath, cwd, onClose }: AnnotationPanelProps) {
  const { t } = useI18n()
  const [ranges, setRanges] = useState<{ start: number; end: number }[]>([])
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    if (!activeRange) return
    setRanges(prev => prev.some(r => r.start === activeRange.start && r.end === activeRange.end)
      ? prev
      : [...prev, { start: activeRange.start, end: activeRange.end }])
  }, [activeRange])

  useEffect(() => {
    if (!activeRange) return
    const ta = containerRef.current?.querySelector<HTMLTextAreaElement>(
      `textarea[data-start="${activeRange.start}"][data-end="${activeRange.end}"]`
    )
    ta?.focus()
  }, [activeRange, ranges])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => () => { if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current) }, [])

  const handleCopy = () => {
    const rel = toRelPath(fullPath, cwd)
    const opinionated: Annotation[] = []
    containerRef.current?.querySelectorAll<HTMLTextAreaElement>('textarea[data-start]').forEach(ta => {
      const opinion = ta.value.trim()
      if (opinion) opinionated.push({ start: Number(ta.dataset.start), end: Number(ta.dataset.end), opinion })
    })
    if (opinionated.length === 0) return
    navigator.clipboard?.writeText(buildAnnotationMarkdown(rel, opinionated)).catch(() => {})
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1200)
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const relPath = toRelPath(fullPath, cwd)

  return (
    <div className="flex flex-col h-full bg-ide-sidebar" ref={containerRef}>
      <div className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-ide-border">
        <div className="flex items-center gap-2 text-xs text-ide-text font-medium min-w-0">
          <span className="shrink-0">{t('Annotation')}</span>
          <span className="truncate text-ide-text-muted font-mono">{relPath}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="px-2 py-0.5 text-[11px] bg-ide-accent hover:bg-ide-accent-hover text-white rounded"
            onClick={handleCopy}
          >📋 {copied ? t('Copied') : t('Copy annotations')}</button>
          <button className="text-ide-text-muted hover:text-ide-text text-sm leading-none px-1" title={t('Close')} onClick={onClose}>✕</button>
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-ide-text-muted px-4 text-center">
          {t('Alt+click a code line to annotate')}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {sorted.map(r => (
            <div key={`${r.start}-${r.end}`} className="group flex items-start gap-2 px-2 py-1 mx-1 rounded hover:bg-ide-hover/40">
              <span className="shrink-0 text-[11px] font-mono text-ide-accent pt-1 w-12 text-right">
                :{r.start === r.end ? r.start : `${r.start}-${r.end}`}
              </span>
              <textarea
                data-start={r.start}
                data-end={r.end}
                rows={2}
                placeholder={t('Write your annotation here')}
                defaultValue=""
                className="flex-1 min-w-0 text-xs p-1 bg-ide-bg border border-ide-border rounded resize-none focus:outline-none focus:border-ide-accent text-ide-text"
              />
              <button
                className="shrink-0 text-ide-text-muted hover:text-ide-danger text-xs pt-1 px-1"
                title={t('Delete annotation')}
                onClick={() => setRanges(prev => prev.filter(x => !(x.start === r.start && x.end === r.end)))}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
