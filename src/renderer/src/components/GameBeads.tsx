import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { useI18n } from '../i18n'

interface PaletteColor {
  name: string
  hex: string
  r: number
  g: number
  b: number
}

interface Lab {
  L: number
  a: number
  b: number
}

const PALETTE: PaletteColor[] = [
  { name: 'White', hex: '#FFFFFF', r: 255, g: 255, b: 255 },
  { name: 'Cream', hex: '#F5E6C8', r: 245, g: 230, b: 200 },
  { name: 'Yellow', hex: '#FFD700', r: 255, g: 215, b: 0 },
  { name: 'Orange', hex: '#FF8C00', r: 255, g: 140, b: 0 },
  { name: 'Red', hex: '#DC143C', r: 220, g: 20, b: 60 },
  { name: 'Bubblegum', hex: '#FF69B4', r: 255, g: 105, b: 180 },
  { name: 'Pink', hex: '#FFB6C1', r: 255, g: 182, b: 193 },
  { name: 'Plum', hex: '#8B008B', r: 139, g: 0, b: 139 },
  { name: 'Purple', hex: '#800080', r: 128, g: 0, b: 128 },
  { name: 'Blueberry', hex: '#4169E1', r: 65, g: 105, b: 225 },
  { name: 'Dark Blue', hex: '#00008B', r: 0, g: 0, b: 139 },
  { name: 'Light Blue', hex: '#87CEEB', r: 135, g: 206, b: 235 },
  { name: 'Toothpaste', hex: '#B0E0E6', r: 176, g: 224, b: 230 },
  { name: 'Teal', hex: '#008080', r: 0, g: 128, b: 128 },
  { name: 'Dark Green', hex: '#006400', r: 0, g: 100, b: 0 },
  { name: 'Green', hex: '#228B22', r: 34, g: 139, b: 34 },
  { name: 'Lime', hex: '#32CD32', r: 50, g: 205, b: 50 },
  { name: 'Kiwi', hex: '#ADFF2F', r: 173, g: 255, b: 47 },
  { name: 'Cheddar', hex: '#FFB347', r: 255, g: 179, b: 71 },
  { name: 'Tan', hex: '#D2B48C', r: 210, g: 180, b: 140 },
  { name: 'Brown', hex: '#8B4513', r: 139, g: 69, b: 19 },
  { name: 'Rust', hex: '#B7410E', r: 183, g: 65, b: 14 },
  { name: 'Light Gray', hex: '#C0C0C0', r: 192, g: 192, b: 192 },
  { name: 'Gray', hex: '#808080', r: 128, g: 128, b: 128 },
  { name: 'Dark Gray', hex: '#404040', r: 64, g: 64, b: 64 },
  { name: 'Black', hex: '#1A1A1A', r: 26, g: 26, b: 26 },
  { name: 'Magenta', hex: '#FF00FF', r: 255, g: 0, b: 255 },
  { name: 'Peach', hex: '#FFDAB9', r: 255, g: 218, b: 185 },
  { name: 'Lavender', hex: '#E6E6FA', r: 230, g: 230, b: 250 },
  { name: 'Pastel Blue', hex: '#AEC6CF', r: 174, g: 198, b: 207 },
  { name: 'Pastel Green', hex: '#B2FBA5', r: 178, g: 251, b: 165 },
  { name: 'Pastel Yellow', hex: '#FDFD96', r: 253, g: 253, b: 150 },
]

function srgbToLinear(c: number): number {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883
  const fx = x > 0.008856 ? Math.cbrt(x) : (903.3 * x + 16) / 116
  const fy = y > 0.008856 ? Math.cbrt(y) : (903.3 * y + 16) / 116
  const fz = z > 0.008856 ? Math.cbrt(z) : (903.3 * z + 16) / 116
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

const rad = (deg: number) => (deg * Math.PI) / 180

function deltaE2000(x: Lab, y: Lab): number {
  const L1 = x.L
  const A1 = x.a
  const B1 = x.b
  const L2 = y.L
  const A2 = y.a
  const B2 = y.b
  const C1 = Math.hypot(A1, B1)
  const C2 = Math.hypot(A2, B2)
  const Cbar = (C1 + C2) / 2
  const Cbar7 = Math.pow(Cbar, 7)
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625)))
  const a1p = (1 + G) * A1
  const a2p = (1 + G) * A2
  const C1p = Math.hypot(a1p, B1)
  const C2p = Math.hypot(a2p, B2)
  const hue = (b: number, ap: number) => {
    const h = Math.atan2(b, ap)
    const deg = (h * 180) / Math.PI
    return deg < 0 ? deg + 360 : deg
  }
  const h1p = C1p > 0 ? hue(B1, a1p) : 0
  const h2p = C2p > 0 ? hue(B2, a2p) : 0
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p > 0 && C2p > 0) {
    let d = h2p - h1p
    if (d > 180) d -= 360
    else if (d < -180) d += 360
    dhp = d
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2)
  const Lbar = (L1 + L2) / 2
  const Cpbar = (C1p + C2p) / 2
  let hpbar: number
  if (C1p * C2p === 0) {
    hpbar = h1p + h2p
  } else {
    const diff = Math.abs(h1p - h2p)
    if (diff <= 180) hpbar = (h1p + h2p) / 2
    else if (h1p + h2p < 360) hpbar = (h1p + h2p + 360) / 2
    else hpbar = (h1p + h2p - 360) / 2
  }
  const cosd = (deg: number) => Math.cos(rad(deg))
  const T = 1 - 0.17 * cosd(hpbar - 30) + 0.24 * cosd(2 * hpbar) + 0.32 * cosd(3 * hpbar + 6) - 0.2 * cosd(4 * hpbar - 63)
  const dL = Lbar - 50
  const SL = 1 + (0.015 * dL * dL) / Math.sqrt(20 + dL * dL)
  const SC = 1 + 0.045 * Cpbar
  const SH = 1 + 0.015 * Cpbar * T
  const dtheta = 30 * Math.exp(-Math.pow((hpbar - 275) / 25, 2))
  const Rc = 2 * Math.sqrt(Math.pow(Cpbar, 7) / (Math.pow(Cpbar, 7) + 6103515625))
  const Rt = -Math.sin(rad(2 * dtheta)) * Rc
  const tL = dLp / SL
  const tC = dCp / SC
  const tH = dHp / SH
  return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH)
}

const LAB_CACHE = new Map<PaletteColor, Lab>()

function paletteLab(c: PaletteColor): Lab {
  let lab = LAB_CACHE.get(c)
  if (!lab) {
    lab = rgbToLab(c.r, c.g, c.b)
    LAB_CACHE.set(c, lab)
  }
  return lab
}

const WHITE = () => PALETTE[0]
const BLACK = () => PALETTE[25]

function preprocess(img: HTMLImageElement, size: number, vivid: boolean): { data: Uint8ClampedArray; w: number; h: number } {
  const l = size <= 15 ? 16 * size : 10 * size
  const canvas = document.createElement('canvas')
  canvas.width = l
  canvas.height = l
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const ratio = img.naturalWidth / img.naturalHeight
  let sx = 0
  let sy = 0
  let sw = img.naturalWidth
  let sh = img.naturalHeight
  if (ratio > 1) {
    sx = (img.naturalWidth - img.naturalHeight) / 2
    sw = img.naturalHeight
  } else {
    sy = (img.naturalHeight - img.naturalWidth) / 2
    sh = img.naturalWidth
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, l, l)
  const image = ctx.getImageData(0, 0, l, l)
  if (vivid) {
    contrastStretch(image.data, l)
    if (size <= 29) saturationBoost(image.data, l, size <= 15 ? 1.25 : 1.15)
  }
  bilateralFilter(image.data, l, size <= 15 ? 30 : size <= 29 ? 25 : 20)
  return { data: image.data, w: l, h: l }
}

function contrastStretch(data: Uint8ClampedArray, size: number) {
  const ranges: { min: number; max: number }[] = [
    { min: 255, max: 0 },
    { min: 255, max: 0 },
    { min: 255, max: 0 },
  ]
  const total = size * size * 4
  for (let i = 0; i < total; i += 4) {
    if (data[i + 3] < 128) continue
    for (let ch = 0; ch < 3; ch++) {
      const v = data[i + ch]
      if (v < ranges[ch].min) ranges[ch].min = v
      if (v > ranges[ch].max) ranges[ch].max = v
    }
  }
  for (const r of ranges) {
    const span = r.max - r.min
    if (span < 20) continue
    r.min = Math.min(255, r.min + 0.01 * span)
    r.max = Math.max(0, r.max - 0.01 * span)
  }
  for (let i = 0; i < total; i += 4) {
    if (data[i + 3] < 128) continue
    for (let ch = 0; ch < 3; ch++) {
      const span = ranges[ch].max - ranges[ch].min
      if (span < 20) continue
      const v = (data[i + ch] - ranges[ch].min) / span
      data[i + ch] = Math.max(0, Math.min(255, Math.round(255 * v)))
    }
  }
}

function saturationBoost(data: Uint8ClampedArray, size: number, factor: number) {
  const total = size * size * 4
  for (let i = 0; i < total; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const hi = Math.max(r, g, b)
    const lo = Math.min(r, g, b)
    if (hi === lo) continue
    const mid = (hi + lo) / 2
    const boost = (v: number) => Math.max(0, Math.min(1, mid + (v - mid) * factor))
    data[i] = Math.round(255 * boost(r))
    data[i + 1] = Math.round(255 * boost(g))
    data[i + 2] = Math.round(255 * boost(b))
  }
}

function bilateralFilter(data: Uint8ClampedArray, size: number, sigma: number) {
  const src = new Uint8ClampedArray(data)
  const gauss: number[] = []
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) gauss.push(Math.exp(-(dx * dx + dy * dy) / 4.5))
  const rangeK = -1 / (2 * sigma * sigma)
  for (let y = 2; y < size - 2; y++) {
    for (let x = 2; x < size - 2; x++) {
      const idx = (y * size + x) * 4
      if (src[idx + 3] < 128) continue
      const r0 = src[idx]
      const g0 = src[idx + 1]
      const b0 = src[idx + 2]
      let rSum = 0
      let gSum = 0
      let bSum = 0
      let wSum = 0
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const o = ((y + dy) * size + (x + dx)) * 4
          if (src[o + 3] < 128) continue
          const dr = src[o] - r0
          const dg = src[o + 1] - g0
          const db = src[o + 2] - b0
          const w = gauss[(dy + 2) * 5 + (dx + 2)] * Math.exp((dr * dr + dg * dg + db * db) * rangeK)
          rSum += src[o] * w
          gSum += src[o + 1] * w
          bSum += src[o + 2] * w
          wSum += w
        }
      }
      if (wSum > 0) {
        data[idx] = Math.round(rSum / wSum)
        data[idx + 1] = Math.round(gSum / wSum)
        data[idx + 2] = Math.round(bSum / wSum)
      }
    }
  }
}

function nearestPalette(r0: number, g0: number, b0: number, labs: Lab[]): number {
  const lab = rgbToLab(r0, g0, b0)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < labs.length; i++) {
    const d = deltaE2000(lab, labs[i])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function selectPalette(data: Uint8ClampedArray, width: number, height: number, topN: number): PaletteColor[] {
  const labs = PALETTE.map(paletteLab)
  const counts = new Float64Array(PALETTE.length)
  const edges = new Float64Array(PALETTE.length)
  const step = Math.max(1, Math.floor((width * height) / 1e4))
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const o = (y * width + x) * 4
      if (data[o + 3] < 128) continue
      const r0 = data[o]
      const g0 = data[o + 1]
      const b0 = data[o + 2]
      const idx = nearestPalette(r0, g0, b0, labs)
      counts[idx]++
      if (x + step < width) {
        const n = (y * width + x + step) * 4
        if (data[n + 3] >= 128 && Math.abs(0.299 * r0 + 0.587 * g0 + 0.114 * b0 - (0.299 * data[n] + 0.587 * data[n + 1] + 0.114 * data[n + 2])) > 40) {
          edges[idx] += 2
        }
      }
    }
  }
  const ranked: { idx: number; score: number }[] = []
  for (let i = 0; i < PALETTE.length; i++) {
    if (counts[i] > 0) ranked.push({ idx: i, score: counts[i] + 3 * edges[i] })
  }
  ranked.sort((a, b) => b.score - a.score)
  const picked = ranked.slice(0, topN).map(r => r.idx)
  for (const inx of [PALETTE.findIndex(c => c.name === 'Black'), PALETTE.findIndex(c => c.name === 'White')]) {
    if (inx >= 0 && !picked.includes(inx) && counts[inx] > 0) {
      picked.pop()
      picked.push(inx)
    }
  }
  return picked.map(i => PALETTE[i])
}

function quantize(data: Uint8ClampedArray, width: number, height: number, gridCount: number, pal: PaletteColor[], dither: boolean): PaletteColor[][] {
  const labs = pal.map(paletteLab)
  const cellW = width / gridCount
  const cellH = height / gridCount
  const err = new Float64Array(gridCount * gridCount * 3)
  const grid: PaletteColor[][] = []
  const spread = (e: Float64Array, x: number, y: number, w: number, dl: number, da: number, db: number) => {
    if (x < 0 || x >= gridCount || y < 0 || y >= gridCount) return
    const i = (y * gridCount + x) * 3
    e[i] += dl * w
    e[i + 1] += da * w
    e[i + 2] += db * w
  }
  for (let gy = 0; gy < gridCount; gy++) {
    const row: PaletteColor[] = []
    for (let gx = 0; gx < gridCount; gx++) {
      const x0 = Math.floor(gx * cellW)
      const y0 = Math.floor(gy * cellH)
      const x1 = Math.min(width, Math.floor((gx + 1) * cellW))
      const y1 = Math.min(height, Math.floor((gy + 1) * cellH))
      let rs = 0
      let gs = 0
      let bs = 0
      let total = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4
          if (data[o + 3] < 128) continue
          rs += data[o]
          gs += data[o + 1]
          bs += data[o + 2]
          total++
        }
      }
      if (total === 0) {
        row.push(WHITE())
        continue
      }
      const cell = gy * gridCount + gx
      const ei = cell * 3
      let lab = rgbToLab(rs / total, gs / total, bs / total)
      if (dither) lab = { L: lab.L + err[ei], a: lab.a + err[ei + 1], b: lab.b + err[ei + 2] }
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < labs.length; i++) {
        const d = deltaE2000(lab, labs[i])
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      row.push(pal[best])
      if (dither) {
        const target = labs[best]
        spread(err, gx + 1, gy, 7 / 16, lab.L - target.L, lab.a - target.a, lab.b - target.b)
        spread(err, gx - 1, gy + 1, 3 / 16, lab.L - target.L, lab.a - target.a, lab.b - target.b)
        spread(err, gx, gy + 1, 5 / 16, lab.L - target.L, lab.a - target.a, lab.b - target.b)
        spread(err, gx + 1, gy + 1, 1 / 16, lab.L - target.L, lab.a - target.a, lab.b - target.b)
      }
    }
    grid.push(row)
  }
  return grid
}

function majorityFill(grid: PaletteColor[][]): PaletteColor[][] {
  const out = grid.map(row => [...row])
  const h = grid.length
  const w = grid[0].length
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cur = grid[y][x]
      const tally = new Map<PaletteColor, number>()
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const c = grid[ny][nx]
        tally.set(c, (tally.get(c) ?? 0) + 1)
      }
      for (const [c, count] of tally) {
        if (count >= 3 && c !== cur) {
          out[y][x] = c
          break
        }
      }
    }
  }
  return out
}

function removeIsolated(grid: PaletteColor[][], passes: number): PaletteColor[][] {
  let cur = grid.map(row => [...row])
  const h = grid.length
  const w = grid[0].length
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.map(row => [...row])
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = cur[y][x]
        const tally = new Map<PaletteColor, number>()
        let same = 0
        let used = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
            used++
            const c = cur[ny][nx]
            if (c === cell) same++
            tally.set(c, (tally.get(c) ?? 0) + 1)
          }
        }
        if (same === 0 && used > 2) {
          let best: PaletteColor | null = null
          let bestCount = 0
          for (const [c, count] of tally) {
            if (count > bestCount) {
              bestCount = count
              best = c
            }
          }
          if (best) next[y][x] = best
        } else if (same === 1 && used >= 5) {
          let best: PaletteColor | null = null
          let bestCount = 0
          for (const [c, count] of tally) {
            if (c === cell) continue
            if (count > bestCount) {
              bestCount = count
              best = c
            }
          }
          if (best && bestCount >= used - 1) next[y][x] = best
        }
      }
    }
    cur = next
  }
  return cur
}

function mergeRare(grid: PaletteColor[][], pct: number): PaletteColor[][] {
  const h = grid.length
  const w = grid[0].length
  const counts = new Map<PaletteColor, number>()
  for (const row of grid)
    for (const c of row) counts.set(c, (counts.get(c) ?? 0) + 1)
  const threshold = Math.max(2, Math.floor(h * w * pct))
  const rare = new Set<PaletteColor>()
  for (const [c, count] of counts) if (count < threshold) rare.add(c)
  if (rare.size === 0) return grid
  const common = Array.from(counts.keys()).filter(c => !rare.has(c))
  if (common.length === 0) return grid
  const replace = new Map<PaletteColor, PaletteColor>()
  for (const c of rare) {
    const lab = paletteLab(c)
    let best: PaletteColor | null = null
    let bestD = Infinity
    for (const cand of common) {
      const d = deltaE2000(lab, paletteLab(cand))
      if (d < bestD) {
        bestD = d
        best = cand
      }
    }
    if (best) replace.set(c, best)
  }
  if (replace.size === 0) return grid
  return grid.map(row => row.map(c => replace.get(c) ?? c))
}

interface ConvertOpts {
  compact: boolean
  vivid: boolean
  dither: boolean
}

function convertImage(img: HTMLImageElement, size: number, opts: ConvertOpts): PaletteColor[][] {
  const { data, w, h } = preprocess(img, size, opts.vivid)
  const pal = opts.compact
    ? selectPalette(data, w, h, size <= 15 ? 10 : size <= 29 ? 16 : 22)
    : PALETTE
  let grid = quantize(data, w, h, size, pal, opts.dither)
  if (!opts.dither) {
    const passes = size <= 15 ? 3 : size <= 29 ? 2 : 1
    grid = majorityFill(grid)
    grid = removeIsolated(grid, passes)
    grid = majorityFill(mergeRare(grid, size <= 15 ? 0.04 : size <= 29 ? 0.025 : 0.015))
    grid = removeIsolated(grid, 1)
  }
  return grid
}

function renderBeads(canvas: HTMLCanvasElement, grid: PaletteColor[][], cell: number) {  const n = grid.length
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = n * cell * dpr
  canvas.height = n * cell * dpr
  canvas.style.width = `${n * cell}px`
  canvas.style.height = `${n * cell}px`
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  const side = n * cell
  ctx.fillStyle = '#e8e4ec'
  ctx.fillRect(0, 0, side, side)
  ctx.fillStyle = '#d5d0db'
  const plateR = 0.42 * cell + 0.5
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.beginPath()
      ctx.arc(x * cell + cell / 2, y * cell + cell / 2, plateR, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const beadR = 0.42 * cell
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = x * cell + cell / 2
      const cy = y * cell + cell / 2
      ctx.beginPath()
      ctx.arc(cx, cy, beadR, 0, Math.PI * 2)
      ctx.fillStyle = grid[y][x].hex
      ctx.fill()
      if (cell >= 12) {
        const grad = ctx.createRadialGradient(cx - 0.3 * beadR, cy - 0.3 * beadR, 0.1 * beadR, cx, cy, beadR)
        grad.addColorStop(0, 'rgba(255,255,255,0.30)')
        grad.addColorStop(0.5, 'rgba(255,255,255,0)')
        grad.addColorStop(1, 'rgba(0,0,0,0.12)')
        ctx.fillStyle = grad
        ctx.fill()
      }
      ctx.beginPath()
      ctx.arc(cx, cy, beadR, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'
      ctx.lineWidth = cell >= 18 ? 1 : 0.5
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(0.08 * cell, 1), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fill()
    }
  }
}

function buildAnsiArt(grid: PaletteColor[][], rep = 1): string {
  const n = grid.length
  const lines: string[] = []
  for (let y = 0; y < n; y += 2) {
    let line = ''
    for (let x = 0; x < n; x++) {
      const top = grid[y][x]
      let tok = `\x1b[38;2;${top.r};${top.g};${top.b}m`
      if (y + 1 < n) {
        const bot = grid[y + 1][x]
        tok += `\x1b[48;2;${bot.r};${bot.g};${bot.b}m`
      }
      tok += '▀'
      line += tok.repeat(rep)
    }
    line += '\x1b[0m\r\n'
    lines.push(line)
  }
  return lines.join('')
}

function drawSampleCanvas(kind: 'sunset' | 'night'): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 300
  c.height = 300
  const ctx = c.getContext('2d')!
  if (kind === 'sunset') {
    const sky = ctx.createLinearGradient(0, 0, 0, 300)
    sky.addColorStop(0, '#355C7D')
    sky.addColorStop(0.5, '#C06C84')
    sky.addColorStop(0.75, '#F8B195')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 300, 300)
    ctx.fillStyle = '#FDFD96'
    ctx.beginPath()
    ctx.arc(150, 205, 52, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#2E4A62'
    ctx.fillRect(0, 232, 300, 68)
    ctx.fillStyle = '#C06C84'
    for (let i = 0; i < 4; i++) ctx.fillRect(0, 250 + i * 12, 300, 4)
  } else {
    ctx.fillStyle = '#0B1026'
    ctx.fillRect(0, 0, 300, 300)
    for (let i = 0; i < 42; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.beginPath()
      ctx.arc(Math.random() * 300, Math.random() * 300, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#FDFD96'
    ctx.beginPath()
    ctx.arc(200, 90, 40, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0B1026'
    ctx.beginPath()
    ctx.arc(216, 78, 36, 0, Math.PI * 2)
    ctx.fill()
  }
  return c
}

const SIZE_OPTIONS = [15, 29, 50] as const

export default function GameBeads({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n()
  const [size, setSize] = useState<number>(29)
  const [source, setSource] = useState<{ img: HTMLImageElement; url: string } | null>(null)
  const [grid, setGrid] = useState<PaletteColor[][] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [opts, setOpts] = useState<ConvertOpts>({ compact: false, vivid: false, dither: false })
  const [copiedAnsi, setCopiedAnsi] = useState(false)
  const [ansiWide, setAnsiWide] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showHelp) return
    const onDown = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setShowHelp(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showHelp])
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef<number>(29)
  const optsRef = useRef<ConvertOpts>(opts)

  const applyImage = useCallback((img: HTMLImageElement, url: string) => {
    setBusy(true)
    setErr('')
    setTimeout(() => {
      try {
        const result = convertImage(img, sizeRef.current, optsRef.current)
        setSource({ img, url })
        setGrid(result)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
      setBusy(false)
    }, 30)
  }, [])

  const loadUrl = useCallback((url: string) => {
    const img = new Image()
    img.onload = () => applyImage(img, url)
    img.onerror = () => setErr('Unreadable image')
    img.src = url
  }, [applyImage])

  const onPickFile = useCallback((file: File | undefined | null) => {
    if (!file) return
    loadUrl(URL.createObjectURL(file))
  }, [loadUrl])

  const pickSize = useCallback((s: number) => {
    sizeRef.current = s
    setSize(s)
    if (source) applyImage(source.img, source.url)
  }, [source, applyImage])

  const setOpt = useCallback((key: keyof ConvertOpts) => {
    const next = { ...optsRef.current, [key]: !optsRef.current[key] }
    optsRef.current = next
    setOpts(next)
    if (source) applyImage(source.img, source.url)
  }, [source, applyImage])

  const onSample = useCallback((kind: 'sunset' | 'night') => {
    const c = drawSampleCanvas(kind)
    loadUrl(c.toDataURL('image/png'))
  }, [loadUrl])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    onPickFile(e.dataTransfer.files?.[0])
  }, [onPickFile])

  const counts = useMemo(() => {
    if (!grid) return []
    const tally = new Map<PaletteColor, number>()
    for (const row of grid) for (const c of row) tally.set(c, (tally.get(c) ?? 0) + 1)
    return Array.from(tally.entries()).sort((a, b) => b[1] - a[1])
  }, [grid])

  useEffect(() => {
    if (grid && canvasRef.current) {
      renderBeads(canvasRef.current, grid, Math.floor(620 / grid.length))
    }
  }, [grid])

  const exportPng = useCallback(() => {
    if (!grid) return
    const cellSize = Math.max(18, Math.floor(1800 / grid.length))
    const canvas = document.createElement('canvas')
    renderBeads(canvas, grid, cellSize)
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `beads-${grid.length}x${grid.length}.png`
    a.click()
  }, [grid])

  const copyAnsi = useCallback(() => {
    if (!grid) return
    navigator.clipboard.writeText(buildAnsiArt(grid, ansiWide ? 2 : 1)).then(() => {
      setCopiedAnsi(true)
      setTimeout(() => setCopiedAnsi(false), 1200)
    })
  }, [grid, ansiWide])

  return (
    <div className="flex-1 flex flex-col overflow-hidden outline-none focus:outline-none" tabIndex={-1}>
      <div className="flex items-center justify-between px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 select-none">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-ide-text-muted hover:text-ide-text transition-colors" title="Back to menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-ide-text-muted">
            <circle cx="7" cy="7" r="3.5" />
            <circle cx="17" cy="7" r="3.5" />
            <circle cx="7" cy="17" r="3.5" />
            <circle cx="17" cy="17" r="3.5" />
          </svg>
          <span className="text-xs font-bold text-ide-text-muted tracking-wider">{t('Beads')}</span>
          {grid && (
            <div ref={helpRef} className="relative">
              <button
                onClick={() => setShowHelp(v => !v)}
                title={t('How to print in terminal')}
                className="w-5 h-5 rounded-full bg-ide-hover hover:bg-ide-border text-ide-text-muted hover:text-ide-text flex items-center justify-center transition-colors"
              >
                <HelpCircle size={13} />
              </button>
              {showHelp && (
                <div className="absolute left-0 top-full mt-1.5 w-64 rounded-lg bg-ide-sidebar border border-ide-border shadow-lg p-3 z-40 text-xs">
                  <div className="text-ide-text font-medium mb-2">{t('Print pixel art in terminal')}</div>
                  <div className="text-ide-text-muted mb-1">{t('PowerShell')}</div>
                  <code className="block px-2 py-1 rounded bg-ide-hover text-ide-text font-mono">Get-Clipboard</code>
                  <div className="text-ide-text-muted/60 mt-2">{t('Copy ANSI first, then run the command in the terminal')}</div>
                  <div className="text-ide-text-muted/50 mt-1">{t('Pixel aspect follows the terminal font. Recommended: Cascadia Mono (8×16, 2:1 cells). Other fonts may look slightly narrow.')}</div>
                  <div className="text-ide-text-muted/50 mt-1">{t('If the art looks narrow, toggle ×2 next to Copy ANSI')}</div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {grid && (
            <>
              <button onClick={copyAnsi} className="px-2 py-1 rounded bg-ide-hover hover:bg-ide-border text-ide-text-muted transition-colors">
                {copiedAnsi ? t('✓ Copied') : t('Copy ANSI')}
              </button>
              <button
                onClick={() => setAnsiWide(v => !v)}
                title={t('Pixel width — ×2 if terminal cells are narrow')}
                className={`px-1.5 py-1 rounded transition-colors ${ansiWide ? 'bg-ide-accent text-white' : 'bg-ide-hover hover:bg-ide-border text-ide-text-muted'}`}
              >
                ×{ansiWide ? 2 : 1}
              </button>
              <button onClick={exportPng} className="px-2 py-1 rounded bg-ide-hover hover:bg-ide-border text-ide-text-muted transition-colors">
                {t('Export PNG')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-ide-border shrink-0 select-none flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-ide-text-muted/70">Grid</span>
        <div className="flex rounded-lg overflow-hidden border border-ide-border">
          {SIZE_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => pickSize(s)}
              className={`px-3 py-1 text-xs transition-colors ${size === s ? 'bg-ide-accent text-white' : 'bg-ide-sidebar text-ide-text-muted hover:text-ide-text'}`}
            >
              {s}×{s}
            </button>
          ))}
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1 text-xs rounded-lg bg-ide-hover hover:bg-ide-border text-ide-text-muted transition-colors"
        >
          Choose Image
        </button>
        <button onClick={() => onSample('sunset')} className="px-3 py-1 text-xs rounded-lg bg-ide-hover hover:bg-ide-border text-ide-text-muted transition-colors">
          🌅 Sample
        </button>
        <button onClick={() => onSample('night')} className="px-3 py-1 text-xs rounded-lg bg-ide-hover hover:bg-ide-border text-ide-text-muted transition-colors">
          🌙 Sample
        </button>
        {(
          [
            ['compact', 'Compact palette'],
            ['vivid', 'Vivid'],
            ['dither', 'Dither'],
          ] as [keyof ConvertOpts, string][]
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1 text-xs text-ide-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={opts[key]}
              onChange={() => setOpt(key)}
              className="w-3.5 h-3.5 accent-[var(--ide-accent)]"
            />
            {label}
          </label>
        ))}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            onPickFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {err && <div className="mb-3 text-xs text-ide-danger">{err}</div>}
        {!grid ? (
          <div
            onDragOver={e => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`w-full max-w-md mx-auto mt-16 p-8 rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${
              dragOver ? 'border-ide-accent bg-ide-hover/50' : 'border-ide-border'
            }`}
            onClick={() => fileRef.current?.click()}
          >
            <div className="text-3xl mb-2">{busy ? '⏳' : '📸'}</div>
            <div className="text-sm text-ide-text-muted">{busy ? 'Converting…' : 'Drop your image here or click to browse'}</div>
            <div className="text-xs text-ide-text-muted/60 mt-1">JPG, PNG, WebP</div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6">
            <div className="w-44 shrink-0 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-ide-text-muted/70">Original</div>
              {source && (
                <img src={source.url} alt="" className="w-full rounded-lg border border-ide-border object-cover aspect-square" />
              )}
            </div>
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-ide-text-muted/70">
                Bead map {grid.length}×{grid.length}
              </div>
              <canvas
                ref={canvasRef}
                className={`rounded-lg border border-ide-border ${busy ? 'opacity-50' : ''}`}
                style={{ width: 'auto', maxWidth: '100%' }}
              />
              <div className="text-xs text-ide-text-muted">
                {counts.map(([c, n]) => (
                  <span key={c.name} className="inline-flex items-center gap-1.5 mr-3 my-0.5">
                    <span className="w-3 h-3 rounded-full border border-black/20" style={{ backgroundColor: c.hex }} />
                    {c.name} ×{n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
