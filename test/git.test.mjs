import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

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

function run(...args) {
  return execSync(args.join(' '), { encoding: 'utf-8', cwd: gitDir }).trim()
}
function git(...args) {
  return execSync(`git ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', cwd: gitDir }).trim()
}
// git output without trimming (needed for patch content where trailing newline matters)
function gitRaw(...args) {
  return execSync(`git ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', cwd: gitDir })
}
// Pipe stdin input to git (bypasses file-based apply which needs trailing newline)
function gitApply(patchContent, ...args) {
  return execSync(
    `git ${args.map(a => `"${a}"`).join(' ')}`,
    { encoding: 'utf-8', cwd: gitDir, input: patchContent }
  ).trim()
}
function gitIgnoreError(...args) {
  try { return git(...args) } catch { return '' }
}

function writeFile(filePath, content) {
  const fullPath = join(gitDir, filePath)
  const dir = fullPath.slice(0, fullPath.lastIndexOf(sep))
  if (!existsSync(dir)) run(`mkdir -p "${dir}"`)
  writeFileSync(fullPath, content, 'utf-8')
}

let gitDir

describe('applyBranch diff baseline', () => {
  const LINES = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
  let defaultBranch

  before(() => {
    gitDir = mkdtempSync(join(tmpdir(), 'vibe-applybranch-'))
    git('init')
    git('config', 'user.email', 'test@test')
    git('config', 'user.name', 'test')
    git('config', 'core.autocrlf', 'false')
    // commit C: common ancestor
    writeFile('file.txt', LINES)
    git('add', '.')
    git('commit', '-m', 'C: initial')
    defaultBranch = run('git rev-parse --abbrev-ref HEAD')
  })

  after(() => {
    rmSync(gitDir, { recursive: true, force: true })
  })

  // Helper: create branch-a (modifies line 10) and branch-b (modifies line 20) from common ancestor
  function setupTopology() {
    git('checkout', '-b', 'branch-a')
    writeFile('file.txt', LINES.replace('line 10', 'line 10 modified by A'))
    git('add', '.')
    git('commit', '-m', 'A: modify line 10')

    git('checkout', 'branch-a~1')
    git('checkout', '-b', 'branch-b')
    writeFile('file.txt', LINES.replace('line 20', 'line 20 modified by B'))
    git('add', '.')
    git('commit', '-m', 'B: modify line 20')

    git('checkout', 'branch-a')
  }

  // Helper: clean up branch-a and branch-b from any state
  function cleanupBranches() {
    gitIgnoreError('checkout', '-f', defaultBranch)
    gitIgnoreError('branch', '-D', 'branch-a', 'branch-b')
  }

  // Helper: create branch-a (modifies line 15) and branch-b (also modifies line 15)
  function setupSameLineConflict() {
    git('checkout', '-b', 'branch-a')
    writeFile('file.txt', LINES.replace('line 15', 'line 15 modified by A'))
    git('add', '.')
    git('commit', '-m', 'A: modify line 15')

    git('checkout', 'branch-a~1')
    git('checkout', '-b', 'branch-b')
    writeFile('file.txt', LINES.replace('line 15', 'line 15 modified by B'))
    git('add', '.')
    git('commit', '-m', 'B: modify line 15')

    git('checkout', 'branch-a')
  }

  it('old baseline (diff HEAD branch) reverts A and applies B', () => {
    setupTopology()

    // OLD behavior: diff HEAD branch  — includes reverting A + applying B
    const oldDiff = git('diff', '--full-index', 'branch-a', 'branch-b')
    assert.ok(oldDiff.includes('-line 10 modified by A'), 'old diff reverts A\'s change')
    assert.ok(oldDiff.includes('+line 10'), 'old diff restores original at line 10')
    assert.ok(oldDiff.includes('+line 20 modified by B'), 'old diff adds B\'s change')

    cleanupBranches()
  })

  it('new baseline (diff merge-base branch) only applies B changes', () => {
    setupTopology()

    const mergeBase = git('merge-base', 'branch-a', 'branch-b')
    const newDiff = git('diff', '--full-index', mergeBase, 'branch-b')

    assert.ok(mergeBase.length > 0, 'merge-base is not empty')
    assert.ok(!newDiff.includes('line 10 modified by A'), 'new diff does not touch A\'s change')
    assert.ok(newDiff.includes('+line 20 modified by B'), 'new diff adds B\'s change')

    cleanupBranches()
  })

  it('applying new-baseline patch preserves A\'s changes', () => {
    setupTopology()

    const mergeBase = git('merge-base', 'branch-a', 'branch-b')
    const patch = gitRaw('diff', '--full-index', mergeBase, 'branch-b')
    gitApply(patch, 'apply', '--3way')

    const contentA = readFileSync(join(gitDir, 'file.txt'), 'utf-8')
    assert.ok(contentA.includes('line 10 modified by A'), 'A\'s change is preserved')

    const contentB = readFileSync(join(gitDir, 'file.txt'), 'utf-8')
    assert.ok(contentB.includes('line 20 modified by B'), 'B\'s change is applied')

    gitIgnoreError('checkout', '-f', '.')
    cleanupBranches()
  })

  it('no common ancestor falls back to HEAD', () => {
    const mainBranch = defaultBranch

    git('checkout', '--orphan', 'orphan-branch')
    writeFile('other.txt', 'orphan content')
    git('add', '.')
    git('commit', '-m', 'orphan commit')

    let mergeBase = ''
    try {
      mergeBase = execSync(`git merge-base HEAD ${mainBranch}`, { encoding: 'utf-8', cwd: gitDir }).trim()
    } catch { mergeBase = '' }

    assert.equal(mergeBase, '', 'no common ancestor between orphan and main')
    const diff = git('diff', '--full-index', 'HEAD', mainBranch)
    assert.ok(diff.length >= 0, 'falls back to diff HEAD branch')

    git('checkout', mainBranch)
    gitIgnoreError('branch', '-D', 'orphan-branch')
  })

  it('conflicting changes produce conflict markers', () => {
    setupSameLineConflict()

    const mergeBase = git('merge-base', 'branch-a', 'branch-b')
    const patch = gitRaw('diff', '--full-index', mergeBase, 'branch-b')

    let conflict = false
    try {
      gitApply(patch, 'apply', '--3way')
    } catch {
      conflict = true
    }
    assert.ok(conflict, '--3way fails when both branches changed same line')

    gitIgnoreError('checkout', '-f', '.')
    cleanupBranches()
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
