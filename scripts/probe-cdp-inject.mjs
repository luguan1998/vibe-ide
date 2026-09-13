// Inject a fixed session list into a probe instance's localStorage (for seed profiles).
// Usage: node scripts/probe-cdp-inject.mjs [port] [cwd]
const port = Number(process.argv[2] || 9231)
const cwd = process.argv[3] || 'E:/ai/claudeui'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let t
for (let i = 0; i < 60; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    t = targets.find(x => x.type === 'page' && x.url.includes('renderer'))
    if (t) break
  } catch {}
  await sleep(1000)
}
if (!t) { console.error('no target'); process.exit(1) }
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (m, p = {}) => new Promise((res, rej) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method: m, params: p }))
  setTimeout(() => rej(new Error('timeout ' + m)), 20000)
})

const sessions = {
  activeTabId: 'seed-t0',
  sessions: [
    { id: cwd, cwd, name: 'seed-a', activeTabId: 'seed-t0', tabs: [{ id: 'seed-t0', kind: 'gui', name: 'seed-a', cwd, active: true, createdAt: Date.now(), loaded: false }] },
    { id: cwd + '/src', cwd, name: 'seed-b', activeTabId: 'seed-t1', tabs: [{ id: 'seed-t1', kind: 'gui', name: 'seed-b', cwd, active: true, createdAt: Date.now(), loaded: false }] },
  ],
}
const expr = `localStorage.setItem('vibe-ide-open-sessions', ${JSON.stringify(JSON.stringify(sessions))}); localStorage.getItem('vibe-ide-open-sessions').length`
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
console.log('injected, key length =', r.result?.result?.value)
await send('Page.enable')
await send('Page.reload')
console.log('reloaded, letting app restore + re-save...')
await sleep(12000)
const chk = await send('Runtime.evaluate', { expression: `JSON.stringify({ key: (localStorage.getItem('vibe-ide-open-sessions') || '').length, rows: document.querySelectorAll('[class*="session-item"]').length })`, returnByValue: true })
console.log('after reload:', chk.result?.result?.value)
if (process.argv[4] === '--quit') {
  try { await send('Browser.close') } catch {}
  await sleep(5000)
}
ws.close()
