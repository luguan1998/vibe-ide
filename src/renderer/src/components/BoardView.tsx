import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { KanbanSquare, X, Send, BookOpenText } from 'lucide-react'
import type { SessionTab } from '../sessionRestore'
import type { WorktreeRecord, WorktreeRecordView } from '@shared/types'
import { useI18n } from '../i18n'
import { aiStore } from '../aiStore'
import { getDshApi } from '../dsh/history'
import { ChatMarkdown } from './AiTab'

export const BOARD_FOCUS = 'board-focus'

const BOARD_DEFAULT_CMD_KEY = 'vibe-ide-board-default-cmd'

function readDefaultCmd(): string {
  try {
    return localStorage.getItem(BOARD_DEFAULT_CMD_KEY)?.trim() || 'claude'
  } catch {
    return 'claude'
  }
}

type CardStatus = 'running' | 'idle' | 'warning'
type SourceKind = SessionTab['kind']

const SOURCE_LABEL: Record<SourceKind, string> = {
  terminal: 'term',
  gui: 'aitab',
  dsh: 'dsh'
}

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
  onCreateRecord: (title: string, launchCommand?: string) => Promise<BoardCreateResult>
  onFocusSession: (sessionId: string) => void
  onOpenRecord: (record: WorktreeRecord) => Promise<void> | void
  onExecuteFinish: (record: WorktreeRecord) => Promise<boolean>
  onClearRecord: (record: WorktreeRecord) => Promise<void>
  onSendToSession: (sessionId: string, text: string) => void
  onAcknowledgeWarn: (sessionId: string) => void
}

function statusOf(s: SessionTab, agentStatus: Record<string, 'running' | 'idle' | 'warn'>): CardStatus {
  const st = agentStatus[s.id]
  if (st === 'running') return 'running'
  if (st === 'warn') return 'warning'
  return 'idle'
}

function pathTail(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

interface LiveCard {
  session: SessionTab
  status: CardStatus
}

function StatusDot({ status }: { status: CardStatus }) {
  const cls =
    status === 'running'
      ? 'bg-ide-accent animate-pulse'
      : status === 'warning'
        ? 'bg-ide-warning'
        : 'bg-ide-border'
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />
}

function SourceBadge({ kind }: { kind: SourceKind }) {
  const cls =
    kind === 'gui'
      ? 'text-ide-accent border-ide-accent/40'
      : kind === 'dsh'
        ? 'text-ide-success border-ide-success/40'
        : 'text-ide-text-muted border-ide-border'
  return (
    <span className={`px-1 py-0.5 rounded border text-[10px] leading-none shrink-0 ${cls}`}>
      {SOURCE_LABEL[kind]}
    </span>
  )
}

const FINISH_BTN_CLS =
  'px-1.5 py-0.5 rounded text-[10px] text-ide-text-muted hover:text-ide-danger hover:border-ide-danger/50 border border-transparent transition-colors shrink-0'

const REPLY_W = 460

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
  const height = Math.min(460, Math.max(280, vh - margin * 2))
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
  onFocus: () => void
  onFinish: (record: WorktreeRecord) => void
  onContextMenu: (e: ReactMouseEvent) => void
}

function LiveCardView({ card, active, finishable, finishLabel, onFocus, onFinish, onContextMenu }: LiveCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onFocus()
      }}
      onContextMenu={onContextMenu}
      className={`w-full text-left px-2.5 py-2 rounded-lg border bg-ide-sidebar hover:bg-ide-hover transition-colors cursor-pointer select-none ${
        active ? 'border-ide-accent/60' : 'border-ide-border hover:border-ide-accent/50'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={card.status} />
        <span className="text-xs text-ide-text truncate flex-1">{card.session.name}</span>
        <SourceBadge kind={card.session.kind} />
      </div>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] text-ide-text-muted truncate flex-1" title={card.session.cwd}>
          {pathTail(card.session.cwd)}
        </span>
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
  clearLabel: string
  clearTitle: string
  finishTitle: string
  onOpen: () => void
  onFinish: () => void
  onClear: () => void
}

function PlanCardView({ record, busy, openLabel, doneLabel, clearLabel, clearTitle, finishTitle, onOpen, onFinish, onClear }: PlanCardProps) {
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
    </div>
  )
}

export default function BoardView({
  workspacePath,
  sessions,
  agentStatus,
  activeSessionId,
  onCreateRecord,
  onFocusSession,
  onOpenRecord,
  onExecuteFinish,
  onClearRecord,
  onSendToSession,
  onAcknowledgeWarn
}: BoardViewProps) {
  const { t } = useI18n()
  const [records, setRecords] = useState<WorktreeRecordView[]>([])
  const [repoRoot, setRepoRoot] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [finishTarget, setFinishTarget] = useState<WorktreeRecord | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ session: SessionTab; x: number; y: number; cardRect: DOMRect } | null>(null)
  const [replyFor, setReplyFor] = useState<SessionTab | null>(null)
  const [replyBox, setReplyBox] = useState<ReplyBox | null>(null)
  const [replyText, setReplyText] = useState<string | null>(null)
  const [replyLoading, setReplyLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [defaultCmd, setDefaultCmd] = useState(readDefaultCmd)
  const [defaultCmdDraft, setDefaultCmdDraft] = useState(defaultCmd)

  const reload = useCallback(async () => {
    if (!workspacePath) {
      setRepoRoot(null)
      setRecords([])
      return
    }
    try {
      const res = await window.api.board.records(workspacePath)
      setRepoRoot(res.repoRoot)
      setRecords(res.records)
    } catch {
      setRepoRoot(null)
      setRecords([])
    }
  }, [workspacePath])

  useEffect(() => {
    void reload()
  }, [reload])

  const closeOverlays = useCallback(() => {
    setFinishTarget(null)
    setFinishError(null)
  }, [])

  const closeReply = useCallback(() => {
    setReplyFor(null)
    setReplyBox(null)
    setReplyText(null)
    setDraft('')
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (ctxMenu) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setCtxMenu(null)
      } else if (replyFor) {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeReply()
      } else if (finishTarget) {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeOverlays()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [ctxMenu, replyFor, finishTarget, closeOverlays, closeReply])

  const loadReply = useCallback(async (s: SessionTab) => {
    setReplyFor(s)
    onAcknowledgeWarn(s.id)
    setReplyLoading(true)
    setReplyText(null)
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
  }, [onAcknowledgeWarn])

  const sendDraft = useCallback(() => {
    const text = draft.trim()
    if (!text || !replyFor) return
    onSendToSession(replyFor.id, text)
    setDraft('')
  }, [draft, replyFor, onSendToSession])

  const openReplyFromMenu = useCallback(() => {
    if (!ctxMenu) return
    const s = ctxMenu.session
    setReplyBox(computeReplyBox(ctxMenu.cardRect))
    setCtxMenu(null)
    void loadReply(s)
  }, [ctxMenu, loadReply])

  const recordById = new Map(records.map(r => [r.id, r]))
  const liveIds = new Set(sessions.map(s => s.id))
  const planCards = records.filter(r => !liveIds.has(r.id))

  const liveByStatus: Record<CardStatus, LiveCard[]> = { running: [], idle: [], warning: [] }
  for (const s of sessions) {
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

  const quickCreate = useCallback(async () => {
    if (creating || !workspacePath || !repoRoot) return
    setCreating(true)
    try {
      await onCreateRecord('', defaultCmd)
      await reload()
    } finally {
      setCreating(false)
    }
  }, [creating, workspacePath, repoRoot, onCreateRecord, reload, defaultCmd])

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
    { key: 'warning', label: t('warning'), count: liveByStatus.warning.length }
  ]

  const emptyHint: Record<string, string> = {
    plan: workspacePath
      ? repoRoot === null
        ? t('Not a git repo — worktree unavailable')
        : t('No worktree tasks yet')
      : t('No active workspace'),
    running: t('No running sessions'),
    idle: t('No idle sessions'),
    warning: t('No warning sessions')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-9 px-3 flex items-center justify-between border-b border-ide-border shrink-0 bg-ide-sidebar/50">
        <div className="flex items-center gap-1.5 min-w-0">
          <KanbanSquare size={13} className="text-ide-accent shrink-0" />
          <span className="text-xs font-medium text-ide-text">{t('Task Board')}</span>
          {repoRoot && (
            <span className="px-1.5 py-0.5 rounded-full bg-ide-hover text-[10px] text-ide-text-muted truncate max-w-[220px]" title={repoRoot}>
              {pathTail(repoRoot)}
            </span>
          )}
        </div>
        <span className="text-[10px] text-ide-text-muted/60 shrink-0">Ctrl+B</span>
      </div>
      <div className="flex-1 flex min-h-0">
        {columns.map((col, ci) => (
          <div key={col.key} className={`flex-1 min-w-0 min-h-0 flex flex-col ${ci > 0 ? 'border-l border-ide-border' : ''}`}>
            <div className="h-7 px-3 flex items-center gap-1.5 border-b border-ide-border shrink-0">
              <span className="text-xs font-medium text-ide-text-muted">{col.label}</span>
              <span className="text-[10px] px-1 rounded-full bg-ide-hover text-ide-text-muted">{col.count}</span>
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
                      busy={finishing || creating}
                      openLabel={t('Open')}
                      doneLabel={t('Done')}
                      clearLabel={t('Clear')}
                      clearTitle={t('Record only (directory gone)')}
                      finishTitle={t('Finish & clean worktree / branch')}
                      onOpen={() => void openOne(r)}
                      onFinish={() => {
                        setFinishError(null)
                        setFinishTarget(r)
                      }}
                      onClear={() => void clearOne(r)}
                    />
                  ))}
                  {planCards.length === 0 && workspacePath && repoRoot && (
                    <div className="py-4 text-center text-[11px] text-ide-text-muted/50">{t('No worktree tasks yet')}</div>
                  )}
                  <button
                    onClick={() => void quickCreate()}
                    disabled={!workspacePath || !repoRoot || creating}
                    title={!workspacePath ? t('No active workspace') : repoRoot === null ? t('Not a git repo — worktree unavailable') : t('New worktree session')}
                    className="w-full py-1.5 rounded-lg border border-dashed border-ide-border text-[11px] text-ide-text-muted hover:text-ide-accent hover:border-ide-accent/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {creating ? t('Creating...') : `+ ${t('Create')}`}
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
                      onFocus={() => onFocusSession(card.session.id)}
                      onFinish={setFinishTarget}
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
              <div className="shrink-0 border-t border-ide-border px-2 py-1.5 flex items-center gap-1.5 bg-ide-sidebar/50">
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
              onClick={openReplyFromMenu}
            >
              <BookOpenText size={12} className="text-ide-text-muted shrink-0" />
              {t('View latest reply')}
            </button>
          </div>
        </>
      )}

      {replyFor && replyBox && (
        <div
          className="fixed z-[66] flex flex-col rounded-xl border border-ide-border bg-ide-sidebar shadow-2xl overflow-hidden"
          style={{ left: replyBox.left, top: replyBox.top, width: replyBox.width, height: replyBox.height }}
        >
          <div className="h-9 px-3 flex items-center gap-1.5 border-b border-ide-border shrink-0">
            <StatusDot status={statusOf(replyFor, agentStatus)} />
            <span className="text-xs text-ide-text truncate flex-1" title={replyFor.name}>{replyFor.name}</span>
            <SourceBadge kind={replyFor.kind} />
            <button
              onClick={closeReply}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {replyLoading ? (
              <div className="text-xs text-ide-text-muted animate-pulse">{t('Searching...')}</div>
            ) : replyText ? (
              <ChatMarkdown text={replyText} workspacePath={null} />
            ) : replyFor.kind === 'terminal' ? (
              <div className="text-xs text-ide-text-muted/60">{t('No structured reply for terminal sessions')}</div>
            ) : (
              <div className="text-xs text-ide-text-muted/60">{t('No reply yet')}</div>
            )}
          </div>
          <div className="border-t border-ide-border p-2 shrink-0 space-y-1.5">
            <textarea
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
              className="w-full resize-none px-2 py-1.5 text-xs bg-ide-panel border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
            />
            <div className="flex justify-end">
              <button
                onClick={sendDraft}
                disabled={!draft.trim()}
                className="px-2.5 py-1 rounded text-[11px] text-ide-accent border border-ide-accent/50 hover:bg-ide-accent/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
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
    </div>
  )
}
