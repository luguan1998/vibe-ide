import React, { useState, useEffect, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import { useI18n } from '../i18n'
import {
  getAllShortcutDefs,
  getShortcuts,
  saveShortcut,
  resetShortcuts,
  displayLabel,
  keybindingFromEvent,
  type ShortcutDef,
} from '../shortcuts'

export default function SettingsPanel() {
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({})
  const [listeningId, setListeningId] = useState<string | null>(null)
  const { t } = useI18n()
  const refresh = useCallback(() => setShortcuts(getShortcuts()), [])

  // Load on mount
  useEffect(() => { refresh() }, [refresh])

  // Capture key combo when listening
  useEffect(() => {
    if (!listeningId) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setListeningId(null)
        return
      }
      // Ignore modifier-only presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      const newBinding = keybindingFromEvent(e)
      saveShortcut(listeningId, newBinding)
      setListeningId(null)
      refresh()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [listeningId, refresh])

  const handleReset = () => {
    resetShortcuts()
    setListeningId(null)
    refresh()
  }

  const allDefs = getAllShortcutDefs()

  return (
    <div className="flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {allDefs.map((def) => {
          const current = shortcuts[def.id] || def.defaultKeys
          const isListening = listeningId === def.id
          const isReadonly = def.readonly === true
          return (
            <div
              key={def.id}
              className={`flex items-center justify-between px-3 py-2 border-b border-ide-border/50 transition-colors hover:bg-ide-hover/50`}
            >
              <span className="text-xs text-ide-text">{t(def.label)}</span>
              {isReadonly ? (
                <span className="text-[11px] px-2 py-0.5 rounded border font-mono min-w-[80px] text-center border-ide-border text-ide-text">
                  {displayLabel(current)}
                </span>
              ) : (
                <button
                  className={`
                    text-[11px] px-2 py-0.5 rounded border font-mono transition-all min-w-[80px] text-center
                    ${isListening
                      ? 'border-ide-accent text-ide-accent bg-ide-accent/10 animate-pulse'
                      : 'border-ide-border text-ide-text-muted hover:text-ide-text hover:border-ide-text-muted'
                    }
                  `}
                  onClick={() => setListeningId(isListening ? null : def.id)}
                >
                  {isListening ? t('Press keys...') : displayLabel(current)}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-t border-ide-border px-3 py-2 shrink-0">
        <button
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
          onClick={handleReset}
        >
          <RotateCcw size={11} />
          {t('Reset to defaults')}
        </button>
      </div>
    </div>
  )
}
