// Verify the shared-context refactor: reload, switch two sessions to dsh mode,
// confirm one __dshCtx instance and both views render.
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
  const switchToDsh = async (index) => {
    const item = await ev(`(() => {
      const items = [...document.querySelectorAll('[class*="session-item"]')]
      if (items.length <= ${index}) return null
      const r = items[${index}].getBoundingClientRect()
      return { x: Math.round(r.left + 50), y: Math.round(r.top + 8) }
    })()`)
    if (!item) return false
    await click(item.x, item.y, 'right')
    await sleep(500)
    const btn = await ev(`(() => {
      const b = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).find(x => /dsh/i.test(x.innerText))
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    if (!btn) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); return false }
    await click(btn.x, btn.y)
    return true
  }

  await send('Page.reload', {})
  await sleep(8000)
  console.log('AFTER RELOAD:', JSON.stringify(await ev(`document.querySelectorAll('[class*="session-item"]').length`)))
  console.log('S1:', await switchToDsh(0))
  await sleep(10000)
  console.log('S2:', await switchToDsh(1))
  await sleep(10000)

  console.log('FINAL:', JSON.stringify(await ev(`(() => {
    const dshViews = [...document.querySelectorAll('.dsh-view')]
    return {
      dshViewCount: dshViews.length,
      ctxCount: (() => { try { return window.__dshCtx ? 1 : 0 } catch (e) { return 'err' } })(),
      ctxUid: window.__dshCtx ? window.__dshCtx.root.uid : null,
      current: window.__dshCtx ? window.__dshCtx.get('sessions').list.getSnapshot().current : null,
      viewTexts: dshViews.map(v => v.innerText.slice(0, 40)),
      errors: [...document.querySelectorAll('.text-ide-danger')].map(d => d.innerText.slice(0, 60)),
    }
  })()`), null, 2))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
