import { ipcMain, shell } from 'electron'
import { readFile, writeFile, readdir, rename, mkdir, rm } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { IPC_CHANNELS, FileNode } from '../shared/types'
import * as iconv from 'iconv-lite'
import * as jschardet from 'jschardet'
import { normalizeEncoding, DEFAULT_ENCODING } from '../shared/encodings'

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

async function readFileWithEncoding(filePath: string, encoding?: string) {
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

  if (!encoding && confidence < 0.1 && buffer.includes(0x00)) {
    return { error: 'Binary file detected, cannot read as text', content: '', encoding: '', bom: false, confidence: 0 }
  }

  const content = iconv.decode(buffer, targetEncoding)
  return { content, encoding: targetEncoding, bom, confidence }
}

export function registerFileHandlers(): void {
  // Read file content (legacy, always UTF-8)
  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8')
      return { content }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Read file content with encoding detection/support
  ipcMain.handle(IPC_CHANNELS.FILE_READ_ENCODING, async (_event, filePath: string, encoding?: string) => {
    try {
      return await readFileWithEncoding(filePath, encoding)
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

  // Open file in system explorer
  ipcMain.handle(IPC_CHANNELS.FILE_OPEN_EXPLORER, async (_event, filePath: string) => {
    try {
      shell.showItemInFolder(filePath)
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