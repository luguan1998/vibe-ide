import type { MouseEvent as ReactMouseEvent } from 'react'
import { Loader2 } from 'lucide-react'
import type { SessionTab } from './sessionRestore'
import { ICON_NONE } from './sessionRestore'
import { useI18n } from './i18n'
import { useSchedTasks } from './schedStore'
import { ToolIcon } from './components/AiTab/tools'
import { ClaudeLogoIcon } from './components/ClaudeLogoIcon'
import { DeepSeekLogoIcon } from './components/DeepSeekLogoIcon'

// 会话类型图标（term→ToolIcon(command) / gui→Claude / dsh→DeepSeek），SessionPanel 与 BoardView 共用
export function renderKindIcon(kind: SessionTab['kind']) {
  return kind === 'terminal' ? (
    <ToolIcon category="command" className="text-ide-accent" />
  ) : kind === 'gui' ? (
    <ClaudeLogoIcon size={14} className="shrink-0" />
  ) : (
    <DeepSeekLogoIcon size={14} className="shrink-0" />
  )
}

// 行首图标状态机：scheduled > worktree > running > warn > idle（照抄 SessionPanel 原渲染结构）
// emoji 存于 SessionTab.emoji（undefined=类型位 / ICON_NONE=空白 / 具体 emoji）
// scheduled 由组件自订阅 schedStore，调用方无需传入
export type SessionIconStatus = 'running' | 'idle' | 'warn'

export interface SessionGlyphInfo {
  state: 'scheduled' | 'worktree' | 'running' | 'warn' | 'idle'
  curEmoji: string | null
  blankIcon: boolean
}

export function SessionGlyph({ session, status, worktreeNav, onClick, onContextMenu }: {
  session: SessionTab
  status: SessionIconStatus
  worktreeNav?: { worktreePath: string } | null
  onClick?: (info: SessionGlyphInfo) => void
  onContextMenu?: (e: ReactMouseEvent) => void
}) {
  const { t } = useI18n()
  const schedTasks = useSchedTasks()
  const cur = session.emoji
  const curEmoji = (cur && cur !== ICON_NONE) ? cur : null
  const blankIcon = cur === ICON_NONE
  const hasWorktree = !!worktreeNav
  const worktreePath = worktreeNav?.worktreePath
  const scheduled = !!schedTasks[session.id]
  const state = scheduled ? 'scheduled' as const
    : hasWorktree ? 'worktree' as const
    : status === 'running' ? 'running' as const
    : status === 'warn' ? 'warn' as const
    : 'idle' as const
  const clickable = state === 'scheduled' || state === 'idle'
  const idleGlyph = blankIcon ? '' : (curEmoji ?? renderKindIcon(session.kind))
  const glyph = state === 'scheduled' ? '⏰'
    : state === 'worktree' ? '🌿'
    : state === 'running'
      ? blankIcon
        ? <Loader2 className="w-3.5 h-3.5 text-ide-accent animate-spin-slow shrink-0" />
        : <span className="w-full h-full flex items-center justify-center animate-color-pulse">{idleGlyph}</span>
      : state === 'warn' ? '⚠️'
      : idleGlyph
  const title = state === 'scheduled' ? t('Scheduled Task')
    : state === 'worktree' ? (worktreePath || 'Worktree')
    : state === 'running' ? t('Running')
    : state === 'warn' ? t('Warning')
    : (blankIcon ? t('Blank') : session.kind === 'terminal' ? t('Terminal') : session.kind === 'gui' ? 'Claude' : 'dsh')
  return (
    <span
      className={`text-[13px] shrink-0 w-4 h-4 flex items-center justify-center select-none transition-colors session-item__icon${clickable ? ' cursor-pointer hover:bg-ide-hover rounded' : ''}`}
      title={title}
      draggable={false}
      onClick={(e) => {
        if (!clickable || !onClick) return
        e.stopPropagation()
        e.preventDefault()
        onClick({ state, curEmoji, blankIcon })
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e)
      }}
    >{glyph}</span>
  )
}