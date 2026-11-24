import { app, ipcMain } from 'electron'
import { Client } from 'ssh2'
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2'
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  IPC_CHANNELS,
  type SshConnectOptions,
  type SshConnectResult,
  type SshHost,
} from '../../shared/types'
import { resolveSshConfig, type ResolvedSshConfig } from './ssh-config'
import { deleteHost, getHost, getSecret, listHosts, saveHost } from './hosts-store'
import { RelayClient } from './relay-client'
import { unregisterRemoteConnection } from './roots'

interface Connection {
  id: string
  host: SshHost
  client: Client
  jumpClients: Client[]
  relay: RelayClient
  nodeVersion: string
}

const connections = new Map<string, Connection>()

function loadPrivateKey(path: string, passphrase?: string): { key: Buffer; passphrase?: string } | null {
  try {
    return { key: readFileSync(path), passphrase }
  } catch {
    return null
  }
}

function agentPath(): string | undefined {
  return process.env.SSH_AUTH_SOCK || undefined
}

function fingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

const knownHostsPath = () => join(app.getPath('userData'), 'ssh-known-hosts.json')

function verifyHostKey(host: string, port: number, key: Buffer): boolean {
  const id = `${host}:${port}`
  let store: Record<string, string> = {}
  try {
    store = JSON.parse(readFileSync(knownHostsPath(), 'utf8'))
  } catch {}
  const actual = fingerprint(key)
  const known = store[id]
  if (!known) {
    store[id] = actual
    try {
      mkdirSync(dirname(knownHostsPath()), { recursive: true })
      writeFileSync(knownHostsPath(), JSON.stringify(store, null, 2), 'utf8')
    } catch {}
    return true
  }
  return known === actual
}

interface AuthOptions {
  password?: string
  passphrase?: string
  label: string
}

function connectClient(cfg: ResolvedSshConfig, auth: AuthOptions, sock?: ClientChannel): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    const config: ConnectConfig = {
      host: cfg.hostname,
      port: cfg.port,
      username: cfg.user || process.env.USERNAME || process.env.USER || '',
      readyTimeout: 20000,
      keepaliveInterval: 10000,
      hostVerifier: (key: Buffer) => verifyHostKey(cfg.hostname, cfg.port, key),
      ...(sock ? { sock } : {}),
    }
    if (auth.password) config.password = auth.password
    for (const file of cfg.identityFiles) {
      const key = loadPrivateKey(file, auth.passphrase)
      if (key) {
        config.privateKey = key.key
        if (key.passphrase) config.passphrase = key.passphrase
        break
      }
    }
    if (!auth.password && !config.privateKey) {
      const agent = agentPath()
      if (agent) config.agent = agent
    }

    client.once('ready', () => resolve(client))
    client.once('error', (err: Error) => reject(new Error(`${auth.label}: ${err.message}`)))
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => auth.password || ''))
    })
    client.connect(config)
  })
}

function forwardOut(client: Client, host: string, port: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
      if (err) reject(err)
      else resolve(stream)
    })
  })
}

async function openJumpChain(target: ResolvedSshConfig): Promise<{ sock: ClientChannel; clients: Client[] }> {
  const hops = (target.proxyJump || '').split(',').map(s => s.trim()).filter(Boolean)
  const hopConfigs = await Promise.all(hops.map(hop => resolveSshConfig(hop)))
  const clients: Client[] = []
  let sock: ClientChannel | undefined
  try {
    for (let i = 0; i < hopConfigs.length; i++) {
      const hop = hopConfigs[i]
      const client = await connectClient(hop, { label: `jump ${hop.hostname}` }, sock)
      clients.push(client)
      const next = i + 1 < hopConfigs.length ? hopConfigs[i + 1] : target
      sock = await forwardOut(client, next.hostname, next.port)
    }
  } catch (err) {
    for (const client of clients) {
      try { client.end() } catch {}
    }
    throw err
  }
  return { sock: sock!, clients }
}

function execCapture(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      stream.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      stream.on('close', (code: number) => {
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(stderr.trim() || `remote command failed (${code})`))
      })
    })
  })
}

function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
  })
}

function writeSftp(sftp: SFTPWrapper, path: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(path, data, err => (err ? reject(err) : resolve()))
  })
}

async function probeNode(client: Client): Promise<string> {
  let version: string
  try {
    version = await execCapture(client, 'node -v')
  } catch (err: any) {
    throw new Error(`Remote Node is required (>= 18): ${err.message}`)
  }
  const major = Number(version.replace(/^v/, '').split('.')[0])
  if (!major || major < 18) throw new Error(`Remote Node >= 18 required, found ${version}`)
  return version
}

function relayBundle(): { files: { name: string; data: Buffer }[]; hash: string } {
  const source = readFileSync(join(__dirname, 'relay.js'))
  const files = [{ name: 'relay.js', data: source }]
  // 打包器会把 relay 与主进程共用的依赖抽成 chunks/*.js，relay.js 里以相对路径 require
  const refs = [...source.toString('utf8').matchAll(/require\("\.\/(chunks\/[^"]+)"\)/g)].map(m => m[1])
  for (const name of refs) {
    files.push({ name, data: readFileSync(join(__dirname, name)) })
  }
  const hash = createHash('sha256').update(Buffer.concat(files.map(f => f.data))).digest('hex').slice(0, 12)
  return { files, hash }
}

async function deployRelay(client: Client): Promise<string> {
  const { files, hash } = relayBundle()
  const home = await execCapture(client, 'printf %s "$HOME"')
  const dir = `${home}/.vibe-ide/relay/${hash}`
  const sftp = await getSftp(client)
  try {
    for (const file of files) {
      const remotePath = `${dir}/${file.name}`
      const exists = await execCapture(client, `test -f "${remotePath}" && echo yes || echo no`)
      if (exists === 'yes') continue
      const parent = remotePath.slice(0, remotePath.lastIndexOf('/'))
      await execCapture(client, `mkdir -p "${parent}"`)
      await writeSftp(sftp, remotePath, file.data)
    }
  } finally {
    sftp.end()
  }
  return `${dir}/relay.js`
}

function startRelay(client: Client, remotePath: string): Promise<RelayClient> {
  return new Promise((resolve, reject) => {
    client.exec(`node "${remotePath}"`, (err, stream) => {
      if (err) return reject(err)
      const relay = new RelayClient(stream)
      stream.stderr.on('data', (chunk: Buffer) => {
        console.error('[ssh relay]', chunk.toString('utf8').trim())
      })
      resolve(relay)
    })
  })
}

async function establish(id: string, host: SshHost, password?: string, passphrase?: string): Promise<Connection> {
  const cfg = await resolveSshConfig(host.host)
  if (host.port) cfg.port = host.port
  if (host.username) cfg.user = host.username
  if (cfg.proxyCommand) throw new Error('ProxyCommand is not supported yet, use ProxyJump')

  let jumpClients: Client[] = []
  let sock: ClientChannel | undefined
  if (cfg.proxyJump) {
    const chain = await openJumpChain(cfg)
    sock = chain.sock
    jumpClients = chain.clients
  }

  let client: Client | null = null
  try {
    client = await connectClient(cfg, { password, passphrase, label: host.label })
    const nodeVersion = await probeNode(client)
    const remotePath = await deployRelay(client)
    const relay = await startRelay(client, remotePath)
    const ping = await relay.request('ping')

    const connection: Connection = { id, host, client, jumpClients, relay, nodeVersion }
    connections.set(id, connection)

    client.on('close', () => {
      if (!connections.has(id)) return
      connections.delete(id)
      unregisterRemoteConnection(id)
    })

    return { ...connection, nodeVersion: ping?.node || nodeVersion }
  } catch (err) {
    try { client?.end() } catch {}
    for (const jump of jumpClients) {
      try { jump.end() } catch {}
    }
    throw err
  }
}

function closeConnection(id: string): boolean {
  const connection = connections.get(id)
  if (!connection) return false
  connections.delete(id)
  unregisterRemoteConnection(id)
  try { connection.relay.close() } catch {}
  try { connection.client.end() } catch {}
  for (const jump of connection.jumpClients) {
    try { jump.end() } catch {}
  }
  return true
}

export function getSshRelay(id: string): RelayClient | undefined {
  return connections.get(id)?.relay
}

export function getSshHostLabel(id: string): string | undefined {
  const host = connections.get(id)?.host
  return host?.label || host?.host
}

export function createSshShell(id: string, cols: number, rows: number): Promise<ClientChannel> {
  const connection = connections.get(id)
  if (!connection) return Promise.reject(new Error('SSH connection not found'))
  return new Promise((resolve, reject) => {
    connection.client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
      if (err) reject(err)
      else resolve(stream)
    })
  })
}

export function cleanupSsh(): void {
  for (const id of [...connections.keys()]) closeConnection(id)
}

export function registerSshHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SSH_HOSTS_LIST, () => listHosts())

  ipcMain.handle(IPC_CHANNELS.SSH_HOST_SAVE, (_event, host) => saveHost(host))

  ipcMain.handle(IPC_CHANNELS.SSH_HOST_DELETE, (_event, id: string) => {
    deleteHost(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SSH_CONNECT, async (_event, options: SshConnectOptions): Promise<SshConnectResult> => {
    const host = getHost(options.hostId)
    if (!host) return { connectionId: '', state: 'error', message: 'Host not found' }

    const secret = getSecret(options.hostId)
    const id = `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      const connection = await establish(id, host, options.password ?? secret.password, options.passphrase ?? secret.passphrase)
      return { connectionId: id, state: 'connected', nodeVersion: connection.nodeVersion }
    } catch (err: any) {
      const message = err?.message ?? String(err)
      const state = /auth|authentication/i.test(message) ? 'auth-failed' : 'error'
      return { connectionId: id, state, message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SSH_DISCONNECT, (_event, id: string) => closeConnection(id))

  ipcMain.handle(IPC_CHANNELS.SSH_HOME, (_event, id: string) => {
    const relay = getSshRelay(id)
    if (!relay) throw new Error('SSH connection not found')
    return relay.request('fs.home')
  })

  ipcMain.handle(IPC_CHANNELS.SSH_LIST_DIR, (_event, id: string, path: string) => {
    const relay = getSshRelay(id)
    if (!relay) throw new Error('SSH connection not found')
    return relay.request('fs.list', { path })
  })
}
