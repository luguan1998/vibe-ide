import { useRef, useState, useLayoutEffect, type CSSProperties } from 'react'

export function useAdaptiveMenuPos(open: boolean, x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ left: x, top: y })
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const el = ref.current
    const h = el.offsetHeight
    const w = el.offsetWidth
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (left + w > vw - 4) left = Math.max(4, vw - w - 4)
    if (top + h > vh - 4) top = Math.max(4, y - h)
    setStyle({ left, top, maxHeight: vh - 8 })
  }, [open, x, y])
  return { ref, style }
}
