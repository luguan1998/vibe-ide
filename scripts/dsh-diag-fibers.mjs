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
    const ctx = window.__diagH.ctx
    const reg = ctx.registry
    const out = { registryKeys: Object.keys(reg).slice(0, 30) }
    try {
      out.fibers = reg.get('fiber') ? 'has get' : 'no get'
    } catch (e) { out.fibersErr = e.message }
    try {
      const fibers = reg.fibers?.() ?? null
      out.fiberList = fibers ? fibers.map(f => ({ name: f.name, state: f.state })) : null
    } catch (e) { out.fibersErr2 = e.message }
    try {
      out.settingsSlotSpec = JSON.stringify(ctx.slots.spec('settings.general.item'))
    } catch (e) { out.specErr = e.message }
    out.hasSettingsScope = ctx.get('settingsScope') !== undefined
    return out
  })()`), null, 2))
  ws.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
