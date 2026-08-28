import { type SessionMode } from '../components/DirectoryPicker'

export type HistoryMode = 'tui' | 'gui' | 'dsh'

// 上次新建会话勾选类型（内存保存，不跨重启）；历史会话打开时默认跟随它
let lastNewMode: SessionMode = 'term'
export function getLastNewMode(): SessionMode { return lastNewMode }
export function setLastNewMode(mode: SessionMode): void { lastNewMode = mode }

// 新建类型 → 历史恢复类型（'term' 与 'tui' 同为终端恢复）
export function toHistoryMode(mode: SessionMode): HistoryMode {
  return mode === 'gui' || mode === 'dsh' ? mode : 'tui'
}