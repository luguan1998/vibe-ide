import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { readFile, writeFile, readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import { IPC_CHANNELS, GrepSearchResult, GrepMatch, ReplaceResult } from '../shared/types'

const MAX_RESULTS = 200
const MAX_FILE_SIZE = 1024 * 1024 // 1MB
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '__pycache__', 'target', '.cache'])

export function registerSearchHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SEARCH_GREP, async (_event, options: {
    query: string
    cwd: string
    regex?: boolean
    caseSensitive?: boolean
    wholeWord?: boolean
    include?: string
  }): Promise<GrepSearchResult> => {
    const { query, cwd, regex, caseSensitive, wholeWord, include } = options || {}

    if (!query || !cwd) {
      return { matches: [], total: 0, truncated: false }
    }

    // Try ripgrep first, fall back to Node.js
    try {
      return await rgSearch(query, cwd, { regex, caseSensitive, wholeWord, include })
    } catch {
      return await nodeSearch(query, cwd, { regex, caseSensitive, wholeWord, include })
    }
  })

  ipcMain.handle(IPC_CHANNELS.SEARCH_REPLACE, async (_event, options: {
    query: string
    replacement: string
    cwd: string
    regex?: boolean
    caseSensitive?: boolean
    wholeWord?: boolean
    include?: string
    excludeFiles?: string[]
  }): Promise<ReplaceResult> => {
    const { query, replacement, cwd, regex, caseSensitive, wholeWord, include, excludeFiles } = options || {}

    if (!query || !cwd) {
      return { filesModified: 0, totalReplacements: 0, errors: [] }
    }

    return await replaceInFiles(query, replacement, cwd, { regex, caseSensitive, wholeWord, include, excludeFiles })
  })
}

function rgSearch(query: string, cwd: string, opts: {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  include?: string
}): Promise<GrepSearchResult> {
  return new Promise((resolve, reject) => {
    const args = ['--json', '--line-number', '--no-heading']

    if (!opts.caseSensitive) args.push('--ignore-case')
    if (!opts.regex) args.push('--fixed-strings')
    if (opts.wholeWord) args.push('--word-regexp')

    // Skip common dirs (glob ** matches zero+ segments, covers nested)
    for (const dir of SKIP_DIRS) {
      args.push('--glob', `!**/${dir}/**`)
    }

    if (opts.include) {
      args.push('--glob', opts.include)
    }

    // 不传显式搜索路径：rg 默认用 cwd，且输出的相对路径不带前缀。
    // 旧实现传 '.' 会让 rg 原样回显 `./` 或 `.\` 前缀，前端树形分组据此多出一个 `.` 文件夹。
    args.push('--', query)

    const child = spawn('rg', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    const matches: GrepMatch[] = []
    let total = 0
    let timedOut = false
    let stopped = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 15000) // 15s timeout

    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      if (stopped) return
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() || ''

      for (const line of lines) {
        if (matches.length >= MAX_RESULTS) { stopped = true; break }
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === 'match') {
            const matchData = parsed.data
            // 防御性剥离 rg 可能回显的 `./` `.\` 前缀，保证相对路径干净
            const file = (matchData.path?.text || '').replace(/^\.[\\/]/, '')
            const fullPath = join(cwd, file)
            const lineNum = matchData.line_number || 0
            const col = matchData.submatches?.[0]?.start ? matchData.submatches[0].start + 1 : 1
            const content = matchData.lines?.text?.trim() || ''

            matches.push({ file, fullPath, line: lineNum, column: col, content })
            total++
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    })

    child.on('close', () => {
      clearTimeout(timer)
      resolve({
        matches: matches.slice(0, MAX_RESULTS),
        total,
        truncated: total > MAX_RESULTS || timedOut
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Convert a simple glob include pattern to a RegExp for filename matching.
 * Supports: *.ts, *.{ts,tsx}, src/**\/*.ts
 */
export function globToRegex(glob: string): RegExp {
  let pattern = glob
    .replace(/[.+^${}()|[\]\\*]/g, '\\$&') // Escape regex specials
    .replace(/\\\*\\\*/g, '<<<GLOBSTAR>>>')  // Temporarily replace **
    .replace(/\\\*/g, '[^/]*')              // * → match non-slash chars
    .replace(/<<<GLOBSTAR>>>/g, '.*')       // ** → match anything

  // Handle brace expansion: {ts,tsx} → (ts|tsx)
  pattern = pattern.replace(/\\\{([^}]+)\\\}/g, (_m, inner) => `(${inner.replace(/,/g, '|')})`)

  return new RegExp(`^${pattern}$`)
}

export function matchInclude(filePath: string, includeGlob: string): boolean {
  // Simple extension pattern: *.ext
  if (/^\*\.[a-zA-Z0-9]+$/.test(includeGlob)) {
    const ext = includeGlob.slice(1) // e.g. ".ts"
    return filePath.endsWith(ext)
  }

  // Brace expansion: *.{ext1,ext2}
  if (/^\*\.\{[a-zA-Z0-9,]+\}$/.test(includeGlob)) {
    const exts = includeGlob.slice(3, -1).split(',').map(e => '.' + e.trim())
    return exts.some(ext => filePath.endsWith(ext))
  }

  // Full pattern (contains path separators or complex globs)
  const regex = globToRegex(includeGlob)
  return regex.test(filePath)
}

async function nodeSearch(query: string, cwd: string, opts: {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  include?: string
}): Promise<GrepSearchResult> {
  const matches: GrepMatch[] = []
  let total = 0

  let pattern: RegExp | null = null
  if (opts.regex) {
    pattern = new RegExp(query, opts.caseSensitive ? 'g' : 'gi')
  } else if (opts.wholeWord) {
    // Plain text + whole word: wrap in \b word boundaries
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern = new RegExp(`\\b${escaped}\\b`, opts.caseSensitive ? 'g' : 'gi')
  }

  async function searchDir(dirPath: string): Promise<void> {
    if (matches.length >= MAX_RESULTS) return

    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (matches.length >= MAX_RESULTS) return
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.')) continue
        await searchDir(fullPath)
      } else if (entry.isFile()) {
        // Check file size
        try {
          const fileStat = await stat(fullPath)
          if (fileStat.size > MAX_FILE_SIZE) continue
        } catch {
          continue
        }

        const relativePath = relative(cwd, fullPath)

        // Check include pattern
        if (opts.include && !matchInclude(relativePath, opts.include)) continue

        try {
          const content = await readFile(fullPath, 'utf-8')
          // 与 Monaco 一致地识别换行：\r\n / \r / \n。
          // 旧实现只用 split('\n')，遇到裸 \r（老 Mac 换行 / CRLF 残留）会把多行并成一行，
          // 导致报出的行号比编辑器实际行号小，点击跳转错位。
          const lines = content.split(/\r\n|\r|\n/)
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_RESULTS) return
            const line = lines[i]
            let matchIdx = -1

            if (pattern) {
              // Regex mode: use the compiled regex
              pattern.lastIndex = 0
              const m = pattern.exec(line)
              if (m) matchIdx = m.index
            } else if (opts.caseSensitive) {
              // Plain text, case-sensitive
              const idx = line.indexOf(query)
              if (idx !== -1) matchIdx = idx
            } else {
              // Plain text, case-insensitive
              const idx = line.toLowerCase().indexOf(query.toLowerCase())
              if (idx !== -1) matchIdx = idx
            }

            if (matchIdx !== -1) {
              matches.push({
                file: relativePath,
                fullPath,
                line: i + 1,
                column: matchIdx + 1,
                content: line.trim().slice(0, 200)
              })
              total++
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await searchDir(cwd)

  return {
    matches: matches.slice(0, MAX_RESULTS),
    total,
    truncated: total > MAX_RESULTS
  }
}

function buildReplacePattern(query: string, regex: boolean, caseSensitive: boolean, wholeWord: boolean): RegExp {
  if (regex) {
    const src = wholeWord ? `\\b(?:${query})\\b` : query
    return new RegExp(src, caseSensitive ? 'gm' : 'gim')
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const src = wholeWord ? `\\b${escaped}\\b` : escaped
  return new RegExp(src, caseSensitive ? 'gm' : 'gim')
}

async function replaceInFiles(
  query: string,
  replacement: string,
  cwd: string,
  opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; include?: string; excludeFiles?: string[] }
): Promise<ReplaceResult> {
  const errors: string[] = []
  let filesModified = 0
  let totalReplacements = 0

  // First, find all matching files
  let searchResult: GrepSearchResult
  try {
    searchResult = await rgSearch(query, cwd, opts)
  } catch {
    searchResult = await nodeSearch(query, cwd, opts)
  }

  // Deduplicate files and filter out excluded
  const excludeSet = new Set(opts.excludeFiles || [])
  const files = [...new Set(searchResult.matches.map(m => m.fullPath))]
    .filter(f => !excludeSet.has(f))

  const pattern = buildReplacePattern(query, !!opts.regex, !!opts.caseSensitive, !!opts.wholeWord)

  for (const fullPath of files) {
    try {
      const content = await readFile(fullPath, 'utf-8')
      const replaced = content.replace(pattern, replacement)
      if (replaced !== content) {
        const changes = (content.match(pattern) || []).length
        await writeFile(fullPath, replaced, 'utf-8')
        filesModified++
        totalReplacements += changes
      }
    } catch (err: any) {
      errors.push(`${fullPath}: ${err.message || 'Unknown error'}`)
    }
  }

  return { filesModified, totalReplacements, errors }
}
