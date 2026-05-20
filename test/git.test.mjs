import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// === Inlined from src/main/git.ts ===
function mapShortStatus(code) {
  switch (code) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'U': return 'conflicted'
    default:  return 'unstaged'
  }
}

function getOldPath(f, status) {
  if (status === 'R' || status === 'C') return f.from
  return undefined
}

const CONFLICT_MARKER_RE = /^\+<{7}(?: |$)|^\+={7}$|^\+>{7}(?: |$)/
function parseConflictFilesFromDiff(diff) {
  const conflictPaths = new Set()
  let currentFile = ''
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)/)
    if (fileMatch) {
      currentFile = fileMatch[1]
      continue
    }
    if (CONFLICT_MARKER_RE.test(line)) {
      if (currentFile) conflictPaths.add(currentFile)
    }
  }
  return conflictPaths
}

// === Tests ===
describe('mapShortStatus', () => {
  it('maps A → added',    () => { assert.equal(mapShortStatus('A'), 'added') })
  it('maps M → modified', () => { assert.equal(mapShortStatus('M'), 'modified') })
  it('maps D → deleted',  () => { assert.equal(mapShortStatus('D'), 'deleted') })
  it('maps R → renamed',  () => { assert.equal(mapShortStatus('R'), 'renamed') })
  it('maps C → copied',   () => { assert.equal(mapShortStatus('C'), 'copied') })
  it('maps U → conflicted', () => { assert.equal(mapShortStatus('U'), 'conflicted') })
  it('maps unknown → unstaged', () => { assert.equal(mapShortStatus('X'), 'unstaged') })
  it('maps space → unstaged',   () => { assert.equal(mapShortStatus(' '), 'unstaged') })
})

describe('getOldPath', () => {
  it('returns from for renamed', () => {
    assert.equal(getOldPath({ from: 'old.ts' }, 'R'), 'old.ts')
  })
  it('returns from for copied', () => {
    assert.equal(getOldPath({ from: 'old.ts' }, 'C'), 'old.ts')
  })
  it('returns undefined for modified', () => {
    assert.equal(getOldPath({ from: 'old.ts' }, 'M'), undefined)
  })
  it('returns undefined when no from', () => {
    assert.equal(getOldPath({}, 'R'), undefined)
  })
})

describe('parseConflictFilesFromDiff', () => {
  it('finds file with conflict markers', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 123..456 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '+<<<<<<< HEAD',
      '+ours',
      '+=======',
      '+theirs',
      '+>>>>>>> branch',
    ].join('\n')
    const result = parseConflictFilesFromDiff(diff)
    assert.ok(result.has('src/app.ts'))
    assert.equal(result.size, 1)
  })

  it('returns empty for clean diff', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '+added line',
    ].join('\n')
    assert.equal(parseConflictFilesFromDiff(diff).size, 0)
  })

  it('returns empty for empty string', () => {
    assert.equal(parseConflictFilesFromDiff('').size, 0)
  })

  it('tracks multiple conflicted files', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '+++ b/a.ts',
      '+<<<<<<< HEAD',
      '+=======',
      '+>>>>>>>',
      'diff --git a/b.ts b/b.ts',
      '+++ b/b.ts',
      '+<<<<<<< HEAD',
      '+=======',
      '+>>>>>>>',
    ].join('\n')
    const result = parseConflictFilesFromDiff(diff)
    assert.ok(result.has('a.ts'))
    assert.ok(result.has('b.ts'))
    assert.equal(result.size, 2)
  })
})
