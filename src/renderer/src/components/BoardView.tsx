import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { KanbanSquare, X, Send, CornerDownLeft, ChevronDown, Filter, Check, Folder, ArrowUp, Merge, MousePointer2, SquareCheck } from 'lucide-react'
import type { SessionTab } from '../sessionRestore'
import type { WorktreeRecord, WorktreeRecordView } from '@shared/types'
import { useI18n } from '../i18n'
import { aiStore } from '../aiStore'
import { getDshApi } from '../dsh/history'
import { ChatMarkdown } from './AiTab'
import { SessionGlyph } from '../sessionIcon'

export const BOARD_FOCUS = 'board-focus'

const BOARD_DEFAULT_CMD_KEY = 'vibe-ide-board-default-cmd'
const BOARD_FILTER_KEY = 'vibe-ide-board-cwd-exclude'

function readDefaultCmd(): string {
  try {
    return localStorage.getItem(BOARD_DEFAULT_CMD_KEY)?.trim() || 'claude'
  } catch {
    return 'claude'
  }
}

// 纯横线装饰行渲染收缩为固定默认宽度，避免超长横向滚动
function shortenHrLines(text: string): string {
  return text.split('\n').map(line => line.replace(/^\s*([─═━]+)\s*$/, (_, s: string) => s.slice(0, 74))).join('\n')
}

// 截断规则：按正则解析（m 多行模式，取最后一个匹配处截断；^ 匹配每行行首），正则非法则退化为字面量字符串匹配
function truncateReply(text: string, marker: string): string | null {
  const src = text || ''
  if (!marker) return src || null
  let idx = -1
  try {
    const re = new RegExp(marker, 'gm')
    let m: RegExpExecArray | null
    let lastIdx = -1
    while ((m = re.exec(src))) {
      lastIdx = m.index
      if (m[0].length === 0) re.lastIndex++
    }
    idx = lastIdx
  } catch {
    idx = src.lastIndexOf(marker)
  }
  if (idx < 0) return src || null
  return src.slice(0, idx)
}

type CardStatus = 'running' | 'idle' | 'warn'

export interface BoardCreateResult {
  ok: boolean
  record?: WorktreeRecord
  error?: string
}

interface BoardViewProps {
  workspacePath: string | null
  sessions: SessionTab[]
  agentStatus: Record<string, 'running' | 'idle' | 'warn'>
  activeSessionId: string | null
  sessionWorktreeNav?: Record<string, { originalPath: string; worktreePath: string; originalBranch: string }>
  onCreateRecord: (title: string, launchCommand?: string, cwd?: string | null) => Promise<BoardCreateResult>
  onFocusSession: (sessionId: string) => void
  onCloseSession: (sessionId: string) => void
  onOpenRecord: (record: WorktreeRecord) => Promise<void> | void
  onExecuteFinish: (record: WorktreeRecord) => Promise<boolean>
  onClearRecord: (record: WorktreeRecord) => Promise<void>
  onMergeRecord: (record: WorktreeRecord) => Promise<import('@shared/types').BoardMergeResult>
  onMergeAbort: (record: WorktreeRecord) => Promise<import('@shared/types').BoardOpResult>
  onSendToSession: (sessionId: string, text: string) => void
  onAcknowledgeWarn: (sessionId: string) => void
  onCreatePlainSession: (cwd: string, launchCommand?: string) => Promise<{ id: string } | null>
  onReadSessionTail: (sessionId: string, maxLines?: number) => string[]
}

function statusOf(s: SessionTab, agentStatus: Record<string, 'running' | 'idle' | 'warn'>): CardStatus {
  return agentStatus[s.id] ?? 'idle'
}

function stripTaskMark(name: string): string {
  return name.replace(/^\s*▶\s*/, '')
}

function pathTail(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

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

interface LiveCard {
  session: SessionTab
  status: CardStatus
}

const FINISH_BTN_CLS =
  'px-1.5 py-0.5 rounded text-[10px] text-ide-text-muted hover:text-ide-danger hover:border-ide-danger/50 border border-transparent transition-colors shrink-0'

const MERGE_BTN_CLS =
  'px-1.5 py-0.5 rounded text-[10px] text-ide-text-muted hover:text-ide-success hover:border-ide-success/50 border border-transparent transition-colors shrink-0'

type MergePhase = 'idle' | 'running' | 'success' | 'conflict' | 'error'

const REPLY_W = 640
const REPLY_H = 560

interface ReplyBox {
  left: number
  top: number
  width: number
  height: number
}

// 宠物式弹出:横向朝屏幕边缘的反方向(卡在右半屏→往左弹,左半屏→往右弹),
// 纵向夹紧在视口内;放不下时退化为贴边居中。宽度方向优先保证不遮右键的那张卡。
function computeReplyBox(cardRect: DOMRect): ReplyBox {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 8
  const width = Math.min(REPLY_W, vw - margin * 2)
  const height = Math.min(REPLY_H, Math.max(280, vh - margin * 2))
  const centerX = cardRect.left + cardRect.width / 2
  let left = centerX >= vw / 2 ? cardRect.left - width - margin : cardRect.right + margin
  if (left < margin) left = cardRect.right + margin
  if (left + width > vw - margin) left = Math.max(margin, vw - width - margin)
  let top = cardRect.top
  if (top + height > vh - margin) top = vh - height - margin
  if (top < margin) top = margin
  return { left, top, width, height }
}

interface LiveCardProps {
  card: LiveCard
  active: boolean
  finishable: WorktreeRecord | null
  finishLabel: string
  mergeLabel: string
  selectable: boolean
  selectMode: boolean
  selected: boolean
  worktreeNav?: { worktreePath: string } | null
  onReply: (e: ReactMouseEvent | React.KeyboardEvent<HTMLDivElement>) => void
  onFinish: (record: WorktreeRecord) => void
  onMerge: (record: WorktreeRecord) => void
  onToggleSelect: () => void
  onContextMenu: (e: ReactMouseEvent) => void
}

function LiveCardView({ card, active, finishable, finishLabel, mergeLabel, selectable, selectMode, selected, worktreeNav, onReply, onFinish, onMerge, onToggleSelect, onContextMenu }: LiveCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={selectable ? onToggleSelect : (selectMode ? undefined : onReply)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        if (selectable) onToggleSelect()
        else if (!selectMode) onReply(e)
      }}
      onContextMenu={(e) => {
        if (selectable) {
          e.preventDefault()
          onToggleSelect()
          return
        }
        onContextMenu(e)
      }}
      className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors select-none ${
        selected
          ? 'border-ide-accent bg-ide-accent/10 cursor-pointer'
          : selectable
            ? 'bg-ide-sidebar hover:bg-ide-hover hover:border-ide-accent/60 cursor-pointer'
            : `bg-ide-sidebar hover:bg-ide-hover cursor-pointer ${active ? 'border-ide-accent/60' : 'border-ide-border hover:border-ide-accent/50'}`
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <SessionGlyph
          session={card.session}
          status={card.status}
          worktreeNav={worktreeNav}
        />
        <span className="text-xs text-ide-text truncate flex-1">{stripTaskMark(card.session.name)}</span>
      </div>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] text-ide-text-muted truncate flex-1" title={card.session.cwd}>
          {pathTail(card.session.cwd)}
        </span>
        {finishable && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMerge(finishable)
            }}
            title={mergeLabel}
            className={MERGE_BTN_CLS}
          >
            {mergeLabel.slice(0, 2)}
          </button>
        )}
        {finishable && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFinish(finishable)
            }}
            title={finishLabel}
            className={FINISH_BTN_CLS}
          >
            {finishLabel.slice(0, 2)}
          </button>
        )}
      </div>
    </div>
  )
}

interface PlanCardProps {
  record: WorktreeRecordView
  busy: boolean
  openLabel: string
  doneLabel: string
  mergeLabel: string
  clearLabel: string
  clearTitle: string
  finishTitle: string
  mergeTitle: string
  onOpen: () => void
  onFinish: () => void
  onMerge: () => void
  onClear: () => void
}

function PlanCardView({ record, busy, openLabel, doneLabel, mergeLabel, clearLabel, clearTitle, finishTitle, mergeTitle, onOpen, onFinish, onMerge, onClear }: PlanCardProps) {
  return (
    <div
      className={`w-full px-2.5 py-2 rounded-lg border bg-ide-sidebar hover:bg-ide-hover transition-colors ${
        record.orphan ? 'border-dashed opacity-60' : 'border-ide-border'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0" role="button" tabIndex={0} onClick={() => !record.orphan && onOpen()} onKeyDown={(e) => { if (e.key === 'Enter' && !record.orphan) onOpen() }}>
        <span className="text-xs text-ide-text truncate flex-1 cursor-pointer" title={record.title}>
          {record.orphan ? '⚠ ' : ''}{record.title}
        </span>
        {record.orphan ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            disabled={busy}
            title={clearTitle}
            className={`${FINISH_BTN_CLS} hover:text-ide-text-muted hover:border-ide-border`}
          >
            {clearLabel}
          </button>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
              disabled={busy}
              className="px-1.5 py-0.5 rounded text-[10px] text-ide-text-muted hover:text-ide-accent hover:border-ide-accent/50 border border-transparent transition-colors shrink-0"
            >
              {openLabel}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onMerge()
              }}
              disabled={busy}
              title={mergeTitle}
              className={MERGE_BTN_CLS}
            >
              {mergeLabel.slice(0, 2)}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onFinish()
              }}
              disabled={busy}
              title={finishTitle}
              className={FINISH_BTN_CLS}
            >
              {doneLabel}
            </button>
          </>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-ide-text-muted truncate flex-1">{record.branchName}</span>
        {record.launchCommand && (
          <span className="text-[10px] text-ide-text-muted/60 truncate max-w-[45%]" title={record.launchCommand}>
            $ {record.launchCommand}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[10px] text-ide-text-muted/60 truncate" title={record.repoRoot}>
        {midTruncatePath(record.repoRoot)}
      </div>
    </div>
  )
}

export default function BoardView({
  workspacePath,
  sessions,
  agentStatus,
  activeSessionId,
  sessionWorktreeNav,
  onCreateRecord,
  onFocusSession,
  onCloseSession,
  onOpenRecord,
  onExecuteFinish,
  onClearRecord,
  onMergeRecord,
  onMergeAbort,
  onSendToSession,
  onAcknowledgeWarn,
  onCreatePlainSession,
  onReadSessionTail
}: BoardViewProps) {
  const { t } = useI18n()
  const [records, setRecords] = useState<WorktreeRecordView[]>([])
  const [repoRoot, setRepoRoot] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [creatingPlain, setCreatingPlain] = useState(false)
  const [finishTarget, setFinishTarget] = useState<WorktreeRecord | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState<WorktreeRecord | null>(null)
  const [mergePhase, setMergePhase] = useState<MergePhase>('idle')
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeInfo, setMergeInfo] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ session: SessionTab; x: number; y: number; cardRect: DOMRect } | null>(null)
  const [replyFor, setReplyFor] = useState<SessionTab | null>(null)
  const [replyBox, setReplyBox] = useState<ReplyBox | null>(null)
  const [replyText, setReplyText] = useState<string | null>(null)
  const [replyLoading, setReplyLoading] = useState(false)
  const [tailDepth, setTailDepth] = useState(60)
  const [showLoadMore, setShowLoadMore] = useState(true)
  const [tailEnded, setTailEnded] = useState(false)
  const [truncate, setTruncate] = useState('✻')
  const [multiSelect, setMultiSelect] = useState(false)
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set())
  const [multiDraft, setMultiDraft] = useState('')

  const loadTailMore = useCallback((s: SessionTab) => {
    const next = tailDepth + 60
    setTailDepth(next)
    const lines = onReadSessionTail(s.id, next)
    setTailEnded(lines.length < next)
    setReplyText(shortenHrLines(truncateReply(lines.join('\n').slice(-12000), truncate)))
  }, [onReadSessionTail, tailDepth, truncate])
  const [draft, setDraft] = useState('')
  const [defaultCmd, setDefaultCmd] = useState(readDefaultCmd)
  const [defaultCmdDraft, setDefaultCmdDraft] = useState(defaultCmd)
  const [excludedCwds, setExcludedCwds] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(BOARD_FILTER_KEY) || '[]')
      return Array.isArray(v) ? v.filter((x: any) => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const toggleExcludeCwd = useCallback((cwd: string) => {
    setExcludedCwds(prev => {
      const next = prev.includes(cwd) ? prev.filter(c => c !== cwd) : [...prev, cwd]
      try { localStorage.setItem(BOARD_FILTER_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])
  const clearExcludedCwds = useCallback(() => {
    setExcludedCwds([])
    try { localStorage.setItem(BOARD_FILTER_KEY, '[]') } catch {}
  }, [])
  const [cwdMenu, setCwdMenu] = useState<{ x: number; y: number } | null>(null)
  const [createCwd, setCreateCwd] = useState<string | null>(workspacePath)
  const [createDirMenu, setCreateDirMenu] = useState<{ x: number; y: number } | null>(null)
  const createCwdManualRef = useRef(false)

  useEffect(() => {
    if (!createCwdManualRef.current) setCreateCwd(workspacePath)
  }, [workspacePath])

  const reload = useCallback(async () => {
    // 每次只查「当前 workspace + 现存 session 的 cwd」，不再累积历史 repoRoot：
    // 切走的仓库不该把它的卡片混进本仓库的 plan
    const cwds = new Set<string>()
    if (workspacePath) cwds.add(workspacePath)
    for (const s of sessions) if (s.cwd) cwds.add(s.cwd)
    if (cwds.size === 0) {
      setRepoRoot(null)
      setRecords([])
      return
    }
    try {
      const repoMap = new Map<string, WorktreeRecordView[]>()
      for (const cwd of cwds) {
        const res = await window.api.board.records(cwd)
        if (res.repoRoot && !repoMap.has(res.repoRoot)) {
          repoMap.set(res.repoRoot, res.records)
        }
      }
      setRepoRoot([...repoMap.keys()][0] ?? null)
      setRecords([...repoMap.values()].flat())
    } catch {
      setRepoRoot(null)
      setRecords([])
    }
  }, [workspacePath, sessions])

  useEffect(() => {
    void reload()
  }, [reload])

  const closeOverlays = useCallback(() => {
    setFinishTarget(null)
    setFinishError(null)
  }, [])

  const openMerge = useCallback((rec: WorktreeRecord) => {
    setMergeTarget(rec)
    setMergePhase('idle')
    setMergeInfo('')
  }, [])

  const closeMerge = useCallback(() => {
    setMergeTarget(null)
    setMergeInfo('')
  }, [])

  const confirmMerge = useCallback(async () => {
    if (!mergeTarget || mergeBusy) return
    setMergeBusy(true)
    setMergePhase('running')
    setMergeInfo('')
    try {
      const res = await onMergeRecord(mergeTarget)
      if (res?.ok) {
        setMergePhase('success')
      } else if (res?.conflict) {
        setMergePhase('conflict')
        setMergeInfo(res.message ?? '')
      } else {
        setMergePhase('error')
        setMergeInfo(res?.error ?? '合并失败')
      }
    } catch (e: any) {
      setMergePhase('error')
      setMergeInfo(e?.message ?? '合并失败')
    } finally {
      setMergeBusy(false)
    }
  }, [mergeTarget, mergeBusy, onMergeRecord])

  const abortMerge = useCallback(async () => {
    if (!mergeTarget || mergeBusy) return
    setMergeBusy(true)
    try {
      const res = await onMergeAbort(mergeTarget)
      if (res?.error) {
        setMergePhase('error')
        setMergeInfo(res.error)
      } else {
        closeMerge()
      }
    } catch (e: any) {
      setMergePhase('error')
      setMergeInfo(e?.message ?? '中止合并失败')
    } finally {
      setMergeBusy(false)
    }
  }, [mergeTarget, mergeBusy, onMergeAbort, closeMerge])

  const exitMultiSelect = useCallback(() => {
    setMultiSelect(false)
    setMultiSelected(new Set())
    setMultiDraft('')
  }, [])

  const enterMultiSelect = useCallback(() => {
    setMultiSelect(true)
    setMultiSelected(new Set())
    setMultiDraft('')
    setReplyFor(null)
    setReplyBox(null)
    setReplyText(null)
    setDraft('')
  }, [])

  const toggleMultiSelect = useCallback((id: string) => {
    setMultiSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const sendMulti = useCallback(() => {
    const text = multiDraft.trim()
    if (!text || multiSelected.size === 0) return
    for (const id of multiSelected) onSendToSession(id, text)
    setMultiDraft('')
  }, [multiDraft, multiSelected, onSendToSession])

  const closeReply = useCallback(() => {
    const sid = replyFor?.id
    setReplyFor(null)
    setReplyBox(null)
    setReplyText(null)
    setDraft('')
    if (sid) onAcknowledgeWarn(sid)
  }, [replyFor, onAcknowledgeWarn])

  const replyTextareaRef = useRef<HTMLTextAreaElement>(null)
  const replyScrollRef = useRef<HTMLDivElement>(null)
  const replyScrollInited = useRef(false)

  useEffect(() => {
    if (!replyFor) return
    replyScrollInited.current = false
  }, [replyFor])

  useEffect(() => {
    if (!replyFor || !replyText || replyScrollInited.current) return
    replyScrollInited.current = true
    const el = replyScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [replyText, replyFor])

  useEffect(() => {
    if (replyFor) replyTextareaRef.current?.focus()
  }, [replyFor])

  useEffect(() => {
    if (!replyFor) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-reply-box]')) return
      closeReply()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [replyFor, closeReply])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (cwdMenu) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setCwdMenu(null)
      } else if (createDirMenu) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setCreateDirMenu(null)
      } else if (ctxMenu) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setCtxMenu(null)
      } else if (replyFor) {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeReply()
      } else if (mergeTarget) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!mergeBusy && mergePhase !== 'running') closeMerge()
      } else if (finishTarget) {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeOverlays()
      } else if (multiSelect) {
        e.preventDefault()
        e.stopImmediatePropagation()
        exitMultiSelect()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [cwdMenu, createDirMenu, ctxMenu, replyFor, finishTarget, mergeTarget, mergeBusy, mergePhase, multiSelect, closeOverlays, closeReply, closeMerge, exitMultiSelect])

  const loadReply = useCallback(async (s: SessionTab) => {
    setReplyFor(s)
    setReplyLoading(true)
    setReplyText(null)
    setShowLoadMore(true)
    try {
      if (s.kind === 'gui') {
        const msgs = aiStore.getSessionState(s.id).messages ?? []
        let text: string | null = null
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
            text = m.content
            break
          }
        }
        if (!text) {
          const res = await window.api.ai.loadSessionMessages(s.id, s.cwd)
          const hist: any[] = res?.messages ?? []
          for (let i = hist.length - 1; i >= 0; i--) {
            const m = hist[i]
            if (m?.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
              text = m.content
              break
            }
          }
        }
        setReplyText(text)
        return
      }
      if (s.kind === 'terminal') {
        const lines = onReadSessionTail(s.id, 60)
        setTailEnded(lines.length < 60)
        setReplyText(shortenHrLines(truncateReply(lines.join('\n').slice(-12000), truncate)))
        return
      }
      if (s.kind === 'dsh') {
        const sid = s.dshSessionId || s.id
        const api = await getDshApi(s.cwd || undefined)
        const res = await api.sessions.history({ sessionId: sid, maxMessages: 3 })
        if (res.result?.ok) {
          const events = ((res.result.value?.events ?? []) as any[]).map((e: any) => e.event)
          for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i]
            if (ev?.type !== 'assistant/message') continue
            const msg = ev.data?.message
            const text = (msg?.content ?? [])
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('')
            if (text.trim()) {
              setReplyText(text)
              return
            }
          }
        }
        setReplyText(null)
        return
      }
      setReplyText(null)
    } catch {
      setReplyText(null)
    } finally {
      setReplyLoading(false)
    }
  }, [onReadSessionTail, truncate])

  const sendDraft = useCallback(() => {
    const text = draft.trim()
    if (!text || !replyFor) return
    onSendToSession(replyFor.id, text)
    setDraft('')
    closeReply()
  }, [draft, replyFor, onSendToSession, closeReply])

  const distinctCwds = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of sessions) {
      if (!s.cwd || seen.has(s.cwd)) continue
      seen.add(s.cwd)
      out.push(s.cwd)
    }
    return out
  }, [sessions])

  const createDirOptions = useMemo(() => {
    if (workspacePath && !distinctCwds.includes(workspacePath)) return [workspacePath, ...distinctCwds]
    return distinctCwds
  }, [workspacePath, distinctCwds])

  const recordById = new Map(records.map(r => [r.id, r]))
  const liveIds = new Set(sessions.map(s => s.id))
  const planCards = records.filter(r => !liveIds.has(r.id))

  const liveByStatus: Record<CardStatus, LiveCard[]> = { running: [], idle: [], warn: [] }
  for (const s of sessions) {
    if (excludedCwds.includes(s.cwd)) continue
    liveByStatus[statusOf(s, agentStatus)].push({ session: s, status: statusOf(s, agentStatus) })
  }

  const saveDefaultCmd = useCallback(() => {
    const v = defaultCmdDraft.trim() || 'claude'
    try {
      localStorage.setItem(BOARD_DEFAULT_CMD_KEY, v)
    } catch {}
    setDefaultCmd(v)
    setDefaultCmdDraft(v)
  }, [defaultCmdDraft])

  const openCwdMenu = useCallback((e: ReactMouseEvent) => {
    setCwdMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 200)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 260))
    })
  }, [])

  const openCreateDirMenu = useCallback((e: ReactMouseEvent) => {
    setCreateDirMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 200)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 260))
    })
  }, [])

  const pickCreateDir = useCallback((cwd: string) => {
    setCreateCwd(cwd)
    createCwdManualRef.current = true
    setCreateDirMenu(null)
  }, [])

  const quickCreate = useCallback(async () => {
    if (creating || !createCwd || !repoRoot) return
    setCreating(true)
    try {
      await onCreateRecord('', defaultCmd, createCwd)
      await reload()
    } finally {
      setCreating(false)
    }
  }, [creating, createCwd, repoRoot, onCreateRecord, reload, defaultCmd])

  const quickCreatePlain = useCallback(async () => {
    if (creatingPlain || !createCwd) return
    setCreatingPlain(true)
    try {
      await onCreatePlainSession(createCwd, defaultCmd)
    } finally {
      setCreatingPlain(false)
    }
  }, [creatingPlain, createCwd, defaultCmd, onCreatePlainSession])

  const confirmFinish = useCallback(async () => {
    if (!finishTarget || finishing) return
    setFinishing(true)
    setFinishError(null)
    try {
      const ok = await onExecuteFinish(finishTarget)
      if (ok) {
        setFinishTarget(null)
        await reload()
      } else {
        setFinishError(t('Cleanup failed (record kept, you can retry)'))
      }
    } finally {
      setFinishing(false)
    }
  }, [finishTarget, finishing, onExecuteFinish, reload, t])

  const clearOne = useCallback(async (rec: WorktreeRecordView) => {
    await onClearRecord(rec)
    await reload()
  }, [onClearRecord, reload])

  const openOne = useCallback(async (rec: WorktreeRecordView) => {
    await onOpenRecord(rec)
    await reload()
  }, [onOpenRecord, reload])

  const columns: { key: string; label: string; count: number }[] = [
    { key: 'plan', label: t('plan'), count: planCards.length },
    { key: 'running', label: t('running'), count: liveByStatus.running.length },
    { key: 'idle', label: t('idle'), count: liveByStatus.idle.length },
    { key: 'warn', label: t('warning'), count: liveByStatus.warn.length }
  ]

  const emptyHint: Record<string, string> = {
    plan: workspacePath
      ? repoRoot === null
        ? t('Not a git repo — worktree unavailable')
        : t('No worktree tasks yet')
      : t('No active workspace'),
    running: t('No running sessions'),
    idle: t('No idle sessions'),
    warn: t('No warning sessions')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-9 px-3 flex items-center justify-between border-b border-ide-border shrink-0 bg-ide-sidebar/50">
        <div className="flex items-center gap-1.5 min-w-0">
          <KanbanSquare size={13} className="text-ide-accent shrink-0" />
          <span className="text-xs font-medium text-ide-text">{t('Task Board')}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {repoRoot && createCwd && (
            <button
              onClick={(e) => openCreateDirMenu(e)}
              title={createCwd}
              className="px-1.5 py-0.5 rounded-full text-[10px] border flex items-center gap-1 max-w-[150px] text-ide-text-muted border-ide-border bg-ide-hover transition-colors hover:text-ide-text hover:border-ide-accent/50"
            >
              <Folder size={10} className="shrink-0" />
              <span className="truncate min-w-0">{pathTail(createCwd)}</span>
              <ChevronDown size={10} className="shrink-0 opacity-70" />
            </button>
          )}
          <button
            onClick={(e) => openCwdMenu(e)}
            title={t('Filter by directory')}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              excludedCwds.length ? 'text-ide-accent hover:bg-ide-accent/15' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
            }`}
          >
            <Filter size={15} className="shrink-0" />
          </button>
        </div>
      </div>
      {multiSelect && (
        <div className="shrink-0 border-b border-ide-border px-3 py-1.5 flex items-center gap-2 bg-ide-sidebar/50">
          <span className="text-[11px] text-ide-text-muted shrink-0">{t('Selected {n}').replace('{n}', String(multiSelected.size))}</span>
          <input
            value={multiDraft}
            onChange={e => setMultiDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault()
                sendMulti()
              }
            }}
            placeholder={t('Prompt text — Enter to send to all selected')}
            className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] bg-ide-panel border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
          />
          <button
            onClick={sendMulti}
            disabled={!multiDraft.trim() || multiSelected.size === 0}
            title={t('Send to all selected')}
            className="px-2 py-0.5 rounded text-[11px] text-ide-accent border border-ide-accent/50 hover:bg-ide-accent/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 shrink-0"
          >
            <Send size={10} className="-scale-x-100" />
            {t('Send')}
          </button>
          <button
            onClick={exitMultiSelect}
            title={t('Exit multi-select')}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      )}
      <div className="flex-1 flex min-h-0">
        {columns.map((col, ci) => (
          <div key={col.key} className={`flex-1 min-w-0 min-h-0 flex flex-col ${ci > 0 ? 'border-l border-ide-border' : ''}`}>
            <div className="h-7 px-3 flex items-center gap-1.5 border-b border-ide-border shrink-0">
              <span className="text-xs font-medium text-ide-text-muted">{col.label}</span>
              <span className="text-[10px] px-1 rounded-full bg-ide-hover text-ide-text-muted">{col.count}</span>
              {col.key === 'idle' && (
                <button
                  onClick={() => (multiSelect ? exitMultiSelect() : enterMultiSelect())}
                  title={multiSelect ? t('Exit multi-select') : t('Multi-select idle cards & send')}
                  className={`ml-auto w-6 h-6 flex items-center justify-center rounded transition-colors ${
                    multiSelect ? 'text-ide-accent hover:bg-ide-accent/15' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
                  }`}
                >
                  {multiSelect ? <SquareCheck size={13} className="shrink-0" /> : <MousePointer2 size={13} className="shrink-0" />}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {col.key === 'plan' && (
                <>
                  {!workspacePath || repoRoot === null ? (
                    <div className="py-6 text-center text-[11px] text-ide-text-muted px-2">{emptyHint.plan}</div>
                  ) : null}
                  {planCards.map(r => (
                    <PlanCardView
                      key={r.id}
                      record={r}
                      busy={finishing || creating || mergeBusy}
                      openLabel={t('Open')}
                      doneLabel={t('Done')}
                      mergeLabel={t('Merge into main branch')}
                      clearLabel={t('Clear')}
                      clearTitle={t('Record only (directory gone)')}
                      finishTitle={t('Finish & clean worktree / branch')}
                      mergeTitle={t('Merge branch into the main branch')}
                      onOpen={() => void openOne(r)}
                      onFinish={() => {
                        setFinishError(null)
                        setFinishTarget(r)
                      }}
                      onMerge={() => openMerge(r)}
                      onClear={() => void clearOne(r)}
                    />
                  ))}
                  {planCards.length === 0 && workspacePath && repoRoot && (
                    <div className="py-4 text-center text-[11px] text-ide-text-muted/50">{t('No worktree tasks yet')}</div>
                  )}
                  <button
                    onClick={() => void quickCreate()}
                    disabled={!createCwd || !repoRoot || creating}
                    title={!createCwd ? t('No active workspace') : repoRoot === null ? t('Not a git repo — worktree unavailable') : t('New worktree session')}
                    className="w-full py-1.5 rounded-lg border border-dashed border-ide-border text-[11px] text-ide-text-muted hover:text-ide-accent hover:border-ide-accent/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {creating ? t('Creating...') : `+ ${t('New worktree session')}`}
                  </button>
                  <button
                    onClick={() => void quickCreatePlain()}
                    disabled={!createCwd || creatingPlain}
                    title={!createCwd ? t('No active workspace') : t('New terminal session')}
                    className="w-full py-1.5 rounded-lg border border-dashed border-ide-border text-[11px] text-ide-text-muted hover:text-ide-accent hover:border-ide-accent/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {creatingPlain ? t('Creating...') : `+ ${t('New terminal')}`}
                  </button>
                </>
              )}
              {col.key !== 'plan' &&
                (liveByStatus[col.key as CardStatus].length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-ide-text-muted/50 px-2">{emptyHint[col.key]}</div>
                ) : (
                  liveByStatus[col.key as CardStatus].map(card => (
                    <LiveCardView
                      key={card.session.id}
                      card={card}
                      active={card.session.id === activeSessionId}
                      finishable={recordById.get(card.session.id) ?? null}
                      finishLabel={t('Finish & clean worktree / branch')}
                      mergeLabel={t('Merge into main branch')}
                      selectable={multiSelect && col.key === 'idle'}
                      selectMode={multiSelect}
                      selected={multiSelected.has(card.session.id)}
                      worktreeNav={sessionWorktreeNav?.[card.session.id] ?? null}
                      onReply={(e) => {
                        setReplyBox(computeReplyBox((e.currentTarget as HTMLElement).getBoundingClientRect()))
                        void loadReply(card.session)
                      }}
                      onFinish={setFinishTarget}
                      onMerge={openMerge}
                      onToggleSelect={() => toggleMultiSelect(card.session.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCtxMenu({
                          session: card.session,
                          x: Math.min(e.clientX, window.innerWidth - 190),
                          y: Math.min(e.clientY, window.innerHeight - 70),
                          cardRect: (e.currentTarget as HTMLElement).getBoundingClientRect()
                        })
                      }}
                    />
                  ))
                ))}
            </div>
            {col.key === 'plan' && (
              <div className="shrink-0 border-t border-ide-border px-2 py-1.5 flex flex-col gap-1.5 bg-ide-sidebar/50">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-ide-text-muted shrink-0">{t('Default launch')}</span>
                  <input
                    value={defaultCmdDraft}
                    onChange={e => setDefaultCmdDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    onBlur={saveDefaultCmd}
                    placeholder="claude"
                    title={t('Prefilled when creating a task')}
                    className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] font-mono bg-ide-panel border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-ide-text-muted shrink-0">{t('Truncate')}</span>
                  <input
                    value={truncate}
                    onChange={(e) => {
                      setTruncate(e.target.value)
                    }}
                    placeholder="✻"
                    maxLength={16}
                    title={t('Hide chars after this marker (claude status bar). Empty to disable.')}
                    className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] font-mono bg-ide-panel border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-[64]"
            onMouseDown={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtxMenu(null)
            }}
          />
          <div
            className="fixed z-[65] bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[170px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover flex items-center gap-2 transition-colors"
              onClick={() => {
                const id = ctxMenu.session.id
                setCtxMenu(null)
                onFocusSession(id)
              }}
            >
              <CornerDownLeft size={12} className="text-ide-text-muted shrink-0" />
              {t('Switch to session')}
            </button>
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-ide-text hover:bg-ide-hover flex items-center gap-2 transition-colors"
              onClick={() => {
                const id = ctxMenu.session.id
                setCtxMenu(null)
                onCloseSession(id)
              }}
            >
              <X size={12} className="text-ide-text-muted shrink-0" />
              {t('Close')}
            </button>
          </div>
        </>
      )}

      {cwdMenu && (
        <>
          <div
            className="fixed inset-0 z-[64]"
            onMouseDown={() => setCwdMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCwdMenu(null)
            }}
          />
          <div
            className="fixed z-[65] bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[200px] max-w-[300px] max-h-[60vh] overflow-y-auto"
            style={{ left: cwdMenu.x, top: cwdMenu.y }}
          >
            <button
              onClick={() => {
                clearExcludedCwds()
                setCwdMenu(null)
              }}
              className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors ${excludedCwds.length === 0 ? 'text-ide-accent' : 'text-ide-text hover:bg-ide-hover'}`}
            >
              <span className="w-3.5 shrink-0">{excludedCwds.length === 0 && <Check size={11} />}</span>
              <span className="truncate">{t('All')}</span>
            </button>
            {distinctCwds.length > 0 && <div className="border-t border-ide-border my-1" />}
            {distinctCwds.map(cwd => (
              <div
                key={cwd}
                title={cwd}
                onClick={() => toggleExcludeCwd(cwd)}
                className={`w-full px-3 py-1.5 text-left text-xs cursor-pointer hover:bg-ide-hover transition-colors flex items-center gap-2 ${excludedCwds.includes(cwd) ? 'text-ide-text-muted' : 'text-ide-text'}`}
              >
                <input
                  type="checkbox"
                  checked={!excludedCwds.includes(cwd)}
                  readOnly
                  onChange={() => {}}
                  className="accent-ide-accent shrink-0 pointer-events-none"
                />
                <span className="truncate font-mono">{pathTail(cwd)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {createDirMenu && (
        <>
          <div
            className="fixed inset-0 z-[64]"
            onMouseDown={() => setCreateDirMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCreateDirMenu(null)
            }}
          />
          <div
            className="fixed z-[65] bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[180px] max-w-[280px] max-h-[60vh] overflow-y-auto"
            style={{ left: createDirMenu.x, top: createDirMenu.y }}
          >
            {createDirOptions.map(cwd => (
              <button
                key={cwd}
                title={cwd}
                onClick={() => pickCreateDir(cwd)}
                className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors ${createCwd === cwd ? 'text-ide-accent' : 'text-ide-text hover:bg-ide-hover'}`}
              >
                <span className="w-3.5 shrink-0">{createCwd === cwd && <Check size={11} />}</span>
                <span className="truncate font-mono">{pathTail(cwd)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {replyFor && replyBox && (
        <div
          data-reply-box
          className="fixed z-[66] flex flex-col rounded-xl border border-ide-border bg-ide-sidebar shadow-2xl overflow-hidden"
          style={{ left: replyBox.left, top: replyBox.top, width: replyBox.width, height: replyBox.height }}
        >
          <div
            role="button"
            onClick={() => {
              closeReply()
              onFocusSession(replyFor.id)
            }}
            title={t('Switch to session')}
            className="group h-9 px-3 flex items-center gap-1.5 border-b border-ide-border shrink-0 cursor-pointer hover:bg-ide-hover transition-colors"
          >
            <SessionGlyph
              session={replyFor}
              status={statusOf(replyFor, agentStatus)}
              worktreeNav={sessionWorktreeNav?.[replyFor.id] ?? null}
            />
            <span className="text-xs text-ide-text truncate flex-1" title={replyFor.name}>{stripTaskMark(replyFor.name)}</span>
            <CornerDownLeft size={13} className="shrink-0 text-ide-text-muted group-hover:text-ide-accent transition-colors" />
          </div>
          {replyFor.kind === 'terminal' && showLoadMore && !tailEnded && (
            <div className="shrink-0 px-3 pt-1.5 flex justify-center">
              <button
                onClick={() => loadTailMore(replyFor)}
                title={t('Load earlier terminal output')}
                className="flex items-center gap-1.5 text-xs text-ide-text-muted hover:text-ide-text px-2.5 py-1 rounded hover:bg-ide-hover transition-colors"
              >
                <ArrowUp size={12} />
                {t('Load more')}
              </button>
            </div>
          )}
          <div
            ref={replyScrollRef}
            className="flex-1 overflow-y-auto p-3 min-h-0 board-reply-scroll"
            onScroll={(e) => setShowLoadMore(e.currentTarget.scrollTop <= 0)}
          >
            {replyLoading ? (
              <div className="text-xs text-ide-text-muted animate-pulse">{t('Searching...')}</div>
            ) : replyText ? (
              <ChatMarkdown
                text={replyText}
                workspacePath={null}
                className={replyFor.kind === 'terminal' ? 'board-reply-md' : ''}
              />
            ) : (
              <div className="text-xs text-ide-text-muted/60">{t('No reply yet')}</div>
            )}
          </div>
          <div className="border-t border-ide-border p-2 shrink-0">
            <div className="relative">
              <textarea
                ref={replyTextareaRef}
                rows={2}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault()
                    sendDraft()
                  }
                }}
                placeholder={t('Type a message, Enter to send')}
                className="block w-full resize-none px-2 py-1.5 pr-14 text-xs bg-ide-panel border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
              />
              <button
                onClick={sendDraft}
                disabled={!draft.trim()}
                title={t('Send')}
                className="absolute right-1 bottom-1 px-2 py-1 rounded text-[11px] text-ide-accent border border-ide-accent/50 hover:bg-ide-accent/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Send size={10} className="-scale-x-100" />
                {t('Send')}
              </button>
            </div>
          </div>
        </div>
      )}

      {finishTarget && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center"
          onMouseDown={() => {
            if (!finishing) setFinishTarget(null)
          }}
        >
          <div
            className="bg-ide-sidebar border border-ide-border rounded-xl p-4 w-[380px] mx-4 shadow-2xl space-y-3"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <KanbanSquare size={14} className="text-ide-danger shrink-0" />
              <span className="text-sm text-ide-text font-medium truncate">{t('Finish & clean worktree / branch')} · {finishTarget.title}</span>
            </div>
            <div className="text-xs text-ide-text-muted leading-relaxed">
              {t('Will close its terminal and delete this worktree and branch. Unmerged changes are lost.')}{' '}
              (<span className="font-mono">{finishTarget.branchName}</span>)
            </div>
            {finishError && <div className="text-[11px] text-ide-danger">{finishError}</div>}
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => {
                  if (!finishing) setFinishTarget(null)
                }}
                className="px-3 py-1.5 rounded-md text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={() => void confirmFinish()}
                disabled={finishing}
                className="px-3 py-1.5 rounded-md text-xs text-ide-danger bg-ide-danger/15 border border-ide-danger/40 hover:bg-ide-danger/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {finishing ? t('Cleaning up...') : t('Confirm cleanup')}
              </button>
            </div>
          </div>
        </div>
      )}

      {mergeTarget && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center"
          onMouseDown={() => {
            if (!mergeBusy) closeMerge()
          }}
        >
          <div
            className="bg-ide-sidebar border border-ide-border rounded-xl p-4 w-[420px] mx-4 shadow-2xl space-y-3"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <Merge size={14} className="text-ide-success shrink-0" />
              <span className="text-sm text-ide-text font-medium truncate">{t('Merge into main branch')} · {mergeTarget.title}</span>
            </div>
            {(mergePhase === 'idle' || mergePhase === 'running') && (
              <div className="text-xs text-ide-text-muted leading-relaxed">
                {t('Will merge {branch} into {base}. The worktree and branch are kept; uncommitted worktree changes are not merged.')
                  .replace('{branch}', mergeTarget.branchName)
                  .replace('{base}', mergeTarget.baseBranch)}
              </div>
            )}
            {mergePhase === 'success' && (
              <div className="text-xs text-ide-success leading-relaxed">
                {t('Merged into {base}').replace('{base}', mergeTarget.baseBranch)}
              </div>
            )}
            {(mergePhase === 'conflict' || mergePhase === 'error') && (
              <>
                <div className="text-xs text-ide-danger">
                  {mergePhase === 'conflict'
                    ? t('Conflicts detected while merging {branch}').replace('{branch}', mergeTarget.branchName)
                    : t('Merge failed')}
                </div>
                {mergeInfo && (
                  <div className="text-[11px] font-mono text-ide-text-muted max-h-24 overflow-y-auto whitespace-pre-wrap">
                    {mergeInfo.slice(0, 600)}
                  </div>
                )}
                {mergePhase === 'conflict' && (
                  <div className="text-[11px] text-ide-text-muted leading-relaxed">
                    {t('Conflict state is kept in the main workspace. Resolve conflicts in the Git tab, or abort the merge. The worktree and branch are kept.')}
                  </div>
                )}
              </>
            )}
            <div className="flex gap-2 justify-end pt-1">
              {mergePhase === 'idle' && (
                <>
                  <button
                    onClick={closeMerge}
                    disabled={mergeBusy}
                    className="px-3 py-1.5 rounded-md text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40"
                  >
                    {t('Cancel')}
                  </button>
                  <button
                    onClick={() => void confirmMerge()}
                    disabled={mergeBusy}
                    className="px-3 py-1.5 rounded-md text-xs text-ide-success bg-ide-success/15 border border-ide-success/40 hover:bg-ide-success/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {mergeBusy ? t('Merging...') : t('Merge Now')}
                  </button>
                </>
              )}
              {mergePhase === 'running' && (
                <button
                  disabled={mergeBusy}
                  className="px-3 py-1.5 rounded-md text-xs text-ide-success bg-ide-success/15 border border-ide-success/40 transition-colors disabled:opacity-40 cursor-not-allowed"
                >
                  {t('Merging...')}
                </button>
              )}
              {mergePhase === 'success' && (
                <button
                  onClick={closeMerge}
                  className="px-3 py-1.5 rounded-md text-xs text-ide-success bg-ide-success/15 border border-ide-success/40 hover:bg-ide-success/25 transition-colors"
                >
                  {t('Done')}
                </button>
              )}
              {mergePhase === 'conflict' && (
                <>
                  <button
                    onClick={() => void abortMerge()}
                    disabled={mergeBusy}
                    className="px-3 py-1.5 rounded-md text-xs text-ide-text-muted hover:text-ide-danger hover:bg-ide-danger/10 transition-colors disabled:opacity-40"
                  >
                    {mergeBusy ? t('Merging...') : t('Abort Merge')}
                  </button>
                  <button
                    onClick={closeMerge}
                    className="px-3 py-1.5 rounded-md text-xs text-ide-accent bg-ide-accent/15 border border-ide-accent/40 hover:bg-ide-accent/25 transition-colors"
                  >
                    {t('Keep Conflicts')}
                  </button>
                </>
              )}
              {mergePhase === 'error' && (
                <button
                  onClick={closeMerge}
                  className="px-3 py-1.5 rounded-md text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                >
                  {t('Close')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
