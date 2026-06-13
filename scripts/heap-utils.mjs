// Shared heap snapshot parsing & analysis utilities.
// Used by analyze-heap.mjs, analyze-v2.mjs, analyze-deep.mjs, analyze-diff.mjs.

import { readFileSync } from 'fs';

export function loadSnapshot(path) {
  console.error(`Loading ${path}...`);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  console.error('Loaded.');
  return new HeapSnapshot(data);
}

export class HeapSnapshot {
  constructor(data) {
    const meta = data.snapshot.meta;
    this.nodeFields = meta.node_fields;
    this.nf = this.nodeFields.length;
    this.nodeTypes = meta.node_types[0];
    this.nodes = data.nodes;
    this.strings = data.strings;

    this.edgeFields = meta.edge_fields;
    this.ef = this.edgeFields.length;
    this.edgeTypes = meta.edge_types[0];
    this.edges = data.edges;

    this.nodeCount = this.nodes.length / this.nf;
    this.edgeCount = this.edges.length / this.ef;

    // Field indices
    this.nameI = this.nodeFields.indexOf('name');
    this.typeI = this.nodeFields.indexOf('type');
    this.sizeI = this.nodeFields.indexOf('self_size');
    this.edgeCountI = this.nodeFields.indexOf('edge_count');
    this.idI = this.nodeFields.indexOf('id');
    this.detachI = this.nodeFields.indexOf('detachedness');

    this.edgeTypeI = this.edgeFields.indexOf('type');
    this.edgeNameI = this.edgeFields.indexOf('name_or_index');
    this.edgeToI = this.edgeFields.indexOf('to_node');

    // Precompute edge offsets for O(1) edge lookup
    this._edgeOff = new Uint32Array(this.nodeCount);
    let off = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      this._edgeOff[i] = off;
      off += this.getEdgeCount(i);
    }

    // Build id->index map
    this._idToIdx = new Map();
    for (let i = 0; i < this.nodeCount; i++) {
      this._idToIdx.set(this.getNodeId(i), i);
    }
    this.rootIdx = this._idToIdx.get(1) ?? null;

    // Build reverse edges for retainer tracing
    this._buildReverseEdges();
  }

  getType(i)   { return this.nodeTypes[this.nodes[i * this.nf + this.typeI]]; }
  getName(i)   { return this.strings[this.nodes[i * this.nf + this.nameI]]; }
  getSize(i)   { return this.nodes[i * this.nf + this.sizeI]; }
  getEdgeCount(i) { return this.nodes[i * this.nf + this.edgeCountI]; }
  getNodeId(i) { return this.nodes[i * this.nf + this.idI]; }

  getEdges(i) {
    const start = this._edgeOff[i];
    const count = this.getEdgeCount(i);
    const out = new Array(count);
    for (let j = 0; j < count; j++) {
      const off = (start + j) * this.ef;
      const type = this.edgeTypes[this.edges[off + this.edgeTypeI]];
      const nameIdx = this.edges[off + this.edgeNameI];
      const name = typeof nameIdx === 'number' ? (this.strings[nameIdx] || '') : '';
      const toIdx = this.edges[off + this.edgeToI];
      out[j] = { type, name, toIdx };
    }
    return out;
  }

  _buildReverseEdges() {
    // reverseRefs[targetIdx] = [sourceIdx, ...]
    this.reverseRefs = new Map();
    for (let i = 0; i < this.nodeCount; i++) {
      const count = this.getEdgeCount(i);
      const start = this._edgeOff[i];
      for (let j = 0; j < count; j++) {
        const toIdx = this.edges[(start + j) * this.ef + this.edgeToI];
        if (!this.reverseRefs.has(toIdx)) {
          this.reverseRefs.set(toIdx, []);
        }
        this.reverseRefs.get(toIdx).push(i);
      }
    }
  }

  /**
   * Trace shortest path from GC root (id=1) to target node.
   * Returns array of { idx, type, name, viaEdge } from root to target.
   */
  traceRetainerPath(targetIdx, maxDepth = 15) {
    if (this.rootIdx === null) return null;
    // BFS from target backwards to root, using reverse edges
    const visited = new Set();
    const parent = new Map(); // childIdx -> { parentIdx, edgeName, edgeType }
    let queue = [targetIdx];
    visited.add(targetIdx);
    let found = false;

    while (queue.length > 0 && !found) {
      const next = [];
      for (const cur of queue) {
        const refs = this.reverseRefs.get(cur);
        if (!refs) continue;
        for (const src of refs) {
          if (visited.has(src)) continue;
          visited.add(src);
          // Find the edge from src -> cur
          const edges = this.getEdges(src);
          const e = edges.find(e => e.toIdx === cur);
          parent.set(src, { parentIdx: cur, edgeName: e?.name || '', edgeType: e?.type || '' });
          if (src === this.rootIdx) {
            found = true;
            break;
          }
          next.push(src);
        }
        if (found) break;
      }
      if (!found) queue = next;
    }

    if (!parent.has(this.rootIdx)) return null;

    // Walk forward from root to target
    const path = [];
    let cur = this.rootIdx;
    let depth = 0;
    while (cur !== targetIdx && depth < maxDepth) {
      path.push({
        idx: cur,
        type: this.getType(cur),
        name: this.getName(cur),
        viaEdge: ''
      });
      // Find which child goes toward target
      const edges = this.getEdges(cur);
      let nextNode = null;
      for (const e of edges) {
        let p = e.toIdx;
        // Walk the parent chain from e.toIdx toward root — if it reaches cur, it's on the path
        let walk = p;
        let steps = 0;
        while (walk !== this.rootIdx && walk !== cur && steps < 100) {
          const up = parent.get(walk);
          if (!up) break;
          walk = up.parentIdx;
          steps++;
        }
        if (walk === cur && parent.has(p)) {
          nextNode = { idx: p, viaEdge: e.name || `[${e.type}]` };
          break;
        }
      }
      if (!nextNode) break;
      path[path.length - 1].viaEdge = nextNode.viaEdge;
      cur = nextNode.idx;
      depth++;
    }
    if (cur === targetIdx) {
      path.push({
        idx: cur,
        type: this.getType(cur),
        name: this.getName(cur),
        viaEdge: ''
      });
    }
    return path;
  }

  /**
   * Approximate retained size: self_size + sum of children's retained
   * where child is ONLY reachable through this parent.
   * Uses iterative bottom-up approach.
   */
  computeRetainedSizes() {
    // Count incoming internal/property/element edges for each node
    const inDegree = new Uint32Array(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i++) {
      const edges = this.getEdges(i);
      for (const e of edges) {
        if (e.type === 'internal' || e.type === 'property' ||
            e.type === 'element' || e.type === 'hidden') {
          if (e.toIdx < this.nodeCount) inDegree[e.toIdx]++;
        }
      }
    }
    // Root has indegree 0
    if (this.rootIdx !== null) inDegree[this.rootIdx] = 0;

    // retained[i] = selfSize initially
    const retained = new Float64Array(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i++) {
      retained[i] = this.getSize(i);
    }

    // Worklist: nodes with indegree == 0 (or 1 after propagation)
    // When a node has indegree 1, the sole parent "retains" it
    const queue = [];
    const processed = new Uint8Array(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i++) {
      if (inDegree[i] === 0) {
        queue.push(i);
        processed[i] = 1;
      }
    }

    // BFS: propagate retained sizes upward
    while (queue.length > 0) {
      const cur = queue.shift();
      const edges = this.getEdges(cur);
      for (const e of edges) {
        if (e.toIdx >= this.nodeCount) continue;
        if (e.type !== 'internal' && e.type !== 'property' &&
            e.type !== 'element' && e.type !== 'hidden') continue;
        inDegree[e.toIdx]--;
        // If child has only one remaining parent (inDegree 0 after decrement),
        // its retained size propagates to the current parent
        if (inDegree[e.toIdx] === 0 && !processed[e.toIdx]) {
          processed[e.toIdx] = 1;
          retained[cur] += retained[e.toIdx];
          queue.push(e.toIdx);
        }
      }
    }

    // Second pass: for shared children (inDegree > 0), distribute evenly
    // Actually just mark as "shared" — retained only counts exclusive
    return { retained, shared: inDegree };
  }

  /**
   * Format bytes to human-readable string.
   */
  static fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
    return n + ' B';
  }
}
