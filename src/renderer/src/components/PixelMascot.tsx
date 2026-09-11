import { PIXEL_MASCOT_GRID, pixelMascot } from '../pixelMascots'

type Props = {
  seed: string
  name?: string | null
  className?: string
  active?: boolean
}

export function PixelMascot({ seed, name, className = 'size-3.5 shrink-0', active = false }: Props) {
  const mascot = pixelMascot(seed, name)
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${PIXEL_MASCOT_GRID} ${PIXEL_MASCOT_GRID}`}
      shapeRendering="crispEdges"
      className={`${className}${active ? ' pixel-mascot-active' : ''}`}
      fill="currentColor"
      style={{ color: mascot.color }}
    >
      {active ? (
        <>
          <path className="pixel-mascot-rest" d={mascot.restPath} />
          <path className="pixel-mascot-talk" d={mascot.talkPath} />
        </>
      ) : (
        <path d={mascot.restPath} />
      )}
    </svg>
  )
}
