import React, { useState, useRef, useEffect, useMemo, useImperativeHandle, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { TerminalSession, RecentFileEntry } from '@shared/types'
import { Zap, Coffee, Plus, Copy, Pencil, X, Check, ChevronRight, ChevronDown, MessageSquarePlus, Loader2, Square, RotateCcw, Palette, Bot, Keyboard, Filter, Trash2, Pin, Terminal, File, Star, Clock, History } from 'lucide-react'
import { useI18n } from '../i18n'
import { cwdStore, useRecentDirs, useFavCwds } from '../cwdStore'
import { readAiCliConfig } from '../aiStore'
import { useAdaptiveMenuPos } from '@renderer/utils/useAdaptiveMenuPos'
import { getMainShellType, setMainShellType, getAuxShellType, setAuxShellType } from '@renderer/utils/shellPrefs'
import SettingsPanel from './SettingsPanel'
import { ModalOverlay } from './ModalOverlay'
import AppearancePanel from './AppearancePanel'
import CustomCommands, { CustomCommandsHandle, loadCustomCommands, CustomCommand } from './CustomCommands'
import { loadFilterRules, saveFilterRules, DEFAULT_FILTER_RULES } from './FileTab'
import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'
import mujicaIcon from '@renderer/assets/mujica.png?inline'
import { useMujicaCounts } from '../mujicaStore'
import { ClaudeLogoIcon } from './ClaudeLogoIcon'
import { DeepSeekLogoIcon } from './DeepSeekLogoIcon'
import { fetchDshSessions, fetchDshHistoryTurns, type DshHistorySession } from '../dsh/history'

// ── Claude 配置组（model/provider 多组切换）──
interface ClaudeConfigGroup {
  id: string
  name: string
  env: Record<string, string>
}
interface ClaudeConfigStore {
  groups: ClaudeConfigGroup[]
  activeId: string | null
}

// 新建配置组时 env 默认预填的 key（值留空由用户填）
const DEFAULT_CLAUDE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
]

let claudeDirCache: string | null = null
async function claudeDir(): Promise<string> {
  if (claudeDirCache) return claudeDirCache
  claudeDirCache = (await window.api.claudeConfig.dir()).replace(/\\/g, '/')
  return claudeDirCache
}
function groupSummary(g: ClaudeConfigGroup): string {
  let host = g.env.ANTHROPIC_BASE_URL || ''
  try { if (host) host = new URL(host).host } catch {}
  const model = g.env.ANTHROPIC_MODEL || ''
  return [host, model].filter(Boolean).join(' · ')
}
// file.read 返回 { content } | { error }，file.write 返回 { success } | { error }——包一层取纯文本/校验写入
async function readTextFile(path: string): Promise<string | null> {
  const r: any = await window.api.file.read(path)
  if (r && typeof r.content === 'string') return r.content
  return null
}
async function writeTextFile(path: string, content: string): Promise<void> {
  const r: any = await window.api.file.write(path, content)
  if (!r || r.success !== true) throw new Error((r && r.error) || '写入失败')
}
async function loadClaudeGroups(): Promise<ClaudeConfigStore> {
  try {
    const dir = await claudeDir()
    const raw = await readTextFile(`${dir}/.vibe-ide-model-groups.json`)
    if (raw) {
      const obj = JSON.parse(raw)
      if (obj && Array.isArray(obj.groups)) {
        return {
          groups: obj.groups.filter((g: any) => g && typeof g.id === 'string'),
          activeId: typeof obj.activeId === 'string' ? obj.activeId : null,
        }
      }
    }
  } catch {}
  return { groups: [], activeId: null }
}
async function saveClaudeGroups(store: ClaudeConfigStore): Promise<void> {
  try {
    const dir = await claudeDir()
    await writeTextFile(`${dir}/.vibe-ide-model-groups.json`, JSON.stringify(store, null, 2))
  } catch {}
}
async function readCurrentSettings(): Promise<Record<string, string>> {
  try {
    const dir = await claudeDir()
    const raw = await readTextFile(`${dir}/settings.json`)
    if (raw) {
      const obj = JSON.parse(raw)
      return obj.env && typeof obj.env === 'object' ? obj.env : {}
    }
  } catch {}
  return {}
}
async function applyClaudeGroup(group: ClaudeConfigGroup): Promise<void> {
  const dir = await claudeDir()
  const raw = await readTextFile(`${dir}/settings.json`)
  if (raw === null) throw new Error('settings.json 读取失败，未写入以保护现有配置')
  const obj = JSON.parse(raw)
  // 合并而非整组替换：只覆盖组里有的 key（跳过空值以免误清），其它 env 字段（DISABLE_AUTOUPDATER 等）原样保留
  const env: Record<string, string> = { ...(obj.env && typeof obj.env === 'object' ? obj.env : {}) }
  for (const [k, v] of Object.entries(group.env)) if (v !== '') env[k] = v
  obj.env = env
  await writeTextFile(`${dir}/settings.json`, JSON.stringify(obj, null, 2) + '\n')
}

// CWD 图标：按目录分配（标题行）
export const DEFAULT_CWD_EMOJIS = ['🧩', '📌', '📁', '🚀', '🏷️', '🎯', '🗺️', '🔗']
// Session 图标：按会话分配（列表行）
export const DEFAULT_SESSION_EMOJIS = ['🔥', '💀', '🗿', '🤡', '👽', '👻', '🤣', '👾', '⚡', '🌟', '🐉', '🤗', '🙏']

function midTruncatePath(path: string, maxLen: number = 28): string {
  if (path.length <= maxLen) return path
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(sep).filter(Boolean)
  if (parts.length <= 2) return path
  const root = /^[A-Z]:\\/i.test(path) ? path.slice(0, 3) : (path.startsWith('/') ? '/' : '')
  const rest = path.slice(root.length).split(sep).filter(Boolean)
  if (rest.length <= 2) return path
  const last = rest.slice(-2).join(sep)
  return root + '...' + sep + last
}

function dirNameOf(path: string): string {
  if (!path) return path
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(sep).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  if (n < 1000000) return `${(n / 1000).toFixed(1)} kB`
  return `${(n / 1000000).toFixed(1)} MB`
}

function buildHistoryTurns(messages: any[]): { role: 'user' | 'assistant'; text: string }[] {
  const turns: { role: 'user' | 'assistant'; text: string }[] = []
  for (const m of messages || []) {
    if (m.type !== 'user' && m.type !== 'assistant') continue
    const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant'
    let text = typeof m.content === 'string' ? m.content.replace(/\s+/g, ' ').trim() : ''
    if (!text && Array.isArray(m.toolUse) && m.toolUse.length > 0) text = `工具 ×${m.toolUse.length}`
    if (!text) continue
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.text += ' ' + text
    else turns.push({ role, text })
  }
  return turns
}

// 旧版「一个合并数组按 1/3 split」迁移到两个独立池
function migrateLegacyEmojis(): void {
  try {
    if (localStorage.getItem('vibe-ide-cwd-emojis')) return
    const legacyRaw = localStorage.getItem('vibe-ide-session-emojis')
    if (!legacyRaw) return
    const arr = JSON.parse(legacyRaw)
    if (!Array.isArray(arr)) return
    const valid = arr.filter((v: unknown) => typeof v === 'string')
    if (valid.length === 0) return
    const cwdEnd = Math.ceil(valid.length / 3)
    localStorage.setItem('vibe-ide-cwd-emojis', JSON.stringify(valid.slice(0, cwdEnd)))
    localStorage.setItem('vibe-ide-session-emojis', JSON.stringify(valid.slice(cwdEnd)))
  } catch {}
}

function loadCwdEmojis(): string[] {
  migrateLegacyEmojis()
  try {
    const raw = localStorage.getItem('vibe-ide-cwd-emojis')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const valid = arr.filter((v: unknown) => typeof v === 'string')
        if (valid.length > 0) return valid
      }
    }
  } catch {}
  return [...DEFAULT_CWD_EMOJIS]
}

function saveCwdEmojis(emojis: string[]): void {
  try { localStorage.setItem('vibe-ide-cwd-emojis', JSON.stringify(emojis)) } catch {}
}

function loadSessionEmojis(): string[] {
  migrateLegacyEmojis()
  try {
    const raw = localStorage.getItem('vibe-ide-session-emojis')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const valid = arr.filter((v: unknown) => typeof v === 'string')
        if (valid.length > 0) return valid
      }
    }
  } catch {}
  return [...DEFAULT_SESSION_EMOJIS]
}

function saveSessionEmojis(emojis: string[]): void {
  try { localStorage.setItem('vibe-ide-session-emojis', JSON.stringify(emojis)) } catch {}
}

// 🌀 fallback — IPC 取不到时兜底
const FALLBACK_SHELLS = [
  { value: 'pwsh', label: 'PowerShell 7' },
  { value: 'powershell', label: 'PowerShell 5' },
]

function pickEmoji(index: number, pool: string[], override?: string): string {
  if (pool.length === 0) return ''
  if (override && pool.includes(override)) return override
  return pool[index % pool.length]
}

function getCwdEmoji(index: number, pool: string[], override?: string): string {
  return pickEmoji(index, pool, override)
}

function stableEmojiForSession(sessionId: string, pool: string[]): string {
  if (pool.length === 0) return ''
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0
  }
  return pool[Math.abs(hash) % pool.length]
}

interface SessionPanelProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  compact?: boolean
  onCreateSession: (shell?: string) => void
  onCreateSessionAt?: (cwd: string, shell?: string) => void
  onCloneSession: (parentId: string | null, cwd: string, shell?: string, name?: string) => void
  onCloneWithInit?: (sessionId: string, cwd: string, shell: string | undefined, command: string) => void
  onSwitchSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession?: (id: string, newName: string) => Promise<void>
  onReorderSessions?: (fromIndex: number, toIndex: number) => void
  onReorderGroup?: (fromGroupIndex: number, toGroupIndex: number) => void
  commandHistory?: Record<string, string[]>
  agentStatus?: Record<string, 'running' | 'idle' | 'warn'>
  onResumeClaudeHistory?: (historySessionId: string, cwd: string, name: string, mode: 'tui' | 'gui') => void
  onResumeDshHistory?: (dshSessionId: string, cwd: string, name: string) => void
  onOpenHistoryTab?: () => void
  onResetCache?: (sessionId: string) => void
  pollingEnabled?: boolean
  onTogglePolling?: (value: boolean) => void
  wordWrap?: boolean
  onToggleWordWrap?: (value: boolean) => void
  autoUtf8?: boolean
  onToggleAutoUtf8?: (value: boolean) => void
  cgEnabled?: boolean
  onToggleCgEnabled?: (value: boolean) => void
  inlineDiff?: boolean
  onToggleInlineDiff?: (value: boolean) => void
  diffSplitRatio?: number
  onSetDiffSplitRatio?: (value: number) => void
  capsuleTabs?: boolean
  onToggleCapsuleTabs?: (value: boolean) => void
  ocrEnabled?: boolean
  onToggleOcrEnabled?: (value: boolean) => void
  forceDomRenderer?: boolean
  onToggleForceDomRenderer?: (value: boolean) => void
  focusSettingsTrigger?: number
  onExecuteCommand?: (command: string) => void
  onInitCommand?: (command: string) => void
  onPipeCommand?: (command: string) => void
  onPipeToSession?: (sessionId: string, command: string) => void
  pipeRunning?: Record<string, boolean>
  pipeProgress?: Record<string, { current: number; total: number }>
  onCancelPipe?: (sessionId: string) => void
  onNewSessionHere?: (cwd: string, mode: 'term' | 'gui' | 'dsh') => void
  groupSessionsByCwd?: boolean
  onToggleGroupSessionsByCwd?: (v: boolean) => void
  terminalFontSize?: number
  editorFontSize?: number
  onAdjustTerminalFontSize?: (delta: number) => void
  onAdjustEditorFontSize?: (delta: number) => void
  fontFamily?: string
  onSetFontFamily?: (font: string) => void
  uiFontFamily?: string
  onSetUiFontFamily?: (font: string) => void
  termFontFamily?: string
  onSetTermFontFamily?: (font: string) => void
  onResetUiStyle?: () => void
  recentFiles?: RecentFileEntry[]
  onOpenRecentFile?: (fullPath: string, lineNumber?: number) => void
  onRemoveRecentFile?: (fullPath: string) => void
  onTogglePinRecentFile?: (fullPath: string) => void
  mujicaRestoreVisible?: boolean
  onRestoreMujica?: () => void
}

export interface SessionPanelHandle {
  toggleConfig: (rect: DOMRect) => void
}

// hover 预览 timer 清理：清掉并置 null，统一入口避免各处重复 clearTimeout 判断
function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }) {
  if (ref.current) { clearTimeout(ref.current); ref.current = null }
}

// ── 定时任务：5 段 cron（分 时 日 月 周）最小解析 ──
interface SchedTask {
  cron: string
  command: string
  lastFired: string
}

function cronFieldMatch(field: string, value: number, min: number, max: number): boolean {
  for (const raw of field.split(',')) {
    const part = raw.trim()
    if (!part) continue
    let step = 1
    let range = part
    const slashIdx = part.indexOf('/')
    if (slashIdx >= 0) {
      step = parseInt(part.slice(slashIdx + 1), 10)
      if (!(step >= 1)) continue
      range = part.slice(0, slashIdx)
    }
    let start: number, end: number
    if (range === '*') { start = min; end = max }
    else if (range.includes('-')) {
      const [a, b] = range.split('-').map(s => parseInt(s.trim(), 10))
      if (!(a >= min && b <= max)) continue
      start = a; end = b
    } else {
      const v = parseInt(range, 10)
      if (!(v >= min && v <= max)) continue
      start = v; end = v
    }
    if (value >= start && value <= end && (value - start) % step === 0) return true
  }
  return false
}

function cronMatches(cron: string, d: Date): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return (
    cronFieldMatch(parts[0], d.getMinutes(), 0, 59) &&
    cronFieldMatch(parts[1], d.getHours(), 0, 23) &&
    cronFieldMatch(parts[2], d.getDate(), 1, 31) &&
    cronFieldMatch(parts[3], d.getMonth() + 1, 1, 12) &&
    cronFieldMatch(parts[4], d.getDay(), 0, 6)
  )
}

function cronFieldValid(field: string, min: number, max: number): boolean {
  for (let v = min; v <= max; v++) {
    if (cronFieldMatch(field, v, min, max)) return true
  }
  return false
}

function cronValid(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return cronFieldValid(parts[0], 0, 59) && cronFieldValid(parts[1], 0, 23) &&
    cronFieldValid(parts[2], 1, 31) && cronFieldValid(parts[3], 1, 12) && cronFieldValid(parts[4], 0, 6)
}

function SessionCmdCopyButton({ cmd }: { cmd: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <button
      className={
        copied
          ? 'shrink-0 transition-opacity p-0.5 opacity-100 text-ide-success'
          : 'opacity-0 group-hover:opacity-100 text-ide-text-muted hover:text-ide-text shrink-0 transition-opacity p-0.5'
      }
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(cmd).then(() => {
          setCopied(true)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setCopied(false), 1500)
        })
      }}
      title={t('Copy')}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}

// 会话闲置时长短英文：<60s 显示 now，否则 Nm / Nh / Nd
function formatIdleDuration(durMs: number): string {
  if (durMs < 60_000) return 'now'
  const m = Math.floor(durMs / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(durMs / 3_600_000)
  if (h < 24) return `${h}h`
  const d = Math.floor(durMs / 86_400_000)
  return `${d}d`
}
// 自调度的小组件：算到下一次格式变化的时刻再 tick，稳态每分钟(或更久)一次，无空转
function SessionIdleAge({ idleSince, running, className }: { idleSince?: number; running: boolean; className?: string }) {
  const [str, setStr] = useState<string>(() => running ? 'now' : formatIdleDuration(Date.now() - (idleSince ?? Date.now())))
  useEffect(() => {
    if (running) { setStr('now'); return }
    const start = idleSince ?? Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null
    let alive = true
    const tick = () => {
      if (!alive) return
      const elapsed = Date.now() - start
      setStr(formatIdleDuration(elapsed))
      // 下一次格式变化的时刻：按当前单位算到下一个整单位边界
      const steps: [number, number][] = [[60_000, 60_000], [3_600_000, 60_000], [86_400_000, 3_600_000], [Infinity, 86_400_000]]
      let unit = 60_000
      for (const [bound, u] of steps) { if (elapsed < bound) { unit = u; break } }
      const nextAt = start + (Math.floor(elapsed / unit) + 1) * unit
      timer = setTimeout(tick, Math.max(1000, nextAt - Date.now()))
    }
    tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [running, idleSince])
  return <span className={className}>{str}</span>
}

const SessionPanel = React.memo(React.forwardRef<SessionPanelHandle, SessionPanelProps>(function SessionPanel({
  sessions,
  activeSessionId,
  compact,
  onCreateSession,
  onCreateSessionAt,
  onCloneSession,
  onCloneWithInit,
  onSwitchSession,
  onCloseSession,
  onRenameSession,
  onReorderSessions,
  onReorderGroup,
  commandHistory = {},
  agentStatus = {},
  onResumeClaudeHistory,
  onResumeDshHistory,
  onOpenHistoryTab,
  onResetCache,
  pollingEnabled = false,
  onTogglePolling,
  wordWrap = false,
  onToggleWordWrap,
  autoUtf8 = true,
  onToggleAutoUtf8,
  cgEnabled = true,
  onToggleCgEnabled,
  ocrEnabled = true,
  onToggleOcrEnabled,
  forceDomRenderer = false,
  onToggleForceDomRenderer,
  inlineDiff = false,
  onToggleInlineDiff,
  diffSplitRatio = 0.3,
  onSetDiffSplitRatio,
  capsuleTabs = true,
  onToggleCapsuleTabs,
  focusSettingsTrigger = 0,
  onExecuteCommand,
  onInitCommand,
  onPipeCommand,
  onPipeToSession,
  pipeRunning = {},
  pipeProgress = {},
  onCancelPipe,
  onNewSessionHere,
  groupSessionsByCwd = true,
  onToggleGroupSessionsByCwd,
  terminalFontSize = 14,
  editorFontSize = 14,
  onAdjustTerminalFontSize,
  onAdjustEditorFontSize,
  fontFamily = 'Consolas',
  onSetFontFamily,
  uiFontFamily = 'Consolas',
  onSetUiFontFamily,
  termFontFamily = 'Consolas',
  onSetTermFontFamily,
  onResetUiStyle,
  recentFiles = [],
  onOpenRecentFile,
  onRemoveRecentFile,
  onTogglePinRecentFile,
  mujicaRestoreVisible = false,
  onRestoreMujica,
}: SessionPanelProps, ref: React.ForwardedRef<SessionPanelHandle>) {
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [showFileFilterRules, setShowFileFilterRules] = useState(false)
  const [fileFilterRules, setFileFilterRules] = useState<string[]>(() => loadFilterRules())
  const [fileFilterRulesDraft, setFileFilterRulesDraft] = useState('')
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [showCliConfigModal, setShowCliConfigModal] = useState(false)
  const [cliCommand, setCliCommand] = useState(() => {
    try { return localStorage.getItem('vibe-ide-ai-cli-command') || '' } catch { return '' }
  })
  const [cliCommandDraft, setCliCommandDraft] = useState('')
  const [cliConfigDir, setCliConfigDir] = useState(() => {
    try { return localStorage.getItem('vibe-ide-ai-config-dir') || '' } catch { return '' }
  })
  const [cliConfigDirDraft, setCliConfigDirDraft] = useState('')
  const [defaultAgent, setDefaultAgent] = useState(() => {
    try { return localStorage.getItem('vibe-ide-default-agent') || '' } catch { return '' }
  })
  const [defaultAgentDraft, setDefaultAgentDraft] = useState('')
  const [claudeGroups, setClaudeGroups] = useState<ClaudeConfigGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [showClaudeGroupEditModal, setShowClaudeGroupEditModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ClaudeConfigGroup | null>(null)
  const [editName, setEditName] = useState('')
  const [editEnv, setEditEnv] = useState<{ key: string; value: string }[]>([])
  const [claudeApplyMsg, setClaudeApplyMsg] = useState('')
  const [termType, setTermType] = useState(() => getMainShellType())
  const [auxTermType, setAuxTermType] = useState(() => getAuxShellType())
  const [shellOptions, setShellOptions] = useState(FALLBACK_SHELLS)
  const [cwdEmojis, setCwdEmojis] = useState<string[]>(() => loadCwdEmojis())
  const [sessionEmojis, setSessionEmojis] = useState<string[]>(() => loadSessionEmojis())
  const [cwdEmojiOverrides, setCwdEmojiOverrides] = useState<Record<string, string>>({})
  const [sessionEmojiOverrides, setSessionEmojiOverrides] = useState<Record<string, string>>({})
  const [showAppearance, setShowAppearance] = useState(false)

  // 池变更时清理失效 override（用户在 modal 删了被 override 引用的 emoji 时）
  useEffect(() => {
    setCwdEmojiOverrides(prev => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) if (cwdEmojis.includes(v)) next[k] = v
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [cwdEmojis])
  useEffect(() => {
    setSessionEmojiOverrides(prev => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) if (sessionEmojis.includes(v)) next[k] = v
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [sessionEmojis])

  // 启动时从主进程获取本机已安装的 shell，过滤选项
  useEffect(() => {
    window.api.terminal.getShells().then((shells: { value: string; label: string }[]) => {
      if (shells.length > 0) {
        setShellOptions(shells)
        // 如果当前选中的 shell 不在可用列表中，切到第一个
        setTermType(prev => {
          if (shells.some(s => s.value === prev)) return prev
          const first = shells[0].value
          setMainShellType(first)
          return first
        })
        setAuxTermType(prev => {
          if (shells.some(s => s.value === prev)) return prev
          const first = shells[0].value
          setAuxShellType(first)
          return first
        })
      }
    }).catch(() => {})
  }, [])

  // Sync filter rules to git watcher (main process) on mount and when rules change
  useEffect(() => {
    window.api.git.setFilterRules(fileFilterRules)
  }, [fileFilterRules])

  const { t, lang, setLang } = useI18n()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [newMode, setNewMode] = useState<'term' | 'gui' | 'dsh'>('term')
  const [newSubmenu, setNewSubmenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const newSubmenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 新建：按模式在当前会话 cwd 创建并关菜单（勾选模式为当次启动内的用户偏好）
  const handleNewFromSubmenu = (mode: 'term' | 'gui' | 'dsh') => {
    setNewMode(mode)
    const session = sessions.find(s => s.id === contextMenu?.sessionId)
    if (session && onNewSessionHere) onNewSessionHere(session.cwd, mode)
    setContextMenu(null)
    setNewSubmenu(null)
  }
  const quickNewCwd = sessions.find(s => s.id === activeSessionId)?.cwd
  const handleQuickNewSession = (mode: 'term' | 'gui' | 'dsh') => {
    if (quickNewCwd && onNewSessionHere) onNewSessionHere(quickNewCwd, mode)
    else onCreateSession(termType)
  }
  const [cloneSubmenu, setCloneSubmenu] = useState<{ x: number; y: number; sessionId: string; cwd: string; shell?: string; initCommands: CustomCommand[] } | null>(null)
  const cloneSubmenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [emptyAreaMenu, setEmptyAreaMenu] = useState<{ x: number; y: number } | null>(null)
  const ctxMenuPos = useAdaptiveMenuPos(!!contextMenu, contextMenu?.x ?? 0, contextMenu?.y ?? 0)
  const emptyMenuPos = useAdaptiveMenuPos(!!emptyAreaMenu, emptyAreaMenu?.x ?? 0, emptyAreaMenu?.y ?? 0)
  const recentDirs = useRecentDirs()
  const favCwds = useFavCwds()
  const prevSessionIdsRef = useRef<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [showAppendCmdModal, setShowAppendCmdModal] = useState(false)
  const [appendCmdSessionId, setAppendCmdSessionId] = useState<string | null>(null)
  const [appendCmdDraft, setAppendCmdDraft] = useState('')
  const appendCmdAnchorYRef = useRef(0)
  const [schedTasks, setSchedTasks] = useState<Record<string, SchedTask>>({})
  const schedTasksRef = useRef(schedTasks)
  schedTasksRef.current = schedTasks
  const [showSchedModal, setShowSchedModal] = useState(false)
  const [schedSessionId, setSchedSessionId] = useState<string | null>(null)
  const [schedCronDraft, setSchedCronDraft] = useState('')
  const [schedCmdDraft, setSchedCmdDraft] = useState('')
  const [schedCronError, setSchedCronError] = useState('')

  const [claudeHistorySession, setClaudeHistorySession] = useState<TerminalSession | null>(null)
  const [claudeHistoryList, setClaudeHistoryList] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const claudeHistoryReqIdRef = useRef(0)
  const [claudeHistoryMode, setClaudeHistoryMode] = useState<'tui' | 'gui' | 'dsh'>('tui')
  const [dshHistoryList, setDshHistoryList] = useState<DshHistorySession[]>([])
  const dshHistoryReqIdRef = useRef(0)
  const [expandedHistory, setExpandedHistory] = useState<{ id: string; turns: { role: 'user' | 'assistant'; text: string }[]; loading: boolean } | null>(null)

  const hourglassSvg = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-ide-text-muted">
      <path d="M5 22h14M5 2h14M17 22v-4.17a3 3 0 0 0-.59-1.8L12 11l-4.41 5.03A3 3 0 0 0 7 17.83V22" />
      <path d="M7 2v4.17a3 3 0 0 0 .59 1.8L12 13l4.41-5.03A3 3 0 0 0 17 6.17V2" />
    </svg>
  )
  const handleSendAppendCmd = () => {
    if (!appendCmdDraft.trim() || !appendCmdSessionId) return
    onSwitchSession(appendCmdSessionId)
    onPipeCommand?.(appendCmdDraft)
    setShowAppendCmdModal(false)
  }
  const openSchedModal = (sessionId: string) => {
    const existing = schedTasks[sessionId]
    setSchedSessionId(sessionId)
    setSchedCronDraft(existing?.cron ?? '')
    setSchedCmdDraft(existing?.command ?? '')
    setSchedCronError('')
    setShowSchedModal(true)
  }
  const handleSaveSched = () => {
    if (!schedSessionId || !schedCmdDraft.trim()) return
    const cron = schedCronDraft.trim()
    if (!cronValid(cron)) {
      setSchedCronError(t('Invalid cron format. Need 5 fields: minute hour day month weekday'))
      return
    }
    setSchedTasks(prev => ({ ...prev, [schedSessionId]: { cron, command: schedCmdDraft, lastFired: '' } }))
    setShowSchedModal(false)
  }
  const handleDeleteSched = () => {
    if (!schedSessionId) return
    setSchedTasks(prev => { const n = { ...prev }; delete n[schedSessionId!]; return n })
    setShowSchedModal(false)
  }
  // 定时轮询：秒级检查 cron 命中，同一分钟只触发一次，向指定 session 发命令
  const onPipeToSessionRef = useRef(onPipeToSession)
  onPipeToSessionRef.current = onPipeToSession
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`
      for (const [sid, task] of Object.entries(schedTasksRef.current)) {
        if (task.lastFired === stamp) continue
        if (cronMatches(task.cron, now)) {
          setSchedTasks(prev => prev[sid] && prev[sid].lastFired !== stamp ? { ...prev, [sid]: { ...prev[sid], lastFired: stamp } } : prev)
          onPipeToSessionRef.current?.(sid, task.command)
        }
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  // session 关闭后清理其定时任务
  useEffect(() => {
    const ids = new Set(sessions.map(s => s.id))
    setSchedTasks(prev => {
      let changed = false
      const next: Record<string, SchedTask> = {}
      for (const [sid, task] of Object.entries(prev)) {
        if (ids.has(sid)) next[sid] = task
        else changed = true
      }
      return changed ? next : prev
    })
  }, [sessions])
  // 定时弹窗 ESC（window capture 优先于 App 层）
  useEffect(() => {
    if (!showSchedModal) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setShowSchedModal(false)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [showSchedModal])
  const [hoverPreview, setHoverPreview] = useState<{ sessionId: string; cwd: string; left: number; top: number } | null>(null)
  const [hoverTab, setHoverTab] = useState<'cmds' | 'files'>('cmds')
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMouseMoveAtRef = useRef(0)
  const cwdHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cwdLinkSession, setCwdLinkSession] = useState<string | null>(null)
  const [configMenuStyle, setConfigMenuStyle] = useState<React.CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const commandsRef = useRef<CustomCommandsHandle>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [dragGroupIndex, setDragGroupIndex] = useState<number | null>(null)
  const [dropGroupIndex, setDropGroupIndex] = useState<number | null>(null)

  useImperativeHandle(ref, () => ({
    toggleConfig: (rect: DOMRect) => {
      const menuWidth = 192
      const left = Math.max(4, rect.left + rect.width / 2 - menuWidth / 2)
      setConfigMenuStyle({
        position: 'fixed',
        left,
        top: rect.bottom + 4,
        minWidth: menuWidth,
      })
      setShowConfigMenu(prev => !prev)
    },
  }), [])

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renaming])

  useEffect(() => () => { clearTimer(hoverTimerRef) }, [])
  useEffect(() => {
    const handler = () => { lastMouseMoveAtRef.current = Date.now() }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [])

  // Track new sessions to record their cwd as recent directories
  useEffect(() => {
    for (const s of sessions) {
      if (!prevSessionIdsRef.current.has(s.id)) {
        cwdStore.addRecentDir(s.cwd)
      }
    }
    prevSessionIdsRef.current = new Set(sessions.map(s => s.id))
  }, [sessions])

  // 每会话 idleSince：running→(idle|warn) 转换时盖戳 now；首次见到的非 running 会话用 createdAt 初始化
  const [idleSinceMap, setIdleSinceMap] = useState<Record<string, number>>({})
  const prevStatusRef = useRef<Record<string, 'running' | 'idle' | 'warn'>>({})
  useEffect(() => {
    const prev = prevStatusRef.current
    const stamps: Record<string, number> = {}
    for (const s of sessions) {
      const cur = agentStatus[s.id] ?? 'idle'
      const p = prev[s.id]
      if (p === undefined) { if (cur !== 'running') stamps[s.id] = s.createdAt }
      else if (p === 'running' && cur !== 'running') stamps[s.id] = Date.now()
      prev[s.id] = cur
    }
    if (Object.keys(stamps).length) setIdleSinceMap(m => ({ ...m, ...stamps }))
  }, [agentStatus, sessions])

  // Group sessions by normalized cwd
  const sessionGroups = useMemo(() => {
    const map = new Map<string, TerminalSession[]>()
    const order: string[] = []
    for (const s of sessions) {
      const key = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
      if (!map.has(key)) {
        map.set(key, [])
        order.push(key)
      }
      map.get(key)!.push(s)
    }
    return order.map(cwd => ({ cwd, sessions: map.get(cwd)! }))
  }, [sessions])

  // Flat index map for drag reorder: visual position → session index in original array
  const flatIndexMap = useMemo(() => {
    const map: number[] = []
    for (const g of sessionGroups) {
      for (const s of g.sessions) {
        map.push(sessions.findIndex(si => si.id === s.id))
      }
    }
    return map
  }, [sessionGroups, sessions])

  const groupRefs = useRef<(HTMLDivElement | null)[]>([])
  const computeGroupDropIndex = (clientY: number) => {
    for (let i = 0; i < groupRefs.current.length; i++) {
      const el = groupRefs.current[i]
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return i
    }
    return groupRefs.current.length
  }

  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null)
      setEmptyAreaMenu(null)
      setCloneSubmenu(null)
      if (cloneSubmenuTimerRef.current) { clearTimeout(cloneSubmenuTimerRef.current); cloneSubmenuTimerRef.current = null }
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  useEffect(() => {
    if (!showConfigMenu) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.config-menu-area')) {
        setShowConfigMenu(false)
      }
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [showConfigMenu])

  // Settings menu: auto-close when mouse leaves the menu area (incl. submenus)
  useEffect(() => {
    if (!showConfigMenu) return
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    const isInMenuArea = (el: EventTarget | null) =>
      !!(el as HTMLElement | null)?.closest('.config-menu-area')
    const handleMouseOut = (e: MouseEvent) => {
      if (isInMenuArea(e.target) && !isInMenuArea(e.relatedTarget)) {
        if (closeTimer) clearTimeout(closeTimer)
        closeTimer = setTimeout(() => setShowConfigMenu(false), 200)
      }
    }
    const handleMouseOver = (e: MouseEvent) => {
      if (isInMenuArea(e.target)) {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
      }
    }
    document.addEventListener('mouseout', handleMouseOut, true)
    document.addEventListener('mouseover', handleMouseOver, true)
    return () => {
      document.removeEventListener('mouseout', handleMouseOut, true)
      document.removeEventListener('mouseover', handleMouseOver, true)
      if (closeTimer) clearTimeout(closeTimer)
    }
  }, [showConfigMenu])

  // ESC handler for CLI Config modal (capture phase per CLAUDE.md rule #8)
  useEffect(() => {
    if (!showCliConfigModal) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setShowCliConfigModal(false)
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [showCliConfigModal])

  // ── Claude 配置组：打开 CLI 配置弹窗时加载；子编辑弹窗 ESC（window capture 优先于外层） ──
  useEffect(() => {
    if (!showCliConfigModal) return
    let cancelled = false
    loadClaudeGroups().then(s => {
      if (cancelled) return
      setClaudeGroups(s.groups)
      setActiveGroupId(s.activeId)
    })
    return () => { cancelled = true }
  }, [showCliConfigModal])

  useEffect(() => {
    if (!showClaudeGroupEditModal) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setShowClaudeGroupEditModal(false)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [showClaudeGroupEditModal])

  const persistClaudeGroups = (groups: ClaudeConfigGroup[], activeId: string | null) => {
    setClaudeGroups(groups)
    setActiveGroupId(activeId)
    saveClaudeGroups({ groups, activeId })
  }
  const handleRefreshEnv = async () => {
    try {
      const result = await window.api.terminal.refreshEnv()
      if (result.success) {
        setClaudeApplyMsg(`已刷新 ${result.count} 个环境变量`)
        window.setTimeout(() => setClaudeApplyMsg(''), 3000)
      } else {
        setClaudeApplyMsg(`刷新失败：${result.error}`)
      }
    } catch (e: any) {
      setClaudeApplyMsg(`刷新失败：${e?.message || e}`)
    }
  }
  const handleClaudeApply = async (g: ClaudeConfigGroup) => {
    try {
      await applyClaudeGroup(g)
      persistClaudeGroups(claudeGroups, g.id)
      setClaudeApplyMsg('已写入 ~/.claude/settings.json · 下次启动 claude 生效')
      window.setTimeout(() => setClaudeApplyMsg(''), 4000)
    } catch (e: any) {
      setClaudeApplyMsg(`写入失败：${e?.message || '已保留现有 settings.json'}`)
    }
  }
  const handleClaudeDelete = (g: ClaudeConfigGroup) => {
    const next = claudeGroups.filter(x => x.id !== g.id)
    persistClaudeGroups(next, activeGroupId === g.id ? null : activeGroupId)
  }
  const handleClaudeEdit = (g: ClaudeConfigGroup) => {
    setEditingGroup(g)
    setEditName(g.name)
    setEditEnv(Object.entries(g.env).map(([k, v]) => ({ key: k, value: String(v) })))
    setShowClaudeGroupEditModal(true)
  }
  const handleClaudeNew = async () => {
    const cur = await readCurrentSettings()
    setEditingGroup(null)
    setEditName('')
    setEditEnv(DEFAULT_CLAUDE_ENV_KEYS.map(k => ({ key: k, value: String(cur[k] ?? '') })))
    setShowClaudeGroupEditModal(true)
  }
  const handleClaudeEditSave = () => {
    const name = editName.trim()
    if (!name) return
    const env: Record<string, string> = {}
    for (const r of editEnv) {
      const k = r.key.trim()
      if (k) env[k] = r.value
    }
    const id = editingGroup?.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
    const group: ClaudeConfigGroup = { id, name, env }
    const exists = claudeGroups.some(x => x.id === id)
    const next = exists ? claudeGroups.map(x => (x.id === id ? group : x)) : [...claudeGroups, group]
    persistClaudeGroups(next, activeGroupId)
    setShowClaudeGroupEditModal(false)
  }

  // Menu → Settings → Keyboard Shortcuts opens the shortcuts modal
  useEffect(() => {
    if (focusSettingsTrigger > 0) {
      setShowShortcuts(true)
    }
  }, [focusSettingsTrigger])

  useEffect(() => { window.api.appVersion().then(setAppVersion).catch(() => {}) }, [])

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setEmptyAreaMenu(null)
    setCloneSubmenu(null)
    setNewSubmenu(null)
    if (cloneSubmenuTimerRef.current) { clearTimeout(cloneSubmenuTimerRef.current); cloneSubmenuTimerRef.current = null }
    if (newSubmenuTimerRef.current) { clearTimeout(newSubmenuTimerRef.current); newSubmenuTimerRef.current = null }
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
  }

  const handleEmptyAreaContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu(null)
    setCloneSubmenu(null)
    setNewSubmenu(null)
    if (cloneSubmenuTimerRef.current) { clearTimeout(cloneSubmenuTimerRef.current); cloneSubmenuTimerRef.current = null }
    if (newSubmenuTimerRef.current) { clearTimeout(newSubmenuTimerRef.current); newSubmenuTimerRef.current = null }
    setEmptyAreaMenu({ x: e.clientX, y: e.clientY })
  }

  const handleRename = async () => {
    if (!renaming || !newName.trim()) {
      setRenaming(null)
      return
    }
    if (onRenameSession) {
      await onRenameSession(renaming, newName.trim())
    } else {
      await (window.api.terminal as any).rename(renaming, newName.trim())
    }
    setRenaming(null)
    setNewName('')
  }

  const startRename = (session: TerminalSession) => {
    setRenaming(session.id)
    setNewName(session.name)
    setContextMenu(null)
  }

  const stats = useMemo(() => {
    const total = sessions.length
    const running = sessions.filter(s => agentStatus[s.id] === 'running').length
    const warn = sessions.filter(s => agentStatus[s.id] === 'warn').length
    const idle = total - running - warn
    return { running, idle, warn }
  }, [sessions, agentStatus])

  const mujicaCounts = useMujicaCounts()

  const fetchClaudeHistory = useCallback(async (cwd: string) => {
    const reqId = ++claudeHistoryReqIdRef.current
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const { configDir } = readAiCliConfig()
      const r = await window.api.ai.listSessions(cwd || undefined, configDir)
      if (claudeHistoryReqIdRef.current !== reqId) return
      setClaudeHistoryList(r.sessions || [])
    } catch (e: any) {
      if (claudeHistoryReqIdRef.current !== reqId) return
      setHistoryError(e?.message || '加载失败')
    } finally {
      if (claudeHistoryReqIdRef.current === reqId) setHistoryLoading(false)
    }
  }, [])

  const closeClaudeHistory = useCallback(() => {
    claudeHistoryReqIdRef.current++
    setClaudeHistorySession(null)
    setClaudeHistoryList([])
    setHistoryError('')
    setHistoryLoading(false)
    setExpandedHistory(null)
  }, [])

  const toggleHistoryExpand = useCallback(async (s: any) => {
    if (!claudeHistorySession) return
    const id = s.session_id || s.id
    if (expandedHistory?.id === id) {
      setExpandedHistory(null)
      return
    }
    setExpandedHistory({ id, turns: [], loading: true })
    try {
      const turns = claudeHistoryMode === 'dsh'
        ? await fetchDshHistoryTurns(id, claudeHistorySession.cwd)
        : buildHistoryTurns((await window.api.ai.loadSessionMessages(id, claudeHistorySession.cwd, readAiCliConfig().configDir))?.messages)
      setExpandedHistory(prev => prev?.id === id ? { id, turns, loading: false } : prev)
    } catch (e: any) {
      setExpandedHistory(prev => prev?.id === id ? { id, turns: [{ role: 'assistant', text: e?.message || '加载失败' }], loading: false } : prev)
    }
  }, [claudeHistorySession, expandedHistory, claudeHistoryMode])

  const openClaudeHistory = useCallback((session: TerminalSession) => {
    setClaudeHistorySession(session)
    setClaudeHistoryList([])
    setHistoryError('')
    fetchClaudeHistory(session.cwd)
  }, [fetchClaudeHistory])

  const fetchDshHistory = useCallback(async (cwd: string) => {
    const reqId = ++dshHistoryReqIdRef.current
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const list = await fetchDshSessions(cwd)
      if (dshHistoryReqIdRef.current !== reqId) return
      setDshHistoryList(list)
    } catch (e: any) {
      if (dshHistoryReqIdRef.current !== reqId) return
      setHistoryError(e?.message || '加载失败')
    } finally {
      if (dshHistoryReqIdRef.current === reqId) setHistoryLoading(false)
    }
  }, [])

  const selectClaudeHistory = useCallback((s: any) => {
    if (!claudeHistorySession) return
    const cwd = claudeHistorySession.cwd
    if (claudeHistoryMode === 'dsh') {
      const dshId = s.id
      const name = s.title && s.title !== dshId ? s.title : ''
      closeClaudeHistory()
      onResumeDshHistory?.(dshId, cwd, name)
      return
    }
    const historySessionId = s.session_id || s.id
    const name = s.name && s.name !== historySessionId ? s.name : ''
    closeClaudeHistory()
    onResumeClaudeHistory?.(historySessionId, cwd, name, claudeHistoryMode)
  }, [claudeHistorySession, onResumeClaudeHistory, onResumeDshHistory, closeClaudeHistory, claudeHistoryMode])

  const deleteDshHistorySession = useCallback(async (s: DshHistorySession) => {
    try {
      const r = await window.api.dsh.deleteSession(s.id, s.cwd)
      if (r?.ok) {
        setDshHistoryList(prev => prev.filter(x => x.id !== s.id))
      } else {
        setHistoryError(r?.error || '删除失败')
      }
    } catch (e: any) {
      setHistoryError(e?.message || '删除失败')
    }
  }, [])

  const deleteClaudeHistory = useCallback(async (s: any) => {
    if (!claudeHistorySession) return
    const historySessionId = s.session_id || s.id
    const { configDir } = readAiCliConfig()
    try {
      const r = await window.api.ai.deleteSession(historySessionId, claudeHistorySession.cwd, configDir)
      if (r?.success) {
        setClaudeHistoryList(prev => prev.filter(x => (x.session_id || x.id) !== historySessionId))
      } else {
        setHistoryError(r?.error || '删除失败')
      }
    } catch (e: any) {
      setHistoryError(e?.message || '删除失败')
    }
  }, [claudeHistorySession])

  useEffect(() => {
    if (!claudeHistorySession) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeClaudeHistory()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [claudeHistorySession, closeClaudeHistory])

  const renderSessionItem = (
    session: TerminalSession,
    dragIdx: number,
    opts: { showHistory: boolean; showCwd: boolean; outerClass: string; nameClass: string; minHeightClass: string }
  ) => (
    <div
      key={session.id}
      draggable={!!onReorderSessions && !groupSessionsByCwd}
      className={`group ${opts.outerClass} session-item${
        session.id === activeSessionId ? ' session-item--active' : ''
      }${pipeRunning?.[session.id] ? ' session-item--pipe-running' : ''}${
        agentStatus[session.id] === 'running' ? ' session-item--running' : ''
      }${
        agentStatus[session.id] === 'warn' ? ' session-item--warn' : ''
      } ${
        session.id === activeSessionId
          ? 'bg-ide-accent/20 text-ide-text border-l-[3px] border-ide-accent'
          : agentStatus[session.id] === 'running'
            ? 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text border-l-[3px] border-ide-accent/60'
            : agentStatus[session.id] === 'warn'
              ? 'text-ide-warning hover:bg-ide-hover border-l-[3px] border-ide-warning/60'
              : 'text-ide-text-muted hover:bg-ide-hover hover:text-ide-text'
      } ${dragIndex === dragIdx ? 'opacity-40' : ''} ${dropIndex === dragIdx && dropIndex !== dragIndex ? 'border-t-2 border-ide-accent' : ''}`}
      onClick={() => onSwitchSession(session.id)}
      onDoubleClick={(e) => { e.stopPropagation(); startRename(session) }}
      onContextMenu={(e) => handleContextMenu(e, session.id)}
      // mouseEnter 驱动 + 真实移动校验：display:none→visible 或 item 插入鼠标下会派发幽灵 mouseover（无 mousemove 伴随），
      // 判非真实 hover 不打开；timer 触发时再校验鼠标仍在 item 上，防 leave 丢失导致异常打开
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const itemEl = e.currentTarget
        const enterAt = Date.now()
        const mx = e.clientX
        const my = e.clientY
        clearTimer(hoverTimerRef)
        hoverTimerRef.current = setTimeout(() => {
          if (lastMouseMoveAtRef.current < enterAt - 300) return
          const el = document.elementFromPoint(mx, my)
          if (el && itemEl.contains(el)) {
            setHoverPreview({ sessionId: session.id, cwd: session.cwd, left: rect.right + 2, top: rect.top })
          }
        }, 500)
      }}
      onMouseLeave={() => {
        clearTimer(hoverTimerRef)
        hoverTimerRef.current = setTimeout(() => setHoverPreview(null), 200)
      }}
      onDragStart={() => { setDragIndex(dragIdx); setDragGroupIndex(null); setDropGroupIndex(null) }}
      onDragOver={(e) => {
        if (dragGroupIndex !== null) return
        e.preventDefault()
        e.stopPropagation()
        if (dragIndex === null || dragIndex === dragIdx) {
          setDropIndex(null)
          return
        }
        const rect = e.currentTarget.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        setDropIndex(e.clientY < midY ? dragIdx : dragIdx + 1)
      }}
      onDrop={(e) => {
        if (dragGroupIndex !== null) return
        e.preventDefault()
        e.stopPropagation()
        if (dragIndex !== null && dragIndex !== dragIdx) {
          const toIndex = dropIndex !== null && dropIndex > dragIndex ? dropIndex - 1 : dropIndex ?? dragIdx
          onReorderSessions?.(dragIndex, toIndex)
        }
        setDragIndex(null)
        setDropIndex(null)
        setDragGroupIndex(null)
        setDropGroupIndex(null)
      }}
      onDragEnd={() => {
        setDragIndex(null)
        setDropIndex(null)
        setDragGroupIndex(null)
        setDropGroupIndex(null)
      }}
    >
      <div className={`flex items-center justify-between ${opts.minHeightClass}`}>
        <div className={`flex items-center gap-1.5 min-w-0 flex-1 ${opts.showCwd ? 'pr-12' : ''}`}>
          {renaming === session.id ? (
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleRename()
                }
                if (e.key === 'Escape') setRenaming(null)
              }}
              onBlur={handleRename}
              className="bg-ide-bg border border-ide-accent rounded px-1 text-xs text-ide-text outline-none w-24"
            />
          ) : (
            <>
              {(() => {
                const scheduled = !!schedTasks[session.id]
                const sessionEmoji = scheduled ? '⏰' : (sessionEmojiOverrides[session.id] || stableEmojiForSession(session.id, sessionEmojis))
                return (
                  <span
                    className="text-sm shrink-0 w-4 h-4 flex items-center justify-center cursor-pointer hover:bg-ide-hover rounded select-none transition-colors session-item__icon"
                    title={scheduled ? t('Scheduled Task') : t('Click to cycle emoji')}
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      if (scheduled) {
                        openSchedModal(session.id)
                        return
                      }
                      if (sessionEmojis.length === 0) return
                      const idx = sessionEmojis.indexOf(sessionEmoji)
                      const next = sessionEmojis[(idx + 1) % sessionEmojis.length]
                      setSessionEmojiOverrides(prev => ({ ...prev, [session.id]: next }))
                    }}
                    onContextMenu={(e) => e.stopPropagation()}
                  >{sessionEmoji}</span>
                )
              })()}
              <span className={`text-sm min-w-0 ${opts.nameClass} session-item__name ${agentStatus[session.id] === 'running' ? 'animate-text-wave' : ''}`} title={session.name}>{session.name}</span>
            </>
          )}
        </div>
        <div className={`flex items-center session-item__actions ${opts.showCwd ? 'absolute right-3 top-1/2 -translate-y-1/2' : ''}`}>
          {opts.showHistory && (onResumeClaudeHistory || onResumeDshHistory) && (
            <button
              onClick={(e) => { e.stopPropagation(); openClaudeHistory(session) }}
              className="w-5 h-5 rounded transition-all shrink-0 flex items-center justify-center text-ide-text-muted opacity-0 group-hover:opacity-100 hover:bg-ide-accent hover:text-white"
              title={t('Session History')}
            >
              <History size={12} />
            </button>
          )}
          {pipeRunning?.[session.id] && (
            <div className="session-item__pipe flex items-center gap-0.5 mr-0.5 pl-1.5 pr-1 h-5 rounded bg-ide-accent/10 text-ide-accent shrink-0">
              <Loader2 size={11} className="session-item__pipe-spinner animate-spin" />
              <span className="session-item__pipe-progress text-[10px] tabular-nums leading-none">{pipeProgress?.[session.id]?.current}/{pipeProgress?.[session.id]?.total}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onCancelPipe?.(session.id) }}
                className="session-item__pipe-cancel w-4 h-4 rounded flex items-center justify-center text-ide-danger hover:bg-ide-danger/25 transition-colors"
                title={t('Cancel')}
              >
                <Square size={10} className="fill-current" />
              </button>
            </div>
          )}
          <div className="relative w-5 h-5 shrink-0">
            <SessionIdleAge
              idleSince={idleSinceMap[session.id]}
              running={agentStatus[session.id] === 'running'}
              className="absolute inset-0 flex items-center justify-center text-xs tabular-nums text-ide-text-muted opacity-100 group-hover:opacity-0 transition-opacity pointer-events-none select-none whitespace-nowrap"
            />
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCloseSession(session.id)
              }}
              className="absolute inset-0 opacity-0 group-hover:opacity-100 rounded text-ide-text-muted hover:bg-ide-accent hover:text-white transition-all flex items-center justify-center pointer-events-none group-hover:pointer-events-auto"
              title={t('Close Session')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {opts.showCwd && (
        <div
          className="text-xs mt-0.5 session-item__cwd"
          onMouseEnter={() => {
            cwdHoverTimerRef.current = setTimeout(() => {
              setCwdLinkSession(session.id)
            }, 600)
          }}
          onMouseLeave={() => {
            if (cwdHoverTimerRef.current) {
              clearTimeout(cwdHoverTimerRef.current)
              cwdHoverTimerRef.current = null
            }
            setCwdLinkSession(null)
          }}
        >
          <span
            className={`inline-block max-w-full truncate transition-all ${
              cwdLinkSession === session.id
                ? 'underline text-ide-text cursor-pointer bg-ide-accent/15 rounded px-0.5'
                : 'text-ide-text-muted opacity-70'
            }`}
            title={session.cwd}
            onClick={(e) => {
              if (cwdLinkSession === session.id) {
                e.stopPropagation()
                window.api.file.openExplorer(session.cwd)
              }
            }}
          >
            {midTruncatePath(session.cwd)}
          </span>
        </div>
      )}
    </div>
  )

  return (
    <div ref={panelRef} className={`flex flex-col session-panel${compact ? '' : ' h-full'}`} style={{ fontFamily: 'var(--ide-session-font)' }}>
      {/* Header + Dashboard merged */}
      <div className="px-5 py-1.5 flex items-center justify-center shrink-0 session-panel__header">
        <div className="status-badge">
          <span
            className={`status-badge__segment status-badge__segment--running${stats.running > 0 ? ' is-active' : ''}`}
            title={t('running')}
          >
            <Zap size={13} className={`status-badge__icon${stats.running > 0 ? ' animate-zap-glow' : ''}`} />
            <span className="status-badge__count">{stats.running}</span>
          </span>
          <span className="status-badge__divider" />
          <span
            className="status-badge__segment status-badge__segment--idle"
            title={t('Idle')}
          >
            <Coffee size={13} className="status-badge__icon" />
            <span className="status-badge__count">{stats.idle}</span>
          </span>
          <span className="status-badge__divider" />
          <span
            className={`status-badge__segment status-badge__segment--warn${stats.warn > 0 ? ' is-active' : ''}`}
            title={t('warn')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" stroke="currentColor" strokeWidth="0.4" strokeLinejoin="round" strokeLinecap="round" style={{ paintOrder: 'stroke fill' }} className="status-badge__icon">
              <path d="M12.5 2.00002H3.5C2.119 2.00002 1 3.11902 1 4.50002V9.50002C1 10.881 2.119 12 3.5 12H4V13.942C4 14.784 4.992 15.234 5.625 14.679L8.688 11.999H12.5C13.881 11.999 15 10.88 15 9.49902V4.49902C15 3.11802 13.881 1.99902 12.5 1.99902V2.00002ZM14 9.50002C14 10.328 13.328 11 12.5 11H8.312L5 13.898V11H3.5C2.672 11 2 10.328 2 9.50002V4.50002C2 3.67202 2.672 3.00002 3.5 3.00002H12.5C13.328 3.00002 14 3.67202 14 4.50002V9.50002ZM7.508 7.09002L7.5 7.00002V4.50002L7.508 4.41002C7.55 4.17702 7.754 4.00002 8 4.00002C8.246 4.00002 8.45 4.17702 8.492 4.41002L8.5 4.50002V7.00002L8.492 7.09002C8.45 7.32302 8.246 7.50002 8 7.50002C7.754 7.50002 7.55 7.32302 7.508 7.09002ZM8.75 9.25002C8.75 9.66402 8.414 10 8 10C7.586 10 7.25 9.66402 7.25 9.25002C7.25 8.83602 7.586 8.50002 8 8.50002C8.414 8.50002 8.75 8.83602 8.75 9.25002Z" />
            </svg>
            <span className="status-badge__count">{stats.warn}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative config-menu-area session-panel__settings">
            {showConfigMenu && createPortal(
              <div style={configMenuStyle} className="bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 config-menu-area session-panel__settings-menu">
                {/* Language toggle */}
                <div className="flex items-center justify-between mx-3 my-1.5">
                  <div className="inline-flex items-center rounded-md bg-ide-hover overflow-hidden">
                    <button
                      className={`px-2 py-1 text-[11px] transition-colors ${lang === 'zh' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text'}`}
                      onClick={() => setLang('zh')}
                    >中</button>
                    <button
                      className={`px-2 py-1 text-[11px] transition-colors ${lang === 'en' ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text'}`}
                      onClick={() => setLang('en')}
                    >EN</button>
                  </div>
                  {appVersion && (
                    <span className="text-[11px] text-ide-text-muted/60">v{appVersion}</span>
                  )}
                </div>
                <div className="border-t border-ide-border mt-1 pt-1">
                  <button
                    className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors flex items-center gap-1.5"
                    onClick={() => {
                      setShowAppearance(true)
                      setShowConfigMenu(false)
                    }}
                  >
                    <Palette className="size-3.5" />
                    {t('Appearance')}
                  </button>
                </div>
                <div className="border-t border-ide-border mt-1 pt-1">
                {/* 会话配置 */}
                <button
                  className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors flex items-center gap-1.5"
                  onClick={() => {
                    setCliCommandDraft(cliCommand)
                    setCliConfigDirDraft(cliConfigDir)
                    setDefaultAgentDraft(defaultAgent)
                    setShowCliConfigModal(true)
                    setShowConfigMenu(false)
                  }}
                >
                  <Bot className="size-3.5" />
                  {t('CLI Configuration')}
                </button>
                </div>
                {/* Keyboard Shortcuts */}
                <div className="border-t border-ide-border mt-1 pt-1">
                  <button
                    className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors flex items-center gap-1.5"
                    onClick={() => { setShowShortcuts(true); setShowConfigMenu(false) }}
                  >
                    <Keyboard className="size-3.5" />
                    {t('Keyboard Shortcuts')}
                  </button>
                </div>
                {/* File Filter Rules */}
                <div className="border-t border-ide-border mt-1 pt-1">
                  <button
                    className="w-full px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover text-left transition-colors flex items-center gap-1.5"
                    onClick={() => {
                      setFileFilterRulesDraft(fileFilterRules.join('\n'))
                      setShowFileFilterRules(true)
                      setShowConfigMenu(false)
                    }}
                  >
                    <Filter className="size-3.5" />
                    {t('File Filter Rules')}
                  </button>
                </div>
              </div>
            , document.body)}
          </div>
        </div>
      </div>

      <div className="mx-2 mt-1 flex flex-col gap-1.5">
        <div className="relative group/new-session">
          <button
            onClick={() => onCreateSession(termType)}
            title={t('New Session')}
            className="w-full h-9 flex items-center justify-start px-3 gap-1.5 rounded-xl border border-transparent hover:border-ide-border bg-ide-sidebar text-ide-text text-sm font-medium hover:bg-ide-hover transition-colors"
          >
            <MessageSquarePlus size={14} className="text-ide-accent shrink-0" />
            <span className="truncate pointer-events-none">{t('New Session')}</span>
          </button>
          {quickNewCwd && onNewSessionHere && (
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center rounded-md border border-ide-border bg-ide-bg overflow-hidden shadow-sm opacity-0 pointer-events-none group-hover/new-session:opacity-100 group-hover/new-session:pointer-events-auto transition-opacity">
              <button
                title={t('Terminal')}
                onClick={() => handleQuickNewSession('term')}
                className="w-7 h-6 flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-ide-accent">
                  <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                title="Claude"
                onClick={() => handleQuickNewSession('gui')}
                className="w-7 h-6 flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors border-l border-ide-border"
              >
                <ClaudeLogoIcon size={13} />
              </button>
              <button
                title="dsh"
                onClick={() => handleQuickNewSession('dsh')}
                className="w-7 h-6 flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors border-l border-ide-border"
              >
                <DeepSeekLogoIcon size={13} />
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => onOpenHistoryTab?.()}
          disabled={sessions.length === 0}
          className="w-full h-9 flex items-center justify-start px-3 gap-1.5 rounded-xl border border-transparent hover:border-ide-border bg-ide-sidebar text-ide-text text-sm font-medium hover:bg-ide-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <History size={14} className="text-ide-text-muted" />
          {t('Session History')}
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 min-h-0 mx-2 mb-2 mt-1 overflow-hidden flex flex-col rounded-lg session-panel__list-wrapper">
        <div className="flex-1 min-h-0 overflow-y-auto pb-2 session-panel__list"
          onDragOver={(e) => {
            if (dragGroupIndex !== null && sessionGroups.length > 0) {
              e.preventDefault()
              e.stopPropagation()
              setDropGroupIndex(computeGroupDropIndex(e.clientY))
            } else if (dragIndex !== null && sessions.length > 0) {
              setDropIndex(sessions.length)
            }
          }}
          onDrop={(e) => {
            if (dragGroupIndex !== null && dragGroupIndex !== sessionGroups.length) {
              e.preventDefault()
              e.stopPropagation()
              const targetIdx = dropGroupIndex !== null ? dropGroupIndex : sessionGroups.length
              const toIdx = targetIdx > dragGroupIndex ? targetIdx - 1 : targetIdx
              onReorderGroup?.(dragGroupIndex, toIdx)
            }
            setDragGroupIndex(null)
            setDropGroupIndex(null)
            setDragIndex(null)
            setDropIndex(null)
          }}
          onContextMenu={handleEmptyAreaContextMenu}
        >
        {sessions.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ide-text-muted text-sm">
            No sessions yet
          </div>
        ) : groupSessionsByCwd ? (
          sessionGroups.map((group, gi) => {
            const dirName = dirNameOf(group.cwd)
            const cwdEmoji = getCwdEmoji(gi, cwdEmojis, cwdEmojiOverrides[group.cwd])
            const groupHasActive = activeSessionId && group.sessions.some(s => s.id === activeSessionId)
            return (
              <div
                key={group.cwd}
                ref={el => { groupRefs.current[gi] = el }}
                className={`bg-ide-sidebar border border-ide-border rounded-lg overflow-hidden session-group ${gi > 0 ? 'mt-3' : ''}`}
                style={dropGroupIndex === gi && dropGroupIndex !== dragGroupIndex ? { borderTop: '2px solid rgb(var(--ide-accent))' } : undefined}
              >
                {/* Folder header */}
                <div
                  draggable={!!onReorderGroup}
                  className={`group h-7 pl-4 pr-3 shrink-0 select-none flex items-center justify-between border-b border-ide-border text-ide-text-muted acrylic-titlebar rounded-t-lg session-group__header ${
                    dragGroupIndex === gi ? 'opacity-40' : ''
                  }`}
                  onDragStart={() => { setDragGroupIndex(gi); setDragIndex(null); setDropIndex(null) }}
                  onDragEnd={() => {
                    setDragGroupIndex(null)
                    setDropGroupIndex(null)
                    setDragIndex(null)
                    setDropIndex(null)
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-xs shrink-0 w-3.5 h-3.5 flex items-center justify-center cursor-pointer hover:bg-ide-hover rounded select-none transition-colors"
                      title={t('Click to cycle emoji')}
                      draggable={false}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        if (cwdEmojis.length === 0) return
                        const idx = cwdEmojis.indexOf(cwdEmoji)
                        const next = cwdEmojis[(idx + 1) % cwdEmojis.length]
                        setCwdEmojiOverrides(prev => ({ ...prev, [group.cwd]: next }))
                      }}
                      onContextMenu={(e) => e.stopPropagation()}
                    >{cwdEmoji}</span>
                    <span
                      className={`text-xs font-medium truncate min-w-0 cursor-pointer transition-all session-group__path ${
                        groupHasActive || cwdLinkSession === group.cwd ? 'text-ide-text' : 'text-ide-text-muted'
                      } ${
                        cwdLinkSession === group.cwd
                          ? 'underline bg-ide-accent/15 rounded px-0.5'
                          : ''
                      }`}
                      title={group.cwd}
                      onMouseEnter={() => {
                        cwdHoverTimerRef.current = setTimeout(() => {
                          setCwdLinkSession(group.cwd)
                        }, 600)
                      }}
                      onMouseLeave={() => {
                        if (cwdHoverTimerRef.current) {
                          clearTimeout(cwdHoverTimerRef.current)
                          cwdHoverTimerRef.current = null
                        }
                        setCwdLinkSession(null)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (cwdLinkSession === group.cwd) {
                          window.api.file.openExplorer(group.cwd)
                        }
                      }}
                    >{dirName}</span>
                  </div>
                  <div className="flex items-center">
                  {onResumeClaudeHistory && (() => {
                    const target = group.sessions.find(s => s.id === activeSessionId) || group.sessions[0]
                    return target ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); openClaudeHistory(target) }}
                        className="w-5 h-5 rounded transition-all shrink-0 flex items-center justify-center text-ide-text-muted opacity-0 group-hover:opacity-100 hover:bg-ide-accent hover:text-white"
                        title={t('Session History')}
                      >
                        <History size={12} />
                      </button>
                    ) : null
                  })()}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onCloneSession(null, group.cwd, termType)
                      }}
                      className="w-5 h-5 rounded text-ide-text-muted opacity-0 group-hover:opacity-100 hover:bg-ide-accent hover:text-white transition-all shrink-0 flex items-center justify-center"
                      title={t('New Terminal in this folder')}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
                {/* Sessions under this folder */}
                <div>
                {group.sessions.map((session) => {
                  const flatIdx = flatIndexMap.indexOf(sessions.findIndex(si => si.id === session.id))
                  return renderSessionItem(session, flatIdx, { showHistory: false, showCwd: false, outerClass: 'pl-4 pr-3 py-1 cursor-pointer transition-colors min-h-[44px] h-auto', nameClass: 'line-clamp-2 break-all', minHeightClass: 'min-h-[44px]' })
                })}
                </div>
              </div>
            )
          })
        ) : (
          <div className="bg-ide-sidebar border border-ide-border rounded-lg overflow-hidden session-panel__flat-list">
            {sessions.map((session, index) => renderSessionItem(session, index, { showHistory: true, showCwd: true, outerClass: 'px-3 py-1 cursor-pointer transition-colors relative', nameClass: 'truncate min-w-0', minHeightClass: 'min-h-[32px]' }))}
          </div>
        )}
        {dropGroupIndex !== null && dropGroupIndex === sessionGroups.length && dropGroupIndex !== dragGroupIndex && (
          <div className="mx-1 border-t-2 border-ide-accent mt-1" />
        )}
        {dropIndex === sessions.length && dropIndex !== dragIndex && dragIndex !== sessions.length - 1 && (
          <div className="mx-1 border-t-2 border-ide-accent" />
        )}
        {sessions.length === 1 && (
          <div className="text-center text-[11px] text-ide-text-muted/50 py-3 select-none">
            {t('Right-click blank area to open a new session')}
          </div>
        )}
        </div>

      {/* Custom Commands */}
      <CustomCommands ref={commandsRef} onExecuteCommand={onExecuteCommand} onInitCommand={onInitCommand} onPipeCommand={onPipeCommand} />

      </div>

      {/* Mujica restore — canvas active but center view switched away (e.g. session switch);
          row skeleton mirrors a session item, icon sized to match the session emoji */}
      {mujicaRestoreVisible && (
        <div className="shrink-0 mx-2 mb-2 bg-ide-sidebar border border-ide-border rounded-lg overflow-hidden">
          <div
            role="button"
            tabIndex={0}
            onClick={onRestoreMujica}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRestoreMujica?.() } }}
            title="restore mujica page"
            className="group px-3 py-1 cursor-pointer transition-colors relative min-h-[32px] session-item text-ide-text-muted hover:bg-ide-hover hover:text-ide-text select-none"
          >
            <div className="flex items-center justify-between min-h-[32px]">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <img src={mujicaIcon} alt="Mujica" className="w-4 h-4 object-contain shrink-0" />
                <span className="truncate min-w-0 text-sm session-item__name">Mujica {mujicaCounts}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={ctxMenuPos.ref}
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[140px] overflow-y-auto"
          style={ctxMenuPos.style}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative"
            onMouseEnter={() => {
              const cmds = loadCustomCommands().filter(c => c.type === 'init')
              if (cmds.length === 0) return
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (!session) return
              if (cloneSubmenuTimerRef.current) { clearTimeout(cloneSubmenuTimerRef.current); cloneSubmenuTimerRef.current = null }
              setCloneSubmenu({ x: contextMenu.x + 148, y: contextMenu.y + 4, sessionId: session.id, cwd: session.cwd, shell: session.shell, initCommands: cmds })
            }}
            onMouseLeave={() => {
              cloneSubmenuTimerRef.current = setTimeout(() => setCloneSubmenu(null), 150)
            }}
          >
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
              onClick={() => {
                const session = sessions.find(s => s.id === contextMenu.sessionId)
                if (session) {
                  onCloneSession(session.id, session.cwd, session.shell)
                }
                setContextMenu(null)
                setCloneSubmenu(null)
              }}
            >
              <Copy size={14} className="text-ide-text-muted" />
              <span>{t('Clone')}</span>
              {loadCustomCommands().some(c => c.type === 'init') && (
                <ChevronRight size={14} className="ml-auto text-ide-text-muted" />
              )}
            </button>
            {cloneSubmenu && cloneSubmenu.sessionId === contextMenu.sessionId && (
              <div
                className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[140px]"
                style={{ left: cloneSubmenu.x, top: cloneSubmenu.y }}
                onMouseEnter={() => {
                  if (cloneSubmenuTimerRef.current) { clearTimeout(cloneSubmenuTimerRef.current); cloneSubmenuTimerRef.current = null }
                }}
                onMouseLeave={() => {
                  setCloneSubmenu(null)
                }}
              >
                {cloneSubmenu.initCommands.map(cmd => (
                  <button
                    key={cmd.id}
                    className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
                    onClick={() => {
                      if (onCloneWithInit) {
                        onCloneWithInit(cloneSubmenu.sessionId, cloneSubmenu.cwd, cloneSubmenu.shell, cmd.command)
                      }
                      setContextMenu(null)
                      setCloneSubmenu(null)
                    }}
                  >
                    <MessageSquarePlus size={14} className="text-ide-accent" />
                    <span className="truncate max-w-[180px]">{cmd.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {onNewSessionHere && (
            <>
              <div
                className="relative"
                onMouseEnter={() => {
                  setNewSubmenu({ x: contextMenu.x + 148, y: contextMenu.y + 4, sessionId: contextMenu.sessionId })
                }}
                onMouseLeave={() => {
                  newSubmenuTimerRef.current = setTimeout(() => setNewSubmenu(null), 150)
                }}
              >
                <button
                  className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
                  onClick={() => handleNewFromSubmenu(newMode)}
                >
                  <MessageSquarePlus size={14} className="text-ide-text-muted" />
                  <span>{t('New')}</span>
                  <ChevronRight size={14} className="ml-auto text-ide-text-muted" />
                </button>
                {newSubmenu && newSubmenu.sessionId === contextMenu.sessionId && (
                  <div
                    className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[140px]"
                    style={{ left: newSubmenu.x, top: newSubmenu.y }}
                    onMouseEnter={() => {
                      if (newSubmenuTimerRef.current) { clearTimeout(newSubmenuTimerRef.current); newSubmenuTimerRef.current = null }
                    }}
                    onMouseLeave={() => setNewSubmenu(null)}
                  >
                    <button
                      className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
                      onClick={() => handleNewFromSubmenu('term')}
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-ide-accent shrink-0">
                        <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
                      </svg>
                      <span>{t('Terminal')}</span>
                      <span className="ml-auto flex items-center">
                        {newMode === 'term' ? <Check size={14} className="text-ide-accent shrink-0" /> : <span className="w-3.5 h-3.5 shrink-0" />}
                      </span>
                    </button>
                    <button
                      className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
                      onClick={() => handleNewFromSubmenu('gui')}
                    >
                      <ClaudeLogoIcon size={14} className="shrink-0" />
                      <span>Claude</span>
                      <span className="ml-auto flex items-center">
                        {newMode === 'gui' ? <Check size={14} className="text-ide-accent shrink-0" /> : <span className="w-3.5 h-3.5 shrink-0" />}
                      </span>
                    </button>
                    <button
                      className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
                      onClick={() => handleNewFromSubmenu('dsh')}
                    >
                      <DeepSeekLogoIcon size={14} className="shrink-0" />
                      <span>dsh</span>
                      <span className="ml-auto flex items-center">
                        {newMode === 'dsh' ? <Check size={14} className="text-ide-accent shrink-0" /> : <span className="w-3.5 h-3.5 shrink-0" />}
                      </span>
                    </button>
                  </div>
                )}
              </div>
              <div className="border-t border-ide-border my-1" />
            </>
          )}
          {onResetCache && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
              onClick={() => {
                onResetCache(contextMenu.sessionId)
                setContextMenu(null)
              }}
            >
              <RotateCcw size={14} className="text-ide-text-muted" />
              <span>{t('Clear Screen')}</span>
            </button>
          )}
          <button
            className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${schedTasks[contextMenu.sessionId] ? 'text-ide-accent bg-ide-accent/15 hover:bg-ide-accent/25' : 'text-ide-text hover:bg-ide-hover'}`}
            title={t('Scheduled')}
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (session) openSchedModal(session.id)
              setContextMenu(null)
            }}
          >
            <Clock size={14} className={schedTasks[contextMenu.sessionId] ? 'text-ide-accent' : 'text-ide-text-muted'} />
            <span>{t('Sched')}</span>
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              setAppendCmdSessionId(contextMenu.sessionId)
              setAppendCmdDraft('')
              appendCmdAnchorYRef.current = contextMenu.y
              setShowAppendCmdModal(true)
              setContextMenu(null)
            }}
          >
            {hourglassSvg}
            <span>{t('Append')}</span>
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-danger hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              onCloseSession(contextMenu.sessionId)
              setContextMenu(null)
            }}
          >
            <X size={14} className="text-ide-danger" />
            <span>{t('Close')}</span>
          </button>
        </div>
      )}

      {/* Empty Area Context Menu — recent directories */}
      {emptyAreaMenu && (
        <div
          ref={emptyMenuPos.ref}
          className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[200px] overflow-y-auto"
          style={emptyMenuPos.style}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              onCreateSession(termType)
              setEmptyAreaMenu(null)
            }}
          >
            <MessageSquarePlus size={14} className="text-ide-text-muted" />
            {t('New Terminal')}
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
            onClick={() => {
              commandsRef.current?.openCreateModal()
              setEmptyAreaMenu(null)
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-text-muted shrink-0">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            {t('Custom Command')}
          </button>
          {recentDirs.length > 0 && (
            <>
              <div className="border-t border-ide-border my-1" />
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Recent Directories')}</span>
                <button
                  onClick={() => {
                    for (const d of favCwds) onCloneSession(null, d, termType)
                    setEmptyAreaMenu(null)
                  }}
                  disabled={favCwds.length === 0}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded text-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="size-2.5" />
                  {t('Restore Selected')}
                </button>
              </div>
              {[...recentDirs]
                .sort((a, b) => Number(cwdStore.isFav(b)) - Number(cwdStore.isFav(a)))
                .map(dir => {
                  const isFav = cwdStore.isFav(dir)
                  return (
                    <div
                      key={dir}
                      className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2 group"
                    >
                      <button
                        className={`w-3.5 h-3.5 shrink-0 flex items-center justify-center transition-colors ${isFav ? 'text-ide-accent' : 'text-ide-text-muted/70 hover:text-ide-text-muted'}`}
                        onClick={(e) => { e.stopPropagation(); cwdStore.toggleFav(dir) }}
                        title={t('Favorite')}
                      >
                        <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        className="flex items-center gap-2 truncate flex-1 cursor-pointer bg-transparent border-none text-inherit text-sm p-0"
                        onClick={() => {
                          onCloneSession(null, dir, termType)
                          setEmptyAreaMenu(null)
                        }}
                      >
                        <span className="truncate">{dir}</span>
                      </button>
                      {isFav ? (
                        <span className="w-4 h-4 shrink-0 -mr-1" aria-hidden="true" />
                      ) : (
                        <button
                          className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover flex items-center justify-center shrink-0 transition-all -mr-1"
                          onClick={(e) => { e.stopPropagation(); cwdStore.removeRecentDir(dir) }}
                          title={t('Remove')}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })}
            </>
          )}
        </div>
      )}

      {/* History Hover Popover */}
      {hoverPreview && (() => {
        const cmds = commandHistory[hoverPreview.sessionId] || []
        const displayed = cmds.slice(-30)
        const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
        const cwdKey = normPath(hoverPreview.cwd)
        const cwdAll = recentFiles.filter(f => {
          const fp = normPath(f.path)
          return fp === cwdKey || fp.startsWith(cwdKey + '/')
        })
        const cwdPinned = cwdAll.filter(f => f.pinned)
        const cwdUnpinned = cwdAll.filter(f => !f.pinned)
        // 固定的不占名额，其余按最近优先补足 7 个（与全局最近文件上限一致）
        const cwdFiles = [...cwdPinned, ...cwdUnpinned].slice(0, Math.max(7, cwdPinned.length))
        return (
          <div
            className="fixed z-50 bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-80 max-h-64 flex flex-col"
            style={{ left: hoverPreview.left, top: hoverPreview.top }}
            onMouseEnter={() => { clearTimer(hoverTimerRef) }}
            onMouseLeave={() => {
              clearTimer(hoverTimerRef)
              hoverTimerRef.current = setTimeout(() => setHoverPreview(null), 300)
            }}
          >
            <div className="flex items-center px-3 py-1 border-b border-ide-border shrink-0 bg-ide-sidebar">
              <div
                className="relative w-[7.25rem] h-6 rounded-full bg-ide-bg cursor-pointer select-none shrink-0 transition-colors"
                onClick={() => setHoverTab(hoverTab === 'cmds' ? 'files' : 'cmds')}
                title={t(hoverTab === 'cmds' ? 'File' : 'Cmd')}
              >
                <div className="absolute inset-0 flex items-center text-[11px] text-ide-text-muted/50">
                  <div className="flex-1 flex items-center justify-center gap-1">
                    <Terminal size={11} />
                    {t('Cmd')}
                  </div>
                  <div className="flex-1 flex items-center justify-center gap-1">
                    <File size={11} />
                    {t('File')}
                  </div>
                </div>
                <div
                  className={`absolute top-0.5 left-0.5 w-14 h-5 rounded-full bg-ide-accent flex items-center justify-center gap-1 text-[11px] text-white transition-transform duration-150 ease-out ${hoverTab === 'files' ? 'translate-x-full' : ''}`}
                >
                  {hoverTab === 'cmds' ? <Terminal size={11} /> : <File size={11} />}
                  {hoverTab === 'cmds' ? t('Cmd') : t('File')}
                </div>
              </div>
            </div>
            {hoverTab === 'cmds' ? (
              <div className="flex-1 overflow-y-auto py-1">
                {cmds.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-ide-text-muted text-center">
                    {t('No commands yet')}
                  </div>
                ) : (
                  displayed.map((cmd, i) => (
                    <div
                      key={`hp-${i}`}
                      className="px-3 py-0.5 text-xs font-mono text-ide-text hover:bg-ide-hover flex items-center gap-2 group relative"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          commandsRef.current?.openCreateModal({ command: cmd })
                        }}
                        className="absolute left-0.5 opacity-0 group-hover:opacity-100 text-ide-text-muted hover:text-ide-accent shrink-0 transition-opacity p-0.5"
                        title={t('Save to command')}
                      >
                        <Pencil size={12} />
                      </button>
                      <span className="text-ide-text-muted shrink-0 select-none w-5 text-right">
                        {cmds.length - displayed.length + i + 1}
                      </span>
                      <span className="truncate flex-1" title={cmd}>
                        {cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd}
                      </span>
                      <SessionCmdCopyButton cmd={cmd} />
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto py-1">
                {cwdFiles.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-ide-text-muted text-center">
                    {t('No files yet')}
                  </div>
                ) : null}
                {cwdFiles.map(f => {
                  const baseName = f.path.split(/[\\/]/).pop() || f.path
                  const info = getFileInfo(baseName)
                  return (
                    <div
                      key={f.path}
                      className="px-3 py-0.5 cursor-pointer transition-colors hover:bg-ide-hover flex items-center gap-2 group relative"
                      title={f.path}
                      onClick={() => onOpenRecentFile?.(f.path, f.line)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onTogglePinRecentFile?.(f.path) }}
                        className={`absolute left-0.5 text-ide-text-muted hover:text-ide-accent shrink-0 transition-opacity p-0.5 ${f.pinned ? 'opacity-100 text-ide-accent' : 'opacity-0 group-hover:opacity-100'}`}
                        title={t(f.pinned ? 'Unpin' : 'Pin')}
                      >
                        <Pin size={12} className={f.pinned ? 'fill-current' : ''} />
                      </button>
                      <svg viewBox="0 0 16 16" fill="currentColor" className={`ft-icon shrink-0 ml-2 ${info.color}`}
                        dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] }} />
                      <span className="truncate min-w-0 text-xs text-ide-text flex-1">{baseName}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveRecentFile?.(f.path) }}
                        className="opacity-0 group-hover:opacity-100 shrink-0 text-ide-text-muted hover:text-ide-text transition-opacity p-0.5"
                        title={t('Remove')}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && createPortal(
        <ModalOverlay onClose={() => setShowShortcuts(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text flex items-center gap-1.5"><Keyboard className="size-3.5" />{t('Keyboard Shortcuts')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowShortcuts(false)}
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SettingsPanel />
            </div>
          </div>
        </ModalOverlay>
      , document.body)}

      {/* File Filter Rules Modal */}
      {showFileFilterRules && createPortal(
        <ModalOverlay onClose={() => setShowFileFilterRules(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[420px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text flex items-center gap-1.5"><Filter className="size-3.5" />{t('File Filter Rules')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowFileFilterRules(false)}
              >
                ×
              </button>
            </div>
            <div className="p-3">
              <p className="text-xs text-ide-text-muted mb-2">{t('Skip directories matching these names. One per line.')}</p>
              <textarea
                className="w-full h-48 bg-ide-bg border border-ide-border rounded px-3 py-2 text-sm text-ide-text font-mono focus:border-ide-accent focus:outline-none resize-none"
                value={fileFilterRulesDraft}
                onChange={(e) => setFileFilterRulesDraft(e.target.value)}
                placeholder=".git&#10;node_modules&#10;dist&#10;build"
              />
              <div className="flex justify-between gap-2 mt-3">
                <button
                  className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                  onClick={() => setFileFilterRulesDraft(DEFAULT_FILTER_RULES.join('\n'))}
                >
                  {t('Reset Defaults')}
                </button>
                <div className="flex gap-2">
                <button
                  className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                  onClick={() => setShowFileFilterRules(false)}
                >
                  {t('Cancel')}
                </button>
                <button
                  className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
                  onClick={() => {
                    const rules = fileFilterRulesDraft.split('\n').map(s => s.trim()).filter(Boolean)
                    setFileFilterRules(rules)
                    saveFilterRules(rules)
                    setShowFileFilterRules(false)
                    window.dispatchEvent(new CustomEvent('file-filter-rules-changed'))
                  }}
                >
                  {t('Save')}
                </button>
                </div>
              </div>
            </div>
          </div>
        </ModalOverlay>
      , document.body)}


      {createPortal(<AppearancePanel
        open={showAppearance}
        onClose={() => setShowAppearance(false)}
        capsuleTabs={capsuleTabs}
        onToggleCapsuleTabs={onToggleCapsuleTabs}
        groupSessionsByCwd={groupSessionsByCwd}
        onToggleGroupSessionsByCwd={onToggleGroupSessionsByCwd}
        inlineDiff={inlineDiff}
        onToggleInlineDiff={onToggleInlineDiff}
        wordWrap={wordWrap}
        onToggleWordWrap={onToggleWordWrap}
        diffSplitRatio={diffSplitRatio}
        onSetDiffSplitRatio={onSetDiffSplitRatio}
        editorFontSize={editorFontSize}
        onAdjustEditorFontSize={onAdjustEditorFontSize}
        fontFamily={fontFamily}
        onSetFontFamily={onSetFontFamily}
        uiFontFamily={uiFontFamily}
        onSetUiFontFamily={onSetUiFontFamily}
        termFontFamily={termFontFamily}
        onSetTermFontFamily={onSetTermFontFamily}
        terminalFontSize={terminalFontSize}
        onAdjustTerminalFontSize={onAdjustTerminalFontSize}
        autoUtf8={autoUtf8}
        onToggleAutoUtf8={onToggleAutoUtf8}
        cgEnabled={cgEnabled}
        onToggleCgEnabled={onToggleCgEnabled}
        ocrEnabled={ocrEnabled}
        onToggleOcrEnabled={onToggleOcrEnabled}
        forceDomRenderer={forceDomRenderer}
        onToggleForceDomRenderer={onToggleForceDomRenderer}
        pollingEnabled={pollingEnabled}
        onTogglePolling={onTogglePolling}
        cwdEmojis={cwdEmojis}
        sessionEmojis={sessionEmojis}
        onSetCwdEmojis={(arr) => { setCwdEmojis(arr); saveCwdEmojis(arr) }}
        onSetSessionEmojis={(arr) => { setSessionEmojis(arr); saveSessionEmojis(arr) }}
        onResetUiStyle={onResetUiStyle}
        onCreateSessionAt={onCreateSessionAt}
      />, document.body)}

      {/* CLI Configuration Modal — Shell Type + AI CLI Command */}
      {showCliConfigModal && createPortal(
        <ModalOverlay onClose={() => setShowCliConfigModal(false)}>
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[440px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-9 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text flex items-center gap-1.5"><Bot className="size-3.5" />{t('CLI Configuration')}</span>
              <div className="flex items-center gap-1">
                <button
                  className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors mr-1"
                  title={t('Refresh Env')}
                  onClick={handleRefreshEnv}
                >
                  <RotateCcw className="size-3" />
                </button>
                <button
                  className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                  onClick={() => setShowCliConfigModal(false)}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="px-9 py-4 flex flex-col gap-4">
              {/* Shell Type */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Shell Type')}</span>
                <select
                  value={termType}
                  onChange={(e) => {
                    const val = e.target.value
                    setTermType(val)
                    setMainShellType(val)
                  }}
                  className="w-full px-3 py-2 text-sm bg-ide-sidebar border border-ide-border rounded text-ide-text focus:outline-none focus:border-ide-accent/60"
                >
                  {shellOptions.map((tt) => (
                    <option key={tt.value} value={tt.value}>{tt.label}</option>
                  ))}
                </select>
              </label>
              {/* Aux Shell Type */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Aux Shell Type')}</span>
                <select
                  value={auxTermType}
                  onChange={(e) => {
                    const val = e.target.value
                    setAuxTermType(val)
                    setAuxShellType(val)
                  }}
                  className="w-full px-3 py-2 text-sm bg-ide-sidebar border border-ide-border rounded text-ide-text focus:outline-none focus:border-ide-accent/60"
                >
                  {shellOptions.map((tt) => (
                    <option key={tt.value} value={tt.value}>{tt.label}</option>
                  ))}
                </select>
              </label>
              {/* AI CLI Command */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Claude Code CLI')}</span>
                <input
                  type="text"
                  value={cliCommandDraft}
                  onChange={(e) => setCliCommandDraft(e.target.value)}
                  onBlur={() => {
                    const val = cliCommandDraft.trim()
                    setCliCommand(val)
                    try { localStorage.setItem('vibe-ide-ai-cli-command', val) } catch {}
                  }}
                  placeholder="可选: claude, openclaude, opencc"
                  className="w-full px-3 py-2 text-sm font-mono bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                />
              </label>
              {/* AI Config Dir */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Claude Config Dir')}</span>
                <input
                  type="text"
                  value={cliConfigDirDraft}
                  onChange={(e) => setCliConfigDirDraft(e.target.value)}
                  onBlur={() => {
                    const val = cliConfigDirDraft.trim()
                    setCliConfigDir(val)
                    try { localStorage.setItem('vibe-ide-ai-config-dir', val) } catch {}
                  }}
                  placeholder=".opencc / ~/.claude"
                  className="w-full px-3 py-2 text-sm font-mono bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Default Agent')}</span>
                <input
                  type="text"
                  value={defaultAgentDraft}
                  onChange={(e) => setDefaultAgentDraft(e.target.value)}
                  onBlur={() => {
                    const val = defaultAgentDraft.trim()
                    setDefaultAgent(val)
                    try { localStorage.setItem('vibe-ide-default-agent', val) } catch {}
                  }}
                  placeholder={t('Optional. Auto-run on new session (empty = disabled)')}
                  className="w-full px-3 py-2 text-sm font-mono bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                />
              </label>
              {/* Claude 配置组：多组 model/provider 预设，一键切换写入 ~/.claude/settings.json */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ide-text-muted">claude code 多provider配置</span>
                  <button
                    onClick={handleClaudeNew}
                    className="text-[11px] text-ide-accent hover:text-ide-accent-hover transition-colors"
                  >+ 新建</button>
                </div>
                {claudeGroups.length === 0 ? (
                  <div className="text-[11px] text-ide-text-muted/60 py-2 text-center border border-dashed border-ide-border rounded">
                    无 provider 配置 · 点「+ 新建」添加
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                    {claudeGroups.map(g => {
                      const isActive = g.id === activeGroupId
                      return (
                        <div
                          key={g.id}
                          className={`group flex items-center gap-2 px-2 py-1.5 rounded border transition-colors ${isActive ? 'border-ide-accent/60 bg-ide-accent/10' : 'border-ide-border hover:bg-ide-hover/40'}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-ide-text truncate">{g.name}</span>
                              {isActive && <span className="text-[10px] text-ide-accent shrink-0">生效中</span>}
                            </div>
                            <div className="text-[10px] text-ide-text-muted truncate">{groupSummary(g)}</div>
                          </div>
                          <button
                            onClick={() => handleClaudeApply(g)}
                            title="应用（写入 settings.json，下次启动生效）"
                            className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-accent hover:bg-ide-accent/15 transition-colors"
                          >
                            <Zap size={12} />
                          </button>
                          <button
                            onClick={() => handleClaudeEdit(g)}
                            title="编辑"
                            className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => handleClaudeDelete(g)}
                            title="删除"
                            className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {claudeApplyMsg && <div className="text-[10px] text-ide-success">{claudeApplyMsg}</div>}
              </div>
            </div>
          </div>
        </ModalOverlay>
      , document.body)}

      {/* Claude 配置组 编辑子弹窗 */}
      {showClaudeGroupEditModal && createPortal(
        <ModalOverlay onClose={() => setShowClaudeGroupEditModal(false)} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[460px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text">{editingGroup ? '编辑 provider 配置' : '新建 provider 配置'}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowClaudeGroupEditModal(false)}
              >×</button>
            </div>
            <div className="p-4 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">名称</span>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="如：阿里云 GLM"
                  autoFocus
                  className="w-full px-3 py-1.5 text-sm bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                />
              </label>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ide-text-muted">env 变量</span>
                  <button
                    onClick={() => setEditEnv(prev => [...prev, { key: '', value: '' }])}
                    className="text-[11px] text-ide-accent hover:text-ide-accent-hover transition-colors"
                  >+ 添加</button>
                </div>
                <div className="flex flex-col gap-1">
                  {editEnv.map((row, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <input
                        type="text"
                        value={row.key}
                        onChange={e => setEditEnv(prev => prev.map((r, j) => j === i ? { ...r, key: e.target.value } : r))}
                        placeholder="ANTHROPIC_BASE_URL"
                        className="w-[180px] shrink-0 px-2 py-1 text-[11px] font-mono bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/40 focus:outline-none focus:border-ide-accent/60"
                      />
                      <input
                        type="text"
                        value={row.value}
                        onChange={e => setEditEnv(prev => prev.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                        placeholder="https://..."
                        className="flex-1 min-w-0 px-2 py-1 text-[11px] font-mono bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/40 focus:outline-none focus:border-ide-accent/60"
                      />
                      <button
                        onClick={() => setEditEnv(prev => prev.filter((_, j) => j !== i))}
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover transition-colors"
                      ><X size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-ide-border shrink-0">
              <button
                className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                onClick={() => setShowClaudeGroupEditModal(false)}
              >取消</button>
              <button
                className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!editName.trim()}
                onClick={handleClaudeEditSave}
              >保存</button>
            </div>
          </div>
        </ModalOverlay>
      , document.body)}

      {/* 追加命令 Modal */}
      {showAppendCmdModal && (
        <ModalOverlay onClose={() => setShowAppendCmdModal(false)} className="fixed inset-0 z-50" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setShowAppendCmdModal(false) } }}>
          <div className="fixed flex flex-col z-[51] w-[230px]" style={{ left: (panelRef.current?.getBoundingClientRect().right ?? 300) + 8, top: appendCmdAnchorYRef.current - 24 }} onClick={e => e.stopPropagation()}>
            <textarea
              className="w-full box-border resize-none max-h-[40vh] px-2 py-1.5 rounded-xl bg-ide-bg border border-ide-border text-ide-text text-[11px] leading-[1.3] outline-none transition-colors duration-[120ms] focus:border-ide-accent/60 placeholder:text-ide-text-muted/60 shadow-[0_2px_6px_rgb(0_0_0_/_0.25)]"
              value={appendCmdDraft}
              onChange={e => setAppendCmdDraft(e.target.value)}
              placeholder={t('Type a command, Enter to send...')}
              rows={3}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendAppendCmd()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setShowAppendCmdModal(false)
                }
              }}
            />
          </div>
        </ModalOverlay>
      )}

      {/* 定时命令 Modal */}
      {showSchedModal && createPortal(
        <ModalOverlay onClose={() => setShowSchedModal(false)} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[380px] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <span className="text-sm font-semibold text-ide-text flex items-center gap-1.5">⏰ {t('Scheduled Task')}</span>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                onClick={() => setShowSchedModal(false)}
              >×</button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Cron expression')}</span>
                <input
                  type="text"
                  value={schedCronDraft}
                  onChange={e => { setSchedCronDraft(e.target.value); setSchedCronError('') }}
                  placeholder={t('minute hour day month weekday · e.g. */5 * * * *')}
                  className="w-full px-3 py-1.5 text-sm font-mono bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                />
                {schedCronError && <span className="text-[10px] text-ide-danger">{schedCronError}</span>}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ide-text-muted">{t('Command')}</span>
                <textarea
                  rows={3}
                  value={schedCmdDraft}
                  onChange={e => setSchedCmdDraft(e.target.value)}
                  placeholder={t('Command to run on schedule')}
                  className="w-full resize-none px-3 py-2 text-sm font-mono bg-ide-sidebar border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                />
              </label>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-ide-border shrink-0">
              {schedSessionId && schedTasks[schedSessionId] && (
                <button
                  className="px-3 py-1.5 text-xs text-ide-danger hover:bg-ide-danger/10 rounded transition-colors"
                  onClick={handleDeleteSched}
                >{t('Delete')}</button>
              )}
              <div className="flex gap-2 ml-auto">
                <button
                  className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                  onClick={() => setShowSchedModal(false)}
                >{t('Cancel')}</button>
                <button
                  className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={!schedCmdDraft.trim()}
                  onClick={handleSaveSched}
                >{t('Save')}</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      , document.body)}

      {claudeHistorySession && (
        <ModalOverlay onClose={closeClaudeHistory} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[380px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ide-text">{t('Session History')}</span>
                <div className="flex items-center rounded bg-ide-sidebar border border-ide-border p-0.5">
                  <button
                    onClick={() => { setClaudeHistoryMode('tui'); if (claudeHistorySession) fetchClaudeHistory(claudeHistorySession.cwd) }}
                    className={`w-6 h-5 rounded flex items-center justify-center transition-colors ${claudeHistoryMode === 'tui' ? 'bg-ide-accent/15 text-ide-accent' : 'text-ide-accent hover:bg-ide-accent/20'}`}
                    title="cc tui"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    onClick={() => { setClaudeHistoryMode('gui'); if (claudeHistorySession) fetchClaudeHistory(claudeHistorySession.cwd) }}
                    className={`w-6 h-5 rounded flex items-center justify-center transition-colors ${claudeHistoryMode === 'gui' ? 'bg-ide-accent/15' : 'text-ide-text-muted hover:text-ide-text'}`}
                    title="cc gui"
                  >
                    <ClaudeLogoIcon size={13} />
                  </button>
                  <button
                    onClick={() => { setClaudeHistoryMode('dsh'); if (claudeHistorySession) fetchDshHistory(claudeHistorySession.cwd) }}
                    className={`w-6 h-5 rounded flex items-center justify-center transition-colors ${claudeHistoryMode === 'dsh' ? 'bg-ide-accent/15' : 'text-ide-text-muted hover:text-ide-text'}`}
                    title="dsh"
                  >
                    <DeepSeekLogoIcon size={13} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="w-5 h-5 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!claudeHistorySession) return
                    if (claudeHistoryMode === 'dsh') fetchDshHistory(claudeHistorySession.cwd)
                    else fetchClaudeHistory(claudeHistorySession.cwd)
                  }}
                  disabled={historyLoading}
                  title={t('Refresh')}
                ><RotateCcw size={13} /></button>
                <button
                  className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                  onClick={closeClaudeHistory}
                >×</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {historyLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-ide-text-muted">
                  <Loader2 size={14} className="animate-spin" /><span>{t('Loading...')}</span>
                </div>
              ) : historyError ? (
                <div className="py-8 text-center text-xs text-ide-danger px-4">{historyError}</div>
              ) : (claudeHistoryMode === 'dsh' ? dshHistoryList : claudeHistoryList).length === 0 ? (
                <div className="py-8 text-center text-xs text-ide-text-muted px-4">{t('No history sessions')}</div>
              ) : (
                (claudeHistoryMode === 'dsh' ? dshHistoryList : claudeHistoryList).map((s: any) => {
                  const id = s.session_id || s.id
                  const title = s.title || s.name || id
                  const timeStr = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : (s.timestamp ? new Date(s.timestamp).toLocaleString() : '')
                  const hist = expandedHistory?.id === id ? expandedHistory : null
                  return (
                    <div
                      key={id}
                      onClick={() => void toggleHistoryExpand(s)}
                      className="group w-full px-2.5 py-2 flex items-start gap-2 text-xs text-ide-text hover:bg-ide-hover transition-colors text-left cursor-pointer"
                    >
                      <ChevronDown size={12} className={`mt-0.5 shrink-0 text-ide-text-muted transition-transform ${hist ? '' : '-rotate-90'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{title}</div>
                        <div className="text-[10px] text-ide-text-muted/60 truncate mt-0.5">
                          {s.cwd ? <span className="text-ide-text/70">{s.cwd}</span> : null}
                          {s.cwd && timeStr ? ' · ' : ''}
                          {timeStr}
                          {s.sizeBytes > 0 ? ` · ${formatBytes(s.sizeBytes)}` : ''}
                        </div>
                        {hist && (
                          <div className="mt-1.5 pt-1.5 border-t border-ide-border/50 max-h-40 overflow-y-auto space-y-0.5">
                            {hist.loading ? (
                              <div className="flex items-center gap-1.5 text-[11px] text-ide-text-muted py-0.5">
                                <Loader2 size={11} className="animate-spin" /><span>{t('Loading...')}</span>
                              </div>
                            ) : (
                              hist.turns.map((tr, ti) => (
                                <div key={ti} className="flex items-start gap-1 text-[11px] leading-snug" title={tr.text}>
                                  <span className={`shrink-0 w-4 text-center select-none rounded ${tr.role === 'user' ? 'text-ide-accent' : 'text-ide-success'}`}>
                                    {tr.role === 'user' ? t('User') : t('Assistant')}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-ide-text-muted/80">
                                    {tr.text.length > 60 ? tr.text.slice(0, 60) + '…' : tr.text}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); selectClaudeHistory(s) }}
                        className="shrink-0 px-2 py-0.5 text-[10px] rounded bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 transition-colors"
                        title={t('Resume')}
                      >
                        {t('Resume')}
                      </button>
                      {!s.running && (
                        <button
                          onClick={(e) => { e.stopPropagation(); claudeHistoryMode === 'dsh' ? void deleteDshHistorySession(s) : void deleteClaudeHistory(s) }}
                          className="shrink-0 w-5 h-5 rounded text-ide-text-muted opacity-0 group-hover:opacity-100 hover:text-ide-danger hover:bg-ide-hover flex items-center justify-center transition-all"
                          title={t('Delete')}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}))

export default SessionPanel
