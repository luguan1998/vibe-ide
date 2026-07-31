import React, { useState, useEffect, useCallback, useRef } from 'react'

const W = 480
const H = 640
const GRAVITY = 0.1
const MAX_LIVES = 3
const BEST_KEY = 'fruitninja-best'

interface FruitDef { emoji: string; juice: string; r: number; score: number }
interface Fruit extends FruitDef { x: number; y: number; vx: number; vy: number; rot: number; vr: number; bomb: boolean }
interface Chunk { x: number; y: number; vx: number; vy: number; rot: number; vr: number; emoji: string; size: number; alpha: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
interface TrailPt { x: number; y: number; t: number }
interface Popup { x: number; y: number; text: string; t: number }
interface Splat { x: number; y: number; color: string; size: number; alpha: number; blobs: { dx: number; dy: number; r: number }[] }

const FRUITS: FruitDef[] = [
  { emoji: '\u{1F349}', juice: '#e53935', r: 42, score: 3 },
  { emoji: '\u{1F34E}', juice: '#ef5350', r: 31, score: 1 },
  { emoji: '\u{1F34A}', juice: '#ff9800', r: 33, score: 1 },
  { emoji: '\u{1F34B}', juice: '#fdd835', r: 30, score: 1 },
  { emoji: '\u{1F34C}', juice: '#fff59d', r: 33, score: 1 },
  { emoji: '\u{1F95D}', juice: '#81c784', r: 30, score: 1 },
  { emoji: '\u{1F353}', juice: '#f06292', r: 28, score: 1 },
  { emoji: '\u{1F351}', juice: '#ffab91', r: 33, score: 1 },
  { emoji: '\u{1F350}', juice: '#c5e1a5', r: 31, score: 1 },
  { emoji: '\u{1F347}', juice: '#ba68c8', r: 35, score: 2 },
]

const BOMB: FruitDef = { emoji: '\u{1F4A3}', juice: '#37474f', r: 30, score: 0 }

const KNIFE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<path d="M16 1 L19.5 13 L12.5 13 Z" fill="#eceff1" stroke="#90a4ae" stroke-width="0.8"/>' +
  '<rect x="11.5" y="13" width="9" height="2.5" rx="0.8" fill="#ffca28"/>' +
  '<rect x="12.5" y="15.5" width="7" height="12" rx="2" fill="#795548"/>' +
  '<rect x="13.8" y="19" width="4.4" height="2.2" rx="1" fill="#5d4037"/>' +
  '</svg>'
)}") 16 2, crosshair`

const distSegPt = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => {
  const dx = bx - ax; const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export default function GameFruitNinja({ onBack }: { onBack?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fruitsRef = useRef<Fruit[]>([])
  const chunksRef = useRef<Chunk[]>([])
  const partsRef = useRef<Particle[]>([])
  const splatsRef = useRef<Splat[]>([])
  const trailRef = useRef<TrailPt[]>([])
  const popupsRef = useRef<Popup[]>([])
  const prevMouseRef = useRef<{ x: number; y: number } | null>(null)
  const swipingRef = useRef(false)
  const animRef = useRef(0)
  const spawnAccRef = useRef(0)
  const slicedRef = useRef(0)
  const comboRef = useRef(0)
  const comboTimerRef = useRef(0)
  const flashRef = useRef(0)
  const gameOverRef = useRef(false)
  const [score, setScore] = useState(0)
  const scoreRef = useRef(0)
  const [lives, setLives] = useState(MAX_LIVES)
  const livesRef = useRef(MAX_LIVES)
  const [gameOver, setGameOver] = useState(false)
  const [best, setBest] = useState(() => {
    try { return parseInt(localStorage.getItem(BEST_KEY) ?? '0', 10) || 0 } catch { return 0 }
  })

  const woodGrainRef = useRef<{ y: number; amp: number; freq: number; phase: number; alpha: number; light: boolean }[] | null>(null)
  if (!woodGrainRef.current) {
    const grain: { y: number; amp: number; freq: number; phase: number; alpha: number; light: boolean }[] = []
    for (let i = 0; i < 16; i++) {
      grain.push({
        y: 20 + Math.random() * (H - 120),
        amp: 4 + Math.random() * 12,
        freq: 1 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.06 + Math.random() * 0.08,
        light: Math.random() < 0.4,
      })
    }
    woodGrainRef.current = grain
  }

  const spawnFruit = useCallback(() => {
    const diff = Math.min(1, slicedRef.current / 40)
    const bombChance = 0.07 + diff * 0.18
    const isBomb = Math.random() < bombChance
    const def = isBomb ? BOMB : FRUITS[Math.random() * FRUITS.length | 0]
    const x = 100 + Math.random() * (W - 200)
    const r = def.r * (0.9 + Math.random() * 0.25)
    const vy = -(10 + Math.random() * 1.5)
    fruitsRef.current.push({
      ...def, r, x, y: H + r,
      vx: (Math.random() - 0.5) * 1.6,
      vy,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.16,
      bomb: isBomb,
    })
  }, [])

  const burst = useCallback((x: number, y: number, color: string, n: number, speed: number) => {
    const parts = partsRef.current
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.4 + Math.random() * 0.9)
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, life: 40 + Math.random() * 25 | 0, maxLife: 65, color, size: 2.5 + Math.random() * 3 })
    }
  }, [])

  const sliceFruit = useCallback((f: Fruit) => {
    slicedRef.current++
    comboRef.current++
    comboTimerRef.current = 0.8
    if (f.bomb) {
      flashRef.current = 260
      livesRef.current--
      setLives(livesRef.current)
      burst(f.x, f.y, '#ff8f00', 30, 6.5)
      burst(f.x, f.y, '#b71c1c', 20, 4.5)
      if (livesRef.current <= 0) {
        gameOverRef.current = true
        setGameOver(true)
        if (scoreRef.current > best) {
          setBest(scoreRef.current)
          try { localStorage.setItem(BEST_KEY, String(scoreRef.current)) } catch {}
        }
      }
      return
    }
    scoreRef.current += f.score * comboRef.current
    setScore(scoreRef.current)
    const combo = comboRef.current
    popupsRef.current.push({
      x: f.x, y: f.y - f.r,
      text: combo >= 2 ? `+${f.score * combo} x${combo}` : `+${f.score}`,
      t: 0.9,
    })
    burst(f.x, f.y, f.juice, 10, 4.5)
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * f.r * 0.7
      splatsRef.current.push({
        x: f.x + Math.cos(a) * d,
        y: f.y + Math.sin(a) * d,
        color: f.juice,
        size: f.r * (0.35 + Math.random() * 0.3),
        alpha: 0.5 + Math.random() * 0.15,
        blobs: Array.from({ length: 3 + (Math.random() * 3 | 0) }, () => ({
          dx: (Math.random() - 0.5) * 1.6,
          dy: (Math.random() - 0.5) * 1.6,
          r: 0.4 + Math.random() * 0.6,
        })),
      })
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 1.5 + Math.random() * 2.5
      chunksRef.current.push({
        x: f.x, y: f.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.4,
        emoji: f.emoji, size: f.r * 0.6, alpha: 1,
      })
    }
  }, [burst, best])

  const checkSlice = useCallback((ax: number, ay: number, bx: number, by: number) => {
    const fruits = fruitsRef.current
    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i]
      if (distSegPt(ax, ay, bx, by, f.x, f.y) < f.r) {
        fruits.splice(i, 1)
        sliceFruit(f)
        return
      }
    }
  }, [sliceFruit])

  const update = useCallback(() => {
    if (!gameOverRef.current) {
      spawnAccRef.current++
      if (spawnAccRef.current >= Math.max(70, 280 - slicedRef.current * 2)) {
        spawnAccRef.current = 0
        spawnFruit()
        if (Math.random() < 0.18) spawnFruit()
      }
    }

    const fruits = fruitsRef.current
    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i]
      f.vy += GRAVITY
      f.x += f.vx
      f.y += f.vy
      f.rot += f.vr
      if (f.y > H + f.r * 2) {
        fruits.splice(i, 1)
        if (!f.bomb && !gameOverRef.current) {
          livesRef.current--
          setLives(livesRef.current)
          flashRef.current = 120
          if (livesRef.current <= 0) {
            gameOverRef.current = true
            setGameOver(true)
            if (scoreRef.current > best) {
              setBest(scoreRef.current)
              try { localStorage.setItem(BEST_KEY, String(scoreRef.current)) } catch {}
            }
          }
        }
      }
    }

    const chunks = chunksRef.current
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i]
      c.vy += 0.3
      c.x += c.vx
      c.y += c.vy
      c.rot += c.vr
      c.alpha -= 0.035
      if (c.alpha <= 0 || c.y > H + 60) chunks.splice(i, 1)
    }

    const parts = partsRef.current
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      p.vy += 0.25
      p.x += p.vx
      p.y += p.vy
      if (--p.life <= 0) parts.splice(i, 1)
    }

    const splats = splatsRef.current
    for (let i = splats.length - 1; i >= 0; i--) {
      splats[i].alpha -= 0.0012
      if (splats[i].alpha <= 0) splats.splice(i, 1)
    }

    const trail = trailRef.current
    const now = performance.now()
    while (trail.length && now - trail[0].t > 220) trail.shift()

    const popups = popupsRef.current
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]
      p.t -= 0.016
      p.y -= 0.7
      if (p.t <= 0) popups.splice(i, 1)
    }

    if (comboTimerRef.current > 0) {
      comboTimerRef.current -= 0.016
      if (comboTimerRef.current <= 0) comboRef.current = 0
    }
    if (flashRef.current > 0) flashRef.current -= 16
  }, [spawnFruit, best])

  const render = useCallback(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    const grain = woodGrainRef.current!
    const tableH = 56
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#3a2a20')
    grad.addColorStop(0.65, '#2c1f15')
    grad.addColorStop(1, '#221810')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 2
    for (const x of [96, 192, 288, 384]) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H - tableH)
      ctx.stroke()
    }
    for (const g of grain) {
      ctx.strokeStyle = g.light ? `rgba(255, 200, 150, ${g.alpha * 0.5})` : `rgba(0, 0, 0, ${g.alpha})`
      ctx.lineWidth = g.light ? 1 : 2
      ctx.beginPath()
      for (let x = 0; x <= W; x += 8) {
        const y = g.y + Math.sin(x / W * Math.PI * 2 * g.freq + g.phase) * g.amp
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(0, H - tableH, W, tableH)
    ctx.fillStyle = 'rgba(255,200,150,0.07)'
    ctx.fillRect(0, H - tableH, W, 2)

    for (const s of splatsRef.current) {
      ctx.globalAlpha = Math.max(0, s.alpha)
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
      for (const b of s.blobs) ctx.arc(s.x + b.dx * s.size, s.y + b.dy * s.size, b.r * s.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    const trail = trailRef.current
    if (trail.length >= 2) {
      const now = performance.now()
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.55)'
        ctx.lineWidth = pass === 0 ? 13 : 5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        for (let i = 0; i < trail.length; i++) {
          const age = (now - trail[i].t) / 220
          const a = 1 - age
          if (pass === 1) ctx.globalAlpha = Math.max(0, a)
          if (i === 0) ctx.moveTo(trail[i].x, trail[i].y)
          else ctx.lineTo(trail[i].x, trail[i].y)
        }
        ctx.globalAlpha = 1
        ctx.stroke()
      }
    }

    for (const f of fruitsRef.current) {
      ctx.save()
      ctx.translate(f.x, f.y)
      ctx.rotate(f.rot)
      ctx.fillStyle = f.bomb ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.45)'
      ctx.beginPath()
      ctx.arc(0, 0, f.r * 1.02, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = `${f.r * 2.1}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(f.emoji, 0, 0)
      ctx.restore()
      if (f.bomb) {
        const sp = 0.7 + Math.sin(performance.now() / 60) * 0.3
        ctx.fillStyle = '#ffca28'
        ctx.beginPath()
        ctx.arc(f.x, f.y - f.r * 1.15, 4 * sp, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    for (const c of chunksRef.current) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, c.alpha)
      ctx.translate(c.x, c.y)
      ctx.rotate(c.rot)
      ctx.font = `${c.size * 2.1}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(c.emoji, 0, 0)
      ctx.restore()
    }

    for (const p of partsRef.current) {
      const a = Math.max(0, p.life / p.maxLife)
      ctx.globalAlpha = a
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    for (const p of popupsRef.current) {
      const a = Math.max(0, Math.min(1, p.t / 0.4))
      ctx.globalAlpha = a
      ctx.font = `bold ${p.text.startsWith('+') && p.text.includes('x') ? 22 : 18}px "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = p.text.includes('x') ? '#ffb300' : '#ffffff'
      ctx.fillText(p.text, p.x, p.y)
    }
    ctx.globalAlpha = 1

    if (flashRef.current > 0) {
      ctx.fillStyle = `rgba(255, 40, 40, ${Math.max(0, flashRef.current / 260) * 0.35})`
      ctx.fillRect(0, 0, W, H)
    }
  }, [])

  useEffect(() => {
    const loop = () => {
      update()
      render()
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [update, render])

  const getPos = useCallback((e: MouseEvent | React.MouseEvent) => {
    const c = canvasRef.current; if (!c) return null
    const r = c.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top) * (H / r.height),
    }
  }, [])

  const onDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (gameOverRef.current) return
    e.preventDefault()
    const p = getPos(e); if (!p) return
    swipingRef.current = true
    prevMouseRef.current = p
    trailRef.current = [{ ...p, t: performance.now() }]
  }, [getPos])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!swipingRef.current) return
      const p = getPos(e); if (!p) return
      const prev = prevMouseRef.current
      if (prev) checkSlice(prev.x, prev.y, p.x, p.y)
      prevMouseRef.current = p
      trailRef.current.push({ ...p, t: performance.now() })
    }
    const onUp = () => {
      swipingRef.current = false
      prevMouseRef.current = null
      trailRef.current = []
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [getPos, checkSlice])

  const reset = useCallback(() => {
    fruitsRef.current = []
    chunksRef.current = []
    partsRef.current = []
    splatsRef.current = []
    popupsRef.current = []
    trailRef.current = []
    scoreRef.current = 0
    setScore(0)
    livesRef.current = MAX_LIVES
    setLives(MAX_LIVES)
    slicedRef.current = 0
    comboRef.current = 0
    comboTimerRef.current = 0
    spawnAccRef.current = 0
    flashRef.current = 0
    gameOverRef.current = false
    setGameOver(false)
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none">
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors" title="Back to menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <span className="text-sm leading-none">{'\u{1F349}'}</span>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">Fruit Ninja</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-0.5" title="Lives">
            {Array.from({ length: MAX_LIVES }).map((_, i) => (
              <span key={i} className="text-[11px] leading-none">{i < lives ? '❤️' : '\u{1F5A4}'}</span>
            ))}
          </div>
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Score</div>
            <div className="text-ide-warning font-bold tabular-nums">{score}</div>
          </div>
        </div>
      </div>

      <div className="relative flex-1 flex items-center justify-center p-2 bg-ide-bg/40 overflow-hidden min-h-0">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onMouseDown={onDown}
          className="max-w-full max-h-full"
          style={{ aspectRatio: `${W} / ${H}`, cursor: KNIFE_CURSOR, borderRadius: 8, outline: '1px solid rgba(255,255,255,0.08)' }}
        />
        {gameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ide-bg/70 backdrop-blur-sm z-10">
            <div className="text-sm text-ide-danger font-bold">Game Over</div>
            <div className="text-[11px] text-ide-text-muted">Score: {score}</div>
            <div className="text-[11px] text-ide-warning">Best: {best}</div>
            <button
              onClick={reset}
              className="px-4 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
