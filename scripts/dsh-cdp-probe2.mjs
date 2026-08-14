// Read-only probe of the live dsh hero: chips, preset button state, slot anchors.
const CDP_PORT = 9222
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
  console.log(JSON.stringify(await ev(`(() => {
    const out = { hasCtx: typeof window.__dshCtx !== 'undefined' }
    if (!out.hasCtx) return out
    const dsh = document.querySelector('.dsh-view')
    out.hero = dsh ? {
      phase: dsh.querySelector('[data-phase]')?.getAttribute('data-phase'),
      buttons: [...dsh.querySelectorAll('button')].map(b => ({
        text: b.innerText.slice(0, 30),
        disabled: b.disabled,
        cls: String(b.className).slice(0, 60),
        aria: b.getAttribute('aria-label'),
        hasMenu: b.getAttribute('aria-haspopup'),
        expanded: b.getAttribute('aria-expanded'),
        rect: (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
      })),
      slots: [...dsh.querySelectorAll('[data-slot]')].map(d => d.getAttribute('data-slot')),
    } : null
    out.portalMenus = [...document.querySelectorAll('body > [role="menu"], body > div[role="menu"]')].length
    out.ctxConvEntries = window.__dshCtx.slots.entries('conversation').length
    return out
  })()`), null, 2))
  ws.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
