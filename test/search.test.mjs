import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// === Inlined from src/main/search.ts ===
function globToRegex(glob) {
  let pattern = glob
    .replace(/[.+^${}()|[\]\\*]/g, '\\$&')
    .replace(/\\\*\\\*/g, '<<<GLOBSTAR>>>')
    .replace(/\\\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')

  pattern = pattern.replace(/\\\{([^}]+)\\\}/g, (_m, inner) => `(${inner.replace(/,/g, '|')})`)
  return new RegExp(`^${pattern}$`)
}

function matchInclude(filePath, includeGlob) {
  // Simple extension: *.ext
  if (/^\*\.[a-zA-Z0-9]+$/.test(includeGlob)) {
    const ext = includeGlob.slice(1)
    return filePath.endsWith(ext)
  }
  // Brace expansion: *.{ext1,ext2}
  if (/^\*\.\{[a-zA-Z0-9,]+\}$/.test(includeGlob)) {
    const exts = includeGlob.slice(3, -1).split(',').map(e => '.' + e.trim())
    return exts.some(ext => filePath.endsWith(ext))
  }
  // Full pattern
  const regex = globToRegex(includeGlob)
  return regex.test(filePath)
}

// === Tests ===
describe('globToRegex', () => {
  it('matches *.ts against foo.ts', () => {
    const re = globToRegex('*.ts')
    assert.ok(re.test('foo.ts'))
    assert.equal(re.test('foo.tsx'), false)
  })

  it('matches ** globstar across dirs', () => {
    const re = globToRegex('src/**/*.ts')
    assert.ok(re.test('src/a/b/c.ts'))
    assert.equal(re.test('test/a.ts'), false)
  })

  it('handles brace expansion {ts,tsx}', () => {
    const re = globToRegex('*.{ts,tsx}')
    assert.ok(re.test('foo.ts'))
    assert.ok(re.test('foo.tsx'))
    assert.equal(re.test('foo.js'), false)
  })

  it('escapes regex special chars', () => {
    const re = globToRegex('file[abc].ts')
    // [abc] should be escaped to \[abc\], so literal match only
    assert.equal(re.test('file[abc].ts'), true)
    assert.equal(re.test('filea.ts'), false)
  })

  it('matches file at root', () => {
    const re = globToRegex('package.json')
    assert.ok(re.test('package.json'))
  })

  it('matches nested path with single star', () => {
    const re = globToRegex('src/*.ts')
    assert.ok(re.test('src/app.ts'))
    assert.equal(re.test('src/sub/app.ts'), false)
  })
})

describe('matchInclude', () => {
  it('simple *.ts extension match', () => {
    assert.ok(matchInclude('src/app.ts', '*.ts'))
    assert.equal(matchInclude('src/app.tsx', '*.ts'), false)
    assert.equal(matchInclude('src/app.js', '*.ts'), false)
  })

  it('brace expansion *.ts,*.tsx', () => {
    assert.ok(matchInclude('src/app.ts', '*.{ts,tsx}'))
    assert.ok(matchInclude('src/app.tsx', '*.{ts,tsx}'))
    assert.equal(matchInclude('src/app.js', '*.{ts,tsx}'), false)
  })

  it('complex glob with path', () => {
    assert.ok(matchInclude('src/comp/Button.tsx', 'src/**/*.tsx'))
    assert.equal(matchInclude('lib/comp/Button.tsx', 'src/**/*.tsx'), false)
  })

  it('unprefixed glob matches anywhere', () => {
    // *.ts glob matches any .ts file regardless of path
    assert.ok(matchInclude('deeply/nested/file.ts', '*.ts'))
  })

  it('non-matching extension', () => {
    assert.equal(matchInclude('file.md', '*.ts'), false)
  })
})
