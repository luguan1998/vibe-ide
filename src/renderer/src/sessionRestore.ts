export type TabKind = 'terminal' | 'gui' | 'dsh'

// 行首图标哨兵：空白图标（emoji === undefined 表示类型图标位）
export const ICON_NONE = ''
// 会话默认 emoji 池（AppearancePanel 重置按钮共用；term 新建默认随机也取自此池）
export const DEFAULT_SESSION_EMOJIS = ['🔥', '💀', '🗿', '🤡', '👽', '👻', '🤣', '👾', '🏷️', '🌟', '🐉', '🤗', '🙏', '🗺️']

export function randomTermEmoji(): string {
  return DEFAULT_SESSION_EMOJIS[Math.floor(Math.random() * DEFAULT_SESSION_EMOJIS.length)]
}

// 新建会话默认图标：random=池内随机 / type=类型图标 / blank=空白（picker 第二格）
export type DefaultSessionIcon = 'random' | 'type' | 'blank'

const DEFAULT_ICON_KEY = 'vibe-ide-default-session-icon'

export function getDefaultSessionIcon(): DefaultSessionIcon {
  try {
    const v = localStorage.getItem(DEFAULT_ICON_KEY)
    if (v === 'random' || v === 'type' || v === 'blank') return v
  } catch {}
  return 'blank'
}

export function persistDefaultSessionIcon(v: DefaultSessionIcon): void {
  try { localStorage.setItem(DEFAULT_ICON_KEY, v) } catch {}
}

export function emojiForDefaultIcon(v: DefaultSessionIcon): string | undefined {
  return v === 'random' ? randomTermEmoji() : v === 'type' ? undefined : ICON_NONE
}

export function resolveDefaultIcon(): string | undefined {
  return emojiForDefaultIcon(getDefaultSessionIcon())
}

// 新建会话默认名：类型前缀 + 同类型序号（Terminal 1 / Claude 1 / Pi 1 / dsh 1）
export function defaultSessionName(s: Pick<SessionTab, 'kind' | 'aiBackend'>, existing: Pick<SessionTab, 'name'>[]): string {
  const base = s.kind === 'gui' ? (s.aiBackend === 'pi' ? 'Pi' : 'Claude') : s.kind === 'dsh' ? 'dsh' : 'Terminal'
  const used = existing.filter(e => new RegExp(`^${base} \\d+$`).test(e.name)).length
  return `${base} ${used + 1}`
}

export interface SessionTab {
  id: string
  kind: TabKind
  name: string
  cwd: string
  emoji?: string
  active: boolean
  createdAt: number
  shell?: string
  resumeSessionId?: string
  resumeCwd?: string
  dshSessionId?: string
  aiBackend?: 'claude' | 'pi'
  // enableWorktree = 意图（首次 spawn 时让 CLI 建），worktreePath = 已落地的那棵树。
  // 两者都落盘：重启后按 worktreePath 直接 resume 进原工作树，不会又套一层新 worktree
  enableWorktree?: boolean
  worktreePath?: string
  // 这棵树从哪来：原仓库根 / 树检出分支 / 原始分支（会话列表归组、GitTab 返回、AiTab 分支标签都靠它）
  worktreeOriginalPath?: string
  worktreeBranch?: string
  worktreeBaseBranch?: string
  loaded: boolean
}

export interface Session {
  id: string
  cwd: string
  name: string
  activeTabId: string
  tabs: SessionTab[]
}

// 会话列表分组键：worktree 会话并入其来源仓库的组（没有来源信息时退回自身 cwd）
export function sessionGroupKey(s: Pick<SessionTab, 'cwd' | 'worktreeOriginalPath'>): string {
  return (s.worktreeOriginalPath || s.cwd).replace(/\\/g, '/').replace(/\/+$/, '')
}

export interface SessionWorkspace {
  activeTabId: string | null
  sessions: Session[]
}

const STORAGE_KEY = 'vibe-ide-open-sessions'

export function loadSessionWorkspace(): SessionWorkspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.sessions)) return null

    const sessions: Session[] = []
    for (const s of data.sessions) {
      if (!s || typeof s.cwd !== 'string' || !Array.isArray(s.tabs)) continue
      const tabs: SessionTab[] = []
      for (const t of s.tabs) {
        if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.cwd !== 'string') continue
        if (t.kind !== 'terminal' && t.kind !== 'gui' && t.kind !== 'dsh') continue
        tabs.push({
          id: t.id,
          kind: t.kind,
          name: t.name,
          cwd: t.cwd,
          emoji: typeof t.emoji === 'string' ? t.emoji : resolveDefaultIcon(),
          active: true,
          createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
          shell: typeof t.shell === 'string' ? t.shell : undefined,
          resumeSessionId: typeof t.resumeSessionId === 'string' ? t.resumeSessionId : undefined,
          resumeCwd: typeof t.resumeCwd === 'string' ? t.resumeCwd : undefined,
          dshSessionId: typeof t.dshSessionId === 'string' ? t.dshSessionId : undefined,
          aiBackend: t.aiBackend === 'pi' ? 'pi' : t.aiBackend === 'claude' ? 'claude' : undefined,
          enableWorktree: t.enableWorktree === true ? true : undefined,
          worktreePath: typeof t.worktreePath === 'string' ? t.worktreePath : undefined,
          worktreeOriginalPath: typeof t.worktreeOriginalPath === 'string' ? t.worktreeOriginalPath : undefined,
          worktreeBranch: typeof t.worktreeBranch === 'string' ? t.worktreeBranch : undefined,
          worktreeBaseBranch: typeof t.worktreeBaseBranch === 'string' ? t.worktreeBaseBranch : undefined,
          loaded: t.kind === 'terminal' ? !!t.loaded : false,
        })
      }
      if (tabs.length === 0) {
        tabs.push({
          id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'terminal',
          name: 'Terminal',
          cwd: s.cwd,
          emoji: resolveDefaultIcon(),
          active: true,
          createdAt: Date.now(),
          loaded: false,
        })
      }
      const activeTabId = typeof s.activeTabId === 'string' && tabs.some(t => t.id === s.activeTabId)
        ? s.activeTabId
        : tabs[0].id
      sessions.push({
        id: s.id || s.cwd,
        cwd: s.cwd,
        name: s.name || s.cwd,
        activeTabId,
        tabs,
      })
    }
    if (sessions.length === 0) return null
    const activeTabId = typeof data.activeTabId === 'string' && sessions.some(s => s.tabs.some(t => t.id === data.activeTabId))
      ? data.activeTabId
      : sessions[0].activeTabId
    return { activeTabId, sessions }
  } catch {
    return null
  }
}

export function saveSessionWorkspace(workspace: SessionWorkspace): void {
  try {
    if (workspace.sessions.length === 0) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
    }
  } catch {}
}

