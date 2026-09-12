/**
 * 探针：首次打开 Monaco 编辑器时的高亮时间线
 *
 * 测量：点击文件 → 编辑器首帧文字出现 → 语法高亮（着色 span）出现
 * 同时采集：长任务、语言 chunk 加载、模型创建、tokenizeViewport 耗时、worker 创建
 *
 * 用法：node test/probe-first-open.mjs [--file=code.py] [--target=renderer|out]
 */

import { spawn, execSync } from 'child_process'
import { join, resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'

const projectRoot = resolve(import.meta.dirname, '..')
const fileArg = process.argv.find(a => a.startsWith('--file='))?.split('=')[1] || 'code.py'
const target = process.argv.find(a => a.startsWith('--target='))?.split('=')[1] || 'renderer'
const workspace = join(projectRoot, 'test', 'icon-test')
const cdpPort = 9223
const userDataDir = join(tmpdir(), 'vibe-ide-probe')
mkdirSync(userDataDir, { recursive: true })

// ─── CDP 基础设施 ───
async function connectCDP(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await resp.json()
  const pageTarget = targets.find(t => t.type === 'page' && !t.url.includes('devtools'))
  if (!pageTarget) throw new Error('No renderer target')
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
    setTimeout(() => rej(new Error('WS timeout')), 5000)
  })
  let id = 0
  const pending = new Map()
  const logs = []
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id) }
    else if (data.method === 'Runtime.consoleAPICalled') {
      logs.push(data.params.args.map(a => a.value ?? a.description ?? '').join(' '))
    }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id
    pending.set(msgId, res)
    ws.send(JSON.stringify({ id: msgId, method, params }))
    setTimeout(() => { pending.delete(msgId); rej(new Error(`CDP ${method} timeout`)) }, 90000)
  })
  return { send, close: () => ws.close(), logs }
}

async function evalIn(cdp, expression) {
  const resp = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (resp.result?.exceptionDetails) throw new Error(resp.result.exceptionDetails.text + ' ' + JSON.stringify(resp.result.exceptionDetails.exception?.description || ''))
  return resp.result?.result?.value
}

function dumpProfile(profile, windowStart, windowEnd) {
  if (!profile) { console.log('（无 CPU profile）'); return }
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const samples = profile.samples || []
  const deltas = profile.timeDeltas || []
  if (!samples.length) { console.log('（profile 无采样）'); return }

  // 按 timeDelta 累积出每个采样的绝对时间（profile 时间轴为 µs）
  let t = profile.startTime
  const inWindow = []   // {nodeId, durMs}
  for (let i = 0; i < samples.length; i++) {
    const durMs = (deltas[i] || 0) / 1000
    const startMs = t / 1000
    t += deltas[i] || 0
    if (windowStart != null && windowEnd != null) {
      if (startMs < windowStart || startMs > windowEnd) continue
    }
    inWindow.push({ id: samples[i], durMs })
  }
  const totalMs = inWindow.reduce((a, s) => a + s.durMs, 0)
  if (totalMs < 1) { console.log('（窗口内无采样）'); return }

  const agg = new Map()
  const aggSelf = new Map()
  for (const s of inWindow) {
    const n = byId.get(s.id)
    if (!n) continue
    const cf = n.callFrame
    const file = (cf.url || '').split('/').pop() || '(native)'
    const key = `${cf.functionName || '(anon)'} @ ${file}:${(cf.lineNumber + 1)}`
    agg.set(key, (agg.get(key) || 0) + s.durMs)
    // 便于归组：顶层文件
    aggSelf.set(file, (aggSelf.get(file) || 0) + s.durMs)
  }
  const sorted = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log(`\n── CPU profile（窗口 ${windowStart?.toFixed(0)}→${windowEnd?.toFixed(0)}ms，窗口内 CPU=${totalMs.toFixed(0)}ms）Top 25 ──`)
  for (const [k, ms] of sorted) {
    console.log(`  ${String(ms.toFixed(1)).padStart(7)}ms ${String(((ms / totalMs) * 100).toFixed(1)).padStart(5)}%  ${k}`)
  }
  console.log('  ── 按文件归组 ──')
  for (const [k, ms] of [...aggSelf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(ms.toFixed(1)).padStart(7)}ms ${String(((ms / totalMs) * 100).toFixed(1)).padStart(5)}%  ${k}`)
  }
}

async function click(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

// ─── 注入探针 ───
const PROBE = String.raw`
(() => {
window.__probe = { events: [], longTasks: [], chunks: [], t0: performance.now(), clickT: null, hlEnd: null, ss: [] }
const ev = (name, extra = {}) => window.__probe.events.push({ name, t: performance.now(), ...extra })

// 1) 长任务
try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      if (e.duration > 20) window.__probe.longTasks.push({ t: e.startTime, d: e.duration, name: e.name })
    }
  }).observe({ type: 'longtask', buffered: true })
} catch {}

// 2) 语言 chunk 加载（monaco 懒加载 grammar 走 vite preload）
window.addEventListener('vite:preloadError', e => ev('preload-error', { url: String(e.payload) }), true)

// 3) 语言 grammar 懒加载 chunk 的加载耗时（monaco 的 dynamic import 在 dev 走 http，prod 走 file）
window.__armNetProbe = () => {
  if (window.__probe.netProbe) return 'already'
  window.__probe.netProbe = true
  const origFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url || String(input))
    const t = performance.now()
    ev('fetch-start', { url: url.split('/').pop().slice(0, 60) })
    const r = origFetch(input, init)
    r.then(() => ev('fetch-end', { url: url.split('/').pop().slice(0, 60), ms: +(performance.now() - t).toFixed(1) })).catch(() => {})
    return r
  }
  const OrigXHR = window.XMLHttpRequest
  window.XMLHttpRequest = class extends OrigXHR {
    open(method, url, ...rest) {
      this.__url = String(url)
      const self = this
      this.addEventListener('loadend', () => ev('xhr-end', { url: String(self.__url).split('/').pop().slice(0, 60), ms: +(performance.now() - self.__t0).toFixed(1) }))
      this.__t0 = performance.now()
      return super.open(method, url, ...rest)
    }
  }
  return 'net-probe-armed'
}

// 4) worker 创建
const OrigWorker = window.Worker
window.Worker = new Proxy(OrigWorker, {
  construct(target, args) {
    ev('worker-new', { url: String(args[0]).split('/').pop() })
    const w = new target(...args)
    const origPost = w.postMessage.bind(w)
    w.postMessage = function (msg, ...rest) {
      // CDP 序列化后是 JSON 字符串形式，内容可读，仅用于找特征方法名
      const s = typeof msg === 'string' ? msg : ''
      const m = s.match(/"method":"([^"]+)"/)
      ev('worker-req', { m: m ? m[1] : '?', len: s.length })
      return origPost(msg, ...rest)
    }
    return w
  }
})

// 6) 真实点击时间戳（capture 阶段拿 mousedown）
window.addEventListener('pointerdown', () => { window.__probe.clickT = performance.now() }, true)
window.addEventListener('mousedown', () => { if (!window.__probe.clickT) window.__probe.clickT = performance.now() }, true)

// 4.5) rAF 采样：逐帧记录「已渲染字符数 / 非默认样式字符数」
// 未 tokenize 时全部 span 是 mtk1（默认前景色）；tokenize 落地后出现 mtk≠1
window.__startSampling = () => {
  const samples = []
  window.__probe.samples = samples
  const count = (sel) => {
    let chars = 0
    for (const el of document.querySelectorAll(sel)) chars += (el.textContent || '').length
    return chars
  }
  const tick = () => {
    const spans = document.querySelectorAll('.view-line span')
    let chars = 0, styledChars = 0
    for (const s of spans) {
      const len = (s.textContent || '').length
      chars += len
      if (!s.classList.contains('mtk1')) styledChars += len
    }
    samples.push({ t: +(performance.now()).toFixed(0), lines: document.querySelectorAll('.view-line').length, chars, styledChars })
    if (samples.length < 600) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return 'sampling'
}

// 4.6) 点击后等待：出现任意非 mtk1 样式的字符（高亮落地）
window.__awaitHighlight = (_clickT, timeoutMs = 5000) => new Promise(resolve => {
  const start = performance.now()
  const check = () => {
    const spans = document.querySelectorAll('.view-line span')
    let styled = 0, chars = 0, lines = document.querySelectorAll('.view-line').length
    for (const s of spans) { const l = (s.textContent || '').length; chars += l; if (!s.classList.contains('mtk1')) styled += l }
    const found = styled > 0
    if (found || performance.now() - start > timeoutMs) {
      const at = +(performance.now()).toFixed(0)
      window.__probe.hlEnd = at
      resolve({ found, at, styledChars: styled, chars, lines })
    } else requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
})

// 5) DOM：提前挂 observer（编辑器还没创建）
// monaco 用 mtk* class 而非 inline style：tokenizer 未就绪时全部是同一个默认 class，
// 高亮到达时 span 的 class 变成多个不同 mtk*（onDidChangeTokens → 重新 paint）
window.__armCenterObserver = () => {
  const st = { firstLine: null, firstMultiClass: null, classSnapshots: [], mutations: 0, armedAt: performance.now() }
  window.__probe.dom = st
  const snapshot = (why) => {
    const spans = document.querySelectorAll('.view-line span')
    if (!spans.length) return null
    const cls = new Set()
    for (const s of spans) cls.add(s.className)
    st.classSnapshots.push({ why, t: +(performance.now()).toFixed(0), uniq: [...cls].slice(0, 8), n: spans.length })
    if (cls.size > 1 && !st.firstMultiClass) st.firstMultiClass = performance.now()
    return cls.size
  }
  window.__probe.snapshot = snapshot
  const mo = new MutationObserver(muts => {
    st.mutations++
    for (const mu of muts) {
      for (const node of mu.addedNodes) {
        if (node.nodeType !== 1) continue
        if (!st.firstLine && (node.classList?.contains('view-line') || node.querySelector?.('.view-line'))) {
          st.firstLine = performance.now()
          snapshot('first-line')
        }
      }
      if (mu.type === 'attributes' && mu.target?.closest?.('.view-line')) {
        if (!st.firstMultiClass) snapshot('attr-change')
      }
    }
  })
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  return 'armed@' + Math.round(st.armedAt)
}
})()
`

async function main() {
  const electronExe = process.platform === 'win32'
    ? join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : join(projectRoot, 'node_modules', 'electron', 'dist', 'electron')

  const attachPort = parseInt(process.argv.find(a => a.startsWith('--attach='))?.split('=')[1] || '0', 10)
  let proc = null
  let cdp = null

  if (attachPort) {
    console.log(`附着到已运行实例 CDP ${attachPort}...`)
    for (let i = 0; i < 10; i++) {
      try { cdp = await connectCDP(attachPort); break } catch { await new Promise(r => setTimeout(r, 1000)) }
    }
    if (!cdp) { console.error('附着失败'); process.exit(1) }
  } else {
    const env = { ...process.env, ELECTRON_IS_DEV: '0' }
    delete env.ELECTRON_RENDERER_URL
    const args = [
      `--remote-debugging-port=${cdpPort}`, '--enable-precise-memory-info',
      '--no-sandbox', `--user-data-dir=${userDataDir}`, projectRoot, workspace
    ]
    console.log(`启动 Electron (target=${target}, file=${fileArg})...`)
    proc = spawn(electronExe, args, { stdio: 'pipe', env })
    proc.stderr?.on('data', d => {
      const s = d.toString()
      if (s.includes('ERROR') || s.includes('fallback') || s.includes('Could not create')) process.stderr.write('[stderr] ' + d)
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 1000))
      try { cdp = await connectCDP(cdpPort); break } catch {}
    }
    if (!cdp) { console.error('启动超时'); proc.kill(); process.exit(1) }
  }
  console.log('已连接 CDP')
  await cdp.send('Runtime.enable')

  // 等 API
  for (let i = 0; i < 30; i++) {
    if (await evalIn(cdp, `!!window.api?.workspace`).catch(() => false)) break
    await new Promise(r => setTimeout(r, 500))
  }
  console.log('API 就绪，注入探针...')
  await evalIn(cdp, PROBE)
  await evalIn(cdp, `window.__armNetProbe()`)
  await new Promise(r => setTimeout(r, 1500))

  // 切到 File tab
  const fileTab = await evalIn(cdp, `(() => {
    for (const btn of document.querySelectorAll('button')) {
      const sp = btn.querySelector('span')
      if (sp && (sp.textContent === 'Dir') || btn.title === 'Dir') {
        const r = btn.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }
      }
    }
    return null })()`)
  if (!fileTab) { console.error('找不到 File tab'); cdp.close(); proc?.kill(); process.exit(1) }
  await click(cdp, fileTab.x, fileTab.y)
  await new Promise(r => setTimeout(r, 1200))

  // 找目标文件行
  const item = await evalIn(cdp, `(() => {
    const rows = document.querySelectorAll('div.cursor-pointer')
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (rect.height === 0 || rect.x < 900) continue
      const fc = row.children[0]
      if (!(fc && fc.tagName === 'SPAN' && fc.classList.contains('w-3'))) continue
      const name = row.textContent?.trim() || ''
      if (name.includes(${JSON.stringify(fileArg)})) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, name }
    }
    return null })()`)
  if (!item) { console.error('找不到文件项', fileArg); cdp.close(); proc?.kill(); process.exit(1) }
  console.log(`点击文件: ${item.name}`)

  // arm observer + 采样 + 点击（点击时间戳由 capture 阶段的 pointerdown 记录）
  const armed = await evalIn(cdp, `window.__armCenterObserver()`)
  console.log('observer:', armed)
  await evalIn(cdp, `window.__probe.clickT = null`)
  await evalIn(cdp, `window.__startSampling()`)
  await evalIn(cdp, `(() => {
    const S = []
    window.__probe.ss = S
    let i = 0
    const loop = (ts) => {
      const spans = document.querySelectorAll('.view-line span')
      let chars = 0, styled = 0
      for (const s of spans) { const l = (s.textContent || '').length; chars += l; if (!s.classList.contains('mtk1')) styled += l }
      S.push({ ts: +(ts).toFixed(1), now: +(performance.now()).toFixed(1), frames: i, lines: document.querySelectorAll('.view-line').length, spans: spans.length, chars, styled, click: window.__probe.clickT })
      if (++i < 500) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })()`)

  // CPU profile：覆盖点击 → 高亮落地窗口
  try {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    const started = await cdp.send('Profiler.start')
    if (started?.error) console.log('Profiler.start error:', JSON.stringify(started.error))
  } catch (e) { console.log('Profiler 启动失败:', e.message) }
  await click(cdp, item.x, item.y)

  // 等待首个「多类名帧」出现（高亮到位），渲染端 rAF 循环内计时
  const hl = await evalIn(cdp, `window.__awaitHighlight()`)
  const clickWinStart = await evalIn(cdp, `window.__probe.clickT`)
  const clickWinEnd = await evalIn(cdp, `window.__probe.hlEnd || null`)
  try {
    const prof = await cdp.send('Profiler.stop')
    const profile = prof?.result?.profile
    if (!profile) console.log('Profiler.stop 无 profile:', JSON.stringify(prof).slice(0, 300))
    else dumpProfile(profile, clickWinStart, clickWinEnd)
  } catch (e) { console.log('Profiler.stop 失败:', e.message) }
  const result = await evalIn(cdp, `(() => {
    const p = window.__probe, d = p.dom || {}
    return {
      clickT: p.clickT, firstLine: d.firstLine,
      samples: p.samples.slice(0, 120),
      editorCount: document.querySelectorAll('.monaco-editor').length,
      viewLines: document.querySelectorAll('.view-line').length
    } })()`)
  const events = await evalIn(cdp, `window.__probe.events`)
  const longTasks = await evalIn(cdp, `window.__probe.longTasks`)
  const clickTs = result?.clickT

  console.log('\n════════ 结果 ════════')
  console.log('高亮探测:', JSON.stringify(hl))
  console.log('首帧文字:', result?.firstLine && clickTs ? `+${Math.round(result.firstLine - clickTs)}ms` : 'n/a')
  if (hl?.found && clickTs) console.log(`>>> 高亮到位: +${Math.round(hl.at - clickTs)}ms  延迟=${clickTs && result?.firstLine ? Math.round(hl.at - result.firstLine) : '?'}ms（相对首帧）`)
  else console.log('>>> 5s 内未见多样化 class（高亮未出现）')

  const ss = await evalIn(cdp, `window.__probe.ss`)
  console.log('\n── rAF 帧记录（相对点击，仅显示状态变化，带帧间隔）──')
  let prev = '', prevTs = null
  for (const s of ss || []) {
    const key = `${s.chars}/${s.styled}/${s.lines}/${s.spans}`
    if (key !== prev) {
      const tClick = s.click ? Math.round(s.now - s.click) : null
      const gap = prevTs != null ? Math.round(s.ts - prevTs) : 0
      console.log(`  frame=${String(s.frames).padStart(3)}  rAF=${s.ts}  ${tClick != null ? `点击后+${String(tClick).padStart(5)}ms` : ''}  gap=${gap}ms  lines=${s.lines} spans=${s.spans} chars=${s.chars} styled=${s.styled}`)
      prev = key
    }
    prevTs = s.ts
  }
  console.log('\n── 事件时间线（相对真实点击）──')
  for (const e of events) {
    const dt = clickTs ? `+${Math.round(e.t - clickTs)}ms` : `t=${Math.round(e.t)}`
    console.log(`  ${dt.padStart(9)}  ${e.name}  ${JSON.stringify({ ...e, t: undefined, name: undefined })}`)
  }
  console.log('\n── 长任务（>20ms，含启动期）──')
  for (const lt of longTasks.slice(-30)) console.log(`  t=${Math.round(lt.t)}ms d=${Math.round(lt.d)}ms`)

  cdp.close()
  proc?.kill()
  setTimeout(() => process.exit(0), 500)
}

main().catch(e => { console.error('probe 失败:', e); process.exit(1) })
