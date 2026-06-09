import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) { console.error('Usage: node analyze-v2.mjs <heapsnapshot>'); process.exit(1); }

console.log(`Loading ${file}...`);
const snapshot = JSON.parse(readFileSync(file, 'utf-8'));
console.log('Loaded.');

const meta = snapshot.snapshot.meta;
const nodeFields = meta.node_fields;
const nodeFieldCount = nodeFields.length;
const nodeTypes = meta.node_types[0];
const nodes = snapshot.nodes;
const strings = snapshot.strings;
const nodeCount = nodes.length / nodeFieldCount;

const nameIdx = nodeFields.indexOf('name');
const typeIdx = nodeFields.indexOf('type');
const selfSizeIdx = nodeFields.indexOf('self_size');
const idIdx = nodeFields.indexOf('id');

function getType(i) { return nodeTypes[nodes[i * nodeFieldCount + typeIdx]]; }
function getName(i) { return strings[nodes[i * nodeFieldCount + nameIdx]]; }
function getSelfSize(i) { return nodes[i * nodeFieldCount + selfSizeIdx]; }

// 1. Find ALL base64 data URLs and source maps
const base64Entries = [];
const sourceMapEntries = [];
const dataUrlEntries = [];

for (let i = 0; i < nodeCount; i++) {
  const name = getName(i);
  const size = getSelfSize(i);
  if (size < 1000) continue;

  if (name.startsWith('data:application/json;base64,')) {
    sourceMapEntries.push({ name: name.slice(0, 100), selfSize: size, idx: i });
  } else if (name.startsWith('data:')) {
    dataUrlEntries.push({ name: name.slice(0, 100), selfSize: size, idx: i });
  }
}

// Sort and report
sourceMapEntries.sort((a, b) => b.selfSize - a.selfSize);
dataUrlEntries.sort((a, b) => b.selfSize - a.selfSize);

// Total source map memory
const totalSourceMapSize = sourceMapEntries.reduce((s, e) => s + e.selfSize, 0);
const totalDataUrlSize = dataUrlEntries.reduce((s, e) => s + e.selfSize, 0);

console.log(`\n=== SOURCE MAPS (data:application/json;base64,...) ===`);
console.log(`Count: ${sourceMapEntries.length}, Total: ${(totalSourceMapSize / 1e6).toFixed(1)} MB`);
for (const e of sourceMapEntries.slice(0, 15)) {
  console.log(`  ${(e.selfSize / 1e6).toFixed(2).padStart(7)} MB | ${e.name}`);
}

console.log(`\n=== OTHER DATA URLs (images, etc.) ===`);
console.log(`Count: ${dataUrlEntries.length}, Total: ${(totalDataUrlSize / 1e6).toFixed(1)} MB`);
for (const e of dataUrlEntries.slice(0, 20)) {
  console.log(`  ${(e.selfSize / 1e6).toFixed(2).padStart(7)} MB | ${e.name}`);
}

// 2. Find all objects with "monaco" or "Monaco" in name
console.log(`\n=== MONACO / EDITOR related ===`);
let monacoCount = 0, monacoSize = 0;
for (let i = 0; i < nodeCount; i++) {
  const name = getName(i);
  const size = getSelfSize(i);
  const type = getType(i);
  if (name.toLowerCase().includes('monaco') || name.toLowerCase().includes('editor') || name.toLowerCase().includes('codicon')) {
    monacoCount++;
    monacoSize += size;
  }
}
console.log(`  Objects: ${monacoCount}, Total selfSize: ${(monacoSize / 1e6).toFixed(1)} MB`);

// 3. Large strings (all types)
console.log(`\n=== TOP 30 LARGEST STRINGS (concatenated + regular) ===`);
const largeStrs = [];
for (let i = 0; i < nodeCount; i++) {
  const type = getType(i);
  if (type !== 'string' && type !== 'concatenated string') continue;
  const size = getSelfSize(i);
  if (size > 20000) {
    largeStrs.push({ name: getName(i).slice(0, 100), size, type });
  }
}
largeStrs.sort((a, b) => b.size - a.size);
for (const s of largeStrs.slice(0, 30)) {
  console.log(`  ${(s.size / 1e6).toFixed(2).padStart(7)} MB | ${s.type.padEnd(22)} | ${s.name}`);
}

// 4. External strings (native memory) — these hold base64 data URLs outside V8 heap
console.log(`\n=== NATIVE ExternalStringData ===`);
let nativeExtTotal = 0;
let nativeExtCount = 0;
for (let i = 0; i < nodeCount; i++) {
  if (getType(i) === 'native' && getName(i) === 'system / ExternalStringData') {
    nativeExtTotal += getSelfSize(i);
    nativeExtCount++;
  }
}
console.log(`  Count: ${nativeExtCount}, Total: ${(nativeExtTotal / 1e6).toFixed(1)} MB`);

// 5. JSArrayBufferData
let bufTotal = 0, bufCount = 0;
for (let i = 0; i < nodeCount; i++) {
  if (getType(i) === 'native' && getName(i) === 'system / JSArrayBufferData') {
    bufTotal += getSelfSize(i);
    bufCount++;
  }
}
console.log(`  JSArrayBufferData: ${bufCount} entries, ${(bufTotal / 1e6).toFixed(1)} MB`);

// 6. React Fiber nodes
let fiberCount = 0, fiberSize = 0;
for (let i = 0; i < nodeCount; i++) {
  if (getName(i) === 'FiberNode') { fiberCount++; fiberSize += getSelfSize(i); }
}
console.log(`  React FiberNodes: ${fiberCount}, ${(fiberSize / 1e6).toFixed(1)} MB`);

// 7. Top types by self size (quick version)
console.log(`\n=== TOP TYPES BY SELF SIZE ===`);
const byType = new Map();
for (let i = 0; i < nodeCount; i++) {
  const key = getType(i);
  const cur = byType.get(key) || 0;
  byType.set(key, cur + getSelfSize(i));
}
[...byType.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([k, v]) => console.log(`  ${(v / 1e6).toFixed(1).padStart(7)} MB | ${k}`));

console.log(`\nTotal self sizes: ${([...byType.values()].reduce((a,b)=>a+b,0)/1e6).toFixed(1)} MB`);
