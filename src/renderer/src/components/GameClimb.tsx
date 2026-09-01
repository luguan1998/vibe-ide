import React, { useEffect, useRef, useState } from 'react'

const W = 560
const H = 800
const WORLD_W = 2700
const WORLD_H = 1600
const G = 1200
const PLAYER_R = 24
const HAMMER_LEN = 92
const TIP_R = 10
const STEP = 1 / 60
const SUBS = 3
const DT = STEP / SUBS
const TIP_GAIN = 16
const TIP_MAX = 1500
const POP_DIST = 62
const SINK = 3

interface Circle { x: number; y: number; r: number }

const PROF: [number, number][] = [
  [0, 1430], [310, 1420], [430, 1330], [560, 1295], [700, 1235],
  [800, 1180], [1100, 1120], [1380, 1080], [1520, 980], [1620, 780],
  [1830, 545], [2000, 380], [2130, 262], [2260, 250], [2700, 250],
]
const surfY = (x: number) => {
  for (let i = 1; i < PROF.length; i++) {
    if (x <= PROF[i][0]) {
      const t = (x - PROF[i - 1][0]) / ((PROF[i][0] - PROF[i - 1][0]) || 1)
      return PROF[i - 1][1] + (PROF[i][1] - PROF[i - 1][1]) * t
    }
  }
  return PROF[PROF.length - 1][1]
}
const hash = (n: number) => {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return h - Math.floor(h)
}
// 原版山体 = 一堆大圆石。物理与视觉同一套:碰撞全用圆,不会卡缝
const BOULDERS: Circle[] = []
{
  let x = 10
  let i = 0
  while (x < WORLD_W - 10) {
    const r = 58 + hash(i * 3 + 1) * 46
    BOULDERS.push({ x, y: surfY(x) + r * 0.38, r })
    x += 92 + hash(i * 3 + 2) * 30
    i++
  }
}
const SPAWN = { x: 150, y: surfY(150) - 42 }
const GOAL = { x: 2178, y: 196, r: 85 }

const STARS = Array.from({ length: 42 }, (_, i) => ({
  x: (i * 173 + 53) % WORLD_W,
  y: (i * 191 + 40) % 1350,
  r: 0.8 + hash(i * 7) * 1.6,
}))

interface Body { x: number; y: number; vx: number; vy: number; radius: number }
const player: Body = { x: SPAWN.x, y: SPAWN.y, vx: 0, vy: 0, radius: PLAYER_R }
const tip: Body = { x: player.x + HAMMER_LEN, y: player.y, vx: 0, vy: 0, radius: TIP_R }
let stuck = false

const resetBodies = () => {
  player.x = SPAWN.x
  player.y = SPAWN.y
  player.vx = 0
  player.vy = 0
  tip.x = player.x + HAMMER_LEN
  tip.y = player.y
  tip.vx = 0
  tip.vy = 0
  stuck = false
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

// 正确的库仑摩擦:法向速度由恢复系数吸收,摩擦只衰减切向分量,且每子步只作用一次
const resolvePlayer = (n: Circle) => {
  const dx = player.x - n.x
  const dy = player.y - n.y
  const d = Math.hypot(dx, dy) || 0.001
  const min = n.r + player.radius
  if (d < min) {
    player.x += (dx / d) * (min - d)
    player.y += (dy / d) * (min - d)
  }
  const ox = dx / d
  const oy = dy / d
  const vn = player.vx * ox + player.vy * oy
  if (vn < 0) {
    player.vx -= ox * vn
    player.vy -= oy * vn
  }
  return { ox, oy }
}

const resolveTip = (n: Circle) => {
  const dx = tip.x - n.x
  const dy = tip.y - n.y
  const d = Math.hypot(dx, dy) || 0.001
  const min = n.r + tip.radius - SINK
  if (d < min) {
    tip.x += (dx / d) * (min - d)
    tip.y += (dy / d) * (min - d)
    return true
  }
  return false
}

export default function GameClimb({ onBack }: { onBack?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [won, setWon] = useState(false)
  const wonRef = useRef(false)
  const mouseRef = useRef({ down: false, x: W / 2, y: H / 2 })
  const hoverRef = useRef(false)

  useEffect(() => {
    resetBodies()
    wonRef.current = false
    setWon(false)
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const accentVal = getComputedStyle(canvas).getPropertyValue('--ide-accent').trim() || '255 255 255'
    const accent = (a: number) => `rgba(${accentVal.split(' ').join(',')},${a})`
    const toLocal = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H }
    }
    const down = (ev: MouseEvent) => {
      const p = toLocal(ev)
      mouseRef.current = { down: true, x: p.x, y: p.y }
    }
    const move = (ev: MouseEvent) => {
      const p = toLocal(ev)
      mouseRef.current.x = p.x
      mouseRef.current.y = p.y
    }
    const up = () => { mouseRef.current.down = false }
    const enter = () => { hoverRef.current = true }
    const leave = () => { hoverRef.current = false }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    canvas.addEventListener('pointerenter', enter)
    canvas.addEventListener('pointerleave', leave)

    let raf = 0
    let acc = 0
    let last = performance.now()
    let step = 0
    let slipT = 0
    const cam = {
      x: clamp(SPAWN.x - W / 2, 0, WORLD_W - W),
      y: clamp(SPAWN.y - H / 2, 0, WORLD_H - H),
    }

    const substep = () => {
      const m = mouseRef.current
      const mwx = m.x + cam.x
      const mwy = m.y + cam.y
      let mdx = mwx - player.x
      let mdy = mwy - player.y
      const mdl = Math.hypot(mdx, mdy) || 1
      mdx /= mdl
      mdy /= mdl

      if (stuck) {
        if (!m.down) stuck = false
      } else if (m.down) {
        const tx = player.x + mdx * HAMMER_LEN
        const ty = player.y + mdy * HAMMER_LEN
        tip.vx = clamp((tx - tip.x) * TIP_GAIN, -TIP_MAX, TIP_MAX)
        tip.vy = clamp((ty - tip.y) * TIP_GAIN, -TIP_MAX, TIP_MAX)
      } else {
        tip.vx *= 0.9
        tip.vy = tip.vy * 0.9 + G * 0.35 * DT
      }

      const px0 = player.x
      const py0 = player.y
      if (!stuck) {
        tip.x += tip.vx * DT
        tip.y += tip.vy * DT
      }
      player.vy += G * DT
      player.vx = clamp(player.vx, -2200, 2200)
      player.vy = clamp(player.vy, -2200, 2200)
      player.x += player.vx * DT
      player.y += player.vy * DT

      let contact = false
      for (let it = 0; it < 4; it++) {
        if (stuck) {
          const want = { x: tip.x - mdx * HAMMER_LEN, y: tip.y - mdy * HAMMER_LEN }
          const ex = want.x - player.x
          const ey = want.y - player.y
          const rx = tip.x - player.x
          const ry = tip.y - player.y
          const rl = Math.hypot(rx, ry) || 0.001
          const perp = Math.abs((ex * ry - ey * rx) / rl)
          if (perp > POP_DIST) {
            stuck = false
          } else {
            player.x += ex * 0.55
            player.y += ey * 0.55
          }
          if (stuck) {
            const dr = Math.hypot(tip.x - player.x, tip.y - player.y) || 0.001
            const k = (dr - HAMMER_LEN) / dr
            player.x += (tip.x - player.x) * k
            player.y += (tip.y - player.y) * k
          }
        } else {
          const dx = tip.x - player.x
          const dy = tip.y - player.y
          const d = Math.hypot(dx, dy) || 0.001
          const diff = (d - HAMMER_LEN) / d
          const wT = m.down ? 0.62 : 0.5
          tip.x -= dx * diff * wT
          tip.y -= dy * diff * wT
          player.x += dx * diff * (1 - wT)
          player.y += dy * diff * (1 - wT)
        }

        let nx = 0
        let ny = 0
        let flat = 0
        let tipHit = false
        for (const b of BOULDERS) {
          const hp = resolvePlayer(b)
          const pd = Math.hypot(player.x - b.x, player.y - b.y)
          if (pd < b.r + player.radius + 1) {
            contact = true
            if (Math.abs(hp.oy) > flat) { flat = Math.abs(hp.oy); nx = hp.ox; ny = hp.oy }
          }
          if (resolveTip(b)) {
            tipHit = true
            if (m.down) stuck = true
          }
        }
        if (stuck) {
          tip.vx = 0
          tip.vy = 0
        } else if (tipHit) {
          tip.vx *= 0.5
          tip.vy *= 0.5
        }
      }

      if (!stuck) {
        player.vx = clamp((player.x - px0) / DT * 0.88, -2200, 2200)
        player.vy = clamp((player.y - py0) / DT * 0.88, -2200, 2200)
      } else {
        player.vx *= 0.6
        player.vy *= 0.6
      }

      if (contact && (nx !== 0 || ny !== 0)) {
        const vn = player.vx * nx + player.vy * ny
        if (vn < 0) {
          player.vx -= nx * vn
          player.vy -= ny * vn
        }
        const tvx = player.vx - nx * (player.vx * nx + player.vy * ny)
        const tvy = player.vy - ny * (player.vx * nx + player.vy * ny)
        const fr = Math.min(1, 2.4 * DT)
        player.vx -= tvx * fr
        player.vy -= tvy * fr
        if (ny < -0.93 && Math.hypot(player.vx, player.vy) < 26 && !stuck) {
          player.vx = 0
          player.vy = 0
        }
      }

      let touching = false
      for (const b of BOULDERS) {
        if (Math.hypot(tip.x - b.x, tip.y - b.y) < b.r + tip.radius + 2) { touching = true; break }
      }
      if (stuck && !touching) {
        slipT++
        if (slipT > 8) { stuck = false; slipT = 0 }
      } else slipT = 0
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      acc += Math.min((now - last) / 1000, 0.05)
      last = now
      while (acc >= STEP) {
        acc -= STEP
        step++
        for (let s = 0; s < SUBS; s++) substep()
        player.x = clamp(player.x, 12, WORLD_W - 12)
        player.y = clamp(player.y, 10, WORLD_H + 40)
        tip.x = clamp(tip.x, 6, WORLD_W - 6)
        tip.y = clamp(tip.y, 6, WORLD_H + 40)
        if (player.y > WORLD_H - 60) {
          resetBodies()
        }
        if (Math.hypot(player.x - GOAL.x, player.y - GOAL.y) < GOAL.r && !wonRef.current) {
          wonRef.current = true
          setWon(true)
        }
      }
      cam.x += (clamp(player.x - W / 2, 0, WORLD_W - W) - cam.x) * 0.18
      cam.y += (clamp(player.y - H / 2, 0, WORLD_H - H) - cam.y) * 0.18

      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, '#0d1730')
      grad.addColorStop(0.7, '#233a5e')
      grad.addColorStop(1, '#3a506f')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)

      const mg = ctx.createRadialGradient(W * 0.8, 130, 10, W * 0.8, 130, 120)
      mg.addColorStop(0, 'rgba(236,232,214,0.35)')
      mg.addColorStop(1, 'rgba(236,232,214,0)')
      ctx.fillStyle = mg
      ctx.beginPath()
      ctx.arc(W * 0.8, 130, 120, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ece8d6'
      ctx.beginPath()
      ctx.arc(W * 0.8, 130, 46, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(180,175,155,0.5)'
      ctx.beginPath()
      ctx.arc(W * 0.8 - 14, 122, 8, 0, Math.PI * 2)
      ctx.arc(W * 0.8 + 10, 142, 6, 0, Math.PI * 2)
      ctx.arc(W * 0.8 + 16, 116, 4, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.translate(-Math.round(cam.x * 0.45), -Math.round(cam.y * 0.3))
      ctx.fillStyle = 'rgba(13,20,38,0.55)'
      ctx.beginPath()
      ctx.moveTo(-200, WORLD_H)
      for (let x = -200; x < WORLD_W + 400; x += 160) {
        ctx.lineTo(x, surfY(x * 0.8 + 400) - 130 - Math.sin(x * 0.007) * 46)
      }
      ctx.lineTo(WORLD_W + 400, WORLD_H)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      ctx.save()
      ctx.translate(-Math.round(cam.x), -Math.round(cam.y))
      const tw = Math.sin(step * 0.05) > 0.99 || Math.sin(step * 0.043 + 2) > 0.98 ? 1 : 0.75
      for (const s of STARS) {
        ctx.globalAlpha = 0.3 + s.r * 0.3 * tw
        ctx.fillStyle = '#cfd8ec'
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      ctx.beginPath()
      ctx.moveTo(0, WORLD_H)
      for (let x = 0; x <= WORLD_W; x += 80) ctx.lineTo(x, surfY(x) + 6)
      ctx.lineTo(WORLD_W, WORLD_H)
      ctx.closePath()
      const mGrad = ctx.createLinearGradient(0, WORLD_H, 0, 250)
      mGrad.addColorStop(0, '#232a36')
      mGrad.addColorStop(1, '#39424f')
      ctx.fillStyle = mGrad
      ctx.fill()
      for (let i = 0; i < BOULDERS.length; i++) {
        const c = BOULDERS[i]
        const g = ctx.createRadialGradient(c.x - c.r * 0.32, c.y - c.r * 0.4, c.r * 0.15, c.x, c.y, c.r)
        g.addColorStop(0, '#5d6880')
        g.addColorStop(0.75, '#414b5e')
        g.addColorStop(1, '#333c4b')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(120,132,158,0.25)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      ctx.fillStyle = '#e8e3ee'
      ctx.beginPath()
      ctx.arc(GOAL.x, GOAL.y - 18, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#3d2f33'
      ctx.beginPath()
      ctx.arc(GOAL.x, GOAL.y - 20, 8.5, Math.PI * 0.95, Math.PI * 2.15)
      ctx.fill()
      ctx.fillStyle = '#b8506a'
      ctx.beginPath()
      ctx.moveTo(GOAL.x - 7, GOAL.y - 10)
      ctx.lineTo(GOAL.x + 7, GOAL.y - 10)
      ctx.lineTo(GOAL.x + 10, GOAL.y + 12)
      ctx.lineTo(GOAL.x - 10, GOAL.y + 12)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,120,140,0.55)'
      const hb = Math.sin(step * 0.06) * 2
      ctx.beginPath()
      ctx.arc(GOAL.x - 4, GOAL.y - 44 - hb, 3, 0, Math.PI * 2)
      ctx.arc(GOAL.x + 4, GOAL.y - 44 - hb, 3, 0, Math.PI * 2)
      ctx.moveTo(GOAL.x - 6.6, GOAL.y - 42.5 - hb)
      ctx.lineTo(GOAL.x, GOAL.y - 36 - hb)
      ctx.lineTo(GOAL.x + 6.6, GOAL.y - 42.5 - hb)
      ctx.fill()

      ctx.strokeStyle = '#8a5a2b'
      ctx.lineWidth = 7
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(player.x + (tip.x - player.x) * 0.22, player.y + (tip.y - player.y) * 0.22)
      ctx.lineTo(tip.x, tip.y)
      ctx.stroke()
      const ang = Math.atan2(tip.y - player.y, tip.x - player.x)
      ctx.fillStyle = stuck ? '#aeb8cf' : '#8d96ac'
      ctx.beginPath()
      ctx.moveTo(tip.x + Math.cos(ang) * 11, tip.y + Math.sin(ang) * 11)
      ctx.lineTo(tip.x + Math.cos(ang + Math.PI * 0.68) * 8, tip.y + Math.sin(ang + Math.PI * 0.68) * 8)
      ctx.lineTo(tip.x + Math.cos(ang - Math.PI * 0.68) * 8, tip.y + Math.sin(ang - Math.PI * 0.68) * 8)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#c3cbdb'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.lineCap = 'round'
      ctx.moveTo(tip.x + Math.cos(ang) * 11, tip.y + Math.sin(ang) * 11)
      ctx.lineTo(tip.x + Math.cos(ang) * 5, tip.y + Math.sin(ang) * 5)
      ctx.stroke()

      ctx.save()
      ctx.translate(player.x, player.y)
      ctx.fillStyle = '#4a5468'
      ctx.beginPath()
      ctx.arc(0, 4, PLAYER_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#6d7791'
      ctx.beginPath()
      ctx.ellipse(0, 18, PLAYER_R * 0.92, 7, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#d9a066'
      ctx.beginPath()
      ctx.arc(0, -PLAYER_R + 2, 12, 0, Math.PI * 2)
      ctx.fill()
      const face = clamp((tip.x - player.x) / 40, -1, 1) * 2.5
      ctx.fillStyle = '#222'
      ctx.beginPath()
      ctx.arc(-4.5 + face, -PLAYER_R, 1.8, 0, Math.PI * 2)
      ctx.arc(4.5 + face, -PLAYER_R, 1.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.restore()

      if (hoverRef.current) {
        const mm = mouseRef.current
        ctx.strokeStyle = accent(mm.down ? 0.95 : 0.5)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(mm.x, mm.y, 14, 0, Math.PI * 2)
        ctx.stroke()
        if (mm.down) {
          ctx.fillStyle = accent(0.22)
          ctx.beginPath()
          ctx.arc(mm.x, mm.y, 14, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = accent(0.95)
        for (let i = 0; i < 4; i++) {
          const a = (Math.PI / 2) * i
          ctx.beginPath()
          ctx.arc(mm.x + Math.cos(a) * 7, mm.y + Math.sin(a) * 7, 1.3, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(mm.x, mm.y, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointerenter', enter)
      canvas.removeEventListener('pointerleave', leave)
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none select-none">
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors" title="Back to menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">GET OVER IT</span>
        </div>
        <button
          onClick={() => { resetBodies(); wonRef.current = false; setWon(false) }}
          className="text-xs px-2.5 py-1 rounded bg-ide-hover hover:bg-ide-hover/80 text-ide-text-muted transition-colors"
        >
          Reset
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-start justify-center overflow-hidden relative">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="h-full w-auto shrink-0 touch-none cursor-crosshair"
        />
        {won && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="flex flex-col items-center gap-3 p-6 rounded-xl bg-ide-sidebar border border-ide-border">
              <div className="text-lg font-bold text-ide-text">你做到了。就这样。</div>
              <button
                onClick={() => { resetBodies(); wonRef.current = false; setWon(false) }}
                className="px-4 py-1.5 rounded bg-ide-accent/90 text-ide-bg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                再玩一次
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="px-4 py-1.5 border-t border-ide-border text-[11px] text-ide-text-muted select-none">
        按住鼠标甩镐:镐头磕进石面就锚死,绕锚点画弧即把身体抡上去;猛地横甩鼠标可把镐头拔出来。
      </div>
    </div>
  )
}