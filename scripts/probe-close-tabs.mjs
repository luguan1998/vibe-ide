// Open tabs then close them, watch whether renderer memory is returned. CDP probe.
const port = Number(process.argv[2] || 9223)
const MB = n => (n / 1024 / 1024).toFixed(1)
const sleep = ms => new Promise(r => setTimeout(r, ms))

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
async function ws(cdp) {
  const snap = await ev(cdp, `window.api.perf.snapshot()`)
  const tab = (snap.appMetrics || []).filter(m => m.type === 'Tab').sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)[0]
  return tab ? tab.memory.workingSetSize * 1024 : 0
}
async function report(cdp, label) {
  const snap = await ev(cdp, `window.api.perf.snapshot()`)
  const tab = (snap.appMetrics || []).filter(m => m.type === 'Tab').sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)[0]
  const info = await ev(cdp, `({ heap: performance.memory?.usedJSHeapSize||0, editors: document.querySelectorAll('.monaco-editor').length, dom: document.querySelectorAll('*').length })`)
  console.log(`[${label}] rendererWS=${MB(tab ? tab.memory.workingSetSize * 1024 : 0)}MB heap=${MB(info.heap)}MB monacoEditors=${info.editors} dom=${info.dom}`)
}

async function main() {
  const cdp = await connect()
  // reload to a clean tab state
  await cdp.send('Page.enable')
  await cdp.send('Page.reload')
  await sleep(8000)

  const dirBtn = await ev(cdp, `(() => {
    for (const btn of document.querySelectorAll('button')) {
      const span = btn.querySelector('span')
      if (span && span.textContent === 'Dir') { const r = btn.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } }
    }
    return null })()`)
  await click(cdp, dirBtn.x, dirBtn.y)
  await sleep(2500)
  await report(cdp, 'after reload, Dir tab')

  const rows = await ev(cdp, `(() => {
    const out = []
    for (const row of document.querySelectorAll('div.cursor-pointer')) {
      const r = row.getBoundingClientRect()
      if (r.height === 0 || r.x < 900 || r.y < 0 || r.y > innerHeight - 20) continue
      const first = row.children[0]
      if (!(first && first.classList && first.classList.contains('w-3'))) continue
      out.push({ x: r.x + r.width/2, y: r.y + r.height/2, name: (row.textContent||'').trim().slice(0,30) })
    }
    return out })()`)
  const pick = ['package.json', 'tsconfig.json', 'README.md', 'package-lock.json', 'CLAUDE.md']
  for (const name of pick) {
    const row = rows.find(r => r.name === name)
    if (!row) { console.log('skip missing', name); continue }
    await click(cdp, row.x, row.y)
    await sleep(2200)
    await report(cdp, 'open ' + name)
  }

  // close all tabs via their X buttons in the tab bar (top strip of the file view)
  for (let i = 0; i < 12; i++) {
    const x = await ev(cdp, `(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const r = b.getBoundingClientRect()
        return r.height > 0 && r.height < 30 && r.y < 110 && r.y > 20 && b.querySelector('svg line, svg path')
      })
      const b = btns[btns.length - 1]
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width/2, y: r.y + r.height/2 }
    })()`)
    if (!x) break
    await click(cdp, x.x, x.y)
    await sleep(700)
  }
  await sleep(3000)
  await report(cdp, 'after closing tabs')

  const gc = await ev(cdp, `(async () => { if (window.gc) { window.gc(); } return true })()`)
  await sleep(1500)
  await report(cdp, 'after gc')
  cdp.close()
}
main().catch(e => { console.error(e); process.exit(1) })
