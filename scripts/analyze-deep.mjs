// Deep analysis: find what's holding native memory in the renderer
import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) { console.error('Usage: node analyze-deep.mjs <heapsnapshot>'); process.exit(1); }

const data = JSON.parse(readFileSync(file, 'utf-8'));
const meta = data.snapshot.meta;
const nodeFields = meta.node_fields;
const nf = nodeFields.length;
const nodeTypes = meta.node_types[0];
const nodes = data.nodes;
const strings = data.strings;
const nodeCount = nodes.length / nf;

const nameI = nodeFields.indexOf('name');
const typeI = nodeFields.indexOf('type');
const sizeI = nodeFields.indexOf('self_size');
const edgeI = nodeFields.indexOf('edge_count');
const idI = nodeFields.indexOf('id');

const edgeFields = meta.edge_fields;
const ef = edgeFields.length;
const edgeTypes = meta.edge_types[0];
const edges = data.edges;
const edgeTypeI = edgeFields.indexOf('type');
const edgeNameI = edgeFields.indexOf('name_or_index');
const edgeToI = edgeFields.indexOf('to_node');

function getType(i) { return nodeTypes[nodes[i * nf + typeI]]; }
function getName(i) { return strings[nodes[i * nf + nameI]]; }
function getSize(i) { return nodes[i * nf + sizeI]; }
function getEdgeCount(i) { return nodes[i * nf + edgeI]; }

// Build reverse edge map: which nodes reference a given node
const refsByTarget = new Map();
let edgeOffset = 0;
for (let i = 0; i < nodeCount; i++) {
  const ec = getEdgeCount(i);
  for (let j = 0; j < ec; j++) {
    const off = (edgeOffset + j) * ef;
    const to = edges[off + edgeToI];
    if (!refsByTarget.has(to)) refsByTarget.set(to, []);
    refsByTarget.get(to).push(i);
  }
  edgeOffset += ec;
}

// 1. Find all detached DOM nodes (not reachable from root)
console.log('=== DETACHED DOM TREE FRAGMENTS (>100KB) ===');
let detachedTotal = 0;
let detachedCount = 0;
for (let i = 0; i < nodeCount; i++) {
  const type = getType(i);
  if (type !== 'native') continue;
  const name = getName(i);
  if (!name.startsWith('system / ')) continue;
  // Check if reachable from root
  if (!refsByTarget.has(i) && getSize(i) > 100000) {
    detachedCount++;
    detachedTotal += getSize(i);
  }
}
console.log(`  Total detached native: ${detachedCount} entries, ${(detachedTotal/1e6).toFixed(1)} MB`);

// 2. Search for xterm/terminal related objects
console.log('\n=== XTERM / TERMINAL RELATED ===');
let xtermSize = 0, xtermCount = 0;
for (let i = 0; i < nodeCount; i++) {
  const name = getName(i);
  if (name.toLowerCase().includes('xterm') || name.toLowerCase().includes('terminal') || name.includes('pty')) {
    xtermCount++;
    xtermSize += getSize(i);
  }
}
console.log(`  Count: ${xtermCount}, SelfSize: ${(xtermSize/1e6).toFixed(1)} MB`);

// 3. Find system/JSArrayBufferData and what owns them
console.log('\n=== TOP ArrayBuffer OWNERS ===');
const bufferOwners = new Map();
for (let i = 0; i < nodeCount; i++) {
  if (getType(i) !== 'native' || getName(i) !== 'system / JSArrayBufferData') continue;
  const refs = refsByTarget.get(i) || [];
  for (const ref of refs) {
    const ownerName = getName(ref);
    const key = ownerName.length > 60 ? ownerName.slice(0, 57) + '...' : ownerName;
    const cur = bufferOwners.get(key) || { count: 0, size: 0 };
    cur.count++;
    cur.size += getSize(i);
    bufferOwners.set(key, cur);
  }
}
[...bufferOwners.entries()]
  .sort((a,b) => b[1].size - a[1].size)
  .slice(0, 15)
  .forEach(([k,v]) => console.log(`  ${String(v.count).padStart(5)} bufs | ${(v.size/1e6).toFixed(1).padStart(6)} MB | ${k}`));

// 4. Count objects by "object:TypeName"
console.log('\n=== TOP OBJECT TYPES ===');
const objTypes = new Map();
for (let i = 0; i < nodeCount; i++) {
  const type = getType(i);
  if (type !== 'object') continue;
  const name = getName(i);
  const key = `object:${name}`;
  const cur = objTypes.get(key) || { count: 0, size: 0 };
  cur.count++;
  cur.size += getSize(i);
  objTypes.set(key, cur);
}
[...objTypes.entries()]
  .sort((a,b) => b[1].size - a[1].size)
  .slice(0, 20)
  .forEach(([k,v]) => console.log(`  ${String(v.count).padStart(6)} | ${(v.size/1e6).toFixed(1).padStart(6)} MB | ${k}`));

// 5. Check total native memory by category
console.log('\n=== NATIVE MEMORY BY CATEGORY ===');
const nativeCats = new Map();
for (let i = 0; i < nodeCount; i++) {
  if (getType(i) !== 'native') continue;
  const name = getName(i);
  const cur = nativeCats.get(name) || { count: 0, size: 0 };
  cur.count++;
  cur.size += getSize(i);
  nativeCats.set(name, cur);
}
[...nativeCats.entries()]
  .sort((a,b) => b[1].size - a[1].size)
  .slice(0, 15)
  .forEach(([k,v]) => console.log(`  ${String(v.count).padStart(6)} | ${(v.size/1e6).toFixed(1).padStart(7)} MB | ${k}`));

// 6. Check if Monaco workers are loaded
console.log('\n=== MONACO / WORKER / LANGUAGE SERVICE ===');
let workerSize = 0, workerCount = 0;
for (let i = 0; i < nodeCount; i++) {
  const name = getName(i);
  if (name.includes('Worker') || name.includes('worker') || name.includes('WorkerGlobalScope') ||
      name.includes('typescript') || name.includes('TypeScript') ||
      name.includes('language') || name.includes('Language')) {
    workerCount++;
    workerSize += getSize(i);
  }
}
console.log(`  Count: ${workerCount}, SelfSize: ${(workerSize/1e6).toFixed(1)} MB`);
