import React, { useState, useEffect, useCallback, useRef } from 'react'

// ═══════════════════════════════════════
// Pixel dragon — side profile, 26×18 @ 5px
// Based on classic dragon silhouette:
// curved neck, spread wings, long tail
// G=green-body  D=dark-body  L=lime-belly
// Y=gold-horn   W=wing-membrane
// R=red-eye     B=dark-pupil  X=wound
// ═══════════════════════════════════════

const CM: Record<string, string> = {
  '.': 'transparent',
  G: '#3E8C42',
  D: '#1E5C22',
  L: '#7CB342',
  Y: '#E8B830',
  W: '#6B1D30',
  R: '#CC2222',
  B: '#111111',
  X: '#FF3333',
}

const SPRITES: Record<string, string[]> = {
  normal: [
    '..........................',
    '.........WWWWW............',
    '.......WWWWWWWWW..........',
    '......WWWGGGGGWWW.........',
    '......WWGGGGGGGWY.........',
    '.......GGGGGGGGYYY........',
    '.......GGGGGGRGBY.........',
    '........GGGGGRRRY.........',
    '.........GGGGGRY..........',
    '.........GGGGGG...........',
    '......GGGDDDDDGG..........',
    '......GGLLLLLLLGG.........',
    '.......GGLLLLLGG..........',
    '........GGG.GGG...........',
    '.........G...G............',
    '.........G...G............',
    '.........G...G............',
    '........G.....G...........',
  ],
  hurt: [
    '..........................',
    '.........WWWWW............',
    '.......WWWWWWWWW..........',
    '......WWWGGGGGWWW.........',
    '......WWGGGGGGGWY.........',
    '.......GGGGGGGGYYY........',
    '.......GGGGGGRGBY.........',
    '........GGGGGRRRY.........',
    '.........GGGGGRY..........',
    '.........GGGGGG...........',
    '......GGXDDDDXGG..........',
    '......GGLLLLLLLGG.........',
    '.......GGLLLLLGG..........',
    '........GGG.GGG...........',
    '.........G...G............',
    '.........G...G............',
    '.........G...G............',
    '........G.....G...........',
  ],
  crit: [
    '..........................',
    '.........WWWWW............',
    '.......WXWWWWXW...........',
    '......WWWGGGGGWWW.........',
    '......WWGGGGXGGWY.........',
    '.......GGGGGGGGYYY........',
    '.......GGGGXGRGBY.........',
    '........GGGGGRRXY.........',
    '.........GGGGGRY..........',
    '.........GGGGGG...........',
    '......GGXDDDDXGG..........',
    '......GGLLLLLLLGG.........',
    '.......GGLLLLLGG..........',
    '........GGG.GGG...........',
    '.........G...G............',
    '.........G...G............',
    '.........G...G............',
    '........G.....G...........',
  ],
  dead: [
    '..........................',
    '.........WXWXW............',
    '.......WXXWXXWXX..........',
    '......XWWGGGGGWWX.........',
    '......WWGGGGXGGWY.........',
    '.......GGGXGGGYYY.........',
    '.......GGXGGGRGBY.........',
    '........GGXGGRRXY.........',
    '.........GGXGGRY..........',
    '.........GXGGGG...........',
    '......GGXXDDDXGG..........',
    '......GGLLLLLLLGG.........',
    '.......GGLLLLLGG..........',
    '........GGG.GGG...........',
    '.........G...G............',
    '.........G...G............',
    '.........G...G............',
    '........G.....G...........',
  ],
}

const SCALE = 5

interface Particle {
  id: number; x: number; y: number
  vx: number; vy: number; color: string; size: number
}

interface DmgNum {
  id: number; dmg: number; x: number; y: number
}

// ═══════════════════════════════════════
// Canvas King — zero sub-pixel gaps
// ═══════════════════════════════════════

function KingSprite({ sprite, shaking, flash }: { sprite: string[]; shaking: boolean; flash: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const h = sprite.length
  const w = sprite[0]?.length ?? 0

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    for (let r = 0; r < h; r++) {
      const row = sprite[r]
      for (let col = 0; col < w; col++) {
        const color = CM[row[col]]
        if (!color || color === 'transparent') continue
        ctx.fillStyle = color
        ctx.fillRect(col, r, 1, 1)
      }
    }
  }, [sprite, w, h])

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={h}
      className={`inline-block ${shaking ? 'animate-[shake_0.1s_ease-in-out_2]' : ''}`}
      style={{
        width: w * SCALE,
        height: h * SCALE,
        imageRendering: 'pixelated',
        filter: flash ? 'brightness(2.2) saturate(0.2)' : 'none',
        transition: 'filter 0.04s',
      }}
    />
  )
}

// ═══════════════════════════════════════
// Main
// ═══════════════════════════════════════

export default function GameKillKing({ onBack }: { onBack?: () => void }) {
  const [kingHP, setKingHP] = useState(100)
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'won'>('idle')
  const [shaking, setShaking] = useState(false)
  const [flash, setFlash] = useState(false)
  const [slashIdx, setSlashIdx] = useState(-1)
  const [particles, setParticles] = useState<Particle[]>([])
  const [dmgNums, setDmgNums] = useState<DmgNum[]>([])
  const [combo, setCombo] = useState(0)
  const [hitCount, setHitCount] = useState(0)

  const comboRef = useRef(0)
  const gameStateRef = useRef(gameState)
  const kingHPRef = useRef(kingHP)
  const lastHitRef = useRef(0)

  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { kingHPRef.current = kingHP }, [kingHP])

  const spawnParticles = useCallback(() => {
    const now = Date.now()
    const count = 8 + Math.floor(Math.random() * 8)
    const parts: Particle[] = []
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 5
      parts.push({
        id: now + i, x: 50, y: 50,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: ['#FFD700', '#FF6030', '#FFAA00', '#FFF'][Math.floor(Math.random() * 4)],
        size: 3 + Math.random() * 5,
      })
    }
    setParticles(prev => [...prev, ...parts])
    setTimeout(() => setParticles(prev => prev.filter(p => !parts.includes(p))), 500)
  }, [])

  const attack = useCallback(() => {
    const state = gameStateRef.current
    if (state === 'idle') {
      setGameState('playing')
      lastHitRef.current = Date.now()
      comboRef.current = 0
      setHitCount(0)
      return
    }
    if (state === 'won') return

    const now = Date.now()
    const elapsed = now - lastHitRef.current
    lastHitRef.current = now

    if (elapsed < 550) {
      comboRef.current += 1
    } else {
      comboRef.current = 0
    }
    setCombo(comboRef.current)
    setHitCount(c => c + 1)

    const baseDmg = 5 + Math.floor(Math.random() * 6)
    const comboBonus = Math.min(comboRef.current * 2, 12)
    const dmg = baseDmg + comboBonus

    setShaking(true)
    setFlash(true)
    setTimeout(() => setFlash(false), 50)

    setSlashIdx(comboRef.current % 3)
    spawnParticles()

    setTimeout(() => setShaking(false), 140)
    setTimeout(() => setSlashIdx(-1), 200)

    const id = now + Math.random()
    setDmgNums(prev => [...prev.slice(-6), { id, dmg, x: 30 + Math.random() * 40, y: 10 + Math.random() * 25 }])
    setTimeout(() => setDmgNums(prev => prev.filter(d => d.id !== id)), 750)

    const newHP = Math.max(0, kingHPRef.current - dmg)
    setKingHP(newHP)
    if (newHP <= 0) setGameState('won')
  }, [spawnParticles])

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        attack()
      }
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  }, [attack])

  const restart = useCallback(() => {
    setKingHP(100); setGameState('idle'); setSlashIdx(-1)
    setParticles([]); setDmgNums([]); setCombo(0); setHitCount(0)
    setShaking(false); setFlash(false)
    comboRef.current = 0
  }, [])

  const hpPct = kingHP / 100
  const sprite = gameState === 'won' ? SPRITES.dead
    : hpPct > 0.5 ? SPRITES.normal
    : hpPct > 0.2 ? SPRITES.hurt
    : SPRITES.crit

  const totalSegs = 20
  const filled = Math.ceil((kingHP / 100) * totalSegs)
  const barColor = hpPct > 0.5 ? '#5BBC5B' : hpPct > 0.2 ? '#E89030' : '#E04040'

  const SLASH_PATHS = [
    { x1: 85, y1: 5,  x2: 5,  y2: 85, cx: 55, cy: 20, r: 55 },
    { x1: 5,  y1: 5,  x2: 85, y2: 85, cx: 35, cy: 20, r: 55 },
    { x1: 90, y1: 40, x2: 0,  y2: 40, cx: 45, cy: 15, r: 60 },
  ]
  const slashPath = slashIdx >= 0 ? SLASH_PATHS[slashIdx] : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none" tabIndex={-1}>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translate(0, 0); }
          15% { transform: translate(-2px, 1px); }
          35% { transform: translate(3px, -2px); }
          55% { transform: translate(-3px, -1px); }
          75% { transform: translate(1px, 2px); }
        }
        @keyframes slashDraw {
          0% { stroke-dashoffset: 180; opacity: 0.3; }
          30% { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 0.6; }
        }
        @keyframes slashFade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes floatDmg {
          0% { transform: translateY(0) scale(0.5); opacity: 1; }
          25% { transform: translateY(-10px) scale(1.2); }
          100% { transform: translateY(-32px) scale(0.8); opacity: 0; }
        }
        @keyframes particleOut {
          0% { transform: translate(0, 0) scale(1); opacity: 1; }
          100% { transform: translate(var(--vx), var(--vy)) scale(0); opacity: 0; }
        }
        @keyframes popIn {
          0% { opacity: 0; transform: scale(2.5); }
          70% { transform: scale(0.9); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes crownGlow {
          0%, 100% { filter: drop-shadow(0 0 6px #FFD700); }
          50% { filter: drop-shadow(0 0 20px #FFD700) drop-shadow(0 0 6px #FFA000); }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors" title="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <span className="text-sm">🐉</span>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider uppercase">Slay the Dragon</span>
        </div>
        <div className="flex items-center gap-2">
          {combo > 3 && (
            <span className="text-xs font-bold text-ide-warning animate-[popIn_0.25s_ease-out]" style={{ fontFamily: 'monospace' }}>
              {combo}x COMBO
            </span>
          )}
        </div>
      </div>

      {/* Game area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4 relative overflow-hidden" style={{ backgroundColor: '#1C1C2E' }}>
        {/* BG: pixel pillars */}
        <div className="absolute inset-0 pointer-events-none opacity-5">
          <div className="absolute left-3 top-0 bottom-0 w-6" style={{ background: 'repeating-linear-gradient(to bottom, #AAA 0px, #AAA 4px, transparent 4px, transparent 8px)' }} />
          <div className="absolute right-3 top-0 bottom-0 w-6" style={{ background: 'repeating-linear-gradient(to bottom, #AAA 0px, #AAA 4px, transparent 4px, transparent 8px)' }} />
        </div>

        {/* King + effects layer */}
        <div className="relative flex flex-col items-center z-10">
          <div className={gameState === 'won' ? 'animate-[crownGlow_2s_ease-in-out_infinite]' : ''}>
            <KingSprite sprite={sprite} shaking={shaking} flash={flash} />
          </div>

          {/* Slash SVG */}
          {slashPath && (
            <svg viewBox="0 0 90 90" className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ filter: 'drop-shadow(0 0 8px rgba(255,215,0,0.9)) drop-shadow(0 0 2px #FFF)' }}>
              <line x1={slashPath.x1} y1={slashPath.y1} x2={slashPath.x2} y2={slashPath.y2}
                stroke="#FFD700" strokeWidth="6" strokeLinecap="round" strokeDasharray="180"
                style={{ animation: 'slashDraw 0.15s ease-out forwards, slashFade 0.18s 0.17s ease-out forwards' }} />
              <line x1={slashPath.x1} y1={slashPath.y1} x2={slashPath.x2} y2={slashPath.y2}
                stroke="#FFF" strokeWidth="2" strokeLinecap="round" strokeDasharray="180"
                style={{ animation: 'slashDraw 0.15s ease-out forwards, slashFade 0.18s 0.17s ease-out forwards' }} />
              <circle cx={slashPath.cx} cy={slashPath.cy} r={slashPath.r} fill="none"
                stroke="rgba(255,215,0,0.25)" strokeWidth="14"
                style={{ animation: 'slashDraw 0.15s ease-out forwards, slashFade 0.12s 0.2s ease-out forwards' }} />
            </svg>
          )}

          {/* Particles */}
          {particles.map(p => (
            <div key={p.id} className="absolute pointer-events-none"
              style={{
                left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size,
                backgroundColor: p.color,
                '--vx': `${p.vx * 30}px`, '--vy': `${p.vy * 30}px`,
                animation: 'particleOut 0.45s ease-out forwards',
              } as React.CSSProperties} />
          ))}

          {/* Damage numbers */}
          {dmgNums.map(dn => (
            <div key={dn.id} className="absolute pointer-events-none font-bold text-lg"
              style={{
                left: `${dn.x}%`, top: `${dn.y}%`,
                animation: 'floatDmg 0.75s ease-out forwards',
                color: combo > 3 ? '#FFD700' : '#FF5555',
                fontFamily: 'monospace',
                textShadow: '2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000',
              }}>-{dn.dmg}</div>
          ))}
        </div>

        {/* HP bar */}
        <div className="w-full max-w-[220px] flex flex-col items-center gap-1 z-10">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-gray-400 font-mono tracking-widest">HP</span>
            <div className="flex border-2 border-[#555] p-px" style={{ background: '#1a1a1a', imageRendering: 'pixelated' }}>
              {Array.from({ length: totalSegs }).map((_, i) => (
                <div key={i} className="transition-all duration-150"
                  style={{
                    width: 7, height: 14,
                    backgroundColor: i < filled ? barColor : '#2a2a2a',
                    marginRight: i < totalSegs - 1 ? 1 : 0,
                  }} />
              ))}
            </div>
          </div>
          <span className="text-[9px] font-mono font-bold" style={{ color: barColor }}>{kingHP} / 100</span>
        </div>

        {/* Bottom UI */}
        <div className="text-center z-10" style={{ minHeight: 55 }}>
          {gameState === 'idle' && (
            <div className="flex flex-col items-center gap-2">
              <span className="text-sm font-bold animate-pulse"
                style={{ color: '#FFD700', fontFamily: 'monospace', textShadow: '0 0 8px rgba(255,215,0,0.5)' }}>
                PRESS SPACE
              </span>
              <span className="text-[10px] text-gray-500 font-mono">Slay the dragon — press SPACE!</span>
            </div>
          )}
          {gameState === 'playing' && (
            <span className="text-[9px] text-gray-500 font-mono">[ SPACE ] Attack</span>
          )}
          {gameState === 'won' && (
            <div className="flex flex-col items-center gap-3 animate-[popIn_0.5s_ease-out]">
              <span className="text-lg">🐉💀</span>
              <span className="text-sm font-bold" style={{ color: '#F08020', fontFamily: 'monospace', textShadow: '0 0 8px rgba(240,128,32,0.5)' }}>
                DRAGON SLAIN
              </span>
              <span className="text-[10px] text-gray-400 font-mono">{hitCount} hits</span>
              <button onClick={restart}
                className="px-5 py-2 text-xs font-bold text-white transition-colors"
                style={{ backgroundColor: '#9B1D20', fontFamily: 'monospace', border: '2px solid #F0C830', boxShadow: '0 0 8px rgba(240,200,48,0.3)' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#B02025')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#9B1D20')}>
                SLAY AGAIN
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
