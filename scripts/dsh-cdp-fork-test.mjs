// E2E: switch a session to dsh mode, fork the current dsh session, verify a
// new Vibe session with the child id appears in the session list.
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

  const sessionItemCount = () => ev(`document.querySelectorAll('[class*="session-item"]').length`)
  const sessionItemTexts = () => ev(`[...document.querySelectorAll('[class*="session-item"]')].map(x => x.innerText.slice(0, 50))`)

  console.log('initial session items:', JSON.stringify(await sessionItemCount()))
  console.log('items:', JSON.stringify(await sessionItemTexts()))

  // No sessions yet: click a recent dir on the welcome screen to create one
  let item = await ev(`(() => {
    const items = [...document.querySelectorAll('[class*="session-item"]')]
    if (items.length > 0) return null
    const recent = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).find(x => /E:[\\\\/]ai|ai\\\\/i.test(x.innerText))
    if (!recent) return { none: true, buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).slice(0, 12).map(x => x.innerText.slice(0, 40)) }
    const r = recent.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), recent: true }
  })()`)
  if (item?.none) {
    console.log('no session items and no recent dir found; welcome buttons:', JSON.stringify(item.buttons))
    ws.close(); return
  }
  if (item?.recent) {
    await click(item.x, item.y)
    await sleep(4000)
    console.log('after recent-dir click items:', JSON.stringify(await sessionItemTexts()))
  }
  item = await ev(`(() => {
    const items = [...document.querySelectorAll('[class*="session-item"]')]
    if (items.length === 0) return null
    const r = items[0].getBoundingClientRect()
    return { x: Math.round(r.left + 50), y: Math.round(r.top + 8) }
  })()`)
  if (!item) { console.log('no session items after recent-dir click'); ws.close(); return }
  const hasCtx = await ev(`!!window.__dshCtx`)
  if (!hasCtx) {
    await click(item.x, item.y, 'right')
    await sleep(600)
    const btn = await ev(`(() => {
      const b = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).find(x => /dsh/i.test(x.innerText))
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    if (!btn) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      console.log('no dsh menu item'); ws.close(); return
    }
    await click(btn.x, btn.y)
  }

  // wait for the dsh context + current session
  let current = null
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    current = await ev(`window.__dshCtx ? window.__dshCtx.get('sessions').list.getSnapshot().current ?? null : null`)
    if (current) break
  }
  console.log('dsh current session:', JSON.stringify(current))
  if (!current) { ws.close(); return }

  // fork it
  const forkResult = await ev(`(async () => {
    try {
      const sessions = window.__dshCtx.get('sessions')
      const childId = await sessions.fork({ sessionId: ${JSON.stringify(current)}, increaseTitle: true })
      return { ok: true, childId }
    } catch (e) { return { ok: false, err: String(e?.message ?? e) } }
  })()`)
  console.log('fork result:', JSON.stringify(forkResult))

  await sleep(3000)
  console.log('AFTER FORK items:', JSON.stringify(await sessionItemTexts()))
  console.log('AFTER FORK dsh current:', JSON.stringify(await ev(`window.__dshCtx ? window.__dshCtx.get('sessions').list.getSnapshot().current : null`)))
  console.log('dsh views:', JSON.stringify(await ev(`[...document.querySelectorAll('.dsh-view')].map(v => v.innerText.slice(0, 30))`)))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
