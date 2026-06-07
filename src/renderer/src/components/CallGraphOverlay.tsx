import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dagre from 'dagre'
import { CodeSymbol } from '@shared/types'

const KIND_COLORS: Record<string, string> = {
  function: '#facc15', method: '#facc15',
  class: '#60a5fa', interface: '#4ade80',
  variable: '#c084fc', constant: '#fb923c',
  type: '#2dd4bf', component: '#f472b6',
}
const NODE_W = 180
const NODE_H = 42
const RANK_SEP = 60
const NODE_SEP = 20

function getKindColor(kind: string): string { return KIND_COLORS[kind] || '#888' }

const MONACO_FONT = "'Cascadia Code', 'Fira Code', 'Cascadia Mono', Consolas, 'Courier New', monospace"

// SVG icon paths matching VS Code outline style (returned as array for direct SVG embedding)
function kindIconPaths(kind: string, color: string) {
  const types: Record<string, React.ReactNode> = {
    function: <>
      <path d="M2 4l6-3 6 3v5l-6 3-6-3V4z" fill={color} opacity={0.15} />
      <path d="M2 4l6-3 6 3M2 4v5l6 3M8 1v12M14 4l-6 3" fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" />
    </>,
    method: <>
      <path d="M2 4l6-3 6 3v5l-6 3-6-3V4z" fill={color} opacity={0.15} />
      <path d="M2 4l6-3 6 3M2 4v5l6 3M8 1v12M14 4l-6 3" fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" />
    </>,
    class: <>
      <rect x={1} y={7.5} width={4} height={4} rx={0.5} fill={color} opacity={0.15} stroke={color} strokeWidth={1.2} />
      <rect x={6} y={4} width={4} height={7.5} rx={0.5} fill={color} opacity={0.3} stroke={color} strokeWidth={1.2} />
      <rect x={11} y={6.5} width={4} height={5} rx={0.5} fill={color} opacity={0.15} stroke={color} strokeWidth={1.2} />
    </>,
    interface: <>
      <circle cx={8} cy={8} r={6} fill={color} opacity={0.1} stroke={color} strokeWidth={1.2} />
      <circle cx={8} cy={8} r={1.5} fill={color} />
    </>,
    variable: <>
      <rect x={2} y={2} width={12} height={12} rx={1.5} fill={color} opacity={0.1} stroke={color} strokeWidth={1.2} />
      <path d="M11 2v12M2 11h12" fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
    </>,
    constant: <>
      <rect x={3} y={7} width={10} height={7} rx={1.5} fill={color} opacity={0.15} stroke={color} strokeWidth={1.2} />
      <path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </>,
    type: <>
      <path d="M8 1l6 7-6 7-6-7z" fill={color} opacity={0.15} stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </>,
    component: <>
      <path d="M3 4h2l1 3-1 3H3M13 4h-2l-1 3 1 3h2" fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 7h4" fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
    </>,
    default: <>
      <rect x={2.5} y={2.5} width={11} height={11} rx={1.5} fill={color} opacity={0.1} stroke={color} strokeWidth={1.2} />
    </>,
  }
  return types[kind] || types.default
}

interface GraphNode {
  id: string; name: string; kind: string
  filePath: string; line: number; column: number
  x: number; y: number
  expanded: boolean
}
interface GraphEdge { from: string; to: string }

interface CallGraphOverlayProps {
  focalNode: CodeSymbol
  onClose: () => void
  onJumpToFile: (fullPath: string, line: number) => void
}

/** Run dagre Sugiyama layout: top→bottom, callers above, callees below */
function layoutGraph(nodes: Map<string, GraphNode>, edges: GraphEdge[]): Map<string, { x: number; y: number }> {
  if (nodes.size === 0) return new Map()

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const [id, n] of nodes) {
    g.setNode(id, { width: NODE_W, height: NODE_H })
  }
  for (const e of edges) {
    // dagre expects edges from top to bottom (caller → callee)
    // In our graph, edges are caller→callee which is correct for TB layout
    g.setEdge(e.from, e.to)
  }

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const id of nodes.keys()) {
    const node = g.node(id)
    if (node) positions.set(id, { x: node.x, y: node.y })
  }
  return positions
}

function CallGraphOverlay({ focalNode, onClose, onJumpToFile }: CallGraphOverlayProps) {
  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map())
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set())
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState<string | null>(null)
  const [panning, setPanning] = useState<{ sx: number; sy: number; vx: number; vy: number } | null>(null)
  const [draggedNodes, setDraggedNodes] = useState<Set<string>>(new Set())
  const svgRef = useRef<SVGSVGElement>(null)

  // Compute dagre layout
  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges])

  // Build display nodes (use dagre positions, fall back to dragged positions)
  const displayNodes = useMemo(() => {
    const result = new Map<string, GraphNode & { dx: number; dy: number }>()
    for (const [id, gn] of nodes) {
      const pos = positions.get(id)
      result.set(id, { ...gn, dx: pos ? pos.x : gn.x, dy: pos ? pos.y : gn.y })
    }
    return result
  }, [nodes, positions])

  const expandNode = useCallback(async (nodeId: string) => {
    setNodes(prev => {
      const next = new Map(prev)
      const n = next.get(nodeId)
      if (n) next.set(nodeId, { ...n, expanded: true })
      return next
    })
    setLoadingNodes(prev => new Set(prev).add(nodeId))
    try {
      const [callersRes, calleesRes] = await Promise.all([
        window.api.code.getCallers(nodeId, 1),
        window.api.code.getCallees(nodeId, 1),
      ])
      setNodes(prev => {
        const next = new Map(prev)
        const proc = (items: any[]) => {
          for (const item of items) {
            const n = item.node
            if (!n || next.has(n.id)) continue
            next.set(n.id, {
              id: n.id, name: n.name, kind: n.kind,
              filePath: n.filePath, line: n.line ?? n.startLine, column: n.column ?? n.startColumn ?? 0,
              x: 0, y: 0, expanded: false,
            })
          }
        }
        proc(callersRes.nodes || [])
        proc(calleesRes.nodes || [])
        return next
      })
      const newEdges: GraphEdge[] = []
      const add = (items: any[], reverse: boolean) => {
        for (const item of items) {
          const n = item.node
          if (!n) continue
          const from = reverse ? n.id : nodeId
          const to = reverse ? nodeId : n.id
          if (!edges.find(e => e.from === from && e.to === to)) {
            newEdges.push({ from, to })
          }
        }
      }
      add(callersRes.nodes || [], true)
      add(calleesRes.nodes || [], false)
      if (newEdges.length) setEdges(prev => [...prev, ...newEdges])
    } catch { /* ignore */ }
    setLoadingNodes(prev => { const s = new Set(prev); s.delete(nodeId); return s })
  }, [edges]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNodes(new Map([[focalNode.id, {
      id: focalNode.id, name: focalNode.name, kind: focalNode.kind,
      filePath: focalNode.filePath, line: focalNode.line, column: focalNode.column,
      x: 0, y: 0, expanded: false,
    }]]))
    setEdges([])
    setDraggedNodes(new Set())
    expandNode(focalNode.id)
  }, [focalNode.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  const screenToSvg = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current; if (!svg) return { x: cx, y: cy }
    const r = svg.getBoundingClientRect()
    return { x: (cx - r.left - r.width / 2) / viewBox.scale + viewBox.x, y: (cy - r.top - r.height / 2) / viewBox.scale + viewBox.y }
  }, [viewBox])

  const viewBoxRef = useRef(viewBox); viewBoxRef.current = viewBox

  // Wheel zoom — must use non-passive listener
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      setViewBox(p => ({ ...p, scale: Math.max(0.1, Math.min(3, p.scale * (e.deltaY > 0 ? 0.9 : 1.1))) }))
    }
    svg.addEventListener('wheel', handler, { passive: false })
    return () => svg.removeEventListener('wheel', handler)
  }, [])

  // Mouse
  useEffect(() => {
    const mm = (e: MouseEvent) => {
      if (dragging) {
        const svgP = screenToSvg(e.clientX, e.clientY)
        setNodes(prev => {
          const next = new Map(prev)
          const n = next.get(dragging)
          if (n) next.set(dragging, { ...n, x: svgP.x, y: svgP.y })
          return next
        })
        setDraggedNodes(prev => new Set(prev).add(dragging))
      }
      if (panning) {
        setViewBox(p => ({ ...p, x: panning.vx - (e.clientX - panning.sx) / p.scale, y: panning.vy - (e.clientY - panning.sy) / p.scale }))
      }
    }
    const mu = () => { setDragging(null); setPanning(null) }
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu)
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }
  }, [dragging, panning, screenToSvg])

  // Compute actual position: dagre layout or manual drag
  const getPos = (gn: GraphNode & { dx: number; dy: number }) => ({
    x: draggedNodes.has(gn.id) ? gn.x : gn.dx,
    y: draggedNodes.has(gn.id) ? gn.y : gn.dy,
  })

  // SVG viewport adapts to content
  const allPositions = Array.from(displayNodes.values()).map(getPos)
  const minX = allPositions.length > 0 ? Math.min(...allPositions.map(p => p.x)) - NODE_W : -600
  const maxX = allPositions.length > 0 ? Math.max(...allPositions.map(p => p.x)) + NODE_W : 600
  const minY = allPositions.length > 0 ? Math.min(...allPositions.map(p => p.y)) - NODE_H : -400
  const maxY = allPositions.length > 0 ? Math.max(...allPositions.map(p => p.y)) + NODE_H : 400
  const svgW = Math.max(1200, maxX - minX + 100)
  const svgH = Math.max(800, maxY - minY + 100)
  const offX = (svgW - (maxX - minX)) / 2 - minX
  const offY = 50 - minY

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div className="relative flex flex-col" style={{ width: '100vw', height: '100vh' }}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-black/30 text-ide-text-muted/50 hover:text-ide-text hover:bg-black/50 transition-colors">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" /></svg>
        </button>
        <div className="flex-1 overflow-hidden">
          <svg ref={svgRef}
            viewBox={`${viewBox.x - (svgW / 2) / viewBox.scale} ${viewBox.y - (svgH / 2) / viewBox.scale} ${svgW / viewBox.scale} ${svgH / viewBox.scale}`}
            className="w-full h-full"
            onMouseDown={(e) => { if (e.button === 0 && e.target === svgRef.current) setPanning({ sx: e.clientX, sy: e.clientY, vx: viewBox.x, vy: viewBox.y }) }}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#555" />
              </marker>
            </defs>

            {/* Edges */}
            {edges.map((e, i) => {
              const fn = displayNodes.get(e.from), tn = displayNodes.get(e.to)
              if (!fn || !tn) return null
              const fp = getPos(fn), tp = getPos(tn)
              const x1 = fp.x + NODE_W / 2, x2 = tp.x - NODE_W / 2
              const midX = (x1 + x2) / 2
              const path = `M${x1},${fp.y} C${midX},${fp.y} ${midX},${tp.y} ${x2},${tp.y}`
              return <path key={`e${i}`} d={path} fill="none" stroke="#555" strokeWidth={1.4} markerEnd="url(#arrowhead)" opacity={0.55} />
            })}

            {/* Nodes */}
            {Array.from(displayNodes.values()).map(gn => {
              const isFocal = gn.id === focalNode.id
              const p = getPos(gn)
              const color = getKindColor(gn.kind)
              const name = gn.name.length > 22 ? gn.name.slice(0, 20) + '…' : gn.name
              const loading = loadingNodes.has(gn.id)
              const isDragged = draggedNodes.has(gn.id)
              return (
                <g key={gn.id} transform={`translate(${p.x - NODE_W / 2},${p.y - NODE_H / 2})`} className="cursor-pointer"
                  onMouseDown={(e) => { e.stopPropagation(); if (e.button === 0) setDragging(gn.id) }}
                  onClick={() => onJumpToFile(gn.filePath, gn.line)}>
                  <rect x={0} y={0} width={NODE_W} height={NODE_H} rx={7} ry={7}
                    fill={isFocal ? `${color}20` : isDragged ? '#1a1a3ecc' : '#1a1a2ecc'}
                    stroke={isFocal ? color : gn.expanded ? '#666' : '#444'}
                    strokeWidth={isFocal ? 2 : 1.2} opacity={isDragged ? 1 : 0.92}
                    style={{ filter: isFocal ? `drop-shadow(0 0 6px ${color}40)` : undefined }} />
                  {loading
                    ? <text x={NODE_W / 2} y={NODE_H / 2 + 4} fill="#888" fontSize={11} textAnchor="middle" fontFamily={MONACO_FONT}>loading...</text>
                    : <>
                        <svg x={8} y={7} width={16} height={16} viewBox="0 0 16 16">
                          {kindIconPaths(gn.kind, color)}
                        </svg>
                        <text x={28} y={26} fill="#c8c8d0" fontSize={12} fontFamily={MONACO_FONT}>{name}</text>
                        {!gn.expanded && (
                          <g onClick={(e) => { e.stopPropagation(); expandNode(gn.id) }} className="cursor-pointer">
                            <rect x={NODE_W - 26} y={0} width={26} height={NODE_H} rx={7} ry={7} fill="transparent" />
                            <text x={NODE_W - 10} y={16} fill="#888" fontSize={13} textAnchor="end" fontFamily={MONACO_FONT} fontWeight="bold" style={{ pointerEvents: 'none' }}>+</text>
                          </g>
                        )}
                      </>
                  }
                </g>
              )
            })}
          </svg>
        </div>
      </div>
    </div>
  )
}

export default CallGraphOverlay
