// Peek into Windows full minidump memory regions by virtual address.
// Usage: node scripts/dmp-peek.mjs <file.dmp> --scan [topN]      -> fingerprint top private regions
//        node scripts/dmp-peek.mjs <file.dmp> <VAhex> [lenMB]    -> hex+strings preview of one region
import { openSync, readSync, fstatSync, closeSync } from 'fs'

const path = process.argv[2]
const fd = openSync(path, 'r')
const fileSize = fstatSync(fd).size

function readAt(buf, len, pos) { readSync(fd, buf, 0, len, pos); return buf }

const hdr = readAt(Buffer.alloc(64), 64, 0)
const nStreams = hdr.readUInt32LE(8)
const dirRva = hdr.readUInt32LE(12)
const dir = readAt(Buffer.alloc(nStreams * 12), nStreams * 12, dirRva)
let mem64 = null, memInfo = null
for (let i = 0; i < nStreams; i++) {
  const t = dir.readUInt32LE(i * 12), sz = dir.readUInt32LE(i * 12 + 4), r = dir.readUInt32LE(i * 12 + 8)
  if (t === 9) mem64 = { size: sz, rva: r }
  if (t === 16) memInfo = { size: sz, rva: r }
}
if (!mem64) { console.error('no Memory64ListStream'); process.exit(1) }

const m64hdr = readAt(Buffer.alloc(16), 16, mem64.rva)
const nRanges = Number(m64hdr.readBigUInt64LE(0))
const baseRva = Number(m64hdr.readBigUInt64LE(8))
const ranges = []
{
  const tbl = readAt(Buffer.alloc(nRanges * 16), nRanges * 16, mem64.rva + 16)
  let fileOff = baseRva
  for (let i = 0; i < nRanges; i++) {
    const start = Number(tbl.readBigUInt64LE(i * 16))
    const size = Number(tbl.readBigUInt64LE(i * 16 + 8))
    ranges.push({ start, size, fileOff })
    fileOff += size
  }
}

const vaToOff = (va) => {
  for (const r of ranges) if (va >= r.start && va < r.start + r.size) return r.fileOff + (va - r.start)
  return null
}
const readVA = (va, len) => {
  const off = vaToOff(va)
  if (off === null) return null
  const b = Buffer.alloc(len)
  const n = readSync(fd, b, 0, len, off)
  return b.subarray(0, n)
}

// memory info list for region types
const mi = []
if (memInfo) {
  const h = readAt(Buffer.alloc(16), 16, memInfo.rva)
  const entrySize = h.readUInt32LE(4)
  const count = h.readUInt32LE(8)
  const tbl = readAt(Buffer.alloc(count * entrySize), count * entrySize, memInfo.rva + 16)
  for (let i = 0; i < count; i++) {
    const o = i * entrySize
    mi.push({
      base: Number(tbl.readBigUInt64LE(o)),
      size: Number(tbl.readBigUInt64LE(o + 24)),
      state: tbl.readUInt32LE(o + 32),
      protect: tbl.readUInt32LE(o + 36),
      type: tbl.readUInt32LE(o + 40),
    })
  }
}
const TYPE = { 0x20000: 'PRIVATE', 0x40000: 'MAPPED', 0x1000000: 'IMAGE' }

function fingerprint(va, len) {
  const probe = Math.min(len, 2 * 1024 * 1024)
  const b = readVA(va, probe)
  if (!b) return '(no data)'
  const hex = b.subarray(0, 48).toString('hex').replace(/(..)/g, '$1 ').trim()
  // sample strings
  const ascii = b.toString('latin1')
  const strs = ascii.match(/[\x20-\x7e]{8,}/g) || []
  const utf16 = b.toString('utf16le').match(/[\x20-\x7e一-鿿]{6,}/g) || []
  const sample = [...new Set([...strs.slice(0, 6), ...utf16.slice(0, 6)])].slice(0, 8)
  const zeros = b.filter(x => x === 0).length / b.length
  return { hex, zeroPct: (zeros * 100).toFixed(0), sample }
}

if (process.argv.includes('--scan')) {
  const topN = Number(process.argv[process.argv.indexOf('--scan') + 1]) || 25
  let priv
  if (mi.length) {
    priv = mi.filter(m => m.type === 0x20000 && m.state === 0x1000)
  } else {
    // fallback: no MemoryInfoListStream (e.g. comsvcs dumps) — use raw dump ranges, skip PE images
    console.log('(no MemoryInfoListStream; using raw memory ranges, PE images flagged)')
    priv = ranges.map(r => {
      const b = Buffer.alloc(2)
      readSync(fd, b, 0, 2, r.fileOff)
      const isPE = b[0] === 0x4d && b[1] === 0x5a
      return { base: r.start, size: r.size, protect: 0, type: isPE ? 'IMAGE?' : 'PRIVATE?', state: 0x1000 }
    })
  }
  priv = priv.sort((a, b) => b.size - a.size).slice(0, topN)
  console.log(`=== top ${topN} PRIVATE committed regions ===`)
  for (const m of priv) {
    const va = '0x' + m.base.toString(16)
    const f = fingerprint(m.base, m.size)
    console.log(`\n${(m.size / 1048576).toFixed(1)}MB @ ${va} protect=0x${m.protect.toString(16)} zero%=${f.zeroPct}`)
    console.log(`  hex: ${f.hex.slice(0, 96)}`)
    if (f.sample) console.log(`  strings: ${JSON.stringify(f.sample)}`)
  }
} else {
  const va = Number(process.argv[3])
  const lenMB = Number(process.argv[4] || 8)
  if (!va) { console.error('usage: <dmp> <VAhex> [lenMB]'); process.exit(1) }
  const b = readVA(va, lenMB * 1048576)
  if (!b) { console.error('VA not in dump'); process.exit(1) }
  console.log(`region @ 0x${va.toString(16)}, read ${(b.length / 1048576).toFixed(1)}MB`)
  console.log('--- first 512 bytes ---')
  for (let i = 0; i < 512; i += 32) {
    const row = b.subarray(i, i + 32)
    console.log(row.toString('hex').replace(/(..)/g, '$1 ').trim() + '  | ' + row.toString('latin1').replace(/[^\x20-\x7e]/g, '.'))
  }
  console.log('--- utf16le strings (unique, first 40) ---')
  const u = [...new Set((b.toString('utf16le').match(/[\x20-\x7e一-鿿]{6,}/g) || []))].slice(0, 40)
  u.forEach(s => console.log('  ', JSON.stringify(s.slice(0, 120))))
  console.log('--- ascii strings (unique, first 30) ---')
  const a = [...new Set((b.toString('latin1').match(/[\x20-\x7e]{8,}/g) || []))].slice(0, 30)
  a.forEach(s => console.log('  ', JSON.stringify(s.slice(0, 120))))
}
closeSync(fd)
