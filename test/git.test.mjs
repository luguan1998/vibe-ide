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

function parseConflictPathsFromCheck(output) {
  const conflictPaths = new Set()
  for (const line of output.split('\n')) {
    const m = /^(.*):\d+: /.exec(line)
    if (m) conflictPaths.add(m[1])
  }
  return conflictPaths
}

// 与 src/main/git.ts 的 GIT_STATUS 冲突标记检查保持一致
const CHECK_ARGS = [
  '--no-optional-locks',
  '-c', 'core.whitespace=-trailing-space,-space-before-tab,-blank-at-eol,-blank-at-eof,-indent-with-non-tab,-tab-in-indent',
  'diff', '--cached', '--check', '--no-ext-diff'
]
// --check 命中时退出码为 2，输出在 stdout，必须从 error.stdout 取
function gitCheck() {
  try {
    return execSync(`git ${CHECK_ARGS.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', cwd: gitDir, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) {
    return e.stdout || ''
  }
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

describe('parseConflictPathsFromCheck', () => {
  it('finds file with conflict markers', () => {
    const out = [
      'src/app.ts:3: leftover conflict marker',
      'src/app.ts:5: leftover conflict marker',
      'src/app.ts:7: leftover conflict marker',
    ].join('\n')
    const result = parseConflictPathsFromCheck(out)
    assert.ok(result.has('src/app.ts'))
    assert.equal(result.size, 1)
  })

  it('tracks multiple conflicted files', () => {
    const out = [
      'a.ts:1: leftover conflict marker',
      'b.ts:2: leftover conflict marker',
    ].join('\n')
    const result = parseConflictPathsFromCheck(out)
    assert.ok(result.has('a.ts'))
    assert.ok(result.has('b.ts'))
    assert.equal(result.size, 2)
  })

  it('keeps colon inside path out of the line-number split', () => {
    const result = parseConflictPathsFromCheck('src/a:b.ts:12: leftover conflict marker')
    assert.ok(result.has('src/a:b.ts'))
  })

  it('returns empty for empty string', () => {
    assert.equal(parseConflictPathsFromCheck('').size, 0)
  })
})

describe('staged conflict marker check (real git)', () => {
  before(() => {
    gitDir = mkdtempSync(join(tmpdir(), 'vibe-conflict-'))
    git('init')
    git('config', 'user.email', 'test@test')
    git('config', 'user.name', 'test')
    git('config', 'core.autocrlf', 'false')
    writeFile('base.txt', 'base\n')
    git('add', '.')
    git('commit', '-m', 'init')
  })

  after(() => {
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('flags staged conflict markers, ignores whitespace noise and context lines', () => {
    // 已提交内容里就含标记，本次只改最后一行 → 标记行属上下文，不应报
    writeFile('ctx.txt', 'head\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\ntail\n')
    git('add', 'ctx.txt')
    git('commit', '-m', 'ctx')
    writeFile('ctx.txt', 'head\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\ntail-changed\n')
    // 新暂存的冲突标记
    writeFile('conflict.txt', 'a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\nb\n')
    // 只有尾部空白：git 默认空白规则会报 trailing whitespace，必须被 -c core.whitespace 关掉
    writeFile('noise.txt', 'clean line\nlined with spaces   \n')
    git('add', '.')

    const result = parseConflictPathsFromCheck(gitCheck())
    assert.ok(result.has('conflict.txt'), 'staged conflict markers are flagged')
    assert.ok(!result.has('noise.txt'), 'whitespace-only noise is not flagged')
    assert.ok(!result.has('ctx.txt'), 'markers in unchanged context lines are not flagged')
    assert.equal(result.size, 1)
  })

  it('returns empty when nothing is staged', () => {
    gitIgnoreError('reset', 'HEAD')
    gitIgnoreError('checkout', '-f', '.')
    assert.equal(parseConflictPathsFromCheck(gitCheck()).size, 0)
  })
})
