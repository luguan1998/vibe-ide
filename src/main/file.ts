import { ipcMain, shell } from 'electron'
import { readFile, writeFile, readdir, rename, mkdir, rm } from 'fs/promises'
import { join, dirname } from 'path'
import { IPC_CHANNELS, FileNode } from '../shared/types'

export function registerFileHandlers(): void {
  // Read file content
  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8')
      return { content }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Write file content
  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_event, filePath: string, content: string) => {
    try {
      // Ensure directory exists
      const dir = dirname(filePath)
      const { mkdir } = require('fs/promises')
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, content, 'utf-8')
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

  // Get file tree
  ipcMain.handle(IPC_CHANNELS.FILE_TREE, async (_event, dirPath: string, depth?: number) => {
    try {
      return await buildFileTree(dirPath, depth || 3)
    } catch (err: any) {
      return { error: err.message }
    }
  })
}

async function buildFileTree(dirPath: string, maxDepth: number, currentDepth: number = 0): Promise<FileNode[]> {
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
    // Skip hidden directories and node_modules, but keep dotfiles (.gitignore etc.)
    if (entry.isDirectory() && entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules') continue

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