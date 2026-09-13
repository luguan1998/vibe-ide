// Reproduce "boot with a restored GUI session, then idle" and sample renderer memory growth.
// Usage: node scripts/probe-gui-idle.mjs [port] [minutes]
import { execSync } from 'child_process'
const port = Number(process.argv[2] || 9230)
const minutes = Number(process.argv[3] || 4)
const MB = n => (n / 1024 / 1024).toFixed(1)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function connect() {
  let t
  for (let i = 0; i < 90; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      t = targets.find(x => x.type === 'page' && x.url.includes('renderer'))
      if (t) break
    } catch {}
    await sleep(1000)
  }
  if (!t) throw new Error('no target')
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  return {
    send: (m, p = {}) => new Promise((res, rej) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method: m, params: p }))
      setTimeout(() => rej(new Error('timeout ' + m)), 60000)
    }),
    close: () => ws.close(),
  }
}
async function ev(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}
async function snap(cdp) {
  const s = await ev(cdp, `window.api.perf.snapshot()`)
  const tabs = (s.appMetrics || []).filter(m => m.type === 'Tab').sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)
  const gpu = (s.appMetrics || []).find(m => m.type === 'GPU')
  const pid = tabs[0]?.pid
  let priv = 0
  try {
    priv = Number(execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).PrivateMemorySize64"`).toString().trim())
  } catch {}
  const heap = await ev(cdp, `performance.memory ? performance.memory.usedJSHeapSize : 0`)
  return { pid, ws: tabs[0]?.memory.workingSetSize * 1024 || 0, priv, gpu: gpu ? gpu.memory.workingSetSize * 1024 : 0, heap }
}

const cdp = await connect()
await sleep(6000)

const resumeId = process.argv[4] || '606396cf-b63d-45ea-b9a5-1209cefc2d9c'
const cwd = process.argv[5] || 'E:/ai/testgit'
const sessions = {
  activeTabId: 'probe-gui-1',
  sessions: [{
    id: cwd, cwd, name: 'testgit', activeTabId: 'probe-gui-1',
    tabs: [{ id: 'probe-gui-1', kind: 'gui', name: 'probe', cwd, active: true, createdAt: Date.now(), resumeSessionId: resumeId, resumeCwd: cwd, loaded: false }],
  }],
}
console.log('injecting restored GUI session (resumeId=' + resumeId + ') and reloading...')
await ev(cdp, `localStorage.setItem('vibe-ide-open-sessions', ${JSON.stringify(JSON.stringify(sessions))}); true`)
await cdp.send('Page.enable')
await cdp.send('Page.reload')
await sleep(12000)

console.log('\n=== sampling (idle, no interaction) ===')
const t0 = Date.now()
let first = null, last = null
for (let i = 0; i * 30 <= minutes * 60; i++) {
  const m = await snap(cdp)
  if (!first) first = m
  last = m
  const sec = Math.round((Date.now() - t0) / 1000)
  console.log(`  [${String(sec).padStart(3)}s] renderer ws=${MB(m.ws)}MB private=${MB(m.priv)}MB | gpu=${MB(m.gpu)}MB | jsHeap=${MB(m.heap)}MB`)
  if (i * 30 < minutes * 60) await sleep(30000)
}
const dt = (Date.now() - t0) / 1000
console.log(`\n=> renderer private ${MB(first.priv)} -> ${MB(last.priv)}MB  (delta ${MB(last.priv - first.priv)}MB over ${Math.round(dt)}s = ${((last.priv - first.priv) / 1048576 / dt).toFixed(2)} MB/s)`)
cdp.close()
