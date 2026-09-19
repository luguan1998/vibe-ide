// Estimate real payload of private regions (multi-point zero sampling) + dedup font mappings.
// Usage: node scripts/dmp-payload.mjs <file.dmp>
import { openSync, readSync, fstatSync, closeSync } from 'fs'
import { createHash } from 'crypto'

const path = process.argv[2]
if (!path) { console.error('usage: node scripts/dmp-payload.mjs <file.dmp>'); process.exit(1) }
const fd = openSync(path, 'r')
const fileSize = fstatSync(fd).size
const readAt = (len, pos) => { const b = Buffer.alloc(len); readSync(fd, b, 0, Math.max(0, Math.min(len, fileSize - pos)), pos); return b }

const hdr = readAt(64, 0)
const nStreams = hdr.readUInt32LE(8)
const dirRva = hdr.readUInt32LE(12)
const dir = readAt(nStreams * 12, dirRva)
let mem64 = null, memInfo = null
for (let i = 0; i < nStreams; i++) {
  const t = dir.readUInt32LE(i * 12)
  if (t === 9) mem64 = { rva: dir.readUInt32LE(i * 12 + 8) }
  if (t === 16) memInfo = { rva: dir.readUInt32LE(i * 12 + 8) }
}
if (!mem64 || !memInfo) { console.error('need Memory64ListStream + MemoryInfoListStream (dump with 0x802)'); process.exit(1) }
const m64hdr = readAt(16, mem64.rva)
const nRanges = Number(m64hdr.readBigUInt64LE(0))
const baseRva = Number(m64hdr.readBigUInt64LE(8))
const tbl = readAt(nRanges * 16, mem64.rva + 16)
const ranges = []
{
  let fileOff = baseRva
  for (let i = 0; i < nRanges; i++) {
    const start = Number(tbl.readBigUInt64LE(i * 16))
    const size = Number(tbl.readBigUInt64LE(i * 16 + 8))
    ranges.push({ start, size, fileOff })
    fileOff += size
  }
}
const vaToOff = (va) => { for (const r of ranges) if (va >= r.start && va < r.start + r.size) return r.fileOff + (va - r.start); return null }
const readVA = (va, len) => { const off = vaToOff(va); if (off === null) return null; return readAt(len, off) }

const miHdr = readAt(16, memInfo.rva)
const entrySize = miHdr.readUInt32LE(4)
const miCount = Number(miHdr.readBigUInt64LE(8))
const miTbl = readAt(miCount * entrySize, memInfo.rva + 16)
const committed = []
for (let i = 0; i < miCount; i++) {
  const o = i * entrySize
  const m = {
    base: Number(miTbl.readBigUInt64LE(o)),
    size: Number(miTbl.readBigUInt64LE(o + 24)),
    state: miTbl.readUInt32LE(o + 32),
    protect: miTbl.readUInt32LE(o + 36),
    type: miTbl.readUInt32LE(o + 40),
  }
  if (m.state === 0x1000) committed.push(m)
}
const MB = x => (x / 1048576)

function payloadEst(m) {
  const probe = 64 * 1024
  const pts = Math.min(8, Math.max(1, Math.floor(m.size / probe)))
  let sum = 0, n = 0
  for (let i = 0; i < pts; i++) {
    const va = m.base + Math.floor((m.size - probe) * (pts === 1 ? 0 : i / (pts - 1)))
    const b = readVA(va, probe)
    if (!b) continue
    let z = 0
    for (let j = 0; j < b.length; j++) if (b[j] === 0) z++
    sum += z / b.length; n++
  }
  if (!n) return null
  const zeroPct = sum / n
  return { zeroPct, payload: m.size * (1 - zeroPct) }
}

const EXEC = new Set([0x10, 0x20, 0x40, 0x80])
const priv = committed.filter(m => m.type === 0x20000)
const clusters = new Map()
const rows = []
for (const m of priv) {
  const pe = payloadEst(m)
  const b = readVA(m.base, Math.min(m.size, 128 * 1024))
  const s = b ? b.toString('latin1') : ''
  let cat = 'heap/data'
  if (EXEC.has(m.protect)) cat = 'exec-code'
  else if (s.includes('-internal-auto-base(')) cat = 'css-values'
  else if (s.includes('@typescript/lib-')) cat = 'ts-worker'
  else if (pe && pe.zeroPct >= 0.9) cat = 'sparse-pool'
  const key = '0x' + Math.floor(m.base / 0x1000000000).toString(16).padStart(4, '0')
  const c = clusters.get(key) || { bytes: 0, payload: 0, n: 0 }
  c.bytes += m.size; c.payload += pe ? pe.payload : 0; c.n++
  clusters.set(key, c)
  rows.push({ ...m, ...(pe || { zeroPct: -1, payload: 0 }), cat })
}

console.log(`=== PRIVATE clusters (committed ${MB(priv.reduce((s, m) => s + m.size, 0)).toFixed(1)}MB) ===`)
for (const [k, c] of [...clusters.entries()].sort((a, b) => b[1].bytes - a[1].bytes))
  console.log(`  ${k}…  n=${String(c.n).padStart(5)}  committed=${MB(c.bytes).toFixed(1).padStart(7)}MB  payloadEst=${MB(c.payload).toFixed(1).padStart(7)}MB  (${(100 * c.payload / c.bytes).toFixed(0)}% used)`)

console.log('\n=== top 30 private regions by size ===')
for (const m of [...rows].sort((a, b) => b.size - a.size).slice(0, 30)) {
  const pct = (100 * m.payload / m.size).toFixed(0)
  console.log(`  ${MB(m.size).toFixed(1).padStart(6)}MB payload~${MB(m.payload).toFixed(1).padStart(6)}MB (${pct.padStart(3)}%) zero=${(100 * m.zeroPct).toFixed(0).padStart(3)}% ${m.cat.padEnd(12)} @ 0x${m.base.toString(16)}`)
}

console.log('\n=== font mappings (MAPPED, content=font, >=1MB) ===')
const fontRegs = []
for (const m of committed) {
  if (m.type !== 0x40000 || m.size < 1024 * 1024) continue
  const b = readVA(m.base, Math.min(m.size, 64 * 1024))
  if (!b) continue
  const head = b.subarray(0, 1024).toString('latin1')
  if (head.startsWith('ttcf') || (head.includes('GDEF') && head.includes('cmap'))) fontRegs.push(m)
}
console.log(`  font candidate regions: ${fontRegs.length}`)

function nameParse(va) {
  const head = readVA(va, 64 * 1024)
  if (!head) return '(nodata)'
  const fonts = []
  if (head.toString('latin1', 0, 4) === 'ttcf') {
    const n = head.readUInt32BE(8)
    for (let i = 0; i < n; i++) fonts.push(head.readUInt32BE(12 + i * 4))
  } else fonts.push(0)
  const names = []
  for (const fo of fonts.slice(0, 4)) {
    try {
      const numTables = head.readUInt16BE(fo + 4)
      let nameTabOff = -1
      for (let t = 0; t < numTables; t++) {
        const rec = fo + 12 + t * 16
        if (head.toString('latin1', rec, rec + 4) === 'name') nameTabOff = head.readUInt32BE(rec + 8)
      }
      if (nameTabOff < 0) continue
      const nt = readVA(va + nameTabOff, 64 * 1024)
      if (!nt) continue
      const count = nt.readUInt16BE(2)
      const strOff = nt.readUInt16BE(4)
      for (let r = 0; r < count; r++) {
        const o = 6 + r * 12
        const pid = nt.readUInt16BE(o), lang = nt.readUInt16BE(o + 4), nid = nt.readUInt16BE(o + 6)
        const len = nt.readUInt16BE(o + 8), off = nt.readUInt16BE(o + 10)
        if (nid !== 1 || pid !== 3 || lang !== 0x409) continue
        const bb = Buffer.from(nt.subarray(strOff + off, strOff + off + len)); bb.swap16()
        const s = bb.toString('utf16le')
        if (s && !names.includes(s)) names.push(s)
      }
    } catch {}
  }
  return names.join('/') || '(unnamed)'
}

const groups = new Map()
for (const m of fontRegs) {
  const h = createHash('md5')
  for (const off of [0, Math.max(0, Math.floor(m.size / 2) - 512 * 1024), Math.max(0, m.size - 1024 * 1024)]) {
    const b = readVA(m.base + off, 1024 * 1024)
    if (b) h.update(b)
  }
  const key = h.digest('hex').slice(0, 10)
  const g = groups.get(key) || { n: 0, size: m.size, names: null }
  g.n++
  if (!g.names) g.names = nameParse(m.base)
  groups.set(key, g)
}
let uniqueTotal = 0, dupTotal = 0
console.log(`  unique files: ${groups.size}`)
for (const [, g] of [...groups.entries()].sort((a, b) => b[1].size * b[1].n - a[1].size * a[1].n)) {
  uniqueTotal += g.size
  dupTotal += g.size * (g.n - 1)
  console.log(`  ${MB(g.size).toFixed(1).padStart(6)}MB x${g.n}  ${(g.names || '').slice(0, 60)}`)
}
console.log(`  unique file bytes=${MB(uniqueTotal).toFixed(1)}MB  duplicate extra=${MB(dupTotal).toFixed(1)}MB`)
closeSync(fd)
