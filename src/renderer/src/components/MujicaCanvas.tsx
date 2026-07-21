import React, { useMemo, useRef, useState, useCallback } from 'react'
import dagre from 'dagre'
import { useAiSession } from '../aiStore'
import type { AiSessionState } from '@shared/types'

const NODE_W = 240
const NODE_H = 96
const RANK_SEP = 60
const NODE_SEP = 24

type NodeStatus = 'creating' | 'idle' | 'running' | 'done' | 'error'

function deriveStatus(s: AiSessionState): NodeStatus {
  if (s.messages.some(m => m.type === 'result' && (m as any).error)) return 'error'
  if (!s.ready) return 'creating'
  if (s.busy || s.streaming) return 'running'
  if (s.messages.some(m => m.type === 'result')) return 'done'
  return 'idle'
}

function lastPreview(s: AiSessionState): string {
  if (s.streaming && s.streamBuffer) return s.streamBuffer
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i]
    if (m.type === 'assistant' && m.content) return m.content
  }
  return ''
}

function basename(p: string | undefined): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

function layoutNodes(ids: string[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of ids) g.setNode(id, { width: NODE_W, height: NODE_H })
  dagre.layout(g)
  const pos = new Map<string, { x: number; y: number }>()
  for (const id of ids) { const n = g.node(id); if (n) pos.set(id, { x: n.x, y: n.y }) }
  return pos
}

const STATUS_STYLE: Record<NodeStatus, { dot: string; text: string; border: string; label: string }> = {
  creating: { dot: 'bg-ide-text-muted/60 animate-pulse', text: 'text-ide-text-muted', border: 'border-ide-border', label: 'creating worktree…' },
  idle: { dot: 'bg-ide-text-muted', text: 'text-ide-text-muted', border: 'border-ide-border', label: 'idle' },
  running: { dot: 'bg-ide-success animate-pulse', text: 'text-ide-success', border: 'border-ide-success/50', label: 'running' },
  done: { dot: 'bg-ide-accent', text: 'text-ide-accent', border: 'border-ide-accent/40', label: 'done' },
  error: { dot: 'bg-ide-danger', text: 'text-ide-danger', border: 'border-ide-danger/50', label: 'error' },
}

function RunButton({ id, disabled, onRunOne }: { id: string; disabled: boolean; onRunOne: (id: string) => void }) {
  return (
    <button
      // stopPropagation on mousedown so the canvas drag-pan doesn't start under the button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onRunOne(id) }}
      disabled={disabled}
      title="run just this agent"
      className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-success hover:bg-ide-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-ide-text-muted"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
        <path d="M8 5v14l11-7z" />
      </svg>
    </button>
  )
}

function MujicaNode({ id, label, hovered, canRun, onHover, onHoverEnd, onRunOne }: {
  id: string
  label: string
  hovered: boolean
  canRun: boolean
  onHover: (id: string) => void
  onHoverEnd: () => void
  onRunOne: (id: string) => void
}) {
  const s = useAiSession(id)
  const status = deriveStatus(s)
  const st = STATUS_STYLE[status]
  const wt = basename(s.worktreePath)
  const preview = lastPreview(s)
  const busy = status === 'creating' || status === 'running'
  return (
    <div
      // Skip hover while a mouse button is held (canvas drag-pan) to avoid flicker.
      onMouseEnter={(e) => { if (e.buttons === 0) onHover(id) }}
      onMouseLeave={onHoverEnd}
      className={`w-full h-full rounded-lg border ${st.border} ${hovered ? 'ring-2 ring-ide-accent' : ''} bg-ide-sidebar hover:bg-ide-hover transition-colors overflow-hidden flex flex-col`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ide-border/50">
        <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
        <span className="text-sm font-medium text-ide-text truncate flex-1">{label}</span>
        <RunButton id={id} disabled={!canRun || busy} onRunOne={onRunOne} />
        {s.pendingPermission && (
          <span className="w-2 h-2 rounded-full bg-ide-warning animate-pulse shrink-0" title="permission requested" />
        )}
      </div>
      <div className="px-3 py-1 text-[11px] text-ide-text-muted truncate">{wt || st.label}</div>
      <div className={`px-3 py-1 text-xs ${st.text} flex-1 overflow-hidden`}>
        <div className="line-clamp-2 break-words">{preview || st.label}</div>
      </div>
    </div>
  )
}

interface MujicaCanvasProps {
  workspaces: { id: string; label: string }[]
  hoveredId: string | null
  canRun: boolean
  onHover: (id: string) => void
  onHoverEnd: () => void
  onRunOne: (id: string) => void
}

export default function MujicaCanvas({ workspaces, hoveredId, canRun, onHover, onHoverEnd, onRunOne }: MujicaCanvasProps) {
  const positions = useMemo(() => layoutNodes(workspaces.map(w => w.id)), [workspaces])
  const bbox = useMemo(() => {
    let maxX = 0, maxY = 0
    positions.forEach(p => {
      maxX = Math.max(maxX, p.x + NODE_W / 2)
      maxY = Math.max(maxY, p.y + NODE_H / 2)
    })
    return { w: maxX + 80, h: maxY + 80 }
  }, [positions])

  const [view, setView] = useState({ x: 24, y: 24, scale: 1 })
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null)

  const onWheel = useCallback((e: React.WheelEvent) => {
    setView(v => {
      const ns = Math.max(0.3, Math.min(2, v.scale * (e.deltaY < 0 ? 1.1 : 0.9)))
      return { ...v, scale: ns }
    })
  }, [])
  const onDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
  }, [view.x, view.y])
  const onMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    setView(v => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }))
  }, [])
  const onUp = useCallback(() => { dragRef.current = null }, [])

  if (workspaces.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm bg-ide-bg select-none">
        Add an agent from the right panel
      </div>
    )
  }

  return (
    <div
      className="flex-1 relative overflow-hidden bg-ide-bg cursor-grab active:cursor-grabbing"
      onWheel={onWheel}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
    >
      <div
        className="absolute top-0 left-0"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0', width: bbox.w, height: bbox.h }}
      >
        <svg className="absolute inset-0 pointer-events-none" width={bbox.w} height={bbox.h}>
          {/* edges placeholder — reserved for future agent dependencies */}
        </svg>
        {workspaces.map(ws => {
          const p = positions.get(ws.id) || { x: 0, y: 0 }
          return (
            <div key={ws.id} className="absolute" style={{ left: p.x - NODE_W / 2, top: p.y - NODE_H / 2, width: NODE_W, height: NODE_H }}>
              <MujicaNode id={ws.id} label={ws.label} hovered={hoveredId === ws.id} canRun={canRun} onHover={onHover} onHoverEnd={onHoverEnd} onRunOne={onRunOne} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
