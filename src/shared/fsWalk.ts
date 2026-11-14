import { readdir } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, relative } from 'path'
import type { FileNode } from './types'

export async function buildFsTree(dirPath: string, maxDepth: number, currentDepth = 0, skipPatterns: string[] = []): Promise<FileNode[]> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })
  const nodes: FileNode[] = []
  for (const entry of sorted) {
    if (entry.isDirectory() && skipPatterns.includes(entry.name)) continue
    const fullPath = join(dirPath, entry.name)
    const node: FileNode = {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? 'directory' : 'file',
    }
    if (entry.isDirectory() && currentDepth < maxDepth - 1) {
      node.children = await buildFsTree(fullPath, maxDepth, currentDepth + 1, skipPatterns)
    }
    nodes.push(node)
  }
  return nodes
}

export async function findFilesByName(cwd: string, filename: string, skipPatterns: string[] = []): Promise<string[]> {
  const results: string[] = []
  const maxDepth = 5
  const maxResults = 50

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || results.length >= maxResults) return
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (skipPatterns.includes(entry.name)) continue
        await walk(full, depth + 1)
      } else if (entry.name === filename) {
        results.push(full)
      }
    }
  }

  await walk(cwd, 0)
  return results
}

export interface NameMatch {
  name: string
  path: string
  type: 'file' | 'directory'
  relativePath: string
}

export async function searchPathsByName(cwd: string, query: string, skipPatterns: string[] = [], nameOnly?: boolean): Promise<NameMatch[]> {
  const q = (query || '').toLowerCase().trim()
  if (!q) return []
  const matches: NameMatch[] = []
  const maxDepth = 12
  const maxResults = 100
  const maxScanned = 20000
  let scanned = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || matches.length >= maxResults || scanned >= maxScanned) return
    let entries: Dirent[]
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
      if (isDir && skipPatterns.includes(entry.name)) continue
      const rel = relative(cwd, full).replace(/\\/g, '/')
      const hit = nameOnly ? entry.name.toLowerCase().includes(q) : rel.toLowerCase().includes(q)
      if (hit && !isDir) {
        matches.push({ name: entry.name, path: full, type: 'file', relativePath: rel })
      }
      if (isDir) await walk(full, depth + 1)
    }
  }

  await walk(cwd, 0)
  matches.sort((a, b) => {
    const an = a.name.toLowerCase().startsWith(q) ? 0 : 1
    const bn = b.name.toLowerCase().startsWith(q) ? 0 : 1
    if (an !== bn) return an - bn
    return a.relativePath.localeCompare(b.relativePath)
  })
  return matches.slice(0, maxResults)
}
