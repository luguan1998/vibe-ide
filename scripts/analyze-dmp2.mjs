// Supplementary DMP scan: fix module names + characterize big private regions.
// Usage: node scripts/analyze-dmp2.mjs electron.DMP
import { readFileSync, existsSync } from 'fs';

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);
const u64 = (b, o) => { const lo = b.readUInt32LE(o); const hi = b.readUInt32LE(o + 4); return lo + hi * 0x100000000; };
const fmt = n => n >= 1e9 ? (n/1e9).toFixed(2)+' GB' : n >= 1e6 ? (n/1e6).toFixed(1)+' MB' : n >= 1e3 ? (n/1e3).toFixed(1)+' KB' : n+' B';

const file = process.argv[2];
if (!file || !existsSync(file)) { console.error('need .dmp path'); process.exit(1); }
const buf = readFileSync(file);

// header
const numStreams = u32(buf, 8);
const dirRva = u32(buf, 12);
const streams = new Map();
let off = dirRva;
for (let i = 0; i < numStreams; i++) {
  streams.set(u32(buf, off), { size: u32(buf, off+4), off: u32(buf, off+8) });
  off += 12;
}

// MINIDUMP_MODULE is 108 bytes? Real layout: Base(8)+Size(4)+Check(4)+Stamp(4)+NameRva(4)=24,
// then VS_FIXEDFILEINFO 52 bytes, CvRecord 8, MiscRecord 8 => 24+52+16 = 92. Try 108 first (script's value) then 112.
// We re-derive by reading NameRva at +20 and advancing by the ACTUAL struct size.
const modStream = streams.get(4);
const MOD_SIZE = 108; // match original script
let moff = modStream.off;
const modCount = u32(buf, moff);
let mpos = moff + 4;
const modules = [];
for (let i = 0; i < modCount; i++) {
  const base = u64(buf, mpos);
  const size = u32(buf, mpos + 8);
  const nameRva = u32(buf, mpos + 20);
  let name = '';
  if (nameRva > 0 && nameRva + 4 < buf.length) {
    const nlen = u32(buf, nameRva);
    name = buf.toString('utf16le', nameRva + 4, nameRva + 4 + Math.min(nlen, 2000)).replace(/\0/g, '');
  }
  modules.push({ base, size, name });
  mpos += MOD_SIZE;
}
console.log('\n=== MODULES (corrected names) ===');
modules.sort((a,b) => b.size - a.size);
modules.slice(0, 25).forEach(m => console.log(`  ${fmt(m.size).padStart(9)} | ${m.name || '(no name)'} @ 0x${m.base.toString(16)}`));
console.log(`  (${modCount} modules total)`);

// Memory64List
const mem64 = streams.get(9);
let mloff = mem64.off;
const count64 = u64(buf, mloff);
let baseRva = u64(buf, mloff + 8);
let mpos2 = mloff + 16;
const regions = [];
for (let i = 0; i < count64; i++) {
  const start = u64(buf, mpos2);
  const size = u64(buf, mpos2 + 8);
  regions.push({ start, size, fileOff: baseRva });
  baseRva += Number(size);
  mpos2 += 16;
}

// MemoryInfoList to know type/state per region
const memInfo = streams.get(16);
const entrySize = u32(buf, memInfo.off + 4);
const infoCount = u64(buf, memInfo.off + 8);
let ipos = memInfo.off + 16;
const infoEntries = [];
for (let i = 0; i < Math.min(infoCount, 200000); i++) {
  const ba = u64(buf, ipos);
  const rs = u64(buf, ipos + 24);
  const state = u32(buf, ipos + 32);
  const type = u32(buf, ipos + 40);
  infoEntries.push({ ba, rs, state, type });
  ipos += entrySize;
}
const committed = infoEntries.filter(e => e.state === 0x1000);

// Helper: find file offset for a VA by scanning memory regions (linear — slow but ok for top regions)
function vaToFileOff(va) {
  for (const r of regions) {
    if (va >= r.start && va < r.start + r.size) {
      return r.fileOff + (va - r.start);
    }
  }
  return -1;
}

// Characterize top private regions by scanning for identifying ASCII strings
const TYPE_NAMES = { 0x1000000: 'IMAGE', 0x40000: 'MAPPED', 0x20000: 'PRIVATE' };
const topPrivate = committed
  .filter(e => e.type === 0x20000)
  .sort((a, b) => Number(b.rs) - Number(a.rs))
  .slice(0, 12);

console.log('\n=== TOP PRIVATE REGIONS — content scan ===');
const MARKERS = [
  /sourceMappingURL/i, /data:image\/[a-z]+;base64/i, /node_modules/i,
  /\.tsx?$/i, /\.jsx?$/i, /monaco/i, /xterm/i, /react/i, /chromium/i,
  /\bv8::/i, /BlinkGC/, /PartitionAlloc/, /WASM/i, /codicon/i,
  /tailwind/i, /\.css/i, /class=["'][^"']{20,}/, /\bfunction\b.*\(/,
];
for (const r of topPrivate) {
  const foff = vaToFileOff(r.ba);
  if (foff < 0) { console.log(`  ${fmt(r.rs).padStart(9)} PRIVATE @ 0x${r.ba.toString(16)} — not in dump`); continue; }
  const sample = buf.subarray(foff, Math.min(foff + Number(r.rs), foff + 4 * 1024 * 1024));
  // count printable + find markers
  let printable = 0, zero = 0;
  const strLens = [];
  let s = -1;
  const found = new Set();
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) zero++;
    if (b >= 32 && b <= 126) { if (s === -1) s = i; printable++; }
    else { if (s !== -1) { const len = i - s; if (len >= 8) strLens.push(len); s = -1; } }
    if (b === 0x73 && sample[i+1] === 0x6f && sample[i+2] === 0x75) { // 'sou'
      const seg = sample.toString('latin1', i, Math.min(i+40, sample.length));
      if (/sourceMappingURL/.test(seg)) found.add('sourcemap');
    }
  }
  // quick substring search for markers
  const head = sample.toString('latin1', 0, Math.min(sample.length, 2*1024*1024));
  for (const m of ['sourceMappingURL','data:image','node_modules','monaco','xterm','react','BlinkGC','PartitionAlloc','codicon','tailwind','chromium','v8::','WASM','.tsx','.jsx']) {
    if (head.toLowerCase().includes(m.toLowerCase())) found.add(m);
  }
  const avgStr = strLens.length ? (strLens.reduce((a,b)=>a+b,0)/strLens.length).toFixed(1) : 0;
  const longStrs = strLens.filter(l => l > 200).length;
  console.log(`  ${fmt(r.rs).padStart(9)} PRIVATE @ 0x${r.ba.toString(16)} | printable ${ (100*printable/sample.length).toFixed(0) }% zeros ${(100*zero/sample.length).toFixed(0)}% | strings8+:${strLens.length} avg:${avgStr} >200:${longStrs} | markers:[${[...found].join(',')}]`);
}

// Aggregate: total committed by type
const byType = new Map();
for (const e of committed) byType.set(e.type, (byType.get(e.type)||0) + Number(e.rs));
console.log('\n=== COMMITTED BY TYPE ===');
for (const [t, s] of byType) console.log(`  ${fmt(s).padStart(9)} | ${TYPE_NAMES[t]||('0x'+t.toString(16))}`);

// Count data:image base64 occurrences across whole dump (sampled) + sourceMappingURL
console.log('\n=== STRING MARKER COUNTS (full dump, sampled) ===');
let dataImg = 0, srcMap = 0, tsxPath = 0, base64Blob = 0;
const STEP = 1; // scan every byte but only first ~600MB to bound time
const scanEnd = Math.min(buf.length, 600 * 1024 * 1024);
const s1 = Buffer.from('data:image/');
const s2 = Buffer.from('sourceMappingURL');
const s3 = Buffer.from('.tsx');
for (let i = 0; i < scanEnd; i++) {
  if (buf[i] === s1[0] && buf[i+1] === s1[1] && buf[i+2] === s1[2] && buf[i+3] === s1[3] && buf[i+4] === s1[4] && buf[i+5] === s1[5] && buf[i+6] === s1[6] && buf[i+7] === s1[7] && buf[i+8] === s1[8] && buf[i+9] === s1[9] && buf[i+10] === s1[10]) dataImg++;
  if (buf[i] === 0x73 && buf[i+1] === 0x6f && buf[i+2] === 0x75 && buf[i+3] === 0x72 && buf[i+4] === 0x63 && buf[i+5] === 0x65 && buf[i+6] === 0x4d) srcMap++;
}
console.log(`  data:image/      : ${dataImg} occurrences`);
console.log(`  sourceMappingURL: ${srcMap} occurrences`);
console.log(`  (scanned first ${fmt(scanEnd)} of ${fmt(buf.length)})`);
