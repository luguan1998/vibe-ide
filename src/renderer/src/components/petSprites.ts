export interface PetSpriteConfig {
  name: string
  shadow1: string
  shadow2: string | null
  pixelSize: number
  cols: number
  rows: number
}

export function pixelize(matrix: number[][], colors: string[], size: number): string {
  const shadows: string[] = []
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      const v = matrix[r][c]
      if (v === 0) continue
      shadows.push(`${c * size}px ${r * size}px 0 ${colors[v - 1]}`)
    }
  }
  return shadows.join(', ')
}

export function createSprite(
  name: string,
  matrix: number[][],
  matrix2: number[][] | undefined,
  colors: string[],
  pixelSize: number,
): PetSpriteConfig {
  const cols = matrix[0]?.length ?? 0
  if (matrix2 && (matrix2.length !== matrix.length || (matrix2[0]?.length ?? 0) !== cols)) {
    throw new Error(`petSprites: ${name} frames must have the same dimensions`)
  }
  const shadow2 = matrix2 ? pixelize(matrix2, colors, pixelSize) : null
  const sprite: PetSpriteConfig = { name, shadow1: pixelize(matrix, colors, pixelSize), shadow2, pixelSize, cols, rows: matrix.length }
  injectSpriteCSS(sprite)
  return sprite
}

export function injectSpriteCSS(sprite: PetSpriteConfig): void {
  if (typeof document === 'undefined') return
  const id = `pet-sprite--${sprite.name}`
  if (document.getElementById(id)) return
  const width = sprite.cols * sprite.pixelSize
  const height = sprite.rows * sprite.pixelSize
  const animCSS = sprite.shadow2 ? `
.ai-tab__pet-sprite--${sprite.name} {
  animation: pet-wave--${sprite.name} 0.5s infinite steps(1);
}
@keyframes pet-wave--${sprite.name} {
  0%, 49% { box-shadow: var(--sprite-f1); }
  50%, 100% { box-shadow: var(--sprite-f2); }
}` : ''
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
.ai-tab__pet--${sprite.name} {
  --pet-width: ${width}px;
  --pet-height: ${height}px;
  --pet-px: ${sprite.pixelSize}px;
}
.ai-tab__pet-sprite--${sprite.name} {
  --sprite-f1: ${sprite.shadow1};
  --sprite-f2: ${sprite.shadow2 ?? sprite.shadow1};
}${animCSS}`
  document.head.appendChild(style)
}

export function toSnippetCSS(sprite: PetSpriteConfig): string {
  const width = sprite.cols * sprite.pixelSize
  const height = sprite.rows * sprite.pixelSize
  const lines = [
    `/* ${sprite.name} — ${sprite.cols}×${sprite.rows} @ ${sprite.pixelSize}px */`,
    `.ai-tab__pet--${sprite.name} {`,
    `  --pet-width: ${width}px !important;`,
    `  --pet-height: ${height}px !important;`,
    `  --pet-px: ${sprite.pixelSize}px !important;`,
    `}`,
    `.ai-tab__pet-sprite--${sprite.name} {`,
    `  --sprite-f1: ${sprite.shadow1} !important;`,
  ]
  if (sprite.shadow2) {
    lines.push(`  --sprite-f2: ${sprite.shadow2} !important;`)
    lines.push(`  animation: pet-wave--${sprite.name} 0.5s infinite steps(1) !important;`)
  }
  lines.push(`}`)
  if (sprite.shadow2) {
    lines.push(`@keyframes pet-wave--${sprite.name} {`)
    lines.push(`  0%, 49% { box-shadow: var(--sprite-f1); }`)
    lines.push(`  50%, 100% { box-shadow: var(--sprite-f2); }`)
    lines.push(`}`)
  }
  return lines.join('\n')
}

// ── Octocat (NES.css) ──────────────────────────────────────────────

const OCTOCAT_COLORS = ['#333', '#ffdec4', '#cb7066']

const OCTOCAT_F1: number[][] = [
  [0,0,0,1,0,0,0,0,0,0,0,0,1,0],
  [0,0,0,1,1,0,0,0,0,0,0,1,1,0],
  [0,0,0,1,1,1,1,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1],
  [0,0,1,1,1,2,2,2,2,2,2,1,1,1],
  [0,0,1,1,2,3,2,2,2,2,3,2,1,1],
  [0,0,1,1,2,3,2,2,2,2,3,2,1,1],
  [0,0,0,1,1,2,2,3,3,2,2,1,1,0],
  [1,1,0,0,0,0,1,1,1,1,0,0,0,0],
  [0,0,1,1,0,1,1,1,1,1,1,0,0,0],
  [0,0,0,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,0,0,0,1,0,1,1,0,1,0,0,0],
  [0,0,0,0,0,1,0,1,1,0,1,0,0,0],
  [0,0,0,0,1,0,1,0,0,1,0,1,0,0],
]

const OCTOCAT_F2: number[][] = [
  [0,0,0,1,0,0,0,0,0,0,0,0,1,0],
  [0,0,0,1,1,0,0,0,0,0,0,1,1,0],
  [0,0,0,1,1,1,1,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1],
  [0,0,1,1,1,2,2,2,2,2,2,1,1,1],
  [0,0,1,1,2,2,2,2,2,2,2,2,1,1],
  [0,1,1,1,2,3,2,2,2,2,3,2,1,1],
  [0,1,0,1,1,2,2,3,3,2,2,1,1,0],
  [0,0,1,0,0,0,1,1,1,1,0,0,0,0],
  [0,0,0,1,0,1,1,1,1,1,1,0,0,0],
  [0,0,0,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,0,0,0,1,0,1,1,0,1,0,0,0],
  [0,0,0,0,0,1,0,1,1,0,1,0,0,0],
  [0,0,0,0,1,0,1,0,0,1,0,1,0,0],
]

export const OCTOCAT = createSprite('octocat', OCTOCAT_F1, OCTOCAT_F2, OCTOCAT_COLORS, 3)
