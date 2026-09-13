// Print per-process memory snapshot of a running Vibe IDE instance via CDP perf API.
// Usage: node scripts/probe-snapshot.mjs [port] [label]
const port = Number(process.argv[2] || 9223)
const label = process.argv[3] || 'snapshot'
const MB = n => (n / 1024 / 1024).toFixed(1)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function connect() {
  let t
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      t = targets.find(x => x.type === 'page' && x.url.includes('renderer'))
      if (t) break
    } catch {}
    await sleep(1000)
  }
  if (!t) throw new Error('no renderer target')
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
      setTimeout(() => rej(new Error('timeout ' + m)), 30000)
    }),
    close: () => ws.close(),
  }
}

const cdp = await connect()
await sleep(Number(process.argv[4] || 10000))
const r = await cdp.send('Runtime.evaluate', { expression: `window.api.perf.snapshot()`, awaitPromise: true, returnByValue: true })
const snap = r.result?.result?.value
console.log(`=== ${label} ===`)
let total = 0
for (const m of (snap.appMetrics || []).sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)) {
  total += m.memory.workingSetSize
  console.log(`  ${String(m.type).padEnd(8)} pid=${String(m.pid).padEnd(8)} ws=${MB(m.memory.workingSetSize * 1024).padStart(7)}MB  cpuCum=${(m.cpu?.cumulativeCPUUsage || 0).toFixed(1)}s`)
}
console.log(`  TOTAL ws=${MB(total * 1024)}MB`)
const heap = await cdp.send('Runtime.evaluate', { expression: `performance.memory ? performance.memory.usedJSHeapSize : 0`, returnByValue: true })
console.log(`  renderer JS heap=${MB(heap.result?.result?.value || 0)}MB`)
cdp.close()
