import { autoViewKind } from '../fileTabs'
import { GitFileStatus } from '@shared/types'

export interface ReplayFile {
  filePath: string
  isStaged: boolean
  fullPath: string
  gitStats: { additions: number; deletions: number }
}

export type ReplaySkipReason = 'image' | 'unreadable' | 'unsaved'

export interface ReplaySkipped {
  fullPath: string
  reason: ReplaySkipReason
}

export interface ReplayList {
  playable: ReplayFile[]
  preSkipped: ReplaySkipped[]
}

// ── 整体节奏总开关 ──
// 下面的设计值都以 PACE = 1 为基准（1x 速度档下的毫秒数），全部乘 PACE。
// 觉得整体太快/太慢就只改这一个数，所有挡位同步缩放；播放速度档再在其上叠加。
const PACE = 1.5

const MIN_DURATION_MS = 2000 * PACE
// 按改动行数估的时长上限：一处改动哪怕几千行也读不完，给再多时间也是干等。
// （大文件 Monaco 的 getLineChanges() 会返回空，拿不到处数，所以这个上限必须独立存在于行数侧）
const MAX_LINE_DURATION_MS = 4000 * PACE
const LINES_CAP = 20
// 逐处滚动把时长延长后的总上限
export const MAX_DURATION_MS = 12000 * PACE
const MS_PER_LINE = 100 * PACE

// 每处改动至少停留这么久；处数多到按行数算的时长不够分时，反过来延长该文件的停留
export const MIN_HUNK_DWELL_MS = 1000 * PACE
// 每处改动最多值得这么久：只有一处改动的文件哪怕几千行也不该霸屏
export const MAX_HUNK_DWELL_MS = 3000 * PACE

export function replayDurationMs(file: ReplayFile): number {
  const lines = (file.gitStats?.additions ?? 0) + (file.gitStats?.deletions ?? 0)
  return Math.min(MAX_LINE_DURATION_MS, MIN_DURATION_MS + Math.min(lines, LINES_CAP) * MS_PER_LINE)
}

export function buildReplayList(
  files: GitFileStatus[],
  toFullPath: (path: string) => string
): ReplayList {
  const ordered = [
    ...files.filter(f => f.staged),
    ...files.filter(f => !f.staged && f.status !== 'untracked'),
    ...files.filter(f => f.status === 'untracked'),
  ]
  const playable: ReplayFile[] = []
  const preSkipped: ReplaySkipped[] = []
  for (const f of ordered) {
    const fullPath = toFullPath(f.path)
    if (autoViewKind(fullPath) === 'image') {
      preSkipped.push({ fullPath, reason: 'image' })
      continue
    }
    playable.push({
      filePath: f.path,
      isStaged: !!f.staged,
      fullPath,
      gitStats: { additions: f.additions || 0, deletions: f.deletions || 0 },
    })
  }
  return { playable, preSkipped }
}
