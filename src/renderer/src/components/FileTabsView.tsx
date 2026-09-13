import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { Clock } from 'lucide-react'
import { FileIcon } from './FileIcons'
import { useAdaptiveMenuPos } from '../utils/useAdaptiveMenuPos'
import { FileTab, baseName } from '../fileTabs'
import { RecentFileEntry } from '@shared/types'

interface FileTabsViewProps {
  tabs: FileTab[]
  activeTabId: string | null
  dirtyMap: Record<string, boolean>
  recentFiles: RecentFileEntry[]
  onActivate: (id: string) => void
  onRequestClose: (id: string) => void
  onDismissView: () => void
  onOpenRecent: (fullPath: string, lineNumber?: number) => void
  popoverGuardRef: MutableRefObject<null | (() => boolean)>
  renderTab: (tab: FileTab, isActive: boolean, headerLeading: ReactNode) => ReactNode
  t: (s: string) => string
}

function tabTooltip(tab: FileTab): string {
  if (tab.kind === 'diff') {
    if (tab.compareOriginalPath) return `${tab.compareOriginalPath} vs ${tab.fullPath}`
    if (tab.commitHash) return `${tab.fullPath} @ ${tab.commitHash.slice(0, 7)}`
  }
  return tab.fullPath
}

const CHIP_W = 134
const MAX_CHIPS = 3

function RecentInline({
  files, onOpen, popoverGuardRef, t,
}: {
  files: RecentFileEntry[]
  onOpen: (fullPath: string, lineNumber?: number) => void
  popoverGuardRef: MutableRefObject<null | (() => boolean)>
  t: (s: string) => string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [availW, setAvailW] = useState(0)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const menuOpen = !!menuAnchor
  const { ref: menuRef, style: menuStyle } = useAdaptiveMenuPos(menuOpen, menuAnchor?.x ?? 0, menuAnchor?.y ?? 0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const check = () => setAvailW(el.clientWidth)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    popoverGuardRef.current = () => { setMenuAnchor(null); return true }
    return () => { popoverGuardRef.current = null }
  }, [menuOpen, popoverGuardRef])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (wrapRef.current?.contains(e.target as Node)) return
      setMenuAnchor(null)
    }
    const timer = setTimeout(() => window.addEventListener('click', close), 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', close)
    }
  }, [menuOpen, menuRef])

  if (files.length === 0) return null

  const chipCount = Math.max(0, Math.min(MAX_CHIPS, files.length, Math.floor((availW - 26) / CHIP_W)))
  const shown = files.slice(0, chipCount)

  return (
    <div ref={wrapRef} className="flex items-center gap-1.5 min-w-0 max-w-[420px] shrink">
      {shown.length > 0 && (
        <>
          <div className="w-px h-4 bg-ide-border shrink-0" />
          <div className="flex items-center gap-1 overflow-hidden min-w-0">
            {shown.map(f => {
              const name = baseName(f.path)
              return (
                <div
                  key={f.path}
                  title={`${f.path}${f.line ? ':' + f.line : ''}`}
                  onClick={() => onOpen(f.path, f.line)}
                  className="group/chip flex items-center gap-1 pl-1.5 pr-2 rounded text-xs cursor-pointer shrink-0 bg-ide-hover/30 hover:bg-ide-hover/60 text-ide-text-muted hover:text-ide-text transition-colors file-tabs__recent-item"
                >
                  <FileIcon name={name} className="w-4 h-4 shrink-0" />
                  <span className="truncate max-w-[76px]">{name}</span>
                  {f.line ? <span className="text-[10px] text-ide-accent shrink-0">{f.line}</span> : null}
                </div>
              )
            })}
          </div>
        </>
      )}
      <button
        onClick={(e) => {
          if (menuOpen) { setMenuAnchor(null); return }
          const r = e.currentTarget.getBoundingClientRect()
          setMenuAnchor({ x: r.right - 200, y: r.bottom + 4 })
        }}
        className="w-5 h-5 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0 file-tabs__overflow-btn"
        title={t('Recently Opened')}
      >
        <Clock size={12} />
      </button>
      {menuOpen && (
        <div
          ref={menuRef}
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[200px] max-h-80 overflow-y-auto"
          style={menuStyle}
        >
          <div className="px-3 py-1 text-[10px] text-ide-text-muted font-semibold uppercase tracking-wider">
            {t('Recently Opened')}
          </div>
          {files.map(f => {
            const name = baseName(f.path)
            return (
              <div
                key={f.path}
                title={f.path}
                onClick={() => { setMenuAnchor(null); onOpen(f.path, f.line) }}
                className="px-3 py-1 flex items-center gap-2 cursor-pointer hover:bg-ide-hover text-xs text-ide-text"
              >
                <FileIcon name={name} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate min-w-0 flex-1">{name}</span>
                {f.line ? <span className="text-[10px] text-ide-accent shrink-0">{f.line}</span> : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function FileTabsView({
  tabs, activeTabId, dirtyMap, recentFiles, onActivate, onRequestClose, onDismissView, onOpenRecent, popoverGuardRef, renderTab, t,
}: FileTabsViewProps) {
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const strip = stripRef.current
    if (!strip || !activeTabId) return
    const el = strip.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`)
    if (!el) return
    const stripRect = strip.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (elRect.left < stripRect.left) strip.scrollLeft += elRect.left - stripRect.left
    else if (elRect.right > stripRect.right) strip.scrollLeft += elRect.right - stripRect.right
  }, [activeTabId, tabs.length])

  const headerLeading = useMemo(() => {
    const at = tabs.find(t => t.id === activeTabId)
    const stats = at?.kind === 'diff' ? at.gitStats : undefined
    return (
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          onClick={onDismissView}
          className="w-6 h-6 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors shrink-0"
          title="Esc"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3.5 h-3.5">
            <polyline points="15 4 7 12 15 20" />
          </svg>
        </button>
        <div ref={stripRef} className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto aux-tab__scroll file-tabs__strip">
          {tabs.map(tab => {
            const active = tab.id === activeTabId
            const diffMode = tab.kind === 'diff' && (tab.viewMode ?? (tab.defaultEdit ? 'edit' : 'diff')) === 'diff'
            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                title={tabTooltip(tab)}
                onClick={() => onActivate(tab.id)}
                className={`group relative flex items-center gap-1 pl-2 pr-1 rounded-t-md text-xs cursor-pointer shrink-0 transition-colors file-tabs__tab ${
                  active
                    ? 'bg-ide-sidebar border-t border-x border-ide-border border-b-2 border-b-ide-accent h-6 text-ide-text'
                    : 'bg-ide-hover/25 h-5 text-ide-text-muted hover:bg-ide-hover/45 hover:text-ide-text'
                }`}
              >
                <FileIcon name={tab.fileName} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[120px]">{tab.fileName}</span>
                {diffMode && (
                  <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3 shrink-0">
                    <rect x="1.5" y="2.25" width="13" height="11" rx="2.5" stroke="#9ca3af" strokeWidth="1.5" />
                    <rect x="4.25" y="4.5" width="3" height="6.5" rx="1" fill="#f28b82" />
                    <rect x="8.75" y="4.5" width="3" height="6.5" rx="1" fill="#81c995" />
                  </svg>
                )}
                {dirtyMap[tab.id] && <span className="w-1.5 h-1.5 rounded-full bg-ide-warning shrink-0" />}
                <button
                  onClick={(e) => { e.stopPropagation(); onRequestClose(tab.id) }}
                  className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 text-ide-text-muted hover:bg-ide-hover hover:text-ide-text ${
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title={t('Close')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
        {stats && (stats.additions > 0 || stats.deletions > 0) && (
          <div className="flex items-center gap-1 text-xs shrink-0">
            {stats.additions > 0 && <span className="text-ide-success font-mono">+{stats.additions}</span>}
            {stats.deletions > 0 && <span className="text-ide-danger font-mono">-{stats.deletions}</span>}
          </div>
        )}
        <RecentInline files={recentFiles} onOpen={onOpenRecent} popoverGuardRef={popoverGuardRef} t={t} />
      </div>
    )
  }, [tabs, activeTabId, dirtyMap, recentFiles, onActivate, onRequestClose, onDismissView, onOpenRecent, popoverGuardRef, t])

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            {renderTab(tab, isActive, isActive ? headerLeading : null)}
          </div>
        )
      })}
    </div>
  )
}
