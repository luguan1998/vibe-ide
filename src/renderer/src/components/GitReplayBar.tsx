import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useI18n } from '../i18n'
import { baseName } from '../fileTabs'
import type { ReplaySkipped, ReplaySkipReason } from '../utils/gitReplay'
import type { ReplaySpeed } from '../utils/useGitReplay'

const SPEEDS: ReplaySpeed[] = [0.25, 0.5, 1, 2]

const SKIP_REASON_KEY: Record<ReplaySkipReason, string> = {
  image: 'skip-image',
  unreadable: 'skip-unreadable',
  unsaved: 'skip-unsaved',
}

interface GitReplayBarProps {
  paused: boolean
  index: number
  total: number
  speed: ReplaySpeed
  skipped: ReplaySkipped[]
  skipListOpen: boolean
  onToggle: () => void
  onPrev: () => void
  onNext: () => void
  onSpeed: (speed: ReplaySpeed) => void
  onToggleSkipList: () => void
}

function GitReplayBar({
  paused, index, total, speed, skipped, skipListOpen,
  onToggle, onPrev, onNext, onSpeed, onToggleSkipList,
}: GitReplayBarProps) {
  const { t } = useI18n()

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center">
      {skipListOpen && skipped.length > 0 && (
        <div className="mb-1 max-h-52 w-64 overflow-y-auto bg-ide-sidebar border border-ide-border rounded-lg shadow-lg py-1">
          {skipped.map((s, i) => (
            <div key={`${s.fullPath}-${s.reason}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1 text-xs">
              <span className="truncate text-ide-text-muted">{baseName(s.fullPath)}</span>
              <span className="shrink-0 text-ide-text-muted opacity-60">{t(SKIP_REASON_KEY[s.reason])}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-0.5 px-2 py-1 rounded-full bg-ide-sidebar border border-ide-border shadow-lg">
        <button
          onClick={onPrev}
          className="w-6 h-6 rounded-full flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
          title={t('Previous file')}
        >
          <SkipBack className="size-3.5" />
        </button>
        <button
          onClick={onToggle}
          className="w-6 h-6 rounded-full flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
          title={paused ? t('Resume replay') : t('Pause replay')}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </button>
        <button
          onClick={onNext}
          className="w-6 h-6 rounded-full flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
          title={t('Next file')}
        >
          <SkipForward className="size-3.5" />
        </button>
        <span className="px-1 text-[11px] font-mono tabular-nums text-ide-text-muted">{index + 1}/{total}</span>
        <div className="flex items-center gap-0.5 pl-1 border-l border-ide-border">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => onSpeed(s)}
              className={`px-1.5 h-6 rounded-full text-[11px] font-mono transition-colors ${s === speed ? 'text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
              title={t('Replay speed')}
            >
              {s}x
            </button>
          ))}
        </div>
        {skipped.length > 0 && (
          <button
            onClick={onToggleSkipList}
            className={`ml-1 px-1.5 h-6 rounded-full text-[11px] transition-colors ${skipListOpen ? 'text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            title={t('Skipped')}
          >
            {t('{n} skipped').replace('{n}', String(skipped.length))}
          </button>
        )}
      </div>
    </div>
  )
}

export default GitReplayBar
