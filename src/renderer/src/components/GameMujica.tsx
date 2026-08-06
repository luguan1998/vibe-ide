import { useEffect, useRef } from 'react'
import MujicaCanvas from './MujicaCanvas'
import MujicaOutput from './MujicaTools'
import { mujicaStore, useMujica } from '../mujicaStore'

// Nga "mujica" card dispatches this; App.tsx listens and switches the center to the canvas.
export const FOCUS_MUJICA = 'mujica-focus'
// Right-panel "close" dispatches this; App.tsx switches back to terminal.
export const MUJICA_CLOSE = 'mujica-close'

interface GameMujicaProps {
  onCollapse?: () => void
}

// Center view: just the canvas. Config lives in the right panel (MujicaConfig).
// Agent output is a click-to-pin pane (click a node to pin/unpin its output).
export default function GameMujica({ onCollapse }: GameMujicaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onCollapseRef = useRef(onCollapse)
  onCollapseRef.current = onCollapse
  const m = useMujica()

  // ESC → collapse (stay active, switch center back to terminal). Capture + offsetParent
  // check (CLAUDE.md ESC layering): when the center is switched away (display:none)
  // this must NOT grab ESC.
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'escape') return
      if (!containerRef.current?.offsetParent) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onCollapseRef.current?.()
    }
    window.addEventListener('keydown', handleEsc, true)
    return () => window.removeEventListener('keydown', handleEsc, true)
  }, [])

  return (
    <div ref={containerRef} className="relative flex h-full w-full bg-ide-bg overflow-hidden">
      <MujicaCanvas
        workspaces={m.workspaces}
        hoveredId={m.hoveredId}
        pinnedId={m.pinnedId}
        canRun={!!m.prompt.trim()}
        onHover={mujicaStore.hover}
        onHoverEnd={mujicaStore.scheduleHide}
        onTogglePin={mujicaStore.togglePin}
        onRunOne={mujicaStore.runOne}
        onRemove={mujicaStore.removeWorkspace}
        onToggleWorktree={mujicaStore.setWorktree}
      />
      {m.pinnedId && <MujicaOutput pinnedId={m.pinnedId} />}
    </div>
  )
}
