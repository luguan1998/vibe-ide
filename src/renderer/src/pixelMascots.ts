// 8×8 像素 sprite：'#' 填色、'.' 镂空（眼睛与缝隙透出背景），用于 cwd 组头图标
const SPRITE_GRID = 8

type SpriteRows = readonly string[]

export type PixelMascot = {
  name: string
  restPath: string
  talkPath: string
  color: string
}

const REST: Record<string, SpriteRows> = {
  invader: [
    '..#..#..',
    '.######.',
    '##.##.##',
    '########',
    '.######.',
    '.#.##.#.',
    '#.#..#.#',
    '........',
  ],
  ghost: [
    '..####..',
    '.######.',
    '##.##.##',
    '########',
    '########',
    '########',
    '########',
    '#.##.##.',
  ],
  robot: [
    '...#....',
    '.######.',
    '.#.##.#.',
    '.######.',
    '.#....#.',
    '.######.',
    '..#..#..',
    '........',
  ],
  cat: [
    '.#....#.',
    '.##..##.',
    '########',
    '#.####.#',
    '########',
    '###..###',
    '.######.',
    '..#..#..',
  ],
  skull: [
    '.######.',
    '########',
    '##.##.##',
    '########',
    '.##..##.',
    '.######.',
    '.#.##.#.',
    '........',
  ],
  crab: [
    '#......#',
    '.#....#.',
    '.######.',
    '##.##.##',
    '########',
    '#.####.#',
    '#......#',
    '........',
  ],
  mushroom: [
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '########',
    '...##...',
    '...##...',
    '..####..',
  ],
  rocket: [
    '...##...',
    '..####..',
    '..#..#..',
    '..####..',
    '.######.',
    '.######.',
    '##....##',
    '..####..',
  ],
  dino: [
    '...#####',
    '...##.##',
    '...#####',
    '.#######',
    '########',
    '#####...',
    '.##.##..',
    '..#..#..',
  ],
  frog: [
    '........',
    '##....##',
    '#.####.#',
    '########',
    '########',
    '.######.',
    '##....##',
    '........',
  ],
}

const TALK: Record<string, SpriteRows> = {
  invader: [
    '..#..#..',
    '.######.',
    '##.##.##',
    '########',
    '.######.',
    '#.####.#',
    '.#....#.',
    '#......#',
  ],
  ghost: [
    '..####..',
    '.######.',
    '#.##.###',
    '########',
    '########',
    '########',
    '########',
    '.##.##.#',
  ],
  robot: [
    '....#...',
    '.######.',
    '.#.##.#.',
    '.######.',
    '.##..##.',
    '.######.',
    '.#....#.',
    '........',
  ],
  cat: [
    '.#....#.',
    '.##..##.',
    '########',
    '#.####.#',
    '########',
    '########',
    '.######.',
    '.#....#.',
  ],
  skull: [
    '.######.',
    '########',
    '##.##.##',
    '########',
    '.##..##.',
    '.######.',
    '.#.##.#.',
    '..####..',
  ],
  crab: [
    '#......#',
    '##....##',
    '.######.',
    '##.##.##',
    '########',
    '.######.',
    '#.#..#.#',
    '........',
  ],
  mushroom: [
    '........',
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '...##...',
    '...##...',
    '..####..',
  ],
  rocket: [
    '...##...',
    '..####..',
    '..#..#..',
    '..####..',
    '.######.',
    '.######.',
    '##....##',
    '...##...',
  ],
  dino: [
    '...#####',
    '...##.##',
    '...#####',
    '.#######',
    '########',
    '#####...',
    '..##.##.',
    '..#...#.',
  ],
  frog: [
    '##....##',
    '#.####.#',
    '########',
    '########',
    '.######.',
    '##....##',
    '#......#',
    '........',
  ],
}

// 每行连续 '#' 合并为一条 rect path，保持 path 数据短小
function spritePath(rows: SpriteRows): string {
  let path = ''
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (row[x] !== '#') {
        x += 1
        continue
      }
      let run = 1
      while (row[x + run] === '#') run += 1
      path += `M${x} ${y}h${run}v1h-${run}z`
      x += run
    }
  })
  return path
}

// 颜色跟 sprite 绑定，手工打散映射（非 index 循环，避免一眼看出规律）
const SPRITE_COLORS: Record<string, string> = {
  invader: 'rgb(var(--ide-accent))',
  ghost: 'rgb(var(--ide-accent))',
  robot: 'rgb(var(--ide-success))',
  cat: 'rgb(var(--ide-warning))',
  skull: 'rgb(var(--ide-danger))',
  crab: 'rgb(var(--ide-warning))',
  mushroom: 'rgb(var(--ide-danger))',
  rocket: 'rgb(var(--ide-success))',
  dino: 'rgb(var(--ide-accent))',
  frog: 'rgb(var(--ide-danger))',
}

export const PIXEL_MASCOTS: readonly PixelMascot[] = Object.entries(REST).map(
  ([name, rest]) => ({
    name,
    restPath: spritePath(rest),
    talkPath: spritePath(TALK[name]),
    color: SPRITE_COLORS[name],
  }),
)

export const PIXEL_MASCOT_GRID = SPRITE_GRID

function hashSeed(seed: string, salt: number): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * salt + seed.charCodeAt(i)) >>> 0
  }
  return hash
}

// 显式指定优先；否则按 seed 稳定分配，同一目录永远是同一个 sprite
export function pixelMascot(seed: string, name?: string | null): PixelMascot {
  const chosen = name
    ? PIXEL_MASCOTS.find((mascot) => mascot.name === name)
    : undefined
  return chosen ?? PIXEL_MASCOTS[hashSeed(seed, 131) % PIXEL_MASCOTS.length]
}

// 随机换一个与当前不同的 sprite（颜色随 sprite 变）
export function randomPixelMascotName(seed: string, name?: string | null): string {
  const current = pixelMascot(seed, name)
  const candidates = PIXEL_MASCOTS.filter((mascot) => mascot.name !== current.name)
  return candidates[Math.floor(Math.random() * candidates.length)].name
}
