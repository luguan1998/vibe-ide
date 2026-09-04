const { app, BrowserWindow } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

const { trackWebview, handleCall } = require('./prod-bundle.cjs')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')

const RESULT = path.join(__dirname, 'result2.json')
const out = { checks: [], logs: [], t0: Date.now() }
function log(k, v) { out.logs.push([k, v]); console.log('LOG', k, JSON.stringify(v).slice(0, 400)) }
function check(name, pass, detail) {
  out.checks.push({ name, pass: !!pass, detail })
  try { fs.writeFileSync(RESULT, JSON.stringify(out, null, 2)) } catch (e) {}
  console.log('CHECK', pass ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 300) : '')
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const text = (res) => (res.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n')

const PORT_HOST = 8941
const PORT_EMBED = 8942

const HOST_HTML = `<!doctype html><html><body style="font-family:sans-serif">
<h3>host main frame</h3>
<input type="radio" name="hr" id="hrA" aria-label="HostRadioA" checked><input type="radio" name="hr" id="hrB" aria-label="HostRadioB">
<iframe id="f" src="http://127.0.0.1:${PORT_EMBED}/embed.html" width="640" height="420" style="border:1px solid #888;display:block;margin-top:150px"></iframe>
</body></html>`

const EMBED_HTML = `<!doctype html><html><body style="font-family:sans-serif">
<input type="radio" name="sz" value="medium" id="med" aria-label="MediumSize">Medium
<input type="radio" name="sz" value="large" id="big" aria-label="LargeSize">Large
<input type="text" id="fillme" aria-label="FillField" style="margin-top:24px;width:200px"><br>
<button id="sb" onclick="window.__submitted=(window.__submitted||0)+1">SubmitNow</button>
<div style="height:2400px;background:linear-gradient(#fff,#369)"></div>
<script>
window.__evts=[];window.__keys=[];
window.addEventListener('mousedown',function(e){window.__evts.push('down:'+e.target.tagName+':'+e.isTrusted)},true);
window.addEventListener('keydown',function(e){window.__keys.push(e.key)},true);
</script>
</body></html>`

function mkServer(port, routes) {
  return new Promise((res) => {
    const s = http.createServer((req, r2) => {
      r2.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      r2.end(routes[req.url.split('?')[0]] || routes['/'])
    })
    s.listen(port, '127.0.0.1', () => res(s))
  })
}

function findRef(snapText, name) {
  const re = new RegExp('(e\\d+)[^\\n]*name="' + name + '"[^\\n]*')
  const m = re.exec(snapText)
  if (!m) return null
  return { ref: m[1], line: m[0] }
}
function boxOf(line) {
  const m = /box=(\d+),(\d+) (\d+)x(\d+)/.exec(line)
  if (!m) return null
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }
}

function framesOf(c) {
  const res = []
  try {
    const mf = c.mainFrame
    if (!mf) return res
    res.push(mf)
    const sub = mf.framesInSubtree
    if (sub) for (const f of sub) if (f !== mf) res.push(f)
  } catch (e) {}
  return res
}

async function run(guest) {
  // snapshot must cover the OOPIF and (after fix) apply frame offsets to boxes
  const snap = text(await handleCall('snapshot', { boxes: true, quiet: true }))
  log('snapshot', snap)
  check('S1 snapshot has frame section', snap.includes('--- frame'))
  const big = findRef(snap, 'LargeSize')
  const fld = findRef(snap, 'FillField')
  check('S2 refs in frame section', !!big && !!fld, { big: big && big.line, fld: fld && fld.line })
  const bb = big && boxOf(big.line)
  check('S3 frame box carries top-viewport offset (y>150)', !!bb && bb.y > 150, bb)

  // click by ref inside cross-origin iframe — the user's failing call
  const c1 = text(await handleCall('click', { ref: big.ref, quiet: true }))
  log('click', c1)
  check('C1 click-by-ref into OOPIF no error', c1.startsWith('clicked') && !c1.includes('cannot locate') && !c1.includes('fell back'), { c1 })
  let st = await (framesOf(guest).find((f) => (f.url || '').includes(String(PORT_EMBED)))).executeJavaScript(
    `(function(){return {big:document.getElementById('big').checked, evts:window.__evts, keys:window.__keys}})()`,
  )
  check('C2 OOPIF radio checked by trusted click', st.big === true && st.evts.some((e) => e.includes('true')), st)

  // click_xy on FillField center using snapshot box coords (top-viewport space)
  const cb = boxOf(fld.line)
  const c2 = text(await handleCall('click_xy', { x: cb.x + Math.floor(cb.w / 2), y: cb.y + Math.floor(cb.h / 2), quiet: true }))
  const focus1 = await (framesOf(guest).find((f) => (f.url || '').includes(String(PORT_EMBED)))).executeJavaScript(
    `(function(){var f=document.getElementById('fillme');return {focused:document.activeElement===f, evts:window.__evts.length}})()`,
  )
  check('X1 click_xy focuses OOPIF input', !c2.includes('fell back') && focus1.focused === true, { c2, focus1 })

  // type via production pipeline (insertText CDP primary) into OOPIF input
  const c3 = text(await handleCall('type', { text: '你好CDP', quiet: true }))
  const embedF = () => framesOf(guest).find((f) => (f.url || '').includes(String(PORT_EMBED)))
  const val1 = await embedF().executeJavaScript(`(function(){return document.getElementById('fillme').value})()`)
  check('T1 type reaches OOPIF input', val1 === '你好CDP', { c3, val1 })

  // press Tab routed to OOPIF (keydown recorded there)
  const c4 = text(await handleCall('press', { keys: 'Tab', quiet: true }))
  const keys = await embedF().executeJavaScript(`(function(){return window.__keys})()`)
  check('K1 press Tab reaches OOPIF', !c4.includes('fell back') && keys.includes('Tab'), { c4, keys })

  // wheel scroll at viewport center lands inside the OOPIF
  const before = await embedF().executeJavaScript(`(function(){scrollTo(0,0);return 1})()`)
  const c5 = text(await handleCall('scroll', { dy: 3, quiet: true }))
  await sleep(350)
  const sy = await embedF().executeJavaScript(`(function(){return Math.round(scrollY)})()`)
  check('W1 scroll moves OOPIF viewport', !c5.includes('fell back') && sy > 0, { c5, sy })

  // fill regression (DOM path still fine)
  const c6 = text(await handleCall('fill', { ref: (findRef(text(await handleCall('snapshot', { quiet: true })), 'FillField') || {}).ref, text: 'xyz', quiet: true }))
  const val2 = await embedF().executeJavaScript(`(function(){return document.getElementById('fillme').value})()`)
  check('F1 fill still works in frame', c6.startsWith('filled') && val2 === 'xyz', { c6, val2 })

  // main-frame click sanity (no regression on the previously-working path)
  const c7 = text(await handleCall('click', { ref: (findRef(text(await handleCall('snapshot', { quiet: true })), 'HostRadioB') || {}).ref, quiet: true }))
  const hb = await guest.mainFrame.executeJavaScript(`(function(){return document.getElementById('hrB').checked})()`)
  check('M1 main-frame click still works', c7.startsWith('clicked') && hb === true, { c7, hb })

  fs.writeFileSync(RESULT, JSON.stringify(out, null, 2))
  const failed = out.checks.filter((c) => !c.pass)
  console.log(failed.length ? 'E2E FAIL ' + failed.length : 'E2E ALL PASS')
  app.exit(failed.length ? 1 : 0)
}

app.whenReady().then(async () => {
  await mkServer(PORT_HOST, { '/': HOST_HTML })
  await mkServer(PORT_EMBED, { '/': EMBED_HTML })
  const win = new BrowserWindow({ width: 1150, height: 920, show: true, webPreferences: { webviewTag: true, contextIsolation: true } })
  let started = false
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return
    trackWebview(contents)
    contents.on('did-finish-load', async () => {
      if (started) return
      started = true
      await sleep(700)
      try {
        await run(contents)
      } catch (e) {
        log('RUNNER-ERROR', String((e && e.stack) || e))
        fs.writeFileSync(RESULT, JSON.stringify(out, null, 2))
        app.exit(3)
      }
    })
  })
  win.loadURL(`data:text/html,<!doctype html><html><body style="margin:0"><webview src="http://localhost:${PORT_HOST}/" style="width:1100px;height:880px;display:inline-flex"></webview></body></html>`)
  setTimeout(() => {
    log('WATCHDOG', 'timeout')
    try { fs.writeFileSync(RESULT, JSON.stringify(out, null, 2)) } catch (e) {}
    app.exit(2)
  }, 70000)
})
