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
// 行高恒定 → 两种状态线段位置不跳。滚动状态留在本组件内，
// 避免每个 scroll 事件重渲染整个 AiTab。
const TurnRail = React.memo(function TurnRail({ turns, scrollEl, contentW, onPick }: TurnRailProps) {
  const [open, setOpen] = useState(false)
  const [activeTurn, setActiveTurn] = useState<number | null>(null)
  const [roomy, setRoomy] = useState(false)
  const rafRef = useRef(0)
  // 点击后钉住目标轮：目标贴近顶部时 scrollTop 被 clamp 到 0，滚不到居中，
  // 纯位置规则会亮到下一轮。用户自己滚走/点消息区后解除
  const pinnedRef = useRef<number | null>(null)

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
    if (pinnedRef.current != null) { setActiveTurn(pinnedRef.current); return }
    const els = scrollEl.querySelectorAll<HTMLElement>('[data-user-turn]')
    if (els.length === 0) { setActiveTurn(null); return }
    const cRect = scrollEl.getBoundingClientRect()
    const mid = cRect.top + cRect.height / 2
    // 当前轮 = 起点已越过视口中心的最后一轮(长回合里往下读仍算它)；
    // 都在中心以下(刚滚到顶/内容不足一屏)时回落成第一轮
    let cur = Number(els[0].dataset.userTurn) || 0
    for (let i = 0; i < els.length; i++) {
      if (els[i].getBoundingClientRect().top <= mid) cur = Number(els[i].dataset.userTurn) || 0
      else break
    }
    setActiveTurn(prev => (prev === cur ? prev : cur))
  }, [scrollEl])

  useEffect(() => {
    if (!scrollEl) return
    pinnedRef.current = null
    const onScroll = () => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        sync()
      })
    }
    const unpin = () => { pinnedRef.current = null }
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    scrollEl.addEventListener('wheel', unpin, { passive: true })
    scrollEl.addEventListener('touchstart', unpin, { passive: true })
    scrollEl.addEventListener('mousedown', unpin, { passive: true })
    scrollEl.addEventListener('keydown', unpin)
    onScroll()
    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      scrollEl.removeEventListener('wheel', unpin)
      scrollEl.removeEventListener('touchstart', unpin)
      scrollEl.removeEventListener('mousedown', unpin)
      scrollEl.removeEventListener('keydown', unpin)
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    }
  }, [scrollEl, sync, turns.length])

  const handlePick = useCallback((turnIdx: number) => {
    pinnedRef.current = turnIdx
    setActiveTurn(turnIdx)
    onPick(turnIdx)
  }, [onPick])

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
              onClick={() => handlePick(turn.turnIdx)}
              title={`${turn.turnIdx + 1}. ${turn.content}`}
              className={`h-7 flex items-center justify-end gap-2 ${open ? 'shrink-0' : ''}`}
            >
              {open && (
                <span className={`text-xs truncate max-w-[260px] ${active ? 'text-ide-accent' : 'text-ide-text-muted'}`}>
                  {text}
                </span>
              )}
              <span className={`shrink-0 h-0.5 rounded-full transition-all duration-150 ${active ? 'w-3 bg-ide-accent' : 'w-2.5 bg-ide-border'}`} />
            </button>
          )
        })}
      </div>
    </div>
  )
})

export default TurnRail
