/**
 * 内存分布实测：起 out/ 构建产物（独立 user-data-dir / CDP 端口）
 * 采集 idle → 多 session → 大终端输出 三个阶段的各进程内存
 * 用法: node test/mem-probe.mjs
 */
import { spawn, execSync } from 'child_process'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, writeFileSync } from 'fs'

const projectRoot = resolve(import.meta.dirname, '..')
const cdpPort = 9224
const userDataDir = join(tmpdir(), 'vibe-ide-memprobe')
mkdirSync(userDataDir, { recursive: true })
const workspace = join(projectRoot, 'test', 'icon-test')

if (!existsSync(join(projectRoot, 'out', 'main', 'index.js'))) {
  console.error('out/ 不存在,先 npm run build')
  process.exit(1)
}

// ─── CDP ───
async function connectCDP(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json`)
      const targets = await resp.json()
      const pageTarget = targets.find(t => t.type === 'page' && !t.url.includes('devtools'))
      if (!pageTarget) throw new Error('no page target')
      const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('ws timeout')), 5000) })
      let id = 0
      const pending = new Map()
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id) }
      }
      return {
        send: (method, params = {}) => new Promise((res, rej) => {
          const msgId = ++id
          pending.set(msgId, res)
          ws.send(JSON.stringify({ id: msgId, method, params }))
          setTimeout(() => { pending.delete(msgId); rej(new Error(method + ' timeout')) }, 15000)
        }),
        close: () => ws.close()
      }
    } catch { await new Promise(r => setTimeout(r, 1000)) }
  }
  throw new Error('CDP connect failed')
}

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('eval err: ' + (r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails)))
  return r.result?.result?.value
}

// ─── OS 进程树内存 (Windows PowerShell, 写临时 ps1 避免 -Command 转义/编码问题) ───
function procTree(rootPid) {
  if (process.platform !== 'win32') return []
  const ps1 = join(tmpdir(), 'vibe-mem-tree.ps1')
  writeFileSync(ps1, `
$pid0 = ${rootPid}
$Result = New-Object System.Collections.ArrayList
$depth = @{${rootPid}=0}
function Walk($p) {
  $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p }
  foreach ($c in $children) {
    $depth[$c.ProcessId] = $depth[$p] + 1
    [void]$Result.Add([PSCustomObject]@{ pid=$c.ProcessId; depth=$depth[$c.ProcessId]; name=$c.Name; ws=$c.WorkingSetSize })
    Walk $c.ProcessId
  }
}
Walk ${rootPid}
$Result | ForEach-Object { "{0}|{1}|{2}|{3}" -f $_.pid, $_.depth, $_.name, $_.ws }
`)
  try {
    return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -OutputFormat Text -File "${ps1}"`, { timeout: 20000, encoding: 'utf8' })
      .toString().split(/\r?\n/).filter(Boolean).map(l => {
        const [pid, dp, name, ws] = l.split('|')
        return { pid: Number(pid), depth: Number(dp), name, wsKB: Math.round(Number(ws) / 1024) }
      })
  } catch (e) { console.error('procTree err', e.message.slice(0, 200)); return [] }
}

// ─── 采集 ───
async function snapshot(cdp, mainPid, label) {
  await evalIn(cdp, `new Promise(r => setTimeout(r, 800))`)
  const main = await evalIn(cdp, `window.api.perf.snapshot()`)
  const renderer = await evalIn(cdp, `performance.memory ? {
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
  } : null`)
  const tabMetrics = (main.appMetrics || []).filter(m => m.type === 'Tab').sort((a, b) => b.memory?.workingSetSize - a.memory?.workingSetSize)
  const gpuMetric = (main.appMetrics || []).find(m => m.type === 'GPU')
  const tree = procTree(mainPid)
  const dshNode = tree.find(t => /^node/i.test(t.name)) || null
  const shells = tree.filter(t => /pwsh|cmd|powershell|bash|sh\.exe|conhost/i.test(t.name))
  const line = [
    `[${label}]`,
    `  主进程 heap=${(main.memory.heapUsed / 1048576).toFixed(0)}MB rss=${(main.memory.rss / 1048576).toFixed(0)}MB`,
    `  渲染 usedJSHeap=${(renderer.usedJSHeapSize / 1048576).toFixed(0)}MB totalJSHeap=${(renderer.totalJSHeapSize / 1048576).toFixed(0)}MB`,
    `  renderer WS=${tabMetrics[0] ? Math.round(tabMetrics[0].memory.workingSetSize / 1024) : '?'}MB  GPU WS=${gpuMetric ? Math.round(gpuMetric.memory.workingSetSize / 1024) : '?'}MB`,
    `  dsh node WS=${dshNode ? dshNode.wsKB / 1024 .toFixed(0) : '?'}MB${dshNode ? ` (pid=${dshNode.pid})` : ''}${dshNode ? ` 子进程=${tree.filter(t => t.pid !== mainPid && t !== dshNode).length}个` : ''}`,
    `  全部进程树: ${tree.map(t => `${t.name.split('.')[0]}[${t.depth}]${(t.wsKB / 1024).toFixed(0)}M`).join(' ')}`,
    `  主进程WS=${(main.appMetrics.find(m => m.type === 'Browser')?.memory?.workingSetSize / 1024 ?? 0).toFixed(0)}MB  dsh+pty+node合计=${(tree.filter(t => t.depth > 0).reduce((s, t) => s + t.wsKB, 0) / 1024).toFixed(0)}MB`,
  ]
  console.log(line.join('\n'))
  return { main, renderer, tree }
}

// ─── 主流程 ───
const electronExe = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
console.log('启动 Electron(独立 user-data-dir)...')
const proc = spawn(electronExe, [
  `--remote-debugging-port=${cdpPort}`,
  '--enable-precise-memory-info',
  '--no-sandbox',
  `--user-data-dir=${userDataDir}`,
  projectRoot, workspace
], { stdio: 'pipe', env: { ...process.env, ELECTRON_IS_DEV: '0' } })
proc.stderr?.on('data', d => { const s = d.toString(); if (/ERROR|Unhandled/i.test(s)) process.stderr.write('[app] ' + s) })

const cdp = await connectCDP(cdpPort)
console.log('CDP 已连接,等待 API 就绪...')
for (let i = 0; i < 30; i++) {
  try { if (await evalIn(cdp, `!!window.api?.perf?.snapshot`)) break } catch {}
  await new Promise(r => setTimeout(r, 1000))
}
// 等 dsh server 起 + session 建好 + DshView boot
await new Promise(r => setTimeout(r, 8000))

const mainPid = proc.pid
console.log(`electron main pid = ${mainPid}\n`)

await snapshot(cdp, mainPid, '阶段0: idle baseline')

// 克隆 4 个 session (Ctrl+N 在当前 session 上克隆)
for (let i = 0; i < 4; i++) {
  await evalIn(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))`)
  await new Promise(r => setTimeout(r, 3000))
  console.log(`  已克隆 ${i + 1} 个 session`)
}
await new Promise(r => setTimeout(r, 6000))
await snapshot(cdp, mainPid, '阶段1: +4 个克隆 session')

// 大终端输出: 聚焦 xterm 隐藏 textarea, 注入 node 命令输出 ~15MB
console.log('\n写入大终端输出 (15MB)...')
await evalIn(cdp, `(() => {
  const ta = document.querySelector('.xterm-helper-textarea') || document.querySelector('textarea[aria-label], textarea')
  if (!ta) return 'no textarea'
  ta.focus()
  return 'focused'
})()`)
await new Promise(r => setTimeout(r, 500))
await cdp.send('Input.insertText', { text: `node -e "process.stdout.write('x'.repeat(15*1024*1024))"\r` })
await new Promise(r => setTimeout(r, 12000))
await snapshot(cdp, mainPid, '阶段2: 大输出后')

// GC 后再采一次(看不可达对象是否被回收)
await evalIn(cdp, `(() => { try { window.gc?.() } catch {} return true })()`)
cdp.send('HeapProfiler.collectGarbage').catch(() => {})
await new Promise(r => setTimeout(r, 1500))
await snapshot(cdp, mainPid, '阶段3: GC 后')

proc.kill()
process.exit(0)