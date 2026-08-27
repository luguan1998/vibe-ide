/**
 * dsh 多开实证:起 out/ 产物,播种 1 个 vs 3 个 dsh 会话 tab,
 * 对比 DOM 节点数 / JS 堆 / history 轮询请求数,验证"每 tab 一棵完整 dsh 树"。
 * 用法: node test/dsh-multi-probe.mjs
 */
import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { mkdirSync } from 'fs'

const projectRoot = resolve(import.meta.dirname, '..')
const cdpPort = 9233
const userDataDir = join(tmpdir(), 'vibe-ide-dshprobe')
mkdirSync(userDataDir, { recursive: true })
const workspace = join(projectRoot, 'test', 'icon-test')

const tab = (id, kind, cwd) => ({ id, kind, name: id, cwd, active: true, createdAt: Date.now(), loaded: false })
function seedWorkspace(n) {
  const sessions = []
  for (let i = 0; i < n; i++) {
    const sid = `seed-dsh-${i}`
    sessions.push({ id: sid, cwd: workspace, name: `Seed${i}`, activeTabId: sid, tabs: [tab(sid, 'dsh', workspace)] })
  }
  return { activeTabId: 'seed-dsh-0', sessions }
}

async function connectCDP(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const pageTarget = targets.find(t => t.type === 'page' && !t.url.includes('devtools'))
      if (!pageTarget) throw new Error('no page target')
      const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('ws timeout')), 5000) })
      let id = 0
      const pending = new Map()
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id) }
        if (data.method === 'Network.responseReceived') {
          const url = data.params?.response?.url ?? ''
          if (url.includes('localhost') || url.includes('127.0.0.1')) allRequests.push(url)
          if (url.includes('history')) historyRequests.push(url)
        }
      }
      return {
        send: (method, params = {}) => new Promise((res, rej) => {
          const msgId = ++id
          pending.set(msgId, res)
          ws.send(JSON.stringify({ id: msgId, method, params }))
          setTimeout(() => { pending.delete(msgId); rej(new Error(method + ' timeout')) }, 20000)
        }),
        close: () => ws.close()
      }
    } catch { await new Promise(r => setTimeout(r, 1000)) }
  }
  throw new Error('CDP connect failed')
}

const evalIn = (cdp, expression) =>
  cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    .then(r => { if (r.result?.exceptionDetails) throw new Error('eval err: ' + (r.result.exceptionDetails.text || '')); return r.result?.result?.value })

let historyRequests = []
let allRequests = []
const measure = () => evalIn(cdp, `({
  heap: performance.memory?.usedJSHeapSize ?? 0,
  domNodes: document.querySelectorAll('*').length,
  dshViews: document.querySelectorAll('.dsh-view').length,
  rootSlots: document.querySelectorAll('[data-slot="root"]').length,
  conversations: document.querySelectorAll('[data-slot="conversation"]').length,
  dshReady: [...document.querySelectorAll('.dsh-view')].filter(v => v.querySelector('[data-slot="root"]')).length,
})`)
const waitFor = async (desc, cond) => {
  const t0 = Date.now()
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const v = await measure()
    if (cond(v)) { console.log(`  ${desc} 就绪(${Math.round((Date.now()-t0)/1000)}s)`); return v }
  }
  console.log(`  ⚠ ${desc} 等待超时 90s`)
  return measure()
}
const dumpRequests = (label) => {
  const counts = {}
  for (const u of allRequests) {
    const m = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('/').slice(-1)[0] || '/'
    const k = u.includes('?') ? u.split('?')[1].split('&').map(x => x.split('=')[0]).join('&') : ''
    const key = `${m}?${k}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  console.log(`  [${label}] 本地请求分布: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`)
  allRequests = []
}

// ─── 启动 ───
const proc = spawn(join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe'), [
  `--remote-debugging-port=${cdpPort}`, '--enable-precise-memory-info', '--no-sandbox',
  `--user-data-dir=${userDataDir}`, projectRoot, workspace
], { stdio: 'pipe', env: { ...process.env, ELECTRON_IS_DEV: '0' } })
proc.stderr?.on('data', d => { const s = d.toString(); if (/Unhandled|ERROR.*dsh/i.test(s)) process.stderr.write('[app] ' + s) })

const cdp = await connectCDP(cdpPort)
for (let i = 0; i < 30; i++) {
  try { if (await evalIn(cdp, '!!window.api?.perf?.snapshot')) break } catch {}
  await new Promise(r => setTimeout(r, 1000))
}
console.log('renderer ready')

// 监听网络请求,统计 dsh API 轮询(? 计时按毫秒
cdp.send('Network.enable').catch(() => {})
cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {})

// ─── 阶段0: 1 个 dsh 会话 ───
await evalIn(cdp, `localStorage.setItem('vibe-ide-open-sessions', ${JSON.stringify(JSON.stringify(seedWorkspace(1)))}); location.reload(); true`)
await waitFor('1 tab', v => v.dshViews >= 1 && v.rootSlots >= 1)
await new Promise(r => setTimeout(r, 4000))
const countHistory = () => { const n = historyRequests.length; historyRequests = []; return n }
let m = await measure()
console.log(`\n[1 个 dsh tab] heap=${(m.heap/1048576).toFixed(1)}MB dom=${m.domNodes} dshViews=${m.dshViews} rootSlots=${m.rootSlots} conv=${m.conversations}`)
await new Promise(r => setTimeout(r, 4000))
console.log(`  4s 内 sessions.history 请求: ${countHistory()} 次`)
dumpRequests('1tab 前 4s')

// ─── 阶段1: 3 个 dsh 会话 ───
await evalIn(cdp, `localStorage.setItem('vibe-ide-open-sessions', ${JSON.stringify(JSON.stringify(seedWorkspace(3)))}); location.reload(); true`)
await waitFor('3 tab', v => v.dshViews >= 3 && v.rootSlots >= 1)
await new Promise(r => setTimeout(r, 3000))
m = await measure()
console.log(`[3 个 dsh tab] heap=${(m.heap/1048576).toFixed(1)}MB dom=${m.domNodes} dshViews=${m.dshViews} rootSlots=${m.rootSlots} conv=${m.conversations}`)
await new Promise(r => setTimeout(r, 4000))
console.log(`  4s 内 sessions.history 请求: ${countHistory()} 次`)
dumpRequests('3tab 后 4s')

// ─── 阶段2: 切换到第二个 tab(Ctrl+ArrowDown),验证树跟随 active 且仍只 1 棵 ───
await evalIn(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true }))`)
await new Promise(r => setTimeout(r, 4000))
const m2 = await measure()
console.log(`\n[切到 tab2 后] heap=${(m2.heap/1048576).toFixed(1)}MB dom=${m2.domNodes} dshViews=${m2.dshViews} rootSlots=${m2.rootSlots} conv=${m2.conversations} history=${countHistory()} 次/4s`)
// 再切回 tab1
await evalIn(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, bubbles: true }))`)
await new Promise(r => setTimeout(r, 2500))
const m3 = await measure()
console.log(`[切回 tab1 后] dom=${m3.domNodes} dshViews=${m3.dshViews} rootSlots=${m3.rootSlots} conv=${m3.conversations}`)

proc.kill()
process.exit(0)