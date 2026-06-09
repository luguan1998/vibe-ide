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
const NODE_H = 30
const RANK_SEP = 30
const NODE_SEP = 8
const MONACO_FONT = "'Cascadia Code', 'Fira Code', 'Cascadia Mono', Consolas, 'Courier New', monospace"

function getKindColor(kind: string): string { return KIND_COLORS[kind] || '#888' }

function kindIconPaths(kind: string, color: string) {
  const t: Record<string, React.ReactNode> = {
    function: <><path d="M2 4l6-3 6 3v5l-6 3-6-3V4z" fill={color} opacity={0.15}/><path d="M2 4l6-3 6 3M2 4v5l6 3M8 1v12M14 4l-6 3" fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round"/></>,
    method: <><path d="M2 4l6-3 6 3v5l-6 3-6-3V4z" fill={color} opacity={0.15}/><path d="M2 4l6-3 6 3M2 4v5l6 3M8 1v12M14 4l-6 3" fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round"/></>,
    class: <><rect x={1} y={7.5} width={4} height={4} rx={0.5} fill={color} opacity={0.15} stroke={color} strokeWidth={1.2}/><rect x={6} y={4} width={4} height={7.5} rx={0.5} fill={color} opacity={0.3} stroke={color} strokeWidth={1.2}/><rect x={11} y={6.5} width={4} height={5} rx={0.5} fill={color} opacity={0.15} stroke={color} strokeWidth={1.2}/></>,
    interface: <><circle cx={8} cy={8} r={6} fill={color} opacity={0.1} stroke={color} strokeWidth={1.2}/><circle cx={8} cy={8} r={1.5} fill={color}/></>,
    variable: <><rect x={2} y={2} width={12} height={12} rx={1.5} fill={color} opacity={0.1} stroke={color} strokeWidth={1.2}/><path d="M11 2v12M2 11h12" fill="none" stroke={color} strokeWidth={1} opacity={0.5}/></>,
    constant: <><rect x={3} y={7} width={10} height={7} rx={1.5} fill={color} opacity={0.15} stroke={color} strokeWidth={1.2}/><path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke={color} strokeWidth={1.3} strokeLinecap="round"/></>,
    type: <><path d="M8 1l6 7-6 7-6-7z" fill={color} opacity={0.15} stroke={color} strokeWidth={1.2} strokeLinejoin="round"/></>,
    component: <><path d="M3 4h2l1 3-1 3H3M13 4h-2l-1 3 1 3h2" fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"/><path d="M6 7h4" fill="none" stroke={color} strokeWidth={1} opacity={0.5}/></>,
  }
  return t[kind] || <><rect x={2.5} y={2.5} width={11} height={11} rx={1.5} fill={color} opacity={0.1} stroke={color} strokeWidth={1.2}/></>
}

interface GraphNode {
  id: string; name: string; kind: string
  filePath: string; line: number; column: number
  x: number; y: number
  callersExpanded: boolean
  calleesExpanded: boolean
}
interface GraphEdge { from: string; to: string }
interface CallGraphOverlayProps {
  focalNode: CodeSymbol
  onClose: () => void
  onJumpToFile: (fullPath: string, line: number) => void
}

function layoutGraph(nodes: Map<string, GraphNode>, edges: GraphEdge[]) {
  if (nodes.size === 0) return new Map<string, { x: number; y: number }>()
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const [id, n] of nodes) g.setNode(id, { width: NODE_W, height: NODE_H })
  for (const e of edges) g.setEdge(e.from, e.to)
  dagre.layout(g)
  const pos = new Map<string, { x: number; y: number }>()
  for (const id of nodes.keys()) { const n = g.node(id); if (n) pos.set(id, { x: n.x, y: n.y }) }
  return pos
}

function CallGraphOverlay({ focalNode, onClose, onJumpToFile }: CallGraphOverlayProps) {
  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map())
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set())
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState<string | null>(null)
  const [rightPanning, setRightPanning] = useState<{ sx: number; sy: number; vx: number; vy: number } | null>(null)
  const [draggedNodes, setDraggedNodes] = useState<Set<string>>(new Set())
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [iconHoveredNode, setIconHoveredNode] = useState<string | null>(null)
  const [tooltipNode, setTooltipNode] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  const handleNodeEnter = useCallback((nodeId: string) => {
    setHoveredNode(nodeId)
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setTooltipNode(nodeId), 300)
  }, [])
  const handleNodeLeave = useCallback(() => {
    setHoveredNode(null)
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setTooltipNode(null)
  }, [])
  const dragStartPos = useRef<{ x: number; y: number; nodeId: string } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const edgesRef = useRef(edges); edgesRef.current = edges
  const viewBoxRef = useRef(viewBox); viewBoxRef.current = viewBox

  // Dagre layout
  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges])

  // Center on focal — debounced: wait for async caller/callee data to settle
  const hasCentered = useRef(false)
  const centerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (centerTimer.current) clearTimeout(centerTimer.current)
    centerTimer.current = setTimeout(() => {
      centerTimer.current = null
      const pos = positions.get(focalNode.id)
      if (pos && !hasCentered.current) { hasCentered.current = true; setViewBox({ x: pos.x, y: pos.y, scale: 1 }) }
    }, 150)
    return () => { if (centerTimer.current) clearTimeout(centerTimer.current) }
  }, [positions, focalNode.id])
  useEffect(() => { hasCentered.current = false }, [focalNode.id])

  // Display nodes (dagre pos or manual drag)
  const displayNodes = useMemo(() => {
    const result = new Map<string, GraphNode & { dx: number; dy: number }>()
    for (const [id, gn] of nodes) {
      const p = positions.get(id)
      result.set(id, { ...gn, dx: p ? p.x : gn.x, dy: p ? p.y : gn.y })
    }
    return result
  }, [nodes, positions])

  // ── Expand (direction: 'callers' | 'callees') ──
  const expand = useCallback(async (nodeId: string, dir: 'callers' | 'callees', depth: number = 1) => {
    const key = dir === 'callers' ? 'callersExpanded' : 'calleesExpanded'
    setNodes(prev => { const next = new Map(prev); const n = next.get(nodeId); if (n) next.set(nodeId, { ...n, [key]: true }); return next })
    setLoadingNodes(prev => new Set(prev).add(nodeId))
    try {
      const res = await (dir === 'callers' ? window.api.code.getCallers(nodeId, depth) : window.api.code.getCallees(nodeId, depth))
      setNodes(prev => {
        const next = new Map(prev)
        for (const item of (res.nodes || [])) {
          const n = item.node; if (!n || next.has(n.id)) continue
          next.set(n.id, { id: n.id, name: n.name, kind: n.kind, filePath: n.filePath, line: n.line ?? n.startLine, column: n.column ?? n.startColumn ?? 0, x: 0, y: 0, callersExpanded: false, calleesExpanded: false })
        }
        return next
      })
      const newEdges: GraphEdge[] = []
      for (const item of (res.nodes || [])) {
        const n = item.node; if (!n) continue
        // Use edge.source/target from the API to handle multi-level chains correctly
        const edge = item.edge ? { from: item.edge.source, to: item.edge.target } : (dir === 'callers' ? { from: n.id, to: nodeId } : { from: nodeId, to: n.id })
        if (!edgesRef.current.some(e => e.from === edge.from && e.to === edge.to)) newEdges.push(edge)
      }
      if (newEdges.length) setEdges(prev => [...prev, ...newEdges])
    } catch {}
    setLoadingNodes(prev => { const s = new Set(prev); s.delete(nodeId); return s })
  }, [])

  // ── Collapse (direction: 'callers' | 'callees') ──
  const collapse = useCallback((nodeId: string, dir: 'callers' | 'callees') => {
    const key = dir === 'callers' ? 'callersExpanded' : 'calleesExpanded'
    const keepEdges = edgesRef.current.filter(e => dir === 'callers' ? e.to !== nodeId : e.from !== nodeId)
    const adj = new Map<string, string[]>()
    for (const e of keepEdges) {
      if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to)
      if (!adj.has(e.to)) adj.set(e.to, []); adj.get(e.to)!.push(e.from)
    }
    const reachable = new Set<string>()
    const q = [focalNode.id]
    while (q.length) { const id = q.shift()!; if (reachable.has(id)) continue; reachable.add(id); for (const nb of (adj.get(id) || [])) { if (!reachable.has(nb)) q.push(nb) } }
    setNodes(prev => {
      const next = new Map(prev)
      const n = next.get(nodeId); if (n) next.set(nodeId, { ...n, [key]: false })
      for (const id of prev.keys()) { if (id !== focalNode.id && !reachable.has(id)) next.delete(id) }
      return next
    })
    setEdges(keepEdges.filter(e => reachable.has(e.from) && reachable.has(e.to)))
    setDraggedNodes(prev => { const next = new Set(prev); for (const id of prev) { if (!reachable.has(id)) next.delete(id) } return next })
  }, [focalNode.id])

  // ── Delete node (focal → close overlay) ──
  const deleteNode = useCallback((nodeId: string) => {
    if (nodeId === focalNode.id) { onClose(); return }
    const newEdges = edgesRef.current.filter(e => e.from !== nodeId && e.to !== nodeId)
    const adj = new Map<string, string[]>()
    for (const e of newEdges) {
      if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to)
      if (!adj.has(e.to)) adj.set(e.to, []); adj.get(e.to)!.push(e.from)
    }
    const reachable = new Set<string>()
    const q = [focalNode.id]
    while (q.length) { const id = q.shift()!; if (reachable.has(id)) continue; reachable.add(id); for (const nb of (adj.get(id) || [])) { if (!reachable.has(nb)) q.push(nb) } }
    setNodes(prev => { const next = new Map(prev); next.delete(nodeId); for (const id of prev.keys()) { if (!reachable.has(id)) next.delete(id) } return next })
    setEdges(newEdges)
    setDraggedNodes(prev => { const next = new Set(prev); next.delete(nodeId); for (const id of prev) { if (!reachable.has(id)) next.delete(id) } return next })
    setCtxMenu(null)
  }, [focalNode.id, onClose])

  // Has callers/callees
  const hasCallers = useCallback((nodeId: string) => edges.some(e => e.to === nodeId), [edges])
  const hasCallees = useCallback((nodeId: string) => edges.some(e => e.from === nodeId), [edges])

  // Init — default to showing callers 3 levels deep, callees 1 level
  useEffect(() => {
    setNodes(new Map([[focalNode.id, { id: focalNode.id, name: focalNode.name, kind: focalNode.kind, filePath: focalNode.filePath, line: focalNode.line, column: focalNode.column, x: 0, y: 0, callersExpanded: false, calleesExpanded: false }]]))
    setEdges([])
    setDraggedNodes(new Set())
    expand(focalNode.id, 'callers', 3)
    expand(focalNode.id, 'callees')
  }, [focalNode.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zoom
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return
    const h = (e: WheelEvent) => { e.preventDefault(); setViewBox(p => ({ ...p, scale: Math.max(0.1, Math.min(3, p.scale * (e.deltaY > 0 ? 0.9 : 1.1))) })) }
    svg.addEventListener('wheel', h, { passive: false })
    return () => svg.removeEventListener('wheel', h)
  }, [])

  // Context menu dismiss
  useEffect(() => {
    if (!ctxMenu) return
    const mm = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', mm), 0)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', mm) }
  }, [ctxMenu])

  useEffect(() => {
    if (!ctxMenu) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [ctxMenu])

  const screenToSvg = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current; if (!svg) return { x: cx, y: cy }
    const r = svg.getBoundingClientRect()
    return { x: (cx - r.left - r.width / 2) / viewBox.scale + viewBox.x, y: (cy - r.top - r.height / 2) / viewBox.scale + viewBox.y }
  }, [viewBox])

  // Mouse: left-drag nodes, right-pan view
  useEffect(() => {
    const mm = (e: MouseEvent) => {
      if (rightPanning) {
        setViewBox(p => ({ ...p, x: rightPanning.vx - (e.clientX - rightPanning.sx) / p.scale, y: rightPanning.vy - (e.clientY - rightPanning.sy) / p.scale }))
        return
      }
      if (!dragging && dragStartPos.current) {
        const dx = e.clientX - dragStartPos.current.x, dy = e.clientY - dragStartPos.current.y
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setDragging(dragStartPos.current.nodeId)
      }
      if (dragging) {
        const sp = screenToSvg(e.clientX, e.clientY)
        setNodes(prev => { const next = new Map(prev); const n = next.get(dragging); if (n) next.set(dragging, { ...n, x: sp.x, y: sp.y }); return next })
        setDraggedNodes(prev => new Set(prev).add(dragging))
      }
    }
    const mu = (e: MouseEvent) => {
      if (e.button === 0) { setDragging(null); dragStartPos.current = null }
      if (e.button === 2) { setRightPanning(null); setDragging(null); dragStartPos.current = null }
    }
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu)
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }
  }, [dragging, rightPanning, screenToSvg])

  // Right-click: node → context menu, background → start panning (capture phase)
  useEffect(() => {
    const onRightDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const svg = svgRef.current
      if (svg && svg.contains(e.target as Node)) {
        let el = e.target as Element | null
        while (el && el !== svg) {
          const nid = el.getAttribute('data-node-id')
          if (nid) { setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: nid }); return }
          el = el.parentElement
        }
      }
      setCtxMenu(null)
      const vb = viewBoxRef.current
      setRightPanning({ sx: e.clientX, sy: e.clientY, vx: vb.x, vy: vb.y })
    }
    const onCtxMenu = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation() }
    document.addEventListener('mousedown', onRightDown, true)
    document.addEventListener('contextmenu', onCtxMenu, true)
    return () => { document.removeEventListener('mousedown', onRightDown, true); document.removeEventListener('contextmenu', onCtxMenu, true) }
  }, [])

  const getPos = (gn: GraphNode & { dx: number; dy: number }) => ({
    x: draggedNodes.has(gn.id) ? gn.x : gn.dx,
    y: draggedNodes.has(gn.id) ? gn.y : gn.dy,
  })

  const allP = Array.from(displayNodes.values()).map(getPos)
  const svgW = Math.max(1200, (allP.length ? Math.max(...allP.map(p => p.x)) - Math.min(...allP.map(p => p.x)) : 0) + 200)
  const svgH = Math.max(800, (allP.length ? Math.max(...allP.map(p => p.y)) - Math.min(...allP.map(p => p.y)) : 0) + 200)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      style={{ pointerEvents: rightPanning ? 'auto' : 'none', cursor: rightPanning ? 'grabbing' : 'default' }}>
      <div className="relative flex flex-col" style={{ width: '100vw', height: '100vh' }}>
        <button onClick={onClose} style={{ pointerEvents: 'auto' }} className="absolute top-11 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-black/30 text-red-400/70 hover:text-red-300 hover:bg-black/50 transition-colors">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
        </button>
        <div className="flex-1 overflow-hidden">
          <svg ref={svgRef}
            viewBox={`${viewBox.x - svgW / 2 / viewBox.scale} ${viewBox.y - svgH / 2 / viewBox.scale} ${svgW / viewBox.scale} ${svgH / viewBox.scale}`}
            className="w-full h-full"
            style={{ pointerEvents: rightPanning ? 'auto' : 'none' }}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#555"/></marker>
            </defs>
            {edges.map((e, i) => {
              const fn = displayNodes.get(e.from), tn = displayNodes.get(e.to)
              if (!fn || !tn) return null
              const fp = getPos(fn), tp = getPos(tn)
              const x1 = fp.x + NODE_W / 2, x2 = tp.x - NODE_W / 2, midX = (x1 + x2) / 2
              return <path key={`e${i}`} d={`M${x1},${fp.y} C${midX},${fp.y} ${midX},${tp.y} ${x2},${tp.y}`} fill="none" stroke="#555" strokeWidth={1.4} markerEnd="url(#arrowhead)" opacity={0.55}/>
            })}
            {Array.from(displayNodes.values()).map(gn => {
              const isFocal = gn.id === focalNode.id
              const p = getPos(gn)
              const color = getKindColor(gn.kind)
              const name = gn.name.length > 20 ? gn.name.slice(0, 18) + '…' : gn.name
              const loading = loadingNodes.has(gn.id)
              const canLeft = true
              const canRight = true
              const callersActive = gn.callersExpanded && hasCallers(gn.id)
              const isHovered = hoveredNode === gn.id
              const isIconHovered = iconHoveredNode === gn.id
              const showTrash = callersActive && isIconHovered
              const iconBg = callersActive ? (showTrash ? '#fff1' : `${color}18`) : isIconHovered ? `${color}10` : 'transparent'
              const iconStroke = callersActive ? (showTrash ? '#f88' : `${color}40`) : 'transparent'
              return (
                <g key={gn.id} data-node-id={gn.id} transform={`translate(${p.x - NODE_W / 2},${p.y - NODE_H / 2})`} style={{ pointerEvents: 'auto' }}
                  onMouseDown={(e) => { e.stopPropagation(); if (e.button === 0) dragStartPos.current = { x: e.clientX, y: e.clientY, nodeId: gn.id } }}
                  onClick={() => onJumpToFile(gn.filePath, gn.line)}
                  onMouseEnter={() => handleNodeEnter(gn.id)} onMouseLeave={handleNodeLeave}>
                  <rect x={0} y={0} width={NODE_W} height={NODE_H} rx={7} ry={7}
                    fill={isFocal ? `${color}20` : '#1a1a2ecc'} stroke={isFocal ? color : '#444'} strokeWidth={isFocal ? 2 : 1.2} opacity={0.92}/>
                  {loading
                    ? <text x={NODE_W/2} y={NODE_H/2+4} fill="#888" fontSize={11} textAnchor="middle" fontFamily={MONACO_FONT}>loading...</text>
                    : <>
                        {/* Left: kind icon doubles as caller expand/collapse */}
                        {!loading && canLeft ? (
                          <g onClick={(e) => { e.stopPropagation(); callersActive ? collapse(gn.id, 'callers') : expand(gn.id, 'callers') }}
                            onMouseEnter={() => setIconHoveredNode(gn.id)} onMouseLeave={() => setIconHoveredNode(null)}
                            className={`cursor-pointer ${callersActive && !isIconHovered ? '' : (isIconHovered ? 'text-ide-accent' : 'text-ide-accent/70')}`}>
                            <rect x={5} y={5} width={20} height={20} rx={4} ry={4} fill={iconBg} stroke={iconStroke} strokeWidth={isIconHovered ? 1.2 : 1}/>
                            {showTrash ? (
                              <svg x={7} y={6} width={16} height={18} viewBox="0 0 16 16">
                                <path d="M3 5h10M5 5v9a1 1 0 001 1h4a1 1 0 001-1V5M7 5V3a1 1 0 011-1h1a1 1 0 011 1v2" fill="none" stroke="#f88" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round"/>
                                <line x1="6" y1="8" x2="6" y2="12" stroke="#f88" strokeWidth={1} strokeLinecap="round" opacity={0.6}/>
                                <line x1="8" y1="8" x2="8" y2="12" stroke="#f88" strokeWidth={1} strokeLinecap="round" opacity={0.6}/>
                                <line x1="10" y1="8" x2="10" y2="12" stroke="#f88" strokeWidth={1} strokeLinecap="round" opacity={0.6}/>
                              </svg>
                            ) : (
                              <svg x={5} y={5} width={20} height={20} viewBox="0 0 16 16" opacity={callersActive ? 1 : isIconHovered ? 1 : 0.7}>
                                {kindIconPaths(gn.kind, callersActive ? color : 'currentColor')}
                              </svg>
                            )}
                          </g>
                        ) : (
                          <svg x={6} y={7} width={14} height={14} viewBox="0 0 16 16" opacity={0.35}>{kindIconPaths(gn.kind, color)}</svg>
                        )}
                        <text x={loading ? NODE_W/2 : 30} y={20} fill="#c8c8d0" fontSize={11} fontFamily={MONACO_FONT} textAnchor={loading ? 'middle' : 'start'}>{name}</text>
                        {/* Right: callees +/- */}
                        {!loading && canRight && (
                          <g onClick={(e) => { e.stopPropagation(); gn.calleesExpanded ? collapse(gn.id, 'callees') : expand(gn.id, 'callees') }}>
                            <rect x={NODE_W - 20} y={0} width={20} height={NODE_H} rx={7} ry={7} fill="transparent"/>
                            <text x={NODE_W - 10} y={16} fill="#888" fontSize={gn.calleesExpanded ? 14 : 13} textAnchor="middle" fontFamily={MONACO_FONT} fontWeight="bold" style={{ pointerEvents: 'none' }}>{gn.calleesExpanded ? '−' : '+'}</text>
                          </g>
                        )}
                      </>
                  }
                </g>
              )
            })}

            {/* Tooltip layer — rendered last to be on top */}
            {tooltipNode && (() => {
              const tn = displayNodes.get(tooltipNode)
              if (!tn) return null
              const tp = getPos(tn)
              const label = `${tn.filePath}:${tn.line}`
              const tw = label.length * 6.5 + 16
              return (
                <g transform={`translate(${tp.x - tw/2},${tp.y + NODE_H/2 + 5})`} style={{ pointerEvents: 'none' }}>
                  <rect x={0} y={0} width={tw} height={18} rx={4} ry={4} fill="#111" stroke="#444" strokeWidth={1} opacity={0.95}/>
                  <text x={tw/2} y={12} fill="#aaa" fontSize={10} fontFamily={MONACO_FONT} textAnchor="middle">{label}</text>
                </g>
              )
            })()}
          </svg>
        </div>

        {/* Context Menu */}
        {ctxMenu && (
          <div ref={ctxMenuRef} style={{ position: 'fixed', pointerEvents: 'auto', left: Math.min(ctxMenu.x, window.innerWidth - 140), top: Math.min(ctxMenu.y, window.innerHeight - 60), zIndex: 100 }}
            className="bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[120px]">
            <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-ide-hover transition-colors"
              onClick={() => deleteNode(ctxMenu.nodeId)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-3.5 h-3.5">
                <path d="M3 5h10M5 5v9a1 1 0 001 1h4a1 1 0 001-1V5M7 5V3a1 1 0 011-1h1a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="6" y1="8" x2="6" y2="12" strokeLinecap="round" opacity={0.6}/>
                <line x1="8" y1="8" x2="8" y2="12" strokeLinecap="round" opacity={0.6}/>
                <line x1="10" y1="8" x2="10" y2="12" strokeLinecap="round" opacity={0.6}/>
              </svg>
              {ctxMenu.nodeId === focalNode.id ? 'Exit' : 'Delete'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default CallGraphOverlay
