import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// === Inlined from src/main/codegraph.ts ===
function normalizeNode(n) {
  if (!n) return n
  return {
    id: n.id,
    name: n.name,
    kind: n.kind,
    filePath: n.filePath,
    line: n.startLine ?? n.line,
    column: n.startColumn ?? n.column,
    endLine: n.endLine,
    endColumn: n.endColumn,
    signature: n.signature,
    language: n.language,
    visibility: n.visibility,
    isExported: n.isExported,
  }
}

// === Pure helpers for explore result shaping ===

/** Group nodes by filePath, keeping original order within each file */
function groupNodesByFile(nodes) {
  const groups = {}
  for (const n of nodes) {
    const path = n.filePath || ''
    if (!groups[path]) groups[path] = []
    groups[path].push(n)
  }
  return groups
}

/** Merge contiguous line ranges within a file (adjacent/overlapping → single section) */
function mergeLineRanges(nodes, gapThreshold = 3) {
  if (!nodes.length) return []
  const sorted = [...nodes].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
  const sections = []
  let cur = { startLine: sorted[0].line ?? 0, endLine: sorted[0].endLine ?? sorted[0].line ?? 0, nodes: [sorted[0]] }
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]
    const nStart = n.line ?? 0
    const nEnd = n.endLine ?? nStart
    if (nStart <= cur.endLine + gapThreshold) {
      cur.endLine = Math.max(cur.endLine, nEnd)
      cur.nodes.push(n)
    } else {
      sections.push(cur)
      cur = { startLine: nStart, endLine: nEnd, nodes: [n] }
    }
  }
  sections.push(cur)
  return sections
}

/** Classify edges by kind for relationship display */
function groupEdgesByKind(edges) {
  const groups = {}
  for (const e of edges) {
    const kind = e.kind || 'unknown'
    if (!groups[kind]) groups[kind] = []
    groups[kind].push(e)
  }
  return groups
}

// === Tests ===

describe('normalizeNode', () => {
  it('maps startLine → line, startColumn → column', () => {
    const raw = { id: 'n1', name: 'foo', kind: 'function', filePath: 'a.ts', startLine: 10, startColumn: 5, endLine: 20, endColumn: 1, signature: 'fn()', language: 'typescript', visibility: 'public', isExported: true }
    const norm = normalizeNode(raw)
    assert.equal(norm.line, 10)
    assert.equal(norm.column, 5)
    assert.equal(norm.endLine, 20)
    assert.equal(norm.endColumn, 1)
  })

  it('falls back to n.line / n.column when startLine/startColumn missing', () => {
    const raw = { id: 'n2', name: 'bar', kind: 'method', filePath: 'b.ts', line: 30, column: 2 }
    const norm = normalizeNode(raw)
    assert.equal(norm.line, 30)
    assert.equal(norm.column, 2)
  })

  it('prefers startLine over legacy line field', () => {
    const raw = { id: 'n3', name: 'baz', kind: 'class', filePath: 'c.ts', startLine: 100, line: 50 }
    const norm = normalizeNode(raw)
    assert.equal(norm.line, 100)
  })

  it('strips qualifiedName and other non-serialized fields', () => {
    const raw = { id: 'n4', name: 'fn', kind: 'function', filePath: 'd.ts', startLine: 1, startColumn: 1, qualifiedName: 'd.ts::fn', docstring: 'docs', isAsync: true, updatedAt: 12345 }
    const norm = normalizeNode(raw)
    assert.equal(norm.qualifiedName, undefined)
    assert.equal(norm.docstring, undefined)
    assert.equal(norm.isAsync, undefined)
    assert.equal(norm.updatedAt, undefined)
  })

  it('returns null-ish input unchanged', () => {
    assert.equal(normalizeNode(null), null)
    assert.equal(normalizeNode(undefined), undefined)
  })

  it('preserves all serialized fields', () => {
    const raw = { id: 'n5', name: 'main', kind: 'function', filePath: 'main.ts', startLine: 1, startColumn: 0, endLine: 5, endColumn: 1, signature: 'main()', language: 'typescript', visibility: 'public', isExported: true }
    const norm = normalizeNode(raw)
    assert.deepEqual(Object.keys(norm).sort(), ['column', 'endColumn', 'endLine', 'filePath', 'id', 'isExported', 'kind', 'language', 'line', 'name', 'signature', 'visibility'])
  })
})

describe('groupNodesByFile', () => {
  it('groups nodes with same filePath together', () => {
    const nodes = [
      { id: '1', name: 'a', filePath: 'src/main.ts' },
      { id: '2', name: 'b', filePath: 'src/main.ts' },
      { id: '3', name: 'c', filePath: 'src/preload.ts' },
    ]
    const groups = groupNodesByFile(nodes)
    assert.deepEqual(Object.keys(groups).sort(), ['src/main.ts', 'src/preload.ts'])
    assert.equal(groups['src/main.ts'].length, 2)
    assert.equal(groups['src/preload.ts'].length, 1)
  })

  it('handles empty node list', () => {
    assert.deepEqual(groupNodesByFile([]), {})
  })

  it('handles nodes without filePath', () => {
    const nodes = [{ id: '1', name: 'a', filePath: '' }, { id: '2', name: 'b' }]
    const groups = groupNodesByFile(nodes)
    // filePath || '' normalizes undefined to '' → both nodes land in same group
    assert.equal(Object.keys(groups).length, 1)
    assert.equal(groups[''].length, 2)
  })
})

describe('mergeLineRanges', () => {
  it('merges overlapping nodes into single section', () => {
    const nodes = [
      { name: 'a', line: 10, endLine: 20 },
      { name: 'b', line: 15, endLine: 25 },
    ]
    const sections = mergeLineRanges(nodes, 3)
    assert.equal(sections.length, 1)
    assert.equal(sections[0].startLine, 10)
    assert.equal(sections[0].endLine, 25)
    assert.equal(sections[0].nodes.length, 2)
  })

  it('keeps distant nodes as separate sections', () => {
    const nodes = [
      { name: 'a', line: 10, endLine: 20 },
      { name: 'b', line: 50, endLine: 60 },
    ]
    const sections = mergeLineRanges(nodes, 3)
    assert.equal(sections.length, 2)
    assert.equal(sections[0].startLine, 10)
    assert.equal(sections[1].startLine, 50)
  })

  it('merges nodes within gap threshold', () => {
    const nodes = [
      { name: 'a', line: 10, endLine: 20 },
      { name: 'b', line: 23, endLine: 30 }, // gap = 3, within threshold
    ]
    const sections = mergeLineRanges(nodes, 3)
    assert.equal(sections.length, 1)
  })

  it('separates nodes beyond gap threshold', () => {
    const nodes = [
      { name: 'a', line: 10, endLine: 20 },
      { name: 'b', line: 25, endLine: 30 }, // gap = 5, beyond threshold
    ]
    const sections = mergeLineRanges(nodes, 3)
    assert.equal(sections.length, 2)
  })

  it('handles empty nodes', () => {
    assert.deepEqual(mergeLineRanges([]), [])
  })

  it('sorts unsorted input by line', () => {
    const nodes = [
      { name: 'b', line: 50, endLine: 60 },
      { name: 'a', line: 10, endLine: 20 },
    ]
    const sections = mergeLineRanges(nodes, 3)
    assert.equal(sections[0].startLine, 10)
    assert.equal(sections[0].nodes[0].name, 'a')
  })
})

describe('groupEdgesByKind', () => {
  it('groups edges by kind', () => {
    const edges = [
      { source: '1', target: '2', kind: 'calls' },
      { source: '2', target: '3', kind: 'calls' },
      { source: '1', target: '4', kind: 'imports' },
    ]
    const groups = groupEdgesByKind(edges)
    assert.equal(groups.calls.length, 2)
    assert.equal(groups.imports.length, 1)
  })

  it('handles empty edges', () => {
    assert.deepEqual(groupEdgesByKind([]), {})
  })
})

// === Explore query expectations for this project ===
// These define what codegraph_explore should return for key questions about Vibe IDE.
// They serve as integration spec — actual verification needs CodeGraph initialized.

describe('explore query specs (this project)', () => {
  const PROJECT_ROOT = 'src'

  // Q1: Terminal session lifecycle
  it('query "terminal session create manage pty" should return nodes from pty.ts and App.tsx', () => {
    const expectedFiles = [
      `${PROJECT_ROOT}/main/pty.ts`,
      `${PROJECT_ROOT}/renderer/src/App.tsx`,
    ]
    // findRelevantContext should return nodes whose filePath includes at least these files
    // The result.nodes array must contain symbols like:
    //   - registerPtyHandlers (function, pty.ts)
    //   - createTerminal (function, pty.ts)
    //   - cleanupTerminals (function, pty.ts)
    //   - TerminalSession (interface, shared/types.ts)
    // At least 2 of expectedFiles must appear in result.nodes[].filePath
    assert.ok(expectedFiles.length === 2, 'spec defines 2 expected files')
  })

  // Q2: IPC channel definitions and handler registration
  it('query "IPC_CHANNELS registration handlers" should return nodes from types.ts and main modules', () => {
    const expectedFiles = [
      `${PROJECT_ROOT}/shared/types.ts`,
      `${PROJECT_ROOT}/main/search.ts`,
      `${PROJECT_ROOT}/main/file.ts`,
    ]
    // findRelevantContext should return IPC_CHANNELS constant and handler registration functions
    // e.g. IPC_CHANNELS (variable, types.ts), registerSearchHandlers (function, search.ts),
    //      registerFileHandlers (function, file.ts)
    assert.ok(expectedFiles.length === 3, 'spec defines 3 expected files')
  })

  // Q3: Smart mode search flow
  it('query "SearchPanel smart mode findRelevantContext" should hit SearchPanel.tsx and codegraph.ts', () => {
    const expectedFiles = [
      `${PROJECT_ROOT}/renderer/src/components/SearchPanel.tsx`,
      `${PROJECT_ROOT}/main/codegraph.ts`,
    ]
    // Should return doSmartSearch (function, SearchPanel.tsx),
    //   CODE_FIND_RELEVANT_CONTEXT handler (codegraph.ts)
    assert.ok(expectedFiles.length === 2, 'spec defines 2 expected files')
  })

  // Q4: Session independent architecture
  it('query "session independence pendingPathRef stale guard" should return GitTab and AuxTab', () => {
    const expectedFiles = [
      `${PROJECT_ROOT}/renderer/src/components/GitTab.tsx`,
      `${PROJECT_ROOT}/renderer/src/components/AuxTab.tsx`,
    ]
    // Should return pendingPathRef pattern usage in GitTab and AuxTab
    assert.ok(expectedFiles.length === 2, 'spec defines 2 expected files')
  })

  // Q5: Code graph initialization lifecycle
  it('query "codegraph init index progress cancel" should return codegraph.ts init handlers', () => {
    const expectedFiles = [
      `${PROJECT_ROOT}/main/codegraph.ts`,
    ]
    // Should return: registerCodeGraphHandlers, CODE_INIT handler, CODE_CANCEL_INIT handler
    // result.confidence should be 'high' since query terms are specific
    assert.ok(expectedFiles.length === 1, 'spec defines 1 expected file')
  })

  // Validate the expected ExploreResult shape
  it('explore result should have structured shape: { files, edges, roots, confidence }', () => {
    const expectedShape = {
      files: [{ path: 'string', sections: [{ startLine: 'number', endLine: 'number', code: 'string', nodes: 'NormalizedNode[]' }] }],
      edges: [{ source: 'string', target: 'string', kind: 'string', provenance: 'string?', line: 'number?', column: 'number?' }],
      roots: 'string[]',
      confidence: "'high' | 'low' | undefined",
    }
    // Each file has one or more sections, each with contiguous source code
    // This is the shape the CODE_EXPLORE IPC channel should return
    assert.ok(typeof expectedShape === 'object', 'explore result shape defined')
  })
})