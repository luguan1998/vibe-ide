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
let commandsPromise: Promise<PiCommandInfo[] | null> | null = null

export function resolvePiModels(): Promise<PiModelInfo[] | null> {
  if (!modelsPromise) {
    // A failed probe must not be cached forever: a later open retries.
    modelsPromise = runProbe<PiModelInfo[]>(homedir(), { noExtensions: true, command: { type: 'get_available_models' }, parse: modelsFromRpcData }, 45000)
      .then((result) => { if (result === null) modelsPromise = null; return result })
  }
  return modelsPromise
}

export function resolvePiCommands(): Promise<PiCommandInfo[] | null> {
  if (!commandsPromise) {
    commandsPromise = runProbe<PiCommandInfo[]>(homedir(), { noExtensions: false, command: { type: 'get_commands' }, parse: commandsFromRpcData }, 45000)
      .then((result) => { if (result === null) commandsPromise = null; return result })
  }
  return commandsPromise
}

