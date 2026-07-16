import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { SnippetInfo, SnippetsLoadResult } from '@shared/types'
import { useTheme } from '../themes'
import { useI18n } from '../i18n'
import { FolderOpen, RefreshCw, RotateCcw, Palette, PanelLeft, Code, Terminal, PanelRightClose, SlidersHorizontal, SwatchBook } from 'lucide-react'
import { syncTitleBarOverlay } from '../utils/titlebarSync'
import { DEFAULT_CWD_EMOJIS, DEFAULT_SESSION_EMOJIS } from './SessionPanel'

const FALLBACK_FONTS = [
  'Consolas', 'Cascadia Code', 'JetBrains Mono', 'Fira Code',
  'Source Code Pro', 'IBM Plex Mono', 'Monaco', 'Courier New', 'monospace',
]
const MONO_KW = ['mono', 'code', 'consol', 'courier', 'fira', 'hack', 'source code',
  'jetbrains', 'droid sans mono', 'dejavu sans mono', 'ubuntu mono', 'noto sans mono',
  'inconsolata', 'anonymous pro', '等宽', 'monospace']

type CategoryId = 'theme' | 'session' | 'editor' | 'terminal' | 'panel' | 'advanced'

const NAV_ITEMS: { id: CategoryId; label: string; zones: { session: boolean; editor: boolean; panel: boolean }; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'theme', label: 'Theme', zones: { session: true, editor: true, panel: true }, icon: SwatchBook },
  { id: 'session', label: 'Sidebar', zones: { session: true, editor: false, panel: false }, icon: PanelLeft },
  { id: 'editor', label: 'Editor', zones: { session: false, editor: true, panel: false }, icon: Code },
  { id: 'terminal', label: 'Terminal', zones: { session: false, editor: true, panel: false }, icon: Terminal },
  { id: 'panel', label: 'Right Panel', zones: { session: false, editor: false, panel: true }, icon: PanelRightClose },
  { id: 'advanced', label: 'Advanced', zones: { session: false, editor: false, panel: false }, icon: SlidersHorizontal },
]

type Zone = 'global' | 'session' | 'editor' | 'panel' | 'terminal'
const ZONE_PILL: Record<Zone, { key: string; cls: string }> = {
  global: { key: 'Affects: Global', cls: 'bg-ide-accent/15 text-ide-accent' },
  session: { key: 'Affects: Sessions', cls: 'bg-ide-warning/15 text-ide-warning' },
  editor: { key: 'Affects: Editor', cls: 'bg-ide-success/15 text-ide-success' },
  panel: { key: 'Affects: Panel', cls: 'bg-ide-danger/15 text-ide-danger' },
  terminal: { key: 'Affects: Terminal', cls: 'bg-ide-success/15 text-ide-success' },
}

function Pill({ zone }: { zone: Zone }) {
  const { t } = useI18n()
  const p = ZONE_PILL[zone]
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${p.cls}`}>{t(p.key)}</span>
}

function ToggleRow({ labelKey, descKey, checked, onChange, zone }: {
  labelKey: string; descKey?: string; checked: boolean; onChange: (v: boolean) => void; zone: Zone
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ide-text">{t(labelKey)}</span>
          <Pill zone={zone} />
        </div>
        {descKey && <p className="text-[12px] text-ide-text-muted">{t(descKey)}</p>}
      </div>
      <label className="shrink-0 cursor-pointer relative inline-flex items-center">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-ide-accent sr-only peer" />
        <span className="w-7 h-4 rounded-full bg-ide-hover border border-ide-border peer-checked:bg-ide-accent peer-checked:border-ide-accent transition-colors" />
        <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white transition-transform peer-checked:translate-x-3" />
      </label>
    </div>
  )
}

function StepperRow({ labelKey, descKey, value, display, onDelta, min, max, zone }: {
  labelKey: string; descKey?: string; value: number; display: string; onDelta: (d: number) => void; min: number; max: number; zone: Zone
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ide-text">{t(labelKey)}</span>
          <Pill zone={zone} />
        </div>
        {descKey && <p className="text-[12px] text-ide-text-muted">{t(descKey)}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-px">
        <button
          className="w-4 h-4 rounded bg-ide-hover text-ide-text-muted hover:bg-ide-accent hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={value <= min}
          onClick={(e) => { e.stopPropagation(); onDelta(-1) }}
        >{'<'}</button>
        <span className="text-center font-mono text-ide-accent font-bold text-sm leading-none w-7">{display}</span>
        <button
          className="w-4 h-4 rounded bg-ide-hover text-ide-text-muted hover:bg-ide-accent hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={value >= max}
          onClick={(e) => { e.stopPropagation(); onDelta(1) }}
        >{'>'}</button>
      </div>
    </div>
  )
}

function FontRow({ labelKey, value, recommended, monoOnly, onChange, zone, loadFonts, renderOptions }: {
  labelKey: string; value: string; recommended?: string; monoOnly?: boolean; onChange: (f: string) => void; zone: Zone
  loadFonts: () => void; renderOptions: (currentValue: string, recommended?: string, monoOnly?: boolean) => React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ide-text">{t(labelKey)}</span>
          <Pill zone={zone} />
        </div>
      </div>
      <select
        className="shrink-0 bg-ide-hover border border-ide-border rounded text-sm text-ide-text px-1.5 py-0.5 outline-none focus:border-ide-accent"
        value={value}
        onChange={(e) => { if (e.target.value) onChange(e.target.value) }}
        onClick={(e) => e.stopPropagation()}
        onFocus={loadFonts}
      >
        {renderOptions(value, recommended, monoOnly)}
      </select>
    </div>
  )
}

interface AppearancePanelProps {
  open: boolean
  onClose: () => void
  capsuleTabs?: boolean
  onToggleCapsuleTabs?: (v: boolean) => void
  groupSessionsByCwd?: boolean
  onToggleGroupSessionsByCwd?: (v: boolean) => void
  recentFilesPanelEnabled?: boolean
  onToggleRecentFilesPanel?: (v: boolean) => void
  outlineOverlayEnabled?: boolean
  onToggleOutlineOverlay?: (v: boolean) => void
  inlineDiff?: boolean
  onToggleInlineDiff?: (v: boolean) => void
  wordWrap?: boolean
  onToggleWordWrap?: (v: boolean) => void
  diffSplitRatio?: number
  onSetDiffSplitRatio?: (v: number) => void
  editorFontSize?: number
  onAdjustEditorFontSize?: (delta: number) => void
  fontFamily?: string
  onSetFontFamily?: (f: string) => void
  uiFontFamily?: string
  onSetUiFontFamily?: (f: string) => void
  termFontFamily?: string
  onSetTermFontFamily?: (f: string) => void
  terminalFontSize?: number
  onAdjustTerminalFontSize?: (delta: number) => void
  autoUtf8?: boolean
  onToggleAutoUtf8?: (v: boolean) => void
  cgEnabled?: boolean
  onToggleCgEnabled?: (v: boolean) => void
  ocrEnabled?: boolean
  onToggleOcrEnabled?: (v: boolean) => void
  forceDomRenderer?: boolean
  onToggleForceDomRenderer?: (v: boolean) => void
  pollingEnabled?: boolean
  onTogglePolling?: (v: boolean) => void
  cwdEmojis: string[]
  sessionEmojis: string[]
  onSetCwdEmojis: (arr: string[]) => void
  onSetSessionEmojis: (arr: string[]) => void
  onResetUiStyle?: () => void
  onCreateSessionAt?: (cwd: string, shell?: string) => void
}

const AppearancePanel = function AppearancePanel({
  open, onClose,
  capsuleTabs = true, onToggleCapsuleTabs,
  groupSessionsByCwd = true, onToggleGroupSessionsByCwd,
  recentFilesPanelEnabled = false, onToggleRecentFilesPanel,
  outlineOverlayEnabled = true, onToggleOutlineOverlay,
  inlineDiff = false, onToggleInlineDiff,
  wordWrap = false, onToggleWordWrap,
  diffSplitRatio = 0.3, onSetDiffSplitRatio,
  editorFontSize = 14, onAdjustEditorFontSize,
  fontFamily = 'Consolas', onSetFontFamily,
  uiFontFamily = 'Cascadia Code', onSetUiFontFamily,
  termFontFamily = 'Cascadia Code', onSetTermFontFamily,
  terminalFontSize = 14, onAdjustTerminalFontSize,
  autoUtf8 = true, onToggleAutoUtf8,
  cgEnabled = true, onToggleCgEnabled,
  ocrEnabled = true, onToggleOcrEnabled,
  forceDomRenderer = false, onToggleForceDomRenderer,
  pollingEnabled = false, onTogglePolling,
  cwdEmojis, sessionEmojis, onSetCwdEmojis, onSetSessionEmojis,
  onResetUiStyle, onCreateSessionAt,
}: AppearancePanelProps) {
  const { themes, currentThemeId, setTheme } = useTheme()
  const { t } = useI18n()
  const [activeCategory, setActiveCategory] = useState<CategoryId>('theme')
  const [dragOffset, setDragOffset] = useState({ x: 24, y: -24 })
  const dragRef = useRef<{ startX: number; startY: number; offX: number; offY: number } | null>(null)

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, offX: dragOffset.x, offY: dragOffset.y }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setDragOffset({
        x: dragRef.current.offX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.offY + (ev.clientY - dragRef.current.startY),
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const [snippetsList, setSnippetsList] = useState<SnippetInfo[]>([])
  const [snippetsDir, setSnippetsDir] = useState('')
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const fontsLoadedRef = useRef(false)
  const fontsLoadingRef = useRef(false)
  const pendingFontsRef = useRef(0)
  const [cwdEmojiDraft, setCwdEmojiDraft] = useState('')
  const [sessionEmojiDraft, setSessionEmojiDraft] = useState('')

  const contentRef = useRef<HTMLDivElement>(null)
  const [contentMinH, setContentMinH] = useState(0)
  useLayoutEffect(() => {
    const el = contentRef.current?.firstElementChild as HTMLElement | null
    if (el) {
      const h = el.scrollHeight
      setContentMinH(prev => h > prev ? h : prev)
    }
  }, [activeCategory, snippetsList, cwdEmojiDraft, sessionEmojiDraft, systemFonts])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      window.api.snippets.load().then(r => { setSnippetsList(r.snippets); setSnippetsDir(r.dir) }).catch(() => {})
      setCwdEmojiDraft(cwdEmojis.join('\n'))
      setSessionEmojiDraft(sessionEmojis.join('\n'))
    }
  }, [open])

  const applySnippetsResult = (result: SnippetsLoadResult) => {
    setSnippetsList(result.snippets)
    if (result.dir) setSnippetsDir(result.dir)
    const style = document.getElementById('custom-css')
    if (style) { style.textContent = result.css }
    else if (result.css) {
      const s = document.createElement('style')
      s.id = 'custom-css'
      s.textContent = result.css
      document.head.appendChild(s)
    }
    syncTitleBarOverlay()
  }

  const handleSnippetToggle = async (filename: string, enabled: boolean) => {
    const result = await window.api.snippets.toggle(filename, enabled)
    applySnippetsResult(result)
  }

  const handleSnippetReload = async () => {
    try {
      const result = await window.api.snippets.load()
      applySnippetsResult(result)
    } catch {}
  }

  const loadSystemFonts = useCallback(() => {
    if (fontsLoadedRef.current || fontsLoadingRef.current) return
    fontsLoadingRef.current = true
    const target = ++pendingFontsRef.current
    window.api.system.listFonts()
      .then((fonts) => {
        if (pendingFontsRef.current !== target) return
        if (fonts.length > 0) { setSystemFonts(fonts); fontsLoadedRef.current = true }
      })
      .catch(() => {})
      .finally(() => {
        if (pendingFontsRef.current !== target) return
        fontsLoadingRef.current = false
      })
  }, [])

  const renderFontOptions = (currentValue: string, recommended?: string, monoOnly?: boolean) => {
    const raw = systemFonts.length > 0 ? systemFonts : FALLBACK_FONTS
    const list = monoOnly ? raw.filter(f => MONO_KW.some(kw => f.toLowerCase().includes(kw))) : raw
    const prepend = !!currentValue && !list.includes(currentValue)
    const mark = (f: string) => f === recommended ? ` (${t('Recommended')})` : ''
    return (<>
      {prepend && <option key={`__cur__${currentValue}`} value={currentValue}>{currentValue}{mark(currentValue)}</option>}
      {list.map((f) => <option key={f} value={f}>{f}{mark(f)}</option>)}
    </>)
  }

  if (!open) return null

  const zones = NAV_ITEMS.find(n => n.id === activeCategory)!.zones

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-start pt-24 pl-12" onClick={onClose}>
      <div className="bg-ide-bg/50 backdrop-blur-xl border border-ide-border/80 rounded-2xl shadow-2xl w-[760px] max-h-[80vh] flex flex-col" style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0 cursor-move" onMouseDown={onHeaderMouseDown}>
          <span className="text-base font-semibold text-ide-text flex items-center gap-1.5"><Palette className="size-4" />{t('Appearance')}</span>
          <div className="flex items-center gap-1.5">
            {onResetUiStyle && (
              <button
                className="px-2.5 py-1 text-xs text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover rounded transition-colors flex items-center gap-1"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onResetUiStyle}
              ><RotateCcw className="size-3" />{t('Reset Defaults')}</button>
            )}
            <button
              className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onClose}
            >×</button>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-center gap-0 px-4 py-2 border-b border-ide-border bg-ide-sidebar/50">
          <div className={`w-28 shrink-0 h-7 rounded-l border text-xs flex items-center justify-center transition-all ${
            zones.session ? 'border-ide-accent bg-ide-accent/15 text-ide-accent font-medium'
                           : 'border-ide-border bg-ide-hover/30 text-ide-text-muted'
          }`}>{t('Affects: Sessions')}</div>
          <div className={`w-40 shrink-0 h-7 border-t border-b text-xs flex items-center justify-center transition-all ${
            zones.editor ? 'border-ide-accent bg-ide-accent/15 text-ide-accent font-medium'
                         : 'border-ide-border bg-ide-hover/30 text-ide-text-muted'
          }`}>{t('Affects: Editor')} · {t('Affects: Terminal')}</div>
          <div className={`w-28 shrink-0 h-7 rounded-r border text-xs flex items-center justify-center transition-all ${
            zones.panel ? 'border-ide-accent bg-ide-accent/15 text-ide-accent font-medium'
                        : 'border-ide-border bg-ide-hover/30 text-ide-text-muted'
          }`}>{t('Affects: Panel')}</div>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-32 shrink-0 flex flex-col border-r border-ide-border bg-ide-sidebar/30">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveCategory(item.id)}
                className={`w-full px-3 py-2 text-sm text-left transition-colors border-l-2 flex items-center gap-2 ${
                  activeCategory === item.id
                    ? 'text-ide-accent border-ide-accent font-medium bg-ide-accent/10'
                    : 'text-ide-text-muted border-transparent hover:text-ide-text hover:bg-ide-hover'
                }`}
              >
                <item.icon className="size-4 shrink-0" />
                {t(item.label)}
              </button>
            ))}
          </div>

          <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto" style={{ minHeight: contentMinH }}>
            {activeCategory === 'theme' && (
              <div className="p-4 flex gap-3 items-start">
                <div className="w-56 shrink-0 flex flex-col gap-1 pr-3 border-r border-ide-border">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { if (snippetsDir && onCreateSessionAt) { onCreateSessionAt(snippetsDir); onClose() } }}
                      className="flex-1 px-3 py-1.5 text-sm flex items-center gap-2 text-ide-text hover:bg-ide-hover rounded transition-colors"
                    >
                      <FolderOpen className="size-3.5" />
                      <span>{t('Open CSS Config')}</span>
                    </button>
                    <button
                      onClick={() => handleSnippetReload()}
                      title={t('Reload CSS')}
                      className="shrink-0 px-2 py-1.5 text-ide-text-muted hover:bg-ide-hover hover:text-ide-text rounded transition-colors"
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                  </div>
                  <div className="border-t border-ide-border my-1" />
                  {snippetsList.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-ide-text-muted">
                      {t('No snippets found.\nPlace .css files in the snippets/ folder.')}
                    </div>
                  ) : (
                    snippetsList.map(s => (
                      <div key={s.name} title={s.desc} className="flex items-center gap-2 py-1.5 px-1 rounded cursor-pointer hover:bg-ide-hover transition-colors" onClick={() => handleSnippetToggle(s.name, !s.enabled)}>
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            s.enabled ? 'bg-ide-accent border-ide-accent text-white' : 'border-ide-border'
                          }`}
                        >
                          {s.enabled && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <span className={`text-sm truncate ${s.enabled ? 'text-ide-text' : 'text-ide-text-muted/60'}`}>{s.name}</span>
                      </div>
                    ))
                  )}
                  <div className="border-t border-ide-border" />
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2">
                  {themes.map(theme => (
                    <button
                      key={theme.id}
                      onClick={() => setTheme(theme.id)}
                      className={`relative rounded-lg border-2 overflow-hidden aspect-[4/3] transition-all ${
                        currentThemeId === theme.id
                          ? 'border-ide-accent ring-1 ring-ide-accent'
                          : 'border-ide-border hover:border-ide-accent/40'
                      }`}
                    >
                      <div className="absolute inset-0 flex flex-col" style={{ background: `rgb(${theme.css['ide-bg']})` }}>
                        <div className="h-2 flex" style={{ background: `rgb(${theme.css['ide-sidebar']})` }} />
                        <div className="flex-1 flex">
                          <div className="w-3" style={{ background: `rgb(${theme.css['ide-sidebar']})` }} />
                          <div className="flex-1 p-0.5 flex flex-col gap-0.5">
                            <div className="h-1 rounded" style={{ background: `rgb(${theme.css['ide-hover']})` }} />
                            <div className="h-1 w-2/3 rounded" style={{ background: `rgb(${theme.css['ide-hover']})` }} />
                          </div>
                          <div className="w-3" style={{ background: `rgb(${theme.css['ide-panel']})` }} />
                        </div>
                      </div>
                      <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 bg-gradient-to-t from-black/50 to-transparent flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: `rgb(${theme.css['ide-accent']})` }} />
                        <span className="text-[10px] text-white truncate">{theme.label}</span>
                      </div>
                      {currentThemeId === theme.id && (
                        <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-ide-accent flex items-center justify-center">
                          <svg className="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeCategory === 'session' && (
              <div className="p-4 flex flex-col">
                {onToggleGroupSessionsByCwd && (
                  <ToggleRow labelKey="Group Sessions by Folder" descKey="Group sessions by their working directory. Off = flat list with cwd under each item."
                    checked={groupSessionsByCwd} onChange={onToggleGroupSessionsByCwd} zone="session" />
                )}
                {onToggleRecentFilesPanel && (
                  <ToggleRow labelKey="Recent Files Panel" descKey="Show recently opened files at the bottom of the session panel"
                    checked={recentFilesPanelEnabled} onChange={onToggleRecentFilesPanel} zone="session" />
                )}
                {onToggleOutlineOverlay && (
                  <ToggleRow labelKey="Outline" descKey="Show code outline over the session panel when viewing a file. Disable to keep the session list visible."
                    checked={outlineOverlayEnabled} onChange={onToggleOutlineOverlay} zone="session" />
                )}
                {onSetFontFamily && (
                  <FontRow labelKey="Session Font" value={fontFamily} recommended="Consolas" onChange={onSetFontFamily} zone="session" loadFonts={loadSystemFonts} renderOptions={renderFontOptions} />
                )}
                <div className="border-t border-ide-border mt-2 pt-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ide-text">{t('Emoji Text')}</span>
                      <Pill zone="session" />
                    </div>
                    <button
                      className="px-3 py-1.5 text-sm text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors flex items-center gap-1"
                      onClick={() => {
                        setCwdEmojiDraft(DEFAULT_CWD_EMOJIS.join('\n'))
                        setSessionEmojiDraft(DEFAULT_SESSION_EMOJIS.join('\n'))
                        onSetCwdEmojis([...DEFAULT_CWD_EMOJIS])
                        onSetSessionEmojis([...DEFAULT_SESSION_EMOJIS])
                      }}
                    ><RotateCcw className="size-3" />{t('Reset Defaults')}</button>
                  </div>
                  <p className="text-[12px] text-ide-text-muted">{t('Click any emoji in the sidebar to cycle.')}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ide-text-muted whitespace-nowrap">{t('Folder Icons (per cwd)')}</span>
                    <input
                      className="flex-1 bg-ide-bg border border-ide-border rounded px-2 py-1 text-sm text-ide-text font-mono focus:border-ide-accent focus:outline-none"
                      value={cwdEmojiDraft.split('\n').join(' ')}
                      onChange={(e) => {
                        const v = e.target.value
                        setCwdEmojiDraft(v)
                        const arr = v.split(/\s+/).filter(Boolean)
                        onSetCwdEmojis(arr)
                      }}
                      placeholder={'📁 📂 📍 🏷️'}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ide-text-muted whitespace-nowrap">{t('Session Icons')}</span>
                    <input
                      className="flex-1 bg-ide-bg border border-ide-border rounded px-2 py-1 text-sm text-ide-text font-mono focus:border-ide-accent focus:outline-none"
                      value={sessionEmojiDraft.split('\n').join(' ')}
                      onChange={(e) => {
                        const v = e.target.value
                        setSessionEmojiDraft(v)
                        const arr = v.split(/\s+/).filter(Boolean)
                        onSetSessionEmojis(arr)
                      }}
                      placeholder={'🔥 💀 🗿'}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeCategory === 'editor' && (
              <div className="p-4 flex flex-col">
                {onToggleInlineDiff && (
                  <ToggleRow labelKey="Force Inline Diff" descKey="Force inline diff mode (revert button uses circular icon). Recommended: off (side-by-side reads better)"
                    checked={inlineDiff} onChange={onToggleInlineDiff} zone="editor" />
                )}
                {onToggleWordWrap && (
                  <ToggleRow labelKey="Word Wrap" descKey="Auto-wrap long lines in diff/editor. Recommended: off"
                    checked={wordWrap} onChange={onToggleWordWrap} zone="editor" />
                )}
                {onSetDiffSplitRatio && (
                  <StepperRow labelKey="Diff Split Ratio" descKey="Left/right ratio of the diff editor. Smaller = narrower left (original). Side-by-side only."
                    value={diffSplitRatio} display={diffSplitRatio!.toFixed(1)} onDelta={(d) => onSetDiffSplitRatio(Math.round((diffSplitRatio! + d * 0.1) * 10) / 10)}
                    min={0.1} max={0.9} zone="editor" />
                )}
                {onAdjustEditorFontSize && (
                  <StepperRow labelKey="Editor Font Size"
                    value={editorFontSize} display={String(editorFontSize)} onDelta={(d) => onAdjustEditorFontSize(d)}
                    min={8} max={30} zone="editor" />
                )}
              </div>
            )}

            {activeCategory === 'terminal' && (
              <div className="p-4 flex flex-col">
                {onAdjustTerminalFontSize && (
                  <StepperRow labelKey="Terminal Font Size"
                    value={terminalFontSize} display={String(terminalFontSize)} onDelta={(d) => onAdjustTerminalFontSize(d)}
                    min={8} max={30} zone="terminal" />
                )}
                {onSetTermFontFamily && (
                  <FontRow labelKey="Terminal Font" value={termFontFamily} recommended="Cascadia Code" monoOnly onChange={onSetTermFontFamily} zone="terminal" loadFonts={loadSystemFonts} renderOptions={renderFontOptions} />
                )}
              </div>
            )}

            {activeCategory === 'panel' && (
              <div className="p-4 flex flex-col">
                <div className="text-[12px] text-ide-text-muted bg-ide-hover/50 rounded px-2 py-1.5 mb-2">{t('Try right-clicking a tab to hide/show tabs; drag to reorder.')}</div>
                {onToggleCapsuleTabs && (
                  <ToggleRow labelKey="Capsule Tabs" descKey="Use capsule-style tab bar instead of icon buttons."
                    checked={capsuleTabs} onChange={onToggleCapsuleTabs} zone="panel" />
                )}
                {onSetUiFontFamily && (
                  <FontRow labelKey="UI Font" value={uiFontFamily} recommended="Cascadia Code" onChange={onSetUiFontFamily} zone="global" loadFonts={loadSystemFonts} renderOptions={renderFontOptions} />
                )}
              </div>
            )}

            {activeCategory === 'advanced' && (
              <div className="p-4 flex flex-col">
                {onToggleAutoUtf8 && (
                  <ToggleRow labelKey="Auto UTF-8" descKey="Run chcp 65001 on terminal start to set UTF-8 encoding"
                    checked={autoUtf8} onChange={onToggleAutoUtf8} zone="terminal" />
                )}
                {onToggleCgEnabled && (
                  <ToggleRow labelKey="CodeGraph" descKey="Code symbol indexing for smart search. Disable to free ~170MB main process memory."
                    checked={cgEnabled} onChange={onToggleCgEnabled} zone="global" />
                )}
                {onToggleOcrEnabled && (
                  <ToggleRow labelKey="OCR Image to Text" descKey="Drag image or Ctrl+V to extract text from images and paste into terminal"
                    checked={ocrEnabled} onChange={onToggleOcrEnabled} zone="terminal" />
                )}
                {onToggleForceDomRenderer && (
                  <ToggleRow labelKey="Force DOM Renderer" descKey="Disable WebGL terminal renderer, fall back to DOM/canvas. Restart terminal session to take effect."
                    checked={forceDomRenderer} onChange={onToggleForceDomRenderer} zone="terminal" />
                )}
                {onTogglePolling && (
                  <ToggleRow labelKey="Polling Refresh Git/File" descKey="Poll git and file tree every 6s. Recommended: off (only for network drives where file watching is unreliable)"
                    checked={pollingEnabled} onChange={onTogglePolling} zone="global" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AppearancePanel
