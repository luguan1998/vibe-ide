/**
 * 探针：AI 消息末尾 meta 行的可点击性（hover 两层叠加结构）
 * 注入与组件同构的 DOM，测 hover 命中与点击是否落到按钮上。
 * 用法: node test/probe-meta-click.mjs   （需先 npm run build）
 */
import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'

const projectRoot = resolve(import.meta.dirname, '..')
const cdpPort = 9241
const userDataDir = join(tmpdir(), 'vibe-ide-probe-meta')
mkdirSync(userDataDir, { recursive: true })

async function connectCDP(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await resp.json()
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('devtools'))
  if (!page) throw new Error('no renderer target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('ws timeout')), 5000) })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id
    pending.set(msgId, res)
    ws.send(JSON.stringify({ id: msgId, method, params }))
    setTimeout(() => { pending.delete(msgId); rej(new Error(`CDP ${method} timeout`)) }, 60000)
  })
  return { send, close: () => ws.close() }
}

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}

const electronExe = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const env = { ...process.env, ELECTRON_IS_DEV: '0' }
delete env.ELECTRON_RENDERER_URL
const proc = spawn(electronExe, [`--remote-debugging-port=${cdpPort}`, '--no-sandbox', `--user-data-dir=${userDataDir}`, projectRoot, projectRoot.replace(/\\/g, '/')], { stdio: 'pipe', env })
let cdp = null
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  try { cdp = await connectCDP(cdpPort); break } catch { /* retry */ }
}
if (!cdp) { console.error('启动超时'); proc.kill(); process.exit(1) }
await cdp.send('Runtime.enable')
await cdp.send('DOM.enable')
await cdp.send('CSS.enable')
for (let i = 0; i < 30; i++) { if (await evalIn(cdp, '!!window.api?.ai').catch(() => false)) break; await new Promise((r) => setTimeout(r, 500)) }

const INJECT = `
(() => {
  document.getElementById('probe-meta')?.remove()
  const host = document.createElement('div')
  host.id = 'probe-meta'
  host.style.cssText = 'position:fixed;left:40px;top:120px;width:600px;z-index:99999;background:#fff;padding:8px'
  host.innerHTML = \`
    <div class="ai-tab__message-meta group/meta grid w-full" id="probe-row">
      <div class="ai-tab__message-meta-elapsed col-start-1 row-start-1 pointer-events-none flex items-center text-xs text-ide-text-muted/50 group-hover/meta:opacity-0 transition-opacity">
        <span class="inline-flex items-center gap-0.5 mr-2"><span class="text-sm">✻</span><span>Churned for 1.2s</span></span>
      </div>
      <div class="ai-tab__message-meta-actions col-start-1 row-start-1 pointer-events-none group-hover/meta:pointer-events-auto flex items-center gap-2.5 h-7 opacity-0 group-hover/meta:opacity-100 transition-opacity">
        <button id="probe-copy" class="w-7 h-7 flex items-center justify-center rounded-full text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors" onclick="window.__probeCopy=(window.__probeCopy||0)+1">C</button>
        <button id="probe-fork" class="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-ide-text-muted hover:bg-ide-hover hover:text-ide-text transition-colors" onclick="window.__probeFork=(window.__probeFork||0)+1">F</button>
        <span class="text-sm leading-none tabular-nums text-ide-text-muted/50">12:34</span>
      </div>
    </div>\`
  document.body.appendChild(host)
  const row = document.getElementById('probe-row')
  const r = row.getBoundingClientRect()
  return { rowRect: { x: r.x, y: r.y, w: r.width, h: r.height } }
})()
`
console.log('inject:', JSON.stringify(await evalIn(cdp, INJECT)))

const probe = async (label) => {
  const info = await evalIn(cdp, `
    (() => {
      const copy = document.getElementById('probe-copy')
      const cr = copy.getBoundingClientRect()
      const cx = cr.x + cr.width / 2, cy = cr.y + cr.height / 2
      const hit = document.elementFromPoint(cx, cy)
      const actions = document.querySelector('#probe-row .ai-tab__message-meta-actions')
      const elapsed = document.querySelector('#probe-row .ai-tab__message-meta-elapsed')
      return {
        copyRect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) },
        hitAtCopyCenter: hit ? (hit.id || hit.className || hit.tagName) : null,
        actionsOpacity: getComputedStyle(actions).opacity,
        elapsedOpacity: getComputedStyle(elapsed).opacity,
      }
    })()
  `)
  console.log(label, JSON.stringify(info))
  return info
}

await probe('[rest  ]')
// 真实鼠标移入按钮中心
const rect = await evalIn(cdp, `(() => { const r = document.getElementById('probe-copy').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, buttons: 0 })
await new Promise((r) => setTimeout(r, 400))
await probe('[hover ]')
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1, buttons: 1 })
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1, buttons: 0 })
await new Promise((r) => setTimeout(r, 300))
console.log('clicked copy count =', await evalIn(cdp, 'window.__probeCopy || 0'))

cdp.close()
proc.kill()
