import React, { useCallback, useState } from 'react'
import { FolderOpen, FolderGit2, ChevronRight, Clock, Check, RotateCcw, Star } from 'lucide-react'
import iconImg from '@renderer/assets/icon.png?inline'
import { useI18n } from '../i18n'
import { cwdStore, useRecentDirs, useFavCwds, useLastOpenCwds } from '../cwdStore'

function getFolderName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

function getParentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx > 0 ? normalized.substring(0, idx) : ''
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex items-center justify-center size-[18px] rounded-[4px] border-2 transition-colors ${
        checked
          ? 'border-ide-accent bg-ide-accent text-white'
          : 'border-ide-text-muted/40'
      }`}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  )
}

interface WelcomeScreenProps {
  isOpening: boolean
  onOpenFolder: () => void
  onOpenPath: (path: string) => void
}

function OpeningOverlay() {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-ide-bg/80">
      <div className="w-5 h-5 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-ide-text-muted">{t('Opening folder...')}</span>
    </div>
  )
}

const WelcomeScreen = React.memo(function WelcomeScreen({ isOpening, onOpenFolder, onOpenPath }: WelcomeScreenProps) {
  const { t } = useI18n()
  const recentDirs = useRecentDirs()
  const favCwds = useFavCwds()
  const lastOpenCwds = useLastOpenCwds()
  const [checked, setChecked] = useState<Set<string>>(() => {
    const lastSet = new Set(lastOpenCwds)
    return new Set(recentDirs.filter(d => lastSet.has(d)))
  })

  const toggleCheck = useCallback((dir: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])

  const handleBatchRestore = useCallback(async () => {
    const paths = Array.from(new Set([
      ...recentDirs.filter(d => checked.has(d)),
      ...favCwds,
    ]))
    for (const p of paths) await onOpenPath(p)
  }, [recentDirs, checked, favCwds, onOpenPath])

  if (recentDirs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-ide-bg relative">
        <div className="text-center select-none">
          <img src={iconImg} alt="Vibe IDE" className="w-16 h-16 mx-auto mb-5 object-contain" />
          <h1 className="text-xl font-semibold text-ide-text mb-2 tracking-wide">Vibe IDE</h1>
          <p className="text-sm text-ide-text-muted mb-8">
            A vibe-driven terminal IDE
          </p>
          <button
            onClick={onOpenFolder}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
          >
            <FolderOpen className="size-4" />
            {t('Open Folder')}
          </button>
        </div>
        {isOpening && <OpeningOverlay />}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-ide-bg relative">
      <div className="flex items-center justify-center min-h-full">
        <div className="w-full max-w-[520px] px-8 py-10 select-none">
        {/* Header */}
        <div className="text-center mb-10">
          <img src={iconImg} alt="Vibe IDE" className="w-14 h-14 mx-auto mb-4 object-contain" />
          <h1 className="text-xl font-semibold text-ide-text mb-1.5 tracking-wide">Vibe IDE</h1>
          <p className="text-sm text-ide-text-muted">
            A vibe-driven terminal IDE
          </p>
        </div>

        {/* Open Folder Button */}
        <div className="mb-10">
          <button
            onClick={onOpenFolder}
            className="w-full flex items-center justify-center gap-2.5 px-5 py-3 bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
          >
            <FolderOpen className="size-[18px]" />
            {t('Open Folder')}
          </button>
        </div>

        {/* Recent Directories */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-ide-text-muted" />
              <span className="text-xs font-semibold text-ide-text-muted uppercase tracking-wider">
                {t('Recent')}
              </span>
            </div>
            <button
              onClick={handleBatchRestore}
              disabled={checked.size === 0 && favCwds.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-ide-accent hover:bg-ide-accent-hover text-white rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw className="size-3.5" />
              {t('Restore Previous Sessions')}
            </button>
          </div>
          <div className="space-y-0.5">
            {recentDirs.map(dir => {
              const name = getFolderName(dir)
              const parent = getParentPath(dir)
              const isChecked = checked.has(dir)
              const isFav = cwdStore.isFav(dir)
              return (
                <button
                  key={dir}
                  onClick={() => onOpenPath(dir)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-md hover:bg-ide-hover active:bg-ide-active transition-colors group"
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleCheck(dir) }}
                    className="cursor-pointer shrink-0 flex items-center"
                  >
                    <Checkbox checked={isChecked} />
                  </span>
                  <FolderGit2 className="size-[18px] text-ide-text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ide-text truncate">{name}</div>
                    {parent && (
                      <div className="text-[11px] text-ide-text-muted/60 truncate mt-0.5">
                        {parent}
                      </div>
                    )}
                  </div>
                  <span
                    onClick={(e) => { e.stopPropagation(); cwdStore.toggleFav(dir) }}
                    className={`shrink-0 cursor-pointer ${isFav ? 'text-ide-accent' : 'text-ide-text-muted/70 hover:text-ide-text-muted'}`}
                    title={t('Favorite')}
                  >
                    <Star className="size-4" fill={isFav ? 'currentColor' : 'none'} />
                  </span>
                  <ChevronRight className="size-4 text-ide-text-muted/30 group-hover:text-ide-text-muted transition-colors shrink-0" />
                </button>
              )
            })}
          </div>
          </div>
        </div>
      </div>

      {isOpening && <OpeningOverlay />}
    </div>
  )
})

export default WelcomeScreen
