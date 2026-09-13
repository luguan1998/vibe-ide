// Verify the boot-restore fix: GUI session must NOT auto-load at boot; clicking it must load.
// Usage: node scripts/probe-fix-verify.mjs [port]
const port = Number(process.argv[2] || 9235)
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
async function snap(cdp, label) {
  const s = await ev(cdp, `window.api.perf.snapshot()`)
  const tab = (s.appMetrics || []).filter(m => m.type === 'Tab').sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)[0]
  const info = await ev(cdp, `JSON.stringify({heap: performance.memory ? performance.memory.usedJSHeapSize : 0, aiTab: document.querySelectorAll('.ai-tab').length, dom: document.querySelectorAll('*').length, textLen: (document.querySelector('.ai-tab')?.innerText || '').length})`)
  const i = JSON.parse(info)
  console.log(`[${label}] renderer ws=${MB(tab.memory.workingSetSize * 1024)}MB jsHeap=${MB(i.heap)}MB aiTab=${i.aiTab} aiTextLen=${i.textLen} dom=${i.dom}`)
  return i
}

const cdp = await connect()
await sleep(5000)
const sessions = {
  activeTabId: 'probe-gui-1',
  sessions: [{
    id: 'E:/ai/testgit', cwd: 'E:/ai/testgit', name: 'testgit', activeTabId: 'probe-gui-1',
    tabs: [{ id: 'probe-gui-1', kind: 'gui', name: 'probe-gui', cwd: 'E:/ai/testgit', active: true, createdAt: Date.now(), resumeSessionId: '606396cf-b63d-45ea-b9a5-1209cefc2d9c', resumeCwd: 'E:/ai/testgit', loaded: false }],
  }],
}
console.log('injecting gui session + reload...')
await ev(cdp, `localStorage.setItem('vibe-ide-open-sessions', ${JSON.stringify(JSON.stringify(sessions))}); true`)
await cdp.send('Page.enable')
await cdp.send('Page.reload')
await sleep(15000)
const a = await snap(cdp, 'boot (fix: expect LOW heap, no auto-load)')

const rect = await ev(cdp, `(() => {
  for (const el of document.querySelectorAll('div,button')) {
    const r = el.getBoundingClientRect()
    if (r.x < 360 && r.width > 80 && r.height > 10 && r.height < 60 && (el.textContent || '').trim() === 'probe-gui') {
      return { x: r.x + 60, y: r.y + r.height / 2 }
    }
  }
  return null })()`)
if (!rect) { console.log('session row not found'); cdp.close(); process.exit(1) }
console.log(`clicking session row at ${rect.x.toFixed(0)},${rect.y.toFixed(0)}...`)
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
await sleep(15000)
const b = await snap(cdp, 'after click (expect load)')
console.log(`\njsHeap: ${MB(a.heap)}MB -> ${MB(b.heap)}MB  (delta ${MB(b.heap - a.heap)}MB)  aiText: ${a.textLen} -> ${b.textLen}`)
cdp.close()
