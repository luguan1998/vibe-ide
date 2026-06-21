import React, { useState, useEffect, useCallback, useRef } from 'react'

function createEmptyGrid(): number[][] {
  return Array.from({ length: 4 }, () => Array(4).fill(0))
}

function cloneGrid(g: number[][]): number[][] {
  return g.map(row => [...row])
}

function getEmptyCells(grid: number[][]): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = []
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (grid[r][c] === 0) cells.push({ row: r, col: c })
  return cells
}

function addRandomTile(grid: number[][]): { grid: number[][]; pos: { row: number; col: number } } {
  const empty = getEmptyCells(grid)
  if (empty.length === 0) return { grid, pos: { row: -1, col: -1 } }
  const { row, col } = empty[Math.floor(Math.random() * empty.length)]
  const val = Math.random() < 0.9 ? 2 : 4
  const newGrid = cloneGrid(grid)
  newGrid[row][col] = val
  return { grid: newGrid, pos: { row, col } }
}

function slideLine(line: number[]): { result: number[]; score: number } {
  const filtered = line.filter(v => v !== 0)
  const result: number[] = []
  let score = 0
  let i = 0
  while (i < filtered.length) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      result.push(filtered[i] * 2)
      score += filtered[i] * 2
      i += 2
    } else {
      result.push(filtered[i])
      i += 1
    }
  }
  while (result.length < 4) result.push(0)
  return { result, score }
}

function slideLeft(grid: number[][]): { grid: number[][]; score: number; moved: boolean } {
  let totalScore = 0
  let moved = false
  const newGrid = cloneGrid(grid)
  for (let r = 0; r < 4; r++) {
    const { result, score } = slideLine(grid[r])
    totalScore += score
    for (let c = 0; c < 4; c++) {
      newGrid[r][c] = result[c]
      if (result[c] !== grid[r][c]) moved = true
    }
  }
  return { grid: newGrid, score: totalScore, moved }
}

function slideRight(grid: number[][]): { grid: number[][]; score: number; moved: boolean } {
  const reversed = grid.map(row => [...row].reverse())
  const { grid: slid, score, moved } = slideLeft(reversed)
  return { grid: slid.map(row => [...row].reverse()), score, moved }
}

function transpose(grid: number[][]): number[][] {
  return grid[0].map((_, i) => grid.map(row => row[i]))
}

function slideUp(grid: number[][]): { grid: number[][]; score: number; moved: boolean } {
  const t = transpose(grid)
  const { grid: slid, score, moved } = slideLeft(t)
  return { grid: transpose(slid), score, moved }
}

function slideDown(grid: number[][]): { grid: number[][]; score: number; moved: boolean } {
  const t = transpose(grid)
  const { grid: slid, score, moved } = slideRight(t)
  return { grid: transpose(slid), score, moved }
}

function canMove(grid: number[][]): boolean {
  if (getEmptyCells(grid).length > 0) return true
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      if (c + 1 < 4 && grid[r][c] === grid[r][c + 1]) return true
      if (r + 1 < 4 && grid[r][c] === grid[r + 1][c]) return true
    }
  return false
}

function hasWon(grid: number[][]): boolean {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (grid[r][c] >= 2048) return true
  return false
}

type GameState = 'idle' | 'playing' | 'won' | 'over'

const TILE_COLORS: Record<number, { bg: string; text: string }> = {
  2: { bg: '#eee4da', text: '#776e65' },
  4: { bg: '#ede0c8', text: '#776e65' },
  8: { bg: '#f2b179', text: '#f9f6f2' },
  16: { bg: '#f59563', text: '#f9f6f2' },
  32: { bg: '#f67c5f', text: '#f9f6f2' },
  64: { bg: '#f65e3b', text: '#f9f6f2' },
  128: { bg: '#edcf72', text: '#f9f6f2' },
  256: { bg: '#edcc61', text: '#f9f6f2' },
  512: { bg: '#edc850', text: '#f9f6f2' },
  1024: { bg: '#edc53f', text: '#f9f6f2' },
  2048: { bg: '#edc22e', text: '#f9f6f2' },
}

export default function Game2048({ onBack }: { onBack?: () => void }) {
  const [grid, setGrid] = useState<number[][]>(createEmptyGrid)
  const [score, setScore] = useState(0)
  const [gameState, setGameState] = useState<GameState>('idle')
  const [popIdx, setPopIdx] = useState(-1)
  const gameStateRef = useRef<GameState>('idle')

  useEffect(() => { gameStateRef.current = gameState }, [gameState])

  const init = useCallback(() => {
    const { grid: g1 } = addRandomTile(createEmptyGrid())
    const { grid: g2, pos } = addRandomTile(g1)
    setGrid(g2)
    setScore(0)
    setPopIdx(pos.row * 4 + pos.col)
    setTimeout(() => setPopIdx(-1), 150)
    setGameState('playing')
  }, [])

  const slide = useCallback((dir: 'left' | 'right' | 'up' | 'down') => {
    if (gameStateRef.current !== 'playing') return
    const fns = { left: slideLeft, right: slideRight, up: slideUp, down: slideDown }
    const result = fns[dir](grid)
    if (!result.moved) return

    const { grid: newGrid, pos } = addRandomTile(result.grid)
    const newScore = score + result.score

    setGrid(newGrid)
    setScore(newScore)
    setPopIdx(pos.row * 4 + pos.col)
    setTimeout(() => setPopIdx(-1), 200)

    if (hasWon(newGrid)) {
      setGameState('won')
    } else if (!canMove(newGrid)) {
      setGameState('over')
    }
  }, [grid, score])

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (gameStateRef.current === 'idle') {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault()
          init()
        }
        return
      }
      if (gameStateRef.current === 'won' || gameStateRef.current === 'over') return
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); slide('left'); break
        case 'ArrowRight': e.preventDefault(); slide('right'); break
        case 'ArrowUp': e.preventDefault(); slide('up'); break
        case 'ArrowDown': e.preventDefault(); slide('down'); break
      }
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  }, [slide, init])

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none" tabIndex={-1}>
      <style>{`
        @keyframes pop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors" title="Back to menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-text-muted">
            <rect x="2" y="7" width="20" height="12" rx="2" />
            <circle cx="12" cy="13" r="1.5" />
            <circle cx="17" cy="10.5" r="1.5" />
            <circle cx="17" cy="15.5" r="1.5" />
            <circle cx="7" cy="10.5" r="1.5" />
            <circle cx="7" cy="15.5" r="1.5" />
          </svg>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">2048</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Score</div>
            <div className="text-ide-warning font-bold tabular-nums">{score}</div>
          </div>
        </div>
      </div>

      {/* Game area */}
      <div className="flex-1 flex items-center justify-center p-4 bg-ide-bg/40">
        <div className="relative w-full max-w-[260px] aspect-square">
          {/* Grid background */}
          <div className="absolute inset-0 grid grid-cols-4 gap-1.5 p-1.5 rounded-lg border border-ide-border/40" style={{ backgroundColor: 'rgba(var(--ide-border), 0.35)' }}>
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} className="rounded" style={{ backgroundColor: 'rgba(var(--ide-bg), 0.5)' }} />
            ))}
          </div>

          {/* Tiles */}
          <div className="absolute inset-0 grid grid-cols-4 gap-1.5 p-1.5 pointer-events-none">
            {grid.flat().map((val, i) => {
              const c = TILE_COLORS[val]
              const isPop = i === popIdx
              return (
                <div
                  key={i}
                  className={`rounded flex items-center justify-center font-bold select-none transition-colors duration-100 ${
                    val >= 1000 ? 'text-lg' : val >= 100 ? 'text-xl' : 'text-2xl'
                  } ${isPop ? 'animate-[pop_0.2s_ease-out]' : ''}`}
                  style={{
                    backgroundColor: c ? c.bg : 'transparent',
                    color: c ? c.text : 'transparent',
                    opacity: val ? 1 : 0,
                  }}
                >
                  {val || ''}
                </div>
              )
            })}
          </div>

          {/* Idle overlay */}
          {gameState === 'idle' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ide-bg/70 backdrop-blur-sm rounded-lg">
              <div className="text-2xl select-none">🎮</div>
              <div className="text-xs text-ide-text-muted/70">Use arrow keys to play</div>
              <button
                onClick={init}
                className="px-5 py-1.5 text-sm bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors font-medium"
              >
                Start
              </button>
            </div>
          )}

          {/* Win overlay */}
          {gameState === 'won' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ide-bg/70 backdrop-blur-sm rounded-lg">
              <div className="text-sm text-ide-success font-bold">🎉 You Win!</div>
              <div className="text-[11px] text-ide-text-muted">Score: {score}</div>
              <button
                onClick={init}
                className="px-4 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors"
              >
                New Game
              </button>
            </div>
          )}

          {/* Game over overlay */}
          {gameState === 'over' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ide-bg/70 backdrop-blur-sm rounded-lg">
              <div className="text-sm text-ide-danger font-bold">Game Over</div>
              <div className="text-[11px] text-ide-text-muted">Score: {score}</div>
              <button
                onClick={init}
                className="px-4 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
