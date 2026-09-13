// Inject terminal load into a running Vibe IDE (CDP) and measure renderer main-thread time + memory.
// Usage: node scripts/probe-terminal-load.mjs [port] [phase]
//   phase: spinner | flood | both
const port = Number(process.argv[2] || 9223)
const phase = process.argv[3] || 'both'

const MB = n => (n / 1024 / 1024).toFixed(1)

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const t = targets.find(x => x.type === 'page' && x.url.includes('renderer'))
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  return {
    send: (method, params = {}) => new Promise((res, rej) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method, params }))
      setTimeout(() => rej(new Error('timeout ' + method)), 60000)
    }),
    close: () => ws.close(),
  }
}

async function evalR(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}

async function metrics(cdp) {
  const r = await cdp.send('Performance.getMetrics')
  const m = Object.fromEntries(r.result.metrics.map(x => [x.name, x.value]))
  return {
    task: m.TaskDuration,
    script: m.ScriptDuration,
    layout: m.LayoutDuration,
    style: m.RecalcStyleDuration,
    nodes: m.Nodes,
    jsEventListeners: m.JSEventListeners,
  }
}

async function heap(cdp) {
  const h = await evalR(cdp, `({ heap: performance.memory ? performance.memory.usedJSHeapSize : 0, total: performance.memory ? performance.memory.totalJSHeapSize : 0, dom: document.querySelectorAll('*').length, canvastotal: [...document.querySelectorAll('canvas')].reduce((a,c)=>a+c.width*c.height*4,0) })`)
  const snap = await evalR(cdp, `window.api.perf.snapshot()`)
  const tab = (snap.appMetrics || []).filter(m => m.type === 'Tab').sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)[0]
  const gpu = (snap.appMetrics || []).find(m => m.type === 'GPU')
  return { ...h, rendererWS: tab ? tab.memory.workingSetSize * 1024 : 0, rendererCumCpu: tab?.cpu?.cumulativeCPUUsage, gpuWS: gpu ? gpu.memory.workingSetSize * 1024 : 0 }
}

const fmt = (t) => `task=${t.task.toFixed(2)}s script=${t.script.toFixed(2)}s layout=${t.layout.toFixed(2)}s style=${t.style.toFixed(2)}s dom=${t.nodes}`

async function main() {
  const cdp = await connect()
  await cdp.send('Performance.enable')

  const hasTerm = await evalR(cdp, `document.querySelectorAll('.xterm').length`)
  console.log('xterms:', hasTerm)

  // focus terminal: click center-left area of the center column
  const vp = await evalR(cdp, `({ w: innerWidth, h: innerHeight })`)
  const x = Math.round(vp.w * 0.45), y = Math.round(vp.h * 0.6)
  console.log(`clicking terminal at ${x},${y} (viewport ${vp.w}x${vp.h})`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await new Promise(r => setTimeout(r, 500))

  const before = { m: await metrics(cdp), h: await heap(cdp) }
  console.log('BEFORE:', fmt(before.m))
  console.log(`  heap=${MB(before.h.heap)}MB ws=${MB(before.h.rendererWS)}MB gpuWS=${MB(before.h.gpuWS)}MB dom=${before.h.dom} canvasPx=${MB(before.h.canvastotal)}MB`)

  async function typeLine(text) {
    await cdp.send('Input.insertText', { text })
    await new Promise(r => setTimeout(r, 200))
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '\r' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' })
  }

  if (phase === 'spinner' || phase === 'both') {
    console.log('\n--- PHASE spinner: 20s of 20Hz cursor-redraws (Claude-Code-like TUI) ---')
    const t0 = await metrics(cdp)
    await typeLine(`1..400 | ForEach-Object { Write-Host -NoNewline (\"\`r spinning \$_ .............................\") ; Start-Sleep -Milliseconds 50 }`)
    console.log('  running 20s...')
    await new Promise(r => setTimeout(r, 22000))
    const t1 = await metrics(cdp)
    const wall = 20
    console.log(`  BEFORE ${fmt(t0)}`)
    console.log(`  AFTER  ${fmt(t1)}`)
    console.log(`  task +${(t1.task - t0.task).toFixed(2)}s over ~${wall}s wall  => main-thread busy ${((t1.task - t0.task) / wall * 100).toFixed(0)}% of one core`)
    const h = await heap(cdp)
    console.log(`  heap=${MB(h.heap)}MB ws=${MB(h.rendererWS)}MB gpuWS=${MB(h.gpuWS)}MB`)
  }

  if (phase === 'flood' || phase === 'both') {
    console.log('\n--- PHASE flood: ~10MB of colored output ---')
    const t0 = await metrics(cdp)
    const h0 = await heap(cdp)
    await typeLine(`1..60000 | ForEach-Object { Write-Host (\"line \$_ \" + (\"x\" * 80)) }`)
    console.log('  waiting 25s for output to finish...')
    await new Promise(r => setTimeout(r, 25000))
    const t1 = await metrics(cdp)
    const h1 = await heap(cdp)
    console.log(`  task +${(t1.task - t0.task).toFixed(2)}s over ~25s`)
    console.log(`  heap ${MB(h0.heap)} -> ${MB(h1.heap)}MB (delta ${MB(h1.heap - h0.heap)}MB)`)
    console.log(`  ws   ${MB(h0.rendererWS)} -> ${MB(h1.rendererWS)}MB (delta ${MB(h1.rendererWS - h0.rendererWS)}MB)`)
    console.log(`  gpu  ${MB(h0.gpuWS)} -> ${MB(h1.gpuWS)}MB`)
    console.log(`  dom  ${h0.dom} -> ${h1.dom}`)
  }

  cdp.close()
}

main().catch(e => { console.error(e); process.exit(1) })
