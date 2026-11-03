import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Share2, Box, CircleDot, Variable, Lock, Diamond, List, Folder, Component, Link2, Circle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CodeSymbol } from '@shared/types'
import { getKindColorHex } from '../utils/kindColors'
import { useTheme } from '../themes/context'
import { useI18n } from '../i18n'

const NODE_H = 26
const NODE_W = 150
const MIN_W = 108
const MAX_W = 248
/** 两列之间的空隙 */
const RANK_GAP = 34
/** 同列两个节点之间的竖向空隙 */
const NODE_SEP = 8
const HEADER_H = 34
const FONT_SIZE = 12
/** LSP 侧初始自动铺开：调用者 2 层、被调用者 1 层（与 codegraph 一致），每方向节点总数封顶。
 *  再往里的靠点节点上的 + 手动展开。
 *  codegraph 那条不走这里 —— 它一次请求就能拿到三层调用者链，保持原样别动 */
const LSP_AUTO_DEPTH_CALLERS = 2
const LSP_AUTO_DEPTH_CALLEES = 1
const LSP_AUTO_BUDGET = 45
/** 文本可用横向空间 = 卡片宽 - 左图标片 - 两侧留白（右侧展开按钮外置，不占位） */
const PAD_L = 26
const PAD_R = 14
const TEXT_MAX = MAX_W - PAD_L - PAD_R
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
/** codegraph 节点 kind：file 是文件符号，调用图不放文件 */
const SKIP_KINDS = new Set(['file'])
/** 节点名用 UI 字体（等宽在这个尺寸下显得生硬）；坐标/行号仍用等宽 */
const MONO_FONT = "'Consolas', 'Cascadia Code', 'Fira Code', 'Cascadia Mono', 'Courier New', monospace"

// 按字数估宽在 UI 字体 + 中英混排下必然失真（文字会压到两端的按钮上），改成 canvas 量真实宽度
let measureCtx: CanvasRenderingContext2D | null = null
function textWidth(s: string, fontStack: string, size = FONT_SIZE): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return s.length * size * 0.6
  measureCtx.font = `${size}px ${fontStack}`
  return measureCtx.measureText(s).width
}

/** 超出可用宽度就二分截断加省略号，保证名字永远塞得进卡片 */
function fitName(name: string, fontStack: string, maxPx: number): string {
  if (textWidth(name, fontStack) <= maxPx) return name
  let lo = 0, hi = name.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (textWidth(name.slice(0, mid) + '…', fontStack) <= maxPx) lo = mid
    else hi = mid - 1
  }
  return name.slice(0, lo) + '…'
}

function nodeWidth(name: string, fontStack: string): number {
  return clamp(PAD_L + textWidth(fitName(name, fontStack, TEXT_MAX), fontStack) + PAD_R, MIN_W, MAX_W)
}

/** Read CSS variable "R G B" triplet → { r, g, b, hex } */
function cssRgb(varName: string): { r: number; g: number; b: number; hex: string } {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  const parts = raw.split(/\s+/)
  if (parts.length >= 3) {
    const r = parseInt(parts[0]), g = parseInt(parts[1]), b = parseInt(parts[2])
    if (!isNaN(r) && !isNaN(g) && !isNaN(b))
      return { r, g, b, hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') }
  }
  const hex = raw.startsWith('#') ? raw : '#888888'
  return { r: 136, g: 136, b: 136, hex }
}

/** Read CSS variable "R G B" triplet → hex string */
function cssRgbToHex(varName: string): string { return cssRgb(varName).hex }

const KIND_ICONS: Record<string, LucideIcon> = {
  // 调用关系本身：左根 → 右两个叶子
  function: Share2,
  method: Share2,
  class: Box,
  interface: CircleDot,
  variable: Variable,
  constant: Lock,
  type: Diamond,
  type_alias: Diamond,
  enum: List,
  module: Folder,
  component: Component,
  property: CircleDot,
  // 使用处（引用位置，不是符号）
  ref: Link2,
}

function KindIcon({ kind, color, x, y, size }: { kind: string; color: string; x: number; y: number; size: number }) {
  const Icon = KIND_ICONS[kind] || Circle
  return <Icon x={x} y={y} width={size} height={size} color={color} strokeWidth={2} />
}

interface GraphNode {
  id: string; name: string; kind: string
  filePath: string; line: number; column: number
  detail?: string        // 容器名（LSP 才有：所属类/模块）
  opaque?: boolean       // 使用处节点：只是一个位置，没有可展开的调用关系
  callersSealed?: boolean  // 问过了，这个方向确实没有可展开的（空结果 / 目标全在工程外），别再显示按钮
  calleesSealed?: boolean
  x: number; y: number   // 布局坐标，只在新节点落位和用户拖动时写 —— 见 placeChild
  callersExpanded: boolean
  calleesExpanded: boolean
}
interface GraphEdge { from: string; to: string }
/** 展开一层拿到的节点（两种数据源归一成同一形状） */
type FetchedNode = Pick<GraphNode, 'id' | 'name' | 'kind' | 'filePath' | 'line' | 'column' | 'detail' | 'opaque'>
/** 参与避让的已落位卡片 */
interface Placed { x: number; y: number; w: number }

export type CallGraphSource = 'codegraph' | 'lsp'

interface CallGraphOverlayProps {
  focalNode: CodeSymbol
  /** codegraph = 后台索引（需先建索引）；lsp = 语言服务器实时查询 */
  source?: CallGraphSource
  /** LSP 徽标上的服务器名（tsserver / clangd / pyright） */
  serverLabel?: string
  onClose: () => void
  onJumpToFile: (fullPath: string, line: number) => void
}

/** 新节点挂在父节点旁边：出边往右、入边往左，纵向从父节点那一行向外找第一个空位。
 *  刻意不做全局重排 —— 每次展开都重排的话，用户刚记住的位置全变，得重新找 */
function placeChild(parent: Placed, dir: 'callers' | 'callees', childW: number, placed: Placed[]): { x: number; y: number } {
  const x = dir === 'callees'
    ? parent.x + parent.w / 2 + RANK_GAP + childW / 2
    : parent.x - parent.w / 2 - RANK_GAP - childW / 2
  const step = NODE_H + NODE_SEP
  // 真实占位判定：横向卡片重叠 且 纵向不足一个空隙
  const hits = (y: number) => placed.some(o =>
    Math.abs(o.x - x) < (o.w + childW) / 2 + 10 && Math.abs(o.y - y) < NODE_H + NODE_SEP - 2)
  if (!hits(parent.y)) return { x, y: parent.y }
  for (let i = 1; i <= 80; i++) {
    if (!hits(parent.y + i * step)) return { x, y: parent.y + i * step }
    if (!hits(parent.y - i * step)) return { x, y: parent.y - i * step }
  }
  return { x, y: parent.y + 81 * step }
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p

function CallGraphOverlay({ focalNode, source = 'codegraph', serverLabel, onClose, onJumpToFile }: CallGraphOverlayProps) {
  const { currentThemeId } = useTheme()
  const { t } = useI18n()
  const th = useMemo(() => {
    const accent = cssRgb('--ide-accent')
    const sidebar = cssRgbToHex('--ide-sidebar')
    const bg = cssRgbToHex('--ide-bg')
    const border = cssRgbToHex('--ide-border')
    const text = cssRgbToHex('--ide-text')
    const textMuted = cssRgbToHex('--ide-text-muted')
    return {
      accent, sidebar, bg, border, text, textMuted,
      accentRgba: (opacity: number) => `rgba(${accent.r},${accent.g},${accent.b},${opacity})`,
    }
  }, [currentThemeId])

  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map())
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set())
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 })
  const [bodySize, setBodySize] = useState({ w: 900, h: 520 })
  const [interaction, setInteraction] = useState<
    | { kind: 'node'; nodeId: string }
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | null
  >(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [tooltipNode, setTooltipNode] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const edgesRef = useRef(edges); edgesRef.current = edges
  const viewBoxRef = useRef(viewBox); viewBoxRef.current = viewBox
  /** 按住但还没越过 4px 阈值的节点：直接点=跳转，拖动=挪节点 */
  const pendingNode = useRef<{ x: number; y: number; nodeId: string } | null>(null)
  /** 挪过节点的这次按下不该再触发跳转（click 在 mouseup 之后照常派发） */
  const draggedRef = useRef(false)
  /** 用户自己动过视角（滚轮/平移）后就不再自动取景，免得把人拽回去 */
  const userMoved = useRef(false)

  const handleNodeEnter = useCallback((nodeId: string) => {
    setHovered(nodeId)
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setTooltipNode(nodeId), 300)
  }, [])
  const handleNodeLeave = useCallback(() => {
    setHovered(null)
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setTooltipNode(null)
  }, [])

  // 量字宽和画文字必须用同一个字体栈：直接取 body 的 computed 值（globals.css 里那串的最终形态），
  // 手抄一份迟早和样式表对不上
  const fontStack = useMemo(
    () => getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif',
    [currentThemeId],
  )

  // 卡片宽度与展示名同源：量过再截断，宽度才刚好容得下画出来的那串字
  const { widths, labels } = useMemo(() => {
    const w = new Map<string, number>()
    const l = new Map<string, string>()
    for (const [id, gn] of nodes) {
      l.set(id, fitName(gn.name, fontStack, TEXT_MAX))
      w.set(id, nodeWidth(gn.name, fontStack))
    }
    return { widths: w, labels: l }
  }, [nodes, fontStack])

  // 画布实际尺寸 —— viewBox 按它换算，屏幕坐标 ↔ 世界坐标才是 1:1（无留白、拖动跟手）
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const sync = () => setBodySize({ w: el.clientWidth || 900, h: el.clientHeight || 520 })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Expand (direction: 'callers' | 'callees')：拉一层，返回这一层里可继续展开的节点 ──
  const expand = useCallback(async (nodeId: string, dir: 'callers' | 'callees', depth: number = 1): Promise<FetchedNode[]> => {
    const key = dir === 'callers' ? 'callersExpanded' : 'calleesExpanded'
    const sealedKey = dir === 'callers' ? 'callersSealed' : 'calleesSealed'
    setNodes(prev => { const next = new Map(prev); const n = next.get(nodeId); if (n) next.set(nodeId, { ...n, [key]: true }); return next })
    setLoadingNodes(prev => new Set(prev).add(`${nodeId}|${dir}`))

    let fetched: FetchedNode[] = []
    let newEdges: GraphEdge[] = []
    let ok = false
    let viaRefs = false
    try {
      if (source === 'lsp') {
        // 协议没有 depth，一次只拉一层；再往里靠用户点节点上的按钮
        const r = dir === 'callers'
          ? await window.api.lsp.callIncoming({ nodeId })
          : await window.api.lsp.callOutgoing({ nodeId })
        if (r?.state === 'ok') {
          // 引用兜底：拿到的是一批「使用处」位置，不能再往下展开
          fetched = r.via === 'refs' ? r.nodes.map(n => ({ ...n, opaque: true })) : r.nodes
          newEdges = r.nodes.map(n => (dir === 'callers' ? { from: n.id, to: nodeId } : { from: nodeId, to: n.id }))
          ok = true
          if (r.via === 'refs') {
            viaRefs = true
            setNotice(t('Components used as JSX produce no call edges — showing reference sites instead'))
          }
        } else if (r?.state === 'warming') {
          setNotice(t('Language server starting — retry in a moment'))
        }
      } else {
        const res = await (dir === 'callers' ? window.api.code.getCallers(nodeId, depth) : window.api.code.getCallees(nodeId, depth))
        ok = !res.error
        const raw = (res.nodes || []) as any[]
        fetched = raw
          .map(item => item?.node)
          .filter(n => n && !SKIP_KINDS.has(n.kind))
          .map(n => ({ id: n.id, name: n.name, kind: n.kind, filePath: n.filePath, line: n.line ?? n.startLine, column: n.column ?? n.startColumn ?? 0 }))
        // 用接口给的 edge.source/target，多级链（depth>1）才连得对
        newEdges = raw
          .filter(item => item?.node && !SKIP_KINDS.has(item.node.kind))
          .map(item => (item.edge
            ? { from: item.edge.source, to: item.edge.target }
            : (dir === 'callers' ? { from: item.node.id, to: nodeId } : { from: nodeId, to: item.node.id })))
      }
    } catch {
    } finally {
      setLoadingNodes(prev => { const s = new Set(prev); s.delete(`${nodeId}|${dir}`); return s })
    }
    if (!ok) {
      // 这次没问出来（服务器在起 / 索引没好）：把展开态退回去，否则节点显示成已展开却没有子节点
      setNodes(prev => { const next = new Map(prev); const n = next.get(nodeId); if (n) next.set(nodeId, { ...n, [key]: false }); return next })
      return []
    }
    // 引用兜底刚设的提示别被这里抹掉
    if (!viaRefs) setNotice(null)

    const usable = fetched.filter(n => !SKIP_KINDS.has(n.kind))
    // 问过了、这个方向确实没东西可展开（空结果，或目标全在工程外被滤掉）→ 记下来，别再显示展开按钮
    const sealed = usable.length === 0
    const fresh = usable.filter(n => !nodesRef.current.has(n.id))

    // 落位必须放在 updater 里：同层是并行展开的，两个兄弟同时读 nodesRef 会把新节点摆到同一格
    setNodes(prev => {
      const next = new Map(prev)
      const placed: Placed[] = []
      for (const gn of next.values()) placed.push({ x: gn.x, y: gn.y, w: nodeWidth(gn.name, fontStack) })
      const parent = next.get(nodeId)
      if (parent) {
        const pw = nodeWidth(parent.name, fontStack)
        for (const n of usable) {
          if (next.has(n.id)) continue
          const cw = nodeWidth(n.name, fontStack)
          const pos = placeChild({ x: parent.x, y: parent.y, w: pw }, dir, cw, placed)
          const gn: GraphNode = { ...n, x: pos.x, y: pos.y, callersExpanded: false, calleesExpanded: false }
          next.set(n.id, gn)
          placed.push({ x: pos.x, y: pos.y, w: cw })
        }
      }
      const cur = next.get(nodeId)
      if (cur && cur[sealedKey] !== sealed) next.set(nodeId, { ...cur, [sealedKey]: sealed })
      return next
    })
    // 自环（递归）画出来是个退化的零长贝塞尔，直接丢。
    // 这里不再判端点是否已入图 —— 同一层是并行展开的，彼此的节点还没落进 nodesRef；
    // 谁真在图上由渲染期的 liveEdges 定
    setEdges(prev => {
      const next = [...prev]
      for (const e of newEdges) {
        if (e.from === e.to) continue
        if (!next.some(x => x.from === e.from && x.to === e.to)) next.push(e)
      }
      return next
    })
    // 只有这一层里新出现的、且还能继续展开的节点才值得再往下一层走
    return sealed ? [] : fresh.filter(n => !n.opaque)
  }, [source, t, fontStack])

  // 初始展开：一层层拉，节点总数封顶 —— 免得大工程里一个公共函数把图撑到几百个节点
  const expandLevels = useCallback(async (rootId: string, dir: 'callers' | 'callees', depth: number, budget: number) => {
    let frontier = [rootId]
    let spent = 0
    for (let d = 0; d < depth && frontier.length; d++) {
      const rounds = await Promise.all(frontier.map(id => expand(id, dir, 1)))
      // 同层是并行拉的，两个兄弟可能都拉回同一个节点，下一层要去重否则会重复发请求
      frontier = [...new Set(rounds.flat().map(n => n.id))]
      spent += frontier.length
      if (spent >= budget) break
    }
  }, [expand])

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
    setCtxMenu(null)
  }, [focalNode.id, onClose])

  // 两条边都真的落在图上的才算数：服务器可能给出被 SKIP_KINDS 挡掉的端点，那种边不画也不计数
  const liveEdges = useMemo(
    () => edges.filter(e => nodes.has(e.from) && nodes.has(e.to)),
    [edges, nodes],
  )

  // 把整张图取景到可视区。只在首次铺开后自动做一次
  const fitView = useCallback(() => {
    const list = [...nodesRef.current.values()]
    if (!list.length) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const gn of list) {
      const w = nodeWidth(gn.name, fontStack)
      minX = Math.min(minX, gn.x - w / 2); maxX = Math.max(maxX, gn.x + w / 2)
      minY = Math.min(minY, gn.y - NODE_H / 2); maxY = Math.max(maxY, gn.y + NODE_H / 2)
    }
    const pad = 36
    const body = bodyRef.current
    const vw = body?.clientWidth || bodySize.w
    const vh = body?.clientHeight || bodySize.h
    const scale = clamp(Math.min(vw / (maxX - minX + pad * 2), vh / (maxY - minY + pad * 2)), 0.35, 1)
    setViewBox({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale })
  }, [fontStack, bodySize.w, bodySize.h])
  const fitViewRef = useRef(fitView); fitViewRef.current = fitView

  // Init — LSP 逐层自动铺开（协议一次只给一层，只能自己一层层问）；
  // codegraph 一次请求就带三层调用者链，保持原样。
  // 铺完再取景一次，把整张图放进视野（节点是逐步落位的，中途取景会取到半张图）
  useEffect(() => {
    setNodes(new Map([[focalNode.id, { id: focalNode.id, name: focalNode.name, kind: focalNode.kind, filePath: focalNode.filePath, line: focalNode.line, column: focalNode.column, x: 0, y: 0, callersExpanded: false, calleesExpanded: false }]]))
    setEdges([])
    setNotice(null)
    userMoved.current = false
    const run = async () => {
      if (source === 'lsp') {
        await Promise.all([
          expandLevels(focalNode.id, 'callers', LSP_AUTO_DEPTH_CALLERS, LSP_AUTO_BUDGET),
          expandLevels(focalNode.id, 'callees', LSP_AUTO_DEPTH_CALLEES, LSP_AUTO_BUDGET),
        ])
      } else {
        await Promise.all([expand(focalNode.id, 'callers', 3), expand(focalNode.id, 'callees', 1)])
      }
      if (!userMoved.current) fitViewRef.current()
    }
    void run()
  }, [focalNode.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 4px 阈值：按住即算点击跳转，拖开才升级成挪节点
  useEffect(() => {
    const mm = (e: MouseEvent) => {
      const p = pendingNode.current
      if (p && !interaction && (Math.abs(e.clientX - p.x) > 4 || Math.abs(e.clientY - p.y) > 4)) {
        draggedRef.current = true
        setInteraction({ kind: 'node', nodeId: p.nodeId })
      }
    }
    const mu = () => { pendingNode.current = null }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }
  }, [interaction])

  // 拖动节点 / 平移画布共用一个 window 监听（都要能跑到画布外）
  useEffect(() => {
    if (!interaction) return
    const mm = (e: MouseEvent) => {
      if (interaction.kind === 'pan') {
        const s = viewBoxRef.current.scale
        setViewBox(p => ({ ...p, x: interaction.vx - (e.clientX - interaction.sx) / s, y: interaction.vy - (e.clientY - interaction.sy) / s }))
      } else {
        const svg = svgRef.current
        if (!svg) return
        const r = svg.getBoundingClientRect()
        const vb = viewBoxRef.current
        const wx = (e.clientX - r.left - r.width / 2) / vb.scale + vb.x
        const wy = (e.clientY - r.top - r.height / 2) / vb.scale + vb.y
        setNodes(prev => { const next = new Map(prev); const n = next.get(interaction.nodeId); if (n) next.set(interaction.nodeId, { ...n, x: wx, y: wy }); return next })
      }
    }
    const mu = () => setInteraction(null)
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }
  }, [interaction])

  // Wheel zoom —— 锚在光标处，缩放时指针下的内容不动
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return
    const h = (e: WheelEvent) => {
      e.preventDefault()
      userMoved.current = true
      const r = svg.getBoundingClientRect()
      const vb = viewBoxRef.current
      const next = clamp(vb.scale * (e.deltaY > 0 ? 0.9 : 1.1), 0.2, 2.5)
      if (next === vb.scale) return
      const wx = (e.clientX - r.left - r.width / 2) / vb.scale + vb.x
      const wy = (e.clientY - r.top - r.height / 2) / vb.scale + vb.y
      setViewBox({ scale: next, x: wx - (e.clientX - r.left - r.width / 2) / next, y: wy - (e.clientY - r.top - r.height / 2) / next })
    }
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

  // 右键：节点 → 菜单，空白 → 关菜单
  const handleRightDown = (e: React.MouseEvent) => {
    if (e.button !== 2) return
    e.preventDefault()
    e.stopPropagation()
    const box = boxRef.current
    let el = e.target as Element | null
    while (el && el !== box) {
      const nid = el.getAttribute('data-node-id')
      if (nid) { setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: nid }); return }
      el = el.parentElement
    }
    setCtxMenu(null)
  }

  // 左键：空白处按下拖动整块画板（节点自己 stopPropagation，不会误触）
  const handleCanvasDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    userMoved.current = true
    const vb = viewBoxRef.current
    setInteraction({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: vb.x, vy: vb.y })
  }

  const isEmpty = nodes.size <= 1 && liveEdges.length === 0 && loadingNodes.size === 0
  const badge = t('by {name}').replace('{name}', source === 'lsp' ? `LSP · ${serverLabel ?? 'language server'}` : 'CodeGraph')

  const vb = viewBox
  const svgViewBox = `${vb.x - bodySize.w / 2 / vb.scale} ${vb.y - bodySize.h / 2 / vb.scale} ${bodySize.w / vb.scale} ${bodySize.h / vb.scale}`

  return (
    <div
      ref={boxRef}
      className="flex flex-col w-full h-full bg-ide-sidebar overflow-hidden animate-fade-in"
      onMouseDownCapture={handleRightDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 border-b border-ide-border shrink-0 select-none"
        style={{ height: HEADER_H }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-3.5 h-3.5 text-ide-accent shrink-0">
          <circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" />
          <path d="M6 8.5v3a2 2 0 002 2h8a2 2 0 002-2v-3M12 13.5v2" />
        </svg>
        <span className="text-[12.5px] font-medium text-ide-text truncate min-w-0">{focalNode.name}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-ide-text-muted/80">{focalNode.kind}</span>
        <span className="shrink-0 text-[10px] text-ide-text-muted/55">{badge}</span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          title="Esc"
          className="ml-auto shrink-0 w-6 h-6 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="flex-1 relative overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full block"
          viewBox={svgViewBox}
          onMouseDown={handleCanvasDown}
          style={{ cursor: interaction?.kind === 'pan' ? 'grabbing' : 'grab' }}
        >
          <defs>
            <marker id="cg-arrow" markerWidth="7" markerHeight="7" refX="6.2" refY="3" orient="auto">
              <path d="M0.5 0.8 L6.2 3 L0.5 5.2" fill="none" stroke={th.textMuted} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
            </marker>
            <marker id="cg-arrow-active" markerWidth="7" markerHeight="7" refX="6.2" refY="3" orient="auto">
              <path d="M0.5 0.8 L6.2 3 L0.5 5.2" fill="none" stroke={th.accent.hex} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>

          {liveEdges.map((e, i) => {
            const fn = nodes.get(e.from)!, tn = nodes.get(e.to)!
            const fw = widths.get(e.from) ?? NODE_W, tw = widths.get(e.to) ?? NODE_W
            const x1 = fn.x + fw / 2, x2 = tn.x - tw / 2
            const dx = Math.max(18, Math.abs(x2 - x1) * 0.45)
            const active = hovered === e.from || hovered === e.to
            return (
              <path
                key={`${e.from}->${e.to}:${i}`}
                d={`M${x1},${fn.y} C${x1 + dx},${fn.y} ${x2 - dx},${tn.y} ${x2},${tn.y}`}
                fill="none"
                stroke={active ? th.accent.hex : th.textMuted}
                strokeWidth={active ? 1.5 : 1}
                markerEnd={active ? 'url(#cg-arrow-active)' : 'url(#cg-arrow)'}
                opacity={hovered ? (active ? 0.9 : 0.12) : 0.4}
              />
            )
          })}

          {Array.from(nodes.values()).map(gn => {
            const isFocal = gn.id === focalNode.id
            const fw = widths.get(gn.id) ?? NODE_W
            const kindColor = getKindColorHex(gn.kind)
            const loadingCallers = loadingNodes.has(`${gn.id}|callers`)
            const loadingCallees = loadingNodes.has(`${gn.id}|callees`)
            const isHovered = hovered === gn.id
            const adjacent = !!hovered && !isHovered && liveEdges.some(e => (e.from === hovered && e.to === gn.id) || (e.to === hovered && e.from === gn.id))
            const dim = !!hovered && !isFocal && !isHovered && !adjacent
            const name = labels.get(gn.id) ?? gn.name
            const chipY = (NODE_H - 16) / 2
            return (
              <g
                key={gn.id}
                data-node-id={gn.id}
                transform={`translate(${gn.x - fw / 2},${gn.y - NODE_H / 2})`}
                style={{ cursor: 'pointer', opacity: dim ? 0.32 : 1 }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  if (e.button !== 0) return
                  draggedRef.current = false
                  pendingNode.current = { x: e.clientX, y: e.clientY, nodeId: gn.id }
                }}
                onClick={() => { if (!draggedRef.current) onJumpToFile(gn.filePath, gn.line) }}
                onMouseEnter={() => handleNodeEnter(gn.id)}
                onMouseLeave={handleNodeLeave}
              >
                <rect
                  x={0} y={0} width={fw} height={NODE_H} rx={3}
                  fill={th.bg}
                  stroke={isFocal || isHovered || adjacent ? th.accent.hex : th.border}
                  strokeWidth={isFocal ? 1.5 : 1}
                />
                {isFocal && <rect x={1} y={1} width={fw - 2} height={NODE_H - 2} rx={2} fill={th.accent.hex} opacity={0.07} />}
                {/* 文字先画、两端按钮后画；再套一层嵌套 svg 当裁剪视口 —— 量宽已保证放得下，
                    这层是硬兜底：字体度量若有偏差只会把名字截掉，绝不压到两端的按钮上 */}
                <svg
                  x={PAD_L} y={0} width={Math.max(8, fw - PAD_L - PAD_R)} height={NODE_H}
                  style={{ pointerEvents: 'none' }}
                >
                  <text
                    x={0} y={NODE_H / 2 + 4}
                    fill={th.text} fontSize={FONT_SIZE}
                    fontWeight={isFocal ? 600 : 400}
                    style={{ fontFamily: fontStack }}
                  >{name}</text>
                </svg>
                {/* kind 图标只作标识；调用者方向的展开/收起在框外左侧的 +/− 按钮，
                    与右侧对称（− 即收起调用者链，等同原来的垃圾桶） */}
                <KindIcon kind={gn.kind} color={kindColor} x={4} y={(NODE_H - 18) / 2} size={18} />
                {gn.opaque ? null : loadingCallers ? (
                  <circle cx={-7} cy={NODE_H / 2} r={2.2} fill={th.accent.hex} className="animate-pulse" />
                ) : !gn.callersSealed ? (
                  <g
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); gn.callersExpanded ? collapse(gn.id, 'callers') : expand(gn.id, 'callers') }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect x={-15} y={chipY} width={16} height={16} rx={2} fill={th.bg} stroke={gn.callersExpanded ? th.accent.hex : th.border} strokeWidth={1} />
                    <text
                      x={-7} y={NODE_H / 2 + 3.8}
                      fill={gn.callersExpanded ? th.accent.hex : th.textMuted}
                      fontSize={12} fontWeight="600" textAnchor="middle"
                      style={{ fontFamily: MONO_FONT, pointerEvents: 'none' }}
                    >{gn.callersExpanded ? '−' : '+'}</text>
                  </g>
                ) : null}
                {/* 右：展开/收起被调用者，挂在框外右侧、常显。使用处节点没有关系可拉；
                    问过确实没有被调用者的节点也不再显示 */}
                {gn.opaque ? null : loadingCallees ? (
                  <circle cx={fw + 8} cy={NODE_H / 2} r={2.2} fill={th.accent.hex} className="animate-pulse" />
                ) : !gn.calleesSealed ? (
                  <g
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); gn.calleesExpanded ? collapse(gn.id, 'callees') : expand(gn.id, 'callees') }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect x={fw - 1} y={chipY} width={16} height={16} rx={2} fill={th.bg} stroke={gn.calleesExpanded ? th.accent.hex : th.border} strokeWidth={1} />
                    <text
                      x={fw + 7} y={NODE_H / 2 + 3.8}
                      fill={gn.calleesExpanded ? th.accent.hex : th.textMuted}
                      fontSize={12}
                      fontWeight="600" textAnchor="middle"
                      style={{ fontFamily: MONO_FONT, pointerEvents: 'none' }}
                    >{gn.calleesExpanded ? '−' : '+'}</text>
                  </g>
                ) : null}
              </g>
            )
          })}

          {/* Tooltip layer — rendered last to be on top */}
          {tooltipNode && (() => {
            const tn = nodes.get(tooltipNode)
            if (!tn) return null
            const label = `${baseName(tn.filePath)}:${tn.line}${tn.detail ? ` · ${tn.detail}` : ''}`
            const tw = Math.min(textWidth(label, MONO_FONT, 10) + 16, 460)
            return (
              <g transform={`translate(${tn.x - tw / 2},${tn.y + NODE_H / 2 + 5})`} style={{ pointerEvents: 'none' }}>
                <rect x={0} y={0} width={tw} height={18} rx={2} fill={th.bg} stroke={th.border} strokeWidth={1} />
                <text x={tw / 2} y={12.2} fill={th.textMuted} fontSize={10} textAnchor="middle" style={{ fontFamily: MONO_FONT }}>{label}</text>
              </g>
            )
          })()}
        </svg>

        {notice && (
          <div className="absolute left-3 top-3 px-2.5 py-1.5 rounded-md bg-ide-bg/95 border border-ide-border text-[11px] text-ide-text-muted shadow-lg max-w-[380px]">
            {notice}
          </div>
        )}
        {isEmpty && !notice && source !== 'lsp' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-ide-text-muted">{t('No callers or callees in the index')}</span>
          </div>
        )}
        <div className="absolute left-3 bottom-2 text-[10px] text-ide-text-muted/70 pointer-events-none select-none">
          {t('Drag empty space to pan · Scroll to zoom · Click a node to open it')}
        </div>
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          style={{ position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 150), top: Math.min(ctxMenu.y, window.innerHeight - 60), zIndex: 100 }}
          className="bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[130px]"
        >
          <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-danger hover:bg-ide-hover transition-colors"
            onClick={() => deleteNode(ctxMenu.nodeId)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-3.5 h-3.5">
              <path d="M3 5h10M5 5v9a1 1 0 001 1h4a1 1 0 001-1V5M7 5V3a1 1 0 011-1h1a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="6" y1="8" x2="6" y2="12" strokeLinecap="round" opacity={0.6} />
              <line x1="8" y1="8" x2="8" y2="12" strokeLinecap="round" opacity={0.6} />
              <line x1="10" y1="8" x2="10" y2="12" strokeLinecap="round" opacity={0.6} />
            </svg>
            {ctxMenu.nodeId === focalNode.id ? t('Exit') : t('Delete')}
          </button>
        </div>
      )}
    </div>
  )
}

export default CallGraphOverlay
