// Deep analysis: detached DOM, xterm, native memory — with retainer chains to GC root.
// Usage: node scripts/analyze-deep.mjs <heapsnapshot>
import { loadSnapshot, HeapSnapshot } from './heap-utils.mjs';

const file = process.argv[2];
if (!file) { console.error('Usage: node analyze-deep.mjs <heapsnapshot>'); process.exit(1); }

const snap = loadSnapshot(file);
const { retained, shared } = snap.computeRetainedSizes();

// ── 1. Detached DOM nodes with retainer path ──
console.log('=== DETACHED DOM (>100KB) WITH RETAINER CHAINS ===');
let detachedTotal = 0;
const detached = [];
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) !== 'native') continue;
  if (snap.getSize(i) < 100000) continue;
  // Check reachability: if reverseRefs is empty, it has no incoming pointers = truly detached
  const refs = snap.reverseRefs.get(i);
  if (!refs || refs.length === 0) {
    // Truly unreachable node
    const sz = snap.getSize(i);
    detached.push({ idx: i, name: snap.getName(i), size: sz });
    detachedTotal += sz;
  }
}

// Also find reachable-but-large detached native nodes
const reachableLarge = [];
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) !== 'native') continue;
  if (snap.getSize(i) < 100000) continue;
  const refs = snap.reverseRefs.get(i);
  if (refs && refs.length > 0) {
    reachableLarge.push({ idx: i, name: snap.getName(i), size: snap.getSize(i), refs });
  }
}

// Report truly unreachable (pure leak)
console.log(`\nTruly unreachable (>100KB): ${detached.length} entries, ${HeapSnapshot.fmt(detachedTotal)}`);
detached.sort((a, b) => b.size - a.size).forEach(d => {
  console.log(`  ${HeapSnapshot.fmt(d.size)} | ${d.name}`);
});

// Report reachable large native nodes with what holds them
console.log(`\nReachable large native (>100KB): ${reachableLarge.length} entries, ${HeapSnapshot.fmt(reachableLarge.reduce((s, e) => s + e.size, 0))}`);
reachableLarge.sort((a, b) => b.size - a.size).slice(0, 15).forEach(d => {
  console.log(`\n  ${HeapSnapshot.fmt(d.size)} | ${d.name}  (held by ${d.refs.length} refs)`);
  // Show unique object types that reference this
  const ownerTypes = new Map();
  for (const refIdx of d.refs) {
    const key = `${snap.getType(refIdx)}: ${snap.getName(refIdx).slice(0, 60)}`;
    ownerTypes.set(key, (ownerTypes.get(key) || 0) + 1);
  }
  [...ownerTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([k, c]) => console.log(`    ${c}x ${k}`));

  // Trace shortest retainer path
  const path = snap.traceRetainerPath(d.idx, 8);
  if (path) {
    console.log('    Shortest path from root:');
    path.forEach((p, depth) => {
      const indent = '      ' + '  '.repeat(depth);
      const edge = p.viaEdge ? `--${p.viaEdge}--> ` : '';
      console.log(`${indent}${edge}${p.type}: ${(p.name || '(anon)').slice(0, 70)}`);
    });
  }
});

// ── 2. Xterm / terminal ──
console.log('\n\n=== XTERM / TERMINAL RELATED ===');
let xtCount = 0, xtSelf = 0, xtRet = 0;
const xtObjs = [];
for (let i = 0; i < snap.nodeCount; i++) {
  const name = snap.getName(i);
  if (name.toLowerCase().includes('xterm') || name.toLowerCase().includes('terminal') ||
      name.includes('pty') || name.includes('Terminal') || name.includes('Webgl')) {
    xtCount++;
    const sz = snap.getSize(i);
    xtSelf += sz;
    xtRet += retained[i];
    if (sz > 10000) xtObjs.push({ name, selfSize: sz, retSize: retained[i], idx: i, type: snap.getType(i) });
  }
}
console.log(`Count: ${xtCount}, Self: ${HeapSnapshot.fmt(xtSelf)}, Retained: ${HeapSnapshot.fmt(xtRet)}`);
if (xtObjs.length > 0) {
  console.log('Largest xterm objects:');
  xtObjs.sort((a, b) => b.selfSize - a.selfSize).slice(0, 10).forEach(o => {
    console.log(`  ${HeapSnapshot.fmt(o.selfSize)} ret:${HeapSnapshot.fmt(o.retSize)} | ${o.type}: ${o.name.slice(0, 80)}`);
  });
}

// ── 3. ArrayBuffer owners (with retainer chains for large ones) ──
console.log('\n\n=== TOP ArrayBuffer OWNERS ===');
const bufOwners = new Map();
const bigBufs = [];
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) !== 'native' || snap.getName(i) !== 'system / JSArrayBufferData') continue;
  const sz = snap.getSize(i);
  const refs = snap.reverseRefs.get(i) || [];
  if (sz > 50000) bigBufs.push({ idx: i, size: sz, refs: refs.length });
  for (const refIdx of refs) {
    const ownerName = snap.getName(refIdx);
    const key = ownerName.length > 55 ? ownerName.slice(0, 52) + '...' : ownerName;
    const cur = bufOwners.get(key) || { count: 0, size: 0 };
    cur.count++;
    cur.size += sz;
    bufOwners.set(key, cur);
  }
}
[...bufOwners.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 15)
  .forEach(([k, v]) => console.log(`  ${String(v.count).padStart(5)} bufs | ${HeapSnapshot.fmt(v.size).padStart(7)} | ${k}`));

if (bigBufs.length > 0) {
  console.log(`\nLarge ArrayBuffer retainer chains (>50KB, top 5):`);
  bigBufs.sort((a, b) => b.size - a.size).slice(0, 5).forEach(b => {
    console.log(`\n  ${HeapSnapshot.fmt(b.size)} (${b.refs} refs)`);
    const path = snap.traceRetainerPath(b.idx, 8);
    if (path) {
      path.forEach((p, d) => {
        const indent = '    ' + '  '.repeat(d);
        const edge = p.viaEdge ? `--${p.viaEdge}--> ` : '';
        console.log(`${indent}${edge}${p.type}: ${(p.name || '(anon)').slice(0, 70)}`);
      });
    }
  });
}

// ── 4. Object types with counts and retained ──
console.log('\n\n=== TOP OBJECT TYPES (by self, with retained) ===');
const objTypes = new Map();
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) !== 'object') continue;
  const name = snap.getName(i);
  const key = `object:${name}`;
  const cur = objTypes.get(key) || { count: 0, self: 0, ret: 0 };
  cur.count++;
  cur.self += snap.getSize(i);
  cur.ret += retained[i];
  objTypes.set(key, cur);
}
[...objTypes.entries()]
  .sort((a, b) => b[1].self - a[1].self)
  .slice(0, 25)
  .forEach(([k, v]) => {
    console.log(`  ${String(v.count).padStart(6)} | self:${HeapSnapshot.fmt(v.self).padStart(7)} ret:${HeapSnapshot.fmt(v.ret).padStart(7)} | ${k}`);
  });

// ── 5. Native memory by category ──
console.log('\n\n=== NATIVE MEMORY BY CATEGORY (with retained) ===');
const nativeCats = new Map();
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) !== 'native') continue;
  const name = snap.getName(i);
  const cur = nativeCats.get(name) || { count: 0, self: 0, ret: 0 };
  cur.count++;
  cur.self += snap.getSize(i);
  cur.ret += retained[i];
  nativeCats.set(name, cur);
}
[...nativeCats.entries()]
  .sort((a, b) => b[1].self - a[1].self)
  .slice(0, 20)
  .forEach(([k, v]) => {
    console.log(`  ${String(v.count).padStart(6)} | self:${HeapSnapshot.fmt(v.self).padStart(8)} ret:${HeapSnapshot.fmt(v.ret).padStart(8)} | ${k}`);
  });

// ── 6. Top Detached DOM by retainer component ──
console.log('\n\n=== DETACHED DOM BY RETAINER (DOM nodes held by JS) ===');
// Find all native nodes that ARE reachable from root, categorized by who holds them
const domByOwner = new Map();
for (let i = 0; i < snap.nodeCount; i++) {
  if (snap.getType(i) !== 'native') continue;
  const refs = snap.reverseRefs.get(i);
  if (!refs || refs.length === 0) continue;
  const sz = snap.getSize(i);
  if (sz < 5000) continue; // skip tiny

  // Aggregate by what object type holds this native node
  for (const refIdx of refs) {
    const ownerKey = snap.getName(refIdx).slice(0, 80);
    const cur = domByOwner.get(ownerKey) || { count: 0, size: 0 };
    cur.count++;
    cur.size += sz;
    domByOwner.set(ownerKey, cur);
  }
}
[...domByOwner.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 20)
  .forEach(([k, v]) => {
    console.log(`  ${String(v.count).padStart(6)} nodes | ${HeapSnapshot.fmt(v.size).padStart(8)} | held by: ${k}`);
  });

console.log('');
