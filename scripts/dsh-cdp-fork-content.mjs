// Fork an existing dsh session WITH content via the wrapped sessions.fork,
// then verify a Vibe session with the child id materialized in the panel.
const CDP_PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SRC = 'term-1786724499844-e6nrxf'

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost'))
  if (!page) { console.log('no page'); return }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    }
  }
  const send = (method, params) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) return { EXC: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
    return r.result?.value
  }
  const sessionItemTexts = () => ev(`[...document.querySelectorAll('[class*="session-item"]')].map(x => x.innerText.slice(0, 60))`)

  console.log('BEFORE items:', JSON.stringify(await sessionItemTexts()))
  const forkResult = await ev(`(async () => {
    try {
      const sessions = window.__dshCtx.get('sessions')
      const childId = await sessions.fork({ sessionId: ${JSON.stringify(SRC)}, increaseTitle: true })
      const snap = sessions.list.getSnapshot()
      return { ok: true, childId, childTitle: snap.byId[childId]?.title, childCwd: snap.byId[childId]?.cwd }
    } catch (e) { return { ok: false, err: String(e?.message ?? e) } }
  })()`)
  console.log('fork:', JSON.stringify(forkResult, null, 2))
  await sleep(4000)
  console.log('AFTER items:', JSON.stringify(await sessionItemTexts()))
  console.log('active session item texts:', JSON.stringify(await ev(`[...document.querySelectorAll('[class*="session-item--active"], [class*="session-item"].active')].map(x => x.innerText.slice(0, 60))`)))
  console.log('dsh current:', JSON.stringify(await ev(`window.__dshCtx.get('sessions').list.getSnapshot().current`)))
  ws.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
