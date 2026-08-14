// Click the model selector and dump its menu content.
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

  const btn = await ev(`(() => {
    const b = [...document.querySelectorAll('.dsh-view button')].find(x => /Flash|DeepSeek|deepseek/i.test(x.innerText))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: b.innerText.slice(0, 40) }
  })()`)
  console.log('MODEL BTN:', JSON.stringify(btn))
  if (btn) {
    await click(btn.x, btn.y)
    await sleep(1000)
  }
  console.log('MENUS:', JSON.stringify(await ev(`(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')]
    return menus.map(m => {
      const cs = getComputedStyle(m)
      const r = m.getBoundingClientRect()
      return {
        cls: String(m.className).slice(0, 60),
        position: cs.position,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        text: m.innerText.slice(0, 120),
      }
    })
  })()`), null, 2))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
