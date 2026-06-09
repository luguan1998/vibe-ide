// Analyze V8 heap snapshot: top memory consumers by type, object count, retained size
import { readFileSync, writeFileSync } from 'fs';

class HeapAnalyzer {
  constructor(snapshot) {
    this.snapshot = snapshot.snapshot;
    this.strings = snapshot.strings;
    this.nodes = snapshot.nodes;
    this.edges = snapshot.edges;

    const meta = this.snapshot.meta;
    this.nodeFields = meta.node_fields;
    this.nodeFieldCount = this.nodeFields.length;
    this.nodeTypes = meta.node_types[0]; // array of type names
    this.edgeFields = meta.edge_fields;
    this.edgeFieldCount = this.edgeFields.length;
    this.edgeTypes = meta.edge_types[0];

    // Field indices
    this.nodeTypeIdx = this.nodeFields.indexOf('type');
    this.nodeNameIdx = this.nodeFields.indexOf('name');
    this.nodeIdIdx = this.nodeFields.indexOf('id');
    this.nodeSelfSizeIdx = this.nodeFields.indexOf('self_size');
    this.nodeEdgeCountIdx = this.nodeFields.indexOf('edge_count');
    this.nodeTraceNodeIdx = this.nodeFields.indexOf('trace_node_id');
    this.nodeDetachednessIdx = this.nodeFields.indexOf('detachedness');

    this.edgeTypeIdx = this.edgeFields.indexOf('type');
    this.edgeNameIdx = this.edgeFields.indexOf('name_or_index');
    this.edgeToNodeIdx = this.edgeFields.indexOf('to_node');

    this.nodeCount = this.nodes.length / this.nodeFieldCount;
    this.edgeCount = this.edges.length / this.edgeFieldCount;

    // Build node index: node_id -> node_index
    this.nodeByIndex = new Map();
    this.rootIndex = null;
    for (let i = 0; i < this.nodeCount; i++) {
      const offset = i * this.nodeFieldCount;
      const id = this.nodes[offset + this.nodeIdIdx];
      this.nodeByIndex.set(id, i);
      if (id === 1) this.rootIndex = i;
    }
  }

  getType(idx) {
    return this.nodeTypes[this.nodes[idx * this.nodeFieldCount + this.nodeTypeIdx]];
  }

  getName(idx) {
    const strIdx = this.nodes[idx * this.nodeFieldCount + this.nodeNameIdx];
    return this.strings[strIdx];
  }

  getSelfSize(idx) {
    return this.nodes[idx * this.nodeFieldCount + this.nodeSelfSizeIdx];
  }

  getEdgeCount(idx) {
    return this.nodes[idx * this.nodeFieldCount + this.nodeEdgeCountIdx];
  }

  getNodeId(idx) {
    return this.nodes[idx * this.nodeFieldCount + this.nodeIdIdx];
  }

  getNodeIndexById(id) {
    return this.nodeByIndex.get(id);
  }

  // Get outgoing edges for a node
  getEdges(nodeIdx) {
    // Find edge offset: sum edge counts of all previous nodes
    let edgeOffset = 0;
    for (let i = 0; i < nodeIdx; i++) {
      edgeOffset += this.getEdgeCount(i);
    }
    const count = this.getEdgeCount(nodeIdx);
    const edges = [];
    for (let i = 0; i < count; i++) {
      const offset = (edgeOffset + i) * this.edgeFieldCount;
      const type = this.edgeTypes[this.edges[offset + this.edgeTypeIdx]];
      const nameIdx = this.edges[offset + this.edgeNameIdx];
      const name = typeof nameIdx === 'number' ? (this.strings[nameIdx] || '') : '';
      const toNode = this.edges[offset + this.edgeToNodeIdx];
      edges.push({ type, name, toNode });
    }
    return edges;
  }

  // Calculate retained sizes using dominator tree
  // Simplified: group by type name with self sizes
  analyzeByType(topN = 30) {
    const byType = new Map();

    for (let i = 0; i < this.nodeCount; i++) {
      const type = this.getType(i);
      const name = this.getName(i);
      const selfSize = this.getSelfSize(i);

      const key = type === 'object' || type === 'closure' ? `${type}:${name}` : type;

      if (!byType.has(key)) {
        byType.set(key, { count: 0, selfSize: 0, objects: [] });
      }
      const entry = byType.get(key);
      entry.count++;
      entry.selfSize += selfSize;

      // Track top objects
      if (selfSize > 100000) {
        entry.objects.push({ name, selfSize, idx: i });
      }
    }

    const sorted = [...byType.entries()]
      .sort((a, b) => b[1].selfSize - a[1].selfSize)
      .slice(0, topN);

    return sorted;
  }

  // Find largest individual objects
  largestObjects(topN = 40) {
    const objects = [];
    for (let i = 0; i < this.nodeCount; i++) {
      const selfSize = this.getSelfSize(i);
      if (selfSize > 50000) {
        objects.push({
          type: this.getType(i),
          name: this.getName(i),
          selfSize,
          idx: i
        });
      }
    }
    return objects.sort((a, b) => b.selfSize - a.selfSize).slice(0, topN);
  }

  // Specialized: find strings by pattern
  findStrings(patterns, topN = 20) {
    const matches = [];
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.getType(i) !== 'string' && this.getType(i) !== 'concatenated string') continue;
      const name = this.getName(i);
      for (const p of patterns) {
        if (name.includes(p)) {
          matches.push({ name: name.length > 80 ? name.slice(0, 77) + '...' : name, selfSize: this.getSelfSize(i) });
          break;
        }
      }
    }
    return matches.sort((a, b) => b.selfSize - a.selfSize).slice(0, topN);
  }

  // Calculate dominator-based retained sizes (approximate)
  retainedSizes() {
    // Build reverse edges (children -> parent references via "element" or property edges)
    const retainedByType = new Map();
    const dominators = new Array(this.nodeCount).fill(-1);

    // For each node, compute retained: own size + sum of children's retained
    // Use a simple approximation: if a node has internal edges (element, property)
    // it "retains" those children

    // First pass: compute all edge targets
    const outgoingEdges = new Map(); // nodeIdx -> [targetNodeIndices]

    for (let i = 0; i < this.nodeCount; i++) {
      const edges = this.getEdges(i);
      const internalTargets = [];
      for (const e of edges) {
        if (e.type === 'internal' || e.type === 'element' || e.type === 'property' || e.type === 'hidden') {
          internalTargets.push(e.toNode);
        }
      }
      if (internalTargets.length > 0) {
        outgoingEdges.set(i, internalTargets);
      }
    }

    // DFS to calculate retained: start from root (id=1)
    const visited = new Set();
    const retained = new Map(); // nodeIdx -> retainedSize

    function dfs(idx) {
      if (visited.has(idx)) return retained.get(idx) || 0;
      visited.add(idx);
      let size = 0;
      const children = outgoingEdges.get(idx);
      if (children) {
        for (const childIdx of children) {
          size += dfs(childIdx);
        }
      }
      size += this.getSelfSize(idx);
      retained.set(idx, size);
      return size;
    }

    // Process all nodes from the root
    if (this.rootIndex !== null) {
      dfs(this.rootIndex);
    }

    // Aggregate by type
    for (let i = 0; i < this.nodeCount; i++) {
      if (!retained.has(i)) continue;
      const r = retained.get(i);
      const type = this.getType(i);
      const name = this.getName(i);
      const key = type === 'object' || type === 'closure' ? `${type}:${name}` : type;

      if (!retainedByType.has(key)) {
        retainedByType.set(key, { count: 0, retainedSize: 0 });
      }
      const entry = retainedByType.get(key);
      entry.count++;
      entry.retainedSize += r;
    }

    return [...retainedByType.entries()]
      .sort((a, b) => b[1].retainedSize - a[1].retainedSize)
      .slice(0, 40);
  }

  runFullAnalysis() {
    console.log('Analyzing heap snapshot...');
    console.log(`  Nodes: ${this.nodeCount.toLocaleString()}`);
    console.log(`  Edges: ${this.edgeCount.toLocaleString()}`);
    console.log();

    // By type (self size)
    console.log('=== Top 30 by SELF SIZE ===');
    const byType = this.analyzeByType(30);
    for (const [key, info] of byType) {
      console.log(`  ${(info.selfSize / 1e6).toFixed(1).padStart(7)} MB | ${String(info.count).padStart(8)} | ${key}`);
    }

    console.log();
    console.log('=== Top 40 Largest Individual Objects (>50KB self size) ===');
    const largest = this.largestObjects(40);
    for (const obj of largest) {
      console.log(`  ${(obj.selfSize / 1e6).toFixed(2).padStart(8)} MB | ${obj.type.padEnd(25)} | ${obj.name}`);
    }

    console.log();
    console.log('=== Top 40 by RETAINED SIZE (dominator tree) ===');
    const retained = this.retainedSizes();
    for (const [key, info] of retained) {
      console.log(`  ${(info.retainedSize / 1e6).toFixed(1).padStart(7)} MB | ${String(info.count).padStart(8)} | ${key}`);
    }

    console.log();
    console.log('=== Large Strings (base64, source code, etc.) ===');
    const bigStrs = this.findStrings(['data:', 'base64', 'sourceMappingURL', '<script', '.tsx', '.ts', 'node_modules', 'function', 'import '], 20);
    for (const s of bigStrs) {
      console.log(`  ${(s.selfSize / 1e6).toFixed(2).padStart(8)} MB | ${s.name}`);
    }
  }
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node analyze-heap.mjs <heapsnapshot file>');
  process.exit(1);
}

console.log(`Loading ${file}...`);
const data = JSON.parse(readFileSync(file, 'utf-8'));
console.log('Loaded.');

const analyzer = new HeapAnalyzer(data);
analyzer.runFullAnalysis();
