import { app, ipcMain, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import https from 'https'
import http from 'http'
import {
  IPC_CHANNELS,
  PrProvider, PrProviderView, PrProviderInput, PrResult, CreatePrPayload, PrRemoteInfo,
  PrTestInput, PrTestResult, PrListResult, PrListItem, PrConflictResult
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
    // GitHub 对缺 User-Agent 的请求直接 403（administrative rules），Node 默认不发
    const baseHeaders: Record<string, string> = { 'User-Agent': 'vibe-ide', ...headers }
    const req = mod.request(
      target,
      {
        method,
        headers: payload
          ? { ...baseHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : baseHeaders,
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

function friendlyErr(err: any): string {
  const code = err?.code || ''
  const msg = err?.message || ''
  if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || /self.signed|unable to verify/i.test(msg)) {
    return '证书校验失败：内网自签平台请勾选「信任自签证书」'
  }
  return msg || String(err)
}

// 用户选的目标分支名先解析成可用 rev（origin/main 优先，本地同名兜底）
async function resolveRev(ref: string): Promise<string> {
  const { git } = getGitWorkspace()
  for (const cand of [`refs/remotes/origin/${ref}`, `refs/heads/${ref}`, ref]) {
    try {
      const ok = (await git.raw(['rev-parse', '--verify', '--quiet', cand])).trim()
      if (ok) return cand
    } catch {}
  }
  return ref
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
      const trimmed = (input.token || '').trim()
      if (trimmed) existing.token = encryptToken(trimmed)
      saveProviders(list)
      return list.map(toView)
    }
    const created: PrProvider = {
      id: randomUUID(),
      type: input.type || 'gitlab',
      host,
      baseUrl: (input.baseUrl || '').trim() || `https://${host}`,
      trustSelfSigned: !!input.trustSelfSigned,
      token: (input.token || '').trim() ? encryptToken((input.token || '').trim()) : undefined
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
      return { error: friendlyErr(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PR_TEST, async (_event, input: PrTestInput): Promise<PrTestResult> => {
    try {
      const list = loadProviders()
      const provider = input.id
        ? list.find(x => x.id === input.id)
        : matchProvider((input.host || '').toLowerCase())
      if (!provider) return { error: '未找到对应的平台配置' }
      const token = decryptToken(provider.token)
      if (!token) return { error: '缺少 API Token' }
      const api = providerApiBase(provider)
      const headers = authHeaders(provider, token)
      let login = ''
      let authChecked = false
      const userRes = await httpJson('GET', `${api}/user`, headers, null, provider.trustSelfSigned)
      if (userRes.status >= 200 && userRes.status < 300) {
        authChecked = true
        try {
          const j = JSON.parse(userRes.text)
          login = j.login || j.username || ''
        } catch {}
      } else if (!input.repoPath && !(provider.type === 'github' && (userRes.status === 401 || userRes.status === 403))) {
        // /user 403：GitHub fine-grained PAT / GitLab 项目级 Token 都属正常，带仓库探针时交给探针判定
        return { error: `Token 无效或被拒绝 (HTTP ${userRes.status})` }
      }
      if (input.repoPath) {
        const repoUrl = provider.type === 'github'
          ? `${api}/repos/${input.repoPath}`
          : `${api}/projects/${encodeURIComponent(input.repoPath)}`
        const rr = await httpJson('GET', repoUrl, headers, null, provider.trustSelfSigned)
        if (rr.status >= 200 && rr.status < 300) {
          try {
            const j = JSON.parse(rr.text)
            if (!login) login = j.owner?.login || j.namespace?.full_path || ''
          } catch {}
          return { ok: true, login }
        }
        if (rr.status === 401 || rr.status === 403) return { error: `Token 无效或无仓库权限 (HTTP ${rr.status})` }
        if (rr.status === 404) return { error: `找不到仓库 ${input.repoPath}（核对主机名/路径，或 token 无该仓库权限）` }
        return { error: `仓库检查失败 (HTTP ${rr.status})` }
      }
      if (authChecked) return { ok: true, login }
      return { error: '该 Token 无法访问 /user（GitHub fine-grained / GitLab 项目级 Token 属正常），请在功能分支仓库的创建 PR 弹窗中测试' }
    } catch (err: any) {
      return { error: friendlyErr(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PR_LIST, async (): Promise<PrListResult> => {
    try {
      const info = await readRepoContext()
      if (!info.ok || !info.host || !info.repoPath) return { error: info.error || '无法读取 remote' }
      const provider = matchProvider(info.host)
      if (!provider) return { error: `未配置 ${info.host} 的托管平台` }
      const token = decryptToken(provider.token)
      if (!token) return { error: `平台「${provider.host}」缺少 API Token` }
      const head = info.branch || ''
      if (!head || head === 'HEAD') return { error: '无法确定当前分支' }
      const api = providerApiBase(provider)
      const headers = authHeaders(provider, token)
      const url = provider.type === 'github'
        ? `${api}/repos/${info.repoPath}/pulls?state=open&per_page=20&head=${encodeURIComponent(`${info.repoPath.split('/')[0]}:${head}`)}`
        : `${api}/projects/${encodeURIComponent(info.repoPath)}/merge_requests?state=opened&per_page=20&source_branch=${encodeURIComponent(head)}`
      const res = await httpJson('GET', url, headers, null, provider.trustSelfSigned)
      if (res.status < 200 || res.status >= 300) return { error: `HTTP ${res.status}` }
      let arr: any[] = []
      try {
        const j = JSON.parse(res.text)
        arr = Array.isArray(j) ? j : []
      } catch {}
      const items: PrListItem[] = arr.map(x => ({
        number: x.number || x.iid || 0,
        title: x.title || '',
        url: x.html_url || x.web_url || '',
        base: x.base?.ref || x.target_branch || ''
      }))
      return { ok: true, items }
    } catch (err: any) {
      return { error: friendlyErr(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PR_TEMPLATE, async (_event, base?: string): Promise<{ content: string }> => {
    try {
      const { git, workspace } = getGitWorkspace()
      let root = workspace
      try {
        const toplevel = (await git.raw(['rev-parse', '--show-toplevel'])).trim()
        if (toplevel) root = toplevel
      } catch {}
      const b = (base || '').trim()
      const cands: string[] = []
      if (b) {
        cands.push(join('.github', 'PULL_REQUEST_TEMPLATE', `${b}.md`))
        cands.push(join('docs', 'PULL_REQUEST_TEMPLATE', `${b}.md`))
      }
      cands.push(join('.github', 'PULL_REQUEST_TEMPLATE.md'))
      cands.push('PULL_REQUEST_TEMPLATE.md')
      for (const c of cands) {
        const fp = join(root, c)
        try {
          if (existsSync(fp)) return { content: readFileSync(fp, 'utf8') }
        } catch {}
      }
      return { content: '' }
    } catch {
      return { content: '' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PR_CHECK_CONFLICT, async (_event, base: string): Promise<PrConflictResult> => {
    const { git, workspace } = getGitWorkspace()
    const b = (base || '').trim()
    if (!b) return { ok: false, error: '缺少目标分支' }
    let head = ''
    try {
      head = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    } catch {}
    if (!head || head === 'HEAD') return { ok: false, error: '无法确定当前分支' }
    const baseRev = await resolveRev(b)
    try {
      const out = execFileSync('git', ['merge-tree', '--write-tree', '--name-only', baseRev, head], {
        cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000
      })
      const lines = out.trim().split('\n').filter(Boolean)
      return { ok: true, conflict: lines.length > 1 }
    } catch (err: any) {
      if (err?.status === 1) {
        const out = String(err?.stdout || '')
        const lines = out.trim().split('\n').filter(Boolean)
        return { ok: true, conflict: lines.length > 1 || /CONFLICT/i.test(out) }
      }
      if (/unknown option|usage/i.test(String(err?.stderr || '') + String(err?.message || ''))) {
        return { ok: false, error: '当前 git 不支持 merge-tree 预检（需 ≥2.38）' }
      }
      return { ok: false, error: friendlyErr(err) }
    }
  })
}
