// CDP-driven automated verification of dsh mode (no deps, Node 22 WebSocket).
const CDP_PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let targets
  for (let i = 0; i < 30; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); break } catch { await sleep(1000) }
  }
  const page = targets?.find((t) => t.type === 'page' && t.url.includes('localhost'))
  if (!page) { console.log('RESULT: no page target'); return }
  console.log('TARGET:', page.url)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
    }
  }
  const send = (method, params) => new Promise((resolve, reject) => {
    const msgId = ++id; pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
  const evaljs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result?.value
  }
  const log = (label, v) => console.log(label + ':', JSON.stringify(v))

  await sleep(2500)

  // 1. Right-click the "No sessions yet" zone to open the empty-area menu (real input)
  const zone = await evaljs(`(() => {
    const el = [...document.querySelectorAll('div')].find(d => d.innerText === 'No sessions yet' || d.innerText.includes('No sessions yet'))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + 80), y: Math.round(r.top + 10) }
  })()`)
  if (!zone) { console.log('RESULT: no empty zone found'); ws.close(); return }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: zone.x, y: zone.y, button: 'right', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: zone.x, y: zone.y, button: 'right', clickCount: 1 })
  await sleep(600)
  log('MENU', await evaljs(`[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => b.innerText.slice(0, 30)).join('|')`))

  // 2. Click "New Terminal" in the empty-area menu (creates a session)
  const newBtn = await evaljs(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
    const target = btns.find(b => /New Terminal|新建终端/.test(b.innerText))
    if (!target) return null
    const r = target.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (newBtn) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: newBtn.x, y: newBtn.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: newBtn.x, y: newBtn.y, button: 'left', clickCount: 1 })
    log('NEW', 'clicked')
  } else {
    log('NEW', 'no button: ' + await evaljs(`[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => b.innerText.slice(0,20)).join('|')`))
  }
  await sleep(2000)

  // 3. Right-click the session item -> context menu -> dsh mode
  log('ITEMS', await evaljs(`[...document.querySelectorAll('[class*="session-item"]')].length`))
  const item = await evaljs(`(() => {
    const items = [...document.querySelectorAll('[class*="session-item"]')]
    if (!items.length) return null
    const r = items[0].getBoundingClientRect()
    return { x: Math.round(r.left + 50), y: Math.round(r.top + 8) }
  })()`)
  if (item) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: item.x, y: item.y, button: 'right', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: item.x, y: item.y, button: 'right', clickCount: 1 })
    await sleep(500)
    const dshBtn = await evaljs(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
      const t = btns.find(b => /dsh/.test(b.innerText))
      if (!t) return null
      const r = t.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    if (dshBtn) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dshBtn.x, y: dshBtn.y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dshBtn.x, y: dshBtn.y, button: 'left', clickCount: 1 })
      log('DSHBTN', 'clicked')
    } else {
      log('DSHBTN', 'none: ' + await evaljs(`[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => b.innerText.slice(0,20)).join('|')`))
    }
  } else {
    log('CTX2', 'no items')
  }
  await sleep(8000)

  // 4. Final state
  log('FINAL', await evaljs(`(() => ({
    text: document.body.innerText.slice(0, 400),
    hasCtx: typeof window.__dshCtx !== 'undefined',
  }))()`))
  ws.close()
}

main().catch((e) => { console.log('SCRIPT ERROR:', e.message); process.exit(1) })
