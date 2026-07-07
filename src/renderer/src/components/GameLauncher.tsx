import React, { useState, useEffect } from 'react'
import { FOCUS_GAME_DRAFT } from './VibeProgramer'
import Game2048 from './Game2048'
import GameSandspiel from './GameSandspiel'
import GameBalatro from './GameBalatro'
import VibeProgramer from './VibeProgramer'

type GameId = 'menu' | '2048' | 'sandspiel' | 'balatro' | 'draft'

interface GameCard {
  id: Exclude<GameId, 'menu'>
  icon: string
  name: string
  desc: string
}

const GAMES: GameCard[] = [
  { id: 'balatro', icon: '🃏', name: 'Balatro', desc: 'Poker roguelike — build hands to beat the ante' },
  { id: 'sandspiel', icon: '🏖️', name: 'Sandspiel', desc: 'Falling sand particle physics' },
  { id: '2048', icon: '🧩', name: '2048', desc: 'Slide tiles to merge them' },
  { id: 'draft', icon: '📝', name: 'vibe programer', desc: 'Prompt scratchpad — chain into a pipeline command' },
]

export default function GameLauncher() {
  const [currentGame, setCurrentGame] = useState<GameId>('menu')

  useEffect(() => {
    const handler = () => setCurrentGame('draft')
    window.addEventListener(FOCUS_GAME_DRAFT, handler)
    return () => window.removeEventListener(FOCUS_GAME_DRAFT, handler)
  }, [])

  if (currentGame !== 'menu') {
    const back = () => setCurrentGame('menu')
    switch (currentGame) {
      case 'balatro': return <GameBalatro onBack={back} />
      case 'sandspiel': return <GameSandspiel onBack={back} />
      case '2048': return <Game2048 onBack={back} />
      case 'draft': return <VibeProgramer onBack={back} />
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none">
      <div className="px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none">
        <span className="text-xs font-bold text-ide-text-muted uppercase tracking-wider">Games</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {GAMES.map(game => (
          <button
            key={game.id}
            onClick={() => setCurrentGame(game.id)}
            className="w-full flex items-center gap-3 p-3 rounded-lg bg-ide-sidebar border border-ide-border hover:border-ide-accent/50 hover:bg-ide-hover transition-colors text-left group"
          >
            <span className="text-2xl">{game.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ide-text group-hover:text-ide-accent transition-colors">{game.name}</div>
              <div className="text-xs text-ide-text-muted truncate">{game.desc}</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-text-muted/50">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}
