import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import simpleGit from 'simple-git'
import { buildFsTree, findFilesByName, searchPathsByName } from '../shared/fsWalk'
import { grepFiles, replaceInFiles } from '../shared/contentSearch'

const gitInstances = new Map<string, any>()

function gitFor(cwd: string): any {
  let git = gitInstances.get(cwd)
  if (!git) {
    git = simpleGit(cwd, { config: ['core.quotePath=false'] })
    gitInstances.set(cwd, git)
  }
  return git
}

async function handle(method: string, params: any): Promise<any> {
  switch (method) {
    case 'ping':
      return { pong: true, node: process.version, platform: process.platform, arch: process.arch }

    case 'fs.home':
      return process.env.HOME || process.env.USERPROFILE || '/'

    case 'fs.list': {
      const entries = await fs.readdir(params.path, { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        path: join(params.path, entry.name),
        type: entry.isDirectory() ? 'directory' : 'file',
      }))
    }

    case 'fs.stat': {
      const stat = await fs.stat(params.path)
      return {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
      }
    }

    case 'fs.readText':
      return fs.readFile(params.path, 'utf8')

    case 'fs.readBase64': {
      const buffer = await fs.readFile(params.path)
      return { base64: buffer.toString('base64'), size: buffer.length }
    }

    case 'fs.writeBase64': {
      await fs.mkdir(dirname(params.path), { recursive: true })
      await fs.writeFile(params.path, Buffer.from(params.base64, 'base64'))
      return { success: true }
    }

    case 'fs.tree':
      return buildFsTree(params.path, params.depth || 3, 0, params.skipPatterns || [])

    case 'fs.delete':
      await fs.rm(params.path, { recursive: true, force: true })
      return { success: true }

    case 'fs.rename':
    case 'fs.move':
      await fs.rename(params.oldPath ?? params.srcPath, params.newPath ?? params.destPath)
      return { success: true }

    case 'fs.mkdir':
      await fs.mkdir(params.path, { recursive: true })
      return { success: true }

    case 'fs.copy':
      await fs.cp(params.srcPath, params.destPath, { recursive: true })
      return { success: true }

    case 'fs.find':
      return { matches: await findFilesByName(params.cwd, params.filename, params.skipPatterns || []) }

    case 'fs.searchByName':
      return { matches: await searchPathsByName(params.cwd, params.query, params.skipPatterns || [], params.nameOnly) }

    case 'search.grep':
      return await grepFiles(params)

    case 'search.replace':
      return await replaceInFiles(params)

    case 'git.call': {
      const git = gitFor(params.cwd)
      const fn = git[params.method]
      if (typeof fn !== 'function') throw new Error(`Unknown git method: ${params.method}`)
      return await fn.apply(git, params.args || [])
    }

    default:
      throw new Error(`Unknown method: ${method}`)
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })

input.on('line', line => {
  if (!line.trim()) return
  let message: any
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (typeof message.id !== 'number') return
  handle(message.method, message.params)
    .then(result => {
      process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n')
    })
    .catch((err: any) => {
      process.stdout.write(JSON.stringify({ id: message.id, error: { message: err?.message ?? String(err), code: err?.code } }) + '\n')
    })
})
