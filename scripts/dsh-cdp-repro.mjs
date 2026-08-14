// Drive the real UI: create a session from the welcome screen, switch to dsh
// mode, then probe the hero chips + preset menu behavior.
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
    if (r.exceptionDetails) return { EXC: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
    return r.result?.value
  }
  const click = async (x, y, button = 'left') => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 })
  }

  console.log('BODY:', JSON.stringify(await ev(`document.body.innerText.slice(0, 200)`)))

  // Click the recent folder row for E:/ai (welcome screen list)
  const row = await ev(`(() => {
    const rows = [...document.querySelectorAll('div')].filter(d => d.innerText === 'ai' && d.offsetParent !== null && d.getBoundingClientRect().width < 400)
    const r = rows[0]?.getBoundingClientRect()
    return r ? { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) } : null
  })()`)
  console.log('RECENT ROW:', JSON.stringify(row))
  if (row) { await click(row.x, row.y); await sleep(4000) }

  console.log('SESSION ITEMS:', JSON.stringify(await ev(`document.querySelectorAll('[class*="session-item"]').length`)))

  // Right-click first session item -> dsh mode
  const item = await ev(`(() => {
    const items = [...document.querySelectorAll('[class*="session-item"]')]
    if (!items.length) return null
    const r = items[0].getBoundingClientRect()
    return { x: Math.round(r.left + 50), y: Math.round(r.top + 8) }
  })()`)
  console.log('ITEM:', JSON.stringify(item))
  if (item) {
    await click(item.x, item.y, 'right')
    await sleep(600)
    const dshBtn = await ev(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
      const t = btns.find(b => /dsh/i.test(b.innerText))
      if (!t) return null
      const r = t.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    console.log('DSH BTN:', JSON.stringify(dshBtn))
    if (dshBtn) { await click(dshBtn.x, dshBtn.y); console.log('DSH CLICKED') }
  }

  await sleep(12000)
  console.log('READY:', JSON.stringify(await ev(`JSON.stringify({
    hasCtx: typeof window.__dshCtx !== 'undefined',
    text: document.body.innerText.slice(0, 300),
  })`)))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
