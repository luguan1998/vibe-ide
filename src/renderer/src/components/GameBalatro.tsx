import React, { useState, useEffect, useCallback, useRef } from 'react'

type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'

interface Card {
  suit: Suit
  rank: Rank
  id: string
}

interface HandType {
  name: string
  chips: number
  mult: number
}

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const RANK_VALUES: Record<Rank, number> = {
  A: 14, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13,
}

const SUIT_SYMBOLS: Record<Suit, { sym: string; color: string }> = {
  hearts: { sym: '\u2665', color: '#ef4444' },
  diamonds: { sym: '\u2666', color: '#ef4444' },
  clubs: { sym: '\u2663', color: '#222' },
  spades: { sym: '\u2660', color: '#222' },
}

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
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
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
    const hasRoyal = ranks[4] === 14 && ranks[0] === 10
    return hasRoyal
      ? { name: 'Royal Flush', chips: 100, mult: 10 }
      : { name: 'Straight Flush', chips: 100, mult: 8 }
  }

  if (groups.length === 2 && groups[0].count === 4)
    return { name: 'Four of a Kind', chips: 60, mult: 7 }
  if (groups.length === 2 && groups[0].count === 3)
    return { name: 'Full House', chips: 40, mult: 4 }
  if (isFlush)
    return { name: 'Flush', chips: 35, mult: 4 }
  if (isStraight)
    return { name: 'Straight', chips: 30, mult: 4 }
  if (groups[0].count === 3)
    return { name: 'Three of a Kind', chips: 30, mult: 3 }
  if (groups.length === 3 && groups[0].count === 2 && groups[1].count === 2)
    return { name: 'Two Pair', chips: 20, mult: 2 }
  if (groups[0].count === 2)
    return { name: 'Pair', chips: 10, mult: 2 }
  return { name: 'High Card', chips: 5, mult: 1 }
}

function drawCardsFromDeck(deck: Card[], hand: Card[], count: number): { deck: Card[]; hand: Card[] } {
  const d = [...deck]
  const needed = Math.min(count, d.length)
  const drawn = d.splice(0, needed)
  return { deck: d, hand: [...hand, ...drawn] }
}

const ANTE_TARGETS = [100, 150, 250, 400, 600, 900, 1300, 2000]

export default function GameBalatro({ onBack }: { onBack?: () => void }) {
  const deckRef = useRef<Card[]>(shuffle(createDeck()))
  const [hand, setHand] = useState<Card[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [score, setScore] = useState(0)
  const [ante, setAnte] = useState(0)
  const [roundScore, setRoundScore] = useState(0)
  const [target, setTarget] = useState(ANTE_TARGETS[0])
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'won' | 'lost'>('playing')
  const [lastHand, setLastHand] = useState<HandType | null>(null)
  const [handsLeft, setHandsLeft] = useState(4)
  const [discardsLeft, setDiscardsLeft] = useState(3)
  const lastHandRef = useRef<HandType | null>(null)

  const drawTo = useCallback((currentHand: Card[], targetSize: number): Card[] => {
    const needed = targetSize - currentHand.length
    if (needed <= 0 || deckRef.current.length === 0) return currentHand
    const result = drawCardsFromDeck(deckRef.current, currentHand, needed)
    deckRef.current = result.deck
    return result.hand
  }, [])

  const startGame = useCallback(() => {
    deckRef.current = shuffle(createDeck())
    setHand(drawTo([], 8))
    setSelected(new Set())
    setScore(0)
    setAnte(0)
    setRoundScore(0)
    setTarget(ANTE_TARGETS[0])
    setHandsLeft(4)
    setDiscardsLeft(3)
    setLastHand(null)
    lastHandRef.current = null
    setGameState('playing')
  }, [drawTo])

  const toggleCard = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 5) next.add(id)
      return next
    })
  }, [])

  const playHand = useCallback(() => {
    if (selected.size === 0 || handsLeft <= 0 || gameState !== 'playing') return
    const playedCards = hand.filter(c => selected.has(c.id))
    const result = evaluateHand(playedCards)
    if (!result) return
    const total = result.chips * result.mult
    const newRoundScore = roundScore + total
    const newHandsLeft = handsLeft - 1

    lastHandRef.current = result
    setLastHand(result)

    const remaining = hand.filter(c => !selected.has(c.id))
    const refilled = drawTo(remaining, 8)
    setHand(refilled)
    setSelected(new Set())
    setRoundScore(newRoundScore)

    if (newRoundScore >= target) {
      const nextAnte = ante + 1
      if (nextAnte >= ANTE_TARGETS.length) {
        setScore(prev => prev + Math.floor(newRoundScore))
        setGameState('won')
        return
      }
      setScore(prev => prev + Math.floor(newRoundScore))
      setAnte(nextAnte)
      setTarget(ANTE_TARGETS[nextAnte])
      setRoundScore(0)
      setHandsLeft(4)
      setDiscardsLeft(3)
      const newDeck = shuffle(createDeck())
      deckRef.current = newDeck
      const freshHand = refilled.length > 0 ? [...refilled] : []
      const fullyRefilled = drawCardsFromDeck(newDeck, freshHand, 8 - freshHand.length)
      deckRef.current = fullyRefilled.deck
      setHand(fullyRefilled.hand)
    } else {
      setHandsLeft(newHandsLeft)
      if (newHandsLeft <= 0) {
        setGameState('lost')
        return
      }
    }
  }, [selected, hand, handsLeft, roundScore, target, ante, gameState, drawTo])

  const discardHand = useCallback(() => {
    if (selected.size === 0 || discardsLeft <= 0 || handsLeft <= 0 || gameState !== 'playing') return
    const kept = hand.filter(c => !selected.has(c.id))
    const refilled = drawTo(kept, 8)
    setHand(refilled)
    setSelected(new Set())
    setDiscardsLeft(prev => prev - 1)
  }, [selected, hand, discardsLeft, handsLeft, gameState, drawTo])

  useEffect(() => {
    if (gameState !== 'playing') return
    if (hand.length < 8 && deckRef.current.length > 0) {
      const refilled = drawTo(hand, 8)
      setHand(refilled)
    }
  }, [hand.length, gameState, drawTo])

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none select-none">
      <style>{`
        @keyframes scorePop {
          0% { transform: scale(0.5) translateY(10px); opacity: 0; }
          50% { transform: scale(1.2) translateY(-5px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes cardPop {
          0% { transform: scale(0.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">{'\uD83C\uDCCF'} Balatro</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Score</div>
            <div className="text-ide-warning font-bold tabular-nums">{score.toLocaleString()}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Ante</div>
            <div className="text-ide-text font-bold tabular-nums">{ante + 1} / {ANTE_TARGETS.length}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Hands</div>
            <div className="text-ide-text font-bold tabular-nums">{handsLeft}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Discards</div>
            <div className="text-ide-text font-bold tabular-nums">{discardsLeft}</div>
          </div>
        </div>
      </div>

      {/* Round progress */}
      <div className="px-4 py-2 bg-ide-hover/30 border-b border-ide-border shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Round Score</span>
          <span className="text-[10px] text-ide-text-muted/60">
            Target: <span className="text-ide-accent font-bold">{target.toLocaleString()}</span>
          </span>
        </div>
        <div className="h-2 bg-ide-bg rounded-full overflow-hidden border border-ide-border/30">
          <div
            className="h-full bg-gradient-to-r from-ide-accent to-ide-warning rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, (roundScore / target) * 100)}%` }}
          />
        </div>
        <div className="text-right mt-0.5">
          <span className="text-[11px] text-ide-text-muted tabular-nums">{roundScore.toLocaleString()}</span>
        </div>
      </div>

      {/* Hand result */}
      {lastHand && (
        <div className="px-4 py-1.5 bg-ide-accent/10 border-b border-ide-accent/20 shrink-0 animate-[scorePop_0.3s_ease-out]">
          <div className="flex items-center justify-center gap-3">
            <span className="text-xs font-bold text-ide-accent">{lastHand.name}</span>
            <span className="text-xs text-ide-text-muted/70">
              {lastHand.chips} chips × {lastHand.mult} mult
            </span>
            <span className="text-xs font-bold text-ide-warning">
              +{(lastHand.chips * lastHand.mult).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center overflow-y-auto p-4 bg-ide-bg/40 gap-3" style={{ minHeight: 0 }}>
        {/* Deck info */}
        <div className="text-[10px] text-ide-text-muted/40 shrink-0">
          Deck: {deckRef.current.length} cards remaining
        </div>

        {/* Cards */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {hand.map((card, i) => {
            const isSelected = selected.has(card.id)
            const s = SUIT_SYMBOLS[card.suit]
            return (
              <button
                key={card.id}
                onClick={() => gameState === 'playing' && toggleCard(card.id)}
                className="relative w-14 h-20 rounded-lg border-2 transition-all duration-150 focus:outline-none cursor-pointer select-none shrink-0"
                style={{
                  backgroundColor: '#fff',
                  borderColor: isSelected ? 'rgb(var(--ide-accent))' : 'rgba(var(--ide-border), 0.5)',
                  transform: isSelected ? 'translateY(-12px)' : 'translateY(0)',
                  boxShadow: isSelected
                    ? '0 8px 24px rgba(var(--ide-accent), 0.3)'
                    : '0 2px 8px rgba(0,0,0,0.2)',
                  animation: gameState === 'playing' ? `cardPop 0.2s ease-out ${i * 0.03}s both` : undefined,
                }}
                disabled={gameState !== 'playing'}
              >
                <div className="absolute top-0.5 left-1 flex flex-col items-center leading-none">
                  <span className="text-[10px] font-bold" style={{ color: s.color }}>{card.rank}</span>
                  <span className="text-[9px]" style={{ color: s.color }}>{s.sym}</span>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg" style={{ color: s.color }}>{s.sym}</span>
                </div>
                <div className="absolute bottom-0.5 right-1 flex flex-col items-center leading-none rotate-180">
                  <span className="text-[10px] font-bold" style={{ color: s.color }}>{card.rank}</span>
                  <span className="text-[9px]" style={{ color: s.color }}>{s.sym}</span>
                </div>
              </button>
            )
          })}
          {hand.length === 0 && gameState === 'playing' && deckRef.current.length === 0 && (
            <div className="text-sm text-ide-text-muted/50 italic">No cards left in deck</div>
          )}
          {hand.length === 0 && gameState === 'playing' && deckRef.current.length > 0 && (
            <div className="text-sm text-ide-text-muted/50 italic">Drawing cards...</div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={playHand}
            disabled={selected.size === 0 || handsLeft <= 0 || gameState !== 'playing'}
            className="px-5 py-1.5 text-sm bg-ide-accent hover:bg-ide-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
          >
            Play Hand ({handsLeft})
          </button>
          <button
            onClick={discardHand}
            disabled={selected.size === 0 || discardsLeft <= 0 || gameState !== 'playing'}
            className="px-5 py-1.5 text-sm bg-ide-hover hover:bg-ide-border disabled:opacity-30 disabled:cursor-not-allowed text-ide-text-muted rounded-lg transition-colors font-medium"
          >
            Discard ({discardsLeft})
          </button>
          <div className="text-[10px] text-ide-text-muted/40 ml-2">
            Select up to 5 cards
          </div>
        </div>
      </div>

      {/* Win overlay */}
      {gameState === 'won' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ide-bg/70 backdrop-blur-sm z-10">
          <div className="text-2xl">{'\uD83C\uDFC6'}</div>
          <div className="text-sm text-ide-success font-bold">You Win!</div>
          <div className="text-[11px] text-ide-text-muted">Final Score: {score.toLocaleString()}</div>
          <button onClick={startGame}
            className="px-4 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors"
          >
            New Game
          </button>
        </div>
      )}

      {/* Lose overlay */}
      {gameState === 'lost' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ide-bg/70 backdrop-blur-sm z-10">
          <div className="text-sm text-ide-danger font-bold">Game Over</div>
          <div className="text-[11px] text-ide-text-muted">Reached Ante {ante + 1} — Score: {score.toLocaleString()}</div>
          <button onClick={startGame}
            className="px-4 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}
