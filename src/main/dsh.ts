import { ipcMain, BrowserWindow, app, session } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
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
  const dev = !app.isPackaged ? join(app.getAppPath(), '..', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js') : ''
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

export function registerDshHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DSH_START, (_e, cwd?: string) => startDshServer(cwd))
  ipcMain.handle(IPC_CHANNELS.DSH_STOP, () => stopDshServer())
  ipcMain.handle(IPC_CHANNELS.DSH_GET_PORT, () => getDshPort())
}
