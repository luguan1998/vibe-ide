// Verify the plugin inventory tab is registered after adding ui-settings-plugin-inventory.
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
  const out = await ev(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    for (let i = 0; i < 40; i++) {
      if (window.__dshCtx) break
      await wait(500)
    }
    if (!window.__dshCtx) return 'NO_CTX'
    const ctx = window.__dshCtx
    const tabs = ctx.slots.entries('settings.plugins.tab')
    let listResult = null
    try {
      listResult = await ctx.get('remote').pluginInventory.list()
    } catch (e) { listResult = 'REMOTE_ERR: ' + String(e?.message ?? e) }
    return {
      tabCount: tabs.length,
      tabIds: tabs.map((t) => t.options?.id),
      remoteList: listResult === 'REMOTE_ERR' || typeof listResult === 'string'
        ? listResult
        : { ok: true, entryCount: listResult?.value?.entries?.length, first3: listResult?.value?.entries?.slice(0, 3).map((e) => e.moduleName), phases: listResult?.value?.entries?.slice(0, 5).map((e) => e.fiberPhase) },
    }
  })()`)
  console.log(JSON.stringify(out, null, 2))
  ws.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
