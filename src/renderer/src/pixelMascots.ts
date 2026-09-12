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
  pacman: [
    '..####..',
    '.######.',
    '#######.',
    '####....',
    '####....',
    '#######.',
    '.######.',
    '..####..',
  ],
  creeper: [
    '########',
    '#..##..#',
    '#..##..#',
    '########',
    '###..###',
    '#.#..#.#',
    '#.#..#.#',
    '########',
  ],
  metroid: [
    '.#....#.',
    '.######.',
    '########',
    '#.####.#',
    '#.####.#',
    '########',
    '.#.##.#.',
    '#.#..#.#',
  ],
  goomba: [
    '........',
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '########',
    '.######.',
    '.##..##.',
  ],
  slime: [
    '...##...',
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '########',
    '########',
    '########',
  ],
  star: [
    '...##...',
    '...##...',
    '########',
    '########',
    '.######.',
    '..####..',
    '.##..##.',
    '##....##',
  ],
  heart: [
    '........',
    '.##..##.',
    '########',
    '########',
    '########',
    '.######.',
    '..####..',
    '...##...',
  ],
  rupee: [
    '........',
    '...##...',
    '..####..',
    '.#.##.#.',
    '########',
    '########',
    '.######.',
    '..####..',
  ],
  kirby: [
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '########',
    '########',
    '########',
    '.##..##.',
  ],
  junimo: [
    '.#....#.',
    '.#....#.',
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '########',
    '..#..#..',
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
  pacman: [
    '..####..',
    '.######.',
    '#######.',
    '#####...',
    '#####...',
    '#######.',
    '.######.',
    '..####..',
  ],
  creeper: [
    '########',
    '#..##..#',
    '#..##..#',
    '########',
    '###..###',
    '#.####.#',
    '#.####.#',
    '########',
  ],
  metroid: [
    '.#....#.',
    '.######.',
    '########',
    '#.####.#',
    '########',
    '########',
    '.#.##.#.',
    '#.#..#.#',
  ],
  goomba: [
    '........',
    '..####..',
    '.######.',
    '#.#..#.#',
    '########',
    '########',
    '.######.',
    '.##..##.',
  ],
  slime: [
    '...##...',
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '###..###',
    '########',
    '########',
  ],
  star: [
    '...##...',
    '...##...',
    '########',
    '########',
    '.######.',
    '..####..',
    '##....##',
    '#......#',
  ],
  heart: [
    '.##..##.',
    '########',
    '########',
    '########',
    '########',
    '.######.',
    '..####..',
    '...##...',
  ],
  rupee: [
    '...##...',
    '..####..',
    '.#.##.#.',
    '########',
    '########',
    '.######.',
    '..####..',
    '........',
  ],
  kirby: [
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '########',
    '###..###',
    '########',
    '.##..##.',
  ],
  junimo: [
    '#......#',
    '.#....#.',
    '..####..',
    '.######.',
    '##.##.##',
    '########',
    '########',
    '..#..#..',
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
const THEME_COLOR = {
  accent: 'rgb(var(--ide-accent))',
  success: 'rgb(var(--ide-success))',
  warning: 'rgb(var(--ide-warning))',
  danger: 'rgb(var(--ide-danger))',
  muted: 'rgb(var(--ide-text-muted))',
} as const

// 固定色不随主题变化，供 cwd 图标自选加色板
const FIXED_COLOR = {
  red: '#e5484d',
  orange: '#f0883e',
  yellow: '#e3b341',
  green: '#3fb950',
  cyan: '#39c5cf',
  blue: '#4493f8',
  purple: '#a371f7',
} as const

const COLOR = { ...THEME_COLOR, ...FIXED_COLOR }

export type PixelMascotColorName = keyof typeof COLOR

function toColorEntries<T extends Record<string, string>>(map: T) {
  return Object.entries(map).map(([name, value]) => ({ name: name as PixelMascotColorName, value }))
}

export const PIXEL_MASCOT_THEME_COLORS = toColorEntries(THEME_COLOR)
export const PIXEL_MASCOT_FIXED_COLORS = toColorEntries(FIXED_COLOR)

export function mascotColorValue(name: string | null | undefined): string | undefined {
  return name && name in COLOR ? COLOR[name as PixelMascotColorName] : undefined
}

const SPRITE_COLORS: Record<string, string> = {
  invader: COLOR.accent,
  ghost: COLOR.accent,
  robot: COLOR.success,
  cat: COLOR.warning,
  skull: COLOR.danger,
  crab: COLOR.warning,
  mushroom: COLOR.danger,
  rocket: COLOR.success,
  dino: COLOR.accent,
  frog: COLOR.danger,
  pacman: COLOR.warning,
  creeper: COLOR.success,
  metroid: COLOR.danger,
  goomba: COLOR.warning,
  slime: COLOR.accent,
  star: COLOR.warning,
  heart: COLOR.danger,
  rupee: COLOR.success,
  kirby: COLOR.danger,
  junimo: COLOR.success,
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
