import React, { useState, useEffect, useCallback, useRef } from 'react'

type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'
type Enhancement = 'gold' | 'glass' | 'steel' | 'lucky' | 'bonus' | 'mult' | 'stone'
type BossEffect = 'needle' | 'wall' | 'manacle' | 'no-discard' | 'min-hand' | 'reversed' | 'tax' | 'mute-enh'
type Rarity = 'common' | 'uncommon' | 'rare'
type TagId = 'money-double' | 'free-pack' | 'free-reroll' | 'instant-pack' | 'boss-nullify'
type PackKind = 'standard' | 'tarot' | 'planet'

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
  lastPlayed: string | null
}

interface Joker {
  id: string
  uid?: string
  name: string
  cost: number
  desc: string
  glyph: string
  face: string
  rarity?: Rarity
  chips?: (c: JokerCtx) => number
  mult?: (c: JokerCtx) => number
  xmult?: (c: JokerCtx, state: number) => number
  money?: (c: JokerCtx) => number
  value?: (c: JokerCtx, state: number) => { chips?: number; mult?: number }
  onPlay?: (c: JokerCtx, state: number) => number
  onDiscard?: (c: JokerCtx, state: number) => number
  onPlanet?: (c: JokerCtx, state: number) => number
  onSkip?: (c: JokerCtx, state: number) => number
}

interface ShopItem {
  kind: 'joker' | 'tarot' | 'planet' | 'voucher' | 'pack'
  uid?: string
  id: string
  name: string
  desc: string
  cost: number
  packKind?: PackKind
}

interface Boss {
  name: string
  desc: string
  effect: BossEffect
  color: string
}

type TarotAction =
  | { kind: 'enhance'; enh: Enhancement }
  | { kind: 'rank-up' }
  | { kind: 'suit-to'; suit: Suit }
  | { kind: 'destroy' }
  | { kind: 'create' }
  | { kind: 'money-x2' }
  | { kind: 'tarot-x2' }

interface TarotDef {
  id: string
  uid?: string
  name: string
  action: TarotAction
  desc: string
  glyph: string
  face: string
}

interface PackState {
  kind: PackKind
  options: (Card | TarotDef | { id: string; name: string; hand: string })[]
}

interface StakeDef {
  name: string
  color: string
  targetGrowth: number
  handSize: number
  jokerSlots: number
  discards: number
  startMoney: number
  noSmallReward: boolean
  rent: number
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
  blue: '#028CF1',
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
const MAX_TAROTS = 2
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
const ANTE_TARGETS = [100, 300, 800, 2000, 5000, 11000, 20000, 35000]
const PLANET_SCALE: Record<string, [number, number]> = {
  'High Card': [10, 1],
  Pair: [15, 2],
  'Two Pair': [20, 2],
  'Three of a Kind': [20, 3],
  Straight: [30, 4],
  Flush: [30, 4],
  'Full House': [30, 4],
  'Four of a Kind': [30, 7],
  'Straight Flush': [30, 8],
  'Royal Flush': [30, 8],
}

function handWithLevel(name: string, lvl: number): { chips: number; mult: number } {
  const [bc, bm] = HAND_BASE[name] || [5, 1]
  const [sc, sm] = PLANET_SCALE[name] || [30, 4]
  const c = sc * (lvl - 1)
  const m = sm * (lvl - 1)
  return { chips: bc + c, mult: bm + m }
}
const BLIND_MULT = [1, 1.5, 2]
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
const BLIND_REWARDS = [3, 4, 5]
const HAND_SIZE_BASE = 8
const MAX_JOKERS = 5
const REROLL_BASE = 5
const REROLL_STEP = 5
function rerollCost(count: number): number {
  return REROLL_BASE + count * REROLL_STEP
}
const SHOP_VOUCHER_CHANCE = 0.2
const ENHANCEMENTS: Enhancement[] = ['gold', 'glass', 'steel', 'lucky', 'bonus', 'mult', 'stone']
const PACK_IDS: PackKind[] = ['standard', 'tarot', 'planet']
const PACKS: Record<PackKind, { name: string; cost: number; desc: string; count: number }> = {
  standard: { name: 'Standard Pack', cost: 4, desc: '随机牌 ×3,选 1 张(35% 带增强)', count: 3 },
  tarot: { name: 'Tarot Pack', cost: 3, desc: '塔罗 ×2,选 1 张', count: 2 },
  planet: { name: 'Planet Pack', cost: 4, desc: '行星 ×2,选 1 张', count: 2 },
}
const TAGS: Record<TagId, { name: string; desc: string }> = {
  'money-double': { name: 'Money Tag', desc: '进入商店时金币翻倍' },
  'free-pack': { name: 'Pack Tag', desc: '商店赠送一个免费包' },
  'free-reroll': { name: 'Reroll Tag', desc: '首次 Reroll 免费' },
  'instant-pack': { name: 'Juggle Tag', desc: '立即开一个随机包' },
  'boss-nullify': { name: 'Nullify Tag', desc: '下个 Boss 效果无效' },
}
const TAG_IDS: TagId[] = ['money-double', 'free-pack', 'free-reroll', 'instant-pack', 'boss-nullify']
const RARITY_BORDER: Record<Rarity, string> = {
  common: 'rgba(150,160,150,0.55)',
  uncommon: 'rgba(80,140,255,0.65)',
  rare: 'rgba(200,120,255,0.8)',
}
const RARITY_WEIGHTS: [Rarity, number][] = [['common', 60], ['uncommon', 30], ['rare', 10]]
const REVERSE_SUIT: Record<Suit, Suit> = { hearts: 'spades', spades: 'hearts', diamonds: 'clubs', clubs: 'diamonds' }
const STAKES: StakeDef[] = [
  { name: '白', color: '#e8e8e8', targetGrowth: 0, handSize: 0, jokerSlots: 0, discards: 0, startMoney: 4, noSmallReward: false, rent: 0 },
  { name: '红', color: '#ff6b5e', targetGrowth: 0, handSize: 0, jokerSlots: 0, discards: 0, startMoney: 4, noSmallReward: true, rent: 0 },
  { name: '绿', color: '#6edb6e', targetGrowth: 0.125, handSize: 0, jokerSlots: 0, discards: 0, startMoney: 4, noSmallReward: false, rent: 0 },
  { name: '黑', color: '#9aa6b0', targetGrowth: 0, handSize: 0, jokerSlots: -1, discards: 0, startMoney: 4, noSmallReward: false, rent: 0 },
  { name: '蓝', color: '#5eb0ff', targetGrowth: 0, handSize: 0, jokerSlots: 0, discards: -1, startMoney: 4, noSmallReward: false, rent: 0 },
  { name: '紫', color: '#b06eff', targetGrowth: 0.25, handSize: 0, jokerSlots: 0, discards: 0, startMoney: 4, noSmallReward: false, rent: 0 },
  { name: '橙', color: '#ff9d45', targetGrowth: 0, handSize: 0, jokerSlots: 0, discards: 0, startMoney: 0, noSmallReward: false, rent: 0 },
  { name: '金', color: '#ffd166', targetGrowth: 0, handSize: 0, jokerSlots: 0, discards: 0, startMoney: 4, noSmallReward: false, rent: 3 },
]

const BOSSES: Boss[] = [
  { name: 'The Needle', desc: '本轮只能出牌 1 次', effect: 'needle', color: '#ff6b5e' },
  { name: 'The Wall', desc: '目标分数 ×1.5', effect: 'wall', color: '#ffd166' },
  { name: 'The Manacle', desc: '手牌上限 -1', effect: 'manacle', color: '#9aa6b0' },
  { name: 'The Hook', desc: '禁止弃牌', effect: 'no-discard', color: '#5eb0ff' },
  { name: 'The Mouth', desc: '出牌必须 ≥4 张', effect: 'min-hand', color: '#b06eff' },
  { name: 'The Reverse', desc: '花色反转判定(♥↔♠,♦↔♣)', effect: 'reversed', color: '#ff9d45' },
  { name: 'The Tax', desc: '本盲注开始 -$3', effect: 'tax', color: '#d64545' },
  { name: 'The Mute', desc: '增强牌全部失效', effect: 'mute-enh', color: '#6edb6e' },
]

const JOKERS: Joker[] = [
  { id: 'joker', name: 'Joker', cost: 2, desc: '+4 Mult', glyph: '🃏', face: 'linear-gradient(160deg,#f0d48a,#c89b3c)', rarity: 'common', mult: () => 4 },
  { id: 'greedy', name: 'Greedy Joker', cost: 4, desc: '打出任意 ♦ 牌时 +$3', glyph: '💰', face: 'linear-gradient(160deg,#ffe3b8,#d98a3c)', rarity: 'common', money: c => c.played.filter(x => x.suit === 'diamonds' && x.enh !== 'stone').length * 3 },
  { id: 'lusty', name: 'Lusty Joker', cost: 4, desc: '打出任意 ♥ 牌时 +$3', glyph: '💗', face: 'linear-gradient(160deg,#ffb8b8,#c04a4a)', rarity: 'common', money: c => c.played.filter(x => x.suit === 'hearts' && x.enh !== 'stone').length * 3 },
  { id: 'wrathful', name: 'Wrathful Joker', cost: 4, desc: '打出任意 ♠ 牌时 +$3', glyph: '⚡', face: 'linear-gradient(160deg,#d9dde0,#6d7780)', rarity: 'common', money: c => c.played.filter(x => x.suit === 'spades' && x.enh !== 'stone').length * 3 },
  { id: 'gluttonous', name: 'Gluttonous Joker', cost: 4, desc: '打出任意 ♣ 牌时 +$3', glyph: '🍴', face: 'linear-gradient(160deg,#b8e3c0,#3c9a5c)', rarity: 'common', money: c => c.played.filter(x => x.suit === 'clubs' && x.enh !== 'stone').length * 3 },
  { id: 'half', name: 'Half Joker', cost: 5, desc: '出牌 ≤3 张时 +20 Mult', glyph: '½', face: 'linear-gradient(160deg,#b8d4ff,#4a7ac0)', rarity: 'common', mult: c => (c.played.length <= 3 ? 20 : 0) },
  { id: 'odd', name: 'Odd Todd', cost: 5, desc: '出牌点数全为奇数时 +31 Chips', glyph: '🦉', face: 'linear-gradient(160deg,#e8b8ff,#a04ac0)', rarity: 'common', chips: c => (c.played.length > 0 && c.played.every(x => x.enh !== 'stone' && ODD_RANKS.has(x.rank)) ? 31 : 0) },
  { id: 'even', name: 'Even Steven', cost: 4, desc: '出牌点数全为偶数时 +20 Chips', glyph: '🎯', face: 'linear-gradient(160deg,#b8fff0,#3c9a8c)', rarity: 'common', chips: c => (c.played.length > 0 && c.played.every(x => x.enh !== 'stone' && EVEN_RANKS.has(x.rank)) ? 20 : 0) },
  { id: 'sly', name: 'Sly Joker', cost: 4, desc: '出牌含对子时 +50 Chips', glyph: '😏', face: 'linear-gradient(160deg,#fff0b8,#c0a04a)', rarity: 'uncommon', chips: c => (c.handType && ['Pair', 'Two Pair', 'Full House'].includes(c.handType.name) ? 50 : 0) },
  { id: 'wily', name: 'Wily Joker', cost: 4, desc: '出牌含顺子时 +100 Chips', glyph: '🤠', face: 'linear-gradient(160deg,#ffd9b8,#c07a4a)', rarity: 'uncommon', chips: c => (c.handType && ['Straight', 'Straight Flush', 'Royal Flush'].includes(c.handType.name) ? 100 : 0) },
  { id: 'clever', name: 'Clever Joker', cost: 4, desc: '出牌含同花时 +100 Chips', glyph: '🧠', face: 'linear-gradient(160deg,#b8e3ff,#4a7ac0)', rarity: 'uncommon', chips: c => (c.handType && ['Flush', 'Straight Flush', 'Royal Flush'].includes(c.handType.name) ? 100 : 0) },
  { id: 'fib', name: 'Fibonacci', cost: 8, desc: '每张 A/2/3/5/8 出牌 +8 Chips', glyph: '🐚', face: 'linear-gradient(160deg,#d4b8ff,#7a4ac0)', rarity: 'uncommon', chips: c => c.played.filter(x => x.enh !== 'stone' && FIB_RANKS.has(x.rank)).length * 8 },
  { id: 'bull', name: 'Bull', cost: 6, desc: '每 $1 金币 +2 Chips', glyph: '🐂', face: 'linear-gradient(160deg,#ffb8c8,#c04a6a)', rarity: 'uncommon', chips: c => c.money * 2 },
  { id: 'stencil', name: 'Joker Stencil', cost: 10, desc: '其余 Joker 位为空时 ×2 Mult', glyph: '⬜', face: 'linear-gradient(160deg,#e0e0e0,#888888)', rarity: 'rare', xmult: c => (c.jokerCount === 0 ? 2 : 1) },
  { id: 'redcard', name: 'Red Card', cost: 6, desc: '每弃 1 次 +3 Mult(累积)', glyph: '🔴', face: 'linear-gradient(160deg,#ffb0a0,#c04030)', rarity: 'common', onDiscard: () => 1, value: (c, s) => ({ mult: s * 3 }) },
  { id: 'green', name: 'Green Joker', cost: 5, desc: '每手出牌 +1 Mult,每弃 -1(累积)', glyph: '🟢', face: 'linear-gradient(160deg,#a0e0a8,#308a40)', rarity: 'common', onPlay: () => 1, onDiscard: () => -1, value: (c, s) => ({ mult: Math.max(0, s) }) },
  { id: 'runner', name: 'Runner', cost: 6, desc: '每手顺子 +15 Chips(累积)', glyph: '🏃', face: 'linear-gradient(160deg,#b0d8ff,#4070b0)', rarity: 'uncommon', onPlay: c => (c.handType && ['Straight', 'Straight Flush', 'Royal Flush'].includes(c.handType.name) ? 1 : 0), value: (c, s) => ({ chips: s * 15 }) },
  { id: 'trousers', name: 'Spare Trousers', cost: 6, desc: '每手两对/葫芦 +10 Mult(累积)', glyph: '👖', face: 'linear-gradient(160deg,#d0d0f0,#606090)', rarity: 'uncommon', onPlay: c => (c.handType && ['Two Pair', 'Full House'].includes(c.handType.name) ? 1 : 0), value: (c, s) => ({ mult: s * 10 }) },
  { id: 'bus', name: 'Ride the Bus', cost: 7, desc: '每手无 J/Q/K +1 Mult(累积)', glyph: '🚌', face: 'linear-gradient(160deg,#ffe0a0,#c09040)', rarity: 'rare', onPlay: c => (c.played.some(x => x.enh !== 'stone' && ['J', 'Q', 'K'].includes(x.rank)) ? 0 : 1), value: (c, s) => ({ mult: s }) },
  { id: 'scary', name: 'Scary Face', cost: 4, desc: '每张 J/Q/K 出牌 +30 Chips', glyph: '😱', face: 'linear-gradient(160deg,#e0d8c8,#7a6a4a)', rarity: 'common', chips: c => c.played.filter(x => x.enh !== 'stone' && ['J', 'Q', 'K'].includes(x.rank)).length * 30 },
  { id: 'photo', name: 'Photograph', cost: 8, desc: '打出首张 ♥ 牌时 ×2 Mult', glyph: '📸', face: 'linear-gradient(160deg,#ffb8c8,#c04a6a)', rarity: 'uncommon', xmult: c => (c.played.find(x => x.suit === 'hearts' && x.enh !== 'stone') ? 2 : 1) },
  { id: 'constellation', name: 'Constellation', cost: 10, desc: '每用 1 张行星牌 +0.1× Mult(累积)', glyph: '✨', face: 'linear-gradient(160deg,#c8b8ff,#6a4ac0)', rarity: 'rare', onPlanet: () => 1, xmult: (c, s) => 1 + 0.1 * s },
  { id: 'sharp', name: 'Card Sharp', cost: 9, desc: '上一手同手型时 ×3 Mult', glyph: '🔪', face: 'linear-gradient(160deg,#ffd0b8,#b05830)', rarity: 'uncommon', xmult: c => (c.lastPlayed === (c.handType?.name || null) ? 3 : 1) },
  { id: 'blackboard', name: 'Blackboard', cost: 14, desc: '手牌全为 ♠♣ 时 ×3 Mult', glyph: '🏫', face: 'linear-gradient(160deg,#3a3a4a,#12121c)', rarity: 'rare', xmult: c => (c.hand.length > 0 && c.hand.every(x => x.enh !== 'stone' && (x.suit === 'spades' || x.suit === 'clubs')) ? 3 : 1) },
  { id: 'triboulet', name: 'Triboulet', cost: 17, desc: '每张打出的 K/Q ×2 Mult', glyph: '⚜️', face: 'linear-gradient(160deg,#ffd6a8,#c07820)', rarity: 'rare', xmult: c => 2 ** c.played.filter(x => x.enh !== 'stone' && (x.rank === 'K' || x.rank === 'Q')).length },
  { id: 'cavendish', name: 'Cavendish', cost: 18, desc: '无条件 ×3 Mult', glyph: '🎈', face: 'linear-gradient(160deg,#e8e0a8,#a09040)', rarity: 'uncommon', xmult: () => 3 },
  { id: 'baron', name: 'Baron', cost: 16, desc: '手中每张 K ×1.5 Mult', glyph: '🤵', face: 'linear-gradient(160deg,#d8c8e8,#7a5aa0)', rarity: 'rare', xmult: c => 1.5 ** c.hand.filter(x => x.enh !== 'stone' && x.rank === 'K').length },
  { id: 'throwback', name: 'Throwback', cost: 8, desc: '每跳过 1 个盲注 +0.25× Mult(累积)', glyph: '🎮', face: 'linear-gradient(160deg,#ffb8b8,#c04040)', rarity: 'uncommon', onSkip: () => 1, xmult: (c, s) => 1 + 0.25 * s },
]

const TAROTS: TarotDef[] = [
  { id: 'gold', name: 'Gold Card', action: { kind: 'enhance', enh: 'gold' }, desc: '该牌打出时 +$3', glyph: '💰', face: 'linear-gradient(160deg,#ffd166,#c9993a)' },
  { id: 'glass', name: 'Glass Card', action: { kind: 'enhance', enh: 'glass' }, desc: '该牌打出时 Mult ×2,25% 破碎', glyph: '❖', face: 'linear-gradient(160deg,#d8e9e6,#8fb3ac)' },
  { id: 'steel', name: 'Steel Card', action: { kind: 'enhance', enh: 'steel' }, desc: '留在手中时 +1 Mult', glyph: '⚙', face: 'linear-gradient(160deg,#d7dde2,#9aa6b0)' },
  { id: 'lucky', name: 'Lucky Card', action: { kind: 'enhance', enh: 'lucky' }, desc: '出牌时 20% 概率 +20 Mult,否则 +$20', glyph: '🍀', face: 'linear-gradient(160deg,#b8e6a8,#7cc26e)' },
  { id: 'strength', name: 'The Strength', action: { kind: 'rank-up' }, desc: '选 1 张手牌,点数 +1', glyph: '💪', face: 'linear-gradient(160deg,#ffc9b8,#c06040)' },
  { id: 'moon', name: 'The Moon', action: { kind: 'suit-to', suit: 'spades' }, desc: '选 1 张手牌变 ♠', glyph: '🌙', face: 'linear-gradient(160deg,#3a3a5c,#1a1a30)' },
  { id: 'sun', name: 'The Sun', action: { kind: 'suit-to', suit: 'hearts' }, desc: '选 1 张手牌变 ♥', glyph: '☀️', face: 'linear-gradient(160deg,#ffe08a,#c08a2a)' },
  { id: 'star', name: 'The Star', action: { kind: 'suit-to', suit: 'diamonds' }, desc: '选 1 张手牌变 ♦', glyph: '⭐', face: 'linear-gradient(160deg,#b8d8ff,#4a7ab8)' },
  { id: 'hanged', name: 'The Hanged Man', action: { kind: 'destroy' }, desc: '销毁 1 张手牌', glyph: '🪢', face: 'linear-gradient(160deg,#8ab8b0,#2a5c54)' },
  { id: 'magician', name: 'The Magician', action: { kind: 'create' }, desc: '生成 1 张随机牌', glyph: '🎩', face: 'linear-gradient(160deg,#d8b8ff,#7a4ac0)' },
  { id: 'hermit', name: 'The Hermit', action: { kind: 'money-x2' }, desc: '金币翻倍', glyph: '🏮', face: 'linear-gradient(160deg,#f0d0a0,#8a6a30)' },
  { id: 'emperor', name: 'The Emperor', action: { kind: 'tarot-x2' }, desc: '获得 2 张随机塔罗', glyph: '👑', face: 'linear-gradient(160deg,#ffe0b0,#b08040)' },
  { id: 'bonus', name: 'Bonus Card', action: { kind: 'enhance', enh: 'bonus' }, desc: '该牌打出时 +30 Chips', glyph: '💠', face: 'linear-gradient(160deg,#ffe08a,#c0782a)' },
  { id: 'multcard', name: 'Mult Card', action: { kind: 'enhance', enh: 'mult' }, desc: '该牌打出时 +4 Mult', glyph: '✖️', face: 'linear-gradient(160deg,#ffc0b8,#b03028)' },
  { id: 'world', name: 'The World', action: { kind: 'enhance', enh: 'stone' }, desc: '选 1 张手牌变成石头牌(无花色/点数,+50 Chips)', glyph: '🌍', face: 'linear-gradient(160deg,#c8c8c8,#707070)' },
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

function sortByRank(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const d = RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)
    if (d !== 0) return d
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
  })
}

function sortBySuit(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const d = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
    if (d !== 0) return d
    return RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)
  })
}

function sortCards(mode: 'rank' | 'suit', cards: Card[]): Card[] {
  return mode === 'suit' ? sortBySuit(cards) : sortByRank(cards)
}

function evaluateHand(cards: Card[]): HandType | null {
  if (cards.length === 0) return null
  const playable = cards.filter(c => c.enh !== 'stone')
  if (playable.length === 0) return { name: 'High Card', chips: 5, mult: 1 }
  const ranks = playable.map(c => RANK_VALUES[c.rank]).sort((a, b) => a - b)
  const suits = playable.map(c => c.suit)
  const counts: Record<number, number> = {}
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1
  const groups = Object.entries(counts).map(([r, c]) => ({ rank: parseInt(r), count: c })).sort((a, b) => b.count - a.count)

  const isFlush = playable.length === 5 && suits.every(s => s === suits[0])
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
  if (groups[0].count === 4) return { name: 'Four of a Kind', chips: 60, mult: 7 }
  if (groups[0].count === 3 && groups[1]?.count === 2) return { name: 'Full House', chips: 40, mult: 4 }
  if (isFlush) return { name: 'Flush', chips: 35, mult: 4 }
  if (isStraight) return { name: 'Straight', chips: 30, mult: 4 }
  if (groups[0].count === 3) return { name: 'Three of a Kind', chips: 30, mult: 3 }
  const pairCount = groups.filter(g => g.count === 2).length
  if (pairCount >= 2) return { name: 'Two Pair', chips: 20, mult: 2 }
  if (pairCount === 1) return { name: 'Pair', chips: 10, mult: 2 }
  return { name: 'High Card', chips: 5, mult: 1 }
}

function drawCardsFromDeck(deck: Card[], hand: Card[], count: number): { deck: Card[]; hand: Card[] } {
  const d = [...deck]
  const needed = Math.min(count, d.length)
  return { deck: d.slice(needed), hand: [...hand, ...d.slice(0, needed)] }
}

function generateShop(): ShopItem[] {
  const items: ShopItem[] = []
  for (let i = 0; i < 2; i++) {
    const j = rollJoker()
    items.push({ kind: 'joker', uid: crypto.randomUUID(), id: j.id, name: j.name, desc: j.desc, cost: j.cost })
  }
  const p0 = PLANETS[Math.floor(Math.random() * PLANETS.length)]
  items.push({ kind: 'planet', uid: crypto.randomUUID(), id: p0.id, name: p0.name, desc: `${p0.hand} 等级 +1`, cost: 4 })
  if (Math.random() < 0.5) {
    const t = TAROTS[Math.floor(Math.random() * TAROTS.length)]
    items.push({ kind: 'tarot', uid: crypto.randomUUID(), id: t.id, name: t.name, desc: t.desc, cost: 3 })
  } else {
    const p = PLANETS[Math.floor(Math.random() * PLANETS.length)]
    items.push({ kind: 'planet', uid: crypto.randomUUID(), id: p.id, name: p.name, desc: `${p.hand} 等级 +1`, cost: 4 })
  }
  if (Math.random() < SHOP_VOUCHER_CHANCE) {
    items.push({ kind: 'voucher', uid: crypto.randomUUID(), id: 'hand+1', name: 'Voucher: Hand Size +1', desc: '手牌上限 +1(永久)', cost: 6 })
  }
  if (Math.random() < 0.2) {
    const pk = PACK_IDS[Math.floor(Math.random() * PACK_IDS.length)]
    items.push({ kind: 'pack', packKind: pk, uid: crypto.randomUUID(), id: `pack-${pk}`, name: PACKS[pk].name, desc: PACKS[pk].desc, cost: PACKS[pk].cost })
  }
  return items
}

function jokerStateText(j: Joker, state: number): { text: string; color: string } | null {
  if (state <= 0) return null
  const emptyCtx: JokerCtx = { played: [], hand: [], handType: null, money: 0, jokerCount: 0, lastPlayed: null }
  if (j.value) {
    const v = j.value(emptyCtx, state)
    if (v.chips) return { text: `+${v.chips}`, color: BAL.chips }
    if (v.mult) return { text: `+${v.mult}`, color: BAL.mult }
  }
  if (j.xmult) {
    const x = j.xmult(emptyCtx, state)
    if (x !== 1) return { text: `×${x.toFixed(x >= 10 ? 0 : 1)}`, color: '#c8b8ff' }
  }
  return null
}

function rollJoker(): Joker {
  let roll = Math.random() * 100
  let rarity: Rarity = 'common'
  for (const [r, w] of RARITY_WEIGHTS) {
    if (roll < w) {
      rarity = r
      break
    }
    roll -= w
  }
  const pool = JOKERS.filter(j => (j.rarity || 'common') === rarity)
  return pool[Math.floor(Math.random() * pool.length)]
}

function effHandSizeFor(b: Boss | null, vouchers: number): number {
  return HAND_SIZE_BASE + vouchers - (b && b.effect === 'manacle' ? 1 : 0)
}

const ENH_MARK: Record<Enhancement, string> = { gold: '💰', glass: '❖', steel: '⚙', lucky: '🍀', bonus: '＋30', mult: '×4', stone: '🪨' }
const ENH_BG: Record<Enhancement, string> = {
  gold: 'linear-gradient(160deg,#ffd166,#c9993a)',
  glass: 'rgba(190,228,222,0.85)',
  steel: 'linear-gradient(160deg,#d7dde2,#9aa6b0)',
  lucky: 'linear-gradient(160deg,#b8e6a8,#7cc26e)',
  bonus: 'linear-gradient(160deg,#ffe08a,#c0782a)',
  mult: 'linear-gradient(160deg,#ffc0b8,#b03028)',
  stone: 'linear-gradient(160deg,#b8b8b8,#6a6a6a)',
}

function shopIcon(item: ShopItem): { bg: string; mark: string } {
  if (item.kind === 'joker') {
    const j = JOKERS.find(x => x.id === item.id)
    return { bg: j ? j.face : BAL.panel, mark: j ? j.glyph : '🃏' }
  }
  if (item.kind === 'tarot') {
    const t = TAROTS.find(x => x.id === item.id)
    return { bg: t ? t.face : BAL.panel, mark: t ? t.glyph : '🔮' }
  }
  if (item.kind === 'planet') return { bg: 'linear-gradient(160deg,#1a2b40,#0d1622)', mark: '🪐' }
  if (item.kind === 'pack') return { bg: 'linear-gradient(160deg,#3a4a3a,#1a241a)', mark: '🎁' }
  return { bg: 'linear-gradient(160deg,#3a3a4a,#1a1a24)', mark: '🎟️' }
}

function CardView({ card, selected, disabled, onClick }: { card: Card; selected: boolean; disabled: boolean; onClick: () => void }) {
  const info = SUIT_INFO[card.suit]
  const isStone = card.enh === 'stone'
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
      {isStone ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl" style={{ color: '#3a3a3a', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))' }}>🪨</span>
        </div>
      ) : (
        <>
          <div className="absolute top-0.5 left-1 flex flex-col items-center leading-none">
            <span className="text-[12px] font-bold" style={{ color: info.color }}>{card.rank}</span>
            <span className="text-[11px]" style={{ color: info.color }}>{info.sym}</span>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xl" style={{ color: info.color }}>{info.sym}</span>
          </div>
        </>
      )}
      {card.enh && !isStone && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-0.5">
          <span className="text-[13px] leading-none" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))' }}>{ENH_MARK[card.enh]}</span>
        </div>
      )}
    </button>
  )
}

export default function GameBalatro({ onBack }: { onBack?: () => void }) {
  const deckRef = useRef<Card[]>(shuffle(createDeck()))
  const discardPileRef = useRef<Card[]>([])
  const [hand, setHand] = useState<Card[]>([])
  const handRef = useRef<Card[]>([])
  handRef.current = hand
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
  const [gameState, setGameState] = useState<'playing' | 'shop' | 'lost'>('playing')
  const [shopItems, setShopItems] = useState<ShopItem[]>([])
  const [shopInfo, setShopInfo] = useState<{ reward: number; interest: number } | null>(null)
  const [activeTarot, setActiveTarot] = useState<TarotDef | null>(null)
  const [pendingTarots, setPendingTarots] = useState<TarotDef[]>([])
  const [openPack, setOpenPack] = useState<PackState | null>(null)
  const [pendingTag, setPendingTag] = useState<TagId | null>(null)
  const [rerollFree, setRerollFree] = useState(false)
  const [rerollCount, setRerollCount] = useState(0)
  const [nullifyBoss, setNullifyBoss] = useState(false)
  const [jokerState, setJokerState] = useState<Record<string, number>>({})
  const [stakeIdx, setStakeIdx] = useState(() => Math.min(Number(localStorage.getItem('balatro.stake') || 0), STAKES.length - 1))
  const [sortMode, setSortMode] = useState<'rank' | 'suit'>('rank')
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

  const stake = STAKES[stakeIdx]
  const jokerSlots = MAX_JOKERS + stake.jokerSlots
  const bossMuted = nullifyBoss && !!boss
  const effHandSize = effHandSizeFor(bossMuted ? null : boss, vouchers) + stake.handSize
  const baseTarget = ante < ANTE_TARGETS.length
    ? ANTE_TARGETS[ante]
    : Math.ceil(ANTE_TARGETS[ANTE_TARGETS.length - 1] * 1.5 ** (ante - ANTE_TARGETS.length + 1))
  const target = Math.ceil(baseTarget * BLIND_MULT[blindIdx] * (1 + stake.targetGrowth * ante) * (boss && boss.effect === 'wall' && !bossMuted ? 1.5 : 1))
  const maxAnteRecord = Number(localStorage.getItem('balatro.maxAnte') || 0)
  const preview = (() => {
    if (gameState !== 'playing' || selected.size === 0) return null
    const played = hand.filter(c => selected.has(c.id))
    const evalCards = boss && boss.effect === 'reversed' && !bossMuted
      ? played.map(c => ({ ...c, suit: REVERSE_SUIT[c.suit] }))
      : played
    const ht = evaluateHand(evalCards)
    if (!ht) return null
    const lvl = levels[ht.name] || 1
    const hwl = handWithLevel(ht.name, lvl)
    let chips = hwl.chips
    let mult = hwl.mult
    for (const c of played) if (c.enh !== 'stone') chips += CARD_CHIPS[c.rank]
    if (!(boss && boss.effect === 'mute-enh' && !bossMuted)) {
      chips += played.filter(c => c.enh === 'bonus').length * 30
      chips += played.filter(c => c.enh === 'stone').length * 50
    }
    const ctx: JokerCtx = {
      played: evalCards,
      hand,
      handType: ht,
      money,
      jokerCount: Math.max(0, jokers.length - 1),
      lastPlayed,
    }
    for (const j of jokers) {
      if (j.chips) chips += j.chips(ctx)
      if (j.value) chips += j.value(ctx, jokerState[j.uid || j.id] || 0).chips || 0
    }
    if (!(boss && boss.effect === 'mute-enh' && !bossMuted)) {
      mult += hand.filter(c => c.enh === 'steel').length
      mult += played.filter(c => c.enh === 'mult').length * 4
      const glassCount = played.filter(c => c.enh === 'glass').length
      if (glassCount) mult *= 2 ** glassCount
    }
    for (const j of jokers) {
      if (j.mult) mult += j.mult(ctx)
      if (j.value) mult += j.value(ctx, jokerState[j.uid || j.id] || 0).mult || 0
    }
    for (const j of jokers) if (j.xmult) mult *= j.xmult(ctx, jokerState[j.uid || j.id] || 0)
    return { chips, mult, total: Math.floor(chips * mult), name: ht.name, lvl }
  })()
  const sbChips = anim ? anim.chips : preview ? preview.chips : (scoreBoard?.chips ?? 0)
  const sbMult = anim ? anim.mult : preview ? preview.mult : (scoreBoard?.mult ?? 1)
  const sbVisible = !!(anim || preview || scoreBoard)

  const drawTo = useCallback((currentHand: Card[], size: number): Card[] => {
    const needed = size - currentHand.length
    if (needed <= 0) return currentHand
    if (deckRef.current.length < needed && discardPileRef.current.length > 0) {
      deckRef.current = shuffle([...deckRef.current, ...discardPileRef.current])
      discardPileRef.current = []
    }
    if (deckRef.current.length === 0) return currentHand
    const result = drawCardsFromDeck(deckRef.current, currentHand, needed)
    deckRef.current = result.deck
    return sortCards(sortMode, result.hand)
  }, [sortMode])

  const buildPack = useCallback((kind: PackKind): PackState => {
    if (kind === 'standard') {
      const options: Card[] = []
      for (let i = 0; i < PACKS.standard.count; i++) {
        const suit = SUITS[Math.floor(Math.random() * SUITS.length)]
        const rank = RANKS[Math.floor(Math.random() * RANKS.length)]
        const card: Card = { suit, rank, id: `pk-${i}-${Date.now()}-${Math.random()}` }
        if (Math.random() < 0.35) card.enh = ENHANCEMENTS[Math.floor(Math.random() * ENHANCEMENTS.length)]
        options.push(card)
      }
      return { kind, options }
    }
    if (kind === 'tarot') return { kind, options: shuffle(TAROTS).slice(0, PACKS.tarot.count) }
    return { kind, options: shuffle(PLANETS).slice(0, PACKS.planet.count) }
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
    setRerollCount(0)
    const cur = moneyRef.current
    const interest = Math.min(5, Math.floor((cur + reward) / 5))
    let next = cur + reward + interest
    if (stake.rent > 0) {
      next = Math.max(0, next - stake.rent)
      showToast(`租用费 -$${stake.rent}`)
    }
    const tag = pendingTag
    if (tag === 'money-double') {
      next *= 2
      showToast('Money Tag:金币翻倍')
    }
    setMoney(next)
    moneyRef.current = next
    setShopInfo({ reward, interest })
    const items = generateShop()
    if (tag === 'free-pack') {
      const pk = PACK_IDS[Math.floor(Math.random() * PACK_IDS.length)]
      items.push({ kind: 'pack', packKind: pk, uid: crypto.randomUUID(), id: `pack-${pk}-free`, name: `${PACKS[pk].name}(免费)`, desc: PACKS[pk].desc, cost: 0 })
    }
    setShopItems(items)
    if (tag === 'free-reroll') setRerollFree(true)
    if (tag === 'boss-nullify') setNullifyBoss(true)
    if (tag === 'instant-pack') setOpenPack(buildPack(PACK_IDS[Math.floor(Math.random() * PACK_IDS.length)]))
    setPendingTag(null)
    setGameState('shop')
  }, [pendingTag, stake, showToast, buildPack])

  const startGame = useCallback(() => {
    clearTimers()
    lockedRef.current = false
    lastDrawnRef.current = -1
    deckRef.current = shuffle(createDeck())
    discardPileRef.current = []
    setHand(drawTo([], HAND_SIZE_BASE + stake.handSize))
    setSelected(new Set())
    setMoney(stake.startMoney)
    moneyRef.current = stake.startMoney
    setRoundScore(0)
    setAnte(0)
    setBlindIdx(0)
    setBoss(null)
    setHandsLeft(4)
    setDiscardsLeft(3 + stake.discards)
    setJokers([])
    setJokerState({})
    setLevels({})
    setVouchers(0)
    setActiveTarot(null)
    setPendingTarots([])
    setOpenPack(null)
    setPendingTag(null)
    setRerollFree(false)
    setRerollCount(0)
    setNullifyBoss(false)
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
  }, [clearTimers, drawTo, stake])

  const toggleCard = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 5) next.add(id)
      return next
    })
  }, [])

  const triggerJokerHook = useCallback((hook: 'onPlanet' | 'onSkip', prev: Record<string, number>): Record<string, number> => {
    const next = { ...prev }
    const ctx: JokerCtx = { played: [], hand, handType: null, money: moneyRef.current, jokerCount: Math.max(0, jokers.length - 1), lastPlayed }
    for (const j of jokers) {
      const fn = j[hook]
      if (!fn) continue
      const key = j.uid || j.id
      next[key] = (next[key] || 0) + fn(ctx, next[key] || 0)
    }
    return next
  }, [hand, jokers, lastPlayed])

  const applyTarotAction = useCallback((id: string) => {
    const t = activeTarot
    if (!t) return
    const action = t.action
    if (action.kind === 'enhance') {
      setHand(h => h.map(c => (c.id === id ? { ...c, enh: action.enh } : c)))
    } else if (action.kind === 'rank-up') {
      setHand(h => h.map(c => {
        if (c.id !== id) return c
        const idx = RANKS.indexOf(c.rank)
        return { ...c, rank: RANKS[(idx + 1) % RANKS.length] }
      }))
    } else if (action.kind === 'suit-to') {
      setHand(h => h.map(c => (c.id === id ? { ...c, suit: action.suit } : c)))
    } else if (action.kind === 'destroy') {
      setHand(h => h.filter(c => c.id !== id))
    } else if (action.kind === 'create') {
      const suit = SUITS[Math.floor(Math.random() * SUITS.length)]
      const rank = RANKS[Math.floor(Math.random() * RANKS.length)]
      setHand(h => [...h, { suit, rank, id: `${rank}-${suit}-${Date.now()}-${Math.random()}` }])
    }
    setActiveTarot(null)
    setPendingTarots(ps => ps.filter(p => (p.uid || p.id) !== (t.uid || t.id)))
    showToast(`${t.name}已应用`)
  }, [activeTarot, showToast])

  const activateTarot = useCallback((t: TarotDef) => {
    if (t.action.kind === 'money-x2') {
      setMoney(m => {
        const n = m * 2
        moneyRef.current = n
        return n
      })
      setPendingTarots(ps => ps.filter(p => (p.uid || p.id) !== (t.uid || t.id)))
      showToast('The Hermit:金币翻倍')
    } else if (t.action.kind === 'tarot-x2') {
      setPendingTarots(ps => {
        const pick = () => ({ ...TAROTS[Math.floor(Math.random() * TAROTS.length)], uid: crypto.randomUUID() })
        return [...ps.filter(p => (p.uid || p.id) !== (t.uid || t.id)), pick(), pick()].slice(0, MAX_TAROTS)
      })
      showToast('The Emperor:+2 塔罗')
    } else {
      setActiveTarot(t)
    }
  }, [showToast])

  const playHand = useCallback(() => {
    if (lockedRef.current) return
    if (selected.size === 0 || handsLeft <= 0 || gameState !== 'playing' || activeTarot) return
    if (boss && boss.effect === 'min-hand' && !bossMuted && selected.size < 4) return
    lockedRef.current = true
    const played = hand.filter(c => selected.has(c.id))
    const evalCards = boss && boss.effect === 'reversed' && !bossMuted
      ? played.map(c => ({ ...c, suit: REVERSE_SUIT[c.suit] }))
      : played
    const ht = evaluateHand(evalCards)
    if (!ht) {
      lockedRef.current = false
      return
    }
    const enhMuted = boss && boss.effect === 'mute-enh' && !bossMuted
    const lvl = levels[ht.name] || 1
    const hwl = handWithLevel(ht.name, lvl)
    let chips = hwl.chips
    let mult = hwl.mult
    const steps: number[] = []
    for (const c of played) {
      if (c.enh === 'stone') continue
      const cc = CARD_CHIPS[c.rank]
      steps.push(cc)
      chips += cc
    }
    if (!enhMuted) {
      chips += played.filter(c => c.enh === 'bonus').length * 30
      chips += played.filter(c => c.enh === 'stone').length * 50
    }
    const ctx: JokerCtx = {
      played: evalCards,
      hand,
      handType: ht,
      money: moneyRef.current,
      jokerCount: Math.max(0, jokers.length - 1),
      lastPlayed,
    }
    let jChips = 0
    for (const j of jokers) {
      if (j.chips) jChips += j.chips(ctx)
      if (j.value) jChips += j.value(ctx, jokerState[j.uid || j.id] || 0).chips || 0
    }
    if (jChips) {
      steps.push(jChips)
      chips += jChips
    }
    if (!enhMuted) {
      const steelInHand = hand.filter(c => c.enh === 'steel').length
      if (steelInHand) mult += steelInHand
      mult += played.filter(c => c.enh === 'mult').length * 4
    }
    for (const j of jokers) {
      if (j.mult) mult += j.mult(ctx)
      if (j.value) mult += j.value(ctx, jokerState[j.uid || j.id] || 0).mult || 0
    }
    if (!enhMuted) {
      const glassCount = played.filter(c => c.enh === 'glass').length
      if (glassCount) mult *= 2 ** glassCount
    }
    for (const j of jokers) if (j.xmult) mult *= j.xmult(ctx, jokerState[j.uid || j.id] || 0)
    let luckyMult = 0
    let luckyMoney = 0
    if (!enhMuted) {
      for (const c of played) {
        if (c.enh !== 'lucky') continue
        if (Math.random() < 0.2) luckyMult += 20
        else luckyMoney += 20
      }
    }
    mult += luckyMult
    const total = Math.floor(chips * mult)
    setScoreBoard({ chips, mult, total })

    let earn = luckyMoney
    if (!enhMuted) earn += played.filter(c => c.enh === 'gold').length * 3
    for (const j of jokers) if (j.money) earn += j.money(ctx)
    if (earn) {
      setMoney(m => {
        const n = m + earn
        moneyRef.current = n
        return n
      })
    }

    const broken = new Set<string>()
    if (!enhMuted) {
      for (const c of played) if (c.enh === 'glass' && Math.random() < 0.25) broken.add(c.id)
    }
    discardPileRef.current = [...discardPileRef.current, ...played.filter(c => !broken.has(c.id))]
    const remaining = hand.filter(c => !selected.has(c.id) && !broken.has(c.id))
    lastDrawnRef.current = -1
    setHand(drawTo(remaining, effHandSize))
    setSelected(new Set())
    setLastPlayed(ht.name)
    setMaxHand(m => Math.max(m, total))
    setEarned(e => e + earn)
    setHandsCount(c => c + 1)
    setHistory(h => [{ name: ht.name, lvl, score: total }, ...h].slice(0, 4))
    setJokerState(prev => {
      const next = { ...prev }
      for (const j of jokers) {
        if (!j.onPlay) continue
        const key = j.uid || j.id
        next[key] = (next[key] || 0) + j.onPlay(ctx, next[key] || 0)
      }
      return next
    })
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
          const reward = stake.noSmallReward && blindIdx === 0 ? 0 : BLIND_REWARDS[blindIdx]
          if (blindIdx === 2) {
            if (ante + 1 >= ANTE_TARGETS.length) {
              showToast('进入无尽模式!')
              if (stakeIdx < STAKES.length - 1) {
                const nxt = stakeIdx + 1
                localStorage.setItem('balatro.stake', String(nxt))
                setStakeIdx(nxt)
                setMoney(m => {
                  const n = m + 15
                  moneyRef.current = n
                  return n
                })
                showToast(`解锁难度:${STAKES[nxt].name} · +$15`)
              }
            }
            setAnte(a => a + 1)
            setBlindIdx(0)
            setBoss(null)
            setRoundScore(0)
            setHandsLeft(4)
            setDiscardsLeft(3 + stake.discards)
            discardPileRef.current = [...discardPileRef.current, ...handRef.current]
            lastDrawnRef.current = -1
            setHand(drawTo([], effHandSizeFor(null, vouchers) + stake.handSize))
            enterShop(reward)
          } else {
            const nextBoss = blindIdx === 1 ? BOSSES[Math.floor(Math.random() * BOSSES.length)] : boss
            const nextMuted = nullifyBoss && !!nextBoss
            setBlindIdx(i => i + 1)
            setBoss(nextBoss)
            if (nextBoss && nextBoss.effect === 'tax' && !nextMuted) {
              setMoney(m => {
                const n = Math.max(0, m - 3)
                moneyRef.current = n
                return n
              })
              showToast('The Tax: -$3')
            }
            setNullifyBoss(false)
            setRoundScore(0)
            setHandsLeft(nextBoss && nextBoss.effect === 'needle' && !nextMuted ? 1 : 4)
            setDiscardsLeft(3 + stake.discards)
            discardPileRef.current = [...discardPileRef.current, ...handRef.current]
            lastDrawnRef.current = -1
            setHand(drawTo([], effHandSizeFor(nextMuted ? null : nextBoss, vouchers) + stake.handSize))
            enterShop(reward)
          }
        }, 1000))
      } else {
        lockedRef.current = false
        if (newHandsLeft <= 0) {
          const prev = Number(localStorage.getItem('balatro.maxAnte') || 0)
          if (ante + 1 > prev) localStorage.setItem('balatro.maxAnte', String(ante + 1))
          setGameState('lost')
        }
      }
    }, settleAt))
  }, [selected, hand, handsLeft, roundScore, target, ante, blindIdx, boss, bossMuted, effHandSize, vouchers, jokers, levels, activeTarot, gameState, drawTo, clearTimers, enterShop, jokerState, showToast, stakeIdx, stake, nullifyBoss, lastPlayed])

  const discardHand = useCallback(() => {
    if (lockedRef.current) return
    if (selected.size === 0 || discardsLeft <= 0 || handsLeft <= 0 || gameState !== 'playing' || activeTarot) return
    if (boss && boss.effect === 'no-discard' && !bossMuted) return
    const dctx: JokerCtx = { played: [], hand, handType: null, money: moneyRef.current, jokerCount: Math.max(0, jokers.length - 1), lastPlayed }
    discardPileRef.current = [...discardPileRef.current, ...hand.filter(c => selected.has(c.id))]
    const kept = hand.filter(c => !selected.has(c.id))
    lastDrawnRef.current = -1
    setHand(drawTo(kept, effHandSize))
    setSelected(new Set())
    setDiscardsLeft(d => d - 1)
    setJokerState(prev => {
      const next = { ...prev }
      for (const j of jokers) {
        if (!j.onDiscard) continue
        const key = j.uid || j.id
        next[key] = (next[key] || 0) + j.onDiscard(dctx, next[key] || 0)
      }
      return next
    })
  }, [selected, hand, discardsLeft, handsLeft, gameState, effHandSize, drawTo, activeTarot, boss, bossMuted, jokers, lastPlayed])

  const sortHand = useCallback((mode: 'rank' | 'suit') => {
    setHand(h => sortCards(mode, h))
  }, [])

  const skipBlind = useCallback(() => {
    if (lockedRef.current) return
    if (gameState !== 'playing' || blindIdx === 2) return
    const tag = TAG_IDS[Math.floor(Math.random() * TAG_IDS.length)]
    setPendingTag(tag)
    setJokerState(prev => triggerJokerHook('onSkip', prev))
    const nextBoss = blindIdx === 1 ? BOSSES[Math.floor(Math.random() * BOSSES.length)] : boss
    const nextMuted = nullifyBoss && !!nextBoss
    setBlindIdx(i => i + 1)
    setBoss(nextBoss)
    setRoundScore(0)
    setHandsLeft(nextBoss && nextBoss.effect === 'needle' && !nextMuted ? 1 : 4)
    setDiscardsLeft(3 + stake.discards)
    discardPileRef.current = [...discardPileRef.current, ...handRef.current]
    lastDrawnRef.current = -1
    setHand(drawTo([], effHandSizeFor(nextMuted ? null : nextBoss, vouchers) + stake.handSize))
    setSelected(new Set())
    enterShop(0)
  }, [gameState, blindIdx, boss, nullifyBoss, vouchers, drawTo, enterShop, stake, triggerJokerHook])

  const buyItem = useCallback((item: ShopItem) => {
    if (gameState !== 'shop' || money < item.cost) return
    if (item.kind === 'joker' && jokers.length >= jokerSlots) return
    if (item.kind === 'tarot' && pendingTarots.length >= MAX_TAROTS) return
    setMoney(m => {
      const n = m - item.cost
      moneyRef.current = n
      return n
    })
    if (item.kind === 'joker') {
      const j = JOKERS.find(x => x.id === item.id)
      if (j) setJokers(js => [...js, { ...j, uid: crypto.randomUUID() }])
    } else if (item.kind === 'tarot') {
      const t = TAROTS.find(x => x.id === item.id)
      if (t) setPendingTarots(ps => [...ps, { ...t, uid: crypto.randomUUID() }])
    } else if (item.kind === 'planet') {
      const p = PLANETS.find(x => x.id === item.id)
      if (p) {
        const nxt = (levels[p.hand] || 1) + 1
        setLevels(h => ({ ...h, [p.hand]: nxt }))
        setJokerState(prev => triggerJokerHook('onPlanet', prev))
        showToast(`${p.hand} → Lv${nxt}`)
      }
    } else if (item.kind === 'pack') {
      setOpenPack(buildPack(item.packKind!))
    } else {
      setVouchers(v => v + 1)
    }
    setShopItems(items => items.filter(i => i.uid !== item.uid))
  }, [gameState, money, jokers, jokerSlots, pendingTarots.length, levels, showToast, buildPack, triggerJokerHook])

  const reroll = useCallback(() => {
    if (!rerollFree) {
      const cost = rerollCost(rerollCount)
      if (money < cost) return
      setMoney(m => {
        const n = m - cost
        moneyRef.current = n
        return n
      })
    }
    setRerollFree(false)
    setRerollCount(c => c + 1)
    setShopItems(generateShop())
  }, [money, rerollFree, rerollCount])

  const pickPackOption = useCallback((opt: PackState['options'][number]) => {
    if (!openPack) return
    if (openPack.kind === 'standard') {
      setHand(h => sortCards(sortMode, [...h, opt as Card]))
    } else if (openPack.kind === 'tarot') {
      if (pendingTarots.length >= MAX_TAROTS) showToast('塔罗槽位已满（最多 2 张）')
      else setPendingTarots(ps => [...ps, { ...(opt as TarotDef), uid: crypto.randomUUID() }])
    } else {
      const p = opt as { hand: string }
      const nxt = (levels[p.hand] || 1) + 1
      setLevels(h => ({ ...h, [p.hand]: nxt }))
      setJokerState(prev => triggerJokerHook('onPlanet', prev))
      showToast(`${p.hand} → Lv${nxt}`)
    }
    setOpenPack(null)
  }, [openPack, levels, showToast, triggerJokerHook, sortMode, pendingTarots.length])

  const sellJoker = useCallback((key: string) => {
    const j = jokers.find(x => (x.uid || x.id) === key)
    setJokers(js => js.filter(x => (x.uid || x.id) !== key))
    setJokerState(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    const sell = j ? Math.max(1, Math.floor(j.cost / 2)) : 1
    setMoney(m => {
      const n = m + sell
      moneyRef.current = n
      return n
    })
    showToast(`卖出 ${j ? j.name : ''} +$${sell}`)
  }, [jokers, showToast])

  const discardTarot = useCallback((key: string) => {
    const t = pendingTarots.find(x => (x.uid || x.id) === key)
    setPendingTarots(ps => ps.filter(x => (x.uid || x.id) !== key))
    showToast(`丢弃 ${t ? t.name : ''}`)
  }, [pendingTarots, showToast])

  useEffect(() => {
    if (gameState !== 'playing' || lockedRef.current || activeTarot) return
    if (hand.length < effHandSize && deckRef.current.length > 0 && lastDrawnRef.current !== hand.length) {
      lastDrawnRef.current = hand.length
      setHand(drawTo(hand, effHandSize))
    }
  }, [hand.length, gameState, effHandSize, drawTo, activeTarot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (openPack) setOpenPack(null)
      else if (gameState === 'shop') { setScoreBoard(null); setGameState('playing') }
      else if (activeTarot) setActiveTarot(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [gameState, activeTarot, openPack])

  useEffect(() => () => clearTimers(), [clearTimers])

  const blindName = blindIdx === 2 && boss ? boss.name : blindIdx === 1 ? 'BIG BLIND' : 'SMALL BLIND'
  const CARD_LIMIT = 6
  const totalSlots = jokerSlots + pendingTarots.length
  const showCollapse = totalSlots > CARD_LIMIT
  const visibleSlots = cardsExpanded || !showCollapse ? totalSlots : CARD_LIMIT
  const jokerCount = Math.min(jokerSlots, visibleSlots)
  const tarotCount = Math.max(0, visibleSlots - jokerSlots)
  const hiddenCount = totalSlots - CARD_LIMIT
  const canDiscard = selected.size > 0 && discardsLeft > 0 && gameState === 'playing' && !activeTarot && !(boss?.effect === 'no-discard' && !bossMuted)

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
        .bal-play-btn:not(:disabled):hover { filter: brightness(1.2); }
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
          <span className="text-[10px]" style={{ color: BAL.muted }}>
            Ante {ante + 1}{ante >= ANTE_TARGETS.length - 1 ? ' ∞' : `/${ANTE_TARGETS.length}`}
            <span style={{ color: stake.color }}> · {stake.name}</span>
          </span>
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
            <span className="text-[12px] font-black tracking-[0.18em]" style={{ color: boss ? boss.color : BAL.white }}>
              {blindName}
            </span>
            {boss && <span className="text-[11px] truncate" style={{ color: boss.color }}>{boss.desc}</span>}
          </div>
          {blindIdx !== 2 && (
            <button
              onClick={skipBlind}
              className="text-[11px] font-bold px-2.5 py-1 rounded shrink-0"
              style={{ border: `1px solid ${BAL.goldDim}`, color: BAL.gold, background: 'rgba(232,184,76,0.08)' }}
            >
              跳过 → Tag
            </button>
          )}
        </div>

        <div className="h-px mb-1.5" style={{ background: 'linear-gradient(90deg, transparent, rgba(232,184,76,0.35), transparent)' }} />

        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex flex-col items-center gap-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-black tracking-[0.25em]" style={{ color: BAL.dim }}>TARGET</span>
              <span className="text-[9px]" style={{ color: BAL.gold }}>🎯</span>
              <span className="text-[13px] leading-none font-black tabular-nums" style={{ color: BAL.gold }}>
                {target.toLocaleString()}
                {boss && boss.effect === 'wall' ? ' ×1.5' : ''}
              </span>
            </div>
            <div
              className="inline-flex items-center px-2.5 py-1.5 rounded-[3px]"
              style={{
                background: roundScore > 0 ? BAL.gold : 'rgba(232,184,76,0.12)',
                boxShadow: 'inset 0 0 12px rgba(255,255,255,0.15)',
              }}
            >
              <span
                key={roundScore}
                className="inline-flex items-center gap-1 text-[26px] leading-none font-black tabular-nums"
                style={{
                  color: roundScore > 0 ? '#fff' : BAL.goldDim,
                  textShadow: '2px 2px 0 rgba(0,0,0,0.55)',
                  animation: 'scorePop 0.28s ease-out',
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="12" y1="2" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <line x1="5" y1="5" x2="19" y2="19" />
                  <line x1="19" y1="5" x2="5" y2="19" />
                </svg>
                {roundScore.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <div className="h-[14px] flex items-center mb-1">
              {(preview || lastPlayed) && (
                <span className="text-[10px] font-black tracking-[0.2em] whitespace-nowrap" style={{ color: preview ? BAL.chips : BAL.gold }}>
                  {preview
                    ? `${HAND_CN[preview.name]}${preview.lvl > 1 ? ` Lv${preview.lvl}` : ''} = ${preview.total.toLocaleString()}`
                    : `${HAND_CN[lastPlayed!]}${levels[lastPlayed!] > 1 ? ` Lv${levels[lastPlayed!]}` : ''}`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
          <div
            key={`sb-c-${anim ? anim.stage : 2}-${sbChips}`}
            className="flex flex-col items-center justify-center px-2.5 py-1.5 rounded-[3px] min-w-[64px]"
            style={{
              background: BAL.blue,
              boxShadow: 'inset 0 0 12px rgba(255,255,255,0.15)',
              opacity: anim && anim.stage === 0 ? 0.25 : sbVisible ? 1 : 0.35,
              animation: anim && anim.stage === 0 ? 'chipIn 0.16s ease-out' : anim && anim.stage === 1 ? 'chipIn 0.1s ease-out, collideL 0.3s 0.1s ease-out' : 'none',
            }}
          >
            <span className="text-[17px] font-black tabular-nums leading-none" style={{ color: '#fff', fontWeight: 900, textShadow: '2px 2px 0 rgba(0,0,0,0.55)' }}>
              {sbChips.toLocaleString()}
            </span>
          </div>
          <span className="text-lg font-black shrink-0" style={{ color: BAL.mult, opacity: anim && anim.stage === 0 ? 0.25 : sbVisible ? 1 : 0.35, transition: 'opacity 0.12s' }}>×</span>
          <div
            key={`sb-m-${anim ? anim.stage : 2}-${sbMult}`}
            className="flex flex-col items-center justify-center px-2.5 py-1.5 rounded-[3px] min-w-[64px]"
            style={{
              background: '#FB4942',
              boxShadow: 'inset 0 0 12px rgba(255,255,255,0.15)',
              opacity: anim && anim.stage === 0 ? 0.25 : sbVisible ? 1 : 0.35,
              animation: anim && anim.stage >= 1 ? 'multIn 0.12s ease-out, collideR 0.3s 0.12s ease-out' : 'none',
            }}
          >
            <span className="text-[17px] font-black tabular-nums leading-none" style={{ color: '#fff', fontWeight: 900, textShadow: '2px 2px 0 rgba(0,0,0,0.55)' }}>
              ×{sbMult}
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
          const st = jokerStateText(j, jokerState[j.uid || j.id] || 0)
          return (
            <div
              key={j.uid || j.id}
              className="relative w-10 h-12 rounded-[4px] flex items-center justify-center group shrink-0"
              title={`${j.name} — ${j.desc}${st ? ` · ${st.text}` : ''}`}
              style={{ background: j.face, border: `1px solid ${RARITY_BORDER[j.rarity || 'common']}`, boxShadow: `0 2px 6px ${BAL.goldSoft}` }}
            >
              <span className="text-sm leading-none">{j.glyph}</span>
              {st && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1 rounded-[2px] text-[8px] font-black leading-[11px] whitespace-nowrap" style={{ background: '#0d1510', border: `1px solid ${st.color}`, color: st.color }}>
                  {st.text}
                </span>
              )}
              <button
                onClick={() => sellJoker(j.uid || j.id)}
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
              <div key={t.uid || t.id} className="relative group shrink-0">
                <button
                  onClick={() => activateTarot(t)}
                  title={`${t.name} — ${t.desc}`}
                  className="w-10 h-12 rounded-[4px] flex items-center justify-center text-[14px]"
                  style={{
                    background: t.face,
                    border: activeTarot?.id === t.id ? `2px solid ${BAL.goldBright}` : '1px solid rgba(0,0,0,0.3)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                  }}
                >
                  {t.glyph}
                </button>
                <button
                  onClick={() => discardTarot(t.uid || t.id)}
                  title="出售"
                  className="absolute -top-1.5 -right-1.5 w-[15px] h-[15px] rounded-full text-[9px] leading-none flex items-center justify-center font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: BAL.mult, color: '#fff', border: '1px solid rgba(0,0,0,0.3)' }}
                >
                  ×
                </button>
              </div>
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

      <div className="relative flex-1 flex flex-col items-center overflow-y-auto p-3 gap-2.5" style={{ minHeight: 0 }}>
        {activeTarot && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-md w-full" style={{ background: 'rgba(232,184,76,0.12)', border: `1px solid ${BAL.goldDim}` }}>
            <span className="w-5 h-6 rounded-[2px] flex items-center justify-center text-[10px] shrink-0" style={{ background: activeTarot.face, border: '1px solid rgba(0,0,0,0.3)' }}>
              {activeTarot.glyph}
            </span>
            <span className="text-[12px] font-bold" style={{ color: BAL.gold }}>
              点击一张手牌应用 {activeTarot.name}
            </span>
            <button onClick={() => setActiveTarot(null)} title="退出选择,塔罗保留" className="ml-auto text-[11px] px-2.5 py-1 rounded shrink-0" style={{ border: `1px solid ${BAL.border}`, color: BAL.muted }}>
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
                  if (activeTarot) applyTarotAction(card.id)
                  else if (gameState === 'playing') toggleCard(card.id)
                }}
              />
            </div>
          ))}
          {hand.length === 0 && (
            <div className="text-xs py-6" style={{ color: BAL.dim }}>牌库耗尽</div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 shrink-0 w-full">
          <div className="flex items-stretch justify-center gap-1.5">
            <button
              onClick={playHand}
              disabled={selected.size === 0 || handsLeft <= 0 || gameState !== 'playing' || !!activeTarot || (boss?.effect === 'min-hand' && !bossMuted && selected.size < 4)}
              className="bal-play-btn w-[110px] flex items-start justify-center px-3 pt-1.5 pb-2 rounded-lg text-[13px] font-black transition-all duration-100"
              style={{
                background: selected.size > 0 && handsLeft > 0 && gameState === 'playing' && !activeTarot && !(boss?.effect === 'min-hand' && !bossMuted && selected.size < 4) ? BAL.blue : 'transparent',
                boxShadow: selected.size > 0 && handsLeft > 0 && gameState === 'playing' && !activeTarot && !(boss?.effect === 'min-hand' && !bossMuted && selected.size < 4) ? 'inset 0 0 12px rgba(255,255,255,0.15)' : 'none',
                border: `1px solid ${selected.size > 0 && handsLeft > 0 && gameState === 'playing' && !activeTarot && !(boss?.effect === 'min-hand' && !bossMuted && selected.size < 4) ? BAL.blue : BAL.border}`,
                color: selected.size > 0 && handsLeft > 0 && gameState === 'playing' && !activeTarot && !(boss?.effect === 'min-hand' && !bossMuted && selected.size < 4) ? '#fff' : BAL.gold,
                textShadow: selected.size > 0 && handsLeft > 0 && gameState === 'playing' && !activeTarot && !(boss?.effect === 'min-hand' && !bossMuted && selected.size < 4) ? '2px 2px 0 rgba(0,0,0,0.55)' : 'none',
                opacity: selected.size > 0 && handsLeft > 0 && gameState === 'playing' && !activeTarot && !(boss?.effect === 'min-hand' && !bossMuted && selected.size < 4) ? 1 : 0.35,
              }}
            >
              出牌 ({handsLeft})
            </button>
            <div className="flex flex-col items-center justify-center gap-0.5 px-0.5 py-0.5 rounded-lg shrink-0" style={{ border: '3px solid rgba(255,255,255,0.85)' }}>
              <button
                onClick={() => sortHand(sortMode)}
                disabled={hand.length === 0 || gameState !== 'playing' || !!activeTarot}
                className="px-1.5 rounded text-[12px] font-bold leading-none transition-colors"
                style={{ color: BAL.gold, opacity: hand.length > 0 && gameState === 'playing' && !activeTarot ? 1 : 0.35 }}
              >
                理牌
              </button>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => { setSortMode('rank'); sortHand('rank') }}
                  className="px-1.5 py-0.5 rounded text-[12px] font-bold transition-colors"
                  style={{ background: BAL.gold, color: '#fff' }}
                >
                  点数
                </button>
                <button
                  onClick={() => { setSortMode('suit'); sortHand('suit') }}
                  className="px-1.5 py-0.5 rounded text-[12px] font-bold transition-colors"
                  style={{ background: BAL.gold, color: '#fff' }}
                >
                  花色
                </button>
              </div>
            </div>
            <button
              onClick={discardHand}
              disabled={!canDiscard}
              className="w-[110px] flex items-start justify-center px-3 pt-1.5 pb-2 rounded-lg text-[13px] font-bold transition-colors"
              style={{
                background: canDiscard ? BAL.mult : 'transparent',
                boxShadow: canDiscard ? 'inset 0 0 12px rgba(255,255,255,0.15)' : 'none',
                border: `1px solid ${canDiscard ? BAL.mult : BAL.border}`,
                color: canDiscard ? '#fff' : BAL.gold,
                textShadow: canDiscard ? '2px 2px 0 rgba(0,0,0,0.55)' : 'none',
                opacity: canDiscard ? 1 : 0.35,
              }}
            >
              弃牌 ({discardsLeft})
            </button>
          </div>
          <div className="h-2" />
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
            <div className="flex items-center justify-between border-t mt-0.5 pt-0.5" style={{ borderColor: BAL.borderDim }}>
              <span className="text-[11px] font-bold tabular-nums" style={{ color: BAL.gold }}>💲{money}</span>
              <div className="flex items-center gap-1">
                <div className="w-3.5 h-5 rounded-[2px] relative overflow-hidden" style={{ background: '#1b3a5e', border: '1px solid rgba(255,255,255,0.4)' }}>
                  <div className="absolute inset-[2px] rounded-[1px]" style={{ border: '1px solid rgba(255,255,255,0.45)' }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rotate-45" style={{ border: '1px solid #ffd166' }} />
                  </div>
                </div>
                <span className="text-[10px] font-bold tabular-nums" style={{ color: BAL.muted }}>{deckRef.current.length}</span>
              </div>
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
        </div>
          {shopInfo && (
            <div className="px-3 py-1 text-[10px] shrink-0" style={{ color: BAL.muted }}>
              盲注奖励 +${shopInfo.reward} · 利息 +${shopInfo.interest}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {shopItems.map(item => {
              const canBuy = money >= item.cost && !(item.kind === 'joker' && jokers.length >= jokerSlots) && !(item.kind === 'tarot' && pendingTarots.length >= MAX_TAROTS)
              const itemBorder = item.kind === 'joker'
                ? RARITY_BORDER[JOKERS.find(x => x.id === item.id)?.rarity || 'common']
                : item.kind === 'pack' ? 'rgba(110,219,110,0.5)' : BAL.border
              return (
                <div
                  key={item.uid || `${item.kind}-${item.id}`}
                  onClick={() => buyItem(item)}
                  title={canBuy ? `购买 ${item.name}` : item.kind === 'joker' && jokers.length >= jokerSlots ? 'Joker 槽位已满' : item.kind === 'tarot' && pendingTarots.length >= MAX_TAROTS ? '塔罗槽位已满（最多 2 张）' : '金币不足'}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-md ${canBuy ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                  style={{ background: BAL.panel, border: `1px solid ${canBuy ? itemBorder : 'rgba(43,64,51,0.4)'}`, opacity: canBuy ? 1 : 0.55 }}
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
              disabled={!rerollFree && money < rerollCost(rerollCount)}
              className="px-3 py-1.5 rounded text-[12px] font-bold"
              style={{ border: `1px solid ${BAL.border}`, color: BAL.gold, opacity: rerollFree || money >= rerollCost(rerollCount) ? 1 : 0.4 }}
            >
              🔄 Reroll {rerollFree ? '免费' : `$${rerollCost(rerollCount)}`}
            </button>
            <div className="flex items-center">
              <span className="text-[22px] font-black tabular-nums leading-none mr-3" style={{ color: BAL.gold, textShadow: '2px 2px 0 rgba(0,0,0,0.5)' }}>💲{money}</span>
              <button onClick={() => { setScoreBoard(null); setGameState('playing') }} className="px-5 py-2 rounded text-[13px] font-black" style={{ background: BAL.gold, color: '#111' }}>
                ▶ 继续
              </button>
            </div>
          </div>
        </div>
      )}

      {openPack && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 p-4" style={{ background: 'rgba(5,9,6,0.97)' }}>
          <div className="text-[13px] font-black tracking-[0.25em]" style={{ color: BAL.gold }}>{PACKS[openPack.kind].name.toUpperCase()}</div>
          <div className="text-[10px]" style={{ color: BAL.muted }}>选择 1 张</div>
          <div className="flex gap-2 flex-wrap justify-center">
            {openPack.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => pickPackOption(opt)}
                className="shrink-0 flex flex-col items-center gap-1 p-2 rounded-md transition-transform hover:-translate-y-1"
                style={{ background: BAL.panel, border: `1px solid ${BAL.goldDim}` }}
              >
                {openPack.kind === 'standard' ? (
                  <div className="relative w-12 h-[66px] rounded-[4px]" style={{ background: (opt as Card).enh ? ENH_BG[(opt as Card).enh!] : BAL.white, border: '1px solid rgba(0,0,0,0.25)' }}>
                    <div className="absolute top-0.5 left-1 flex flex-col items-center leading-none">
                      <span className="text-[12px] font-bold" style={{ color: SUIT_INFO[(opt as Card).suit].color }}>{(opt as Card).rank}</span>
                      <span className="text-[11px]" style={{ color: SUIT_INFO[(opt as Card).suit].color }}>{SUIT_INFO[(opt as Card).suit].sym}</span>
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xl" style={{ color: SUIT_INFO[(opt as Card).suit].color }}>{SUIT_INFO[(opt as Card).suit].sym}</span>
                    </div>
                    {(opt as Card).enh && (
                      <div className="absolute inset-x-0 bottom-0 flex justify-center pb-0.5">
                        <span className="text-[13px] leading-none" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))' }}>{ENH_MARK[(opt as Card).enh!]}</span>
                      </div>
                    )}
                  </div>
                ) : openPack.kind === 'tarot' ? (
                  <div className="w-12 h-[66px] rounded-[4px] flex items-center justify-center text-xl" style={{ background: (opt as TarotDef).face, border: '1px solid rgba(0,0,0,0.3)' }}>
                    {(opt as TarotDef).glyph}
                  </div>
                ) : (
                  <div className="w-12 h-[66px] rounded-[4px] flex flex-col items-center justify-center gap-0.5" style={{ background: 'linear-gradient(160deg,#1a2b40,#0d1622)', border: '1px solid rgba(0,0,0,0.3)' }}>
                    <span className="text-xl leading-none">🪐</span>
                    <span className="text-[9px] font-bold" style={{ color: BAL.gold }}>{(opt as { hand: string }).hand}</span>
                  </div>
                )}
                <span className="text-[9px] truncate max-w-[60px]" style={{ color: BAL.muted }}>
                  {openPack.kind === 'standard'
                    ? `${(opt as Card).rank}${SUIT_INFO[(opt as Card).suit].sym}${(opt as Card).enh ? ENH_MARK[(opt as Card).enh!] : ''}`
                    : (opt as { name: string }).name}
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => setOpenPack(null)} className="px-4 py-1.5 rounded text-[11px] font-bold" style={{ border: `1px solid ${BAL.border}`, color: BAL.muted }}>
            放弃
          </button>
        </div>
      )}

      {gameState === 'lost' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20" style={{ background: 'rgba(9,14,11,0.9)' }}>
          <div className="text-base font-black tracking-widest" style={{ color: BAL.mult }}>GAME OVER</div>
          <div className="text-[11px]" style={{ color: BAL.muted }}>
            Ante {ante + 1} · 最高单手 {maxHand.toLocaleString()}
            {maxAnteRecord > ante + 1 && <span> · 历史 Ante {maxAnteRecord}</span>}
          </div>
          <button onClick={startGame} className="px-5 py-2 rounded text-[13px] font-black" style={{ background: BAL.gold, color: '#111' }}>
            再来一次
          </button>
        </div>
      )}
    </div>
  )
}
