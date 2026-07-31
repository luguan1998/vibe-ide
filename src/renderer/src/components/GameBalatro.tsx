import React, { useState, useEffect, useCallback, useRef } from 'react'

type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'
type Enhancement = 'gold' | 'glass' | 'steel' | 'lucky'
type BossEffect = 'needle' | 'wall' | 'manacle'

interface Card {
  suit: Suit
  rank: Rank
  id: string
  enh?: Enhancement
}

interface HandType {
  name: string
  chips: number
  mult: number
}

interface JokerCtx {
  played: Card[]
  hand: Card[]
  handType: HandType | null
  money: number
  jokerCount: number
}

interface Joker {
  id: string
  name: string
  cost: number
  desc: string
  glyph: string
  face: string
  chips?: (c: JokerCtx) => number
  mult?: (c: JokerCtx) => number
  xmult?: (c: JokerCtx) => number
  money?: (c: JokerCtx) => number
}

interface ShopItem {
  kind: 'joker' | 'tarot' | 'planet' | 'voucher'
  id: string
  name: string
  desc: string
  cost: number
}

interface Boss {
  name: string
  desc: string
  effect: BossEffect
}

interface TarotDef {
  id: string
  name: string
  enh: Enhancement
  desc: string
}

interface AnimState {
  stage: 0 | 1 | 2
  chips: number
  mult: number
  total: number
  name: string
  lvl: number
  earn: number
}

const BAL = {
  bg: '#0d1510',
  panel: '#141f18',
  panel2: '#1a2820',
  border: '#2b4033',
  borderDim: 'rgba(43,64,51,0.5)',
  gold: '#e8b84c',
  goldBright: '#ffd166',
  goldDim: '#7d6a3a',
  goldSoft: 'rgba(232,184,76,0.15)',
  text: '#d8cdab',
  muted: '#8fa28f',
  dim: '#5c6f5e',
  chips: '#ffd166',
  mult: '#ff6b5e',
  white: '#f2ecd8',
  red: '#d64545',
  black: '#1c1c1c',
}

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const RANK_VALUES: Record<Rank, number> = {
  A: 14, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13,
}
const CARD_CHIPS: Record<Rank, number> = {
  A: 11, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 10, Q: 10, K: 10,
}
const SUIT_INFO: Record<Suit, { sym: string; color: string }> = {
  hearts: { sym: '♥', color: BAL.red },
  diamonds: { sym: '♦', color: BAL.red },
  clubs: { sym: '♣', color: BAL.black },
  spades: { sym: '♠', color: BAL.black },
}
const ODD_RANKS = new Set(['A', '3', '5', '7', '9'])
const EVEN_RANKS = new Set(['2', '4', '6', '8', '10'])
const FIB_RANKS = new Set(['A', '2', '3', '5', '8'])
const HAND_BASE: Record<string, [number, number]> = {
  'High Card': [5, 1],
  Pair: [10, 2],
  'Two Pair': [20, 2],
  'Three of a Kind': [30, 3],
  Straight: [30, 4],
  Flush: [35, 4],
  'Full House': [40, 4],
  'Four of a Kind': [60, 7],
  'Straight Flush': [100, 8],
  'Royal Flush': [100, 8],
}
const ANTE_TARGETS = [100, 150, 250, 400, 600, 900, 1300, 2000]
const HAND_TYPES_ORDER = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush']
const HAND_CN: Record<string, string> = {
  'High Card': '高牌',
  Pair: '对子',
  'Two Pair': '两对',
  'Three of a Kind': '三条',
  Straight: '顺子',
  Flush: '同花',
  'Full House': '葫芦',
  'Four of a Kind': '四条',
  'Straight Flush': '同花顺',
  'Royal Flush': '皇家同花顺',
}
const BLIND_REWARDS = [1, 2, 4]
const HAND_SIZE_BASE = 8
const MAX_JOKERS = 5
const REROLL_COST = 5
const SHOP_VOUCHER_CHANCE = 0.2

const BOSSES: Boss[] = [
  { name: 'The Needle', desc: '本轮只能出牌 1 次', effect: 'needle' },
  { name: 'The Wall', desc: '目标分数 ×1.5', effect: 'wall' },
  { name: 'The Manacle', desc: '手牌上限 -1', effect: 'manacle' },
]

const JOKERS: Joker[] = [
  { id: 'joker', name: 'Joker', cost: 2, desc: '+4 Mult', glyph: '🃏', face: 'linear-gradient(160deg,#f0d48a,#c89b3c)', mult: () => 4 },
  { id: 'greedy', name: 'Greedy Joker', cost: 4, desc: '打出任意 ♦ 牌时 +$3', glyph: '💰', face: 'linear-gradient(160deg,#ffe3b8,#d98a3c)', money: c => c.played.filter(x => x.suit === 'diamonds').length * 3 },
  { id: 'lusty', name: 'Lusty Joker', cost: 4, desc: '打出任意 ♥ 牌时 +$3', glyph: '💗', face: 'linear-gradient(160deg,#ffb8b8,#c04a4a)', money: c => c.played.filter(x => x.suit === 'hearts').length * 3 },
  { id: 'wrathful', name: 'Wrathful Joker', cost: 4, desc: '打出任意 ♠ 牌时 +$3', glyph: '⚡', face: 'linear-gradient(160deg,#d9dde0,#6d7780)', money: c => c.played.filter(x => x.suit === 'spades').length * 3 },
  { id: 'gluttonous', name: 'Gluttonous Joker', cost: 4, desc: '打出任意 ♣ 牌时 +$3', glyph: '🍴', face: 'linear-gradient(160deg,#b8e3c0,#3c9a5c)', money: c => c.played.filter(x => x.suit === 'clubs').length * 3 },
  { id: 'half', name: 'Half Joker', cost: 5, desc: '出牌 ≤3 张时 +20 Mult', glyph: '½', face: 'linear-gradient(160deg,#b8d4ff,#4a7ac0)', mult: c => (c.played.length <= 3 ? 20 : 0) },
  { id: 'odd', name: 'Odd Todd', cost: 5, desc: '出牌点数全为奇数时 +31 Chips', glyph: '🦉', face: 'linear-gradient(160deg,#e8b8ff,#a04ac0)', chips: c => (c.played.length > 0 && c.played.every(x => ODD_RANKS.has(x.rank)) ? 31 : 0) },
  { id: 'even', name: 'Even Steven', cost: 4, desc: '出牌点数全为偶数时 +20 Chips', glyph: '🎯', face: 'linear-gradient(160deg,#b8fff0,#3c9a8c)', chips: c => (c.played.length > 0 && c.played.every(x => EVEN_RANKS.has(x.rank)) ? 20 : 0) },
  { id: 'sly', name: 'Sly Joker', cost: 4, desc: '出牌含对子时 +50 Chips', glyph: '😏', face: 'linear-gradient(160deg,#fff0b8,#c0a04a)', chips: c => (c.handType && ['Pair', 'Two Pair', 'Full House'].includes(c.handType.name) ? 50 : 0) },
  { id: 'wily', name: 'Wily Joker', cost: 4, desc: '出牌含顺子时 +100 Chips', glyph: '🤠', face: 'linear-gradient(160deg,#ffd9b8,#c07a4a)', chips: c => (c.handType && ['Straight', 'Straight Flush', 'Royal Flush'].includes(c.handType.name) ? 100 : 0) },
  { id: 'clever', name: 'Clever Joker', cost: 4, desc: '出牌含同花时 +100 Chips', glyph: '🧠', face: 'linear-gradient(160deg,#b8e3ff,#4a7ac0)', chips: c => (c.handType && ['Flush', 'Straight Flush', 'Royal Flush'].includes(c.handType.name) ? 100 : 0) },
  { id: 'fib', name: 'Fibonacci', cost: 8, desc: '每张 A/2/3/5/8 出牌 +8 Chips', glyph: '🐚', face: 'linear-gradient(160deg,#d4b8ff,#7a4ac0)', chips: c => c.played.filter(x => FIB_RANKS.has(x.rank)).length * 8 },
  { id: 'bull', name: 'Bull', cost: 6, desc: '每 $1 金币 +2 Chips', glyph: '🐂', face: 'linear-gradient(160deg,#ffb8c8,#c04a6a)', chips: c => c.money * 2 },
  { id: 'stencil', name: 'Joker Stencil', cost: 10, desc: '其余 Joker 位为空时 ×2 Mult', glyph: '⬜', face: 'linear-gradient(160deg,#e0e0e0,#888888)', xmult: c => (c.jokerCount === 0 ? 2 : 1) },
]

const TAROTS: TarotDef[] = [
  { id: 'gold', name: 'Gold Card', enh: 'gold', desc: '该牌打出时 +$3' },
  { id: 'glass', name: 'Glass Card', enh: 'glass', desc: '该牌打出时 Mult ×2,25% 破碎' },
  { id: 'steel', name: 'Steel Card', enh: 'steel', desc: '留在手中时 +1 Mult' },
  { id: 'lucky', name: 'Lucky Card', enh: 'lucky', desc: '出牌时 20% 概率 +20 Mult,否则 +$20' },
]

const PLANETS: { id: string; name: string; hand: string }[] = [
  { id: 'mercury', name: 'Mercury', hand: 'High Card' },
  { id: 'venus', name: 'Venus', hand: 'Pair' },
  { id: 'mars', name: 'Mars', hand: 'Three of a Kind' },
  { id: 'jupiter', name: 'Jupiter', hand: 'Flush' },
  { id: 'saturn', name: 'Saturn', hand: 'Straight' },
  { id: 'neptune', name: 'Neptune', hand: 'Two Pair' },
  { id: 'pluto', name: 'Pluto', hand: 'Full House' },
  { id: 'earth', name: 'Earth', hand: 'Four of a Kind' },
  { id: 'uranus', name: 'Uranus', hand: 'Straight Flush' },
  { id: 'moon', name: 'Moon', hand: 'Royal Flush' },
]

function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: `${rank}-${suit}` })
    }
  }
  return deck
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function evaluateHand(cards: Card[]): HandType | null {
  if (cards.length === 0) return null
  const ranks = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => a - b)
  const suits = cards.map(c => c.suit)
  const counts: Record<number, number> = {}
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1
  const groups = Object.entries(counts).map(([r, c]) => ({ rank: parseInt(r), count: c })).sort((a, b) => b.count - a.count)

  const isFlush = suits.every(s => s === suits[0])
  const isStraight = (() => {
    if (new Set(ranks).size !== 5) return false
    if (ranks[4] - ranks[0] === 4) return true
    if (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 4 && ranks[3] === 5 && ranks[4] === 14) return true
    return false
  })()

  if (isFlush && isStraight) {
    return ranks[4] === 14 && ranks[0] === 10
      ? { name: 'Royal Flush', chips: 100, mult: 8 }
      : { name: 'Straight Flush', chips: 100, mult: 8 }
  }
  if (groups.length === 2 && groups[0].count === 4) return { name: 'Four of a Kind', chips: 60, mult: 7 }
  if (groups.length === 2 && groups[0].count === 3) return { name: 'Full House', chips: 40, mult: 4 }
  if (isFlush) return { name: 'Flush', chips: 35, mult: 4 }
  if (isStraight) return { name: 'Straight', chips: 30, mult: 4 }
  if (groups[0].count === 3) return { name: 'Three of a Kind', chips: 30, mult: 3 }
  if (groups.length === 3 && groups[0].count === 2 && groups[1].count === 2) return { name: 'Two Pair', chips: 20, mult: 2 }
  if (groups[0].count === 2) return { name: 'Pair', chips: 10, mult: 2 }
  return { name: 'High Card', chips: 5, mult: 1 }
}

function drawCardsFromDeck(deck: Card[], hand: Card[], count: number): { deck: Card[]; hand: Card[] } {
  const d = [...deck]
  const needed = Math.min(count, d.length)
  return { deck: d.slice(needed), hand: [...hand, ...d.slice(0, needed)] }
}

function generateShop(): ShopItem[] {
  const items: ShopItem[] = []
  for (const j of shuffle(JOKERS).slice(0, 2)) {
    items.push({ kind: 'joker', id: j.id, name: j.name, desc: j.desc, cost: j.cost })
  }
  const t = TAROTS[Math.floor(Math.random() * TAROTS.length)]
  items.push({ kind: 'tarot', id: t.id, name: t.name, desc: t.desc, cost: 3 })
  const p = PLANETS[Math.floor(Math.random() * PLANETS.length)]
  items.push({ kind: 'planet', id: p.id, name: p.name, desc: `${p.hand} 等级 +1`, cost: 4 })
  if (Math.random() < SHOP_VOUCHER_CHANCE) {
    items.push({ kind: 'voucher', id: 'hand+1', name: 'Voucher: Hand Size +1', desc: '手牌上限 +1(永久)', cost: 6 })
  }
  return items
}

function effHandSizeFor(b: Boss | null, vouchers: number): number {
  return HAND_SIZE_BASE + vouchers - (b && b.effect === 'manacle' ? 1 : 0)
}

const ENH_MARK: Record<Enhancement, string> = { gold: '💰', glass: '❖', steel: '⚙', lucky: '🍀' }
const ENH_BG: Record<Enhancement, string> = {
  gold: 'linear-gradient(160deg,#ffd166,#c9993a)',
  glass: 'rgba(190,228,222,0.85)',
  steel: 'linear-gradient(160deg,#d7dde2,#9aa6b0)',
  lucky: 'linear-gradient(160deg,#b8e6a8,#7cc26e)',
}

function shopIcon(item: ShopItem): { bg: string; mark: string } {
  if (item.kind === 'joker') {
    const j = JOKERS.find(x => x.id === item.id)
    return { bg: j ? j.face : BAL.panel, mark: j ? j.glyph : '🃏' }
  }
  if (item.kind === 'tarot') {
    const t = TAROTS.find(x => x.id === item.id)
    return { bg: t ? ENH_BG[t.enh] : BAL.panel, mark: t ? ENH_MARK[t.enh] : '🔮' }
  }
  if (item.kind === 'planet') return { bg: 'linear-gradient(160deg,#1a2b40,#0d1622)', mark: '🪐' }
  return { bg: 'linear-gradient(160deg,#3a3a4a,#1a1a24)', mark: '🎟️' }
}

function CardView({ card, selected, disabled, onClick }: { card: Card; selected: boolean; disabled: boolean; onClick: () => void }) {
  const info = SUIT_INFO[card.suit]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="relative w-12 h-[66px] rounded-[4px] transition-all duration-100 cursor-pointer select-none shrink-0"
      style={{
        background: card.enh ? ENH_BG[card.enh] : BAL.white,
        border: selected ? `2px solid ${BAL.goldBright}` : '1px solid rgba(0,0,0,0.25)',
        transform: selected ? 'translateY(-10px)' : 'translateY(0)',
        boxShadow: selected ? `0 6px 18px ${BAL.goldSoft}` : '0 2px 6px rgba(0,0,0,0.35)',
      }}
    >
      <div className="absolute top-0.5 left-1 flex flex-col items-center leading-none">
        <span className="text-[12px] font-bold" style={{ color: info.color }}>{card.rank}</span>
        <span className="text-[11px]" style={{ color: info.color }}>{info.sym}</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl" style={{ color: info.color }}>{info.sym}</span>
      </div>
      {card.enh && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-0.5">
          <span className="text-[13px] leading-none" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))' }}>{ENH_MARK[card.enh]}</span>
        </div>
      )}
    </button>
  )
}

export default function GameBalatro({ onBack }: { onBack?: () => void }) {
  const deckRef = useRef<Card[]>(shuffle(createDeck()))
  const [hand, setHand] = useState<Card[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [money, setMoney] = useState(4)
  const moneyRef = useRef(4)
  const [roundScore, setRoundScore] = useState(0)
  const [ante, setAnte] = useState(0)
  const [blindIdx, setBlindIdx] = useState(0)
  const [boss, setBoss] = useState<Boss | null>(null)
  const [handsLeft, setHandsLeft] = useState(4)
  const [discardsLeft, setDiscardsLeft] = useState(3)
  const [jokers, setJokers] = useState<Joker[]>([])
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [vouchers, setVouchers] = useState(0)
  const [gameState, setGameState] = useState<'playing' | 'shop' | 'won' | 'lost'>('playing')
  const [shopItems, setShopItems] = useState<ShopItem[]>([])
  const [shopInfo, setShopInfo] = useState<{ reward: number; interest: number } | null>(null)
  const [enhancing, setEnhancing] = useState<Enhancement | null>(null)
  const [pendingTarots, setPendingTarots] = useState<TarotDef[]>([])
  const [anim, setAnim] = useState<AnimState | null>(null)
  const [scoreBoard, setScoreBoard] = useState<{ chips: number; mult: number; total: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [lastPlayed, setLastPlayed] = useState<string | null>(null)
  const [maxHand, setMaxHand] = useState(0)
  const [earned, setEarned] = useState(0)
  const [handsCount, setHandsCount] = useState(0)
  const [history, setHistory] = useState<{ name: string; lvl: number; score: number }[]>([])
  const [showInfo, setShowInfo] = useState(true)
  const [cardsExpanded, setCardsExpanded] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const lockedRef = useRef(false)
  const animTimers = useRef<number[]>([])
  const lastDrawnRef = useRef(-1)
  const toastTimer = useRef<number | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2000)
  }, [])

  const effHandSize = effHandSizeFor(boss, vouchers)
  const baseTarget = ANTE_TARGETS[ante]
  const target = boss && boss.effect === 'wall' ? Math.ceil(baseTarget * 1.5) : baseTarget

  const drawTo = useCallback((currentHand: Card[], size: number): Card[] => {
    const needed = size - currentHand.length
    if (needed <= 0 || deckRef.current.length === 0) return currentHand
    const result = drawCardsFromDeck(deckRef.current, currentHand, needed)
    deckRef.current = result.deck
    return result.hand
  }, [])

  const clearTimers = useCallback(() => {
    animTimers.current.forEach(t => clearTimeout(t))
    animTimers.current = []
    if (toastTimer.current) {
      clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
  }, [])

  const enterShop = useCallback((reward: number) => {
    const cur = moneyRef.current
    const interest = Math.min(5, Math.floor((cur + reward) / 5))
    const next = cur + reward + interest
    setMoney(next)
    moneyRef.current = next
    setShopInfo({ reward, interest })
    setShopItems(generateShop())
    setGameState('shop')
  }, [])

  const startGame = useCallback(() => {
    clearTimers()
    lockedRef.current = false
    lastDrawnRef.current = -1
    deckRef.current = shuffle(createDeck())
    setHand(drawTo([], HAND_SIZE_BASE))
    setSelected(new Set())
    setMoney(4)
    moneyRef.current = 4
    setRoundScore(0)
    setAnte(0)
    setBlindIdx(0)
    setBoss(null)
    setHandsLeft(4)
    setDiscardsLeft(3)
    setJokers([])
    setLevels({})
    setVouchers(0)
    setEnhancing(null)
    setPendingTarots([])
    setAnim(null)
    setScoreBoard(null)
    setToast(null)
    setLastPlayed(null)
    setMaxHand(0)
    setEarned(0)
    setHandsCount(0)
    setHistory([])
    setCardsExpanded(false)
    setCelebrating(false)
    setGameState('playing')
  }, [clearTimers, drawTo])

  const toggleCard = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 5) next.add(id)
      return next
    })
  }, [])

  const applyEnhance = useCallback((id: string) => {
    if (!enhancing) return
    const t = TAROTS.find(x => x.enh === enhancing)
    setHand(h => h.map(c => (c.id === id ? { ...c, enh: enhancing } : c)))
    setEnhancing(null)
    setPendingTarots(ps => {
      const idx = ps.findIndex(p => p.enh === enhancing)
      if (idx === -1) return ps
      return [...ps.slice(0, idx), ...ps.slice(idx + 1)]
    })
    showToast(`${t ? t.name : '增强'}已应用`)
  }, [enhancing, showToast])

  const activateTarot = useCallback((t: TarotDef) => {
    setEnhancing(t.enh)
  }, [])

  const playHand = useCallback(() => {
    if (lockedRef.current) return
    if (selected.size === 0 || handsLeft <= 0 || gameState !== 'playing' || enhancing) return
    lockedRef.current = true
    const played = hand.filter(c => selected.has(c.id))
    const ht = evaluateHand(played)
    if (!ht) {
      lockedRef.current = false
      return
    }
    const lvl = levels[ht.name] || 1
    let chips = ht.chips + 2 * (lvl - 1)
    let mult = ht.mult + (lvl - 1)
    const steps: number[] = []
    for (const c of played) {
      const cc = CARD_CHIPS[c.rank]
      steps.push(cc)
      chips += cc
    }
    const ctx: JokerCtx = {
      played,
      hand,
      handType: ht,
      money: moneyRef.current,
      jokerCount: Math.max(0, jokers.length - 1),
    }
    let jChips = 0
    for (const j of jokers) if (j.chips) jChips += j.chips(ctx)
    if (jChips) {
      steps.push(jChips)
      chips += jChips
    }
    const steelInHand = hand.filter(c => c.enh === 'steel').length
    if (steelInHand) mult += steelInHand
    for (const j of jokers) if (j.mult) mult += j.mult(ctx)
    const glassCount = played.filter(c => c.enh === 'glass').length
    if (glassCount) mult *= 2 ** glassCount
    for (const j of jokers) if (j.xmult) mult *= j.xmult(ctx)
    let luckyMult = 0
    let luckyMoney = 0
    for (const c of played) {
      if (c.enh !== 'lucky') continue
      if (Math.random() < 0.2) luckyMult += 20
      else luckyMoney += 20
    }
    mult += luckyMult
    const total = Math.floor(chips * mult)
    setScoreBoard({ chips, mult, total })

    let earn = luckyMoney
    earn += played.filter(c => c.enh === 'gold').length * 3
    for (const j of jokers) if (j.money) earn += j.money(ctx)
    if (earn) {
      setMoney(m => {
        const n = m + earn
        moneyRef.current = n
        return n
      })
    }

    const broken = new Set<string>()
    for (const c of played) if (c.enh === 'glass' && Math.random() < 0.25) broken.add(c.id)
    const remaining = hand.filter(c => !selected.has(c.id) && !broken.has(c.id))
    lastDrawnRef.current = -1
    setHand(drawTo(remaining, effHandSize))
    setSelected(new Set())
    setLevels(h => ({ ...h, [ht.name]: lvl + 1 }))
    setLastPlayed(ht.name)
    setMaxHand(m => Math.max(m, total))
    setEarned(e => e + earn)
    setHandsCount(c => c + 1)
    setHistory(h => [{ name: ht.name, lvl: lvl + 1, score: total }, ...h].slice(0, 4))
    const newHandsLeft = handsLeft - 1
    setHandsLeft(newHandsLeft)

    clearTimers()
    let t = 0
    const stepTotal = (n: number) => steps.slice(0, n + 1).reduce((a, b) => a + b, 0)
    steps.forEach((_, i) => {
      t += 170
      const cur = stepTotal(i)
      animTimers.current.push(window.setTimeout(() => setAnim({ stage: 0, chips: cur, mult, total, name: ht.name, lvl, earn }), t))
    })
    t += 320
    animTimers.current.push(window.setTimeout(() => setAnim({ stage: 1, chips, mult, total, name: ht.name, lvl, earn }), t))
    t += 750
    animTimers.current.push(window.setTimeout(() => setAnim({ stage: 2, chips, mult, total, name: ht.name, lvl, earn }), t))
    const settleAt = t + 750
    animTimers.current.push(window.setTimeout(() => setAnim(null), settleAt))

    animTimers.current.push(window.setTimeout(() => {
      const newRoundScore = roundScore + total
      setRoundScore(newRoundScore)
      if (newRoundScore >= target) {
        setCelebrating(true)
        animTimers.current.push(window.setTimeout(() => {
          lockedRef.current = false
          setCelebrating(false)
          const reward = BLIND_REWARDS[blindIdx]
          if (blindIdx === 2) {
            if (ante + 1 >= ANTE_TARGETS.length) {
              setGameState('won')
              return
            }
            setAnte(a => a + 1)
            setBlindIdx(0)
            setBoss(null)
            setRoundScore(0)
            setHandsLeft(4)
            setDiscardsLeft(3)
            deckRef.current = shuffle(createDeck())
            lastDrawnRef.current = -1
            setHand(drawTo([], effHandSizeFor(null, vouchers)))
            enterShop(reward)
          } else {
            const nextBoss = blindIdx === 1 ? BOSSES[Math.floor(Math.random() * BOSSES.length)] : boss
            setBlindIdx(i => i + 1)
            setBoss(nextBoss)
            setRoundScore(0)
            setHandsLeft(4)
            setDiscardsLeft(3)
            deckRef.current = shuffle(createDeck())
            lastDrawnRef.current = -1
            setHand(drawTo([], effHandSizeFor(nextBoss, vouchers)))
            enterShop(reward)
          }
        }, 1000))
      } else {
        lockedRef.current = false
        if (newHandsLeft <= 0) {
          setGameState('lost')
        }
      }
    }, settleAt))
  }, [selected, hand, handsLeft, roundScore, target, ante, blindIdx, boss, effHandSize, vouchers, jokers, levels, enhancing, gameState, drawTo, clearTimers, enterShop])

  const discardHand = useCallback(() => {
    if (lockedRef.current) return
    if (selected.size === 0 || discardsLeft <= 0 || handsLeft <= 0 || gameState !== 'playing' || enhancing) return
    const kept = hand.filter(c => !selected.has(c.id))
    lastDrawnRef.current = -1
    setHand(drawTo(kept, effHandSize))
    setSelected(new Set())
    setDiscardsLeft(d => d - 1)
  }, [selected, hand, discardsLeft, handsLeft, gameState, effHandSize, drawTo, enhancing])

  const skipBlind = useCallback(() => {
    if (lockedRef.current) return
    if (gameState !== 'playing' || blindIdx === 2) return
    const reward = Math.max(1, Math.ceil(BLIND_REWARDS[blindIdx] / 2))
    const nextBoss = blindIdx === 1 ? BOSSES[Math.floor(Math.random() * BOSSES.length)] : boss
    setBlindIdx(i => i + 1)
    setBoss(nextBoss)
    setRoundScore(0)
    setHandsLeft(4)
    setDiscardsLeft(3)
    deckRef.current = shuffle(createDeck())
    lastDrawnRef.current = -1
    setHand(drawTo([], effHandSizeFor(nextBoss, vouchers)))
    setSelected(new Set())
    enterShop(reward)
  }, [gameState, blindIdx, boss, vouchers, drawTo, enterShop])

  const buyItem = useCallback((item: ShopItem) => {
    if (gameState !== 'shop' || money < item.cost) return
    if (item.kind === 'joker' && jokers.length >= MAX_JOKERS) return
    setMoney(m => {
      const n = m - item.cost
      moneyRef.current = n
      return n
    })
    if (item.kind === 'joker') {
      const j = JOKERS.find(x => x.id === item.id)
      if (j) setJokers(js => [...js, j])
    } else if (item.kind === 'tarot') {
      const t = TAROTS.find(x => x.id === item.id)
      if (t) setPendingTarots(ps => [...ps, t])
    } else if (item.kind === 'planet') {
      const p = PLANETS.find(x => x.id === item.id)
      if (p) {
        const nxt = (levels[p.hand] || 1) + 1
        setLevels(h => ({ ...h, [p.hand]: nxt }))
        showToast(`${p.hand} → Lv${nxt}`)
      }
    } else {
      setVouchers(v => v + 1)
    }
    setShopItems(items => items.filter(i => i.id !== item.id || i.kind !== item.kind))
  }, [gameState, money, jokers, levels, showToast])

  const reroll = useCallback(() => {
    if (money < REROLL_COST) return
    setMoney(m => {
      const n = m - REROLL_COST
      moneyRef.current = n
      return n
    })
    setShopItems(generateShop())
  }, [money])

  const sellJoker = useCallback((id: string) => {
    const j = jokers.find(x => x.id === id)
    setJokers(js => js.filter(x => x.id !== id))
    setMoney(m => {
      const n = m + 1
      moneyRef.current = n
      return n
    })
    showToast(`卖出 ${j ? j.name : ''} +$1`)
  }, [jokers, showToast])

  useEffect(() => {
    if (gameState !== 'playing' || lockedRef.current || enhancing) return
    if (hand.length < effHandSize && deckRef.current.length > 0 && lastDrawnRef.current !== hand.length) {
      lastDrawnRef.current = hand.length
      setHand(drawTo(hand, effHandSize))
    }
  }, [hand.length, gameState, effHandSize, drawTo, enhancing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (gameState === 'shop') setGameState('playing')
      else if (enhancing) setEnhancing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [gameState, enhancing])

  useEffect(() => () => clearTimers(), [clearTimers])

  const skipReward = Math.max(1, Math.ceil(BLIND_REWARDS[blindIdx] / 2))
  const blindName = blindIdx === 2 && boss ? boss.name : blindIdx === 1 ? 'BIG BLIND' : 'SMALL BLIND'
  const CARD_LIMIT = 6
  const totalSlots = MAX_JOKERS + pendingTarots.length
  const showCollapse = totalSlots > CARD_LIMIT
  const visibleSlots = cardsExpanded || !showCollapse ? totalSlots : CARD_LIMIT
  const jokerCount = Math.min(MAX_JOKERS, visibleSlots)
  const tarotCount = Math.max(0, visibleSlots - MAX_JOKERS)
  const hiddenCount = totalSlots - CARD_LIMIT

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none select-none relative" style={{ background: BAL.bg, color: BAL.text }}>
      <style>{`
        @keyframes bPop {
          0% { transform: scale(0.4); opacity: 0; }
          60% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes cardPop {
          0% { transform: scale(0.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes scorePop {
          0% { transform: translateY(40%) scale(0.7); opacity: 0; filter: brightness(2.2); }
          60% { transform: translateY(-5%) scale(1.1); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; filter: brightness(1); }
        }
        @keyframes progressPulse {
          0%, 100% { filter: brightness(1.05); }
          50% { filter: brightness(1.75); }
        }
        @keyframes shineSweep {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(750%); }
        }
        @keyframes chipIn {
          0% { transform: translateX(-26px) scale(0.88); opacity: 0; }
          100% { transform: translateX(0) scale(1); opacity: 1; }
        }
        @keyframes multIn {
          0% { transform: translateX(26px) scale(0.88); opacity: 0; }
          100% { transform: translateX(0) scale(1); opacity: 1; }
        }
        @keyframes collideL {
          0%, 100% { transform: translateX(0); }
          40% { transform: translateX(12px); }
          72% { transform: translateX(-3px); }
        }
        @keyframes collideR {
          0%, 100% { transform: translateX(0); }
          40% { transform: translateX(-12px); }
          72% { transform: translateX(3px); }
        }
        @keyframes totalPop {
          0% { transform: scale(0.4); opacity: 0; }
          55% { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes bulbBlink {
          0%, 100% { opacity: 1; }
          45% { opacity: 0.15; }
          55% { opacity: 0.15; }
        }
      `}</style>
      <div
        className="absolute inset-0 pointer-events-none z-30"
        style={{ background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.10) 0 1px, transparent 1px 3px), radial-gradient(ellipse at 50% 30%, transparent 55%, rgba(0,0,0,0.35) 100%)' }}
      />

      <div className="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ background: BAL.panel, borderBottom: `1px solid ${BAL.border}` }}>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="shrink-0 w-7 h-7 rounded flex items-center justify-center" style={{ color: BAL.muted }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-xs font-black tracking-widest" style={{ color: BAL.gold }}>{'🃏'} BALATRO</span>
        </div>
        <div className="flex items-center gap-2.5 text-[12px] tabular-nums">
          <span className="font-bold" style={{ color: BAL.gold }}>💲{money}</span>
          <span className="text-[10px]" style={{ color: BAL.muted }}>Ante {ante + 1}/8</span>
          <span style={{ color: BAL.text }}>✋{handsLeft}</span>
          <span style={{ color: BAL.text }}>🗑{discardsLeft}</span>
        </div>
      </div>

      <div className="relative px-3 py-2 shrink-0" style={{ background: 'linear-gradient(180deg,#1b2620,#0f1612)', borderBottom: `1px solid ${BAL.border}` }}>
        <div className="absolute inset-x-3 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(232,184,76,0.55), transparent)' }} />
        <div className="absolute top-1.5 left-1.5 w-2 h-2 pointer-events-none" style={{ borderTop: `1px solid ${BAL.goldDim}`, borderLeft: `1px solid ${BAL.goldDim}` }} />
        <div className="absolute top-1.5 right-1.5 w-2 h-2 pointer-events-none" style={{ borderTop: `1px solid ${BAL.goldDim}`, borderRight: `1px solid ${BAL.goldDim}` }} />
        <div className="absolute bottom-1.5 left-1.5 w-2 h-2 pointer-events-none" style={{ borderBottom: `1px solid ${BAL.goldDim}`, borderLeft: `1px solid ${BAL.goldDim}` }} />
        <div className="absolute bottom-1.5 right-1.5 w-2 h-2 pointer-events-none" style={{ borderBottom: `1px solid ${BAL.goldDim}`, borderRight: `1px solid ${BAL.goldDim}` }} />

        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-black tracking-[0.18em]" style={{ color: boss ? BAL.mult : BAL.white }}>
              {blindName}
            </span>
            {boss && <span className="text-[11px] truncate" style={{ color: BAL.mult }}>{boss.desc}</span>}
          </div>
          {blindIdx !== 2 && (
            <button
              onClick={skipBlind}
              className="text-[11px] font-bold px-2.5 py-1 rounded shrink-0"
              style={{ border: `1px solid ${BAL.goldDim}`, color: BAL.gold, background: 'rgba(232,184,76,0.08)' }}
            >
              跳过 → ${skipReward}
            </button>
          )}
        </div>

        <div className="h-px mb-1.5" style={{ background: 'linear-gradient(90deg, transparent, rgba(232,184,76,0.35), transparent)' }} />

        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-black tracking-[0.25em]" style={{ color: BAL.dim }}>TARGET</span>
              <span className="text-[13px] leading-none font-black tabular-nums" style={{ color: BAL.gold }}>
                {target.toLocaleString()}
                {boss && boss.effect === 'wall' ? ' ×1.5' : ''}
              </span>
            </div>
            <span
              key={roundScore}
              className="block text-[26px] leading-none font-black tabular-nums"
              style={{
                color: roundScore > 0 ? BAL.goldBright : BAL.goldDim,
                textShadow: roundScore > 0 ? '0 0 14px rgba(255,209,102,0.45)' : 'none',
                animation: 'scorePop 0.28s ease-out',
              }}
            >
              {roundScore.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <div className="h-[14px] flex items-center mb-1">
              {lastPlayed && (
                <span className="text-[10px] font-black tracking-[0.2em] whitespace-nowrap" style={{ color: BAL.gold }}>
                  {HAND_CN[lastPlayed]}{levels[lastPlayed] > 1 ? ` Lv${levels[lastPlayed]}` : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
          <div
            key={`sb-c-${anim ? anim.stage : 2}-${anim ? anim.chips : (scoreBoard?.chips ?? 0)}`}
            className="flex flex-col items-center px-2.5 py-1 rounded-[3px] min-w-[64px]"
            style={{
              background: 'linear-gradient(180deg,#143a5c,#0c2540)',
              border: '1px solid rgba(0,157,255,0.45)',
              opacity: anim || scoreBoard ? 1 : 0.35,
              animation: anim && anim.stage === 0 ? 'chipIn 0.16s ease-out' : anim && anim.stage === 1 ? 'chipIn 0.1s ease-out, collideL 0.3s 0.1s ease-out' : 'none',
            }}
          >
            <span className="text-[7px] font-black tracking-[0.2em] mb-px" style={{ color: 'rgba(0,157,255,0.75)' }}>CHIPS</span>
            <span className="text-[17px] font-black tabular-nums leading-none" style={{ color: '#009dff', textShadow: '0 0 8px rgba(0,157,255,0.45)' }}>
              {(anim ? anim.chips : (scoreBoard?.chips ?? 0)).toLocaleString()}
            </span>
          </div>
          <span className="text-lg font-black shrink-0" style={{ color: BAL.mult, opacity: anim && anim.stage === 0 ? 0.25 : anim || scoreBoard ? 1 : 0.35, transition: 'opacity 0.12s' }}>×</span>
          <div
            key={`sb-m-${anim ? anim.stage : 2}-${anim ? anim.mult : (scoreBoard?.mult ?? 1)}`}
            className="flex flex-col items-center px-2.5 py-1 rounded-[3px] min-w-[64px]"
            style={{
              background: 'linear-gradient(180deg,#5c1424,#400d18)',
              border: '1px solid rgba(254,95,85,0.5)',
              opacity: anim && anim.stage === 0 ? 0.25 : anim || scoreBoard ? 1 : 0.35,
              animation: anim && anim.stage >= 1 ? 'multIn 0.12s ease-out, collideR 0.3s 0.12s ease-out' : 'none',
            }}
          >
            <span className="text-[7px] font-black tracking-[0.2em] mb-px" style={{ color: 'rgba(254,95,85,0.8)' }}>MULT</span>
            <span className="text-[17px] font-black tabular-nums leading-none" style={{ color: '#fe5f55', textShadow: '0 0 8px rgba(254,95,85,0.45)' }}>
              ×{(anim ? anim.mult : (scoreBoard?.mult ?? 1))}
            </span>
          </div>
          </div>
          </div>
        </div>

        <div
          className="relative h-[10px] rounded-[2px] overflow-hidden"
          style={{
            background: '#0a120c',
            border: `1px solid ${celebrating ? BAL.goldBright : BAL.borderDim}`,
            boxShadow: celebrating ? '0 0 14px rgba(255,209,102,0.45)' : 'none',
            transition: 'box-shadow 0.3s, border-color 0.3s',
          }}
        >
          <div className="absolute inset-y-0 left-1/4 w-px" style={{ background: celebrating ? 'rgba(255,209,102,0.5)' : 'rgba(232,184,76,0.18)' }} />
          <div className="absolute inset-y-0 left-2/4 w-px" style={{ background: celebrating ? 'rgba(255,209,102,0.5)' : 'rgba(232,184,76,0.18)' }} />
          <div className="absolute inset-y-0 left-3/4 w-px" style={{ background: celebrating ? 'rgba(255,209,102,0.5)' : 'rgba(232,184,76,0.18)' }} />
          <div
            className="h-full relative transition-all duration-300"
            style={{
              width: `${Math.min(100, (roundScore / target) * 100)}%`,
              background: celebrating ? 'linear-gradient(90deg,#ffd166,#fff0c0)' : 'linear-gradient(90deg,#b8860b,#ffd166)',
              animation: celebrating ? 'progressPulse 0.7s ease-in-out infinite' : 'none',
            }}
          >
            {celebrating && (
              <div className="absolute inset-y-0 w-8" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)', animation: 'shineSweep 1.1s ease-in-out infinite' }} />
            )}
          </div>
        </div>
      </div>

      <div className={`px-3 py-1.5 shrink-0 flex items-center gap-1.5 ${cardsExpanded ? 'overflow-x-auto justify-start' : 'justify-center'}`} style={{ background: BAL.panel2, borderBottom: `1px solid ${BAL.border}` }}>
        {Array.from({ length: jokerCount }).map((_, i) => {
          const j = jokers[i]
          if (!j) {
            return (
              <div key={`empty-${i}`} className="w-9 h-11 rounded-[4px] border border-dashed shrink-0" style={{ borderColor: BAL.borderDim }} />
            )
          }
          return (
            <div
              key={j.id}
              className="relative w-10 h-12 rounded-[4px] flex items-center justify-center group shrink-0"
              title={`${j.name} — ${j.desc}`}
              style={{ background: j.face, border: '1px solid rgba(0,0,0,0.3)', boxShadow: `0 2px 6px ${BAL.goldSoft}` }}
            >
              <span className="text-sm leading-none">{j.glyph}</span>
              <button
                onClick={() => sellJoker(j.id)}
                title="卖出 $1"
                className="absolute -top-1.5 -right-1.5 w-[15px] h-[15px] rounded-full text-[9px] leading-none flex items-center justify-center font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: BAL.mult, color: '#fff', border: '1px solid rgba(0,0,0,0.3)' }}
              >
                ×
              </button>
            </div>
          )
        })}
        {tarotCount > 0 && (
          <>
            <div className="w-px h-7 mx-0.5 shrink-0" style={{ background: BAL.borderDim }} />
            {pendingTarots.slice(0, tarotCount).map(t => (
              <button
                key={t.id}
                onClick={() => activateTarot(t)}
                title={`${t.name} — ${t.desc}`}
                className="w-10 h-12 rounded-[4px] flex items-center justify-center text-[14px] shrink-0"
                style={{
                  background: ENH_BG[t.enh],
                  border: enhancing === t.enh ? `2px solid ${BAL.goldBright}` : '1px solid rgba(0,0,0,0.3)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                }}
              >
                {ENH_MARK[t.enh]}
              </button>
            ))}
          </>
        )}
        {showCollapse && (
          <button
            onClick={() => setCardsExpanded(e => !e)}
            title={cardsExpanded ? '收起' : '展开全部'}
            className="w-9 h-11 rounded-[4px] flex items-center justify-center font-black shrink-0"
            style={{ background: 'rgba(232,184,76,0.15)', border: `1px solid ${BAL.goldDim}`, color: BAL.gold }}
          >
            {cardsExpanded ? '−' : '+'}{!cardsExpanded && hiddenCount > 0 ? hiddenCount : ''}
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center overflow-y-auto p-3 gap-2.5" style={{ minHeight: 0 }}>
        {enhancing && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-md w-full" style={{ background: 'rgba(232,184,76,0.12)', border: `1px solid ${BAL.goldDim}` }}>
            <span className="w-5 h-6 rounded-[2px] flex items-center justify-center text-[10px] shrink-0" style={{ background: ENH_BG[enhancing], border: '1px solid rgba(0,0,0,0.3)' }}>
              {ENH_MARK[enhancing]}
            </span>
            <span className="text-[12px] font-bold" style={{ color: BAL.gold }}>
              点击一张手牌应用 {TAROTS.find(t => t.enh === enhancing)?.name}
            </span>
            <button onClick={() => setEnhancing(null)} title="退出选择,塔罗保留" className="ml-auto text-[11px] px-2.5 py-1 rounded shrink-0" style={{ border: `1px solid ${BAL.border}`, color: BAL.muted }}>
              取消
            </button>
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          {hand.map((card, i) => (
            <div key={card.id} className="shrink-0" style={{ animation: `cardPop 0.18s ease-out ${i * 0.02}s both` }}>
              <CardView
                card={card}
                selected={selected.has(card.id)}
                disabled={gameState !== 'playing'}
                onClick={() => {
                  if (enhancing) applyEnhance(card.id)
                  else if (gameState === 'playing') toggleCard(card.id)
                }}
              />
            </div>
          ))}
          {hand.length === 0 && (
            <div className="text-xs py-6" style={{ color: BAL.dim }}>牌库耗尽</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={playHand}
            disabled={selected.size === 0 || handsLeft <= 0 || gameState !== 'playing' || !!enhancing}
            className="px-6 py-2 rounded-lg text-[13px] font-black transition-colors"
            style={{ background: BAL.gold, color: '#111', opacity: selected.size > 0 && handsLeft > 0 && gameState === 'playing' && !enhancing ? 1 : 0.35 }}
          >
            出牌 ({handsLeft})
          </button>
          <button
            onClick={discardHand}
            disabled={selected.size === 0 || discardsLeft <= 0 || gameState !== 'playing' || !!enhancing}
            className="px-6 py-2 rounded-lg text-[13px] font-bold transition-colors"
            style={{ border: `1px solid ${BAL.border}`, color: BAL.gold, opacity: selected.size > 0 && discardsLeft > 0 && gameState === 'playing' && !enhancing ? 1 : 0.35 }}
          >
            弃牌 ({discardsLeft})
          </button>
        </div>

        <div className="text-[10px]" style={{ color: BAL.dim }}>
          Deck {deckRef.current.length}
          {lastPlayed && levels[lastPlayed] > 1 && <span> · {HAND_CN[lastPlayed]} Lv{levels[lastPlayed]}</span>}
        </div>
      </div>

      <div className="shrink-0 border-t" style={{ background: BAL.panel, borderColor: BAL.border }}>
        <button onClick={() => setShowInfo(s => !s)} className="w-full flex items-center justify-between px-3 py-2 select-none">
          <span className="text-[10px] font-black tracking-widest" style={{ color: BAL.goldDim }}>HAND LEVELS</span>
          <span className="text-[10px] font-black tracking-widest" style={{ color: BAL.dim }}>{showInfo ? 'STATS ▾' : 'STATS ▸'}</span>
        </button>
        {showInfo && <div className="px-3 pb-2 flex gap-3">
          <div className="grid grid-cols-2 gap-1 flex-1 min-w-0">
            {HAND_TYPES_ORDER.map(ht => {
              const lv = levels[ht] || 1
              const up = lv > 1
              return (
                <div
                  key={ht}
                  className="flex items-center justify-between px-1.5 py-0.5 rounded"
                  title={ht}
                  style={{ background: up ? 'rgba(232,184,76,0.10)' : BAL.bg, border: `1px solid ${up ? BAL.goldDim : 'rgba(43,64,51,0.4)'}` }}
                >
                  <span className="text-[10px] truncate" style={{ color: up ? BAL.text : BAL.dim }}>{HAND_CN[ht]}</span>
                  <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: up ? BAL.goldBright : BAL.dim }}>
                    {up ? `Lv${lv}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="w-[112px] shrink-0 flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: BAL.dim }}>最高单手</span>
              <span className="tabular-nums font-bold" style={{ color: BAL.chips }}>{maxHand.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: BAL.dim }}>累计赚取</span>
              <span className="tabular-nums font-bold" style={{ color: BAL.gold }}>${earned}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: BAL.dim }}>打出</span>
              <span className="tabular-nums font-bold" style={{ color: BAL.text }}>{handsCount} 手</span>
            </div>
            <div className="border-t mt-0.5 pt-0.5 flex-1 overflow-hidden" style={{ borderColor: BAL.borderDim }}>
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] leading-[14px]">
                  <span className="truncate mr-1" style={{ color: BAL.muted }}>{HAND_CN[h.name]} Lv{h.lvl}</span>
                  <span className="tabular-nums shrink-0" style={{ color: BAL.muted }}>+{h.score.toLocaleString()}</span>
                </div>
              ))}
              {history.length === 0 && <div className="text-[9px]" style={{ color: BAL.dim }}>暂无记录</div>}
            </div>
          </div>
        </div>
        }
      </div>

      {anim && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-1 px-6 py-4 rounded-lg" style={{ background: 'rgba(10,16,12,0.92)', border: `1px solid ${BAL.border}` }}>
            <div className="text-[10px] tracking-widest font-bold" style={{ color: BAL.gold }}>
              {anim.name.toUpperCase()} LV{anim.lvl}
            </div>
            {anim.stage === 0 && (
              <div key={`c-${anim.chips}`} className="text-3xl font-black tabular-nums" style={{ color: BAL.chips, animation: 'bPop 0.16s ease-out' }}>
                {anim.chips.toLocaleString()}
              </div>
            )}
            {anim.stage === 1 && (
              <div key={`m-${anim.mult}`} className="text-3xl font-black tabular-nums" style={{ color: BAL.mult, animation: 'bPop 0.25s ease-out' }}>
                ×{anim.mult}
              </div>
            )}
            {anim.stage === 2 && (
              <div key={`t-${anim.total}`} className="text-4xl font-black tabular-nums" style={{ color: BAL.goldBright, animation: 'bPop 0.3s ease-out' }}>
                {anim.total.toLocaleString()}
              </div>
            )}
            {anim.stage === 2 && anim.earn > 0 && (
              <div key={`e-${anim.earn}`} className="text-xs font-bold" style={{ color: BAL.gold, animation: 'bPop 0.3s ease-out' }}>
                +${anim.earn}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-14 z-30 pointer-events-none px-3 py-1 rounded-md text-[11px] font-bold whitespace-nowrap"
          style={{ background: 'rgba(10,16,12,0.95)', border: `1px solid ${BAL.goldDim}`, color: BAL.goldBright, animation: 'bPop 0.2s ease-out' }}
        >
          {toast}
        </div>
      )}

      {gameState === 'shop' && (
        <div className="absolute inset-0 z-20 flex flex-col" style={{ background: 'rgba(9,14,11,0.96)' }}>
          <div className="relative shrink-0 border-b" style={{ borderColor: BAL.border }}>
          <div className="flex flex-col items-center pt-3 pb-2">
            <div className="flex justify-center gap-1 mb-1.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <span key={`t-${i}`} className="w-[5px] h-[5px] rounded-full" style={{ background: BAL.goldBright, boxShadow: '0 0 5px rgba(255,209,102,0.9)', animation: `bulbBlink 1.6s ${i * 0.1}s ease-in-out infinite` }} />
              ))}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-[5px] h-[5px] rounded-full" style={{ background: BAL.goldBright, boxShadow: '0 0 5px rgba(255,209,102,0.9)', animation: 'bulbBlink 1.6s 1.2s ease-in-out infinite' }} />
              <span className="text-2xl font-black tracking-[0.3em] pl-[0.3em] leading-none" style={{ color: BAL.goldBright, textShadow: '0 0 8px rgba(255,209,102,0.9), 0 0 22px rgba(255,209,102,0.45), 0 2px 0 rgba(0,0,0,0.55)' }}>
                SHOP
              </span>
              <span className="w-[5px] h-[5px] rounded-full" style={{ background: BAL.goldBright, boxShadow: '0 0 5px rgba(255,209,102,0.9)', animation: 'bulbBlink 1.6s 1.3s ease-in-out infinite' }} />
            </div>
            <div className="flex justify-center gap-1 mt-1.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <span key={`b-${i}`} className="w-[5px] h-[5px] rounded-full" style={{ background: BAL.goldBright, boxShadow: '0 0 5px rgba(255,209,102,0.9)', animation: `bulbBlink 1.6s ${(i + 14) * 0.1}s ease-in-out infinite` }} />
              ))}
            </div>
          </div>
          <div className="absolute right-3 top-3 text-xs font-bold tabular-nums" style={{ color: BAL.gold }}>💲{money}</div>
        </div>
          {shopInfo && (
            <div className="px-3 py-1 text-[10px] shrink-0" style={{ color: BAL.muted }}>
              盲注奖励 +${shopInfo.reward} · 利息 +${shopInfo.interest}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {shopItems.map(item => {
              const canBuy = money >= item.cost && !(item.kind === 'joker' && jokers.length >= MAX_JOKERS)
              return (
                <div
                  key={`${item.kind}-${item.id}`}
                  onClick={() => buyItem(item)}
                  title={canBuy ? `购买 ${item.name}` : item.kind === 'joker' && jokers.length >= MAX_JOKERS ? 'Joker 槽位已满' : '金币不足'}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-md ${canBuy ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                  style={{ background: BAL.panel, border: `1px solid ${canBuy ? BAL.border : 'rgba(43,64,51,0.4)'}`, opacity: canBuy ? 1 : 0.55 }}
                >
                  <span className="w-8 h-10 rounded-[3px] flex items-center justify-center text-[13px] shrink-0" style={{ background: shopIcon(item).bg, border: '1px solid rgba(0,0,0,0.3)' }}>
                    {shopIcon(item).mark}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold" style={{ color: BAL.goldBright }}>{item.name}</div>
                    <div className="text-[11px] truncate" style={{ color: BAL.muted }}>{item.desc}</div>
                  </div>
                  <span className="px-2.5 py-1.5 rounded text-[12px] font-bold shrink-0 tabular-nums" style={{ background: canBuy ? BAL.gold : BAL.panel2, color: canBuy ? '#111' : BAL.dim, border: `1px solid ${canBuy ? BAL.goldBright : BAL.border}` }}>
                    ${item.cost}
                  </span>
                </div>
              )
            })}
            {shopItems.length === 0 && (
              <div className="text-center text-[11px] py-4" style={{ color: BAL.dim }}>已售罄</div>
            )}
          </div>
          <div className="px-3 py-2 shrink-0 flex items-center justify-between border-t" style={{ borderColor: BAL.border }}>
            <button
              onClick={reroll}
              disabled={money < REROLL_COST}
              className="px-3 py-1.5 rounded text-[12px] font-bold"
              style={{ border: `1px solid ${BAL.border}`, color: BAL.gold, opacity: money >= REROLL_COST ? 1 : 0.4 }}
            >
              🔄 Reroll ${REROLL_COST}
            </button>
            <button onClick={() => setGameState('playing')} className="px-5 py-2 rounded text-[13px] font-black" style={{ background: BAL.gold, color: '#111' }}>
              ▶ 继续
            </button>
          </div>
        </div>
      )}

      {gameState === 'won' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20" style={{ background: 'rgba(9,14,11,0.9)' }}>
          <div className="text-3xl">{'🏆'}</div>
          <div className="text-lg font-black tracking-widest" style={{ color: BAL.gold }}>YOU WIN!</div>
          <div className="text-[11px]" style={{ color: BAL.muted }}>最高单手 {maxHand.toLocaleString()} · 打出 {handsCount} 手</div>
          <button onClick={startGame} className="px-5 py-2 rounded text-[13px] font-black" style={{ background: BAL.gold, color: '#111' }}>
            新游戏
          </button>
        </div>
      )}

      {gameState === 'lost' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20" style={{ background: 'rgba(9,14,11,0.9)' }}>
          <div className="text-base font-black tracking-widest" style={{ color: BAL.mult }}>GAME OVER</div>
          <div className="text-[11px]" style={{ color: BAL.muted }}>Ante {ante + 1} · 最高单手 {maxHand.toLocaleString()}</div>
          <button onClick={startGame} className="px-5 py-2 rounded text-[13px] font-black" style={{ background: BAL.gold, color: '#111' }}>
            再来一次
          </button>
        </div>
      )}
    </div>
  )
}
