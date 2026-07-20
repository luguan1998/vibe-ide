import React, { useState, useEffect, useCallback } from 'react'
import { RotateCcw, X } from 'lucide-react'
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
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        const def = allDefs.find(d => d.id === listeningId)
        if (def?.modifierOnly) {
          const modMap: Record<string, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' }
          saveShortcut(listeningId, modMap[e.key] || e.key)
          setListeningId(null)
          refresh()
        }
        return
      }
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

  const handleClear = (id: string) => {
    saveShortcut(id, '')
    setListeningId(null)
    refresh()
  }

  const allDefs = getAllShortcutDefs()

  return (
    <div className="flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {allDefs.map((def) => {
          // '' 是用户主动清空的占位值（已禁用），必须区别于“未加载”的 undefined
          const stored = shortcuts[def.id]
          const current = stored === undefined ? def.defaultKeys : stored
          const isDisabled = current === ''
          const isListening = listeningId === def.id
          const isReadonly = def.readonly === true
          const canClear = !isListening && !isDisabled && !isReadonly
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
                <div className="flex items-center gap-1">
                  <button
                    className={`
                      text-[11px] px-2 py-0.5 rounded border font-mono transition-all min-w-[80px] text-center
                      ${isListening
                        ? 'border-ide-accent text-ide-accent bg-ide-accent/10 animate-pulse'
                        : isDisabled
                          ? 'border-ide-border/50 text-ide-text-muted/60 border-dashed hover:text-ide-text-muted hover:border-ide-text-muted'
                          : 'border-ide-border text-ide-text-muted hover:text-ide-text hover:border-ide-text-muted'
                      }
                    `}
                    onClick={() => setListeningId(isListening ? null : def.id)}
                  >
                    {isListening ? t('Press keys...') : isDisabled ? t('Disabled') : displayLabel(current)}
                  </button>
                  {canClear && (
                    <button
                      className="flex items-center justify-center w-5 h-5 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                      title={t('Clear')}
                      onClick={() => handleClear(def.id)}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
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
