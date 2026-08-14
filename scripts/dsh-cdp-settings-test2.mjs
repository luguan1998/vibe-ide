// Re-open settings, click Agent presets precisely, dump section content.
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

  // Open gear
  const gear = await ev(`(() => {
    const b = [...document.querySelectorAll('.dsh-view button')].find(x => x.getAttribute('aria-haspopup') === 'dialog')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (gear) { await click(gear.x, gear.y); await sleep(1200) }

  // Find nav cell rects inside the dialog
  const cells = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return null
    return [...dlg.querySelectorAll('button')].map(b => {
      const r = b.getBoundingClientRect()
      return { t: b.innerText.slice(0, 20), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) }
    }).filter(c => c.w > 40)
  })()`)
  console.log('CELLS:', JSON.stringify(cells))
  const presetCell = (cells ?? []).find(c => /Agent 预设|预设/.test(c.t))
  if (presetCell) {
    await click(presetCell.x, presetCell.y)
    await sleep(1500)
  }
  console.log('SECTION:', JSON.stringify(await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return 'NO DIALOG'
    return { text: dlg.innerText.slice(0, 600) }
  })()`)))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
