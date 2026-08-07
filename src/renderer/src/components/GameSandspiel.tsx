import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from '../themes'

const COLS = 150
const ROWS = 150
const CELL = 4
const W = COLS * CELL
const H = ROWS * CELL

const EMPTY = 0; const SAND = 1; const WATER = 2; const WOOD = 3; const FIRE = 4; const STONE = 5
const LAVA = 6; const OIL = 7; const PLANT = 8; const GAS = 9; const SEED = 10; const GUN = 11; const WIND = 12
const LEAF = 13; const FLOWER = 14

interface ElDef { id: number; label: string; color: string; icon: string }

const PALETTE: ElDef[] = [
  { id: SAND, label: 'Sand', color: '#e8c44a', icon: '\u{1F7E8}' },
  { id: WATER, label: 'Water', color: '#3b82f6', icon: '\u{1F4A7}' },
  { id: LAVA, label: 'Lava', color: '#e65100', icon: '\u{1F7E5}' },
  { id: OIL, label: 'Oil', color: '#5d4037', icon: '\u{1F7E3}' },
  { id: WOOD, label: 'Wood', color: '#8b5e3c', icon: '\u{1F7EB}' },
  { id: SEED, label: 'Seed', color: '#8d6e63', icon: '\u{1F331}' },
  { id: PLANT, label: 'Plant', color: '#4caf50', icon: '\u{1F33F}' },
  { id: LEAF, label: 'Leaf', color: '#81c784', icon: '\u{1F343}' },
  { id: FLOWER, label: 'Flower', color: '#f06292', icon: '\u{1F338}' },
  { id: FIRE, label: 'Fire', color: '#f44336', icon: '\u{1F525}' },
  { id: GUN, label: 'Gunpowder', color: '#374151', icon: '\u{1F4A3}' },
  { id: WIND, label: 'Wind', color: '#7dd3fc', icon: '\u{1F300}' },
  { id: GAS, label: 'Gas', color: '#ce93d8', icon: '\u{1F4A8}' },
  { id: STONE, label: 'Stone', color: '#6b7280', icon: '\u{2B1C}' },
]

const BRUSH_SIZES = [1, 2, 3, 5]

const RGBA = (r: number, g: number, b: number, a = 255) =>
  ((a << 24) | (b << 16) | (g << 8) | r) >>> 0

const COLORS: Record<number, number> = {
  [EMPTY]: RGBA(10, 10, 26),
  [SAND]: RGBA(232, 196, 74),
  [WATER]: RGBA(59, 130, 246),
  [WOOD]: RGBA(139, 94, 60),
  [STONE]: RGBA(107, 114, 128),
  [LAVA]: RGBA(230, 81, 0),
  [OIL]: RGBA(93, 64, 55),
  [PLANT]: RGBA(76, 175, 80),
  [LEAF]: RGBA(129, 199, 132),
  [FLOWER]: RGBA(240, 98, 146),
  [GAS]: RGBA(206, 147, 216),
  [SEED]: RGBA(141, 110, 99),
  [GUN]: RGBA(55, 65, 81),
  [WIND]: RGBA(125, 211, 252),
}

export default function GameSandspiel({ onBack }: { onBack?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef(new Uint8Array(ROWS * COLS))
  const heatRef = useRef(new Uint8Array(ROWS * COLS))
  const dirtyRef = useRef(new Set<number>())
  const animRef = useRef(0)
  const [el, setEl] = useState(SAND)
  const elRef = useRef(SAND)
  const [brush, setBrush] = useState(2)
  const brushRef = useRef(2)
  const pausedRef = useRef(false)
  const [paused, setPaused] = useState(false)
  const mouseRef = useRef({ down: false })

  // background follows current theme's --ide-bg ("r g b")
  const { theme } = useTheme()
  const bgParts = (theme.css['ide-bg'] ?? '10 10 26').split(' ')
  const bgR = parseInt(bgParts[0], 10) || 10
  const bgG = parseInt(bgParts[1], 10) || 10
  const bgB = parseInt(bgParts[2], 10) || 26
  const bgRef = useRef({ r: bgR, g: bgG, b: bgB })
  useEffect(() => {
    bgRef.current = { r: bgR, g: bgG, b: bgB }
    // theme changed → redraw every cell so EMPTY picks up the new bg
    const d = dirtyRef.current
    for (let i = 0; i < ROWS * COLS; i++) d.add(i)
  }, [bgR, bgG, bgB])

  useEffect(() => { elRef.current = el }, [el])
  useEffect(() => { brushRef.current = brush }, [brush])

  const idx = (y: number, x: number) => y * COLS + x

  const setCell = useCallback((y: number, x: number, v: number) => {
    if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return
    const i = idx(y, x)
    gridRef.current[i] = v
    if (v === FIRE) heatRef.current[i] = 120 + Math.random() * 40 | 0
    else if (v === PLANT) heatRef.current[i] = (15 << 3) | 0
    else if (v === FLOWER) heatRef.current[i] = 300 + (Math.random() * 400 | 0)
    else if (v === WIND) heatRef.current[i] = 60 + Math.random() * 40 | 0
    else if (v === EMPTY) heatRef.current[i] = 0
    dirtyRef.current.add(i)
  }, [])

  const paint = useCallback((gy: number, gx: number) => {
    const e = elRef.current; const r = brushRef.current
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        setCell(gy + dy, gx + dx, e)
      }
    }
  }, [setCell])

  const clear = useCallback(() => {
    const g = gridRef.current; const h = heatRef.current
    for (let i = 0; i < ROWS * COLS; i++) {
      if (g[i] !== EMPTY) { g[i] = EMPTY; h[i] = 0; dirtyRef.current.add(i) }
    }
  }, [])

  // simulation
  const sim = useCallback(() => {
    const g = gridRef.current; const h = heatRef.current; const d = dirtyRef.current

    // falling: bottom→top, alternating direction
    for (let y = ROWS - 2; y >= 0; y--) {
      const ltr = y % 2 === 0
      const lo = ltr ? 1 : COLS - 2; const hi = ltr ? COLS - 2 : 1; const st = ltr ? 1 : -1
      for (let x = lo; ltr ? x <= hi : x >= hi; x += st) {
        const i = idx(y, x); const v = g[i]
        if (v === EMPTY || v === WOOD || v === STONE || v === PLANT || v === WIND || v === LEAF || v === FLOWER) continue
        const b = idx(y + 1, x)

        if (v === SAND || v === SEED || v === GUN) {
          if (g[b] === EMPTY || g[b] === FIRE) {
            g[i] = EMPTY; g[b] = v; d.add(i).add(b)
          } else if (g[b] === WATER || g[b] === OIL) {
            g[i] = g[b]; g[b] = v; d.add(i).add(b)
          } else {
            const c1 = idx(y + 1, x + (ltr ? 1 : -1))
            const c2 = idx(y + 1, x + (ltr ? -1 : 1))
            if (g[c1] === EMPTY) { g[i] = EMPTY; g[c1] = v; d.add(i).add(c1) }
            else if (g[c2] === EMPTY) { g[i] = EMPTY; g[c2] = v; d.add(i).add(c2) }
          }
        } else if (v === WATER || v === OIL || v === LAVA) {
          const can = (t: number) => t === EMPTY || t === FIRE
          if (can(g[b]) || (v === LAVA && g[b] === WATER)) {
            if (v === LAVA && g[b] === WATER) {
              g[i] = EMPTY; g[b] = STONE; d.add(i).add(b)
            } else {
              g[i] = EMPTY; g[b] = v; d.add(i).add(b)
            }
          } else {
            for (const dx of [ltr ? 1 : -1, ltr ? -1 : 1]) {
              const c = idx(y + 1, x + dx)
              if (can(g[c]) || (v === LAVA && g[c] === WATER)) {
                if (v === LAVA && g[c] === WATER) {
                  g[i] = EMPTY; g[c] = STONE; d.add(i).add(c)
                } else {
                  g[i] = EMPTY; g[c] = v; d.add(i).add(c)
                }
                break
              } else if (v === WATER && (g[idx(y, x + dx)] === EMPTY || g[idx(y, x + dx)] === FIRE)) {
                g[i] = EMPTY; g[idx(y, x + dx)] = v; d.add(i).add(idx(y, x + dx)); break
              } else if (v === OIL && g[idx(y, x + dx)] === EMPTY) {
                g[i] = EMPTY; g[idx(y, x + dx)] = v; d.add(i).add(idx(y, x + dx)); break
              }
            }
          }
        }
      }
    }

    // fire + gas rising: top→bottom
    for (let y = 0; y < ROWS; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        const i = idx(y, x); const v = g[i]
        if (v === FIRE || v === LAVA) {
          if (v === FIRE) {
            h[i]--
            d.add(i)
            if (h[i] <= 0) { g[i] = EMPTY; continue }

            // rise up
            if (y > 0 && Math.random() < 0.25) {
              const t = idx(y - 1, x)
              if (g[t] === EMPTY) { g[i] = EMPTY; g[t] = FIRE; h[t] = h[i]; d.add(i).add(t); continue }
            }
          } else {
            d.add(i)
          }

          // spread
          for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const ny = y + dy; const nx = x + dx
            if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) continue
            const ni = idx(ny, nx); const t = g[ni]
            if ((t === WOOD || t === PLANT || t === SEED || t === LEAF || t === FLOWER) && Math.random() < (v === LAVA ? 0.06 : 0.03)) { g[ni] = FIRE; h[ni] = 80; d.add(ni) }
            else if (t === OIL) { g[ni] = FIRE; h[ni] = 150; d.add(ni); if (v === FIRE) h[i] += 10 }
            else if (t === GAS) { g[ni] = FIRE; h[ni] = 60; d.add(ni); if (v === FIRE) h[i] += 15 }
            else if (t === GUN) {
              g[ni] = FIRE; h[ni] = 120; d.add(ni); if (v === FIRE) h[i] += 20
              for (let dy = -3; dy <= 3; dy++) {
                for (let dx = -3; dx <= 3; dx++) {
                  if (dy === 0 && dx === 0) continue
                  const dist = Math.abs(dy) + Math.abs(dx)
                  if (dist > 4) continue
                  const ey = ny + dy; const ex = nx + dx
                  if (ey < 0 || ey >= ROWS || ex < 0 || ex >= COLS) continue
                  const ei = idx(ey, ex); const ev = g[ei]
                  if (ev !== STONE && ev !== WIND) {
                    g[ei] = FIRE; h[ei] = (dist <= 2 ? 100 : 50) + (Math.random() * 30 | 0); d.add(ei)
                  }
                }
              }
            }
          }
        } else if (v === GAS && y > 0) {
          const t = idx(y - 1, x)
          if (g[t] === EMPTY) { g[i] = EMPTY; g[t] = v; d.add(i).add(t) }
        }
      }
    }

    // wind: drifts sideways + rises, pushes light particles
    for (let y = 1; y < ROWS; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        const i = idx(y, x)
        if (g[i] !== WIND) continue
        h[i]--
        d.add(i)
        if (h[i] <= 0) { g[i] = EMPTY; continue }

        const wdir = (y % 2 === 0) ? 1 : -1
        const nx = x + wdir
        if (nx >= 0 && nx < COLS) {
          const ni = idx(y, nx); const t = g[ni]
          if (t === EMPTY) { g[i] = EMPTY; g[ni] = WIND; h[ni] = h[i]; d.add(i).add(ni) }
          else if (t === GAS || t === FIRE) { g[i] = t; g[ni] = WIND; h[ni] = h[i]; d.add(i).add(ni) }
          else if ((t === SEED || t === SAND) && Math.random() < 0.1) { g[i] = t; g[ni] = WIND; h[ni] = h[i]; d.add(i).add(ni) }
        }
        if (y > 0 && Math.random() < 0.15) {
          const up = idx(y - 1, x)
          if (g[up] === EMPTY) { g[i] = EMPTY; g[up] = WIND; h[up] = h[i]; d.add(i).add(up) }
        }
      }
    }

    // seed → tree: heat = energy<<2 | dir (energy 6bit; dir: 0=up 1=up-left 2=up-right; 3 = mature tip → foliage/bloom)
    const leafDensity = (yy: number, xx: number) => {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const y2 = yy + dy, x2 = xx + dx
        if (y2 >= 0 && y2 < ROWS && x2 >= 0 && x2 < COLS) {
          const t = g[idx(y2, x2)]
          if (t === LEAF || t === FLOWER) n++
        }
      }
      return n
    }
    for (let y = 1; y < ROWS; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        const i = idx(y, x)
        if (g[i] === SEED && Math.random() < 0.08) {
          const b = idx(y + 1, x)
          const d2 = y + 2 < ROWS ? idx(y + 2, x) : -1
          const hasWater = g[b] === WATER ||
            g[idx(y, x - 1)] === WATER || g[idx(y, x + 1)] === WATER ||
            g[idx(y - 1, x)] === WATER || (d2 >= 0 && g[d2] === WATER)
          if (hasWater) { g[i] = PLANT; h[i] = (26 + (Math.random() * 5 | 0)) << 2; d.add(i) }
        } else if (g[i] === PLANT) {
          const v = h[i]; let e = v >> 2
          if ((v & 3) === 3) {
            // mature tip: fill a radius-2 disc up to its leaf budget, then stop growing forever
            const budget = v >> 2
            if (budget < 10 && Math.random() < 0.02) {
              let dx = 0, dy = 0, t = 0
              do { dx = (Math.random() * 5 | 0) - 2; dy = (Math.random() * 5 | 0) - 2; t++ }
              while (t < 4 && (dx === 0 && dy === 0 || dx * dx + dy * dy > 5))
              const ny = y + dy; const nx = x + dx
              if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS && g[idx(ny, nx)] === EMPTY && leafDensity(ny, nx) < 3) {
                g[idx(ny, nx)] = LEAF; h[i] = ((budget + 1) << 2) | 3; d.add(idx(ny, nx))
              }
            }
            if (Math.random() < 0.005) {
              // bloom replaces a leaf so foliage never chokes the flowers out
              const dx = (Math.random() * 3 | 0) - 1; const dy = (Math.random() * 3 | 0) - 1
              const ny = y + dy; const nx = x + dx
              if ((dx || dy) && ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
                const ni = idx(ny, nx)
                if (g[ni] === EMPTY || g[ni] === LEAF) { g[ni] = FLOWER; h[ni] = 300 + (Math.random() * 400 | 0); d.add(ni) }
              }
            }
            continue
          }
          if (e === 0) continue
          // run-length steering: trunk rigid, branches change ±1 rarely (no drunk walk)
          let dir = v & 3
          if (e > 18) {
            if (Math.random() < 0.004) dir = dir === 0 ? (Math.random() < 0.5 ? 1 : 2) : 0
          } else if (Math.random() < 0.02) {
            if (dir === 0) dir = Math.random() < 0.5 ? 1 : 2
            else if (Math.random() < 0.25) dir = 0
          }
          // fork: trunk tip whorls 2-3 times, main branches fork once, twigs never fork
          const forkP = e > 18 ? 0.0005 : e > 12 ? 0.05 : e > 6 ? 0.015 : 0
          if (e >= 6 && Math.random() < forkP && y > 0 && x > 0 && x < COLS - 1) {
            const ul = idx(y - 1, x - 1); const ur = idx(y - 1, x + 1)
            if (g[ul] === EMPTY && g[ur] === EMPTY) {
              const ce = Math.max(2, (e - 2) >> 1)
              g[ul] = PLANT; h[ul] = (ce << 2) | 1; d.add(ul)
              g[ur] = PLANT; h[ur] = (ce << 2) | 2; d.add(ur)
              h[i] = ((e - 2) << 2) | dir
              e -= 2
            }
          }
          // grow: trunk fast, branches slower, twigs slowest
          let ny = y - 1, nx = x
          if (dir === 1) nx--
          else if (dir === 2) nx++
          if (ny >= 0 && nx >= 0 && nx < COLS && Math.random() < (e > 18 ? 0.12 : e > 12 ? 0.08 : 0.08) && e > 0) {
            const ni = idx(ny, nx)
            if (g[ni] === EMPTY) {
              const ne = e - 1
              g[ni] = PLANT; h[ni] = ne === 0 ? 3 : (ne << 2) | dir; h[i] = 0; d.add(ni)
            } else if (Math.random() < 0.5) {
              // blocked: waste energy so the twig withers into a leafy tip instead of wandering forever
              const ne = e - 1
              h[i] = ne === 0 ? 3 : (ne << 2) | dir
            }
          }
        } else if (g[i] === LEAF) {
          // leaves bloom so blossoms fill the canopy, not just branch tips
          if (Math.random() < 0.0005) {
            g[i] = FLOWER; h[i] = 300 + (Math.random() * 400 | 0); d.add(i)
          }
        } else if (g[i] === FLOWER) {
          // bloom withers back into a leaf so the canopy never shrinks
          h[i]--
          if (h[i] <= 0) { g[i] = LEAF; h[i] = 0; d.add(i) }
        }
      }
    }
  }, [])

  // render dirty pixels to canvas
  const render = useCallback(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    const img = ctx.getImageData(0, 0, W, H)
    const px = img.data
    const g = gridRef.current; const h = heatRef.current; const dd = dirtyRef.current
    if (dd.size === 0) return

    const fillBlock = (xx: number, yy: number, r: number, g_: number, b: number) => {
      const py0 = yy * CELL; const px0 = xx * CELL
      for (let dy = 0; dy < CELL; dy++) {
        const rowOff = (py0 + dy) * W * 4
        for (let dx = 0; dx < CELL; dx++) {
          const off = rowOff + (px0 + dx) * 4
          px[off] = r; px[off + 1] = g_; px[off + 2] = b; px[off + 3] = 255
        }
      }
    }

    for (const i of dd) {
      const v = g[i]
      const yy = Math.floor(i / COLS); const xx = i % COLS
      if (v === EMPTY) {
        const bg = bgRef.current
        fillBlock(xx, yy, bg.r, bg.g, bg.b)
        continue
      }
      if (v === FIRE) {
        const t = Math.max(0, h[i]) / 160
        if (t > 0.66) fillBlock(xx, yy, 255, 235, 59)
        else if (t > 0.33) fillBlock(xx, yy, 255, 152, 0)
        else if (t > 0.1) fillBlock(xx, yy, 244, 67, 54)
        else fillBlock(xx, yy, 183, 28, 28)
      } else {
        const c2 = COLORS[v]
        fillBlock(xx, yy, (c2 >> 0) & 0xFF, (c2 >> 8) & 0xFF, (c2 >> 16) & 0xFF)
      }
    }
    ctx.putImageData(img, 0, 0)
    dd.clear()
  }, [])

  // main loop
  useEffect(() => {
    const loop = () => {
      try {
        if (!pausedRef.current) sim()
        render()
      } catch (e) {
        console.error('sandspiel error', e)
      }
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [sim, render])

  // mouse
  const getGrid = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent, el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect()
    return {
      y: Math.floor(((e as any).clientY - r.top) / CELL),
      x: Math.floor(((e as any).clientX - r.left) / CELL),
    }
  }, [])

  const onDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const el = canvasRef.current; if (!el) return
    const p = getGrid(e, el)
    if (p.y < 0 || p.y >= ROWS || p.x < 0 || p.x >= COLS) return
    mouseRef.current.down = true
    paint(p.y, p.x)
  }, [paint, getGrid])

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const onMove = (e: MouseEvent) => {
      if (!mouseRef.current.down) return
      const p = getGrid(e, canvas)
      if (p.y < 0 || p.y >= ROWS || p.x < 0 || p.x >= COLS) return
      paint(p.y, p.x)
    }
    const onUp = () => { mouseRef.current.down = false }
    const onLeave = () => { mouseRef.current.down = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onLeave)
    }
  }, [paint, getGrid])

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none" style={{ minHeight: 0 }}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none z-10">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">{'\u{1F3D6}'} Sandspiel</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPaused(p => { pausedRef.current = !p; return !p })}
            className="px-2 py-0.5 text-[10px] bg-ide-hover hover:bg-ide-border text-ide-text-muted rounded transition-colors"
          >{paused ? '\u25B6' : '\u23F8'}</button>
          <button onClick={clear}
            className="px-2 py-0.5 text-[10px] bg-ide-hover hover:bg-ide-border text-ide-text-muted rounded transition-colors"
          >{'\u{1F5D1}'}</button>
        </div>
      </div>
      <div className="flex items-center gap-1 px-3 py-1.5 bg-ide-hover/30 border-b border-ide-border shrink-0 select-none flex-wrap">
        {PALETTE.map(p => (
          <button key={p.id} onClick={() => setEl(p.id)}
            className="w-7 h-7 flex items-center justify-center text-xs rounded border transition-all shrink-0"
            style={{
              backgroundColor: el === p.id ? p.color + '40' : 'transparent',
              borderColor: el === p.id ? p.color : 'transparent',
            }}
            title={p.label}
          >{p.icon}</button>
        ))}
        <div className="w-px h-4 bg-ide-border mx-1" />
        <button onClick={() => setEl(EMPTY)}
          className="w-7 h-7 flex items-center justify-center text-xs rounded border border-transparent hover:border-ide-text-muted/30 transition-all text-ide-text-muted shrink-0"
          title="Eraser"
        >{'\u{1F9F9}'}</button>
        <div className="w-px h-4 bg-ide-border mx-1" />
        {BRUSH_SIZES.map(s => (
          <button key={s} onClick={() => setBrush(s)}
            className={`w-7 h-7 flex items-center justify-center text-[10px] font-bold rounded border transition-all shrink-0 ${
              brush === s
                ? 'bg-ide-accent/20 border-ide-accent text-ide-text'
                : 'border-transparent text-ide-text-muted hover:border-ide-text-muted/30'
            }`}
            title={`Brush ${s}`}
          >{s}</button>
        ))}
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden p-2" style={{ background: 'rgb(var(--ide-bg))', minHeight: 0 }}>
        <canvas ref={canvasRef} width={W} height={H} onMouseDown={onDown}
          style={{ cursor: 'crosshair', imageRendering: 'pixelated', width: W, height: H, outline: '1px solid rgba(255,255,255,0.08)' }}
        />
      </div>
    </div>
  )
}
