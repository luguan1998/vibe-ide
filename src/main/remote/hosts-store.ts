import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { SshHost, SshHostInput } from '../../shared/types'

interface StoredHost extends SshHost {
  secret?: string
}

interface Secret {
  password?: string
  passphrase?: string
}

const storePath = () => join(app.getPath('userData'), 'ssh-hosts.json')

function readAll(): StoredHost[] {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(list: StoredHost[]): void {
  mkdirSync(dirname(storePath()), { recursive: true })
  writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf8')
}

export function listHosts(): SshHost[] {
  return readAll().map(({ secret: _secret, ...host }) => host)
}

export function getHost(id: string): SshHost | undefined {
  const stored = readAll().find(h => h.id === id)
  if (!stored) return undefined
  const { secret: _secret, ...host } = stored
  return host
}

export function saveHost(input: SshHostInput): SshHost {
  const { password, passphrase, ...rest } = input
  const host: SshHost = {
    ...rest,
    id: input.id || `host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
  const list = readAll()
  const index = list.findIndex(h => h.id === host.id)

  let secret: string | undefined = index >= 0 ? list[index].secret : undefined
  if (password || passphrase) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS credential encryption is unavailable')
    }
    const payload: Secret = { password, passphrase }
    secret = safeStorage.encryptString(JSON.stringify(payload)).toString('base64')
  }

  const stored: StoredHost = { ...host, ...(secret ? { secret } : {}) }
  if (index >= 0) list[index] = stored
  else list.push(stored)
  writeAll(list)
  return host
}

export function deleteHost(id: string): void {
  writeAll(readAll().filter(h => h.id !== id))
}

export function getSecret(id: string): Secret {
  const stored = readAll().find(h => h.id === id)
  if (!stored?.secret || !safeStorage.isEncryptionAvailable()) return {}
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(stored.secret, 'base64'))) as Secret
  } catch {
    return {}
  }
}
