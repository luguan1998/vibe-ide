import { spawn, execSync, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { sanitizeEnvForCli } from '../ai-shared'

export const PI_INSTALL_CMD = 'npm install -g @earendil-works/pi-coding-agent'

const PI_VERSION_RE = /\d+\.\d+\.\d+/

// Pi installs land in a few conventional places; `where`/`which` misses them
// when the npm global bin dir is absent from the app's PATH (GUI launch).
function candidateBinaries(): string[] {
  const home = homedir()
  const names = process.platform === 'win32' ? ['pi.cmd', 'pi.exe', 'pi'] : ['pi']
  const dirs = process.platform === 'win32'
    ? [join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm'), join(home, '.local', 'bin')]
    : [join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.cargo', 'bin'), join(home, 'n', 'bin'), '/usr/local/bin', '/opt/homebrew/bin']
  return dirs.flatMap((dir) => names.map((name) => join(dir, name)))
}

function binaryWorks(binary: string): boolean {
  const quote = process.platform === 'win32' && binary.includes(' ') ? `"${binary}"` : binary
  try {
    const out = execSync(`${quote} --version`, { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' })
    return PI_VERSION_RE.test(out)
  } catch {
    return false
  }
}

export type PiBinaryResult = { binary: string } | { error: string; installCmd: string }

// 每次探测要跑一遍 `pi --version`（完整 Node CLI 启动 ≈1s），会话创建/切换都要用，
// 不能每次重付：成功后进程内记忆。
let binaryCache: { binary: string } | null = null

export function findPiBinary(): PiBinaryResult {
  if (binaryCache) return binaryCache
  const resolved = resolvePiBinary()
  if (!('error' in resolved)) binaryCache = resolved
  return resolved
}

// 会话创建走这条：常见安装目录能 existsSync 秒判就不等 `--version` 校验（整条 Node CLI
// 冷启 ≈1s），校验用异步 child 在后台补进 cache；目录里都没有才退回阻塞探测。
export function piBinaryForSpawn(): PiBinaryResult {
  if (binaryCache) return binaryCache
  for (const path of candidateBinaries()) {
    if (existsSync(path)) {
      warmBinaryCache(path)
      return { binary: path }
    }
  }
  return findPiBinary()
}

let warming = false

function warmBinaryCache(binary: string): void {
  if (warming) return
  warming = true
  void probeBinaryAsync(binary).then((ok) => {
    warming = false
    if (ok) binaryCache = { binary }
  })
}

function probeBinaryAsync(binary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(binary, ['--version'], { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => { try { proc.kill() } catch { /* dead */ } ; resolve(false) }, 15000)
    proc.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString('utf-8') })
    proc.on('error', () => { clearTimeout(timer); resolve(false) })
    proc.on('exit', () => { clearTimeout(timer); resolve(PI_VERSION_RE.test(out)) })
  })
}

function resolvePiBinary(): PiBinaryResult {
  const probe = process.platform === 'win32' ? 'where pi' : 'which pi'
  const found: string[] = []
  try {
    const out = execSync(probe, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
    for (const line of out.split(/\r?\n/)) {
      const path = line.trim()
      if (path && existsSync(path)) found.push(path)
    }
  } catch { /* not on PATH */ }
  for (const path of candidateBinaries()) {
    if (existsSync(path) && !found.includes(path)) found.push(path)
  }
  for (const binary of found) {
    if (binaryWorks(binary)) return { binary }
  }
  // PATH lookup may still hit a wrapper the existence check cannot see (shims).
  if (binaryWorks('pi')) return { binary: 'pi' }
  return { error: `Pi CLI not found. Install with: ${PI_INSTALL_CMD}`, installCmd: PI_INSTALL_CMD }
}

export function spawnPi(binary: string, args: string[], cwd: string): ChildProcess {
  return spawn(binary, args, {
    cwd,
    env: sanitizeEnvForCli(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

export function writePiLine(proc: ChildProcess, payload: Record<string, any>): void {
  if (!proc.stdin || proc.stdin.destroyed) throw new Error('Pi process stdin is closed')
  proc.stdin.write(JSON.stringify(payload) + '\n')
}

export function killPiProcess(proc: ChildProcess | null | undefined): void {
  if (!proc || proc.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${proc.pid} /f /t`, { timeout: 5000, stdio: 'pipe' })
    } catch { /* already dead */ }
  } else {
    try { proc.kill('SIGTERM') } catch { /* already dead */ }
  }
}

// Pi frames are strict JSONL (LF only, optional trailing CR): a generic line
// reader would split on U+2028/2029 which are valid inside JSON strings.
export function attachPiLineReader(
  proc: ChildProcess,
  onLine: (line: string) => void,
  onExit: (code: number | null) => void,
): void {
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += decoder.write(chunk)
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      let line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.trim()) onLine(line)
      index = buffer.indexOf('\n')
    }
  })
  proc.stdout?.on('end', () => {
    buffer += decoder.end()
    if (buffer.trim()) onLine(buffer)
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim()
    if (text) console.warn('[pi stderr]', text.slice(0, 500))
  })
  // Windows: spawn goes through cmd.exe; an unconsumed pipe makes async writes
  // fail with EAGAIN and emit 'error' on stdin — without a listener that is an
  // uncaught main-process exception.
  proc.stdin?.on('error', (err) => {
    console.warn('[pi stdin]', err?.message)
  })
  proc.on('error', (err) => {
    console.warn('[pi spawn]', err?.message)
  })
  proc.on('exit', (code) => onExit(code))
}
