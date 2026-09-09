import { app, ipcMain, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import https from 'https'
import http from 'http'
import {
  IPC_CHANNELS,
  PrProvider, PrProviderView, PrProviderInput, PrResult, CreatePrPayload, PrRemoteInfo
} from '../shared/types'
import { getGitWorkspace } from './git'

function storePath(): string {
  return join(app.getPath('userData'), 'pr-providers.json')
}

function encryptToken(token: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(token).toString('base64')
    }
  } catch {}
  return 'raw:' + Buffer.from(token, 'utf8').toString('base64')
}

function decryptToken(stored?: string): string {
  if (!stored) return ''
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    if (stored.startsWith('raw:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8')
  } catch {}
  return ''
}

function loadProviders(): PrProvider[] {
  try {
    if (existsSync(storePath())) {
      const arr = JSON.parse(readFileSync(storePath(), 'utf8'))
      if (Array.isArray(arr)) return arr
    }
  } catch {}
  return []
}

function saveProviders(list: PrProvider[]): void {
  try { writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf8') } catch {}
}

function toView(p: PrProvider): PrProviderView {
  return { id: p.id, type: p.type, host: p.host, baseUrl: p.baseUrl, trustSelfSigned: p.trustSelfSigned, tokenSet: !!p.token }
}

export function parseRemoteUrl(url: string): { host: string; path: string } | null {
  const u = (url || '').trim()
  if (!u) return null
  // scp 式 git@host:group/repo.git
  const m = u.match(/^[^@/\s]+@([^:/]+):(.+)$/)
  if (m) {
    const path = m[2].replace(/\.git$/, '').replace(/^\/+|\/+$/g, '')
    return path ? { host: m[1].toLowerCase(), path } : null
  }
  try {
    const parsed = new URL(u)
    const path = decodeURIComponent(parsed.pathname || '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '')
    if (!parsed.hostname || !path) return null
    return { host: parsed.hostname.toLowerCase(), path }
  } catch {
    return null
  }
}

function matchProvider(host: string): PrProvider | null {
  const h = (host || '').toLowerCase()
  return loadProviders().find(p => (p.host || '').toLowerCase() === h) || null
}

function providerOrigin(p: PrProvider): string {
  try {
    if (p.baseUrl) return new URL(p.baseUrl).origin
  } catch {}
  return `https://${p.host}`
}

function providerApiBase(p: PrProvider): string {
  const origin = providerOrigin(p).replace(/\/+$/, '')
  if (p.type === 'github') {
    if (p.host.toLowerCase() === 'github.com') return 'https://api.github.com'
    return `${origin}/api/v3`
  }
  return `${origin}/api/v4`
}

// CodeHub 按 GitLab 兼容方言打（PRIVATE-TOKEN）；若实测要 OAuth 签名再在此分支补
function authHeaders(p: PrProvider, token: string): Record<string, string> {
  if (p.type === 'github') {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }
  return { 'PRIVATE-TOKEN': token, Accept: 'application/json' }
}

function httpJson(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown> | null,
  trustSelfSigned: boolean
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      reject(new Error(`非法接口地址: ${url}`))
      return
    }
    const mod = target.protocol === 'http:' ? http : https
    const payload = body ? JSON.stringify(body) : null
    const req = mod.request(
      target,
      {
        method,
        headers: payload
          ? { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : headers,
        timeout: 15000,
        rejectUnauthorized: target.protocol === 'https:' ? !trustSelfSigned : undefined
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { data += chunk })
        res.on('end', () => resolve({ status: res.statusCode || 0, text: data }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('请求超时（15s）')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function detectBaseBranch(): Promise<string> {
  const { git } = getGitWorkspace()
  try {
    const head = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    if (head) return head.replace(/^origin\//, '')
  } catch {}
  for (const cand of ['main', 'master', 'develop']) {
    try {
      const ok = (await git.raw(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${cand}`])).trim()
      if (ok) return cand
    } catch {}
  }
  return 'main'
}

async function readRepoContext(): Promise<PrRemoteInfo> {
  const { git } = getGitWorkspace()
  let remoteUrl = ''
  try {
    const remotes = await git.getRemotes(true)
    const origin = remotes.find(r => r.name === 'origin') || remotes[0]
    remoteUrl = origin?.refs?.fetch || ''
  } catch {
    return { ok: false, error: '无法读取 git remote' }
  }
  const parsed = parseRemoteUrl(remoteUrl)
  if (!parsed) return { ok: false, error: 'remote 地址无法解析' }
  let branch = ''
  try {
    branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  } catch {}
  const base = await detectBaseBranch()
  const provider = matchProvider(parsed.host)
  return { ok: true, host: parsed.host, repoPath: parsed.path, branch, base, provider: provider ? toView(provider) : null }
}

export function registerPrHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GIT_PR_PROVIDERS, (): PrProviderView[] => loadProviders().map(toView))

  ipcMain.handle(IPC_CHANNELS.GIT_PR_PROVIDER_SAVE, (_event, input: PrProviderInput): PrProviderView[] => {
    const list = loadProviders()
    const host = (input.host || '').trim().toLowerCase()
    if (!host) return list.map(toView)
    const existing = input.id ? list.find(p => p.id === input.id) : list.find(p => (p.host || '').toLowerCase() === host)
    if (existing) {
      existing.type = input.type || existing.type
      existing.host = host
      existing.baseUrl = (input.baseUrl || '').trim() || existing.baseUrl
      existing.trustSelfSigned = !!input.trustSelfSigned
      if (input.token) existing.token = encryptToken(input.token)
      saveProviders(list)
      return list.map(toView)
    }
    const created: PrProvider = {
      id: randomUUID(),
      type: input.type || 'gitlab',
      host,
      baseUrl: (input.baseUrl || '').trim() || `https://${host}`,
      trustSelfSigned: !!input.trustSelfSigned,
      token: input.token ? encryptToken(input.token) : undefined
    }
    list.push(created)
    saveProviders(list)
    return list.map(toView)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PR_PROVIDER_DELETE, (_event, id: string): PrProviderView[] => {
    const list = loadProviders().filter(p => p.id !== id)
    saveProviders(list)
    return list.map(toView)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PR_REMOTE_INFO, async (): Promise<PrRemoteInfo> => {
    try {
      return await readRepoContext()
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PR_CREATE, async (_event, payload: CreatePrPayload): Promise<PrResult> => {
    try {
      const info = await readRepoContext()
      if (!info.ok || !info.host || !info.repoPath) return { error: info.error || '无法读取 remote' }
      const provider = matchProvider(info.host)
      if (!provider) return { error: `未配置 ${info.host} 的托管平台`, needProvider: true }
      const token = decryptToken(provider.token)
      if (!token) return { error: `平台「${provider.host}」缺少 API Token`, needProvider: true }
      const head = info.branch || ''
      if (!head || head === 'HEAD') return { error: '当前不在分支上（游离 HEAD？）' }
      const base = (payload?.base || '').trim() || info.base || 'main'
      if (head === base) return { error: `源分支与目标分支相同（${head}），请先切到功能分支` }
      const title = (payload?.title || '').trim() || `${head} → ${base}`
      const apiBase = providerApiBase(provider)
      const headers = authHeaders(provider, token)

      let url: string
      let body: Record<string, unknown>
      if (provider.type === 'github') {
        url = `${apiBase}/repos/${info.repoPath}/pulls`
        body = { title, head, base, body: payload?.body || '' }
      } else {
        url = `${apiBase}/projects/${encodeURIComponent(info.repoPath)}/merge_requests`
        body = { title, source_branch: head, target_branch: base, description: payload?.body || '' }
      }

      const res = await httpJson('POST', url, headers, body, provider.trustSelfSigned)
      let json: any = {}
      try { json = JSON.parse(res.text) } catch {}
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, url: json.html_url || json.web_url || '', number: json.number || json.iid }
      }
      const detail = json.message || json.error || json.error_description || json.errorMsg || res.text.slice(0, 200)
      return { error: `HTTP ${res.status} ${String(detail).slice(0, 300)}` }
    } catch (err: any) {
      const msg = err?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || /self.signed|unable to verify/i.test(err?.message || '')
        ? '证书校验失败：内网自签平台请勾选「信任自签证书」'
        : err?.message || String(err)
      return { error: msg }
    }
  })
}
