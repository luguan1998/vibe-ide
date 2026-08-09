import React, { useState, useEffect, useCallback, useRef } from 'react'

const W = 480
const H = 640
const DURATION = 360
const PLAYER_R = 13
const MAX_LV = 4
const PASSIVE_MAX_LV = 5
const BEST_KEY = 'vampire-best'
const WAVE_SEC = 30
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", sans-serif'

interface EnemyDef { name: string; emoji: string; hp: number; speed: number; r: number; dmg: number; xp: number; color: string }
const ENEMY_TYPES: Record<string, EnemyDef> = {
  bat: { name: '蝙蝠', emoji: '🦇', hp: 12, speed: 95, r: 13, dmg: 10, xp: 1, color: '#9c27b0' },
  zombie: { name: '僵尸', emoji: '🧟', hp: 32, speed: 42, r: 16, dmg: 16, xp: 2, color: '#66bb6a' },
  skel: { name: '骷髅', emoji: '💀', hp: 22, speed: 72, r: 14, dmg: 13, xp: 2, color: '#bdbdbd' },
  elite: { name: '精英', emoji: '👹', hp: 110, speed: 52, r: 26, dmg: 32, xp: 25, color: '#ef5350' },
  ghost: { name: '幽灵', emoji: '👻', hp: 14, speed: 120, r: 12, dmg: 8, xp: 1, color: '#e1bee7' },
  wolf: { name: '野狼', emoji: '🐺', hp: 30, speed: 85, r: 14, dmg: 15, xp: 2, color: '#a1887f' },
  snake: { name: '毒蛇', emoji: '🐍', hp: 18, speed: 105, r: 12, dmg: 12, xp: 1, color: '#9ccc65' },
  spider: { name: '毒蛛', emoji: '🕷️', hp: 60, speed: 35, r: 18, dmg: 22, xp: 4, color: '#455a64' },
  golem: { name: '石魔', emoji: '🗿', hp: 95, speed: 30, r: 22, dmg: 26, xp: 6, color: '#b0bec5' },
  giant: { name: '巨兽', emoji: '🦍', hp: 200, speed: 38, r: 30, dmg: 45, xp: 40, color: '#8d6e63' },
  boss: { name: '恶魔领主', emoji: '👿', hp: 340, speed: 55, r: 30, dmg: 25, xp: 100, color: '#d32f2f' },
  dino: { name: '恐龙领主', emoji: '🦖', hp: 320, speed: 60, r: 30, dmg: 34, xp: 100, color: '#558b2f' },
}

interface WeaponDef { id: string; name: string; desc: string; icon: string }
const WEAPONS: WeaponDef[] = [
  { id: 'wand', name: '魔杖', desc: '自动射击最近的敌人', icon: '✨' },
  { id: 'dagger', name: '飞刀', desc: '扇形散射多枚飞刀', icon: '🗡️' },
  { id: 'holy', name: '圣水', desc: '脚下留下持续法阵', icon: '⚗️' },
  { id: 'orb', name: '雷环', desc: '周期性对周围放电', icon: '⚡' },
  { id: 'blade', name: '环绕之刃', desc: '利刃绕身旋转', icon: '🔪' },
]
interface PassiveDef { id: string; name: string; desc: string; icon: string; maxLv: number }
const PASSIVES: PassiveDef[] = [
  { id: 'magnet', name: '磁铁', desc: '吸取范围 +50%', icon: '🧲', maxLv: PASSIVE_MAX_LV },
  { id: 'boots', name: '疾风靴', desc: '移速 +15%', icon: '👟', maxLv: PASSIVE_MAX_LV },
  { id: 'rage', name: '狂暴', desc: '武器伤害 +15%', icon: '🔥', maxLv: PASSIVE_MAX_LV },
  { id: 'armor', name: '铁壁', desc: '最大生命 +20', icon: '🛡️', maxLv: PASSIVE_MAX_LV },
  { id: 'regen', name: '再生', desc: '每秒回复 1 生命', icon: '💚', maxLv: PASSIVE_MAX_LV },
]

interface EvolutionDef { base: string; passive: string; id: string; name: string; icon: string; desc: string }
const EVOLUTIONS: EvolutionDef[] = [
  { base: 'wand', passive: 'rage', id: 'wandx', name: '神圣魔杖', icon: '🌟', desc: '追踪弹·无限穿透·伤害翻倍' },
  { base: 'dagger', passive: 'armor', id: 'daggerx', name: '千刃', icon: '💫', desc: '数量翻倍·刀刃穿透' },
  { base: 'holy', passive: 'regen', id: 'holyx', name: '血色黎明', icon: '☄️', desc: '法阵跟随移动·范围大增' },
  { base: 'orb', passive: 'magnet', id: 'orbx', name: '雷暴', icon: '🌩️', desc: '全场落雷·伤害翻倍' },
  { base: 'blade', passive: 'boots', id: 'bladex', name: '瓦尔玛努斯', icon: '🌀', desc: '巨型环绕之刃·数量更多' },
]

interface Enemy { id: number; type: string; x: number; y: number; hp: number; maxHp: number; speed: number; r: number; dmg: number; xp: number; emoji: string; color: string; hitFlash: number; kbx: number; kby: number; phase: number; atkCd: number; charge: number; glv: number; wind: number; burrow: number; dead?: boolean }
interface Shot { x: number; y: number; vx: number; vy: number; dmg: number; kind: 'wand' | 'dagger'; life: number; pierce: number; evo?: boolean }
interface EnemyShot { x: number; y: number; vx: number; vy: number; ttl: number; r: number; dmg: number; rot: number }
interface AoE { x: number; y: number; r: number; dmg: number; ttl: number; tickAcc: number; pulse: number; follow?: boolean }
interface Zap { start: { x: number; y: number }; pts: { x: number; y: number }[]; ttl: number; maxTtl: number }
interface Gem { x: number; y: number; v: number; t: number }
interface Blade { angle: number; dist: number; hitCd: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
interface Trail { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
interface DeathFx { x: number; y: number; emoji: string; size: number; color: string; t: number; maxT: number; big: boolean }
interface FloatText { x: number; y: number; text: string; color: string; t: number }
interface Decoration { x: number; y: number; emoji: string; size: number; alpha: number }

interface Option { kind: 'weapon' | 'passive' | 'evolve'; id: string; name: string; desc: string; icon: string; cur: number; next: number }

type Phase = 'playing' | 'paused' | 'levelup' | 'over' | 'win'

const hexToRgba = (hex: string, a: number) => {
  const m = hex.replace('#', '')
  const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m
  const n = parseInt(v, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${ss < 10 ? '0' : ''}${ss}`
}

export const MAGE_SVG_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path d="M15.6 10.4C12.6 8.8 12.8 3 16 0.8c3.2 2.2 3.4 8 0.4 9.6z" fill="#7e57c2" stroke="#5e35b1" stroke-width="1.1"/>
  <path d="M8.4 10.8q7.6 3.2 15.2 0q-7.6 2.2-15.2 0z" fill="#673ab7" stroke="#5e35b1" stroke-width="1"/>
  <path d="M12.8 5.6l.6 1.3 1.4.2-1 .9.2 1.4-1.2-.7-1.2.7.2-1.4-1-.9 1.4-.2z" fill="#ffd54f" opacity="0.95"/>
  <circle cx="16" cy="13.4" r="3.4" fill="#f5d7b8" stroke="#d8b08c" stroke-width="0.6"/>
  <circle cx="14.7" cy="13.1" r="0.7" fill="#2f3542"/>
  <circle cx="17.3" cy="13.1" r="0.7" fill="#2f3542"/>
  <path d="M13.3 14.8c1.8 1.1 3.6 1.1 5.4 0 .2 1.7-.8 2.9-2.7 2.9-1.9 0-2.9-1.2-2.7-2.9z" fill="#f5f5f5" stroke="#e0e0e0" stroke-width="0.6"/>
  <path d="M16 16.5l6.8 3v7.4c0 3.2-2.7 5.2-6.8 5.8-4.1-.6-6.8-2.6-6.8-5.8v-7.4z" fill="#5c6bc0" stroke="#3f51b5" stroke-width="1.1"/>
  <path d="M16 18.2l4.4 1.9v4c0 2.2-1.8 3.6-4.4 4-2.6-.4-4.4-1.8-4.4-4v-4z" fill="#7986cb" opacity="0.6"/>
  <rect x="12.8" y="23" width="6.4" height="1.7" rx="0.85" fill="#ffd54f" stroke="#b08a2e" stroke-width="0.5"/>
  <rect x="7.4" y="17.8" width="3" height="4.4" rx="1.4" fill="#f5d7b8" stroke="#d8b08c" stroke-width="0.6"/>
  <rect x="21.6" y="17.2" width="3" height="4.8" rx="1.4" fill="#f5d7b8" stroke="#d8b08c" stroke-width="0.6"/>
  <path d="M24.6 8.5 L22.8 24" stroke="#8d6e63" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="25" cy="7.2" r="2.6" fill="#7e57c2" stroke="#5e35b1" stroke-width="0.8"/>
  <path d="M25 3.8l.8 1.7 1.9.3-1.4 1.3.3 1.8-1.6-1-1.6 1 .3-1.8-1.4-1.3 1.9-.3z" fill="#ffd54f"/>
</svg>`)

const shuffle = <T,>(arr: T[]): T[] => {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function GameVampire({ onBack }: { onBack?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const mageImgRef = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    const img = new Image()
    img.src = MAGE_SVG_URL
    mageImgRef.current = img
  }, [])

  const keysRef = useRef<Set<string>>(new Set())
  const enemiesRef = useRef<Enemy[]>([])
  const shotsRef = useRef<Shot[]>([])
  const enemyShotsRef = useRef<EnemyShot[]>([])
  const aoeRef = useRef<AoE[]>([])
  const zapsRef = useRef<Zap[]>([])
  const gemsRef = useRef<Gem[]>([])
  const bladesRef = useRef<Blade[]>([])
  const partsRef = useRef<Particle[]>([])
  const trailsRef = useRef<Trail[]>([])
  const deathsRef = useRef<DeathFx[]>([])
  const textsRef = useRef<FloatText[]>([])
  const animRef = useRef(0)
  const enemyIdRef = useRef(1)

  const playerRef = useRef({
    x: W / 2, y: H / 2, hp: 100, maxHp: 100, speed: 150,
    level: 1, xp: 0, xpNext: 14, invuln: 0, facing: 0,
    weaponTimers: {} as Record<string, number>,
    regenAcc: 0, hitFlash: 0,
  })
  const weaponsRef = useRef<Record<string, number>>({ wand: 1 })
  const passivesRef = useRef<Record<string, number>>({})

  const waveRef = useRef({ n: 1, t: 2.2 })
  const elapsedRef = useRef(0)
  const spawnAccRef = useRef(0)
  const eliteAccRef = useRef(35)
  const giantAccRef = useRef(0)
  const killsRef = useRef(0)
  const shakeRef = useRef(0)
  const flashRedRef = useRef(0)
  const phaseRef = useRef<Phase>('playing')
  const lastWaveRef = useRef(0)
  const bossAccRef = useRef(70)
  const bossCountRef = useRef(0)
  const bossBannerRef = useRef(0)
  const endlessBannerRef = useRef(0)
  const endlessRef = useRef(false)
  const finalBossAccRef = useRef(0)
  const finalBannerRef = useRef(0)

  const [phase, setPhase] = useState<Phase>('playing')
  const [hp, setHp] = useState(100)
  const [level, setLevel] = useState(1)
  const [xp, setXp] = useState(0)
  const [xpNext, setXpNext] = useState(14)
  const [kills, setKills] = useState(0)
  const [time, setTime] = useState(0)
  const [options, setOptions] = useState<Option[]>([])
  const optionsRef = useRef<Option[]>([])
  optionsRef.current = options
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedIndexRef = useRef(0)
  const [best, setBest] = useState(() => {
    try { return parseInt(localStorage.getItem(BEST_KEY) ?? '0', 10) || 0 } catch { return 0 }
  })
  const bestRef = useRef(best)
  const hpStateRef = useRef(100)

  const decorationsRef = useRef<Decoration[] | null>(null)
  if (!decorationsRef.current) {
    const decos: Decoration[] = []
    const emojis = ['🪦', '🌲', '🪨']
    for (let i = 0; i < 10; i++) {
      decos.push({
        x: Math.random() * W,
        y: Math.random() * H,
        emoji: emojis[Math.random() * emojis.length | 0],
        size: 14 + Math.random() * 18,
        alpha: 0.12 + Math.random() * 0.2,
      })
    }
    decorationsRef.current = decos
  }

  const themeRef = useRef<{ grassBase: string; grassDark: string; grassBlade: string } | null>(null)
  if (!themeRef.current) {
    const cs = getComputedStyle(document.documentElement)
    const parse = (s: string) => {
      const parts = s.trim().split(/\s+/).map(Number)
      return parts.length === 3 && parts.every(n => !isNaN(n)) ? parts : null
    }
    const bg = parse(cs.getPropertyValue('--ide-bg')) ?? [13, 17, 23]
    const lum = (bg[0] + bg[1] + bg[2]) / 3
    const darkF = lum > 110 ? 0.45 : 1
    const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
    const shade = (rgb: number[], f: number) => rgb.map(v => Math.round(Math.min(255, v * f)))
    const grassBase = mix(shade(bg, 0.62 * darkF), [46, 125, 50], 0.5)
    const grassDark = shade(grassBase, 0.86)
    const grassBlade = shade(grassBase, 1.3)
    themeRef.current = {
      grassBase: `rgb(${grassBase.join(',')})`,
      grassDark: `rgb(${grassDark.join(',')})`,
      grassBlade: `rgb(${grassBlade.join(',')})`,
    }
  }

  const grassRef = useRef<{ x: number; y: number; len: number; lean: number; ph: number }[] | null>(null)
  if (!grassRef.current) {
    grassRef.current = Array.from({ length: 45 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      len: 4 + Math.random() * 7,
      lean: (Math.random() - 0.5) * 0.9,
      ph: Math.random() * Math.PI * 2,
    }))
  }

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  const setHpBoth = useCallback((v: number) => {
    playerRef.current.hp = v
    hpStateRef.current = v
    setHp(v)
  }, [])

  const saveBest = useCallback((secs: number) => {
    if (secs > bestRef.current) {
      bestRef.current = secs
      setBest(secs)
      try { localStorage.setItem(BEST_KEY, String(secs)) } catch {}
    }
  }, [])

  const spawnEnemy = useCallback((type: string) => {
    const def = ENEMY_TYPES[type]
    const wave = waveRef.current.n
    const mul = 1 + Math.max(0, wave - 1) * 0.18
    const side = Math.random() * 4 | 0
    const pad = 50
    let x = 0, y = 0
    if (side === 0) { x = Math.random() * W; y = -pad }
    else if (side === 1) { x = Math.random() * W; y = H + pad }
    else if (side === 2) { x = -pad; y = Math.random() * H }
    else { x = W + pad; y = Math.random() * H }
    const hpMul = type === 'elite' || type === 'boss' || type === 'dino' ? 1 + Math.max(0, wave - 1) * 0.22 : mul
    let hp = def.hp * hpMul
    let speed = def.speed * (1 + wave * 0.02)
    let r = def.r
    let dmg = def.dmg
    let glv = 0
    if (type === 'boss' || type === 'dino') {
      glv = bossCountRef.current++
      const g = Math.min(7, glv)
      hp *= 1 + 0.25 * g
      speed += 4 * g
      r = Math.min(44, def.r + 2.5 * g)
      dmg = def.dmg + 2 * g
    }
    enemiesRef.current.push({
      id: enemyIdRef.current++,
      type, x, y,
      hp,
      maxHp: hp,
      speed,
      r, dmg, xp: def.xp, emoji: def.emoji, color: def.color,
      hitFlash: 0, kbx: 0, kby: 0, phase: Math.random() * Math.PI * 2, atkCd: type === 'dino' ? 1.3 : 1.5 + Math.random() * 1.5, charge: 0, glv, wind: 0, burrow: 0,
    })
  }, [])

  const dropGems = useCallback((x: number, y: number, total: number) => {
    const gems = gemsRef.current
    const n = total <= 2 ? 1 : Math.min(6, Math.ceil(total / 2))
    for (let i = 0; i < n; i++) {
      const gv = total / n
      gems.push({ x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20, v: gv, t: Math.random() * Math.PI * 2 })
    }
  }, [])

  const addParts = useCallback((x: number, y: number, color: string, n: number, speed: number) => {
    const parts = partsRef.current
    if (parts.length > 350) return
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.3 + Math.random() * 0.9)
      parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 25 + Math.random() * 20 | 0, maxLife: 45, color, size: 1.5 + Math.random() * 2.5,
      })
    }
  }, [])

  const addText = useCallback((x: number, y: number, text: string, color: string) => {
    if (textsRef.current.length > 40) textsRef.current.shift()
    textsRef.current.push({ x, y, text, color, t: 0.8 })
  }, [])

  const hurtPlayer = useCallback((dmg: number, fromX: number, fromY: number) => {
    const p = playerRef.current
    if (p.invuln > 0 || phaseRef.current !== 'playing') return
    p.invuln = 1.2
    p.hitFlash = 0.25
    flashRedRef.current = 0.4
    shakeRef.current = 8
    const newHp = p.hp - dmg
    setHpBoth(newHp)
    const dx = p.x - fromX, dy = p.y - fromY
    const dl = Math.hypot(dx, dy) || 1
    p.x += dx / dl * 10
    p.y += dy / dl * 10
    addParts(p.x, p.y, '#ff5252', 10, 3)
    addText(p.x, p.y - 22, `-${dmg}`, '#ff5252')
    if (newHp <= 0) {
      saveBest(elapsedRef.current)
      setPhaseBoth('over')
    }
  }, [addParts, addText, saveBest, setHpBoth, setPhaseBoth])

  const killEnemy = useCallback((e: Enemy) => {
    if (e.dead) return
    e.dead = true
    enemiesRef.current = enemiesRef.current.filter(x => x.id !== e.id)
    killsRef.current++
    setKills(killsRef.current)
    dropGems(e.x, e.y, e.xp)
    const boss = e.type === 'elite' || e.type === 'giant' || e.type === 'boss' || e.type === 'dino'
    addParts(e.x, e.y, e.color, boss ? (e.type === 'boss' ? 44 : 26) : 12, boss ? (e.type === 'boss' ? 7 : 5) : 3.5)
    addParts(e.x, e.y, '#ffffff', boss ? (e.type === 'boss' ? 22 : 14) : 6, boss ? (e.type === 'boss' ? 8 : 6.5) : 4.5)
    deathsRef.current.push({ x: e.x, y: e.y, emoji: e.emoji, size: e.r * 2.3, color: e.color, t: boss ? (e.type === 'boss' ? 0.8 : 0.6) : 0.42, maxT: boss ? (e.type === 'boss' ? 0.8 : 0.6) : 0.42, big: boss })
    if (boss) shakeRef.current = Math.max(shakeRef.current, e.type === 'boss' ? 6 : 3)
    addText(e.x, e.y - e.r - 6, `+${e.xp}`, '#ffd740')
  }, [addParts, addText, dropGems])

  const dmgEnemy = useCallback((e: Enemy, dmg: number, kbx: number, kby: number) => {
    if (e.burrow > 0) return
    e.hp -= dmg
    e.hitFlash = 0.12
    e.kbx += kbx
    e.kby += kby
    addText(e.x + (Math.random() - 0.5) * 14, e.y - e.r - 4, `${Math.round(dmg)}`, '#ffe082')
    if (e.hp <= 0) killEnemy(e)
  }, [addText, killEnemy])

  const fireWand = useCallback(() => {
    const p = playerRef.current
    const evo = !!weaponsRef.current.wandx
    const lv = evo ? 5 : (weaponsRef.current.wand || 0)
    const dmg = (evo ? 26 : 10 + 4 * lv) * (1 + 0.15 * (passivesRef.current.rage || 0))
    let target: Enemy | null = null
    let bestD = 520
    for (const e of enemiesRef.current) {
      if (e.burrow > 0) continue
      const d = Math.hypot(e.x - p.x, e.y - p.y)
      if (d < bestD) { bestD = d; target = e }
    }
    if (target) {
      const a = Math.atan2(target.y - p.y, target.x - p.x)
      shotsRef.current.push({ x: p.x, y: p.y, vx: Math.cos(a) * (evo ? 490 : 430), vy: Math.sin(a) * (evo ? 490 : 430), dmg, kind: 'wand', life: 1.6, pierce: evo ? 99 : lv >= 3 ? 1 : 0, evo })
      p.facing = a
      for (let j = 0; j < 4; j++) {
        const fa = Math.random() * Math.PI * 2
        trailsRef.current.push({ x: p.x, y: p.y, vx: Math.cos(fa) * 55, vy: Math.sin(fa) * 55, life: 0.16, maxLife: 0.16, color: evo ? '#ffd54f' : '#fff59d', size: evo ? 3 : 2.4 })
      }
    }
  }, [])

  const fireDagger = useCallback(() => {
    const p = playerRef.current
    const evo = !!weaponsRef.current.daggerx
    const lv = evo ? 5 : (weaponsRef.current.dagger || 0)
    const dmg = (evo ? 22 : 8 + 3 * lv) * (1 + 0.15 * (passivesRef.current.rage || 0))
    const n = evo ? 12 : 2 + lv
    for (let i = 0; i < n; i++) {
      const a = p.facing + (Math.random() - 0.5) * (evo ? 2 : 1.4)
      shotsRef.current.push({ x: p.x, y: p.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, dmg, kind: 'dagger', life: 1.2, pierce: evo ? 1 : 0, evo })
      for (let j = 0; j < 2; j++) {
        const fa = Math.random() * Math.PI * 2
        trailsRef.current.push({ x: p.x, y: p.y, vx: Math.cos(fa) * 70, vy: Math.sin(fa) * 70, life: 0.13, maxLife: 0.13, color: evo ? '#ffe082' : '#cfd8dc', size: 2.1 })
      }
    }
  }, [])

  const skelThrow = useCallback((e: Enemy) => {
    const p = playerRef.current
    const dx = p.x - e.x, dy = p.y - e.y
    const d = Math.hypot(dx, dy) || 1
    enemyShotsRef.current.push({
      x: e.x, y: e.y - e.r * 0.5,
      vx: dx / d * 175,
      vy: dy / d * 175 - 135,
      ttl: 3, r: 6, dmg: e.dmg, rot: Math.random() * Math.PI * 2,
    })
  }, [])

  const dropHoly = useCallback(() => {
    const p = playerRef.current
    const evo = !!weaponsRef.current.holyx
    const lv = evo ? 5 : (weaponsRef.current.holy || 0)
    aoeRef.current.push({ x: p.x, y: p.y, r: (62 + 10 * lv) * (evo ? 1.6 : 1), dmg: (evo ? 20 : 6 + 2 * lv) * (1 + 0.15 * (passivesRef.current.rage || 0)), ttl: evo ? 3.4 : 3, tickAcc: 0, pulse: 0, follow: evo })
  }, [])

  const zapOrb = useCallback(() => {
    const p = playerRef.current
    const evo = !!weaponsRef.current.orbx
    const lv = evo ? 5 : (weaponsRef.current.orb || 0)
    const dmg = (evo ? 42 : 12 + 5 * lv) * (1 + 0.15 * (passivesRef.current.rage || 0))
    const radius = evo ? 99999 : 150 + 25 * lv
    const hits: Enemy[] = []
    for (const e of enemiesRef.current) {
      if (Math.hypot(e.x - p.x, e.y - p.y) < radius + e.r) hits.push(e)
    }
    if (hits.length === 0) return
    const zaps: Zap[] = []
    for (const e of hits) {
      const start = evo ? { x: e.x, y: e.y - 90 } : { x: p.x, y: p.y }
      const pts: { x: number; y: number }[] = []
      if (evo) {
        for (let i = 1; i < 4; i++) {
          pts.push({ x: e.x + (Math.random() - 0.5) * 24, y: e.y - 90 * (1 - i / 4) + (Math.random() - 0.5) * 12 })
        }
      } else {
        const segs = 3
        for (let i = 1; i < segs; i++) {
          pts.push({
            x: p.x + (e.x - p.x) * (i / segs) + (Math.random() - 0.5) * 26,
            y: p.y + (e.y - p.y) * (i / segs) + (Math.random() - 0.5) * 26,
          })
        }
      }
      zaps.push({ start, pts, ttl: 0.14, maxTtl: 0.14 })
      dmgEnemy(e, dmg, 0, 0)
    }
    zapsRef.current.push(...zaps)
  }, [dmgEnemy])

  const bladeHits = useCallback(() => {
    const p = playerRef.current
    const evo = !!weaponsRef.current.bladex
    const lv = evo ? 5 : (weaponsRef.current.blade || 0)
    const dmg = (evo ? 28 : 9 + 2 * lv) * (1 + 0.15 * (passivesRef.current.rage || 0))
    const hitR = evo ? 24 : 12
    const blades = bladesRef.current
    for (const b of blades) {
      b.hitCd -= 1 / 60
      const bx = p.x + Math.cos(b.angle) * b.dist
      const by = p.y + Math.sin(b.angle) * b.dist
      for (const e of enemiesRef.current) {
        if (Math.hypot(e.x - bx, e.y - by) < e.r + hitR) {
          if (b.hitCd <= 0) {
            b.hitCd = evo ? 0.38 : 0.5
            const a = Math.atan2(e.y - p.y, e.x - p.x)
            dmgEnemy(e, dmg, Math.cos(a) * (evo ? 100 : 60), Math.sin(a) * (evo ? 100 : 60))
          }
          break
        }
      }
    }
  }, [dmgEnemy])

  const buildOptions = useCallback((): Option[] => {
    const evolves: Option[] = []
    const normal: Option[] = []
    for (const w of WEAPONS) {
      if (EVOLUTIONS.some(e => e.base === w.id && weaponsRef.current[e.id])) continue
      const lv = weaponsRef.current[w.id] || 0
      if (lv < MAX_LV) {
        normal.push({ kind: 'weapon', id: w.id, name: w.name, desc: w.desc, icon: w.icon, cur: lv, next: lv + 1 })
      } else {
        const evo = EVOLUTIONS.find(e => e.base === w.id)
        if (evo && passivesRef.current[evo.passive]) {
          evolves.push({ kind: 'evolve', id: evo.id, name: evo.name, desc: evo.desc, icon: evo.icon, cur: MAX_LV, next: MAX_LV })
        }
      }
    }
    for (const pd of PASSIVES) {
      const lv = passivesRef.current[pd.id] || 0
      if (lv < pd.maxLv) normal.push({ kind: 'passive', id: pd.id, name: pd.name, desc: pd.desc, icon: pd.icon, cur: lv, next: lv + 1 })
    }
    const result: Option[] = []
    if (evolves.length > 0) result.push(shuffle(evolves)[0])
    result.push(...shuffle(normal).slice(0, 3 - result.length))
    return result
  }, [])

  const gainXp = useCallback((v: number) => {
    const p = playerRef.current
    p.xp += v
    let leveled = false
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext
      p.level++
      p.xpNext = 8 + p.level * 6
      leveled = true
    }
    setXp(p.xp)
    setLevel(p.level)
    setXpNext(p.xpNext)
    if (leveled) {
      setOptions(buildOptions())
      selectedIndexRef.current = 0
      setSelectedIndex(0)
      setPhaseBoth('levelup')
    }
  }, [buildOptions, setPhaseBoth])

  const update = useCallback((dt: number) => {
    if (phaseRef.current !== 'playing') return
    const p = playerRef.current
    elapsedRef.current += dt
    setTime(Math.floor(elapsedRef.current))

    const waveN = Math.floor(elapsedRef.current / WAVE_SEC) + 1
    if (waveN !== lastWaveRef.current) {
      lastWaveRef.current = waveN
      waveRef.current = { n: waveN, t: 2.2 }
    }
    if (waveRef.current.t > 0) waveRef.current.t -= dt

    const k = keysRef.current
    let mx = 0, my = 0
    if (k.has('w') || k.has('arrowup')) my -= 1
    if (k.has('s') || k.has('arrowdown')) my += 1
    if (k.has('a') || k.has('arrowleft')) mx -= 1
    if (k.has('d') || k.has('arrowright')) mx += 1
    const moveL = Math.hypot(mx, my)
    if (moveL > 0) {
      const speed = p.speed * (1 + 0.15 * (passivesRef.current.boots || 0))
      p.x += mx / moveL * speed * dt
      p.y += my / moveL * speed * dt
      p.facing = Math.atan2(my, mx)
    }
    p.x = Math.max(PLAYER_R, Math.min(W - PLAYER_R, p.x))
    p.y = Math.max(PLAYER_R, Math.min(H - PLAYER_R, p.y))

    if (p.invuln > 0) p.invuln -= dt
    if (p.hitFlash > 0) p.hitFlash -= dt
    if (flashRedRef.current > 0) flashRedRef.current -= dt
    if (shakeRef.current > 0) shakeRef.current *= Math.pow(0.02, dt)

    const regen = passivesRef.current.regen || 0
    if (regen > 0 && p.hp < p.maxHp) {
      p.regenAcc += dt * regen
      if (p.regenAcc >= 1) {
        const n = Math.floor(p.regenAcc)
        p.regenAcc -= n
        setHpBoth(Math.min(p.maxHp, p.hp + n))
      }
    }

    const finalPhase = !endlessRef.current && elapsedRef.current >= DURATION - 30 && elapsedRef.current < DURATION
    const noSpawn = !endlessRef.current && elapsedRef.current >= DURATION - 5
    if (finalPhase && finalBannerRef.current <= 0) finalBannerRef.current = 2.2
    if (finalBannerRef.current > 0) finalBannerRef.current -= dt
    if (finalPhase && !noSpawn) {
      finalBossAccRef.current += dt
      if (finalBossAccRef.current >= 8) {
        finalBossAccRef.current = 0
        spawnEnemy(bossCountRef.current % 2 === 0 ? 'boss' : 'dino')
        bossBannerRef.current = 2
        shakeRef.current = Math.max(shakeRef.current, 5)
      }
    }
    spawnAccRef.current += dt
    const baseInterval = Math.max(0.28, 1.15 - waveRef.current.n * 0.075)
    const interval = finalPhase ? baseInterval * 0.5 : baseInterval
    if (spawnAccRef.current >= interval && !noSpawn) {
      spawnAccRef.current = 0
      const r = Math.random()
      let type = 'bat'
      const wv = waveRef.current.n
      if (wv <= 2) type = 'bat'
      else if (wv <= 4) type = r < 0.55 ? 'bat' : 'zombie'
      else if (wv <= 6) type = r < 0.3 ? 'bat' : r < 0.6 ? 'zombie' : r < 0.85 ? 'wolf' : 'ghost'
      else if (wv <= 9) type = r < 0.25 ? 'bat' : r < 0.5 ? 'zombie' : r < 0.65 ? 'skel' : r < 0.8 ? 'wolf' : r < 0.93 ? 'snake' : 'ghost'
      else type = r < 0.18 ? 'bat' : r < 0.35 ? 'zombie' : r < 0.5 ? 'skel' : r < 0.62 ? 'wolf' : r < 0.74 ? 'snake' : r < 0.84 ? 'ghost' : r < 0.9 ? 'spider' : r < 0.97 ? 'golem' : 'elite'
      spawnEnemy(type)
      if (wv >= 5 && Math.random() < 0.3) {
        const extra = Math.random()
        spawnEnemy(extra < 0.4 ? 'zombie' : extra < 0.7 ? 'wolf' : extra < 0.9 ? 'snake' : 'skel')
      }
    }
    eliteAccRef.current += dt
    if (eliteAccRef.current >= 40 && !noSpawn) {
      eliteAccRef.current = 0
      spawnEnemy('elite')
    }
    // 巨兽：wave 6 起每 60 秒一只，作为后期硬怪
    if (waveRef.current.n >= 6 && !noSpawn) {
      giantAccRef.current += dt
      if (giantAccRef.current >= 60) {
        giantAccRef.current = 0
        spawnEnemy('giant')
      }
    }
    bossAccRef.current += dt
    if (bossAccRef.current >= 90 && !noSpawn) {
      bossAccRef.current = 0
      spawnEnemy(bossCountRef.current % 2 === 0 ? 'boss' : 'dino')
      bossBannerRef.current = 2.2
      shakeRef.current = Math.max(shakeRef.current, 6)
    }
    if (bossBannerRef.current > 0) bossBannerRef.current -= dt
    if (endlessBannerRef.current > 0) endlessBannerRef.current -= dt

    const timers = p.weaponTimers
    const wandEvo = !!weaponsRef.current.wandx
    if (weaponsRef.current.wand || wandEvo) {
      timers.wand = (timers.wand || 0) - dt
      if (timers.wand <= 0) {
        timers.wand = wandEvo ? 0.32 : Math.max(0.35, 0.9 - 0.12 * (weaponsRef.current.wand || 0))
        fireWand()
      }
    }
    const daggerEvo = !!weaponsRef.current.daggerx
    if (weaponsRef.current.dagger || daggerEvo) {
      timers.dagger = (timers.dagger || 0) - dt
      if (timers.dagger <= 0) {
        timers.dagger = daggerEvo ? 0.45 : Math.max(0.5, 1.4 - 0.15 * (weaponsRef.current.dagger || 0))
        fireDagger()
      }
    }
    const holyEvo = !!weaponsRef.current.holyx
    if (weaponsRef.current.holy || holyEvo) {
      timers.holy = (timers.holy || 0) - dt
      if (timers.holy <= 0) {
        timers.holy = holyEvo ? 0.8 : Math.max(0.7, 1.8 - 0.13 * (weaponsRef.current.holy || 0))
        dropHoly()
      }
    }
    const orbEvo = !!weaponsRef.current.orbx
    if (weaponsRef.current.orb || orbEvo) {
      timers.orb = (timers.orb || 0) - dt
      if (timers.orb <= 0) {
        timers.orb = orbEvo ? 0.85 : Math.max(0.7, 1.9 - 0.16 * (weaponsRef.current.orb || 0))
        zapOrb()
      }
    }
    const bladeEvo = !!weaponsRef.current.bladex
    if (weaponsRef.current.blade || bladeEvo) {
      if (bladesRef.current.length === 0) {
        const count = bladeEvo ? 8 : Math.min(6, 2 + (weaponsRef.current.blade || 0))
        const dist = bladeEvo ? 92 : 52 + 6 * (weaponsRef.current.blade || 0)
        for (let i = 0; i < count; i++) {
          bladesRef.current.push({ angle: i / count * Math.PI * 2, dist, hitCd: 0 })
        }
      }
      for (const b of bladesRef.current) b.angle += (bladeEvo ? 3.9 : 3.4) * dt
      bladeHits()
    }

    const enemies = enemiesRef.current
    for (const e of enemies) {
      const dx = p.x - e.x, dy = p.y - e.y
      const d = Math.hypot(dx, dy) || 1
      const sway = Math.sin(elapsedRef.current * 3 + e.phase) * 0.4
      const sp = e.type === 'boss' && e.charge > 0 ? 235 + 5 * Math.min(7, e.glv) : e.speed
      e.x += (dx / d + sway * -dy / d) * sp * dt
      e.y += (dy / d + sway * dx / d) * sp * dt
      if (e.type === 'boss' && e.charge > 0) {
        e.charge -= dt
        if (trailsRef.current.length < 320) {
          trailsRef.current.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.28, maxLife: 0.28, color: '#ff5252', size: 4.5 })
        }
      }
      e.kbx *= Math.pow(0.001, dt)
      e.kby *= Math.pow(0.001, dt)
      e.x += e.kbx * dt
      e.y += e.kby * dt
      if (e.hitFlash > 0) e.hitFlash -= dt
      if (e.type === 'skel') {
        e.atkCd -= dt
        if (e.atkCd <= 0 && d < 280) {
          e.atkCd = 2.4 + Math.random() * 0.8
          skelThrow(e)
        }
      }
      if (e.type === 'boss') {
        e.atkCd -= dt
        if (e.charge <= 0 && e.atkCd <= 0 && d < 250) {
          e.charge = 0.6
          e.atkCd = Math.max(2, 3 + Math.random() * 1.2 - 0.25 * Math.min(7, e.glv))
        }
      }
      if (e.type === 'dino') {
        if (e.burrow > 0) {
          e.burrow -= dt
          if (e.burrow > 0.7) {
            const bx = p.x - e.x, by = p.y - e.y
            const bd = Math.hypot(bx, by) || 1
            e.x += bx / bd * 280 * dt
            e.y += by / bd * 280 * dt
            if (trailsRef.current.length < 320) {
              trailsRef.current.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.22, maxLife: 0.22, color: '#8d6e63', size: 3.5 })
            }
          }
          if (e.burrow <= 0) {
            e.atkCd = 4 + Math.random() * 1.5
            addParts(e.x, e.y, '#8d6e63', 18, 6)
            addParts(e.x, e.y, '#ffffff', 6, 5)
            shakeRef.current = Math.max(shakeRef.current, 5)
            if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + 36) hurtPlayer(e.dmg, e.x, e.y)
          }
        } else if (e.wind > 0) {
          e.wind -= dt
          if (e.wind <= 0) {
            e.burrow = 2.4
          }
        } else {
          e.atkCd -= dt
          if (e.atkCd <= 0) {
            e.wind = 0.7
          }
        }
      }
      if (!(e.type === 'dino' && e.burrow > 0) && d < e.r + PLAYER_R) {
        hurtPlayer(e.dmg, e.x, e.y)
        e.x -= dx / d * 8
        e.y -= dy / d * 8
      }
    }

    const eShots = enemyShotsRef.current
    for (let i = eShots.length - 1; i >= 0; i--) {
      const es = eShots[i]
      es.vy += 320 * dt
      es.x += es.vx * dt
      es.y += es.vy * dt
      es.ttl -= dt
      es.rot += 6 * dt
      if (Math.hypot(p.x - es.x, p.y - es.y) < PLAYER_R + es.r) {
        hurtPlayer(es.dmg, es.x, es.y)
        eShots.splice(i, 1)
        continue
      }
      if (es.ttl <= 0 || es.x < -30 || es.x > W + 30 || es.y < -30 || es.y > H + 30) eShots.splice(i, 1)
    }

    const shots = shotsRef.current
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]
      if (s.evo && s.kind === 'wand') {
        let tgt: Enemy | null = null
        let bd = 1e9
        for (const e of enemies) {
          if (e.burrow > 0) continue
          const d = Math.hypot(e.x - s.x, e.y - s.y)
          if (d < bd) { bd = d; tgt = e }
        }
        if (tgt) {
          const a = Math.atan2(tgt.y - s.y, tgt.x - s.x)
          const sp = Math.hypot(s.vx, s.vy)
          s.vx = Math.cos(a) * sp
          s.vy = Math.sin(a) * sp
        }
      }
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.life -= dt
      if (trailsRef.current.length < 320) {
        trailsRef.current.push({
          x: s.x, y: s.y, vx: 0, vy: 0,
          life: s.evo ? 0.32 : 0.22, maxLife: s.evo ? 0.32 : 0.22,
          color: s.kind === 'wand' ? (s.evo ? '#ffd54f' : '#fff59d') : (s.evo ? '#ffe082' : '#cfd8dc'),
          size: s.evo ? 3.6 : (s.kind === 'wand' ? 2.6 : 2.2),
        })
      }
      let dead = s.life <= 0 || s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20
      if (!dead) {
        for (const e of enemies) {
          if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + 5) {
            if (trailsRef.current.length < 320) {
              for (let j = 0; j < 3; j++) {
                const fa = Math.random() * Math.PI * 2
                trailsRef.current.push({ x: s.x, y: s.y, vx: Math.cos(fa) * 75, vy: Math.sin(fa) * 75, life: 0.15, maxLife: 0.15, color: '#fff176', size: 1.8 })
              }
            }
            dmgEnemy(e, s.dmg, Math.cos(Math.atan2(s.vy, s.vx)) * 40, Math.sin(Math.atan2(s.vy, s.vx)) * 40)
            if (s.pierce > 0 && s.pierce < 99) {
              s.pierce--
              s.dmg *= 0.85
            } else if (s.pierce === 0) {
              dead = true
            }
            break
          }
        }
      }
      if (dead) shots.splice(i, 1)
    }

    const aoeList = aoeRef.current
    for (let i = aoeList.length - 1; i >= 0; i--) {
      const a = aoeList[i]
      if (a.follow) { a.x = p.x; a.y = p.y }
      a.ttl -= dt
      a.tickAcc += dt
      a.pulse += dt
      if (a.tickAcc >= 0.4) {
        a.tickAcc = 0
        a.pulse = 0
        for (const e of enemies) {
          if (Math.hypot(e.x - a.x, e.y - a.y) < a.r + e.r) dmgEnemy(e, a.dmg, 0, 0)
        }
      }
      if (a.ttl <= 0) aoeList.splice(i, 1)
    }

    const zaps = zapsRef.current
    for (let i = zaps.length - 1; i >= 0; i--) {
      zaps[i].ttl -= dt
      if (zaps[i].ttl <= 0) zaps.splice(i, 1)
    }

    const gems = gemsRef.current
    const magnetR = 45 + 30 * (passivesRef.current.magnet || 0)
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i]
      g.t += dt * 3
      const d = Math.hypot(p.x - g.x, p.y - g.y)
      if (d < magnetR) {
        const sp = 340 * dt
        g.x += (p.x - g.x) / d * sp
        g.y += (p.y - g.y) / d * sp
      }
      if (d < 16) {
        gems.splice(i, 1)
        gainXp(g.v)
      }
    }

    const parts = partsRef.current
    for (let i = parts.length - 1; i >= 0; i--) {
      const pt = parts[i]
      pt.x += pt.vx * dt * 60
      pt.y += pt.vy * dt * 60
      pt.vy += 0.2 * dt * 60
      if (--pt.life <= 0) parts.splice(i, 1)
    }

    const trails = trailsRef.current
    for (let i = trails.length - 1; i >= 0; i--) {
      const tr = trails[i]
      tr.x += tr.vx * dt
      tr.y += tr.vy * dt
      tr.life -= dt
      if (tr.life <= 0) trails.splice(i, 1)
    }

    const deaths = deathsRef.current
    for (let i = deaths.length - 1; i >= 0; i--) {
      deaths[i].t -= dt
      if (deaths[i].t <= 0) deaths.splice(i, 1)
    }

    const texts = textsRef.current
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]
      t.t -= dt
      t.y -= 40 * dt
      if (t.t <= 0) texts.splice(i, 1)
    }

    if (!endlessRef.current && elapsedRef.current >= DURATION) {
      saveBest(elapsedRef.current)
      setPhaseBoth('win')
    }
  }, [bladeHits, dmgEnemy, dropHoly, fireDagger, fireWand, gainXp, hurtPlayer, saveBest, setHpBoth, setPhaseBoth, skelThrow, spawnEnemy, zapOrb])

  const render = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const p = playerRef.current

    ctx.save()
    if (shakeRef.current > 0) {
      ctx.translate((Math.random() - 0.5) * shakeRef.current, (Math.random() - 0.5) * shakeRef.current)
    }

    const theme = themeRef.current!
    ctx.fillStyle = theme.grassBase
    ctx.fillRect(-12, -12, W + 24, H + 24)
    ctx.fillStyle = theme.grassDark
    const cell = 48
    for (let gy = 0; gy * cell < H; gy++) {
      for (let gx = 0; gx * cell < W; gx++) {
        if ((gx + gy) % 2 === 0) ctx.fillRect(gx * cell, gy * cell, cell, cell)
      }
    }
    ctx.strokeStyle = theme.grassBlade
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const g of grassRef.current!) {
      const sway = Math.sin(elapsedRef.current * 1.5 + g.ph) * 0.05
      const a = g.lean + sway
      ctx.moveTo(g.x, g.y)
      ctx.quadraticCurveTo(g.x + Math.sin(a) * g.len * 0.45, g.y - g.len * 0.6, g.x + Math.sin(a) * g.len, g.y - g.len)
    }
    ctx.stroke()

    for (const d of decorationsRef.current!) {
      ctx.globalAlpha = d.alpha
      ctx.font = `${d.size}px ${EMOJI_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(d.emoji, d.x, d.y)
    }
    ctx.globalAlpha = 1

    for (const a of aoeRef.current) {
      ctx.fillStyle = a.follow ? 'rgba(183,28,28,0.32)' : 'rgba(103,58,183,0.28)'
      ctx.beginPath()
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = a.follow ? 'rgba(255,82,82,0.55)' : 'rgba(186,104,200,0.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(a.x, a.y, a.r * (0.8 + 0.2 * a.pulse / 0.4), 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.font = `${14}px ${EMOJI_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(elapsedRef.current * 4)
      ctx.fillText(a.follow ? '☠' : '✝', a.x, a.y)
      ctx.globalAlpha = 1
    }

    for (const g of gemsRef.current) {
      const bob = Math.sin(g.t) * 3
      ctx.save()
      ctx.translate(g.x, g.y + bob)
      ctx.rotate(Math.PI / 4)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(-5, -5, 10, 10)
      ctx.fillStyle = '#ffd740'
      ctx.fillRect(-4.5, -4.5, 9, 9)
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.fillRect(-2.5, -2.5, 3.5, 3.5)
      ctx.restore()
    }

    const bladeEvo = !!weaponsRef.current.bladex
    for (const b of bladesRef.current) {
      const bx = p.x + Math.cos(b.angle) * b.dist
      const by = p.y + Math.sin(b.angle) * b.dist
      const scale = bladeEvo ? 1.8 : 1
      ctx.save()
      ctx.translate(bx, by)
      ctx.rotate(b.angle + Math.PI / 4)
      ctx.scale(scale, scale)
      ctx.fillStyle = 'rgba(0,0,0,0.4)'
      ctx.beginPath()
      ctx.ellipse(1, 1, 14, 4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = bladeEvo ? '#ffd54f' : '#e0e0e0'
      ctx.beginPath()
      ctx.ellipse(0, 0, 14, 4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(2, 0, 8, 2.2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    for (const e of enemiesRef.current) {
      if (e.type === 'dino' && e.burrow > 0) {
        ctx.font = `${e.r * 1.9}px ${EMOJI_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🕳️', e.x, e.y)
        if (e.burrow <= 0.7) {
          ctx.fillStyle = '#ff9800'
          ctx.font = 'bold 14px "Segoe UI", sans-serif'
          ctx.fillText('!', e.x, e.y - e.r * 0.9)
        }
        continue
      }
      ctx.save()
      const jx = e.type === 'dino' && e.wind > 0 ? (Math.random() - 0.5) * 6 : 0
      const jy = e.type === 'dino' && e.wind > 0 ? (Math.random() - 0.5) * 6 : 0
      ctx.translate(jx, jy)
      ctx.globalAlpha = e.hitFlash > 0 ? 0.45 : (e.type === 'dino' && e.wind > 0 ? 0.5 + 0.5 * Math.sin(elapsedRef.current * 22) : 1)
      ctx.font = `${e.r * 2.3}px ${EMOJI_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(e.emoji, e.x, e.y)
      ctx.restore()
      if (e.type === 'dino' && e.wind > 0) {
        ctx.fillStyle = '#ffb74d'
        ctx.font = 'bold 14px "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('⚠ 钻地!', e.x, e.y - e.r - 16)
      }
      if (e.hp < e.maxHp) {
        const bw = e.r * 2
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(e.x - bw / 2, e.y - e.r - 9, bw, 3.5)
        const boss = e.type === 'elite' || e.type === 'giant'
        ctx.fillStyle = boss ? '#ef5350' : '#4caf50'
        ctx.fillRect(e.x - bw / 2, e.y - e.r - 9, bw * Math.max(0, e.hp / e.maxHp), 3.5)
      }
    }

    const bossE = enemiesRef.current.find(en => en.type === 'boss' || en.type === 'dino')
    if (bossE) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(W / 2 - 120, H - 34, 240, 10)
      ctx.fillStyle = '#d32f2f'
      ctx.fillRect(W / 2 - 120, H - 34, 240 * Math.max(0, bossE.hp / bossE.maxHp), 10)
      ctx.fillStyle = '#ffcdd2'
      ctx.font = 'bold 10px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${bossE.emoji} ${ENEMY_TYPES[bossE.type].name} Lv.${bossE.glv + 1}`, W / 2, H - 46)
    }

    ctx.font = 'bold 13px "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 3
    const killText = `💀 击杀 ${killsRef.current}`
    ctx.strokeText(killText, W / 2, 15)
    ctx.fillStyle = '#ffd740'
    ctx.fillText(killText, W / 2, 15)

    for (const d of deathsRef.current) {
      const k = 1 - d.t / d.maxT
      ctx.strokeStyle = hexToRgba(d.color, (1 - k) * 0.85)
      ctx.lineWidth = 2 + 2.5 * (1 - k)
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.size * (0.35 + k * (d.big ? 2.4 : 1.6)), 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = (1 - k) * 0.9
      ctx.font = `${d.size * (1 + k * 0.9)}px ${EMOJI_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(d.emoji, d.x, d.y)
    }
    ctx.globalAlpha = 1

    const invulnBlink = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0
    if (!invulnBlink) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.beginPath()
      ctx.ellipse(p.x + 2, p.y + 3, PLAYER_R + 1, PLAYER_R * 0.8, 0, 0, Math.PI * 2)
      ctx.fill()
      const ki = mageImgRef.current
      if (ki && ki.complete) {
        const ks = PLAYER_R * 2.6
        ctx.drawImage(ki, p.x - ks / 2, p.y - ks / 2, ks, ks)
      } else {
        ctx.font = `${PLAYER_R * 2.4}px ${EMOJI_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🧛', p.x, p.y)
      }
    }

    for (const s of shotsRef.current) {
      if (s.evo) {
        ctx.fillStyle = 'rgba(255,213,79,0.25)'
        ctx.beginPath()
        ctx.arc(s.x, s.y, 11, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = s.evo ? '#ffd54f' : (s.kind === 'wand' ? '#ffffff' : '#b0bec5')
      ctx.strokeStyle = s.evo ? '#fff8e1' : (s.kind === 'wand' ? '#fff59d' : '#78909c')
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.evo ? 6 : (s.kind === 'wand' ? 4 : 5), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.beginPath()
      ctx.arc(s.x - s.vx * 0.012, s.y - s.vy * 0.012, 2, 0, Math.PI * 2)
      ctx.fill()
    }

    for (const es of enemyShotsRef.current) {
      ctx.save()
      ctx.translate(es.x, es.y)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.beginPath()
      ctx.arc(0, 1.5, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.rotate(es.rot)
      ctx.font = '22px ' + EMOJI_FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('🦴', 0, 0)
      ctx.restore()
    }

    for (const z of zapsRef.current) {
      const a = z.ttl / z.maxTtl
      ctx.strokeStyle = `rgba(255,235,59,${a})`
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(z.start.x, z.start.y)
      for (const pt of z.pts) ctx.lineTo(pt.x, pt.y)
      ctx.stroke()
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`
      ctx.lineWidth = 1.2
      ctx.stroke()
    }

    for (const tr of trailsRef.current) {
      const k = tr.life / tr.maxLife
      ctx.globalAlpha = Math.max(0, k) * 0.8
      ctx.fillStyle = tr.color
      ctx.beginPath()
      ctx.arc(tr.x, tr.y, tr.size * (0.5 + 0.5 * k), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    for (const pt of partsRef.current) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife)
      ctx.fillStyle = pt.color
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, pt.size * Math.max(0.3, pt.life / pt.maxLife), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    for (const t of textsRef.current) {
      const a = Math.max(0, Math.min(1, t.t / 0.3))
      ctx.globalAlpha = a
      ctx.font = `bold 13px "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 3
      ctx.strokeText(t.text, t.x, t.y)
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.globalAlpha = 1

    if (waveRef.current.t > 0 && elapsedRef.current > 1) {
      const a = Math.min(1, waveRef.current.t / 0.8)
      ctx.globalAlpha = a
      ctx.font = `bold 44px "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'
      ctx.lineWidth = 6
      ctx.strokeText(`WAVE ${waveRef.current.n}`, W / 2, H * 0.32)
      ctx.fillStyle = '#ff8a65'
      ctx.fillText(`WAVE ${waveRef.current.n}`, W / 2, H * 0.32)
      ctx.globalAlpha = 1
    }

    if (bossBannerRef.current > 0) {
      const bE = enemiesRef.current.find(en => en.type === 'boss' || en.type === 'dino')
      if (bE) {
        const bName = `⚠ ${ENEMY_TYPES[bE.type].name} Lv.${bE.glv + 1} 来袭 ⚠`
        const a = Math.min(1, bossBannerRef.current / 0.8)
        ctx.globalAlpha = a
        ctx.font = `bold 30px "Segoe UI", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'
        ctx.lineWidth = 5
        ctx.strokeText(bName, W / 2, H * 0.42)
        ctx.fillStyle = '#ff5252'
        ctx.fillText(bName, W / 2, H * 0.42)
        ctx.globalAlpha = 1
      }
    }

    if (endlessBannerRef.current > 0) {
      const a = Math.min(1, endlessBannerRef.current / 0.8)
      ctx.globalAlpha = a
      ctx.font = `bold 34px "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'
      ctx.lineWidth = 5
      ctx.strokeText('∞ 无尽模式 ∞', W / 2, H * 0.3)
      ctx.fillStyle = '#ffd54f'
      ctx.fillText('∞ 无尽模式 ∞', W / 2, H * 0.3)
      ctx.globalAlpha = 1
    }

    if (finalBannerRef.current > 0) {
      const a = Math.min(1, finalBannerRef.current / 0.8)
      ctx.globalAlpha = a
      ctx.font = `bold 34px "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'
      ctx.lineWidth = 5
      ctx.strokeText('⚠ 最终决战 ⚠', W / 2, H * 0.22)
      ctx.fillStyle = '#ff7043'
      ctx.fillText('⚠ 最终决战 ⚠', W / 2, H * 0.22)
      ctx.globalAlpha = 1
    }

    const hpRatio = p.hp / p.maxHp
    if (hpRatio < 0.35 && phaseRef.current === 'playing') {
      const pulse = 0.22 + Math.abs(Math.sin(elapsedRef.current * 5)) * 0.2
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.72)
      vg.addColorStop(0, 'rgba(200,0,0,0)')
      vg.addColorStop(1, `rgba(200,0,0,${pulse * (1 - hpRatio / 0.35)})`)
      ctx.fillStyle = vg
      ctx.fillRect(-12, -12, W + 24, H + 24)
    }

    if (flashRedRef.current > 0) {
      ctx.fillStyle = `rgba(255,40,40,${flashRedRef.current * 0.45})`
      ctx.fillRect(-12, -12, W + 24, H + 24)
    }

    ctx.restore()
  }, [])

  const lastTimeRef = useRef(performance.now())
  const loop = useCallback((now: number) => {
    const last = lastTimeRef.current
    const dt = Math.min(0.05, (now - last) / 1000)
    lastTimeRef.current = now
    const el = containerRef.current
    if (el && el.offsetParent) {
      update(dt)
      render()
    }
    animRef.current = requestAnimationFrame(loop)
  }, [render, update])

  useEffect(() => {
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [loop])

  const applyOption = useCallback((opt: Option) => {
    if (opt.kind === 'evolve') {
      const evo = EVOLUTIONS.find(e => e.id === opt.id)
      if (evo) {
        delete weaponsRef.current[evo.base]
        weaponsRef.current[evo.id] = 1
        if (evo.id === 'bladex') bladesRef.current = []
        playerRef.current.weaponTimers = {}
      }
      setPhaseBoth('playing')
      return
    }
    if (opt.kind === 'weapon') {
      weaponsRef.current[opt.id] = opt.next
      if (opt.id === 'blade') bladesRef.current = []
      if (opt.id === 'wand') playerRef.current.weaponTimers.wand = 0
      if (opt.id === 'dagger') playerRef.current.weaponTimers.dagger = 0
      if (opt.id === 'holy') playerRef.current.weaponTimers.holy = 0
      if (opt.id === 'orb') playerRef.current.weaponTimers.orb = 0
    } else {
      passivesRef.current[opt.id] = opt.next
      if (opt.id === 'armor') {
        const p = playerRef.current
        p.maxHp += 20
        setHpBoth(Math.min(p.maxHp, p.hp + 20))
      }
    }
    setPhaseBoth('playing')
  }, [setHpBoth, setPhaseBoth])

  const startEndless = useCallback(() => {
    endlessRef.current = true
    endlessBannerRef.current = 2.4
    setPhaseBoth('playing')
  }, [setPhaseBoth])

  const reset = useCallback(() => {
    const p = playerRef.current
    p.x = W / 2
    p.y = H / 2
    p.hp = 100
    p.maxHp = 100
    p.speed = 150
    p.level = 1
    p.xp = 0
    p.xpNext = 14
    p.invuln = 0
    p.weaponTimers = {}
    p.regenAcc = 0
    enemiesRef.current = []
    shotsRef.current = []
    enemyShotsRef.current = []
    aoeRef.current = []
    zapsRef.current = []
    gemsRef.current = []
    bladesRef.current = []
    partsRef.current = []
    trailsRef.current = []
    deathsRef.current = []
    textsRef.current = []
    weaponsRef.current = { wand: 1 }
    passivesRef.current = {}
    waveRef.current = { n: 1, t: 2.2 }
    elapsedRef.current = 0
    spawnAccRef.current = 0
    eliteAccRef.current = 35
    giantAccRef.current = 0
    killsRef.current = 0
    shakeRef.current = 0
    flashRedRef.current = 0
    lastWaveRef.current = 0
    bossAccRef.current = 70
    bossCountRef.current = 0
    bossBannerRef.current = 0
    endlessBannerRef.current = 0
    endlessRef.current = false
    finalBossAccRef.current = 0
    finalBannerRef.current = 0
    keysRef.current.clear()
    setHpBoth(100)
    setLevel(1)
    setXp(0)
    setXpNext(14)
    setKills(0)
    setTime(0)
    setPhaseBoth('playing')
  }, [setHpBoth, setPhaseBoth])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = containerRef.current
      if (!el || !el.offsetParent) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (phaseRef.current === 'playing') setPhaseBoth('paused')
        else if (phaseRef.current === 'paused') setPhaseBoth('playing')
        return
      }
      if (phaseRef.current === 'levelup') {
        if (k === 'arrowup' || k === 'arrowdown') {
          e.preventDefault()
          e.stopImmediatePropagation()
          const n = optionsRef.current.length
          if (n === 0) return
          selectedIndexRef.current = (selectedIndexRef.current + (k === 'arrowdown' ? 1 : n - 1)) % n
          setSelectedIndex(selectedIndexRef.current)
        } else if (k === ' ') {
          e.preventDefault()
          e.stopImmediatePropagation()
          const opt = optionsRef.current[selectedIndexRef.current]
          if (opt) applyOption(opt)
        }
        return
      }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        keysRef.current.add(k)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const el = containerRef.current
      if (!el || !el.offsetParent) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        keysRef.current.delete(k)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [setPhaseBoth, applyOption])

  const unlockedWeapons = [
    ...WEAPONS.filter(w => weaponsRef.current[w.id]).map(w => ({ id: w.id, name: w.name, icon: w.icon, lv: weaponsRef.current[w.id]! })),
    ...EVOLUTIONS.filter(e => weaponsRef.current[e.id]).map(e => ({ id: e.id, name: e.name, icon: e.icon, lv: -1 })),
  ]
  const evoReady = EVOLUTIONS.filter(ev => !weaponsRef.current[ev.id] && weaponsRef.current[ev.base] === MAX_LV && passivesRef.current[ev.passive] > 0)
  const fmtOptDesc = (opt: Option) => {
    if (opt.kind === 'evolve') return `合成武器：${opt.desc}`
    if (opt.kind === 'weapon' && opt.cur === 0) return `解锁 ${opt.desc}`
    return `${opt.desc}（Lv.${opt.cur} → ${opt.next}）`
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none">
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors" title="Back to menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <img src={MAGE_SVG_URL} alt="" className="w-5 h-5" />
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">Vampire Survivors</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Level</div>
            <div className="text-ide-accent font-bold tabular-nums">{level}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Time</div>
            <div className="text-ide-text font-bold tabular-nums">{fmtTime(time)}</div>
          </div>
        </div>
      </div>

      <div className="relative flex-1 flex items-center justify-center p-2 bg-ide-bg/40 overflow-hidden min-h-0">
        <div className="relative shrink-0 max-w-full max-h-full" style={{ aspectRatio: `${W} / ${H}` }}>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="block w-full h-full"
            style={{ borderRadius: 8, outline: '1px solid rgba(255,255,255,0.06)' }}
          />
          <div className="absolute inset-x-2 top-2 flex items-center gap-2 pointer-events-none z-10">
            <div className="bg-black/45 rounded-lg px-2.5 py-1.5 backdrop-blur-[2px] w-36">
              <div className="flex items-center gap-2">
                <span className="text-xs leading-none">❤️</span>
                <div className="flex-1 h-2 bg-black/60 rounded-full overflow-hidden border border-white/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-150"
                    style={{ width: `${Math.max(0, Math.min(100, hp / (playerRef.current.maxHp || 100)) * 100)}%`, background: hp > 30 ? 'linear-gradient(90deg,#e53935,#ff8a65)' : 'linear-gradient(90deg,#b71c1c,#ff1744)' }}
                  />
                </div>
                <span className="text-[9px] text-ide-text-muted tabular-nums shrink-0">{Math.max(0, Math.ceil(hp))}/{playerRef.current.maxHp}</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs leading-none">💰</span>
                <div className="flex-1 h-1.5 bg-black/60 rounded-full overflow-hidden border border-white/10">
                  <div className="h-full bg-gradient-to-r from-amber-400 to-yellow-300 transition-[width] duration-200" style={{ width: `${Math.min(100, xp / xpNext * 100)}%` }} />
                </div>
                <span className="text-[9px] text-ide-text-muted tabular-nums shrink-0">{Math.round(xp)}/{xpNext}</span>
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-start gap-2 bg-black/35 rounded-lg px-2 py-1.5 backdrop-blur-[2px]">
              {unlockedWeapons.map(w => {
                const ready = w.lv === MAX_LV && evoReady.some(e => e.base === w.id)
                const evo = EVOLUTIONS.find(e => e.base === w.id)
                const passive = evo ? PASSIVES.find(p => p.id === evo.passive) : null
                const hasPassive = evo ? !!passivesRef.current[evo.passive] : null
                const sub = w.lv === -1 ? EVOLUTIONS.find(e => e.id === w.id)?.icon : passive?.icon
                const subTip = w.lv === -1 ? '已合成' : passive ? `${passive.name}${hasPassive ? '（已持有）' : '（未持有）'}` : ''
                return (
                  <div key={w.id} className="flex flex-col items-center gap-1 min-w-0">
                    <span className={`text-sm leading-none ${ready ? 'animate-pulse' : ''}`} title={`${w.name}${w.lv === -1 ? '（已合成）' : ` Lv.${w.lv}`}${ready ? ' · 可合成！' : ''}`}>
                      {w.icon}
                      <sup className={`text-[9px] ml-0.5 ${ready ? 'text-ide-accent' : 'text-ide-warning'}`}>{w.lv === -1 ? '✦' : w.lv}</sup>
                    </span>
                    <span className={`text-xs leading-none ${w.lv === -1 ? '' : hasPassive ? '' : 'opacity-30 grayscale'}`} title={subTip}>
                      {sub}
                    </span>
                  </div>
                )
              })}
              {unlockedWeapons.length === 0 && <span className="text-[10px] text-ide-text-muted">无武器</span>}
            </div>
          </div>

          {phase === 'paused' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-ide-bg/70 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 bg-ide-sidebar border border-ide-border rounded-xl px-8 py-6 shadow-2xl">
                <div className="text-sm font-bold text-ide-text">已暂停</div>
                <button onClick={() => setPhaseBoth('playing')} className="px-5 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors">继续</button>
                <button onClick={reset} className="px-5 py-1.5 text-xs bg-ide-hover hover:bg-ide-hover/70 text-ide-text rounded-lg transition-colors">重新开始</button>
                <button onClick={() => onBackRef.current?.()} className="px-5 py-1.5 text-xs bg-ide-hover hover:bg-ide-hover/70 text-ide-text-muted rounded-lg transition-colors">返回菜单</button>
              </div>
            </div>
          )}

          {phase === 'levelup' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-ide-bg/60 backdrop-blur-sm">
              <div className="text-sm font-bold text-ide-warning">升级！选择一个强化</div>
              <div className="flex flex-col gap-2 px-3 w-full max-w-[240px]">
                {options.map((opt, i) => (
                  <button
                    key={opt.id}
                    onClick={() => applyOption(opt)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg bg-ide-sidebar border transition-colors text-left pointer-events-auto ${i === selectedIndex ? 'border-ide-accent bg-ide-accent/15 ring-2 ring-ide-accent/40 shadow-[0_0_16px_rgba(255,179,0,0.2)]' : 'border-ide-border hover:border-ide-accent/60 hover:bg-ide-hover'}`}
                  >
                    {i === selectedIndex && <span className="text-base text-ide-accent shrink-0 font-bold">{'>'}</span>}
                    <span className="text-2xl leading-none shrink-0">{opt.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ide-text">{opt.name}</div>
                      <div className="text-[10px] text-ide-text-muted truncate">{fmtOptDesc(opt)}</div>
                    </div>
                    {i === selectedIndex && <span className="text-base text-ide-accent shrink-0 font-bold">{'<'}</span>}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-ide-text-muted">↑ ↓ 切换 · 空格 选择</div>
            </div>
          )}

          {phase === 'over' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-ide-bg/70 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 bg-ide-sidebar border border-ide-border rounded-xl px-10 py-6 shadow-2xl">
                <div className="text-base font-bold text-ide-danger">Game Over</div>
                <div className="text-xs text-ide-text tabular-nums">存活 {fmtTime(time)} / {fmtTime(DURATION)}</div>
                <div className="text-xs text-ide-text-muted">等级 {level} · 击杀 {kills}</div>
                <div className="text-xs text-ide-warning">最佳 {fmtTime(Math.max(best, time))}</div>
                <button onClick={reset} className="mt-1 px-5 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors">再战一局</button>
                <button onClick={() => onBackRef.current?.()} className="px-5 py-1.5 text-xs bg-ide-hover hover:bg-ide-hover/70 text-ide-text-muted rounded-lg transition-colors">返回菜单</button>
              </div>
            </div>
          )}

          {phase === 'win' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-ide-bg/70 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 bg-ide-sidebar border border-ide-border rounded-xl px-10 py-6 shadow-2xl">
                <div className="text-base font-bold text-ide-accent">🎉 黎明降临，你活下来了！ 🎉</div>
                <div className="text-xs text-ide-text tabular-nums">存活 {fmtTime(time)} · 等级 {level} · 击杀 {kills}</div>
                <div className="text-xs text-ide-warning">最佳 {fmtTime(Math.max(best, time))}</div>
                <button onClick={startEndless} className="mt-1 px-5 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors">无尽模式</button>
                <button onClick={reset} className="px-5 py-1.5 text-xs bg-ide-hover hover:bg-ide-hover/70 text-ide-text rounded-lg transition-colors">再来一局</button>
                <button onClick={() => onBackRef.current?.()} className="px-5 py-1.5 text-xs bg-ide-hover hover:bg-ide-hover/70 text-ide-text-muted rounded-lg transition-colors">返回菜单</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute inset-x-4 bottom-8 flex items-center justify-center pointer-events-none z-10">
        <div className="bg-ide-sidebar border border-ide-border rounded-lg px-4 py-2 text-[13px] text-ide-text">{'↑↓←→'} 移动 · <span className="text-ide-accent">空格</span> 选择升级 · ESC 暂停</div>
      </div>
    </div>
  )
}
