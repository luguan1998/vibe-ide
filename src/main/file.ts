import { app, ipcMain, nativeImage, shell } from 'electron'
import { spawn } from 'child_process'
import { readFile, writeFile, readdir, rename, mkdir, rm, cp, stat } from 'fs/promises'
import { existsSync, statSync } from 'fs'
import { join, dirname, extname, posix } from 'path'
import { IPC_CHANNELS } from '../shared/types'
import * as iconv from 'iconv-lite'
import * as jschardet from 'jschardet'
import { normalizeEncoding, DEFAULT_ENCODING } from '../shared/encodings'
import { buildFsTree, findFilesByName, searchPathsByName } from '../shared/fsWalk'
import { getSshRelay } from './remote/ssh'
import { resolveRemoteConnection } from './remote/roots'
import type { RelayClient } from './remote/relay-client'

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

function dragIcon(): Electron.NativeImage | string {
  const candidates = [
    join(process.resourcesPath, 'icon.ico'),
    join(__dirname, '../../build/icon.ico'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return nativeImage.createEmpty()
}

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

function remoteRelay(filePath: string): RelayClient | undefined {
  const connectionId = resolveRemoteConnection(filePath)
  return connectionId ? getSshRelay(connectionId) : undefined
}

interface FsBackend {
  relay: RelayClient | null
}

function backendOf(filePath: string): FsBackend {
  return { relay: remoteRelay(filePath) ?? null }
}

function backendJoin(dir: string, name: string, remote: boolean): string {
  return remote ? posix.join(dir, name) : join(dir, name)
}

async function backendMkdir(backend: FsBackend, dirPath: string): Promise<void> {
  if (backend.relay) {
    await backend.relay.request('fs.mkdir', { path: dirPath })
    return
  }
  await mkdir(dirPath, { recursive: true })
}

async function backendList(backend: FsBackend, dirPath: string): Promise<{ name: string; isDirectory: boolean }[]> {
  if (backend.relay) {
    const entries = await backend.relay.request('fs.list', { path: dirPath })
    return entries.map((e: any) => ({ name: e.name, isDirectory: e.type === 'directory' }))
  }
  const entries = await readdir(dirPath, { withFileTypes: true })
  return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
}

async function backendRead(backend: FsBackend, filePath: string): Promise<Buffer> {
  if (backend.relay) {
    const { base64 } = await backend.relay.request('fs.readBase64', { path: filePath })
    return Buffer.from(base64, 'base64')
  }
  return readFile(filePath)
}

async function backendWrite(backend: FsBackend, filePath: string, data: Buffer): Promise<void> {
  if (backend.relay) {
    await backend.relay.request('fs.writeBase64', { path: filePath, base64: data.toString('base64') })
    return
  }
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, data)
}

async function copyAcrossBackends(srcPath: string, destPath: string): Promise<void> {
  const src = backendOf(srcPath)
  const dest = backendOf(destPath)
  // 本地 stat 的 isDirectory 是方法，relay 返回的是布尔值，必须分别归一
  const isDir = src.relay
    ? (await src.relay.request('fs.stat', { path: srcPath })).isDirectory
    : (await stat(srcPath)).isDirectory()
  if (isDir) {
    await backendMkdir(dest, destPath)
    for (const entry of await backendList(src, srcPath)) {
      await copyAcrossBackends(
        backendJoin(srcPath, entry.name, !!src.relay),
        backendJoin(destPath, entry.name, !!dest.relay),
      )
    }
    return
  }
  await backendWrite(dest, destPath, await backendRead(src, srcPath))
}

async function removeAcrossBackends(filePath: string): Promise<void> {
  const backend = backendOf(filePath)
  if (backend.relay) {
    await backend.relay.request('fs.delete', { path: filePath })
    return
  }
  await rm(filePath, { recursive: true, force: true })
}

function decodeBuffer(buffer: Buffer, encoding?: string, forceOpen?: boolean) {
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

  if (!forceOpen && !encoding && confidence < 0.1 && buffer.includes(0x00)) return null

  return { content: iconv.decode(buffer, targetEncoding), encoding: targetEncoding, bom, confidence }
}

export async function readFileWithEncoding(filePath: string, encoding?: string, forceOpen?: boolean) {
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
  const decoded = decodeBuffer(buffer, encoding, forceOpen)
  if (!decoded) {
    return { error: 'Cannot display binary file', content: '', encoding: '', bom: false, confidence: 0 }
  }
  return decoded
}

async function readRemoteWithEncoding(relay: RelayClient, filePath: string, encoding?: string, forceOpen?: boolean) {
  const empty = { content: '', encoding: '', bom: false, confidence: 0 }
  if (!forceOpen) {
    if (isBinaryByExtension(filePath)) {
      return { error: 'Cannot display binary file', ...empty }
    }
    try {
      const st = await relay.request('fs.stat', { path: filePath })
      if (st.size > MAX_EDIT_FILE_SIZE) {
        const mb = (st.size / (1024 * 1024)).toFixed(1)
        return { error: `File too large (${mb} MB), cannot display`, ...empty }
      }
    } catch {
      return { error: 'File not found or inaccessible', ...empty }
    }
  }
  try {
    const { base64 } = await relay.request('fs.readBase64', { path: filePath })
    const decoded = decodeBuffer(Buffer.from(base64, 'base64'), encoding, forceOpen)
    if (!decoded) return { error: 'Cannot display binary file', ...empty }
    return decoded
  } catch (err: any) {
    return { error: err?.message ?? String(err), ...empty }
  }
}

export function registerFileHandlers(): void {
  // Read file content (legacy, always UTF-8)
  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_event, filePath: string) => {
    try {
      if (isBinaryByExtension(filePath)) {
        return { error: 'Cannot display binary file' }
      }
      const relay = remoteRelay(filePath)
      if (relay) {
        const st = await relay.request('fs.stat', { path: filePath })
        if (st.size > MAX_EDIT_FILE_SIZE) {
          const mb = (st.size / (1024 * 1024)).toFixed(1)
          return { error: `File too large (${mb} MB), cannot display` }
        }
        const content = await relay.request('fs.readText', { path: filePath })
        return { content }
      }
      const st = await stat(filePath)
      if (st.size > MAX_EDIT_FILE_SIZE) {
        const mb = (st.size / (1024 * 1024)).toFixed(1)
        return { error: `File too large (${mb} MB), cannot display` }
      }
      const content = await readFile(filePath, 'utf-8')
      return { content }
    } catch (err: any) {
      // code 供 renderer 区分「不存在」与「存在但读不了」——前者允许新建覆盖
      return { error: err.message, code: err.code }
    }
  })

  // Read file content with encoding detection/support
  ipcMain.handle(IPC_CHANNELS.FILE_READ_ENCODING, async (_event, filePath: string, encoding?: string, forceOpen?: boolean) => {
    try {
      const relay = remoteRelay(filePath)
      if (relay) return await readRemoteWithEncoding(relay, filePath, encoding, forceOpen)
      return await readFileWithEncoding(filePath, encoding, forceOpen)
    } catch (err: any) {
      return { error: err.message, content: '', encoding: '', bom: false, confidence: 0 }
    }
  })

  
  // Write file content
  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_event, filePath: string, content: string | Uint8Array) => {
    try {
      const relay = remoteRelay(filePath)
      if (relay) {
        const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : Buffer.from(content)
        await relay.request('fs.writeBase64', { path: filePath, base64: buffer.toString('base64') })
        return { success: true }
      }
      const dir = dirname(filePath)
      const { mkdir } = require('fs/promises')
      await mkdir(dir, { recursive: true })
      if (typeof content === 'string') await writeFile(filePath, content, 'utf-8')
      else await writeFile(filePath, content)
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
      const relay = remoteRelay(filePath)
      if (relay) {
        await relay.request('fs.writeBase64', { path: filePath, base64: buffer.toString('base64') })
        return { success: true }
      }
      const dir = dirname(filePath)
      const { mkdir } = require('fs/promises')
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, buffer)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Enumerate available drive letters
  ipcMain.handle(IPC_CHANNELS.FILE_GET_DRIVES, () => {
    const drives: string[] = []
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i)
      try {
        if (existsSync(`${letter}:\\`)) drives.push(`${letter}:\\`)
      } catch {}
    }
    return drives
  })

  // List files in directory
  ipcMain.handle(IPC_CHANNELS.FILE_LIST, async (_event, dirPath: string) => {
    try {
      const relay = remoteRelay(dirPath)
      if (relay) return await relay.request('fs.list', { path: dirPath })
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
      const relay = remoteRelay(filePath)
      if (relay) return await relay.request('fs.delete', { path: filePath })
      await rm(filePath, { recursive: true })
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Rename/move file or directory
  ipcMain.handle(IPC_CHANNELS.FILE_RENAME, async (_event, oldPath: string, newPath: string) => {
    try {
      const relay = remoteRelay(oldPath)
      if (relay) return await relay.request('fs.rename', { oldPath, newPath })
      await rename(oldPath, newPath)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Create directory
  ipcMain.handle(IPC_CHANNELS.FILE_CREATE_DIR, async (_event, dirPath: string) => {
    try {
      const relay = remoteRelay(dirPath)
      if (relay) return await relay.request('fs.mkdir', { path: dirPath })
      await mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Copy file or directory recursively
  ipcMain.handle(IPC_CHANNELS.FILE_COPY, async (_event, srcPath: string, destPath: string) => {
    try {
      const srcRelay = remoteRelay(srcPath)
      const destRelay = remoteRelay(destPath)
      if (srcRelay && srcRelay === destRelay) return await srcRelay.request('fs.copy', { srcPath, destPath })
      if (srcRelay || destRelay) {
        await copyAcrossBackends(srcPath, destPath)
        return { success: true }
      }
      await cp(srcPath, destPath, { recursive: true })
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Move (cut) file or directory
  ipcMain.handle(IPC_CHANNELS.FILE_MOVE, async (_event, srcPath: string, destPath: string) => {
    try {
      const srcRelay = remoteRelay(srcPath)
      const destRelay = remoteRelay(destPath)
      if (srcRelay && srcRelay === destRelay) return await srcRelay.request('fs.move', { srcPath, destPath })
      if (srcRelay || destRelay) {
        await copyAcrossBackends(srcPath, destPath)
        await removeAcrossBackends(srcPath)
        return { success: true }
      }
      await rename(srcPath, destPath)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Drag a file out to the OS (Explorer copies it to the drop folder)
  ipcMain.on(IPC_CHANNELS.FILE_START_DRAG, async (event, filePath: string) => {
    try {
      let localPath = filePath
      if (remoteRelay(filePath)) {
        const tempRoot = join(app.getPath('temp'), 'vibe-ide-drag')
        await rm(tempRoot, { recursive: true, force: true })
        const tempDir = join(tempRoot, Date.now().toString(36))
        await mkdir(tempDir, { recursive: true })
        localPath = join(tempDir, posix.basename(filePath))
        await copyAcrossBackends(filePath, localPath)
      }
      if (event.sender.isDestroyed()) return
      event.sender.startDrag({ file: localPath, icon: dragIcon() })
    } catch {}
  })

  // Open file in system explorer
  ipcMain.handle(IPC_CHANNELS.FILE_OPEN_EXPLORER, async (_event, filePath: string) => {
    try {
      if (remoteRelay(filePath)) return { error: 'Remote path: local explorer is not available' }
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

  // Open a directory in Windows Terminal
  ipcMain.handle(IPC_CHANNELS.FILE_OPEN_TERMINAL, async (_event, dirPath: string) => {
    try {
      if (remoteRelay(dirPath)) return { error: 'Remote path: local terminal is not available' }
      const child = spawn('wt.exe', ['-d', dirPath], { detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Find files by name recursively (for bare-filename resolution)
  ipcMain.handle(IPC_CHANNELS.FILE_FIND, async (_event, cwd: string, filename: string, skipPatterns?: string[]) => {
    const relay = remoteRelay(cwd)
    if (relay) {
      try {
        return await relay.request('fs.find', { cwd, filename, skipPatterns: skipPatterns || [] })
      } catch (err: any) {
        return { error: err.message }
      }
    }
    try {
      return { matches: await findFilesByName(cwd, filename, skipPatterns || []) }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Search files and directories by name/path substring (for @-mention autocomplete)
  ipcMain.handle(IPC_CHANNELS.FILE_SEARCH_BY_NAME, async (_event, cwd: string, query: string, skipPatterns?: string[], nameOnly?: boolean) => {
    const relay = remoteRelay(cwd)
    if (relay) {
      try {
        return await relay.request('fs.searchByName', { cwd, query, skipPatterns: skipPatterns || [], nameOnly })
      } catch (err: any) {
        return { error: err.message }
      }
    }
    try {
      return { matches: await searchPathsByName(cwd, query || '', skipPatterns || [], nameOnly) }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Get file tree
  ipcMain.handle(IPC_CHANNELS.FILE_TREE, async (_event, dirPath: string, depth?: number, skipPatterns?: string[]) => {
    try {
      const relay = remoteRelay(dirPath)
      if (relay) return await relay.request('fs.tree', { path: dirPath, depth: depth || 3, skipPatterns: skipPatterns || [] })
      return await buildFsTree(dirPath, depth || 3, 0, skipPatterns || [])
    } catch (err: any) {
      return { error: err.message }
    }
  })
}

