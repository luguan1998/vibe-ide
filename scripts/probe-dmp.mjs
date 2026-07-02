import { readFileSync } from 'fs';
const u32 = (b, o) => b.readUInt32LE(o);
const u64 = (b, o) => { const lo = b.readUInt32LE(o); const hi = b.readUInt32LE(o + 4); return lo + hi * 0x100000000; };
const fmt = n => n >= 1e9 ? (n/1e9).toFixed(2)+'GB' : n >= 1e6 ? (n/1e6).toFixed(1)+'MB' : n >= 1e3 ? (n/1e3).toFixed(1)+'KB' : n+'B';
const buf = readFileSync(process.argv[2] || 'electron.DMP');
console.log('DMP size:', fmt(buf.length));
const numStreams = u32(buf, 8);
const dirRva = u32(buf, 12);
const streams = new Map();
let off = dirRva;
for (let i = 0; i < numStreams; i++) { streams.set(u32(buf, off), { size: u32(buf, off+4), off: u32(buf, off+8) }); off += 12; }
const mem64 = streams.get(9);
let mloff = mem64.off;
const count64 = u64(buf, mloff);
let baseRva = u64(buf, mloff + 8);
let mpos2 = mloff + 16;
const regions = [];
for (let i = 0; i < count64; i++) { const start = u64(buf, mpos2); const size = Number(u64(buf, mpos2+8)); regions.push({ start, size, fileOff: baseRva }); baseRva += size; mpos2 += 16; }
function findRegion(va) { for (const r of regions) if (va >= r.start && va < r.start + r.size) return r; return null; }
function extractStrings(sample, minLen = 24, max = 15) {
  const strs = []; let s = -1;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b >= 32 && b <= 126) { if (s === -1) s = i; }
    else { if (s !== -1 && i - s >= minLen) strs.push(sample.toString('latin1', s, i).slice(0, 300)); s = -1; }
  }
  return [...new Set(strs)].slice(0, max);
}
const TARGETS = [
  { va: 0x4c7409c04000, label: '58.3MB src block 1' },
  { va: 0x4c7411804000, label: '58.3MB src block 2' },
  { va: 0x4c7416804000, label: '94.1MB no-marker 1' },
  { va: 0x4c7421c04000, label: '94.1MB no-marker 2' },
  { va: 0x3a20f200000, label: '50.3MB tailwind/tsx' },
  { va: 0x2f9c00400000, label: '42.1MB monaco/codicon' },
];
for (const t of TARGETS) {
  const r = findRegion(t.va);
  console.log(`\n=== ${t.label} @ 0x${t.va.toString(16)} size=${r?fmt(r.size):'?'} ===`);
  if (!r) { console.log('  not in dump'); continue; }
  for (const frac of [0, 0.25, 0.5, 0.75]) {
    const sampleStart = r.fileOff + Math.floor(r.size * frac);
    const sample = buf.subarray(sampleStart, Math.min(sampleStart + 8192, buf.length));
    const strs = extractStrings(sample);
    console.log(`  [${((frac*100)|0)}%] ${strs.length} strings:`);
    for (const s of strs.slice(0, 5)) console.log(`    | ${s}`);
  }
}
