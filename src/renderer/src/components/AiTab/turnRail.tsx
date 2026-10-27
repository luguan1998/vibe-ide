import React, { useState, useCallback, useEffect, useRef } from 'react'

interface TurnRailProps {
  turns: { turnIdx: number; content: string }[]
  scrollEl: HTMLDivElement | null
  contentW: number
  onPick: (turnIdx: number) => void
}

const RAIL_TEXT_MAX = 60
// 线段最大 16px + right-3(12px) + 呼吸缝；内容列右缘到这个距离以内就收起，
// 避免窄面板时压在正文上
const RAIL_GUTTER_MIN = 34

// 右侧轮次导航：每轮一行「文案 + 线段」。收起时只留线段，hover 展开文案。
// 行高恒定 → 两种状态线段位置不跳。高亮 = 离视口垂直中心最近的那一轮，
// 滚动状态留在本组件内，避免每个 scroll 事件重渲染整个 AiTab。
const TurnRail = React.memo(function TurnRail({ turns, scrollEl, contentW, onPick }: TurnRailProps) {
  const [open, setOpen] = useState(false)
  const [activeTurn, setActiveTurn] = useState<number | null>(null)
  const [roomy, setRoomy] = useState(false)
  const rafRef = useRef(0)

  // 内容列两侧留白 = px-2 的 8px + 居中后的富余；富余不够就整块不渲染。
  // clientWidth 已扣掉滚动条，估算偏保守
  useEffect(() => {
    if (!scrollEl) return
    const measure = () => {
      const padBox = scrollEl.clientWidth - 16
      const gutter = 8 + (padBox - Math.min(contentW, Math.max(0, padBox))) / 2
      setRoomy(gutter >= RAIL_GUTTER_MIN)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [scrollEl, contentW])

  const sync = useCallback(() => {
    if (!scrollEl || !scrollEl.offsetParent) return
    const els = scrollEl.querySelectorAll<HTMLElement>('[data-user-turn]')
    if (els.length === 0) { setActiveTurn(null); return }
    const cRect = scrollEl.getBoundingClientRect()
    const mid = cRect.top + cRect.height / 2
    let cur = Number(els[0].dataset.userTurn) || 0
    let best = Infinity
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect()
      const d = Math.abs(r.top + r.height / 2 - mid)
      if (d < best) { best = d; cur = Number(els[i].dataset.userTurn) || 0 }
    }
    setActiveTurn(prev => (prev === cur ? prev : cur))
  }, [scrollEl])

  useEffect(() => {
    if (!scrollEl) return
    const onScroll = () => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        sync()
      })
    }
    onScroll()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    }
  }, [scrollEl, sync, turns.length])

  if (turns.length < 2 || !roomy) return null
  return (
    <div className="ai-tab__turn-rail absolute right-3 top-3 bottom-8 z-10 max-h-full flex flex-col justify-center overflow-hidden pointer-events-none">
      <div
        className={`flex flex-col max-h-full pointer-events-auto ${
          open ? 'ai-tab__turn-rail-card pl-3 pr-2 py-1.5 rounded-lg border border-ide-border bg-ide-sidebar/70 backdrop-blur-md shadow-lg overflow-y-auto animate-fade-in' : ''
        }`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {turns.map(turn => {
          const active = turn.turnIdx === activeTurn
          const text = turn.content.length > RAIL_TEXT_MAX ? turn.content.slice(0, RAIL_TEXT_MAX) + '...' : turn.content
          return (
            <button
              key={turn.turnIdx}
              type="button"
              onClick={() => onPick(turn.turnIdx)}
              title={`${turn.turnIdx + 1}. ${turn.content}`}
              className={`h-7 flex items-center justify-end gap-2 ${open ? 'shrink-0' : ''}`}
            >
              {open && (
                <span className={`text-xs truncate max-w-[260px] ${active ? 'text-ide-accent' : 'text-ide-text-muted'}`}>
                  {text}
                </span>
              )}
              <span className={`shrink-0 h-0.5 rounded-full transition-all duration-150 ${active ? 'w-4 bg-ide-accent' : 'w-2.5 bg-ide-border'}`} />
            </button>
          )
        })}
      </div>
    </div>
  )
})

export default TurnRail
