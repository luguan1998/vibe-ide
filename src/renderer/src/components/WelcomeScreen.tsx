import React, { useEffect, useState } from 'react'
import { FolderOpen, FolderGit2, ChevronRight, Clock } from 'lucide-react'

const MAX_RECENT_DIRS = 10

function loadRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem('vibe-ide-recent-dirs')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter((d: unknown) => typeof d === 'string' && d.length > 0).slice(0, MAX_RECENT_DIRS)
    }
  } catch {}
  return []
}

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

interface WelcomeScreenProps {
  isOpening: boolean
  onOpenFolder: () => void
  onOpenPath: (path: string) => void
}

const OpeningOverlay = (
  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-ide-bg/80">
    <div className="w-5 h-5 border-2 border-ide-accent border-t-transparent rounded-full animate-spin" />
    <span className="text-sm text-ide-text-muted">Opening folder...</span>
  </div>
)

const WelcomeScreen = React.memo(function WelcomeScreen({ isOpening, onOpenFolder, onOpenPath }: WelcomeScreenProps) {
  const [recentDirs, setRecentDirs] = useState<string[]>([])

  useEffect(() => {
    setRecentDirs(loadRecentDirs())
  }, [])

  if (recentDirs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-ide-bg relative">
        <div className="text-center select-none">
          <div className="w-16 h-16 mx-auto mb-5 flex items-center justify-center rounded-lg bg-ide-accent/40 text-4xl">🤔</div>
          <h1 className="text-xl font-semibold text-ide-text mb-2 tracking-wide">Vibe IDE</h1>
          <p className="text-sm text-ide-text-muted mb-8">
            A vibe-driven terminal IDE
          </p>
          <button
            onClick={onOpenFolder}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
          >
            <FolderOpen className="size-4" />
            Open Folder
          </button>
        </div>
        {isOpening && OpeningOverlay}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-ide-bg relative">
      <div className="flex items-center justify-center min-h-full">
        <div className="w-full max-w-[520px] px-8 py-10 select-none">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center rounded-lg bg-ide-accent/40 text-3xl">🤔</div>
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
            Open Folder
          </button>
        </div>

        {/* Recent Directories */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="size-4 text-ide-text-muted" />
            <span className="text-xs font-semibold text-ide-text-muted uppercase tracking-wider">
              Recent
            </span>
          </div>
          <div className="space-y-0.5">
            {recentDirs.map(dir => {
              const name = getFolderName(dir)
              const parent = getParentPath(dir)
              return (
                <button
                  key={dir}
                  onClick={() => onOpenPath(dir)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-md hover:bg-ide-hover active:bg-ide-active transition-colors group"
                >
                  <FolderGit2 className="size-[18px] text-ide-text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ide-text truncate">{name}</div>
                    {parent && (
                      <div className="text-[11px] text-ide-text-muted/60 truncate mt-0.5">
                        {parent}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="size-4 text-ide-text-muted/30 group-hover:text-ide-text-muted transition-colors shrink-0" />
                </button>
              )
            })}
          </div>
          </div>
        </div>
      </div>
      {isOpening && OpeningOverlay}
    </div>
  )
})

export default WelcomeScreen
