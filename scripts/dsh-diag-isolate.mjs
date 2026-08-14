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
    const iso = ctx.constructor.isolate
    const out = { fibers: [] }
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        const keys = Object.keys(fiber.inject ?? {})
        if (!keys.length) continue
        out.fibers.push({
          uid: fiber.uid, state: fiber.state, err: fiber._error ? String(fiber._error.message ?? fiber._error).slice(0, 120) : null,
          inject: keys.slice(0, 14),
          perService: keys.map(n => {
            const impl = ctx.reflect.store[ctx.root[iso][n]]
            return {
              n,
              storeKey: ctx.root[iso][n] !== undefined,
              implState: impl ? impl.fiber.state : null,
              myIso: String(fiber.ctx[iso][n]),
              provIso: impl ? String(impl.fiber.ctx[iso][n]) : null,
              match: fiber.ctx[iso][n] !== undefined && impl !== undefined && fiber.ctx[iso][n] === impl.fiber.ctx[iso][n],
              inStore: !!fiber.store?.[n],
            }
          }),
        })
      }
    }
    return out
  })()`), null, 2))
  ws.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
