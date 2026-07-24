import type { PetManifest } from '@shared/types'

const STYLE_ID = 'desktop-pet-keyframes'

// 按 manifest 注入 @keyframes pet-row-N（每行一条，按 row 去重）。
// 照抄 petSprites.ts injectSpriteCSS 的"运行时 <style> 注入 + 去重"思路。
export function injectPetKeyframes(manifest: PetManifest): void {
  if (typeof document === 'undefined') return
  const sig = `${manifest.id}:${manifest.frameWidth}:${manifest.frameHeight}:${manifest.cols}:${manifest.rows}`
  const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (existing && existing.getAttribute('data-sig') === sig) return
  if (existing) existing.remove()

  const { frameWidth: fw, frameHeight: fh, cols, states } = manifest
  const seenRows = new Set<number>()
  const rules: string[] = []
  for (const st of Object.values(states)) {
    if (seenRows.has(st.row)) continue
    seenRows.add(st.row)
    const frames = st.frames
    const endX = -(frames - 1) * fw
    const yPos = -st.row * fh
    rules.push(`@keyframes pet-row-${st.row} {
  from { background-position: 0 ${yPos}px; }
  to   { background-position: ${endX}px ${yPos}px; }
}`)
  }
  void cols
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.setAttribute('data-sig', sig)
  style.textContent = rules.join('\n')
  document.head.appendChild(style)
}
