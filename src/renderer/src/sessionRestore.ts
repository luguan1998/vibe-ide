export type TabKind = 'terminal' | 'gui' | 'dsh'

// 行首图标哨兵：空白图标（emoji === undefined 表示类型图标位）
export const ICON_NONE = ''
// 会话/目录默认 emoji 池（AppearancePanel 重置按钮共用；term 新建默认随机也取自 session 池）
export const DEFAULT_CWD_EMOJIS = ['🧩', '📌', '📁', '🚀', '🏷️', '🎯', '🗺️', '🔗']
export const DEFAULT_SESSION_EMOJIS = ['🔥', '💀', '🗿', '🤡', '👽', '👻', '🤣', '👾', '⚡', '🌟', '🐉', '🤗', '🙏', '🥷']

export function randomTermEmoji(): string {
  return DEFAULT_SESSION_EMOJIS[Math.floor(Math.random() * DEFAULT_SESSION_EMOJIS.length)]
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
  loaded: boolean
}

export interface Session {
  id: string
  cwd: string
  name: string
  activeTabId: string
  tabs: SessionTab[]
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
          emoji: typeof t.emoji === 'string' ? t.emoji : (t.kind === 'terminal' ? randomTermEmoji() : undefined),
          active: true,
          createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
          shell: typeof t.shell === 'string' ? t.shell : undefined,
          resumeSessionId: typeof t.resumeSessionId === 'string' ? t.resumeSessionId : undefined,
          resumeCwd: typeof t.resumeCwd === 'string' ? t.resumeCwd : undefined,
          dshSessionId: typeof t.dshSessionId === 'string' ? t.dshSessionId : undefined,
          loaded: t.kind === 'dsh' ? false : !!t.loaded,
        })
      }
      if (tabs.length === 0) {
        tabs.push({
          id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'terminal',
          name: 'Terminal',
          cwd: s.cwd,
          emoji: randomTermEmoji(),
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

