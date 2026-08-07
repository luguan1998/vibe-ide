import { useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

// 点击遮罩关闭的弹窗容器。
// 拖选文字时 mousedown 在弹窗内、mouseup 落在遮罩上，浏览器会把 click 触发在两者最近公共祖先（遮罩）上，
// 导致拖选误关。用按下/松开位移判定区分：位移 > 4px 视为拖选，不关闭。
export function ModalOverlay({ onClose, children, className, style, onKeyDown }: {
  onClose: () => void
  children: ReactNode
  className?: string
  style?: CSSProperties
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  const downPosRef = useRef<{ x: number; y: number } | null>(null)
  return (
    <div
      className={className ?? 'fixed inset-0 z-50 flex items-center justify-center bg-black/50'}
      style={style}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => { downPosRef.current = { x: e.clientX, y: e.clientY } }}
      onClick={(e: MouseEvent) => {
        const p = downPosRef.current
        downPosRef.current = null
        if (p && (Math.abs(e.clientX - p.x) > 4 || Math.abs(e.clientY - p.y) > 4)) return
        onClose()
      }}
    >
      {children}
    </div>
  )
}
