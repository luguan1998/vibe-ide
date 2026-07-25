import type { CSSProperties } from 'react'
import type { PetManifest } from '@shared/types'

export function PetSprite({ manifest, stateName, scale, frameRate, frames }: { manifest: PetManifest; stateName: string; scale: number; frameRate: number; frames: number }) {
  const st = manifest.states[stateName]
    ?? manifest.states['idle']
    ?? Object.values(manifest.states)[0]
  const row = st.row
  const fr = Math.max(1, Math.min(frames, st.frames))
  const duration = (st.frameDurationMs ?? manifest.frameDurationMs) * fr / frameRate
  const bgW = manifest.cols * manifest.frameWidth
  const bgH = manifest.rows * manifest.frameHeight
  const dw = manifest.frameWidth * scale
  const dh = manifest.frameHeight * scale

  return (
    <div className="desktop-pet__sprite-root" style={{ width: dw, height: dh, position: 'relative', overflow: 'visible' }}>
      <div
        className="desktop-pet__sprite"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: manifest.frameWidth,
          height: manifest.frameHeight,
          backgroundImage: `url('${manifest.spritesheetUrl}')`,
          backgroundSize: `${bgW}px ${bgH}px`,
          backgroundRepeat: 'no-repeat',
          imageRendering: 'pixelated',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          '--pet-frames': fr,
          '--pet-fw': `${manifest.frameWidth}px`,
          animation: `pet-row-${row} ${duration}ms steps(${fr}, jump-none) infinite`,
          pointerEvents: 'none'
        } as CSSProperties}
      />
    </div>
  )
}
