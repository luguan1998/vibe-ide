// Causal test: do the app's perpetual CSS animations (shimmer/glow/sprite-steps) grow renderer memory?
// Usage: node scripts/probe-anim-growth.mjs [port] [spriteWebpPath]
import { readFileSync } from 'fs'
const port = Number(process.argv[2] || 9227)
const spritePath = process.argv[3] || 'E:/ai/claudeui/dist/Vibe IDE-x64/pets/default/spritesheet.webp'
const MB = n => (n / 1024 / 1024).toFixed(1)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function connect() {
  let t
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      t = targets.find(x => x.type === 'page' && x.url.includes('renderer'))
      if (t) break
    } catch {}
    await sleep(1000)
  }
  if (!t) throw new Error('no target')
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  return {
    send: (m, p = {}) => new Promise((res, rej) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method: m, params: p }))
      setTimeout(() => rej(new Error('timeout ' + m)), 60000)
    }),
    close: () => ws.close(),
  }
}
async function ev(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}
async function mem(cdp) {
  const s = await ev(cdp, `window.api.perf.snapshot()`)
  const tabs = (s.appMetrics || []).filter(m => m.type === 'Tab').sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)
  const gpu = (s.appMetrics || []).find(m => m.type === 'GPU')
  const heap = await ev(cdp, `performance.memory ? performance.memory.usedJSHeapSize : 0`)
  return { r: (tabs[0]?.memory.workingSetSize || 0) / 1024, g: gpu ? gpu.memory.workingSetSize / 1024 : 0, h: heap / 1048576 }
}

async function sample(cdp, label, seconds, every = 15) {
  const pts = []
  for (let t = 0; t <= seconds; t += every) {
    const m = await mem(cdp)
    pts.push({ t, ...m })
    console.log(`  [${label} ${String(t).padStart(3)}s] renderer=${MB(m.r * 1048576)}MB gpu=${MB(m.g * 1048576)}MB heap=${m.h.toFixed(1)}MB`)
    if (t < seconds) await sleep(every * 1000)
  }
  const first = pts[0], last = pts[pts.length - 1]
  const dt = (last.t - first.t) || 1
  console.log(`  => ${label}: renderer ${(last.r - first.r >= 0 ? '+' : '')}${(last.r - first.r).toFixed(1)}MB over ${dt}s (${((last.r - first.r) / dt).toFixed(2)} MB/s)`)
  return (last.r - first.r) / dt
}

async function main() {
  const cdp = await connect()
  await sleep(8000)
  console.log('=== phase 1: idle baseline (60s) ===')
  await sample(cdp, 'idle', 60)

  const b64 = readFileSync(spritePath).toString('base64')
  console.log('\ninjecting animations (app CSS classes + sprite steps)...')
  const info = await ev(cdp, `(async () => {
    const b64 = ${JSON.stringify(b64)};
    const url = 'data:image/webp;base64,' + b64;
    const im = new Image(); im.src = url; await im.decode();
    const d = document.createElement('div');
    d.id = 'anim-probe';
    d.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:500px;z-index:99999;background:#222;overflow:hidden;';
    const line = '会话名称进度提示日志信息 '.repeat(10);
    d.innerHTML = '<div class="animate-text-wave" style="font-size:28px;">' + line + '</div>'
      + '<div class="claude-shimmer-text" style="font-size:24px;">Running tool name shimmer text repeated repeated repeated</div>'
      + '<span class="animate-zap-glow" style="font-size:34px;">&#9889;</span>'
      + '<span class="animate-color-pulse" style="font-size:34px;">&#10022;</span>'
      + '<span class="animate-spin-pixel" style="font-size:24px;">*</span>'
      + '<div id="pet-probe" style="width:220px;height:220px;background-repeat:no-repeat;"></div>';
    document.body.appendChild(d);
    const st = document.createElement('style');
    st.textContent = '@keyframes petprobe { from { background-position: 0px 0px; } to { background-position: ' + (-(im.naturalWidth - 220)) + 'px 0px; } }';
    document.head.appendChild(st);
    const el = d.querySelector('#pet-probe');
    el.style.backgroundImage = 'url(' + url + ')';
    el.style.backgroundSize = im.naturalWidth + 'px ' + im.naturalHeight + 'px';
    el.style.animation = 'petprobe 1.6s steps(6) infinite';
    return { w: im.naturalWidth, h: im.naturalHeight, anims: document.getAnimations().length };
  })()`)
  console.log('  sprite natural size:', info.w + 'x' + info.h, ' running animations now:', info.anims)

  console.log('\n=== phase 2: with animations (120s) ===')
  await sample(cdp, 'anim', 120)

  console.log('\nremoving injection...')
  await ev(cdp, `(document.getElementById('anim-probe')?.remove(), true)`)
  console.log('=== phase 3: after removal (30s) ===')
  await sample(cdp, 'after', 30)
  cdp.close()
}
main().catch(e => { console.error(e); process.exit(1) })
