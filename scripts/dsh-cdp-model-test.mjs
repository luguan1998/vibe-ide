// Re-mount the dsh view (switch mode away and back), then check the composer
// for the model/effort selector.
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

  // Right-click the first session item and dump menu buttons
  const item = await ev(`(() => {
    const items = [...document.querySelectorAll('[class*="session-item"]')]
    if (!items.length) return null
    const r = items[0].getBoundingClientRect()
    return { x: Math.round(r.left + 50), y: Math.round(r.top + 8) }
  })()`)
  if (item) {
    await click(item.x, item.y, 'right')
    await sleep(600)
  }
  console.log('MENU:', JSON.stringify(await ev(`[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => b.innerText.slice(0, 30)).filter(Boolean).slice(0, 14)`)))

  // Close the menu
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(400)
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
