import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Folder } from 'lucide-react'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
import { loadFilterRules } from './FileTab'
import { useI18n } from '../i18n'

interface QuickOpenItem {
  name: string
  path: string
  type: 'file' | 'directory'
  relativePath: string
}

interface QuickOpenProps {
  open: boolean
  cwd: string | null
  onSelect: (fullPath: string, relativePath: string) => void
  onClose: () => void
}

function FileQuickIcon({ name }: { name: string }) {
  const info = getFileInfo(name)
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`w-4 h-4 shrink-0 ${info.color}`}
         dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
  )
}

export default function QuickOpen({ open, cwd, onSelect, onClose }: QuickOpenProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('@')
  const [items, setItems] = useState<QuickOpenItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (open) {
      setQuery('@')
      setItems([])
      setSelectedIndex(0)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (el) {
          el.focus({ preventScroll: true })
          el.setSelectionRange(1, 1)
        }
      })
    }
  }, [open])

  useEffect(() => {
    if (!open || !cwd) { setItems([]); return }
    const q = query.replace(/^@/, '').trim()
    if (!q) { setItems([]); return }
    const reqId = ++reqIdRef.current
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.file.searchByName(cwd, q, loadFilterRules())
        if (reqIdRef.current !== reqId) return
        if (res && !res.error) {
          setItems(res.matches || [])
          setSelectedIndex(0)
        } else {
          setItems([])
        }
      } catch {
        if (reqIdRef.current === reqId) setItems([])
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [open, query, cwd])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-qo-idx="${selectedIndex}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, items])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault()
      setSelectedIndex(p => (p + 1) % items.length)
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault()
      setSelectedIndex(p => (p - 1 + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[selectedIndex]
      if (item) onSelect(item.path, item.relativePath)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      e.preventDefault()
    }
  }, [items, selectedIndex, onSelect, onClose])

  if (!open) return null
  const q = query.replace(/^@/, '').trim()

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40"
         onMouseDown={onClose}>
      <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[600px] max-w-[80vw] max-h-[60vh] flex flex-col"
           onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('Type to search files...')}
          className="w-full px-3 py-2.5 text-sm bg-transparent text-ide-text placeholder:text-ide-text-muted/50 border-b border-ide-border/50 focus:outline-none"
        />
        <div ref={listRef} className="flex-1 overflow-y-auto p-1">
          {items.length === 0 ? (
            <div className="px-3 py-6 text-sm text-ide-text-muted text-center">
              {q ? t('No matches') : t('Type to search')}
            </div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.path}
                data-qo-idx={i}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => onSelect(item.path, item.relativePath)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left ${
                  i === selectedIndex
                    ? 'bg-ide-accent/15 text-ide-accent'
                    : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
                }`}
              >
                {item.type === 'directory'
                  ? <Folder size={14} strokeWidth={2} className="shrink-0 text-ide-accent" />
                  : <FileQuickIcon name={item.name} />}
                <span className="truncate font-mono">{item.relativePath}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
