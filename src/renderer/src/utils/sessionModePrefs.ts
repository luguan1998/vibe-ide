import { type SessionMode } from '../components/DirectoryPicker'

export type HistoryMode = 'tui' | 'gui' | 'pi'

// 上次新建会话勾选类型（localStorage 持久化）；历史会话打开时默认跟随它
const LAST_NEW_MODE_KEY = 'vibe-ide-last-new-mode'
const NEW_MODES: SessionMode[] = ['term', 'gui', 'pi']

let lastNewMode: SessionMode = (() => {
  try {
    const v = localStorage.getItem(LAST_NEW_MODE_KEY) as SessionMode | null
    return v && NEW_MODES.includes(v) ? v : 'term'
  } catch { return 'term' }
})()

export function getLastNewMode(): SessionMode { return lastNewMode }
export function setLastNewMode(mode: SessionMode): void {
  lastNewMode = mode
  try { localStorage.setItem(LAST_NEW_MODE_KEY, mode) } catch {}
}

// 新建类型 → 历史恢复类型（'term' 与 'tui' 同为终端恢复）
export function toHistoryMode(mode: SessionMode): HistoryMode {
  if (mode === 'pi') return mode
  if (mode === 'gui') return 'gui'
  return 'tui'
}