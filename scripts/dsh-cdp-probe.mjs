// Dismiss any native dialog and diagnose the session-panel hit zone.
const CDP_PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(800)
  console.log('AFTER_ESC:', JSON.stringify(await ev('document.body.innerText.slice(0, 120)')))
  console.log('ZONE:', JSON.stringify(await ev(`(() => {
    const el = [...document.querySelectorAll('div')].find(d => d.innerText === 'No sessions yet' || d.innerText.includes('No sessions yet'))
    if (!el) return 'none'
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + 80, r.top + 10)
    return {
      x: Math.round(r.left + 80), y: Math.round(r.top + 10),
      hit: hit ? String(hit.className).slice(0, 60) + '|' + hit.tagName : 'null',
      panelVisible: !!el.offsetParent,
    }
  })()`)))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
