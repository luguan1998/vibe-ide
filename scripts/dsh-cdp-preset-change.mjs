// Change the default preset in settings, close, verify the hero chip updates.
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
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  const chipText = () => ev(`(() => {
    const b = [...document.querySelectorAll('.dsh-view button')].find(x => x.getAttribute('aria-haspopup') === 'menu' && /模式/.test(x.innerText))
    return b ? b.innerText : null
  })()`)

  // Find the 标准模式 preset card in the dialog and click its "use" control
  const card = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return null
    const els = [...dlg.querySelectorAll('button, [role="button"]')]
    const b = els.find(x => x.innerText.trim() === '标准模式' || x.innerText.startsWith('标准模式'))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: b.innerText.slice(0, 20) }
  })()`)
  console.log('STD CARD:', JSON.stringify(card))
  if (card) { await click(card.x, card.y); await sleep(2000) }

  console.log('DIALOG AFTER:', JSON.stringify(await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    return dlg ? dlg.innerText.slice(0, 200) : 'CLOSED'
  })()`)))

  // Close via Escape
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(2000)
  console.log('CHIP AFTER:', JSON.stringify(await chipText()))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
