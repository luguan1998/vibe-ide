// Analyze V8 heap snapshot: top memory by self-size, retained-size, retainer chains.
// Usage: node scripts/analyze-heap.mjs <heapsnapshot>
import { loadSnapshot, HeapSnapshot } from './heap-utils.mjs';

const file = process.argv[2];
if (!file) { console.error('Usage: node analyze-heap.mjs <heapsnapshot>'); process.exit(1); }

const snap = loadSnapshot(file);
console.error(`  Nodes: ${snap.nodeCount.toLocaleString()}`);
console.error(`  Edges: ${snap.edgeCount.toLocaleString()}`);

const { retained } = snap.computeRetainedSizes();

// ── Top types by self-size ──
console.log('\n=== Top 30 by SELF SIZE ===');
const byTypeSelf = new Map();
for (let i = 0; i < snap.nodeCount; i++) {
  const type = snap.getType(i);
  const name = snap.getName(i);
  const key = (type === 'object' || type === 'closure') ? `${type}:${name}` : type;
  const cur = byTypeSelf.get(key);
  if (!cur) byTypeSelf.set(key, { count: 0, selfSize: 0 });
  const e = byTypeSelf.get(key);
  e.count++;
  e.selfSize += snap.getSize(i);
}
[...byTypeSelf.entries()]
  .sort((a, b) => b[1].selfSize - a[1].selfSize)
  .slice(0, 30)
  .forEach(([k, v]) => {
    console.log(`  ${HeapSnapshot.fmt(v.selfSize).padStart(8)} | ${String(v.count).padStart(8)} | ${k}`);
  });

// ── Top types by retained size ──
console.log('\n=== Top 30 by RETAINED SIZE (exclusive children) ===');
const byTypeRet = new Map();
for (let i = 0; i < snap.nodeCount; i++) {
  const type = snap.getType(i);
  const name = snap.getName(i);
  const key = (type === 'object' || type === 'closure') ? `${type}:${name}` : type;
  const cur = byTypeRet.get(key);
  if (!cur) byTypeRet.set(key, { count: 0, retSize: 0 });
  const e = byTypeRet.get(key);
  e.count++;
  e.retSize += retained[i];
}
[...byTypeRet.entries()]
  .sort((a, b) => b[1].retSize - a[1].retSize)
  .slice(0, 30)
  .forEach(([k, v]) => {
    console.log(`  ${HeapSnapshot.fmt(v.retSize).padStart(8)} | ${String(v.count).padStart(8)} | ${k}`);
  });

// ── Largest individual objects (self-size) ──
console.log('\n=== Top 40 Largest Individual Objects (>50KB self) ===');
const largest = [];
for (let i = 0; i < snap.nodeCount; i++) {
  const sz = snap.getSize(i);
  if (sz > 50000) {
    largest.push({ idx: i, type: snap.getType(i), name: snap.getName(i), selfSize: sz, retained: retained[i] });
  }
}
largest.sort((a, b) => b.selfSize - a.selfSize);
largest.slice(0, 40).forEach(o => {
  console.log(`  ${HeapSnapshot.fmt(o.selfSize).padStart(8)} | ${HeapSnapshot.fmt(o.retained).padStart(8)} | ${o.type.padEnd(25)} | ${o.name.slice(0, 100)}`);
});

// ── Retainer chains for top 10 largest objects ──
console.log('\n=== RETAINER CHAINS (top 10 largest by self-size, path from GC root) ===');
largest.slice(0, 10).forEach(o => {
  console.log(`\n  --- ${HeapSnapshot.fmt(o.selfSize)} | ${o.type} | ${o.name.slice(0, 80)} ---`);
  const path = snap.traceRetainerPath(o.idx, 12);
  if (path) {
    path.forEach((p, d) => {
      const indent = '  '.repeat(d + 1);
      const edge = p.viaEdge ? ` --${p.viaEdge}--> ` : '';
      console.log(`${indent}${edge}${p.type}: ${(p.name || '(anonymous)').slice(0, 80)}`);
    });
  } else {
    console.log('    (unreachable from root — detached)');
  }
});

// ── Large strings ──
console.log('\n=== Large Strings (source maps, base64, etc.) ===');
const bigStrs = [];
for (let i = 0; i < snap.nodeCount; i++) {
  const t = snap.getType(i);
  if (t !== 'string' && t !== 'concatenated string') continue;
  const sz = snap.getSize(i);
  if (sz > 20000) bigStrs.push({ size: sz, name: snap.getName(i), idx: i });
}
bigStrs.sort((a, b) => b.size - a.size);
bigStrs.slice(0, 20).forEach(s => {
  console.log(`  ${HeapSnapshot.fmt(s.size).padStart(8)} | ${s.name.slice(0, 120)}`);
});

// ── Summary ──
const totalSelf = [...byTypeSelf.values()].reduce((a, b) => a + b.selfSize, 0);
const totalRet = [...byTypeRet.values()].reduce((a, b) => a + b.retSize, 0);
console.log(`\nTotal self: ${HeapSnapshot.fmt(totalSelf)}  |  Total retained (exclusive): ${HeapSnapshot.fmt(totalRet)}`);
