// Inspect the open portal menu's position/visibility + workspace chip pointer-events.
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
    const out = {}
    // All menus in body (portal) and inside dsh-view (non-portal)
    const menus = [...document.querySelectorAll('[role="menu"]')]
    out.menus = menus.map(m => {
      const cs = getComputedStyle(m)
      const r = m.getBoundingClientRect()
      return {
        inBody: m.parentElement === document.body,
        cls: String(m.className).slice(0, 60),
        display: cs.display,
        visibility: cs.visibility,
        position: cs.position,
        top: cs.top, left: cs.left,
        zIndex: cs.zIndex,
        opacity: cs.opacity,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        text: m.innerText.slice(0, 60),
      }
    })
    // The workspace chip computed style
    const ws = document.querySelector('.dsh-view [aria-label="选择工作区"]')
    if (ws) {
      const cs = getComputedStyle(ws)
      out.workspaceChip = { pointerEvents: cs.pointerEvents, cursor: cs.cursor }
      const chevron = ws.querySelector('svg:last-child')
      if (chevron) out.wsChevron = { display: getComputedStyle(chevron).display }
    }
    // preset seat button + its menu root span rect
    const seat = document.querySelector('.dsh-view [aria-expanded="true"]')
    if (seat) {
      out.seatRect = (() => { const r = seat.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })()
    }
    return out
  })()`), null, 2))
  ws.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
