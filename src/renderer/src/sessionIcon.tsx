import type { MouseEvent as ReactMouseEvent } from 'react'
import { Smile } from 'lucide-react'
import type { SessionTab } from './sessionRestore'
import { ICON_NONE } from './sessionRestore'
import { useI18n } from './i18n'
import { useSchedTasks } from './schedStore'
import { ToolIcon } from './components/AiTab/tools'
import { ClaudeLogoIcon } from './components/ClaudeLogoIcon'
import { DeepSeekLogoIcon } from './components/DeepSeekLogoIcon'
import { PiLogoIcon } from './components/PiLogoIcon'

// 会话类型图标（term→ToolIcon(command) / gui→Claude / gui+pi→Pi / dsh→DeepSeek），SessionPanel 与 BoardView 共用
export function renderKindIcon(kind: SessionTab['kind'], aiBackend?: SessionTab['aiBackend']) {
  return kind === 'terminal' ? (
    <ToolIcon category="command" className="text-ide-accent" />
  ) : kind === 'gui' ? (
    aiBackend === 'pi'
      ? <PiLogoIcon size={14} className="shrink-0 text-ide-accent" />
      : <ClaudeLogoIcon size={14} className="shrink-0" />
  ) : (
    <DeepSeekLogoIcon size={14} className="shrink-0" />
  )
}

// 行首图标状态机：scheduled > worktree > running > warn > idle（照抄 SessionPanel 原渲染结构）
// emoji 存于 SessionTab.emoji（undefined=类型位 / ICON_NONE=空白 / 具体 emoji）
// scheduled 由组件自订阅 schedStore，调用方无需传入
export type SessionIconStatus = 'running' | 'idle' | 'warn'

// 3x3 点阵外圈 8 点的灭灯相位（ms，负值错开相位；null = 中心点恒亮）
const BUSY_DOT_DELAYS: (number | null)[] = [
  -640, -560, -480,
  -80, null, -400,
  -160, -240, -320,
]

export interface SessionGlyphInfo {
  state: 'scheduled' | 'worktree' | 'running' | 'warn' | 'idle'
  curEmoji: string | null
  blankIcon: boolean
}

export function SessionGlyph({ session, status, worktreeNav, reveal, onClick, onContextMenu }: {
  session: SessionTab
  status: SessionIconStatus
  worktreeNav?: { worktreePath: string } | null
  reveal?: boolean
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
  const clickable = state === 'scheduled' || state === 'idle' || state === 'running'
  const showEmojiHint = (state === 'idle' || state === 'running') && !reveal
  const idleGlyph = blankIcon ? '' : (curEmoji ?? renderKindIcon(session.kind, session.aiBackend))
  const glyph = state === 'scheduled' ? '⏰'
    : state === 'worktree' ? '🌿'
    : state === 'running'
      ? curEmoji
        ? <span className="w-full h-full flex items-center justify-center animate-color-pulse">{curEmoji}</span>
        : (
          <svg className="shrink-0 text-ide-accent" width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            {BUSY_DOT_DELAYS.map((delay, i) => (
              <circle
                key={i}
                className={delay === null ? undefined : 'session-busy-cell'}
                cx={2 + (i % 3) * 4}
                cy={2 + Math.floor(i / 3) * 4}
                r={1.5}
                style={delay === null ? undefined : { animationDelay: `${delay}ms` }}
              />
            ))}
          </svg>
        )
      : state === 'warn' ? '⚠️'
      : idleGlyph
  const title = state === 'scheduled' ? t('Scheduled Task')
    : state === 'worktree' ? (worktreePath || 'Worktree')
    : state === 'running' ? t('Running')
    : state === 'warn' ? t('Warning')
    : (blankIcon ? t('Blank') : session.kind === 'terminal' ? t('Terminal') : session.kind === 'gui' ? (session.aiBackend === 'pi' ? 'Pi' : 'Claude') : 'dsh')
  return (
    <span
      className={`group/glyph relative text-[13px] shrink-0 w-4 h-4 flex items-center justify-center select-none transition-colors session-item__icon${clickable ? ' cursor-pointer hover:bg-ide-hover rounded' : ''}`}
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
    >
      <span
        className={`flex items-center justify-center w-full h-full transition-opacity${showEmojiHint ? ' group-hover/glyph:opacity-0' : ''}${reveal ? ' session-glyph--reveal' : ''}`}
      >{glyph}</span>
      <Smile className={`pointer-events-none absolute inset-0 m-auto w-4 h-4 text-ide-accent transition-opacity duration-75${showEmojiHint ? ' opacity-0 group-hover/glyph:opacity-100' : ' opacity-0 group-hover/glyph:opacity-0'}`} />
    </span>
  )
}