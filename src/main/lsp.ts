import { ipcMain, app } from 'electron'
import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import {
  IPC_CHANNELS, LSP_SERVERS, LSP_LANG_TO_SERVER,
  type LspDefinitionArgs, type LspDefinitionResult, type LspLocation, type LspStatus
} from '../shared/types'

const IDLE_KILL_MS = 15 * 60 * 1000
const INIT_TIMEOUT_MS = 30_000
const REQUEST_TIMEOUT_MS = 20_000
const ROOT_WALK_MAX = 8

interface Resolved { cmd: string; args: string[] }
interface ServerDef {
  resolve: () => Resolved | null
  rootMarkers: string[]
  rootArgs?: (root: string) => string[]   // 依赖工程根的启动参数（clangd 的 compile_commands 目录）
}

function nodeModulesRoot(): string {
  const p = app.getAppPath()
  return p.endsWith('.asar') ? p + '.unpacked' : p
}

// 必须落在 asar.unpacked 的真实目录：pyright 用 worker_threads 起自己的 worker，asar 内路径加载不了
function resolvePyright(): Resolved | null {
  const script = join(nodeModulesRoot(), 'node_modules', 'pyright', 'langserver.index.js')
  if (!existsSync(script)) return null
  return { cmd: app.isPackaged ? process.execPath : 'node', args: [script, '--stdio'] }
}

// clangd 多半不在 PATH 上：Windows 上它要么来自 LLVM 安装包，要么是 VS 自带的 LLVM 工具集。
// PATH 仍首选，其次看常见安装位置，省掉用户手动配环境变量
function clangdCandidates(): string[] {
  const env = process.env
  if (process.platform !== 'win32') {
    return ['/usr/bin/clangd', '/usr/local/bin/clangd', '/opt/homebrew/bin/clangd', '/usr/lib/llvm/bin/clangd']
  }
  const pf = env['ProgramFiles'] || 'C:\\Program Files'
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = env['LOCALAPPDATA']
  const out = [
    join(pf, 'LLVM', 'bin', 'clangd.exe'),
    join(pf86, 'LLVM', 'bin', 'clangd.exe'),
    local ? join(local, 'Programs', 'LLVM', 'bin', 'clangd.exe') : '',
  ]
  for (const year of ['2022', '2019']) {
    for (const root of [join(pf, 'Microsoft Visual Studio', year), join(pf86, 'Microsoft Visual Studio', year)]) {
      for (const ed of ['Community', 'Professional', 'Enterprise', 'BuildTools']) {
        out.push(join(root, ed, 'VC', 'Tools', 'Llvm', 'x64', 'bin', 'clangd.exe'))
        out.push(join(root, ed, 'VC', 'Tools', 'Llvm', 'bin', 'clangd.exe'))
      }
    }
  }
  return out.filter(Boolean)
}

function resolveClangd(): Resolved | null {
  try {
    const probe = process.platform === 'win32' ? 'where clangd' : 'which clangd'
    const out = execSync(probe, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim().split(/\r?\n/)[0]
    if (out) return { cmd: out.trim(), args: ['--stdio'] }
  } catch {}
  for (const p of clangdCandidates()) {
    if (existsSync(p)) return { cmd: p, args: ['--stdio'] }
  }
  return null
}

// clangd 只从文件所在目录向上找 compile_commands.json；CMake 默认生成在 build/ 里就漏了
function compileCommandsDir(root: string): string | null {
  for (const rel of ['', 'build', 'out', 'cmake-build-debug', 'cmake-build-release']) {
    const dir = rel ? join(root, rel) : root
    if (existsSync(join(dir, 'compile_commands.json'))) return dir
  }
  return null
}

const SERVER_DEFS: Record<string, ServerDef> = {
  python: {
    resolve: resolvePyright,
    rootMarkers: ['pyrightconfig.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'tox.ini', '.git'],
  },
  c: {
    resolve: resolveClangd,
    rootMarkers: ['compile_commands.json', 'compile_flags.txt', 'CMakeLists.txt', 'Makefile', '.git'],
    rootArgs: (root) => {
      const dir = compileCommandsDir(root)
      return dir ? [`--compile-commands-dir=${dir}`] : []
    },
  },
}

const resolvedCache = new Map<string, Resolved | null>()

function resolveServer(serverId: string, refresh = false): Resolved | null {
  if (!refresh && resolvedCache.has(serverId)) return resolvedCache.get(serverId)!
  const r = SERVER_DEFS[serverId].resolve()
  resolvedCache.set(serverId, r)
  return r
}

// fileURLToPath 原样保留 URI 里的盘符大小写，而 pyright 发的是小写（c%3A）；
// tab 去重按路径字符串比对且不转小写（fileTabs.ts normTabPath），不统一会开出重复 tab
const normalizeDrive = (p: string) => (/^[a-z]:/.test(p) ? p[0].toUpperCase() + p.slice(1) : p)

const normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')

// 从文件向上找工程标记，但不上穿会话工作目录 —— 根比 cwd 大会成倍推高服务器内存
function findRoot(startFile: string, markers: string[], cwd: string): string {
  const c = normPath(cwd)
  let dir = dirname(startFile)
  for (let i = 0; i < ROOT_WALK_MAX; i++) {
    const nd = normPath(dir)
    if (nd !== c && !nd.startsWith(c + '/')) break
    for (const m of markers) {
      if (existsSync(join(dir, m))) return dir
    }
    if (nd === c) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return cwd
}

interface Pending { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

class LspClient {
  private proc: ChildProcess | null = null
  private buf = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, Pending>()
  private docs = new Map<string, { version: number; text: string }>()
  private initPromise: Promise<void> | null = null
  private idle: ReturnType<typeof setTimeout> | null = null
  private dead = false
  private initialized = false

  constructor(private serverId: string, private def: ServerDef, readonly root: string) {}

  get pid(): number { return this.proc?.pid ?? 0 }
  get alive(): boolean { return !this.dead && !!this.proc }
  get ready(): boolean { return this.initialized && !this.dead }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => { stopClient(this.serverId) }, IDLE_KILL_MS)
  }

  private write(msg: unknown): void {
    const stdin = this.proc?.stdin
    if (!stdin || this.dead) return
    const body = Buffer.from(JSON.stringify(msg), 'utf-8')
    stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    stdin.write(body)
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private request(method: string, params: unknown, timeout = REQUEST_TIMEOUT_MS): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.dead) { reject(new Error('server not running')); return }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timeout`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  private onData = (chunk: Buffer): void => {
    this.buf = Buffer.concat([this.buf, chunk])
    for (;;) {
      const sep = this.buf.indexOf('\r\n\r\n')
      if (sep < 0) return
      const header = this.buf.subarray(0, sep).toString('ascii')
      const m = /content-length:\s*(\d+)/i.exec(header)
      if (!m) { this.buf = this.buf.subarray(sep + 4); continue }
      const len = Number(m[1])
      if (this.buf.length < sep + 4 + len) return
      const body = this.buf.subarray(sep + 4, sep + 4 + len).toString('utf-8')
      this.buf = this.buf.subarray(sep + 4 + len)
      try { this.dispatch(JSON.parse(body)) } catch {}
    }
  }

  private dispatch(msg: any): void {
    if (msg.id !== undefined && msg.method) {
      // clangd 会发 workspace/configuration、client/registerCapability 等反向请求，不应答会一直挂起
      this.write({ jsonrpc: '2.0', id: msg.id, result: null })
      return
    }
    if (msg.id === undefined) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new Error(msg.error.message || 'lsp error'))
    else p.resolve(msg.result)
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err) }
    this.pending.clear()
  }

  start(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = (async () => {
      const r = this.def.resolve()
      if (!r) throw new Error('language server not found')
      const args = [...r.args, ...(this.def.rootArgs?.(this.root) ?? [])]
      const env = app.isPackaged ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
      const proc = spawn(r.cmd, args, {
        cwd: this.root,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env,
      })
      this.proc = proc
      proc.stdout?.on('data', this.onData)
      proc.stderr?.on('data', () => {})
      proc.on('exit', () => this.onExit())
      proc.on('error', () => this.onExit())
      this.touch()
      const rootUri = pathToFileURL(this.root).href
      await this.request('initialize', {
        processId: process.pid,
        clientInfo: { name: 'vibe-ide' },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
        capabilities: { workspace: { workspaceFolders: true } },
      }, INIT_TIMEOUT_MS)
      this.notify('initialized', {})
      this.initialized = true
      this.touch()
    })()
    return this.initPromise
  }

  private onExit(): void {
    this.dead = true
    this.proc = null
    this.initialized = false
    this.initPromise = null
    this.docs.clear()
    this.failPending(new Error('server exited'))
  }

  async definition(fullPath: string, langId: string, text: string, line: number, column: number): Promise<LspLocation[]> {
    const uri = pathToFileURL(fullPath).href
    const doc = this.docs.get(uri)
    if (!doc) {
      this.docs.set(uri, { version: 1, text })
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId: langId, version: 1, text } })
    } else if (doc.text !== text) {
      doc.version++
      doc.text = text
      this.notify('textDocument/didChange', { textDocument: { uri, version: doc.version }, contentChanges: [{ text }] })
    }
    this.touch()
    const res = await this.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: line - 1, character: column - 1 },
    })
    if (!res) return []
    const items = Array.isArray(res) ? res : [res]
    const locations: LspLocation[] = []
    for (const item of items) {
      const target = item?.targetUri ?? item?.uri
      const range = item?.targetSelectionRange ?? item?.targetRange ?? item?.range
      if (!target || !range?.start) continue
      let p: string
      try { p = fileURLToPath(target) } catch { continue }
      locations.push({ path: normalizeDrive(p), line: range.start.line + 1, column: range.start.character + 1 })
    }
    return locations
  }

  stop(): void {
    if (this.idle) { clearTimeout(this.idle); this.idle = null }
    this.dead = true
    this.initialized = false
    const proc = this.proc
    this.proc = null
    this.docs.clear()
    this.failPending(new Error('server stopped'))
    if (!proc?.pid) return
    try {
      // proc.kill 在 Windows 会留下孤儿子进程（编码服务器/worker），必须整树杀
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore', windowsHide: true })
      else proc.kill('SIGKILL')
    } catch {}
  }
}

const clients = new Map<string, LspClient>()
const enabledServers = new Set<string>()

function stopClient(serverId: string): void {
  const c = clients.get(serverId)
  if (!c) return
  c.stop()
  clients.delete(serverId)
}

async function handleDefinition(args: LspDefinitionArgs): Promise<LspDefinitionResult> {
  const serverId = LSP_LANG_TO_SERVER[args?.langId]
  if (!serverId || !enabledServers.has(serverId)) return { state: 'unavailable', locations: [] }
  if (!args.fullPath || !args.line || !args.column) return { state: 'unavailable', locations: [] }
  const def = SERVER_DEFS[serverId]
  if (!def || !resolveServer(serverId)) return { state: 'unavailable', locations: [] }

  const root = findRoot(args.fullPath, def.rootMarkers, args.root)
  let client = clients.get(serverId)
  if (client && !client.alive) { clients.delete(serverId); client = undefined }
  if (client && client.root !== root) { client.stop(); clients.delete(serverId); client = undefined }

  if (!client) {
    const fresh = new LspClient(serverId, def, root)
    clients.set(serverId, fresh)
    fresh.start().catch(() => {
      if (clients.get(serverId) === fresh) clients.delete(serverId)
    })
    return { state: 'warming', locations: [] }
  }
  if (!client.ready) return { state: 'warming', locations: [] }

  try {
    return { state: 'ok', locations: await client.definition(args.fullPath, args.langId, args.text ?? '', args.line, args.column) }
  } catch {
    return { state: 'warming', locations: [] }
  }
}

export function registerLspHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.LSP_SET_ENABLED, (_event, serverId: string, on: boolean) => {
    if (typeof serverId !== 'string' || !SERVER_DEFS[serverId]) return { error: 'unknown server' }
    if (on) enabledServers.add(serverId)
    else { enabledServers.delete(serverId); stopClient(serverId) }
    return { enabled: enabledServers.has(serverId) }
  })

  ipcMain.handle(IPC_CHANNELS.LSP_DEFINITION, (_event, args: LspDefinitionArgs) => handleDefinition(args))

  ipcMain.handle(IPC_CHANNELS.LSP_STATUS, (): LspStatus => {
    const available: Record<string, boolean> = {}
    for (const { id } of LSP_SERVERS) available[id] = !!resolveServer(id, true)
    const running = [...clients.entries()]
      .filter(([, c]) => c.alive)
      .map(([id, c]) => ({ id, pid: c.pid, root: c.root }))
    return { available, running }
  })

  ipcMain.handle(IPC_CHANNELS.LSP_STOP, (_event, serverId?: string) => {
    if (serverId) stopClient(serverId)
    else for (const id of [...clients.keys()]) stopClient(id)
    return { ok: true }
  })
}

export function cleanupLsp(): void {
  for (const id of [...clients.keys()]) stopClient(id)
  clients.clear()
}
