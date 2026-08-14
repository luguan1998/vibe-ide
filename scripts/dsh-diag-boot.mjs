// Reproduce DshView boot flow in a detached DOM node via dynamic import.
// No UI interaction — diagnostics only.
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

  // 1. dsh server status
  console.log('PORT_BEFORE:', await ev(`window.api.dsh.getPort()`))

  const r1 = await ev(`window.api.dsh.start('E:/ai')`)
  console.log('START:', JSON.stringify(r1))
  await sleep(3000)

  // 2. dynamic-import context.ts and build the mini shell (like DshView.boot)
  const r2 = await ev(`(async () => {
    const { buildDshContext } = await import('/src/dsh/context.ts?diag=' + Date.now())
    const h = await buildDshContext('http://127.0.0.1:' + (await window.api.dsh.getPort()))
    window.__diagH = h
    const ctx = h.ctx
    return JSON.stringify({
      rootEntries: ctx.slots.entries('root').length,
      convEntries: ctx.slots.entries('conversation').length,
      convSpec: (() => { try { return JSON.stringify(ctx.slots.spec('conversation')) } catch (e) { return 'ERR ' + e.message } })(),
      convEntry: (() => {
        const e = ctx.slots.entries('conversation')[0]
        if (!e) return null
        return { locale: e.locale, children: Object.keys(e.children ?? {}), registrant: e.registrant, live: e.live }
      })(),
    })
  })()`)
  console.log('BUILD:', JSON.stringify(r2))

  // 3. create + open a session (like DshView.boot, new attach flow)
  const r3 = await ev(`(async () => {
    const ctx = window.__diagH.ctx
    const sessions = ctx.get('sessions')
    const workspaces = ctx.get('workspaces')
    let created
    try {
      const workspace = await workspaces.create({ path: 'E:/ai' })
      created = await sessions.create({ workspaceId: workspace.workspaceId, sessionId: 'diag-1' })
    } catch (e) {
      return 'CREATE_THREW: ' + e.message + ' | name=' + e.name
    }
    sessions.open('diag-1')
    const snap = sessions.list.getSnapshot()
    const ws = workspaces.list.getSnapshot()
    return JSON.stringify({
      createResult: created,
      byId: Object.keys(snap.byId ?? {}),
      current: snap.current,
      wsItems: ws.items.map(w => ({ id: w.workspaceId, path: w.path, title: w.title, sessionIds: w.sessionIds })),
      wsPhase: ws.phase,
    })
  })()`)
  console.log('SESSION:', JSON.stringify(r3))

  // 4. render the root slot into a detached div, capture errors
  const r4 = await ev(`(async () => {
    const errors = []
    const onErr = (e) => { errors.push('window.onerror: ' + (e.message ?? e)) }
    const onRej = (e) => { errors.push('unhandledrejection: ' + (e.reason?.message ?? e.reason)) }
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    const mod = await import('/@fs/E:/ai/claudeui/node_modules/.vite/deps/react-dom_client.js')
    const { createRoot } = mod.default ?? mod
    const ctx = window.__diagH.ctx
    const host = document.createElement('div')
    host.id = 'diag-host'
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;background:#fff'
    document.body.appendChild(host)
    const root = createRoot(host)
    let renderErr = null
    try {
      root.render(ctx.slots.renderSlot('root', {}))
    } catch (e) {
      renderErr = 'renderSlot THREW: ' + (e?.stack ?? e?.message ?? e)
    }
    await new Promise(r => setTimeout(r, 4000))
    const html = host.innerHTML
    return JSON.stringify({
      renderErr,
      errors,
      hasRootAnchor: host.querySelector('[data-slot="root"]') !== null,
      anchors: [...host.querySelectorAll('[data-slot]')].map(d => d.getAttribute('data-slot')),
      slotErrors: [...host.querySelectorAll('[data-slot-error]')].map(d => d.getAttribute('data-slot-error')),
      htmlLen: html.length,
      htmlHead: html.slice(0, 600),
      text: host.innerText.slice(0, 200),
    })
  })()`)
  console.log('RENDER:', JSON.stringify(r4))
  ws.close()
}

main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
