// 探针：pi fork 各阶段耗时（冷启 / RPC 往返 / kill）
// 用法: node test/probe-pi-fork-timing.mjs <sessionId> <cwd> [rounds] [extraArgs...]
import { spawn, execSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const [sid, cwd, roundsArg, ...extraArgs] = process.argv.slice(2)
const rounds = Number(roundsArg || 2)

function runOnce(round) {
  return new Promise((resolve) => {
    const marks = {}
    let t = performance.now()
    const mark = (k) => { marks[k] = Math.round(performance.now() - t); t = performance.now() }
    const child = spawn('pi', ['--mode', 'rpc', '--session', sid, ...extraArgs], { cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })

    let buf = ''
    let nextId = 1
    const pending = new Map()
    const call = (cmd, timeoutMs = 60000) => {
      const id = `t${nextId++}`
      return new Promise((res, rej) => {
        const timer = setTimeout(() => { pending.delete(id); rej(new Error(cmd.type + ' timeout')) }, timeoutMs)
        pending.set(id, (r) => { clearTimeout(timer); res(r) })
        child.stdin.write(JSON.stringify({ ...cmd, id }) + '\n')
      })
    }
    child.stdout.on('data', (c) => {
      buf += c.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        let r
        try { r = JSON.parse(line) } catch { continue }
        if (r.type === 'response' && r.id && pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id) }
      }
    })

    ;(async () => {
      try {
        const st = await call({ type: 'get_state' })
        mark('spawn→get_state')
        const fk = await call({ type: 'get_fork_messages' })
        mark('get_fork_messages')
        const msgs = fk.data?.messages ?? []
        const target = msgs[Math.max(0, msgs.length - 1)]
        if (target) {
          await call({ type: 'fork', entryId: target.entryId })
          mark('fork(entryId)')
        }
        await call({ type: 'get_state' })
        mark('get_state(after)')
        const killedAt = performance.now()
        if (process.platform === 'win32') { try { execSync(`taskkill /pid ${child.pid} /f /t`, { timeout: 5000, stdio: 'pipe' }) } catch { /* ignore */ } }
        else child.kill()
        marks.kill = Math.round(performance.now() - killedAt)
        const total = Object.values(marks).reduce((a, b) => a + b, 0)
        console.log(`round ${round}:`, JSON.stringify(marks), '| total ≈', total + 'ms')
      } catch (e) {
        console.log(`round ${round}: ERROR`, e.message)
        try { child.kill() } catch { /* ignore */ }
      }
      resolve()
    })()
  })
}

for (let i = 1; i <= rounds; i++) await runOnce(i)
