// Probe a running Vibe IDE instance over CDP: per-process memory + renderer CPU attribution.
// Usage: node scripts/probe-busy-loop.mjs [port]
const port = Number(process.argv[2] || 9223)

async function findTarget() {
  const resp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await resp.json()
  return targets.find(t => t.type === 'page' && t.url.includes('renderer'))
    || targets.find(t => t.type === 'page' && !t.url.includes('devtools'))
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('ws timeout')), 5000) })
  let id = 0
  const pending = new Map()
  ws.onmessage = e => {
    const d = JSON.parse(e.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  }
  return {
    send(method, params = {}) {
      const mid = ++id
      return new Promise((res, rej) => {
        pending.set(mid, res)
        ws.send(JSON.stringify({ id: mid, method, params }))
        setTimeout(() => { pending.delete(mid); rej(new Error(`timeout ${method}`)) }, 30000)
      })
    },
    close: () => ws.close(),
  }
}

async function evalR(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}

const MB = n => (n / 1024 / 1024).toFixed(1)

async function main() {
  let target
  for (let i = 0; i < 60; i++) {
    try { target = await findTarget(); if (target) break } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!target) { console.error('no renderer target'); process.exit(1) }
  console.log('target:', target.url)
  const cdp = await connect(target.webSocketDebuggerUrl)

  // let first paint / session restore settle
  await new Promise(r => setTimeout(r, 8000))

  const snap = await evalR(cdp, `window.api.perf.snapshot()`)
  console.log('\n=== procs (from app.getAppMetrics) ===')
  for (const m of snap.appMetrics || []) {
    console.log(`  ${m.type.padEnd(8)} pid=${String(m.pid).padEnd(8)} ws=${MB(m.memory?.workingSetSize * 1024)}MB  cumCpu=${m.cpu?.cumulativeCPUUsage?.toFixed(1)}s`)
  }

  const info = await evalR(cdp, `(() => {
    const q = s => document.querySelectorAll(s).length
    let models = null
    try {
      const ms = window.monaco?.editor?.getModels?.() || []
      models = { count: ms.length, chars: ms.reduce((a, m) => a + m.getValueLength(), 0) }
    } catch (e) { models = 'err:' + e.message }
    return {
      jsHeap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null,
      domNodes: q('*'),
      monacoEditors: q('.monaco-editor'),
      monacoModels: models,
      xterms: q('.xterm'),
      canvases: q('canvas'),
      imgs: q('img'),
    }
  })()`)
  console.log('\n=== renderer objects ===')
  console.log(`  jsHeap used=${MB(info.jsHeap.used)}MB total=${MB(info.jsHeap.total)}MB`)
  console.log(`  domNodes=${info.domNodes} monacoEditors=${info.monacoEditors} xterms=${info.xterms} canvases=${info.canvases} imgs=${info.imgs}`)
  console.log(`  monacoModels=${JSON.stringify(info.monacoModels)}`)

  // CPU profile of the main thread
  const durMs = Number(process.argv[3] || 4000)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 })
  await cdp.send('Profiler.start')
  await new Promise(r => setTimeout(r, durMs))
  const resp = await cdp.send('Profiler.stop')
  const profile = resp.result.profile
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const self = new Map()
  for (const sid of profile.samples) {
    const n = byId.get(sid)
    if (!n) continue
    const f = n.callFrame
    const url = (f.url || '').replace(/^.*[\\/]/, '').slice(0, 60)
    const key = `${f.functionName || '(anon)'} @ ${url}:${f.lineNumber + 1}`
    self.set(key, (self.get(key) || 0) + 1)
  }
  const total = profile.samples.length
  console.log(`\n=== main-thread CPU profile (${durMs}ms, ${total} samples, top 30 self) ===`)
  ;[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, c]) => {
    console.log(`  ${(c / total * 100).toFixed(1).padStart(5)}%  ${k}`)
  })
  cdp.close()
}

main().catch(e => { console.error(e); process.exit(1) })
