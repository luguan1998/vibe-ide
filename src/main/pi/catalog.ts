import { homedir } from 'os'
import { attachPiLineReader, findPiBinary, killPiProcess, spawnPi, writePiLine } from './process'
import { PiRpc } from './rpc'
import { buildPiSpawnArgs, commandsFromRpcData, modelsFromRpcData, type PiModelInfo } from './protocol'

export type PiCommandInfo = { name: string; description: string }

type ProbeOptions = { noExtensions: boolean; command: Record<string, any>; parse: (data: unknown) => unknown }

// Throwaway child per catalog: models never load extensions (fast, no startup
// side effects), commands must load them so extension-registered commands appear.
function runProbe<T>(cwd: string, options: ProbeOptions, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const resolved = findPiBinary()
    if ('error' in resolved) return resolve(null)
    let proc
    try {
      proc = spawnPi(resolved.binary, buildPiSpawnArgs({ noSession: true, noExtensions: options.noExtensions }), cwd)
    } catch {
      return resolve(null)
    }
    let settled = false
    const finish = (value: T | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killPiProcess(proc)
      resolve(value)
    }
    const rpc = new PiRpc('Pi', (payload) => writePiLine(proc!, payload), () => {})
    attachPiLineReader(proc, (line) => rpc.pushLine(line), () => finish(null))
    const timer = setTimeout(() => finish(null), timeoutMs)
    rpc.request(options.command, timeoutMs)
      .then((res) => finish(options.parse(res.data) as T))
      .catch(() => finish(null))
  })
}

let modelsPromise: Promise<PiModelInfo[] | null> | null = null
// 命令表按 cwd 缓存：项目级 .pi/prompts、.pi/skills 按 cwd 发现，不能全局共用一份
const commandsCache = new Map<string, Promise<PiCommandInfo[] | null>>()

export function resolvePiModels(): Promise<PiModelInfo[] | null> {
  if (!modelsPromise) {
    // A failed probe must not be cached forever: a later open retries.
    modelsPromise = runProbe<PiModelInfo[]>(homedir(), { noExtensions: true, command: { type: 'get_available_models' }, parse: modelsFromRpcData }, 45000)
      .then((result) => { if (result === null) modelsPromise = null; return result })
  }
  return modelsPromise
}

// cwd 决定 pi 扫描哪些项目级资源（.pi/prompts、.pi/skills），缺省退回 home（纯用户级）
export function resolvePiCommands(cwd?: string): Promise<PiCommandInfo[] | null> {
  const dir = cwd?.trim() || homedir()
  let promise = commandsCache.get(dir)
  if (!promise) {
    promise = runProbe<PiCommandInfo[]>(dir, { noExtensions: false, command: { type: 'get_commands' }, parse: commandsFromRpcData }, 45000)
      .then((result) => {
        // A failed probe must not be cached forever: a later open retries.
        if (result === null) commandsCache.delete(dir)
        return result
      })
    commandsCache.set(dir, promise)
  }
  return promise
}

