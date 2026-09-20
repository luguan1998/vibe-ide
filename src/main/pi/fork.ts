import type { ChildProcess } from 'child_process'
import { attachPiLineReader, findPiBinary, killPiProcess, spawnPi, writePiLine } from './process'
import { PiRpc } from './rpc'
import { asRecord, buildPiSpawnArgs, stringField } from './protocol'

// pi 的 fork 是协议原生的（rpc-types: fork / clone / get_fork_messages），
// 但它会让**当前进程** rebind 到分叉会话（runtimeHost.fork → teardown + createRuntime）。
// GUI 里源会话正被自己的进程持有，所以这里另起一个临时进程做分叉：拿完新会话 id 就杀掉，
// 源进程/源文件都不受影响（实测 fork 后源文件 size+mtime 不变）。
// 语义对照：
//   'before'  = 保留到该轮 user 消息之前（GUI 的 revert）
//   'through' = 保留整轮（user + 其回复，GUI 的 fork）；末轮没有"下一个 user"可切，改用 clone

export type PiForkMode = 'before' | 'through'

// empty：分叉点在第一条 user 之前（revert 到第一轮）。pi 对这种没有任何消息的分支
// 不落盘（get_state 给的 sessionFile 并不存在，实测 ENOENT），所以调用方必须改走
// "全新会话"而不是 resume 该 id。
export type PiForkResult =
  | { success: true; empty: false; sessionId: string; sessionFile: string }
  | { success: true; empty: true }
  | { success: false; error: string }

type PiCall = (command: Record<string, any>, timeoutMs?: number) => Promise<Record<string, any>>

function tempPi<T>(
  sourceSessionId: string,
  cwd: string,
  fn: (call: PiCall) => Promise<T>,
  timeoutMs = 120000,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const resolved = findPiBinary()
    if ('error' in resolved) return resolve({ ok: false, error: resolved.error })
    let proc: ChildProcess
    try {
      proc = spawnPi(resolved.binary, buildPiSpawnArgs({ resume: sourceSessionId }), cwd)
    } catch (e: any) {
      return resolve({ ok: false, error: e?.message ?? String(e) })
    }
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (result: { ok: true; value: T } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      killPiProcess(proc)
      resolve(result)
    }
    const rpc = new PiRpc('Pi', (payload) => writePiLine(proc, payload), () => {})
    attachPiLineReader(proc, (line) => rpc.pushLine(line), () => finish({ ok: false, error: 'Pi process exited before fork completed' }))
    timer = setTimeout(() => finish({ ok: false, error: 'Pi fork timed out' }), timeoutMs)
    fn((command, ms) => rpc.request(command, ms ?? 30000))
      .then((value) => finish({ ok: true, value }))
      .catch((e: any) => finish({ ok: false, error: e?.message ?? String(e) }))
  })
}

export function forkPiSession(input: {
  sourceSessionId: string
  cwd: string
  userTurnIndex: number
  mode: PiForkMode
  content?: string
  occurrence?: number
}): Promise<PiForkResult> {
  return tempPi(input.sourceSessionId, input.cwd, async (call) => {
    const before = asRecord((await call({ type: 'get_state' }, 45000)).data)
    const sourceFile = stringField(before ?? {}, 'sessionFile') ?? ''

    // 轮次定位：renderer 的下标可能小于 pi 的真实 user 轮数（注入轮只存在于文件里），
    // 与 claude 侧同一套兜底——content+occurrence 对得上就以后者为准
    const forkList = asRecord((await call({ type: 'get_fork_messages' })).data)
    const raw = Array.isArray(forkList?.messages) ? (forkList!.messages as unknown[]) : []
    const turns = raw
      .map((item) => {
        const rec = asRecord(item)
        return { entryId: stringField(rec ?? {}, 'entryId') ?? '', text: stringField(rec ?? {}, 'text') ?? '' }
      })
      .filter((turn) => turn.entryId)

    let idx = input.userTurnIndex
    const wanted = input.content?.trim()
    if (wanted) {
      let seen = 0
      for (let i = 0; i < turns.length; i++) {
        if (turns[i].text.trim() !== wanted) continue
        if (seen === (input.occurrence ?? 0)) { idx = i; break }
        seen++
      }
    }
    if (idx < 0 || idx >= turns.length) {
      throw new Error(`User turn ${input.userTurnIndex} not found (${turns.length} forkable turns)`)
    }

    if (input.mode === 'through') {
      const next = turns[idx + 1]
      if (next) await call({ type: 'fork', entryId: next.entryId }, 60000)
      else await call({ type: 'clone' }, 60000)
    } else {
      await call({ type: 'fork', entryId: turns[idx].entryId }, 60000)
    }

    const after = asRecord((await call({ type: 'get_state' }, 30000)).data)
    const sessionId = stringField(after ?? {}, 'sessionId') ?? ''
    const sessionFile = stringField(after ?? {}, 'sessionFile') ?? ''
    if (!sessionId || !sessionFile || sessionFile === sourceFile) {
      throw new Error('Fork produced no new session')
    }
    const messageCount = typeof after?.messageCount === 'number' ? after.messageCount : 0
    return messageCount === 0 ? { empty: true as const } : { empty: false as const, sessionId, sessionFile }
  }).then((outcome) => (outcome.ok
    ? { success: true as const, ...outcome.value }
    : { success: false as const, error: outcome.error }))
}
