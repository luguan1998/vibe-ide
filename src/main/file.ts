import { ipcMain, shell } from 'electron'
import { readFile, writeFile, readdir, rename, mkdir, rm, cp, stat } from 'fs/promises'
import { statSync } from 'fs'
import { join, dirname, basename, extname, relative } from 'path'
import { IPC_CHANNELS, FileNode } from '../shared/types'
import * as iconv from 'iconv-lite'
import * as jschardet from 'jschardet'
import { normalizeEncoding, DEFAULT_ENCODING } from '../shared/encodings'

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'tif', 'psd', 'heic', 'heif', 'avif',
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a', 'opus',
  'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v',
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'zst', 'lz4',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'exe', 'dll', 'so', 'dylib', 'obj', 'o', 'class', 'pyc', 'pyo', 'wasm', 'bin', 'out',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'db', 'sqlite', 'sqlite3', 'mdb',
  'iso', 'img', 'dmg', 'ipa', 'apk', 'aab',
  'lib', 'a', 'dex', 'elf',
])

const MAX_EDIT_FILE_SIZE = 5 * 1024 * 1024 // 5MB

function isBinaryByExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase().replace(/^\./, '')
  return BINARY_EXTENSIONS.has(ext)
}

function detectBOM(buffer: Buffer): { encoding?: string; bomLength: number } {
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xFE && buffer[3] === 0xFF) {
    return { encoding: 'utf-32be', bomLength: 4 }
  }
  if (buffer.length >= 4 && buffer[0] === 0xFF && buffer[1] === 0xFE && buffer[2] === 0x00 && buffer[3] === 0x00) {
    return { encoding: 'utf-32le', bomLength: 4 }
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return { encoding: 'utf-16be', bomLength: 2 }
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return { encoding: 'utf-16le', bomLength: 2 }
  }
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { encoding: 'utf-8', bomLength: 3 }
  }
  return { bomLength: 0 }
}

function autoDetectEncoding(buffer: Buffer): { encoding: string; confidence: number; bom: boolean } {
  const bom = detectBOM(buffer)
  if (bom.encoding) {
    return { encoding: bom.encoding, confidence: 1, bom: true }
  }
  const result = jschardet.detect(buffer)
  const encoding = result.encoding ? normalizeEncoding(result.encoding) : DEFAULT_ENCODING
  return { encoding, confidence: result.confidence || 0, bom: false }
}

async function readFileWithEncoding(filePath: string, encoding?: string, forceOpen?: boolean) {
  // Pre-read checks (skipped when user forces open)
  if (!forceOpen) {
    if (isBinaryByExtension(filePath)) {
      return { error: 'Cannot display binary file', content: '', encoding: '', bom: false, confidence: 0 }
    }
    try {
      const st = await stat(filePath)
      if (st.size > MAX_EDIT_FILE_SIZE) {
        const mb = (st.size / (1024 * 1024)).toFixed(1)
        return { error: `File too large (${mb} MB), cannot display`, content: '', encoding: '', bom: false, confidence: 0 }
      }
    } catch {
      return { error: 'File not found or inaccessible', content: '', encoding: '', bom: false, confidence: 0 }
    }
  }

  const buffer = await readFile(filePath)
  let targetEncoding: string
  let confidence = 1
  let bom = false

  if (encoding) {
    targetEncoding = normalizeEncoding(encoding)
  } else {
    const detected = autoDetectEncoding(buffer)
    targetEncoding = detected.encoding
    confidence = detected.confidence
    bom = detected.bom
  }

  if (!forceOpen && !encoding && confidence < 0.1 && buffer.includes(0x00)) {
    return { error: 'Cannot display binary file', content: '', encoding: '', bom: false, confidence: 0 }
  }

  const content = iconv.decode(buffer, targetEncoding)
  return { content, encoding: targetEncoding, bom, confidence }
}

export function registerFileHandlers(): void {
  // Read file content (legacy, always UTF-8)
  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_event, filePath: string) => {
    try {
      if (isBinaryByExtension(filePath)) {
        return { error: 'Cannot display binary file' }
      }
      const st = await stat(filePath)
      if (st.size > MAX_EDIT_FILE_SIZE) {
        const mb = (st.size / (1024 * 1024)).toFixed(1)
        return { error: `File too large (${mb} MB), cannot display` }
      }
      const content = await readFile(filePath, 'utf-8')
      return { content }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Read file content with encoding detection/support
  ipcMain.handle(IPC_CHANNELS.FILE_READ_ENCODING, async (_event, filePath: string, encoding?: string, forceOpen?: boolean) => {
    try {
      return await readFileWithEncoding(filePath, encoding, forceOpen)
    } catch (err: any) {
      return { error: err.message, content: '', encoding: '', bom: false, confidence: 0 }
    }
  })

  
  // Write file content
  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_event, filePath: string, content: string) => {
    try {
      const dir = dirname(filePath)
      const { mkdir } = require('fs/promises')
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Write file content with encoding support
  ipcMain.handle(IPC_CHANNELS.FILE_WRITE_ENCODING, async (_event, filePath: string, content: string, encoding?: string) => {
    try {
      const targetEncoding = encoding ? normalizeEncoding(encoding) : DEFAULT_ENCODING
      const buffer = iconv.encode(content, targetEncoding)
      const dir = dirname(filePath)
      const { mkdir } = require('fs/promises')
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, buffer)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // List files in directory
  ipcMain.handle(IPC_CHANNELS.FILE_LIST, async (_event, dirPath: string) => {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        type: entry.isDirectory() ? 'directory' : 'file'
      }))
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Delete file or directory
  ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_event, filePath: string) => {
    try {
      await rm(filePath, { recursive: true })
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Rename/move file or directory
  ipcMain.handle(IPC_CHANNELS.FILE_RENAME, async (_event, oldPath: string, newPath: string) => {
    try {
      await rename(oldPath, newPath)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Create directory
  ipcMain.handle(IPC_CHANNELS.FILE_CREATE_DIR, async (_event, dirPath: string) => {
    try {
      await mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Copy file or directory recursively
  ipcMain.handle(IPC_CHANNELS.FILE_COPY, async (_event, srcPath: string, destPath: string) => {
    try {
      await cp(srcPath, destPath, { recursive: true })
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Move (cut) file or directory
  ipcMain.handle(IPC_CHANNELS.FILE_MOVE, async (_event, srcPath: string, destPath: string) => {
    try {
      await rename(srcPath, destPath)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Open file in system explorer
  ipcMain.handle(IPC_CHANNELS.FILE_OPEN_EXPLORER, async (_event, filePath: string) => {
    try {
      if (statSync(filePath).isDirectory()) {
        shell.openPath(filePath)
      } else {
        shell.showItemInFolder(filePath)
      }
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Find files by name recursively (for bare-filename resolution)
  ipcMain.handle(IPC_CHANNELS.FILE_FIND, async (_event, cwd: string, filename: string, skipPatterns?: string[]) => {
    const patterns = skipPatterns || []
    const results: string[] = []
    const maxDepth = 5
    const maxResults = 50

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > maxDepth || results.length >= maxResults) return
      let entries: any[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (results.length >= maxResults) return
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (patterns.includes(entry.name)) continue
          await walk(full, depth + 1)
        } else if (entry.name === filename) {
          results.push(full)
        }
      }
    }

    try {
      await walk(cwd, 0)
      return { matches: results }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Search files and directories by name/path substring (for @-mention autocomplete)
  ipcMain.handle(IPC_CHANNELS.FILE_SEARCH_BY_NAME, async (_event, cwd: string, query: string, skipPatterns?: string[]) => {
    const patterns = skipPatterns || []
    const q = (query || '').toLowerCase().trim()
    if (!q) return { matches: [] }
    const matches: { name: string; path: string; type: 'file' | 'directory'; relativePath: string }[] = []
    const maxDepth = 12
    const maxResults = 100
    const maxScanned = 20000
    let scanned = 0

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > maxDepth || matches.length >= maxResults || scanned >= maxScanned) return
      let entries: any[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      scanned += entries.length
      entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
      for (const entry of entries) {
        if (matches.length >= maxResults) return
        const full = join(dir, entry.name)
        const isDir = entry.isDirectory()
        if (isDir && patterns.includes(entry.name)) continue
        const rel = relative(cwd, full).replace(/\\/g, '/')
        if (rel.toLowerCase().includes(q)) {
          matches.push({ name: entry.name, path: full, type: isDir ? 'directory' : 'file', relativePath: rel })
        }
        if (isDir) await walk(full, depth + 1)
      }
    }

    try {
      await walk(cwd, 0)
      matches.sort((a, b) => {
        const an = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bn = b.name.toLowerCase().startsWith(q) ? 0 : 1
        if (an !== bn) return an - bn
        return a.relativePath.localeCompare(b.relativePath)
      })
      return { matches: matches.slice(0, maxResults) }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Get file tree
  ipcMain.handle(IPC_CHANNELS.FILE_TREE, async (_event, dirPath: string, depth?: number, skipPatterns?: string[]) => {
    try {
      return await buildFileTree(dirPath, depth || 3, 0, skipPatterns || [])
    } catch (err: any) {
      return { error: err.message }
    }
  })
}

async function buildFileTree(dirPath: string, maxDepth: number, currentDepth: number = 0, skipPatterns: string[] = []): Promise<FileNode[]> {
  // 到达最大深度时：仍列出当前目录文件，但不递归子目录
  const entries = await readdir(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []

  // Sort: directories first, then files
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sorted) {
    if (entry.isDirectory() && skipPatterns.includes(entry.name)) continue

    const fullPath = join(dirPath, entry.name)
    const node: FileNode = {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? 'directory' : 'file'
    }

    if (entry.isDirectory() && currentDepth < maxDepth - 1) {
      node.children = await buildFileTree(fullPath, maxDepth, currentDepth + 1)
    }

    nodes.push(node)
  }

  return nodes
}