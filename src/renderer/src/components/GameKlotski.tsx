import React, { useState, useEffect, useCallback, useRef } from 'react'

const ROWS = 5
const COLS = 4
const GAP = 3

interface Piece {
  id: string
  name: string
  type: 'king' | 'h' | 'v' | 's'
  row: number
  col: number
  width: number
  height: number
}

const INITIAL_PIECES: Piece[] = [
  { id: 'caocao', name: '曹操', type: 'king', row: 0, col: 0, width: 2, height: 2 },
  { id: 'guanyu', name: '关羽', type: 'h', row: 0, col: 2, width: 2, height: 1 },
  { id: 'zhangfei', name: '张飞', type: 'v', row: 2, col: 0, width: 1, height: 2 },
  { id: 'zhaoyun', name: '赵云', type: 'v', row: 2, col: 3, width: 1, height: 2 },
  { id: 'machao', name: '马超', type: 'v', row: 3, col: 1, width: 1, height: 2 },
  { id: 'huangzhong', name: '黄忠', type: 'v', row: 3, col: 2, width: 1, height: 2 },
  { id: 's1', name: '卒', type: 's', row: 1, col: 2, width: 1, height: 1 },
  { id: 's2', name: '卒', type: 's', row: 1, col: 3, width: 1, height: 1 },
  { id: 's3', name: '卒', type: 's', row: 4, col: 0, width: 1, height: 1 },
  { id: 's4', name: '卒', type: 's', row: 4, col: 3, width: 1, height: 1 },
]

function clonePieces(pieces: Piece[]): Piece[] {
  return pieces.map(p => ({ ...p }))
}

function buildGrid(pieces: Piece[]): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null))
  for (const p of pieces) {
    for (let r = p.row; r < p.row + p.height; r++) {
      for (let c = p.col; c < p.col + p.width; c++) {
        grid[r][c] = p.id
      }
    }
  }
  return grid
}

function canMovePiece(pieces: Piece[], id: string, dr: number, dc: number): boolean {
  const piece = pieces.find(p => p.id === id)
  if (!piece) return false
  const newRow = piece.row + dr
  const newCol = piece.col + dc
  if (newRow < 0 || newRow + piece.height > ROWS) return false
  if (newCol < 0 || newCol + piece.width > COLS) return false
  const grid = buildGrid(pieces)
  for (let r = newRow; r < newRow + piece.height; r++) {
    for (let c = newCol; c < newCol + piece.width; c++) {
      if (grid[r][c] !== null && grid[r][c] !== piece.id) return false
    }
  }
  return true
}

type Dir = 'up' | 'down' | 'left' | 'right'

const DIR_DELTA: Record<Dir, [number, number]> = {
  up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1],
}

function getAvailableMoves(pieces: Piece[], id: string): Dir[] {
  const moves: Dir[] = []
  for (const dir of ['up', 'down', 'left', 'right'] as Dir[]) {
    const [dr, dc] = DIR_DELTA[dir]
    if (canMovePiece(pieces, id, dr, dc)) moves.push(dir)
  }
  return moves
}

const PIECE_COLORS: Record<string, { bg: string; border: string }> = {
  king: { bg: '#c0392b', border: '#e74c3c' },
  h: { bg: '#1e8449', border: '#27ae60' },
  v: { bg: '#2471a3', border: '#3498db' },
  s: { bg: '#616a6b', border: '#95a5a6' },
}

export default function GameKlotski({ onBack }: { onBack?: () => void }) {
  const [pieces, setPieces] = useState<Piece[]>(() => clonePieces(INITIAL_PIECES))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [moves, setMoves] = useState(0)
  const [won, setWon] = useState(false)
  const [history, setHistory] = useState<Piece[][]>([])
  const boardRef = useRef<HTMLDivElement>(null)
  const [cellSize, setCellSize] = useState(0)
  const wonRef = useRef(won)
  wonRef.current = won

  useEffect(() => {
    const update = () => {
      if (boardRef.current) {
        const w = boardRef.current.offsetWidth
        setCellSize(Math.floor((w - GAP * (COLS + 1)) / COLS))
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const caocao = pieces.find(p => p.id === 'caocao')
    if (caocao && caocao.row === 3 && caocao.col === 1) {
      setWon(true)
      setSelectedId(null)
    }
  }, [pieces])

  const clickPiece = useCallback((id: string) => {
    if (wonRef.current) return
    setSelectedId(prev => (prev === id ? null : id))
  }, [])

  const movePiece = useCallback((dir: Dir) => {
    if (wonRef.current || !selectedId) return
    const [dr, dc] = DIR_DELTA[dir]
    if (!canMovePiece(pieces, selectedId, dr, dc)) return
    setHistory(prev => [...prev, clonePieces(pieces)])
    setPieces(prev =>
      prev.map(p =>
        p.id === selectedId ? { ...p, row: p.row + dr, col: p.col + dc } : p
      )
    )
    setMoves(m => m + 1)
  }, [pieces, selectedId])

  const undo = useCallback(() => {
    if (history.length === 0) return
    setHistory(prev => {
      const last = prev[prev.length - 1]
      setPieces(clonePieces(last))
      return prev.slice(0, -1)
    })
    setMoves(m => Math.max(0, m - 1))
    setWon(false)
  }, [history])

  const reset = useCallback(() => {
    setPieces(clonePieces(INITIAL_PIECES))
    setSelectedId(null)
    setMoves(0)
    setWon(false)
    setHistory([])
  }, [])

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        switch (e.key) {
          case 'ArrowUp': movePiece('up'); break
          case 'ArrowDown': movePiece('down'); break
          case 'ArrowLeft': movePiece('left'); break
          case 'ArrowRight': movePiece('right'); break
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  }, [movePiece, undo])

  const boardW = cellSize > 0 ? cellSize * COLS + GAP * (COLS + 1) : 0
  const boardH = cellSize > 0 ? cellSize * ROWS + GAP * (ROWS + 1) : 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none" tabIndex={-1}>
      <style>{`
        @keyframes klotski-win {
          0% { transform: scale(1); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

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
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="17" cy="9" r="1.5" />
            <circle cx="17" cy="15" r="1.5" />
            <circle cx="7" cy="9" r="1.5" />
            <circle cx="7" cy="15" r="1.5" />
          </svg>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">华容道</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={undo}
            disabled={history.length === 0}
            className="text-ide-text-muted hover:text-ide-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            onClick={reset}
            className="text-ide-text-muted hover:text-ide-text transition-colors"
            title="Reset"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
          <div className="text-center">
            <div className="text-[10px] text-ide-text-muted/60 uppercase tracking-wider">Moves</div>
            <div className="text-ide-warning font-bold tabular-nums">{moves}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 bg-ide-bg/40">
        <div
          ref={boardRef}
          className="relative shrink-0"
          style={{
            width: '100%',
            maxWidth: 280,
            aspectRatio: '4 / 5',
          }}
        >
          {cellSize > 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="relative rounded-lg"
                style={{
                  width: boardW,
                  height: boardH,
                  backgroundColor: '#1a1a2e',
                  border: '2px solid #8B4513',
                  boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5), 0 0 10px rgba(139,69,19,0.3)',
                }}
              >
                {/* Grid cells background */}
                {Array.from({ length: ROWS }).map((_, r) =>
                  Array.from({ length: COLS }).map((_, c) => (
                    <div
                      key={`cell-${r}-${c}`}
                      className="absolute rounded"
                      style={{
                        left: GAP + c * (cellSize + GAP),
                        top: GAP + r * (cellSize + GAP),
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: 'rgba(255,255,255,0.03)',
                      }}
                    />
                  ))
                )}

                {/* Pieces */}
                {pieces.map(p => {
                  const cs = PIECE_COLORS[p.type]
                  const isSel = p.id === selectedId
                  const avail = isSel ? getAvailableMoves(pieces, p.id) : []
                  return (
                    <React.Fragment key={p.id}>
                      <div
                        onClick={() => clickPiece(p.id)}
                        className="absolute rounded flex flex-col items-center justify-center cursor-pointer select-none font-bold text-white transition-all duration-100 select-none"
                        style={{
                          left: GAP + p.col * (cellSize + GAP),
                          top: GAP + p.row * (cellSize + GAP),
                          width: p.width * cellSize + (p.width - 1) * GAP,
                          height: p.height * cellSize + (p.height - 1) * GAP,
                          backgroundColor: cs.bg,
                          border: `2px solid ${cs.border}`,
                          boxShadow: isSel
                            ? '0 0 0 2px #f1c40f, 0 0 12px rgba(241,196,15,0.6)'
                            : '0 2px 4px rgba(0,0,0,0.3)',
                          zIndex: isSel ? 10 : 1,
                          fontSize: p.type === 'king' ? 14 : p.type === 's' ? 10 : 12,
                        }}
                      >
                        {p.name}
                        {p.type === 'king' && (
                          <span style={{ fontSize: 8, opacity: 0.7, marginTop: 1 }}>丞相</span>
                        )}
                      </div>
                      {avail.map(dir => {
                        const [dr, dc] = DIR_DELTA[dir]
                        const cx = GAP + (p.col + dc) * (cellSize + GAP) + (p.width * cellSize + (p.width - 1) * GAP) / 2 - 5
                        const cy = GAP + (p.row + dr) * (cellSize + GAP) + (p.height * cellSize + (p.height - 1) * GAP) / 2 - 5
                        return (
                          <div
                            key={dir}
                            onClick={() => movePiece(dir)}
                            className="absolute rounded-full cursor-pointer transition-colors"
                            style={{
                              left: cx,
                              top: cy,
                              width: 10,
                              height: 10,
                              backgroundColor: 'rgba(46,204,113,0.85)',
                              boxShadow: '0 0 6px rgba(46,204,113,0.5)',
                              zIndex: 5,
                            }}
                          />
                        )
                      })}
                    </React.Fragment>
                  )
                })}

                {/* Exit indicator */}
                <div
                  className="absolute"
                  style={{
                    left: GAP + 1 * (cellSize + GAP),
                    top: boardH - 3,
                    width: 2 * cellSize + GAP,
                    height: 4,
                    backgroundColor: '#f1c40f',
                    borderRadius: '0 0 2px 2px',
                    opacity: won ? 0 : 0.6,
                    boxShadow: '0 0 6px rgba(241,196,15,0.4)',
                  }}
                >
                  <div
                    className="absolute"
                    style={{
                      left: '50%',
                      top: -14,
                      transform: 'translateX(-50%)',
                      fontSize: 8,
                      color: '#f1c40f',
                      whiteSpace: 'nowrap',
                      opacity: 0.7,
                    }}
                  >
                    ▼ 出口
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Win overlay */}
          {won && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ide-bg/70 backdrop-blur-sm rounded-lg z-20">
              <div className="text-center animate-[klotski-win_0.5s_ease-out]">
                <div className="text-3xl mb-1">🏆</div>
                <div className="text-sm text-ide-success font-bold">曹操出关！</div>
                <div className="text-[11px] text-ide-text-muted mt-1">{moves} 步完成</div>
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={reset}
                  className="px-4 py-1 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded-lg transition-colors"
                >
                  再来一局
                </button>
                <button
                  onClick={undo}
                  disabled={history.length === 0}
                  className="px-4 py-1 text-xs bg-ide-hover hover:bg-ide-hover/80 text-ide-text rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  悔一步
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
