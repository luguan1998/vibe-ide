import React, { useState, useEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import Game2048 from './Game2048'
import GameSandspiel from './GameSandspiel'
import GameBalatro from './GameBalatro'
import GameFruitNinja from './GameFruitNinja'
import GameVampire from './GameVampire'
import GameClimb from './GameClimb'
import HistoryView from './HistoryView'
import SkillView from './SkillView'

type GameId = 'menu' | 'history' | 'skills' | '2048' | 'sandspiel' | 'balatro' | 'fruitninja' | 'vampire' | 'climb'

interface GameLauncherProps {
  workspacePath: string | null
  onResumeClaudeHistory: (historySessionId: string, cwd: string, name: string, mode: 'tui' | 'gui') => void
  onResumeDshHistory?: (dshSessionId: string, cwd: string, name: string) => void
  historyNavNonce?: number
  onOpenFileFromExplorer?: (fullPath: string) => void
  onPreviewMarkdown?: (fullPath: string, fileName: string) => void
}

interface GameCard {
  id: Exclude<GameId, 'menu'>
  icon: React.ReactNode
  name: string
  desc: string
  duration?: string
}

const GAMES: GameCard[] = [
  { id: 'history', icon: <span className="text-2xl leading-none">📜</span>, name: 'Session History', desc: 'Browse & search Claude history' },
  { id: 'skills', icon: <span className="text-2xl leading-none">✨</span>, name: 'Skills', desc: 'Manage Claude & dsh skills' },
  { id: 'balatro', icon: <span className="text-2xl leading-none">🃏</span>, name: 'Balatro', desc: 'Poker roguelike — build hands to beat the ante' },
  { id: 'sandspiel', icon: <span className="text-2xl leading-none">🏖️</span>, name: 'Sandspiel', desc: 'Falling sand particle physics' },
  { id: '2048', icon: <span className="text-2xl leading-none">🧩</span>, name: '2048', desc: 'Slide tiles to merge them' },
  { id: 'fruitninja', icon: <span className="text-2xl leading-none">🍉</span>, name: 'Fruit Ninja', desc: 'Slice fruits with your swipe — dodge the bombs' },
  { id: 'vampire', icon: <span className="text-2xl leading-none">🧛</span>, name: 'Vampire Survivors', desc: 'Survive the night — auto-attack hordes, level up, last 6 minutes', duration: '6 min' },
  { id: 'climb', icon: <span className="text-2xl leading-none">⛏️</span>, name: 'Get Over It', desc: 'Hammer your way up the mountain — every fall hurts' },
]

export default function GameLauncher({ workspacePath, onResumeClaudeHistory, onResumeDshHistory, historyNavNonce, onOpenFileFromExplorer, onPreviewMarkdown }: GameLauncherProps) {
  const [currentGame, setCurrentGame] = useState<GameId>('menu')
  const lastHistoryNonce = useRef(0)
  useEffect(() => {
    if (historyNavNonce && historyNavNonce !== lastHistoryNonce.current) {
      lastHistoryNonce.current = historyNavNonce
      setCurrentGame('history')
    }
  }, [historyNavNonce])
  const { t } = useI18n()

  const launch = (id: GameId) => {
    setCurrentGame(id)
  }

  if (currentGame !== 'menu') {
    const back = () => setCurrentGame('menu')
    switch (currentGame) {
      case 'history': return <HistoryView onBack={back} workspacePath={workspacePath} onResumeClaudeHistory={onResumeClaudeHistory} onResumeDshHistory={onResumeDshHistory} />
      case 'skills': return <SkillView onBack={back} workspacePath={workspacePath} onOpenFile={onOpenFileFromExplorer ?? (() => {})} onPreviewFile={onPreviewMarkdown ? (p) => onPreviewMarkdown(p, p.split(/[\\/]/).pop() || p) : undefined} />
      case 'balatro': return <GameBalatro onBack={back} />
      case 'sandspiel': return <GameSandspiel onBack={back} />
      case '2048': return <Game2048 onBack={back} />
      case 'fruitninja': return <GameFruitNinja onBack={back} />
      case 'vampire': return <GameVampire onBack={back} />
      case 'climb': return <GameClimb onBack={back} />
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
