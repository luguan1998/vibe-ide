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
// tsserver 加载工程的等待窗口（见 awaitProjectLoad）
const PROJECT_LOAD_WAIT_MS = 10_000
const PROGRESS_BEGIN_GRACE_MS = 600
const PROGRESS_POLL_MS = 50
// 冷启动或切换 root 时把跳转请求挂起，等服务器就绪再答 —— 否则用户每次都要白点一下
const QUEUE_WAIT_MS = 5000

interface Resolved { cmd: string; args: string[] }
interface ServerDef {
  resolve: () => Resolved | null
  rootMarkers: string[]
  rootArgs?: (root: string) => string[]   // 依赖工程根的启动参数（clangd 的 compile_commands 目录）
  waitProjectLoad?: boolean               // 打开文档后才异步建 program，加载期间回答不可信（tsserver）
  initOptions?: Record<string, unknown>   // initialize.initializationOptions
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

// 必须落在 asar.unpacked 的真实目录：它 fork 出来的 tsserver 子进程按真实路径加载
function resolveTypescriptLanguageServer(): Resolved | null {
  const cli = join(nodeModulesRoot(), 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs')
  if (!existsSync(cli)) return null
  return { cmd: app.isPackaged ? process.execPath : 'node', args: [cli, '--stdio'] }
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
  ts: {
    resolve: resolveTypescriptLanguageServer,
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json', '.git'],
    waitProjectLoad: true,
    // 默认开着 ATA（缺 @types 就往用户仓库跑 npm install），跳转不需要它
    initOptions: { disableAutomaticTypingAcquisition: true },
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

// 从文件向上找工程标记，但不上穿会话工作目录 —— 根比 cwd 大会成倍推高服务器内存。
// 记「最靠近 cwd 的」而非「最近的」：多包仓库里子目录遍地 package.json，就近优先会让同一会话的
// root 在子包之间横跳，每次跳转都触发服务器重建
function findRoot(startFile: string, markers: string[], cwd: string): string {
  const c = normPath(cwd)
  let dir = dirname(startFile)
  let best: string | null = null
  for (let i = 0; i < ROOT_WALK_MAX; i++) {
    const nd = normPath(dir)
    if (nd !== c && !nd.startsWith(c + '/')) break
    if (markers.some(m => existsSync(join(dir, m)))) best = dir
    if (nd === c) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return best ?? cwd
}

interface Pending { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

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
  private loading = new Set<string | number>()   // 进行中的 workDone 进度（tsserver 用它标记建 program）

  constructor(private serverId: string, private def: ServerDef, readonly root: string) {}

  get pid(): number { return this.proc?.pid ?? 0 }
  get alive(): boolean { return !this.dead && !!this.proc }
  get ready(): boolean { return this.initialized && !this.dead }
  get readyPromise(): Promise<void> { return this.initPromise ?? Promise.resolve() }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      stopClient(this.serverId)
      const r = retiring.get(this.serverId)
      if (r?.client === this) retiring.delete(this.serverId)
    }, IDLE_KILL_MS)
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
    if (msg.id === undefined) {
      if (msg.method === '$/progress') {
        const { token, value } = msg.params ?? {}
        if (value?.kind === 'end') this.loading.delete(token)
        else if (token !== undefined) this.loading.add(token)
      }
      return
    }
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
        capabilities: {
          workspace: { workspaceFolders: true },
          // 只为拿到 tsserver 加载工程的 workDone 进度（见 awaitProjectLoad），不声明它就收不到
          window: { workDoneProgress: true },
        },
        initializationOptions: this.def.initOptions,
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
    this.loading.clear()
    this.failPending(new Error('server exited'))
  }

  // tsserver 收到 didOpen 才异步建 program，加载期间 definition 会拿半成品 program 回答 ——
  // 导入符号会被解析成那条 import 语句本身（同文件、指向 import 行），跳过去是错的。
  // 这段窗口 tls 用 workDone 进度包着，故：等它结束再问；等不到就抛（上层回落 warming，下次重试）
  private async awaitProjectLoad(newDoc: boolean): Promise<void> {
    if (!this.def.waitProjectLoad) return
    const deadline = Date.now() + PROJECT_LOAD_WAIT_MS
    if (newDoc) await sleep(PROGRESS_BEGIN_GRACE_MS)
    while (this.loading.size) {
      if (Date.now() > deadline) throw new Error('project still loading')
      await sleep(PROGRESS_POLL_MS)
    }
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
    await this.awaitProjectLoad(!doc)
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
    this.loading.clear()
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
// 被替换下来的实例先不杀：新实例首次跳转成功后收掉，期间切回可直接复用
const retiring = new Map<string, { client: LspClient; rootKey: string }>()
const enabledServers = new Set<string>()
let activeScopes = new Set<string>()

function stopClient(serverId: string): void {
  const c = clients.get(serverId)
  if (!c) return
  c.stop()
  clients.delete(serverId)
}

function dropRetiring(serverId: string): void {
  const r = retiring.get(serverId)
  if (!r) return
  r.client.stop()
  retiring.delete(serverId)
}

// active 降级为 retiring：每个 server 至多留一个
function retireActive(serverId: string): void {
  const cur = clients.get(serverId)
  if (!cur) return
  dropRetiring(serverId)
  retiring.set(serverId, { client: cur, rootKey: normPath(cur.root) })
  clients.delete(serverId)
}

// 新实例起不来时把退休的还回去，避免一次失败就丢掉可用实例
function reviveRetiring(serverId: string): void {
  const r = retiring.get(serverId)
  if (!r) return
  retiring.delete(serverId)
  if (!r.client.alive || clients.has(serverId)) { r.client.stop(); return }
  clients.set(serverId, r.client)
}

// 会话关闭后，root 不再属于任何活跃 cwd 的实例一并释放
function releaseOutOfScope(): void {
  for (const [sid, c] of [...clients]) {
    if (!activeScopes.has(normPath(c.root))) { c.stop(); clients.delete(sid) }
  }
  for (const [sid, r] of [...retiring]) {
    if (!activeScopes.has(r.rootKey)) { r.client.stop(); retiring.delete(sid) }
  }
}

async function handleDefinition(args: LspDefinitionArgs): Promise<LspDefinitionResult> {
  const serverId = LSP_LANG_TO_SERVER[args?.langId]
  if (!serverId || !enabledServers.has(serverId)) return { state: 'unavailable', locations: [] }
  if (!args.fullPath || !args.line || !args.column) return { state: 'unavailable', locations: [] }
  const def = SERVER_DEFS[serverId]
  if (!def || !resolveServer(serverId)) return { state: 'unavailable', locations: [] }

  const root = findRoot(args.fullPath, def.rootMarkers, args.root)
  const rootKey = normPath(root)

  let client = clients.get(serverId)
  if (client && !client.alive) { clients.delete(serverId); client = undefined }

  if (client && normPath(client.root) !== rootKey) {
    const ret = retiring.get(serverId)
    if (ret && ret.rootKey === rootKey && ret.client.alive) {
      // 切回刚离开的 root：两边交换身份，谁都不用重建
      retiring.set(serverId, { client, rootKey: normPath(client.root) })
      clients.set(serverId, ret.client)
      client = ret.client
    } else {
      retireActive(serverId)
      client = undefined
    }
  }

  if (!client) {
    const fresh = new LspClient(serverId, def, root)
    clients.set(serverId, fresh)
    const started = fresh.start().catch(() => {
      if (clients.get(serverId) === fresh) clients.delete(serverId)
      reviveRetiring(serverId)
    })
    // 挂起等就绪，别让用户白点一次；超时保留实例继续初始化，下次跳转可能就赶上了
    await Promise.race([started, sleep(QUEUE_WAIT_MS)])
    if (!fresh.ready) return { state: 'warming', locations: [] }
    client = fresh
  } else if (!client.ready) {
    await Promise.race([client.readyPromise, sleep(QUEUE_WAIT_MS)])
    if (!client.ready) return { state: 'warming', locations: [] }
  }

  try {
    const locations = await client.definition(args.fullPath, args.langId, args.text ?? '', args.line, args.column)
    // 新实例头一次真正答出来才算确认可用，这时才收掉退休的旧实例
    dropRetiring(serverId)
    return { state: 'ok', locations }
  } catch {
    return { state: 'warming', locations: [] }
  }
}

export function registerLspHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.LSP_SET_ENABLED, (_event, serverId: string, on: boolean) => {
    if (typeof serverId !== 'string' || !SERVER_DEFS[serverId]) return { error: 'unknown server' }
    if (on) enabledServers.add(serverId)
    else { enabledServers.delete(serverId); stopClient(serverId); dropRetiring(serverId) }
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

  // 渲染层同步「当前有哪些会话 cwd」，据此释放已关闭会话的实例（同 cwd 多会话共享，故不能靠引用计数）
  ipcMain.handle(IPC_CHANNELS.LSP_SET_SCOPES, (_event, cwds: unknown) => {
    const list = Array.isArray(cwds) ? cwds.filter((c): c is string => typeof c === 'string') : []
    activeScopes = new Set(list.map(normPath))
    releaseOutOfScope()
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.LSP_STOP, (_event, serverId?: string) => {
    if (serverId) { stopClient(serverId); dropRetiring(serverId) }
    else {
      for (const id of [...clients.keys()]) stopClient(id)
      for (const id of [...retiring.keys()]) dropRetiring(id)
    }
    return { ok: true }
  })
}

export function cleanupLsp(): void {
  for (const id of [...clients.keys()]) stopClient(id)
  for (const id of [...retiring.keys()]) dropRetiring(id)
  clients.clear()
  retiring.clear()
}
