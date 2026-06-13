// Diff two heap snapshots: find what grew/shrunk between "before" and "after".
// Usage: node scripts/analyze-diff.mjs <before.heapsnapshot> <after.heapsnapshot>
import { loadSnapshot, HeapSnapshot } from './heap-utils.mjs';

const beforeFile = process.argv[2];
const afterFile = process.argv[3];
if (!beforeFile || !afterFile) {
  console.error('Usage: node analyze-diff.mjs <before.heapsnapshot> <after.heapsnapshot>');
  process.exit(1);
}

const before = loadSnapshot(beforeFile);
const after = loadSnapshot(afterFile);
const bRet = before.computeRetainedSizes().retained;
const aRet = after.computeRetainedSizes().retained;

console.error(`Before: ${before.nodeCount.toLocaleString()} nodes`);
console.error(`After:  ${after.nodeCount.toLocaleString()} nodes`);

// ── Type-level diff: which types grew/shrunk the most ──
console.log('\n=== TYPE-LEVEL DIFF (self size) ===');
const bByType = new Map();
const aByType = new Map();
for (let i = 0; i < before.nodeCount; i++) {
  const key = before.getType(i);
  bByType.set(key, (bByType.get(key) || 0) + before.getSize(i));
}
for (let i = 0; i < after.nodeCount; i++) {
  const key = after.getType(i);
  aByType.set(key, (aByType.get(key) || 0) + after.getSize(i));
}

const allTypes = new Set([...bByType.keys(), ...aByType.keys()]);
const typeDiffs = [];
for (const t of allTypes) {
  const b = bByType.get(t) || 0;
  const a = aByType.get(t) || 0;
  typeDiffs.push({ type: t, before: b, after: a, delta: a - b });
}
typeDiffs.sort((a, b) => b.delta - a.delta);

// Increased
console.log('\n--- INCREASED (top 20) ---');
typeDiffs.filter(d => d.delta > 0).slice(0, 20).forEach(d => {
  console.log(`  +${HeapSnapshot.fmt(d.delta).padStart(8)} | ${HeapSnapshot.fmt(d.before).padStart(8)} → ${HeapSnapshot.fmt(d.after).padStart(8)} | ${d.type}`);
});

// Decreased
console.log('\n--- DECREASED (top 20) ---');
typeDiffs.filter(d => d.delta < 0).slice(0, 20).forEach(d => {
  console.log(`  ${HeapSnapshot.fmt(d.delta).padStart(8)} | ${HeapSnapshot.fmt(d.before).padStart(8)} → ${HeapSnapshot.fmt(d.after).padStart(8)} | ${d.type}`);
});

// ── Object-type diff (object:Name pattern) ──
console.log('\n=== OBJECT-TYPE DIFF (self, >0.05MB change) ===');
const bObj = new Map();
const aObj = new Map();
for (let i = 0; i < before.nodeCount; i++) {
  if (before.getType(i) !== 'object') continue;
  const key = `object:${before.getName(i)}`;
  bObj.set(key, (bObj.get(key) || 0) + before.getSize(i));
}
for (let i = 0; i < after.nodeCount; i++) {
  if (after.getType(i) !== 'object') continue;
  const key = `object:${after.getName(i)}`;
  aObj.set(key, (aObj.get(key) || 0) + after.getSize(i));
}
const allObj = new Set([...bObj.keys(), ...aObj.keys()]);
const objDiffs = [];
for (const t of allObj) {
  const b = bObj.get(t) || 0;
  const a = aObj.get(t) || 0;
  const d = a - b;
  if (Math.abs(d) > 50000) objDiffs.push({ type: t, before: b, after: a, delta: d });
}
objDiffs.sort((a, b) => b.delta - a.delta);
objDiffs.forEach(d => {
  const sign = d.delta >= 0 ? '+' : '';
  console.log(`  ${sign}${HeapSnapshot.fmt(d.delta).padStart(8)} | ${HeapSnapshot.fmt(d.before).padStart(8)} → ${HeapSnapshot.fmt(d.after).padStart(8)} | ${d.type}`);
});

// ── New large objects in "after" that weren't in "before" ──
console.log('\n=== NEW LARGE OBJECTS IN AFTER (>200KB, top 15) ===');
// Build a Set of "before" node names for rough dedup (imperfect but useful)
const bNames = new Set();
for (let i = 0; i < before.nodeCount; i++) {
  if (before.getSize(i) > 50000) bNames.add(before.getName(i));
}
const newLarge = [];
for (let i = 0; i < after.nodeCount; i++) {
  const sz = after.getSize(i);
  if (sz > 200000) {
    const name = after.getName(i);
    // Approximate: check if a node with same name+size existed in before
    if (!bNames.has(name)) {
      newLarge.push({ idx: i, name, size: sz, type: after.getType(i), retSize: aRet[i] });
    }
  }
}
newLarge.sort((a, b) => b.size - a.size);
newLarge.slice(0, 15).forEach(o => {
  console.log(`  ${HeapSnapshot.fmt(o.size)} ret:${HeapSnapshot.fmt(o.retSize)} | ${o.type}: ${o.name.slice(0, 80)}`);
  // Trace retainer for new large objects
  const path = after.traceRetainerPath(o.idx, 6);
  if (path) {
    path.slice(0, 4).forEach((p, d) => {
      const indent = '    ' + '  '.repeat(d);
      const edge = p.viaEdge ? `--${p.viaEdge}--> ` : '';
      console.log(`${indent}${edge}${p.type}: ${(p.name || '(anon)').slice(0, 60)}`);
    });
    if (path.length > 4) console.log('    ...');
  }
});

// ── Objects that disappeared (in before but not after) ──
console.log('\n=== REMOVED LARGE OBJECTS (>200KB, top 10) ===');
const aNames = new Set();
for (let i = 0; i < after.nodeCount; i++) {
  if (after.getSize(i) > 50000) aNames.add(after.getName(i));
}
const removed = [];
for (let i = 0; i < before.nodeCount; i++) {
  const sz = before.getSize(i);
  if (sz > 200000 && !aNames.has(before.getName(i))) {
    removed.push({ name: before.getName(i), size: sz, type: before.getType(i) });
  }
}
removed.sort((a, b) => b.size - a.size);
removed.slice(0, 10).forEach(o => {
  console.log(`  ${HeapSnapshot.fmt(o.size)} | ${o.type}: ${o.name.slice(0, 80)}`);
});

// ── Native category diff ──
console.log('\n=== NATIVE MEMORY BY CATEGORY DIFF (>0.05MB change) ===');
const bNative = new Map();
const aNative = new Map();
for (let i = 0; i < before.nodeCount; i++) {
  if (before.getType(i) !== 'native') continue;
  const key = before.getName(i);
  bNative.set(key, (bNative.get(key) || 0) + before.getSize(i));
}
for (let i = 0; i < after.nodeCount; i++) {
  if (after.getType(i) !== 'native') continue;
  const key = after.getName(i);
  aNative.set(key, (aNative.get(key) || 0) + after.getSize(i));
}
const allNat = new Set([...bNative.keys(), ...aNative.keys()]);
const natDiffs = [];
for (const t of allNat) {
  const b = bNative.get(t) || 0;
  const a = aNative.get(t) || 0;
  const d = a - b;
  if (Math.abs(d) > 50000) natDiffs.push({ type: t, before: b, after: a, delta: d });
}
natDiffs.sort((a, b) => b.delta - a.delta);
natDiffs.forEach(d => {
  const sign = d.delta >= 0 ? '+' : '';
  console.log(`  ${sign}${HeapSnapshot.fmt(d.delta).padStart(8)} | ${HeapSnapshot.fmt(d.before).padStart(8)} → ${HeapSnapshot.fmt(d.after).padStart(8)} | ${d.type}`);
});

// ── Summary ──
const bTotal = [...bByType.values()].reduce((a, b) => a + b, 0);
const aTotal = [...aByType.values()].reduce((a, b) => a + b, 0);
console.log(`\nTotal self: ${HeapSnapshot.fmt(bTotal)} → ${HeapSnapshot.fmt(aTotal)}  (Δ ${HeapSnapshot.fmt(aTotal - bTotal)})`);
