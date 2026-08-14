// Check running instance capability: preload dsh API, session items, welcome state.
const CDP_PORT = 9222
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result?.value
  }
  console.log('CAP:', await ev(`JSON.stringify({
    hasApiDsh: !!(window.api && window.api.dsh),
    apiKeys: window.api ? Object.keys(window.api) : [],
    sessionItems: document.querySelectorAll('[class*="session-item"]').length,
    welcomeVisible: document.body.innerText.includes('打开文件夹'),
  })`))
  ws.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
