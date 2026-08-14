// Step 2: right-click session item, click dsh mode, report center column.
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

  // Right-click first session item via real input
  const item = await ev(`(() => {
    const items = [...document.querySelectorAll('[class*="session-item"]')]
    if (!items.length) return null
    const r = items[0].getBoundingClientRect()
    return { x: Math.round(r.left + 50), y: Math.round(r.top + 8), visible: !!items[0].offsetParent }
  })()`)
  console.log('ITEM:', JSON.stringify(item))
  if (!item || !item.visible) { console.log('no visible item'); ws.close(); return }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: item.x, y: item.y, button: 'right', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: item.x, y: item.y, button: 'right', clickCount: 1 })
  await sleep(600)
  const btns = await ev(`[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => b.innerText.slice(0, 25)).join('|')`)
  console.log('MENU BTNS:', btns)

  const dshBtn = await ev(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
    const t = btns.find(b => /dsh/.test(b.innerText))
    if (!t) return null
    const r = t.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!dshBtn) { console.log('NO DSH BTN'); ws.close(); return }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dshBtn.x, y: dshBtn.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dshBtn.x, y: dshBtn.y, button: 'left', clickCount: 1 })
  console.log('DSH CLICKED')
  await sleep(10000)
  console.log('FINAL:', await ev(`JSON.stringify({
    hasCtx: typeof window.__dshCtx !== 'undefined',
    text: document.body.innerText.slice(0, 400),
  })`))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
