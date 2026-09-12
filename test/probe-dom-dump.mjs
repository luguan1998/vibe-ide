import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'

const projectRoot = resolve(import.meta.dirname, '..')
const workspace = join(projectRoot, 'test', 'icon-test')
const cdpPort = 9224
const userDataDir = join(tmpdir(), 'vibe-ide-dump')
mkdirSync(userDataDir, { recursive: true })

const fileArg = process.argv.find(a => a.startsWith('--file='))?.split('=')[1] || 'code.ts'

async function connectCDP(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const t = targets.find(x => x.type === 'page' && !x.url.includes('devtools'))
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0; const pending = new Map()
  ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  return {
    send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('timeout ' + method)), 15000) }),
    close: () => ws.close()
  }
}
async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
  return r.result?.result?.value
}
async function click(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

const proc = spawn(join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe'), [
  `--remote-debugging-port=${cdpPort}`, '--no-sandbox', `--user-data-dir=${userDataDir}`, projectRoot, workspace
], { stdio: 'pipe', env: { ...process.env, ELECTRON_IS_DEV: '0', ELECTRON_RENDERER_URL: '' } })

let cdp = null
for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 1000)); try { cdp = await connectCDP(cdpPort); break } catch {} }
if (!cdp) { console.error('timeout'); proc.kill(); process.exit(1) }
await cdp.send('Runtime.enable')
for (let i = 0; i < 30; i++) { if (await evalIn(cdp, `!!window.api?.workspace`).catch(() => false)) break; await new Promise(r => setTimeout(r, 500)) }

// File tab（会话由 startup:openPath 异步创建，需要轮询）
let ft = null
for (let i = 0; i < 40 && !ft; i++) {
  ft = await evalIn(cdp, `(() => { for (const b of document.querySelectorAll('button')) { const s = b.querySelector('span'); if ((s && s.textContent === 'Dir') || b.title === 'Dir') { const r = b.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2} } } return null })()`).catch(() => null)
  if (!ft) await new Promise(r => setTimeout(r, 500))
}
if (!ft) {
  const btnDump = await evalIn(cdp, `[...document.querySelectorAll('button')].map(b => b.title || b.textContent?.slice(0,20)).slice(0,40)`).catch(() => null)
  console.error('no file tab; buttons=', JSON.stringify(btnDump)); proc.kill(); process.exit(1)
}
await click(cdp, ft.x, ft.y); await new Promise(r => setTimeout(r, 1500))

const item = await evalIn(cdp, `(() => {
  for (const row of document.querySelectorAll('div.cursor-pointer')) {
    const rect = row.getBoundingClientRect()
    if (rect.height === 0 || rect.x < 900) continue
    const fc = row.children[0]
    if (!(fc && fc.tagName === 'SPAN' && fc.classList.contains('w-3'))) continue
    if ((row.textContent||'').includes(${JSON.stringify(fileArg)})) return {x:rect.x+rect.width/2, y:rect.y+rect.height/2, name: row.textContent.trim()}
  } return null })()`)
console.log('click:', item?.name)
await click(cdp, item.x, item.y)
await new Promise(r => setTimeout(r, 4000))

const dump = await evalIn(cdp, `(() => {
  const out = []
  const ed = document.querySelector('.monaco-editor')
  out.push({ hasEditor: !!ed, editors: document.querySelectorAll('.monaco-editor').length, cls: ed ? ed.className : null })
  const lines = document.querySelectorAll('.view-line')
  out.push({ lineCount: lines.length })
  for (const ln of Array.from(lines).slice(0, 8)) {
    const top = ln.style.top
    out.push({ top, html: ln.outerHTML.slice(0, 400) })
  }
  const css = document.querySelector('style.monaco-colors') || document.querySelector('style[id*="monaco"]')
  if (css) {
    const txt = css.textContent || ''
    const mtkRules = txt.match(/\\.mtk\\d+[^{]*\\{[^}]*\\}/g) || []
    out.push({ monoStyleId: css.id, mtkRuleCount: mtkRules.length, mtkSample: mtkRules.slice(0, 12) })
  } else {
    const all = [...document.querySelectorAll('style')].map(s => ({ id: s.id, len: (s.textContent||'').length, head: (s.textContent||'').slice(0,80) }))
    out.push({ styles: all })
  }
  return out })()`)
console.log(JSON.stringify(dump, null, 2))
cdp.close(); proc.kill(); setTimeout(() => process.exit(0), 300)
