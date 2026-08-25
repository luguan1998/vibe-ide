import React, { useState, useEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import { FOCUS_MUJICA } from './GameMujica'
import { useMujica } from '../mujicaStore'
import MujicaConfig from './MujicaConfig'
import mujicaIcon from '@renderer/assets/mujica.png?inline'
import Game2048 from './Game2048'
import GameSandspiel from './GameSandspiel'
import GameBalatro from './GameBalatro'
import GameFruitNinja from './GameFruitNinja'
import GameVampire from './GameVampire'
import HistoryView from './HistoryView'

type GameId = 'menu' | 'history' | '2048' | 'sandspiel' | 'balatro' | 'mujica' | 'fruitninja' | 'vampire'

interface GameLauncherProps {
  workspacePath: string | null
  onResumeClaudeHistory: (historySessionId: string, cwd: string, name: string, mode: 'tui' | 'gui') => void
  onResumeDshHistory?: (dshSessionId: string, cwd: string, name: string) => void
  historyNavNonce?: number
}

interface GameCard {
  id: Exclude<GameId, 'menu'>
  icon: React.ReactNode
  name: string
  desc: string
  duration?: string
}

const VAMPIRE_ICON_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="vsCape" x1="24" y1="12" x2="24" y2="46" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#d32f2f"/>
      <stop offset="0.55" stop-color="#8e1a1a"/>
      <stop offset="1" stop-color="#3f0a0a"/>
    </linearGradient>
    <linearGradient id="vsHat" x1="24" y1="4" x2="24" y2="24" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5e4490"/>
      <stop offset="0.45" stop-color="#352461"/>
      <stop offset="1" stop-color="#17102f"/>
    </linearGradient>
    <linearGradient id="vsGem" x1="21.5" y1="41" x2="26.5" y2="46.5" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f3e5f5"/>
      <stop offset="0.45" stop-color="#ab47bc"/>
      <stop offset="1" stop-color="#6a1b9a"/>
    </linearGradient>
  </defs>
  <path d="M24 11.5c-6.2 1.5-11.2 5.3-13.2 10.3-1.8 5-2.1 10.8-2 16.2l-2.6 8.5h10.3l3.5-5.3 3.5 5.3h1l3.5-5.3 3.5 5.3h10.3l-2.6-8.5c.1-5.4-.2-11.2-2-16.2-2-5-7-8.8-13.2-10.3z" fill="url(#vsCape)" stroke="#4a0e0e" stroke-width="0.9"/>
  <path d="M16.6 27.6L10.8 26l3.4 6.2z" fill="#f2ddc5" stroke="#c9a986" stroke-width="0.5"/>
  <path d="M31.4 27.6l5.8-1.6-3.4 6.2z" fill="#f2ddc5" stroke="#c9a986" stroke-width="0.5"/>
  <ellipse cx="24" cy="30.8" rx="8.4" ry="9" fill="#f2ddc5" stroke="#c9a986" stroke-width="0.5"/>
  <path d="M10.5 22.8C13 12.2 17.8 8 24 5.5C30.2 8 35 12.2 37.5 22.8A13.5 3.2 0 0 0 10.5 22.8Z" fill="url(#vsHat)" stroke="#0c0720" stroke-width="0.9"/>
  <path d="M14.4 19C16.6 12.4 20.2 8.4 23.6 6.5c-3.2 3.9-6 8.8-7.4 12.7z" fill="#cfc6ea" opacity="0.3"/>
  <ellipse cx="24" cy="22.8" rx="13.5" ry="3.2" fill="#141032" stroke="#0c0720" stroke-width="0.9"/>
  <path d="M13 21A11 2.6 0 0 0 35 21" stroke="#8f7bc4" stroke-width="1.2" fill="none" opacity="0.5"/>
  <path d="M24 5.3v1.4" stroke="#ffd54f" stroke-width="0.8" stroke-linecap="round"/>
  <circle cx="24" cy="7.2" r="1.4" fill="#ffd54f" stroke="#a96f00" stroke-width="0.5"/>
  <ellipse cx="20.4" cy="31.6" rx="2.6" ry="2.9" fill="rgba(255,23,68,0.45)"/>
  <ellipse cx="27.6" cy="31.6" rx="2.6" ry="2.9" fill="rgba(255,23,68,0.45)"/>
  <path d="M18.2 28.1Q20.4 29.5 22.4 28.8" stroke="#513b30" stroke-width="1" fill="none" stroke-linecap="round"/>
  <path d="M25.6 28.8Q27.6 29.5 29.8 28.1" stroke="#513b30" stroke-width="1" fill="none" stroke-linecap="round"/>
  <ellipse cx="20.4" cy="31.6" rx="1.4" ry="2.8" transform="rotate(14 20.4 31.6)" fill="#ff1744" stroke="#8e1010" stroke-width="0.4"/>
  <ellipse cx="27.6" cy="31.6" rx="1.4" ry="2.8" transform="rotate(-14 27.6 31.6)" fill="#ff1744" stroke="#8e1010" stroke-width="0.4"/>
  <circle cx="20.1" cy="30.8" r="0.5" fill="#fff"/>
  <circle cx="27.9" cy="30.8" r="0.5" fill="#fff"/>
  <path d="M24 31.8v2.4" stroke="#a97a5a" stroke-width="0.7" stroke-linecap="round"/>
  <path d="M21.3 35.6Q24 37.4 26.7 35.6" stroke="#7a4a32" stroke-width="0.9" fill="none" stroke-linecap="round"/>
  <path d="M22.2 35.2L22.7 37.6 23.4 35.1Z" fill="#fff" stroke="#d5cfc6" stroke-width="0.4"/>
  <path d="M24.6 35.1L25.3 37.6 25.8 35.2Z" fill="#fff" stroke="#d5cfc6" stroke-width="0.4"/>
  <ellipse cx="24" cy="44" rx="4.6" ry="3.4" fill="rgba(186,104,200,0.4)"/>
  <rect x="21.3" y="41.3" width="5.4" height="5.4" rx="1.1" transform="rotate(45 24 44)" fill="url(#vsGem)" stroke="#4a148c" stroke-width="0.5"/>
  <rect x="22.9" y="42.4" width="1.1" height="1.1" transform="rotate(45 24 44)" fill="#ffffff" opacity="0.9"/>
</svg>`)

const GAMES: GameCard[] = [
  { id: 'history', icon: <span className="text-2xl leading-none">📜</span>, name: 'Session History', desc: 'Browse & search Claude history' },
  { id: 'mujica', icon: <img src={mujicaIcon} alt="Mujica" className="w-7 h-7 object-contain rounded" />, name: 'Mujica', desc: 'Form a band of Claude agents — conduct them in parallel' },
  { id: 'balatro', icon: <span className="text-2xl leading-none">🃏</span>, name: 'Balatro', desc: 'Poker roguelike — build hands to beat the ante' },
  { id: 'sandspiel', icon: <span className="text-2xl leading-none">🏖️</span>, name: 'Sandspiel', desc: 'Falling sand particle physics' },
  { id: '2048', icon: <span className="text-2xl leading-none">🧩</span>, name: '2048', desc: 'Slide tiles to merge them' },
  { id: 'fruitninja', icon: <span className="text-2xl leading-none">🍉</span>, name: 'Fruit Ninja', desc: 'Slice fruits with your swipe — dodge the bombs' },
  { id: 'vampire', icon: <img src={VAMPIRE_ICON_URL} alt="Vampire Survivors" className="w-6 h-6" />, name: 'Vampire Survivors', desc: 'Survive the night — auto-attack hordes, level up, last 6 minutes', duration: '6 min' },
]

export default function GameLauncher({ workspacePath, onResumeClaudeHistory, onResumeDshHistory, historyNavNonce }: GameLauncherProps) {
  const [currentGame, setCurrentGame] = useState<GameId>('menu')
  const lastHistoryNonce = useRef(0)
  useEffect(() => {
    if (historyNavNonce && historyNavNonce !== lastHistoryNonce.current) {
      lastHistoryNonce.current = historyNavNonce
      setCurrentGame('history')
    }
  }, [historyNavNonce])
  const { t } = useI18n()
  const mujicaActive = useMujica().active

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
      case 'history': return <HistoryView onBack={back} workspacePath={workspacePath} onResumeClaudeHistory={onResumeClaudeHistory} onResumeDshHistory={onResumeDshHistory} />
      case 'balatro': return <GameBalatro onBack={back} />
      case 'sandspiel': return <GameSandspiel onBack={back} />
      case '2048': return <Game2048 onBack={back} />
      case 'fruitninja': return <GameFruitNinja onBack={back} />
      case 'vampire': return <GameVampire onBack={back} />
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none">
      <div className="h-9 pl-5 pr-4 flex items-center border-b border-ide-border shrink-0 gap-2 acrylic-titlebar-clean">
        <span className="text-sm text-ide-text font-medium truncate">NGA</span>
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
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-ide-text group-hover:text-ide-accent transition-colors">{t(game.name)}</div>
                {game.duration && <span className="text-[10px] px-1.5 py-0.5 rounded bg-ide-hover text-ide-text-muted whitespace-nowrap">{game.duration}</span>}
              </div>
              <div className="text-xs text-ide-text-muted truncate">{t(game.desc)}</div>
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
