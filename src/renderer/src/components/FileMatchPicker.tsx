import { useEffect } from 'react'
import { ModalOverlay } from './ModalOverlay'
import { useI18n } from '../i18n'

export function FileMatchPicker({ matches, lineNumber, cwd, onSelect, onClose }: {
  matches: string[]
  lineNumber?: number
  cwd?: string | null
  onSelect: (fullPath: string, lineNumber?: number) => void
  onClose: () => void
}) {
  const { t } = useI18n()

  // capture 阶段拦截：xterm.js 冒泡阶段会消费按键，capture 才能挡住泄漏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const shown = matches.slice(0, 10)
  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[500px] max-h-[400px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-ide-border shrink-0 flex items-center justify-between">
          <span className="text-sm font-medium text-ide-text">
            {t('{n} matching files').replace('{n}', String(shown.length))}
          </span>
          <button
            className="text-ide-text-muted hover:text-ide-text text-lg leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-ide-hover"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {shown.map((fullPath) => {
            const cwdNorm = (cwd || '').replace(/\\/g, '/')
            const pathNorm = fullPath.replace(/\\/g, '/')
            const relativePath = cwdNorm && pathNorm.startsWith(cwdNorm)
              ? pathNorm.slice(cwdNorm.length).replace(/^\//, '')
              : pathNorm
            return (
              <button
                key={fullPath}
                className="w-full text-left px-3 py-2 rounded hover:bg-ide-hover transition-colors"
                onClick={() => { onSelect(fullPath, lineNumber); onClose() }}
              >
                <div className="text-sm text-ide-text truncate">{relativePath}</div>
                <div className="text-xs text-ide-text-muted truncate mt-0.5">{fullPath}</div>
              </button>
            )
          })}
        </div>
      </div>
    </ModalOverlay>
  )
}
