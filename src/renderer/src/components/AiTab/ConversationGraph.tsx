import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dagre from 'dagre'
import { FolderGit2, GitBranch, GitFork, Loader2, Maximize2, RefreshCw, Send } from 'lucide-react'
import type { AiGraph, AiGraphNode } from '@shared/types'
import { useI18n } from '../../i18n'
import { readAiCliConfig } from '../../aiStore'

// 分叉到 worktree 的按钮图标：四叶草（svgrepo 实心图形）
function WorktreeForkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 498.842 498.842" fill="currentColor" className={className}>
      <path d="M39.902,310.35c17.38,10.065,41.431,5.689,60.187,2.841c4-0.608,56.591-11.48,56.607-11.369c0.53,4.443-29.226,18.707-32.781,21.25c-16.06,11.482-32.321,27.157-36.561,47.218c-10.25,48.575,54.867,109.222,97.794,119.906c40.448,10.065,78.444-14.571,92.154-52.592c9.695-26.906,12.649-58.345,6.929-86.46c-1.327-6.508-16.902-39.477-14.187-44.593c2.229-4.191,36.087,23.397,38.253,25.409c17.766,16.472,32.403,36.771,40.126,59.882c3.912,11.697,1.594,44.561,18.58,45.758c28.057,1.979,32.925-14.87,24.355-36.924c-9.993-25.686-23.445-50.146-41.054-71.42c-4.096-4.959-49.822-46.887-49.76-46.983c2.236-2.983,30.335,6.18,33.529,6.784c20.712,3.927,41.84,6.197,62.93,6.106c39.509-0.169,95.671-9.344,101.053-57.652c4.918-44.046-13.549-106.383-47.851-135.186c-24.661-20.717-46.531-15.465-69.526,4.538c-11.395,9.913-22.121,20.616-31.971,32.071c-2.735,3.178-19.663,29.724-23.59,28.477c-2.188-0.693,17.202-35.027,17.846-36.312c9.18-18.435,19.148-39.862,17.943-60.977c-2.431-42.662-44.897-60.419-82.194-63.228c-44.19-3.317-113.616,8.915-131.292,57.266c-8.441,23.092,6.347,49.775,15.121,70.669c1.568,3.735,23.036,52.769,22.506,52.817c-8.738,0.798-24.726-29.748-28.91-35.091c-13.921-17.792-30.358-36.578-51.304-46.137c-44.97-20.542-84.783,29.635-96.943,67.066C-6.082,216.544-4.939,284.377,39.902,310.35z" />
    </svg>
  )
}

const NODE_W = 236
const NODE_H = 118
const RANK_SEP = 68
const NODE_SEP = 18

interface Positioned {
  node: AiGraphNode
  x: number
  y: number
}

function layoutGraph(nodes: AiGraphNode[]): { items: Positioned[]; width: number; height: number } {
  if (nodes.length === 0) return { items: [], width: 0, height: 0 }
  // 按 (时间, id) 固定排序后再喂 dagre：切分支时目录扫描顺序会变，
  // 节点数组顺序跟着变，不排序的话同一张图会排出不同位置
  const sorted = [...nodes].sort((a, b) => (a.timestamp - b.timestamp) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 32, marginy: 32 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of sorted) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const n of sorted) if (n.parentId && g.hasNode(n.parentId)) g.setEdge(n.parentId, n.id)
  dagre.layout(g)

  const items: Positioned[] = []
  let width = 0
  let height = 0
  for (const n of nodes) {
    const gn = g.node(n.id)
    if (!gn) continue
    const x = gn.x - NODE_W / 2
    const y = gn.y - NODE_H / 2
    items.push({ node: n, x, y })
    width = Math.max(width, x + NODE_W + 32)
    height = Math.max(height, y + NODE_H + 32)
  }
  return { items, width: Math.max(width, 400), height: Math.max(height, 300) }
}

function edgePath(from: Positioned, to: Positioned): string {
  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const mid = (x1 + x2) / 2
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
}

function relTime(ts: number, t: (k: string) => string): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return t('just now')
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

interface ConversationGraphProps {
  sessionId: string | null
  workspacePath: string
  isActive: boolean
  refreshSignal: string
  onForkSend: (node: AiGraphNode, text: string) => Promise<boolean>
  onSendInThisSession: (text: string) => void
  onSendToBranch: (claudeSessionId: string, cwd: string, text: string) => Promise<boolean>
  onOpenBranch: (claudeSessionId: string, cwd: string) => void
  onRevealTurn: (content: string, occurrence: number) => void
  // pi 会话没有 worktree 隔离，不传即隐藏该按钮
  onForkWorktree?: (node: AiGraphNode) => Promise<string | null>
}

export default function ConversationGraph({
  sessionId, workspacePath, isActive, refreshSignal,
  onForkSend, onSendInThisSession, onSendToBranch, onOpenBranch, onRevealTurn, onForkWorktree,
}: ConversationGraphProps): React.ReactElement {
  const { t } = useI18n()
  const [graph, setGraph] = useState<AiGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [worktreeBusy, setWorktreeBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const [panning, setPanning] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    if (!sessionId || !workspacePath) return
    const { configDir } = readAiCliConfig()
    setLoading(true)
    try {
      const g: AiGraph | null = await window.api.ai.sessionGraph(sessionId, workspacePath, configDir)
      setGraph(g)
    } catch {
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId, workspacePath])

  useEffect(() => { if (isActive) load() }, [isActive, load, refreshSignal])

  const { items, width, height } = useMemo(() => layoutGraph(graph?.nodes ?? []), [graph])
  const posById = useMemo(() => new Map(items.map(i => [i.node.id, i])), [items])

  const fit = useCallback(() => {
    const el = viewportRef.current
    if (!el || items.length === 0) return
    const { clientWidth: vw, clientHeight: vh } = el
    const k = Math.min(vw / width, vh / height, 1) * 0.94
    setView({ k, x: (vw - width * k) / 2, y: (vh - height * k) / 2 })
  }, [items, width, height])

  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (items.length === 0) return
    // 只在换了一组对话（rootId 变）时才重新铺满视图；同一组里切分支、长出新节点都不动视野
    const key = graph?.rootId ?? sessionId
    if (fittedFor.current === key) return
    fittedFor.current = key
    fit()
  }, [items.length, graph?.rootId, sessionId, fit])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setView(v => {
        const k = Math.max(0.15, Math.min(2, v.k * (e.deltaY > 0 ? 0.9 : 1.1)))
        return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const p = panRef.current
      if (!p) return
      const dx = e.clientX - p.sx
      const dy = e.clientY - p.sy
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) p.moved = true
      setView(v => ({ ...v, x: p.vx + dx, y: p.vy + dy }))
    }
    const onUp = () => { panRef.current = null; setPanning(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const startPan = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    panRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
    setPanning(true)
  }, [view.x, view.y])

  const branchById = useMemo(
    () => new Map((graph?.branches ?? []).map(b => [b.claudeSessionId, b])),
    [graph],
  )
  // 节点是否只属于 worktree 分支：共享前缀同时属于主分支，就不标——只有该分支独有的轮次才标
  const nodeWorktree = useCallback((node: AiGraphNode): 'cli' | 'branch' | null => {
    const kinds = node.branchIds.map(id => branchById.get(id)?.worktree ?? null)
    if (kinds.length === 0 || kinds.some(k => k === null)) return null
    return kinds[0]
  }, [branchById])
  // 某条 worktree 分支的入口轮次：独占该分支、且父节点正是该分支的分叉点
  const isWorktreeEntry = useCallback((node: AiGraphNode): boolean => {
    if (!nodeWorktree(node)) return false
    return branchById.get(node.branchIds[0])?.forkNodeId === node.parentId
  }, [nodeWorktree, branchById])
  // 从这里长出了 worktree 分支（分叉点）
  const worktreeForksAt = useCallback((node: AiGraphNode) =>
    [...branchById.values()].filter(b => b.worktree && b.forkNodeId === node.id),
  [branchById])
  // 双击可打开的末端分支：以该节点结尾、且不是当前正在看的这条
  const otherTipsOf = useCallback((node: AiGraphNode) =>
    node.tipBranchIds
      .filter(id => id !== graph?.activeClaudeSessionId)
      .map(id => branchById.get(id))
      .filter((b): b is NonNullable<typeof b> => !!b),
  [graph, branchById])

  const selected = selectedId ? graph?.nodes.find(n => n.id === selectedId) ?? null : null
  // worktree 起点节点不承载轮次，它的分支归属直接看 branchIds
  const tipBranch = selected?.worktreeStart ? selected.branchIds[0] ?? null : selected?.tipBranchIds[0] ?? null
  const selectedTipBranch = tipBranch ? branchById.get(tipBranch) : undefined
  const tipBranchCwd = selectedTipBranch?.cwd ?? ''
  const selectedTipWorktree = selectedTipBranch?.worktree ?? null
  const isCurrentTip = tipBranch === graph?.activeClaudeSessionId
  const action: 'send' | 'continue' | 'fork' = !selected || (!selected.worktreeStart && selected.tipBranchIds.length === 0) ? 'fork'
    : isCurrentTip ? 'send' : 'continue'

  // 分叉/切分支失败（源文件缺失等）时保留草稿，别把用户刚敲的整段吞掉
  const submit = useCallback(async () => {
    const text = draft.trim()
    if (!text || !selected || sending) return
    if (action === 'send') { setDraft(''); onSendInThisSession(text); return }
    setSending(true)
    try {
      const ok = action === 'fork' ? await onForkSend(selected, text) : await onSendToBranch(tipBranch!, tipBranchCwd, text)
      if (ok) setDraft('')
    } finally {
      setSending(false)
    }
  }, [draft, selected, sending, action, tipBranch, tipBranchCwd, onForkSend, onSendToBranch, onSendInThisSession])

  const forkWorktree = useCallback(async (node: AiGraphNode) => {
    if (worktreeBusy || !onForkWorktree) return
    setError(null)
    setWorktreeBusy(true)
    try {
      const err = await onForkWorktree(node)
      if (err) setError(err)
    } finally {
      setWorktreeBusy(false)
    }
  }, [worktreeBusy, onForkWorktree])

  useEffect(() => { setSelectedId(null); setDraft(''); setError(null) }, [sessionId])

  const nodeClick = useCallback((e: React.MouseEvent, id: string) => {
    if (panRef.current?.moved) return
    e.stopPropagation()
    setSelectedId(prev => (prev === id ? null : id))
    // 点节点时 mousedown 会把焦点从输入框夺走（节点本身不可聚焦），点完还回去
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 h-8 border-b border-ide-border text-xs text-ide-text-muted">
        <GitBranch className="w-3.5 h-3.5" />
        <span className="font-medium text-ide-text">{t('Branch Graph')}</span>
        {graph && <span>{graph.nodes.length} {t('turns')} · {graph.branches.length} {t('branches')}</span>}
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-ide-hover hover:text-ide-text transition-colors" title={t('Fit to view')} onClick={fit}>
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button className="p-1 rounded hover:bg-ide-hover hover:text-ide-text transition-colors" title={t('Refresh')} onClick={load}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div
        ref={viewportRef}
        className="flex-1 min-h-0 relative overflow-hidden bg-ide-bg"
        style={{ cursor: panning ? 'grabbing' : 'grab' }}
        onMouseDown={startPan}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-ide-text-muted gap-2 text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />{t('Loading...')}
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-ide-text-muted text-xs">
            {t('No conversation to map yet')}
          </div>
        )}
        <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0', width, height, position: 'absolute', top: 0, left: 0 }}>
          <svg width={width} height={height} className="absolute top-0 left-0" style={{ pointerEvents: 'none' }}>
            {items.map(({ node }) => {
              if (!node.parentId) return null
              const parent = posById.get(node.parentId)
              if (!parent) return null
              const active = node.active
              const entry = isWorktreeEntry(node)
              return (
                <path
                  key={`e-${node.id}`}
                  d={edgePath(parent, posById.get(node.id) ?? parent)}
                  fill="none"
                  stroke={active || entry ? 'rgb(var(--ide-accent))' : 'rgb(var(--ide-border))'}
                  strokeWidth={active ? 2 : entry ? 2 : 1.5}
                  strokeDasharray={entry && !active ? '5 4' : undefined}
                  opacity={active ? 0.85 : entry ? 0.9 : 0.7}
                />
              )
            })}
          </svg>
          {items.map(({ node, x, y }) => {
            const selfSelected = node.id === selectedId
            const wt = nodeWorktree(node)
            const tipBranchInfo = node.tipBranchIds.length === 1 ? branchById.get(node.tipBranchIds[0]) : undefined
            const otherTips = otherTipsOf(node)
            const forks = worktreeForksAt(node)
            const tipWorktree = tipBranchInfo?.worktree ?? null
            return (
              <div
                key={node.id}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => nodeClick(e, node.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  // 末端节点双击 = 打开那条分支；只有当前路径上的轮次才是"跳过去看"。
                  // worktree 起点就是该分支的入口，双击一律进它的对话
                  if (node.worktreeStart) {
                    const b = branchById.get(node.branchIds[0])
                    if (b) onOpenBranch(b.claudeSessionId, b.cwd)
                    return
                  }
                  if (otherTips.length > 0) onOpenBranch(otherTips[0].claudeSessionId, otherTips[0].cwd)
                  else if (node.active && node.fork) onRevealTurn(node.fork.content, node.fork.occurrence)
                }}
                style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
                className={`absolute rounded-md border px-2.5 py-2 flex flex-col gap-1 cursor-pointer transition-colors ${
                  wt ? 'border-l-2 border-l-ide-accent ' : ''
                }${
                  selfSelected
                    ? 'border-ide-accent bg-ide-active'
                    : node.active
                      ? 'border-ide-accent/50 bg-ide-panel hover:bg-ide-active'
                      : 'border-ide-border bg-ide-sidebar hover:bg-ide-panel'
                }`}
              >
                <div className="flex items-start gap-1.5">
                  {node.active && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ide-accent shrink-0" />}
                  {node.worktreeStart && <FolderGit2 className="mt-0.5 w-3 h-3 text-ide-accent shrink-0" />}
                  <div className="text-[11px] leading-snug text-ide-text font-medium line-clamp-2 break-words">{node.title || t('(empty)')}</div>
                </div>
                <div className="text-[10px] leading-snug text-ide-text-muted line-clamp-2 break-words flex-1">
                  {node.preview || t('(no reply)')}
                </div>
                <div className="flex items-center gap-2 text-[9px] text-ide-text-muted">
                  <span>{relTime(node.timestamp, t)}</span>
                  {node.toolCallCount > 0 && <span>{node.toolCallCount} {t('tools')}</span>}
                  {forks.length > 0 && (
                    <span
                      className="text-ide-accent"
                      title={[t('Worktree branch starts here'), ...forks.map(f => f.branch ?? '')].filter(Boolean).join('\n')}
                    >
                      <GitFork className="w-2.5 h-2.5" />
                    </span>
                  )}
                  {!node.worktreeStart && (tipWorktree ? (
                    <span
                      className="flex items-center gap-0.5 px-1 rounded-sm bg-ide-accent/15 text-ide-accent max-w-[130px]"
                      title={`${tipWorktree === 'cli' ? t('Isolated worktree (clean HEAD)') : t('Isolated worktree (with uncommitted changes)')}\n${tipBranchInfo?.branch ?? ''}`}
                    >
                      <FolderGit2 className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{tipBranchInfo?.branch ?? t('worktree')}</span>
                    </span>
                  ) : node.tipBranchIds.length > 0 && (
                    <span title={otherTips.length > 0 ? t('Double-click to open this branch') : undefined}>
                      <GitBranch className="w-2.5 h-2.5" />
                    </span>
                  ))}
                  <div className="flex-1" />
                  {!node.worktreeStart && onForkWorktree && (
                    <button
                      disabled={worktreeBusy}
                      className="opacity-60 hover:opacity-100 hover:text-ide-accent transition-opacity disabled:opacity-30"
                      title={t('Branch into a new isolated worktree')}
                      onClick={(e) => { e.stopPropagation(); forkWorktree(node) }}
                    >
                      {worktreeBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <WorktreeForkIcon className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-ide-border px-3 py-2">
        {error && (
          <div className="mb-1.5 px-2 py-1 rounded text-[10px] text-ide-danger bg-ide-danger/10 border border-ide-danger/30 break-words">
            {t('Worktree failed')}: {error}
          </div>
        )}
        {selected ? (
          <>
            <div className="flex items-center gap-2 text-xs text-ide-text-muted mb-1.5">
              <span className="truncate flex-1">
                {action === 'send' ? t('Sending in current branch') : action === 'continue' ? t('Continue in that branch') : t('Fork a new branch')}
                {' · '}
                <span className="text-ide-text">{selected.title}</span>
              </span>
              {selectedTipWorktree && (
                <span className="shrink-0 flex items-center gap-0.5 text-ide-accent max-w-[180px]" title={tipBranchCwd}>
                  <FolderGit2 className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{selectedTipBranch?.branch ?? t('worktree')}</span>
                </span>
              )}
              {tipBranch && tipBranch !== graph?.activeClaudeSessionId && (
                <button
                  className="shrink-0 px-1.5 py-0.5 rounded border border-ide-border hover:border-ide-accent hover:text-ide-accent transition-colors"
                  onClick={() => onOpenBranch(tipBranch, tipBranchCwd)}
                >
                  {t('Open branch')}
                </button>
              )}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
                }}
                placeholder={action === 'fork' ? t('Message to start a new branch...') : t('Message...')}
                className="flex-1 resize-none bg-ide-bg border border-ide-border rounded px-2 py-1.5 text-xs text-ide-text outline-none focus:border-ide-accent"
              />
              <button
                disabled={!draft.trim() || sending}
                onClick={submit}
                className="shrink-0 h-8 px-3 rounded bg-ide-accent text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-40 hover:bg-ide-accent-hover transition-colors"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {action === 'fork' ? t('Fork & Send') : t('Send')}
              </button>
            </div>
          </>
        ) : (
          <div className="text-xs text-ide-text-muted py-1.5">
            {t('Click a turn to continue from there. Drag to pan, scroll to zoom.')}
          </div>
        )}
      </div>
    </div>
  )
}
