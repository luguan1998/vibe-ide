import React, { useEffect, useRef, useState } from 'react'

const W = 560
const H = 800
const WORLD_W = 3200
const WORLD_H = 1600
const G = 1200
const PLAYER_R = 24
const HAMMER_LEN = 92
const TIP_R = 10
const STEP = 1 / 60
const TIP_GAIN = 16
const TIP_MAX = 1500

interface Circle { x: number; y: number; r: number }
interface Wall { x1: number; y1: number; x2: number; y2: number }

// 世界地形:起点缓坡 → 洞窟(东端封闭,墙角垫石翻出) → 峰坡 → 峰顶
const WALLS: Wall[] = [
  { x1: 0, y1: 1420, x2: 310, y2: 1420 },
  { x1: 310, y1: 1420, x2: 430, y2: 1330 },
  { x1: 430, y1: 1330, x2: 560, y2: 1295 },
  { x1: 560, y1: 1295, x2: 700, y2: 1235 },
  { x1: 700, y1: 1235, x2: 800, y2: 1180 },
  { x1: 800, y1: 1180, x2: 1100, y2: 1120 },
  { x1: 1100, y1: 1120, x2: 1380, y2: 1090 },
  { x1: 789, y1: 950, x2: 1100, y2: 980 },
  { x1: 1100, y1: 980, x2: 1390, y2: 950 },
  { x1: 1390, y1: 950, x2: 1620, y2: 760 },
  { x1: 1620, y1: 760, x2: 1830, y2: 540 },
  { x1: 1830, y1: 540, x2: 2000, y2: 370 },
  { x1: 2000, y1: 370, x2: 2130, y2: 255 },
  { x1: 2130, y1: 255, x2: 2260, y2: 255 },
  { x1: 2260, y1: 255, x2: 2260, y2: 1300 },
  { x1: 1380, y1: 1090, x2: 1390, y2: 950 },
]
const ROCKS: Circle[] = [
  { x: 930, y: 1114, r: 52 },
  { x: 1180, y: 1079, r: 44 },
  { x: 1348, y: 1000, r: 30 },
  { x: 1720, y: 702, r: 58 },
  { x: 1935, y: 478, r: 58 },
]
const SPAWN = { x: 150, y: 1392 }
const GOAL = { x: 2195, y: 205, r: 80 }

const STARS = Array.from({ length: 36 }, (_, i) => ({
  x: (i * 173 + 53) % WORLD_W,
  y: (i * 191 + 40) % 1300,
  r: 1 + (i % 3) * 0.5,
}))

interface Body { x: number; y: number; vx: number; vy: number; radius: number }
const player: Body = { x: SPAWN.x, y: SPAWN.y, vx: 0, vy: 0, radius: PLAYER_R }
const tip: Body = { x: player.x + HAMMER_LEN, y: player.y, vx: 0, vy: 0, radius: TIP_R }

const resetBodies = () => {
  player.x = SPAWN.x
  player.y = SPAWN.y
  player.vx = 0
  player.vy = 0
  tip.x = player.x + HAMMER_LEN
  tip.y = player.y
  tip.vx = 0
  tip.vy = 0
}

// sink:镐头可楔入岩面,抓住即不脱手
const collide = (b: Body, c: Circle, fric: number, rest: number, sink = 0) => {
  const nx = b.x - c.x
  const ny = b.y - c.y
  const d = Math.hypot(nx, ny)
  const min = c.r + b.radius - sink
  if (d >= min || d === 0) return false
  const ox = nx / d
  const oy = ny / d
  b.x += ox * (min - d)
  b.y += oy * (min - d)
  const vn = b.vx * ox + b.vy * oy
  if (vn < 0) {
    b.vx -= ox * vn * (1 + rest)
    b.vy -= oy * vn * (1 + rest)
    b.vx *= fric
    b.vy *= fric
  }
  return { ox, oy }
}

const collideWall = (b: Body, w: Wall, fric: number, rest: number, sink = 0) => {
  const abx = w.x2 - w.x1
  const aby = w.y2 - w.y1
  const len2 = abx * abx + aby * aby || 1
  let t = ((b.x - w.x1) * abx + (b.y - w.y1) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = w.x1 + abx * t
  const cy = w.y1 + aby * t
  const nx = b.x - cx
  const ny = b.y - cy
  const d = Math.hypot(nx, ny)
  if (d >= b.radius - sink || d === 0) return false
  const ox = nx / d
  const oy = ny / d
  b.x += ox * (b.radius - sink - d)
  b.y += oy * (b.radius - sink - d)
  const vn = b.vx * ox + b.vy * oy
  if (vn < 0) {
    b.vx -= ox * vn * (1 + rest)
    b.vy -= oy * vn * (1 + rest)
    b.vx *= fric
    b.vy *= fric
  }
  return { ox, oy }
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
    const cam = {
      x: Math.max(0, Math.min(WORLD_W - W, SPAWN.x - W / 2)),
      y: Math.max(0, Math.min(WORLD_H - H, SPAWN.y - H / 2)),
    }
    let angPrev = Math.atan2(tip.y - player.y, tip.x - player.x)
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      acc += Math.min((now - last) / 1000, 0.05)
      last = now
      while (acc >= STEP) {
        acc -= STEP
        step++
        for (let sub = 0; sub < 4; sub++) {
          const sdt = STEP / 3
          const m = mouseRef.current
          if (m.down) {
            const mx = m.x + cam.x - player.x
            const my = m.y + cam.y - player.y
            const md = Math.hypot(mx, my) || 1
            const tx = player.x + (mx / md) * HAMMER_LEN
            const ty = player.y + (my / md) * HAMMER_LEN
            tip.vx = Math.max(-TIP_MAX, Math.min(TIP_MAX, (tx - tip.x) * TIP_GAIN))
            tip.vy = Math.max(-TIP_MAX, Math.min(TIP_MAX, (ty - tip.y) * TIP_GAIN))
          } else {
            tip.vx *= 0.94
            tip.vy *= 0.94
            tip.vy += G * 0.35 * sdt
          }
          player.vy += G * sdt
          player.x += player.vx * sdt
          player.y += player.vy * sdt
          tip.x += tip.vx * sdt
          tip.y += tip.vy * sdt

          let contact = false
          for (let it = 0; it < 6; it++) {
            const dx = tip.x - player.x
            const dy = tip.y - player.y
            const d = Math.hypot(dx, dy) || 0.001
            const diff = (d - HAMMER_LEN) / d
            const wT = contact ? 0.15 : 0.62
            tip.x -= dx * diff * wT
            tip.y -= dy * diff * wT
            player.x += dx * diff * (1 - wT)
            player.y += dy * diff * (1 - wT)
            let cNow = false
            let pNow = false
            let flat = 0
            for (const c of ROCKS) {
              const hp = collide(player, c, 0.94, 0.1)
              if (hp) { pNow = true; flat = Math.max(flat, Math.abs(hp.oy)) }
              if (collide(tip, c, 0.9, 0.02, 2)) cNow = true
            }
            for (const w of WALLS) {
              const hp = collideWall(player, w, 0.94, 0.15)
              if (hp) { pNow = true; flat = Math.max(flat, Math.abs(hp.oy)) }
              if (collideWall(tip, w, 0.9, 0.05, 2)) cNow = true
            }
            if (pNow) {
              player.vx *= 0.86
              player.vy *= 0.93
              if (flat > 0.7 && Math.hypot(player.vx, player.vy) < 42) {
                player.vx = 0
                player.vy = 0
              }
            }
            contact = cNow
          }
          // 锤头接触时为支点,挥杆角速度把玩家沿切向甩出(原版铰链马达等效)
          const angNow = Math.atan2(tip.y - player.y, tip.x - player.x)
          let dA = angNow - angPrev
          if (dA > Math.PI) dA -= Math.PI * 2
          if (dA < -Math.PI) dA += Math.PI * 2
          angPrev = angNow
          const omega = dA / sdt
          if (contact && Math.abs(omega) > 2 && Math.abs(omega) < 50) {
            const kick = omega * HAMMER_LEN * 0.05
            player.vx += -Math.sin(angNow) * kick
            player.vy += Math.cos(angNow) * kick
            player.vx = Math.max(-1000, Math.min(1000, player.vx))
            player.vy = Math.max(-1000, Math.min(1000, player.vy))
          }
        }
        player.x = Math.max(12, Math.min(WORLD_W - 12, player.x))
        player.y = Math.max(10, Math.min(WORLD_H + 40, player.y))
        tip.x = Math.max(6, Math.min(WORLD_W - 6, tip.x))
        tip.y = Math.max(6, Math.min(WORLD_H + 40, tip.y))
        if (player.y > WORLD_H - 60 || (player.x > 2268 && player.y > 1330)) {
          resetBodies()
          angPrev = Math.atan2(tip.y - player.y, tip.x - player.x)
        }
        if (Math.hypot(player.x - GOAL.x, player.y - GOAL.y) < GOAL.r && !wonRef.current) {
          wonRef.current = true
          setWon(true)
        }
      }
      cam.x += (Math.max(0, Math.min(WORLD_W - W, player.x - W / 2)) - cam.x) * 0.18
      cam.y += (Math.max(0, Math.min(WORLD_H - H, player.y - H / 2)) - cam.y) * 0.18

      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, '#16233f')
      grad.addColorStop(1, '#2c4468')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)

      ctx.save()
      ctx.translate(-Math.round(cam.x), -Math.round(cam.y))
      const tw = Math.sin(step * 0.05) > 0.99 || Math.sin(step * 0.043 + 2) > 0.98 ? 1 : 0.75
      for (const s of STARS) {
        ctx.globalAlpha = 0.4 + s.r * 0.25 * tw
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      for (let i = 0; i < 6; i++) {
        const cx = ((i * 733 + step * 3) % (WORLD_W + 160)) - 80
        const cy = 120 + (i % 6) * 240
        ctx.beginPath()
        ctx.arc(cx, cy, 24 + (i % 3) * 8, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.beginPath()
      ctx.moveTo(0, 1420)
      ctx.lineTo(310, 1420)
      ctx.lineTo(430, 1330)
      ctx.lineTo(560, 1295)
      ctx.lineTo(700, 1235)
      ctx.lineTo(800, 1180)
      ctx.lineTo(1100, 1120)
      ctx.lineTo(1380, 1090)
      ctx.lineTo(1390, 950)
      ctx.lineTo(1620, 760)
      ctx.lineTo(1830, 540)
      ctx.lineTo(2000, 370)
      ctx.lineTo(2130, 255)
      ctx.lineTo(2260, 255)
      ctx.lineTo(2260, 1300)
      ctx.lineTo(2260, 1600)
      ctx.lineTo(0, 1600)
      ctx.closePath()
      const mGrad = ctx.createLinearGradient(0, 1600, 0, 255)
      mGrad.addColorStop(0, '#2b333f')
      mGrad.addColorStop(1, '#414c5c')
      ctx.fillStyle = mGrad
      ctx.fill()
      ctx.strokeStyle = '#5a6578'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(0, 1420)
      ctx.lineTo(310, 1420)
      ctx.lineTo(430, 1330)
      ctx.lineTo(560, 1295)
      ctx.lineTo(700, 1235)
      ctx.lineTo(800, 1180)
      ctx.lineTo(1100, 1120)
      ctx.lineTo(1380, 1090)
      ctx.lineTo(1390, 950)
      ctx.lineTo(1620, 760)
      ctx.lineTo(1830, 540)
      ctx.lineTo(2000, 370)
      ctx.lineTo(2130, 255)
      ctx.lineTo(2260, 255)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(90,101,120,0.35)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(2260, 255)
      ctx.lineTo(2260, 1300)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(800, 1180)
      ctx.lineTo(789, 950)
      ctx.lineTo(1100, 980)
      ctx.lineTo(1390, 950)
      ctx.lineTo(1380, 1090)
      ctx.lineTo(1100, 1120)
      ctx.closePath()
      ctx.fillStyle = 'rgba(3,5,9,0.92)'
      ctx.fill()
      ctx.strokeStyle = '#323b4a'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(789, 950)
      ctx.lineTo(1100, 980)
      ctx.lineTo(1390, 950)
      ctx.moveTo(1380, 1090)
      ctx.lineTo(1390, 950)
      ctx.stroke()
      ctx.strokeStyle = '#0a0d14'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(789, 945)
      ctx.lineTo(800, 1185)
      ctx.stroke()

      for (const c of ROCKS) {
        const g = ctx.createRadialGradient(c.x - c.r * 0.3, c.y - c.r * 0.35, c.r * 0.2, c.x, c.y, c.r)
        g.addColorStop(0, '#5d6575')
        g.addColorStop(1, '#3a4152')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
        ctx.fill()
      }

      const poleTop = 200
      ctx.strokeStyle = '#e8c766'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(2195, 253)
      ctx.lineTo(2195, poleTop)
      ctx.stroke()
      const wave = Math.sin(step * 0.09) * 8
      ctx.fillStyle = '#e2574c'
      ctx.beginPath()
      ctx.moveTo(2195, poleTop)
      ctx.lineTo(2195 + 34, poleTop + 8 + wave * 0.3)
      ctx.lineTo(2195, poleTop + 16)
      ctx.closePath()
      ctx.fill()

      ctx.strokeStyle = '#8a5a2b'
      ctx.lineWidth = 7
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(player.x + (tip.x - player.x) * 0.22, player.y + (tip.y - player.y) * 0.22)
      ctx.lineTo(tip.x, tip.y)
      ctx.stroke()
      const ang = Math.atan2(tip.y - player.y, tip.x - player.x)
      ctx.fillStyle = '#8d96ac'
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
      ctx.fillStyle = '#222'
      ctx.beginPath()
      ctx.arc(-4.5, -PLAYER_R, 1.8, 0, Math.PI * 2)
      ctx.arc(4.5, -PLAYER_R, 1.8, 0, Math.PI * 2)
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
              <div className="text-lg font-bold text-ide-text">登顶成功!</div>
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
        按住鼠标甩动锤子:锤头砸进山岩会卡住,拖动方向把身体拽上去。
      </div>
    </div>
  )
}
