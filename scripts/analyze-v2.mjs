// Quick-focused heap analysis: source maps, Monaco, xterm, native memory, + retainer chains.
// Usage: node scripts/analyze-v2.mjs <heapsnapshot>
import { loadSnapshot, HeapSnapshot } from './heap-utils.mjs';

const file = process.argv[2];
if (!file) { console.error('Usage: node analyze-v2.mjs <heapsnapshot>'); process.exit(1); }

const snap = loadSnapshot(file);
const { retained } = snap.computeRetainedSizes();

// ── 1. Source maps ──
const sourceMaps = [];
const dataUrls = [];
for (let i = 0; i < snap.nodeCount; i++) {
  const name = snap.getName(i);
  const size = snap.getSize(i);
  if (size < 1000) continue;
  if (name.startsWith('data:application/json;base64,')) {
    sourceMaps.push({ name: name.slice(0, 100), selfSize: size, idx: i, retSize: retained[i] });
  } else if (name.startsWith('data:')) {
    dataUrls.push({ name: name.slice(0, 100), selfSize: size, idx: i, retSize: retained[i] });
  }
}
sourceMaps.sort((a, b) => b.selfSize - a.selfSize);
dataUrls.sort((a, b) => b.selfSize - a.selfSize);

const totalSM = sourceMaps.reduce((s, e) => s + e.selfSize, 0);
const totalDU = dataUrls.reduce((s, e) => s + e.selfSize, 0);
console.log(`\n=== SOURCE MAPS (data:application/json;base64,...) ===`);
console.log(`Count: ${sourceMaps.length}, Self: ${HeapSnapshot.fmt(totalSM)}`);
sourceMaps.slice(0, 15).forEach(e => {
  const extra = e.retSize > e.selfSize ? ` ret:${HeapSnapshot.fmt(e.retSize)}` : '';
  console.log(`  ${HeapSnapshot.fmt(e.selfSize).padStart(8)}${extra} | ${e.name}`);
});

console.log(`\n=== OTHER DATA URLs ===`);
console.log(`Count: ${dataUrls.length}, Self: ${HeapSnapshot.fmt(totalDU)}`);
dataUrls.slice(0, 10).forEach(e => console.log(`  ${HeapSnapshot.fmt(e.selfSize).padStart(8)} | ${e.name}`));

// ── 2. Monaco / Editor objects ──
console.log(`\n=== MONACO / EDITOR related ===`);
let mcCount = 0, mcSelf = 0, mcRet = 0;
const mcObjs = [];
for (let i = 0; i < snap.nodeCount; i++) {
  const name = snap.getName(i);
  const type = snap.getType(i);
  if (name.toLowerCase().includes('monaco') || name.toLowerCase().includes('editor') ||
      name.toLowerCase().includes('codicon') || name.toLowerCase().includes('TextModel') ||
      name.toLowerCase().includes('token')) {
    mcCount++;
    const sz = snap.getSize(i);
    mcSelf += sz;
    mcRet += retained[i];
    if (sz > 10000) mcObjs.push({ name: name.slice(0, 80), selfSize: sz, retSize: retained[i], idx: i, type });
  }
}
console.log(`  Objects: ${mcCount}, Self: ${HeapSnapshot.fmt(mcSelf)}, Retained: ${HeapSnapshot.fmt(mcRet)}`);
if (mcObjs.length > 0) {
  console.log('  Largest (>10KB):');
  mcObjs.sort((a, b) => b.selfSize - a.selfSize).slice(0, 10).forEach(o => {
    console.log(`  ${HeapSnapshot.fmt(o.selfSize).padStart(8)} ret:${HeapSnapshot.fmt(o.retSize).padStart(8)} | ${o.type}: ${o.name}`);
  });
}

// ── 3. Large strings ──
console.log(`\n=== TOP 25 LARGEST STRINGS (concat + regular) ===`);
const largeStrs = [];
for (let i = 0; i < snap.nodeCount; i++) {
  const t = snap.getType(i);
  if (t !== 'string' && t !== 'concatenated string') continue;
  const sz = snap.getSize(i);
  if (sz > 20000) largeStrs.push({ name: snap.getName(i).slice(0, 120), size: sz, type: t });
}
largeStrs.sort((a, b) => b.size - a.size);
largeStrs.slice(0, 25).forEach(s => {
  console.log(`  ${HeapSnapshot.fmt(s.size).padStart(8)} | ${s.type.padEnd(22)} | ${s.name}`);
});

// ── 4. Native memory ──
console.log(`\n=== NATIVE ExternalStringData ===`);
let extCount = 0, extSelf = 0, extRet = 0;
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) === 'native' && snap.getName(i) === 'system / ExternalStringData') {
    extCount++;
    extSelf += snap.getSize(i);
    extRet += retained[i];
  }
}
console.log(`  Count: ${extCount}, Self: ${HeapSnapshot.fmt(extSelf)}, Retained: ${HeapSnapshot.fmt(extRet)}`);

console.log(`\n=== JSArrayBufferData ===`);
let bufCount = 0, bufSelf = 0;
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) === 'native' && snap.getName(i) === 'system / JSArrayBufferData') {
    bufCount++;
    bufSelf += snap.getSize(i);
  }
}
console.log(`  Count: ${bufCount}, Self: ${HeapSnapshot.fmt(bufSelf)}`);

// Buffer owners
console.log(`\n=== TOP ArrayBuffer OWNERS ===`);
const bufOwners = new Map();
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) !== 'native' || snap.getName(i) !== 'system / JSArrayBufferData') continue;
  const refs = snap.reverseRefs.get(i) || [];
  for (const refIdx of refs) {
    const ownerName = snap.getName(refIdx);
    const key = ownerName.length > 60 ? ownerName.slice(0, 57) + '...' : ownerName;
    const cur = bufOwners.get(key) || { count: 0, size: 0 };
    cur.count++;
    cur.size += snap.getSize(i);
    bufOwners.set(key, cur);
  }
}
[...bufOwners.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 15)
  .forEach(([k, v]) => console.log(`  ${String(v.count).padStart(5)} bufs | ${HeapSnapshot.fmt(v.size).padStart(7)} | ${k}`));

// ── 5. React ──
let fiberCount = 0, fiberSelf = 0, fiberRet = 0;
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getName(i) === 'FiberNode') {
    fiberCount++;
    fiberSelf += snap.getSize(i);
    fiberRet += retained[i];
  }
}
console.log(`\n=== React FiberNodes: ${fiberCount}, Self: ${HeapSnapshot.fmt(fiberSelf)}, Retained: ${HeapSnapshot.fmt(fiberRet)} ===`);

// ── 6. Top types by self + retained ──
console.log(`\n=== TOP TYPES BY SELF SIZE ===`);
const byType = new Map();
for (let i = 0; i < snap.nodeCount; i++) {
  const key = snap.getType(i);
  const cur = byType.get(key) || { self: 0, ret: 0 };
  cur.self += snap.getSize(i);
  cur.ret += retained[i];
  byType.set(key, cur);
}
[...byType.entries()]
  .sort((a, b) => b[1].self - a[1].self)
  .slice(0, 15)
  .forEach(([k, v]) => {
    console.log(`  self:${HeapSnapshot.fmt(v.self).padStart(8)} ret:${HeapSnapshot.fmt(v.ret).padStart(8)} | ${k}`);
  });

// ── 7. Top retained large objects with retainer chains ──
console.log(`\n=== TOP 10 LARGEST BY RETAINED (with retainer chains) ===`);
const topRet = [];
for (let i = 0; i < snap.nodeCount; i++) {
  if (retained[i] > 500000) topRet.push({ idx: i, type: snap.getType(i), name: snap.getName(i), selfSize: snap.getSize(i), retSize: retained[i] });
}
topRet.sort((a, b) => b.retSize - a.retSize);
topRet.slice(0, 10).forEach(o => {
  console.log(`\n  ${HeapSnapshot.fmt(o.retSize)} (self: ${HeapSnapshot.fmt(o.selfSize)}) | ${o.type}: ${o.name.slice(0, 80)}`);
  const path = snap.traceRetainerPath(o.idx, 10);
  if (path) {
    path.slice(0, 6).forEach((p, d) => {
      const indent = '    ' + '  '.repeat(d);
      const edge = p.viaEdge ? `--${p.viaEdge}--> ` : '';
      console.log(`${indent}${edge}${p.type}: ${(p.name || '(anon)').slice(0, 70)}`);
    });
    if (path.length > 6) console.log('    ...');
  } else {
    console.log('    (detached from GC root)');
  }
});

const totalSelf = [...byType.values()].reduce((a, b) => a + b.self, 0);
const totalRet = [...byType.values()].reduce((a, b) => a + b.ret, 0);
console.log(`\nTotal self: ${HeapSnapshot.fmt(totalSelf)}  |  Total retained (excl): ${HeapSnapshot.fmt(totalRet)}`);
