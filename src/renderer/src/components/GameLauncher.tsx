import React, { useState, useEffect } from 'react'
import { FOCUS_GAME_DRAFT } from './VibeProgramer'
import { FOCUS_MUJICA } from './GameMujica'
import { useMujica } from '../mujicaStore'
import MujicaConfig from './MujicaConfig'
import mujicaIcon from '@renderer/assets/mujica.png?inline'
import Game2048 from './Game2048'
import GameSandspiel from './GameSandspiel'
import GameBalatro from './GameBalatro'
import VibeProgramer from './VibeProgramer'

type GameId = 'menu' | '2048' | 'sandspiel' | 'balatro' | 'draft' | 'mujica'

interface GameCard {
  id: Exclude<GameId, 'menu'>
  icon: React.ReactNode
  name: string
  desc: string
}

const GAMES: GameCard[] = [
  { id: 'mujica', icon: <img src={mujicaIcon} alt="mujica" className="w-7 h-7 object-contain rounded" />, name: 'mujica', desc: 'Form a band of Claude agents — conduct them in parallel' },
  { id: 'balatro', icon: <span className="text-2xl leading-none">🃏</span>, name: 'Balatro', desc: 'Poker roguelike — build hands to beat the ante' },
  { id: 'sandspiel', icon: <span className="text-2xl leading-none">🏖️</span>, name: 'Sandspiel', desc: 'Falling sand particle physics' },
  { id: '2048', icon: <span className="text-2xl leading-none">🧩</span>, name: '2048', desc: 'Slide tiles to merge them' },
  { id: 'draft', icon: <span className="text-2xl leading-none">📝</span>, name: 'vibe programer', desc: 'Prompt scratchpad — chain into a pipeline command' },
]

export default function GameLauncher() {
  const [currentGame, setCurrentGame] = useState<GameId>('menu')
  const mujicaActive = useMujica().active

  useEffect(() => {
    const handler = () => setCurrentGame('draft')
    window.addEventListener(FOCUS_GAME_DRAFT, handler)
    return () => window.removeEventListener(FOCUS_GAME_DRAFT, handler)
  }, [])

  // When mujica is the active center view, this tab becomes its config panel.
  if (mujicaActive) {
    return <MujicaConfig />
  }

  const launch = (id: GameId) => {
    // mujica lives in the center (a centerView), not inside this narrow tab.
    // Dispatch an event App.tsx listens for → switches the center to the canvas
    // and flips mujicaStore.active so this tab shows MujicaConfig.
    if (id === 'mujica') {
      window.dispatchEvent(new CustomEvent(FOCUS_MUJICA))
      return
    }
    setCurrentGame(id)
  }

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
        <span className="text-xs font-bold text-ide-text-muted uppercase tracking-wider">NGA</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {GAMES.map(game => (
          <button
            key={game.id}
            onClick={() => launch(game.id)}
            className="w-full flex items-center gap-3 p-3 rounded-lg bg-ide-sidebar border border-ide-border hover:border-ide-accent/50 hover:bg-ide-hover transition-colors text-left group"
          >
            <div className="shrink-0 w-7 h-7 flex items-center justify-center">{game.icon}</div>
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
