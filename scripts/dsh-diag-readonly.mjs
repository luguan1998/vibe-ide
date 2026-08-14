// Read-only state probe: __dshCtx internals + DOM anchors. No clicks.
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result?.value
  }

  console.log('CTX:', await ev(`typeof window.__dshCtx === 'undefined' ? 'NO_CTX' : JSON.stringify((() => {
    const ctx = window.__dshCtx
    return {
      rootEntries: ctx.slots.entries('root').length,
      convEntries: ctx.slots.entries('conversation').length,
      convSpec: (() => { try { return JSON.stringify(ctx.slots.spec('conversation')) } catch (e) { return 'ERR ' + e.message } })(),
      sessions: Object.keys(ctx.get('sessions').list.getSnapshot().byId ?? {}).length,
      current: ctx.get('sessions').list.getSnapshot().current,
      bodyClasses: document.body.className.slice(0, 200),
    }
  })())`))

  console.log('DOM:', await ev(`JSON.stringify({
    slotAnchors: [...document.querySelectorAll('[data-slot]')].map(d => d.getAttribute('data-slot')),
    slotErrors: [...document.querySelectorAll('[data-slot-error]')].map(d => d.getAttribute('data-slot-error')),
    centerText: (() => {
      const c = [...document.querySelectorAll('[class*="flex-1"]')].filter(d => d.innerText.includes('connecting') || d.innerText.includes('dsh'))
      return c.map(d => d.innerText.slice(0, 60)).join(' | ')
    })(),
    bodyText: document.body.innerText.slice(0, 200),
  })`))

  console.log('DSHVIEW:', await ev(`JSON.stringify((() => {
    const all = [...document.querySelectorAll('div')]
    const dsh = all.filter(d => d.innerText.trim().startsWith('dsh') && d.innerText.trim().length < 60)
    return { count: dsh.length, texts: dsh.map(d => d.innerText.trim().slice(0, 50)) }
  })())`))

  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
