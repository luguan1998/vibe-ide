// Measure renderer cost of opening file tabs + mounting the left Dir panel, via CDP on a probe instance.
// Usage: node scripts/probe-open-tabs.mjs [port] [maxFiles]
const port = Number(process.argv[2] || 9223)
const maxFiles = Number(process.argv[3] || 8)
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
      setTimeout(() => rej(new Error('timeout ' + method)), 30000)
    }),
    close: () => ws.close(),
  }
}
async function ev(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}
async function click(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
async function measure(cdp, label) {
  const snap = await ev(cdp, `window.api.perf.snapshot()`)
  const tabs = (snap.appMetrics || []).filter(m => m.type === 'Tab').sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)
  const gpu = (snap.appMetrics || []).find(m => m.type === 'GPU')
  const info = await ev(cdp, `(() => {
    let models = { count: 0, chars: 0 }
    try { const ms = window.monaco?.editor?.getModels?.() || []; models = { count: ms.length, chars: ms.reduce((a, m) => a + m.getValueLength(), 0) } } catch {}
    return { heap: performance.memory?.usedJSHeapSize || 0, dom: document.querySelectorAll('*').length,
      editors: document.querySelectorAll('.monaco-editor').length, models,
      canv: [...document.querySelectorAll('canvas')].reduce((a, c) => a + c.width * c.height * 4, 0) }
  })()`)
  const out = {
    label,
    rendererWS: tabs[0]?.memory.workingSetSize * 1024 || 0,
    gpuWS: gpu ? gpu.memory.workingSetSize * 1024 : 0,
    heap: info.heap, dom: info.dom, editors: info.editors, models: info.models, canv: info.canv,
  }
  console.log(`[${label}] rendererWS=${MB(out.rendererWS)}MB gpu=${MB(out.gpuWS)}MB heap=${MB(out.heap)}MB dom=${out.dom} monacoEditors=${out.editors} models=${out.models.count}/${MB(out.models.chars)}MB canvas=${MB(out.canv)}MB`)
  return out
}

async function main() {
  const cdp = await connect()
  await sleep(6000)

  // right panel: switch to Dir tab
  const rect = await ev(cdp, `(() => {
    for (const btn of document.querySelectorAll('button')) {
      const span = btn.querySelector('span')
      if (span && span.textContent === 'Dir') { const r = btn.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } }
    }
    return null })()`)
  if (!rect) throw new Error('right Dir tab not found')
  await click(cdp, rect.x, rect.y)
  await sleep(2500)

  const base = await measure(cdp, 'baseline (Dir tab, no file open)')

  // list visible file rows in right panel (x > 900)
  const rows = await ev(cdp, `(() => {
    const out = []
    for (const row of document.querySelectorAll('div.cursor-pointer')) {
      const r = row.getBoundingClientRect()
      if (r.height === 0 || r.x < 900 || r.y < 0 || r.y > innerHeight - 20) continue
      const first = row.children[0]
      const isFile = first && (first.tagName === 'SPAN' || first.tagName === 'span') && first.classList.contains('w-3')
      if (!isFile) continue
      out.push({ x: r.x + r.width/2, y: r.y + r.height/2, name: (row.textContent || '').trim().slice(0, 40) })
    }
    return out })()`)
  console.log('visible file rows:', rows.map(r => r.name).join(' | '))

  let last = base
  const used = rows.slice(0, maxFiles)
  for (const r of used) {
    await click(cdp, r.x, r.y)
    await sleep(1800)
    last = await measure(cdp, `open ${r.name}`)
  }
  console.log(`\n== file tabs total: rendererWS ${MB(base.rendererWS)} -> ${MB(last.rendererWS)}MB (delta ${MB(last.rendererWS - base.rendererWS)}MB), models ${last.models.count} chars=${MB(last.models.chars)}MB ==`)

  // left panel: mount Dir view (second FileTab + GitTab)
  const leftBtn = await ev(cdp, `(() => {
    for (const btn of document.querySelectorAll('button.status-badge__segment--mode')) {
      if (btn.title === 'Dir') { const r = btn.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } }
    }
    return null })()`)
  if (leftBtn) {
    await click(cdp, leftBtn.x, leftBtn.y)
    await sleep(4000)
    const afterLeft = await measure(cdp, 'left Dir panel mounted')
    console.log(`\n== left panel delta: +${MB(afterLeft.rendererWS - last.rendererWS)}MB rendererWS ==`)
  } else {
    console.log('left Dir toggle button not found')
  }

  cdp.close()
}
main().catch(e => { console.error(e); process.exit(1) })
