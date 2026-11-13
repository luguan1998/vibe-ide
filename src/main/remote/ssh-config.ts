import { execFile } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

export interface ResolvedSshConfig {
  hostname: string
  port: number
  user?: string
  identityFiles: string[]
  proxyJump?: string
  proxyCommand?: string
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

function runSshG(target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ssh', ['-G', target], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

export async function resolveSshConfig(target: string): Promise<ResolvedSshConfig> {
  let stdout = ''
  try {
    stdout = await runSshG(target)
  } catch {
    return { hostname: target, port: 22, identityFiles: [] }
  }

  const values = new Map<string, string[]>()
  for (const line of stdout.split(/\r?\n/)) {
    const i = line.indexOf(' ')
    if (i <= 0) continue
    const key = line.slice(0, i).toLowerCase()
    const value = line.slice(i + 1).trim()
    if (!value) continue
    const list = values.get(key)
    if (list) list.push(value)
    else values.set(key, [value])
  }

  const first = (key: string) => values.get(key)?.[0]
  const proxyJump = first('proxyjump')?.trim()
  const proxyCommand = first('proxycommand')?.trim()

  return {
    hostname: first('hostname') || target,
    port: Number(first('port')) || 22,
    user: first('user'),
    identityFiles: (values.get('identityfile') || []).map(expandHome),
    proxyJump: proxyJump && proxyJump.toLowerCase() !== 'none' ? proxyJump : undefined,
    proxyCommand: proxyCommand && proxyCommand.toLowerCase() !== 'none' ? proxyCommand : undefined,
  }
}
