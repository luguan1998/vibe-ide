const { app, BrowserWindow } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('enable-features', 'SiteIsolationForAll')

const RESULT = path.join(__dirname, 'result.json')
const out = { steps: [], t0: Date.now() }
function step(k, v) {
  out.steps.push([k, v])
  try { fs.writeFileSync(RESULT, JSON.stringify(out, null, 2)) } catch (e) {}
  console.log('STEP', k, JSON.stringify(v).slice(0, 500))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PORT_HOST = 8931
const PORT_EMBED = 8932

const HOST_HTML = `<!doctype html><html><body style="font-family:sans-serif">
<h3>host main frame</h3>
<label>host name <input id="hname" type="text"></label><br>
<input type="radio" name="hr" id="hrA" checked><label for="hrA">HostA</label>
<input type="radio" name="hr" id="hrB"><label for="hrB">HostB</label>
<script>
window.__evts = [];
window.addEventListener('mousedown', function(e){ window.__evts.push('down:'+e.target.tagName+':'+e.isTrusted) }, true);
window.addEventListener('click', function(e){ window.__evts.push('click:'+e.target.tagName+':'+e.isTrusted) }, true);
</script>
<iframe id="f" src="http://127.0.0.1:${PORT_EMBED}/embed.html" width="640" height="420" style="border:1px solid #888;display:block;margin-top:80px"></iframe>
<iframe id="f2" src="http://localhost:${PORT_HOST}/embed2.html" width="320" height="120" style="border:1px solid #a82;display:block;margin-top:10px"></iframe>
</body></html>`

const EMBED2_HTML = `<!doctype html><html><body style="font-family:sans-serif">
<input type="radio" name="so" id="soA" checked><label for="soA">SOA</label>
<input type="radio" name="so" id="soB"><label for="soB">SOB</label>
<script>
window.__evts = [];
window.addEventListener('mousedown', function(e){ window.__evts.push('down:'+e.target.tagName+':'+e.isTrusted) }, true);
window.addEventListener('click', function(e){ window.__evts.push('click:'+e.target.tagName+':'+e.isTrusted) }, true);
</script>
</body></html>`

const EMBED_HTML = `<!doctype html><html><body style="font-family:sans-serif">
<h4>cross-origin embed</h4>
<input type="radio" name="sz" value="medium" id="med">Medium<br>
<input type="radio" name="sz" value="large" id="big">Large<br>
<input type="text" id="fillme" style="margin-top:24px;width:200px"><br>
<button id="sb" onclick="window.__submitted=(window.__submitted||0)+1">Submit</button>
<div style="height:2400px;background:linear-gradient(#fff,#369)"></div>
<script>
window.__evts = [];
window.addEventListener('mousedown', function(e){ window.__evts.push('down:'+e.target.tagName+':'+e.isTrusted) }, true);
window.addEventListener('click', function(e){ window.__evts.push('click:'+e.target.tagName+':'+e.isTrusted) }, true);
</script>
</body></html>`

function mkServer(port, routes) {
  return new Promise((res) => {
    const s = http.createServer((req, r2) => {
      const html = routes[req.url.split('?')[0]] || routes[Object.keys(routes)[0]]
      r2.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      r2.end(html)
    })
    s.listen(port, '127.0.0.1', () => res(s))
  })
}

// ---------- verbatim logic from src/main/browser-use.ts ----------

function framesOf(c) {
  const res = []
  try {
    const mf = c.mainFrame
    if (!mf) return res
    res.push(mf)
    try {
      const sub = mf.framesInSubtree
      if (sub) for (const f of sub) if (f !== mf) res.push(f)
    } catch (e) { step('framesInSubtree-throw', String(e)) }
  } catch (e) { step('mainFrame-throw', String(e)) }
  return res
}

async function safeExec(f, js) {
  try { return { v: await f.executeJavaScript(js, false) } }
  catch (e) { return { err: String((e && e.message) || e) } }
}

function frameUrl(f) { try { return f.url || '' } catch (e) { return '<<throw:' + String(e) + '>>' } }

function normUrl(u) { try { const x = new URL(u); x.hash = ''; return x.href } catch (e) { return u } }

const FRAME_RECTS_FN = String.raw`(function () {
var out = [];
var els = document.querySelectorAll('iframe, frame');
for (var i = 0; i < els.length; i++) {
  var el = els[i];
  var r = el.getBoundingClientRect();
  out.push({ src: el.getAttribute('src') || '', href: el.src || '', name: el.getAttribute('name') || '', srcdoc: el.hasAttribute('srcdoc'), x: r.left, y: r.top, w: r.width, h: r.height });
}
return out;
})`

function matchHostRect(rects, want, raw, name, srcdoc, idx, childCount) {
  if (!rects.length) return null
  const exact = rects.filter((r) => normUrl(r.href || '') === want)
  if (exact.length) return exact[0]
  const bySrc = rects.filter((r) => r.src && (r.src === raw || normUrl(r.src) === want))
  if (bySrc.length) return bySrc[0]
  if (srcdoc) { const d = rects.find((r) => r.srcdoc); if (d) return d }
  if (want === 'about:blank/') { const b = rects.find((r) => !r.src); if (b) return b }
  if (name) { const n = rects.find((r) => r.name === name); if (n) return n }
  if (rects.length === childCount && idx >= 0 && idx < rects.length) return rects[idx]
  const vis = rects.find((r) => r.w || r.h)
  return vis || rects[0]
}

async function frameOffsetCss(c, f) {
  let ox = 0, oy = 0
  let cur = f
  const trace = []
  for (let hops = 0; hops < 16; hops++) {
    let parent = null
    try { parent = cur.parent } catch (e) { trace.push('parent-throw:' + String(e)); frameOffsetTrace = trace; return null }
    if (!parent) { trace.push('no-parent(done)'); frameOffsetTrace = trace; return { x: ox, y: oy } }
    const kids = []
    try { const sub = parent.frames; if (sub) for (const x of sub) kids.push(x) } catch (e) { trace.push('kids-throw:' + String(e)) }
    let childName = ''
    try { childName = cur.name || '' } catch (e) { trace.push('name-throw:' + String(e)) }
    const url = frameUrl(cur)
    const r = await safeExec(parent, '(' + FRAME_RECTS_FN + ')()')
    if (!Array.isArray(r.v)) { trace.push('rects-fail:' + JSON.stringify(r)); frameOffsetTrace = trace; return null }
    const hit = matchHostRect(r.v, normUrl(url), url.split('#')[0], childName, url.startsWith('about:srcdoc'), kids.indexOf(cur), kids.length)
    trace.push({ hop: hops, url, rects: r.v, idx: kids.indexOf(cur), childCount: kids.length, hit })
    if (!hit) { frameOffsetTrace = trace; return null }
    ox += Number(hit.x) || 0
    oy += Number(hit.y) || 0
    cur = parent
  }
  frameOffsetTrace = trace
  return { x: ox, y: oy }
}
let frameOffsetTrace = []

async function viewportCss(c) {
  try {
    const v = await c.executeJavaScript('({ w: innerWidth, h: innerHeight })')
    if (v && Number(v.w) > 0 && Number(v.h) > 0) return { w: Number(v.w), h: Number(v.h) }
  } catch (e) {}
  return { w: 800, h: 600 }
}

async function mouseClick(c, x, y, button, count) {
  const btn = button === 'right' ? 'right' : 'left'
  c.sendInputEvent({ type: 'mouseMove', x, y })
  await sleep(30)
  c.sendInputEvent({ type: 'mouseDown', x, y, button: btn, clickCount: 1 })
  await sleep(40)
  c.sendInputEvent({ type: 'mouseUp', x, y, button: btn, clickCount: 1 })
}

async function cdpClick(dbg, x, y) {
  await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
// ----------------------------------------------------------------

const READ_EMBED = `(function(){var big=document.getElementById('big');var med=document.getElementById('med');var f=document.getElementById('fillme');return {evts:window.__evts, bigChecked:big?big.checked:null, medChecked:med?med.checked:null, fillVal:f?f.value:null, submitted:window.__submitted||0}})()`
const READ_HOST = `(function(){var b=document.getElementById('hrB');return {evts:window.__evts, hostBChecked:b?b.checked:null}})()`

async function runExperiments(guest) {
  await sleep(500)
  const vp = await viewportCss(guest)
  step('viewport', vp)

  const frames = framesOf(guest)
  step('frame-urls', frames.map((f) => frameUrl(f)))
  const embed = frames.find((f) => frameUrl(f).includes(String(PORT_EMBED)))
  if (!embed) { step('FATAL', 'no embed frame found'); return }

  // WebFrameMain identity across repeated getters (affects kids.indexOf in matchHostRect)
  const mf = guest.mainFrame
  const a = mf.frames && mf.frames.length ? mf.frames[0] : null
  const b = mf.frames && mf.frames.length ? mf.frames[0] : null
  step('frame-identity-stable', { sameRef: a === b, aInSubtreeEqEmbed: a === embed })
  step('embed-frame-name', (() => { try { return embed.name } catch (e) { return '<<throw:' + String(e) + '>>' } })())

  // E2: frameOffsetCss on the cross-origin frame (the click-ref path's "cannot locate" suspect)
  const off = await frameOffsetCss(guest, embed)
  step('E2-frameOffsetCss', { off, trace: frameOffsetTrace })

  const clickFn = `(function(sel){var el=document.querySelector(sel);if(!el)return{lost:1};el.scrollIntoView({block:'center',inline:'center'});var r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})`

  // E6: main-frame control — click HostB radio at its main-frame rect via sendInputEvent
  {
    const pos = await mf.executeJavaScript(clickFn + `('#hrB')`)
    step('E6-host-pos', pos)
    if (pos && pos.w) {
      const r = await safeExec(mf, `(function(){window.__evts.length=0;return 1})()`)
      await mouseClick(guest, Math.round(pos.x), Math.round(pos.y), 'left', 1)
      await sleep(250)
      step('E6-host-after-sendInputEvent', await safeExec(mf, READ_HOST))
    }
  }

  // E3: iframe radio click via sendInputEvent at (local + offset) — replicates clickRef
  if (off) {
    const pos = await safeExec(embed, clickFn + `('#big')`)
    step('E3-embed-pos-local', pos)
    if (pos.v && pos.v.w) {
      await safeExec(embed, `(function(){window.__evts.length=0;return 1})()`)
      let x = Math.round(pos.v.x + off.x)
      let y = Math.round(pos.v.y + off.y)
      x = Math.max(0, Math.min(vp.w - 1, x)); y = Math.max(0, Math.min(vp.h - 1, y))
      step('E3-sendInputEvent-coords', { x, y })
      await mouseClick(guest, x, y, 'left', 1)
      await sleep(300)
      step('E3-embed-after-sendInputEvent', await safeExec(embed, READ_EMBED))
    }
  }

  // E3b: same-origin iframe radio at correct top coords via sendInputEvent (boundary check)
  {
    const pos = await safeExec(mf, `(function(){var f=document.getElementById('f2');var ir=f.getBoundingClientRect();var d=f.contentDocument;var r=d.getElementById('soB').getBoundingClientRect();return {x:ir.left+r.left+r.width/2,y:ir.top+r.top+r.height/2}})()`)
    step('E3b-so-pos', pos)
    if (pos.v) {
      await safeExec(mf, `(function(){document.getElementById('f2').contentWindow.__evts.length=0;return 1})()`)
      await mouseClick(guest, Math.round(pos.v.x), Math.round(pos.v.y), 'left', 1)
      await sleep(300)
      step('E3b-so-after', await safeExec(mf, `(function(){var d=document.getElementById('f2').contentDocument;return {soB:d.getElementById('soB').checked, evts:document.getElementById('f2').contentWindow.__evts}})()`))
    }
  }

  // E4: same coords via CDP Input.dispatchMouseEvent on guest debugger
  const dbg = guest.debugger
  if (!dbg) { step('E4', 'no debugger on guest'); return }
  let attached = false
  try { dbg.attach('1.3'); attached = true; step('E4-attach', 'ok') }
  catch (e) { step('E4-attach-FAIL', String((e && e.message) || e)) }
  if (attached) {
    try {
      const tt = await dbg.sendCommand('Target.getTargets')
      step('E5-targets', (tt.targetInfos || []).map((t) => ({ type: t.type, url: (t.url || '').slice(0, 60) })))
    } catch (e) { step('E5-targets-FAIL', String(e)) }

    if (off) {
      const pos = await safeExec(embed, clickFn + `('#big')`)
      if (pos.v && pos.v.w) {
        let x = Math.round(pos.v.x + off.x)
        let y = Math.round(pos.v.y + off.y)
        x = Math.max(0, Math.min(vp.w - 1, x)); y = Math.max(0, Math.min(vp.h - 1, y))
        await safeExec(embed, `(function(){window.__evts.length=0;return 1})()`)
        try {
          await cdpClick(dbg, x, y)
          step('E4-cdp-click-dispatched', { x, y })
        } catch (e) { step('E4-cdp-click-FAIL', String(e)) }
        await sleep(300)
        step('E4-embed-after-cdpClick', await safeExec(embed, READ_EMBED))

        // E-submit: CDP click the Submit button, then check frame url + handler ran
        const pos2 = await safeExec(embed, clickFn + `('#sb')`)
        if (pos2.v && pos2.v.w) {
          let x2 = Math.round(pos2.v.x + off.x), y2 = Math.round(pos2.v.y + off.y)
          x2 = Math.max(0, Math.min(vp.w - 1, x2)); y2 = Math.max(0, Math.min(vp.h - 1, y2))
          await safeExec(embed, `(function(){window.__evts.length=0;return 1})()`)
          try { await cdpClick(dbg, x2, y2); step('E-submit-clicked', { x: x2, y: y2 }) } catch (e) { step('E-submit-FAIL', String(e)) }
          await sleep(400)
          step('E-submit-embed-after', await safeExec(embed, READ_EMBED))
          step('E-submit-frame-url', frameUrl(embed))
        }
      }
    }

    // E7: keyboard into iframe input after programmatic focus (user says type works)
    await safeExec(embed, `(function(){var f=document.getElementById('fillme');f.focus();f.value='';return 1})()`)
    try {
      guest.sendInputEvent({ type: 'char', keyCode: 'k' })
      await sleep(50)
      guest.sendInputEvent({ type: 'keyDown', keyCode: 'A' })
      await sleep(20)
      guest.sendInputEvent({ type: 'keyUp', keyCode: 'A' })
      step('E7-keys-sent', 'ok')
    } catch (e) { step('E7-keys-FAIL', String(e)) }
    await sleep(250)
    step('E7-embed-after-keys', await safeExec(embed, READ_EMBED))

    // E7b: full loop in OOPIF — CDP trusted click focuses input, then sendInputEvent char vs CDP insertText
    const posF = await safeExec(embed, clickFn + `('#fillme')`)
    if (off && posF.v && posF.v.w) {
      let fx = Math.max(0, Math.min(vp.w - 1, Math.round(posF.v.x + off.x)))
      let fy = Math.max(0, Math.min(vp.h - 1, Math.round(posF.v.y + off.y)))
      await safeExec(embed, `(function(){window.__evts.length=0;var f=document.getElementById('fillme');f.value='';if(f.blur)f.blur();return 1})()`)
      try { await cdpClick(dbg, fx, fy) } catch (e) { step('E7b-cdpclick-FAIL', String(e)) }
      await sleep(200)
      step('E7b-after-cdpclick', await safeExec(embed, `(function(){var f=document.getElementById('fillme');return {focused:document.activeElement===f, evts:window.__evts}})()`))
      try { guest.sendInputEvent({ type: 'char', keyCode: 'k' }) } catch (e) { step('E7b-sendchar-FAIL', String(e)) }
      await sleep(120)
      step('E7b-after-sendchar', await safeExec(embed, `(function(){return {fillVal:document.getElementById('fillme').value}})()`))
      try { await dbg.sendCommand('Input.insertText', { text: 'CDP' }) } catch (e) { step('E7b-insertText-FAIL', String(e)) }
      await sleep(150)
      step('E7b-after-insertText', await safeExec(embed, `(function(){return {fillVal:document.getElementById('fillme').value}})()`))
    }

    // E8: zoom 1.5 — does CDP expect the same (CSS*zoom) DIP coords as sendInputEvent?
    try { guest.setZoomFactor(1.5) } catch (e) { step('E8-setZoom-FAIL', String(e)) }
    await sleep(400)
    {
      const off8 = await frameOffsetCss(guest, embed)
      const vp8 = await viewportCss(guest)
      const z8 = await guest.getZoomFactor()
      const pos8 = await safeExec(embed, clickFn + `('#med')`)
      step('E8-pre', { off8, vp8, z8, pos8: pos8.v })
      if (off8 && pos8.v && pos8.v.w) {
        await safeExec(embed, `(function(){document.getElementById('big').checked=false;window.__evts.length=0;return 1})()`)
        let x = Math.max(0, Math.min(vp8.w - 1, Math.round(pos8.v.x + off8.x)))
        let y = Math.max(0, Math.min(vp8.h - 1, Math.round(pos8.v.y + off8.y)))
        const xs = Math.round(x * z8), ys = Math.round(y * z8)
        try { await cdpClick(dbg, xs, ys) } catch (e) { step('E8-cdp-scaled-FAIL', String(e)) }
        await sleep(250)
        step('E8-cdp-click-scaled-css*z', { xs, ys, res: (await safeExec(embed, READ_EMBED)).v })
        // control: same point WITHOUT zoom scaling — should MISS #med if DIP is the right space
        try { await cdpClick(dbg, x, y) } catch (e) { step('E8b-cdp-unscaled-FAIL', String(e)) }
        await sleep(250)
        step('E8b-cdp-click-unscaled', { x, y, res: (await safeExec(embed, READ_EMBED)).v })
      }
    }

    // E9: CDP mouseWheel inside OOPIF (zoom back to 1)
    try { guest.setZoomFactor(1) } catch (e) {}
    await sleep(300)
    {
      const off9 = await frameOffsetCss(guest, embed)
      const pos9 = await safeExec(embed, `(function(){return {x:innerWidth/2,y:innerHeight/2}})()`)
      if (off9 && pos9.v) {
        const x = Math.round(pos9.v.x + off9.x), y = Math.round(pos9.v.y + off9.y)
        await safeExec(embed, `(function(){scrollTo(0,0);return 1})()`)
        try { await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 300 }) } catch (e) { step('E9-wheel-FAIL', String(e)) }
        await sleep(250)
        step('E9-embed-scrollY-after-cdpWheel', await safeExec(embed, `(function(){return {scrollY:Math.round(scrollY)}})()`))
      }
    }

    try { dbg.detach() } catch (e) {}
  }
}

let guestSeen = null

app.whenReady().then(async () => {
  step('electron', process.versions.electron + ' chrome ' + process.versions.chrome + ' site-per-process-on')
  await mkServer(PORT_HOST, { '/host.html': HOST_HTML, '/embed2.html': EMBED2_HTML })
  await mkServer(PORT_EMBED, { '/embed.html': EMBED_HTML })
  step('servers', 'up')

  const win = new BrowserWindow({
    width: 1150, height: 920, show: true,
    webPreferences: { webviewTag: true, nodeIntegration: false, contextIsolation: true },
  })
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'webview') {
      guestSeen = contents
      contents.on('did-finish-load', () => { if (!guestSeen.__ran) { guestSeen.__ran = true; runExperiments(contents).then(() => { step('DONE', true); setTimeout(() => app.exit(0), 400) }) } })
    }
  })
  const hostUrl = 'http://localhost:' + PORT_HOST + '/host.html'
  win.loadURL(`data:text/html,<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><webview src="${hostUrl}" style="width:1100px;height:880px;display:inline-flex" id="wv"></webview></body></html>`)

  setTimeout(() => { step('WATCHDOG', 'timeout'); try { fs.writeFileSync(RESULT, JSON.stringify(out, null, 2)) } catch (e) {} app.exit(2) }, 40000)
})
