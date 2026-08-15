import { ipcMain, BrowserWindow, app, session } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { IPC_CHANNELS } from '../shared/types'

interface DshServerState {
  proc: ChildProcess
  port: number | null
  cwd: string
}

let state: DshServerState | null = null
let mainWindow: BrowserWindow | null = null

export function setDshMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

const DSH_URL_RE = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/

function getDshBinPath(): string | { error: string } {
  const env = process.env.DSH_CLI_BIN
  if (env && existsSync(env)) return env
  const dev = !app.isPackaged ? join(app.getAppPath(), 'vendor', 'harness', 'apps', 'cli', 'lib', 'bin.js') : ''
  if (dev && existsSync(dev)) return dev
  const packaged = app.isPackaged ? join(process.resourcesPath, 'dsh', 'apps', 'cli', 'lib', 'bin.js') : ''
  if (packaged && existsSync(packaged)) return packaged
  return { error: `dsh runtime not found (env DSH_CLI_BIN, dev: ${dev}, packaged: ${packaged})` }
}

function installTrustHeaders(port: number): void {
  const origin = `http://127.0.0.1:${port}`
  const filter = { urls: [`${origin}/*`, `ws://127.0.0.1:${port}/*`] }
  try {
    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      details.requestHeaders['Origin'] = origin
      details.requestHeaders['Sec-Fetch-Site'] = 'same-origin'
      callback({ requestHeaders: details.requestHeaders })
    })
    session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
      const headers = details.responseHeaders ?? {}
      headers['Access-Control-Allow-Origin'] = ['*']
      callback({ responseHeaders: headers })
    })
  } catch (e: any) {
    console.warn('[dsh] webRequest hook failed:', e?.message)
  }
}

export function startDshServer(cwd?: string): Promise<{ ok: boolean; port?: number; error?: string }> {
  const target = cwd || process.cwd()
  if (state) {
    if (state.port !== null) return Promise.resolve({ ok: true, port: state.port })
    return waitForPort(state, 30000)
  }
  const binRes = getDshBinPath()
  if (typeof binRes === 'object') return Promise.resolve({ ok: false, error: binRes.error })
  const bin: string = binRes

  const env: NodeJS.ProcessEnv = { ...process.env }
  env.DSH_HOME = join(app.getPath('userData'), 'dsh')
  env.DSH_PERMISSION_MODE = process.env.DSH_PERMISSION_MODE || 'workspace-write'
  // harness 只认 DSH_TELEMETRY_DISABLED（任意非空即强制禁用 session-telemetry-otel）；
  // 旧写法 DSH_NO_TELEMETRY 全仓零读取，是无效变量
  env.DSH_TELEMETRY_DISABLED = '1'

  const proc = spawn('node', [bin, '--profile', 'web', '--port', '0'], {
    cwd: target,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const newState: DshServerState = { proc, port: null, cwd: target }
  state = newState

  const log = (line: string) => console.log(`[dsh] ${line}`)

  proc.stdout?.on('data', (buf: Buffer) => {
    for (const line of buf.toString('utf-8').split('\n')) {
      if (!line.trim()) continue
      log(line)
      const m = line.match(DSH_URL_RE)
      if (m && newState.port === null) {
        newState.port = Number(m[1])
        installTrustHeaders(newState.port)
        mainWindow?.webContents.send(IPC_CHANNELS.DSH_READY, { port: newState.port })
      }
    }
  })
  proc.stderr?.on('data', (buf: Buffer) => {
    for (const line of buf.toString('utf-8').split('\n')) {
      if (line.trim()) console.warn(`[dsh:err] ${line}`)
    }
  })
  proc.on('exit', (code) => {
    log(`exit code=${code}`)
    state = null
  })
  proc.on('error', (err) => {
    console.warn('[dsh] spawn error:', err)
    state = null
  })

  if (newState.port !== null) return Promise.resolve({ ok: true, port: newState.port })
  return waitForPort(newState, 30000)
}

function waitForPort(s: DshServerState, timeoutMs: number): Promise<{ ok: boolean; port?: number; error?: string }> {
  return new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (s.port !== null) {
        clearInterval(timer)
        resolve({ ok: true, port: s.port })
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        resolve({ ok: false, error: 'dsh server start timeout' })
      }
    }, 200)
  })
}

export function stopDshServer(): { ok: boolean } {
  if (!state) return { ok: true }
  const proc = state.proc
  state = null
  try { proc.kill() } catch {}
  return { ok: true }
}

export function getDshPort(): number | null {
  return state?.port ?? null
}

export function cleanupDsh(): void {
  stopDshServer()
}

// 与 dsh-session-persistence-jsonl 的 encodeSegment/projectKey 保持一致
function encodeSegment(raw: string): string {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

function projectKey(cwd: string): string {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

function deleteDshSession(sessionId: string, cwd?: string): { ok: boolean; error?: string } {
  // dsh server 可能用 vibe 的 userData/dsh（新构建）或 ~/.dsh（默认），两个根都尝试
  const roots = [join(app.getPath('userData'), 'dsh'), join(homedir(), '.dsh')]
  let deleted = false
  for (const root of roots) {
    const dir = join(root, 'sessions', cwd ? projectKey(cwd) : '_no-cwd', encodeSegment(sessionId))
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true })
        deleted = true
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) }
      }
    }
  }
  return { ok: deleted }
}

export function registerDshHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DSH_START, (_e, cwd?: string) => startDshServer(cwd))
  ipcMain.handle(IPC_CHANNELS.DSH_STOP, () => stopDshServer())
  ipcMain.handle(IPC_CHANNELS.DSH_GET_PORT, () => getDshPort())
  ipcMain.handle(IPC_CHANNELS.DSH_DELETE_SESSION, (_e, sessionId: string, cwd?: string) => deleteDshSession(sessionId, cwd))
}
