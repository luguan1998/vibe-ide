/**
 * 性能测试：连续点击 test/icon-test 目录下各类型文件时的 CPU 和内存占用
 *
 * 工作区固定为 test/icon-test（文件树根级直接列出全部测试文件），
 * 使用 CDP 鼠标注入模拟真实用户顺序点击 FileTab 文件项，
 * 触发完整的 DiffViewer + Monaco + OutlinePanel 渲染链路。
 *
 * 使用方式：
 *   npm run test:perf                   # 一条命令跑完：自动 build + 启动 + 测试 + 关闭
 *   node test/perf-file-switch.mjs      # 同上（已编译时跳过 build）
 *
 * 可选参数：
 *   --rounds=2     遍历全部文件的轮数（每轮顺序点击所有文件一次）
 *   --interval=300 每次点击间隔 ms
 */

import { spawn, execSync } from 'child_process'
import { join, resolve } from 'path'
import { existsSync, readdirSync, statSync, appendFileSync, readFileSync, mkdirSync } from 'fs'
import { cpus, tmpdir } from 'os'

const projectRoot = resolve(import.meta.dirname, '..')
const numCores = cpus().length

// ─── 参数 ───
const rounds = parseInt(process.argv.find(a => a.startsWith('--rounds'))?.split('=')[1] || '2', 10)
const intervalMs = parseInt(process.argv.find(a => a.startsWith('--interval'))?.split('=')[1] || '300', 10)
const workspace = join(projectRoot, 'test', 'icon-test')
const cdpPort = 9222
// 独立 user-data-dir：单实例锁按此目录区分，避免与正在运行的 dev 实例冲突
const perfUserDataDir = join(tmpdir(), 'vibe-ide-perf')
mkdirSync(perfUserDataDir, { recursive: true })

// ─── perf 日志（doc/perf-log.md 追加）───
const perfLogPath = join(projectRoot, 'doc', 'perf-log.md')

// tag = 最近 git tag，commit = 实际 HEAD（非 tag 指向的 commit），格式 tag+commit
function getTag() {
  let tag = 'unknown', commit = 'unknown'
  try { tag = execSync('git describe --tags --abbrev=0', { cwd: projectRoot }).toString().trim() } catch {}
  try { commit = execSync('git rev-parse --short HEAD', { cwd: projectRoot }).toString().trim() } catch {}
  if (!tag || tag.startsWith('fatal') || tag === 'unknown') {
    try { tag = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version } catch {}
  }
  return `${tag}+${commit}`
}

function nowStamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function appendPerfRow(fields) {
  try {
    if (!existsSync(perfLogPath) || statSync(perfLogPath).size === 0) {
      mkdirSync(join(projectRoot, 'doc'), { recursive: true })
      appendFileSync(perfLogPath, `# Perf 测试日志\n\n| 时间 | tag | 结果 | 耗时avg | 主RSSΔ | 渲染JSHeapΔ | 总内存Δ | 主CPUavg | 渲染CPUavg |\n|------|-----|------|---------|--------|-----------|---------|----------|------------|\n`, 'utf8')
    }
    appendFileSync(perfLogPath, `| ${fields.join(' | ')} |\n`, 'utf8')
  } catch {}
}

function appendPerfError(msg) {
  appendPerfRow([nowStamp(), getTag(), `ERROR: ${String(msg).slice(0, 60)}`, '-', '-', '-', '-', '-', '-'])
}

// ─── CDP 连接 ───
async function connectCDP(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await resp.json()
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('renderer'))
    || targets.find(t => t.type === 'page' && !t.url.includes('devtools'))
  if (!pageTarget) throw new Error('No renderer target')
  const wsUrl = pageTarget.webSocketDebuggerUrl
  if (!wsUrl) throw new Error('No WebSocket URL')

  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
    setTimeout(() => reject(new Error('WS connect timeout')), 5000)
  })

  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data)
      pending.delete(data.id)
    }
  }

  function send(method, params = {}) {
    const msgId = ++id
    return new Promise((resolve, reject) => {
      pending.set(msgId, resolve)
      ws.send(JSON.stringify({ id: msgId, method, params }))
      setTimeout(() => { pending.delete(msgId); reject(new Error(`CDP ${method} timeout`)) }, 10000)
    })
  }

  return { send, close: () => ws.close() }
}

async function evalInRenderer(cdp, expression) {
  const resp = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  const evalResult = resp.result
  if (evalResult?.exceptionDetails) {
    throw new Error(`Eval error: ${evalResult.exceptionDetails.text || JSON.stringify(evalResult.exceptionDetails)}`)
  }
  return evalResult?.result?.value
}

// ─── CDP 鼠标注入 ───
async function mouseClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1
  })
}

// ─── 切换到 File tab ───
// RightPanel 在 sessions.length > 0 时才渲染（isWelcome 时整栏不挂载），
// 而会话由 startup:openPath IPC 在 did-finish-load + 800ms 后异步创建，
// 早于 waitForAPI 返回。故此处需轮询等待按钮出现，而非立即判定失败。
async function findFileTabButton(cdp) {
  return evalInRenderer(cdp, `
    (() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const span = btn.querySelector('span');
        if (span && span.textContent === 'File') {
          const r = btn.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        if (btn.title === 'File') {
          const r = btn.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    })()
  `)
}

async function switchToFileTab(cdp) {
  let rect = null
  for (let i = 0; i < 40; i++) {
    rect = await findFileTabButton(cdp)
    if (rect) break
    await new Promise(r => setTimeout(r, 500))
  }
  if (!rect) throw new Error('File tab button not found')
  await mouseClick(cdp, rect.x, rect.y)
  await new Promise(r => setTimeout(r, 500))
}

// ─── 获取可见文件项及其坐标 ───
// FileTreeItem: 目录项第一个子元素是 chevron SVG (viewBox="0 0 16 16" + path "M4 6l4 4 4-4")
//               文件项第一个子元素是 <span class="w-3 shrink-0"> (空 span 占位)
async function getFileItems(cdp) {
  const items = await evalInRenderer(cdp, `
    (() => {
      // 找文件树容器：包含 div.cursor-pointer 子项的容器
      // 不能靠固定 class 名组合，Tailwind 生产构建顺序可能不同
      let fileContainer = null;
      const allDivs = document.querySelectorAll('div');
      for (const d of allDivs) {
        // 容器特征：直接子 div 中有 cursor-pointer 的行
        const directChildren = d.querySelectorAll(':scope > div');
        const hasCursorPointer = Array.from(directChildren).some(c =>
          c.classList.contains('cursor-pointer') &&
          c.querySelector('span.w-3.shrink-0, svg[viewBox="0 0 16 16"]')
        );
        if (hasCursorPointer && !fileContainer) {
          // 还要确认这是文件树（不是其他 cursor-pointer 容器如 session panel）
          const firstRow = d.querySelector('div.cursor-pointer');
          if (firstRow && firstRow.getBoundingClientRect().x > 900) {
            // RightPanel 在屏幕右侧，x > 900
            fileContainer = d;
            break;
          }
        }
      }
      if (!fileContainer) {
        // 降级：找所有 cursor-pointer 的 div，过滤出 x > 900 的
        const allRows = document.querySelectorAll('div.cursor-pointer');
        const results = [];
        for (const row of allRows) {
          const rect = row.getBoundingClientRect();
          if (rect.height === 0) continue;
          const firstChild = row.children[0];
          const isFile = (firstChild?.tagName === 'SPAN' || firstChild?.tagName === 'span')
            && firstChild?.classList?.contains('w-3')
            && firstChild?.classList?.contains('shrink-0');
          if (!isFile) continue;
          let fileName = '';
          for (const child of row.children) {
            if ((child.tagName === 'SPAN' || child.tagName === 'span')
              && child.textContent
              && !child.classList?.contains('w-3')) {
              fileName = child.textContent.trim();
              break;
            }
          }
          if (!fileName) fileName = row.textContent?.trim()?.slice(0, 40) || '';
          results.push({
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            name: fileName.slice(0, 40)
          });
        }
        return results;
      }

      const allRows = fileContainer.querySelectorAll('div.cursor-pointer');
      const results = [];
      for (const row of allRows) {
        const rect = row.getBoundingClientRect();
        if (rect.height === 0) continue;
        const firstChild = row.children[0];
        const isFile = (firstChild?.tagName === 'SPAN' || firstChild?.tagName === 'span')
          && firstChild?.classList?.contains('w-3')
          && firstChild?.classList?.contains('shrink-0');
        if (!isFile) continue;
        let fileName = '';
        for (const child of row.children) {
          if ((child.tagName === 'SPAN' || child.tagName === 'span')
            && child.textContent
            && !child.classList?.contains('w-3')) {
            fileName = child.textContent.trim();
            break;
          }
        }
        if (!fileName) fileName = row.textContent?.trim()?.slice(0, 40) || '';
        results.push({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          name: fileName.slice(0, 40)
        });
      }
      return results;
    })()
  `)
  return items || []
}

// ─── 等待 API 就绪 ───
async function waitForAPI(cdp) {
  for (let i = 0; i < 30; i++) {
    try {
      const hasApi = await evalInRenderer(cdp, `!!window.api?.perf?.snapshot`)
      if (hasApi) {
        console.log('API 就绪')
        return true
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

function fmtMB(bytes) { return (bytes / 1024 / 1024).toFixed(1) }

// ─── 采集快照 ───
async function takeSnapshot(cdp) {
  const main = await evalInRenderer(cdp, `window.api.perf.snapshot()`)
  const rendererMem = await evalInRenderer(cdp, `
    performance.memory
      ? { usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit }
      : null
  `)

  // 从 app.getAppMetrics() 提取各进程 CPU 信息
  // Electron 进程类型：Browser, GPU, Tab (渲染进程), Utility
  // 注意：type 是 "Tab" 不是 "renderer"
  // percentCPUUsage 是瞬时值（空闲时=0），cumulativeCPUUsage 是累计值（可算 delta）
  // 找最大的 Tab 进程（主窗口渲染进程，另一个可能是 DevTools）
  const tabMetrics = (main.appMetrics || [])
    .filter(m => m.type === 'Tab')
    .sort((a, b) => b.memory?.workingSetSize - a.memory?.workingSetSize)
  const rendererMetric = tabMetrics[0] || null  // 最大的 Tab 是主渲染进程
  const gpuMetric = (main.appMetrics || []).find(m => m.type === 'GPU')

  return {
    timestamp: main.timestamp,
    main: {
      rss: main.memory.rss,
      heapUsed: main.memory.heapUsed,
      heapTotal: main.memory.heapTotal,
      cpuUser: main.cpu.user,
      cpuSystem: main.cpu.system,
    },
    renderer: rendererMem ? {
      usedJSHeap: rendererMem.usedJSHeapSize,
      totalJSHeap: rendererMem.totalJSHeapSize,
      jsHeapLimit: rendererMem.jsHeapSizeLimit,
    } : null,
    rendererCumulativeCpu: rendererMetric?.cpu?.cumulativeCPUUsage ?? null,
    rendererWorkingSetKB: rendererMetric?.memory?.workingSetSize ?? null,
    gpuCumulativeCpu: gpuMetric?.cpu?.cumulativeCPUUsage ?? null,
    gpuWorkingSetKB: gpuMetric?.memory?.workingSetSize ?? null,
  }
}

function computeDelta(before, after) {
  const wallMs = after.timestamp - before.timestamp
  const mainCpuUserUs = after.main.cpuUser - before.main.cpuUser
  const mainCpuSystemUs = after.main.cpuSystem - before.main.cpuSystem
  const mainCpuTotalUs = mainCpuUserUs + mainCpuSystemUs
  const mainCpuPercent = wallMs > 0 ? (mainCpuTotalUs / 1000 / wallMs * 100) : 0

  // 渲染/GPU 进程 CPU%：cumulativeCPUUsage 是所有线程 CPU 时间之和（秒）
  // 除以核数才能得到单核百分比（跟 Task Manager 一致，最大 100%）
  const rendererCpuPercent = before.rendererCumulativeCpu != null && after.rendererCumulativeCpu != null && wallMs > 0
    ? ((after.rendererCumulativeCpu - before.rendererCumulativeCpu) / (wallMs / 1000) * 100 / numCores) : null
  const gpuCpuPercent = before.gpuCumulativeCpu != null && after.gpuCumulativeCpu != null && wallMs > 0
    ? ((after.gpuCumulativeCpu - before.gpuCumulativeCpu) / (wallMs / 1000) * 100 / numCores) : null

  return {
    wallMs,
    mainRssDelta: after.main.rss - before.main.rss,
    mainHeapDelta: after.main.heapUsed - before.main.heapUsed,
    mainCpuUserMs: mainCpuUserUs / 1000,
    mainCpuSystemMs: mainCpuSystemUs / 1000,
    mainCpuPercent,
    rendererUsedHeapDelta: after.renderer && before.renderer
      ? after.renderer.usedJSHeap - before.renderer.usedJSHeap : null,
    rendererCpuPercent,
    rendererWorkingSetKB: after.rendererWorkingSetKB,
    gpuCpuPercent,
    gpuWorkingSetKB: after.gpuWorkingSetKB,
    totalWorkingSetMB: (after.main.rss / 1024 / 1024) + (after.rendererWorkingSetKB ? after.rendererWorkingSetKB / 1024 : 0) + (after.gpuWorkingSetKB ? after.gpuWorkingSetKB / 1024 : 0),
  }
}

// ─── 主流程 ───
async function main() {
  console.log('=== 性能测试：CDP 鼠标注入文件切换 ===')
  console.log(`rounds=${rounds} interval=${intervalMs}ms`)

  // 1. 确保编译产物存在
  const outMain = join(projectRoot, 'out', 'main', 'index.js')
  if (!existsSync(outMain)) {
    console.log('未编译，先 build...')
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' })
  }

  // 2. 启动 Electron（带 CDP），工作区固定为 icon-test
  let cdp, proc
  try {
    console.log(`尝试连接已有应用 (CDP ${cdpPort})...`)
    cdp = await connectCDP(cdpPort)
    // 校验已连接应用的工作区是否为 icon-test，不匹配则关闭重启
    let wsMatch = false
    try {
      const cur = await evalInRenderer(cdp, `window.api.workspace.current()`)
      const p = cur?.path ? String(cur.path) : (cur ? String(cur) : '')
      wsMatch = p.replace(/\\/g, '/').endsWith('test/icon-test')
      if (!wsMatch) console.log(`  已有应用工作区不匹配: ${p || '(空)'}`)
    } catch (e) { console.log(`  无法读取工作区: ${e.message}`) }
    if (wsMatch) {
      console.log('已连接到运行中的应用（工作区匹配 icon-test）')
      proc = null
    } else {
      console.log('  关闭已有应用，将以 icon-test 工作区重启...')
      try { await cdp.send('Browser.close') } catch {}
      cdp.close()
      cdp = null
      await new Promise(r => setTimeout(r, 2000))
    }
  } catch {
    cdp = null
  }

  if (!cdp) {
    console.log(`启动 Electron（工作区: ${workspace}）...`)
    const electronExe = process.platform === 'win32'
      ? join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
      : process.platform === 'darwin'
        ? join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
        : join(projectRoot, 'node_modules', 'electron', 'dist', 'electron')
    // app 路径必须是 projectRoot（含 package.json）；workspace 作为启动参数
    // 交由 main 进程 parseStartupPath 解析（取最后一个存在的位置参数）
    proc = spawn(electronExe, [
      `--remote-debugging-port=${cdpPort}`,
      '--enable-precise-memory-info',
      '--no-sandbox',
      `--user-data-dir=${perfUserDataDir}`,
      projectRoot,
      workspace
    ], { stdio: 'pipe', detached: false, env: { ...process.env, ELECTRON_IS_DEV: '0' } })

    proc.stderr?.on('data', d => {
      const s = d.toString()
      if (s.includes('ERROR') || s.includes('Unhandled')) process.stderr.write(d)
    })

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000))
      try {
        cdp = await connectCDP(cdpPort)
        console.log('应用已启动')
        break
      } catch {
        if (i === 29) { console.error('启动超时'); appendPerfError('启动超时'); proc.kill(); process.exit(1) }
      }
    }
  }

  // 3. 等待 API 就绪
  console.log('等待 API 就绪...')
  const ready = await waitForAPI(cdp)
  if (!ready) {
    console.error('API 加载超时')
    appendPerfError('API 加载超时')
    cdp.close(); proc?.kill(); process.exit(1)
  }

  // 4. 切换到 File tab
  console.log('切换到 File tab...')
  await switchToFileTab(cdp)

  // 5. 等待文件树渲染并收集文件项
  console.log('等待文件树加载...')
  let fileItems = []
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000))
    fileItems = await getFileItems(cdp)
    console.log(`  尝试 ${i + 1}: 找到 ${fileItems.length} 个文件项`)
    if (fileItems.length >= 2) break
  }

  if (fileItems.length < 2) {
    console.error(`需要至少 2 个可点击的文件项，当前只有 ${fileItems.length} 个`)
    appendPerfError(`文件项不足:${fileItems.length}`)
    cdp.close(); proc?.kill(); process.exit(1)
  }
  console.log(`找到 ${fileItems.length} 个可点击文件项`)

  // 7. 基线快照
  const baseline = await takeSnapshot(cdp)
  console.log(`\n基线:`)
  console.log(`  主进程: RSS=${fmtMB(baseline.main.rss)}MB heap=${fmtMB(baseline.main.heapUsed)}MB`)
  if (baseline.renderer) {
    console.log(`  渲染进程: JSHeap=${fmtMB(baseline.renderer.usedJSHeap)}MB / ${fmtMB(baseline.renderer.totalJSHeap)}MB`)
  }

  // 7. 连续点击测试：顺序遍历所有 icon-test 文件，循环 rounds 轮
  const allBefore = []
  const allAfter = []
  const allDeltas = []

  const totalClicks = rounds * fileItems.length
  console.log(`\n开始连续点击 ${fileItems.length} 个文件，${rounds} 轮共 ${totalClicks} 次点击...`)
  console.log('─'.repeat(90))

  for (let i = 0; i < totalClicks; i++) {
    const item = fileItems[i % fileItems.length]
    const pass = Math.floor(i / fileItems.length) + 1
    const stepInPass = (i % fileItems.length) + 1

    const before = await takeSnapshot(cdp)

    // 鼠标注入点击文件项
    await mouseClick(cdp, item.x, item.y)

    // 等待 Monaco 渲染完成
    await new Promise(r => setTimeout(r, 400))

    const after = await takeSnapshot(cdp)
    const delta = computeDelta(before, after)

    allBefore.push(before)
    allAfter.push(after)
    allDeltas.push(delta)

    const mainCpu = `${delta.mainCpuPercent.toFixed(1)}%`
    const rHeap = after.renderer ? fmtMB(after.renderer.usedJSHeap) : 'N/A'
    const rCpu = delta.rendererCpuPercent != null ? `${delta.rendererCpuPercent.toFixed(1)}%` : 'N/A'
    const gpuCpu = delta.gpuCpuPercent != null ? `${delta.gpuCpuPercent.toFixed(1)}%` : 'N/A'

    console.log(
      `  [${i + 1}/${totalClicks}] 轮${pass} ${stepInPass}/${fileItems.length} ${item.name || `item@(${item.x.toFixed(0)},${item.y.toFixed(0)})`} → ${delta.wallMs}ms | ` +
      `主cpu=${mainCpu} 渲染cpu=${rCpu} GPUcpu=${gpuCpu} | ` +
      `主RSS=${fmtMB(after.main.rss)}MB 渲染JSHeap=${rHeap}MB 总内存=${delta.totalWorkingSetMB.toFixed(0)}MB`
    )

    await new Promise(r => setTimeout(r, intervalMs))
  }

  // 8. 最终快照
  const final = await takeSnapshot(cdp)
  console.log('─'.repeat(90))
  console.log(`\n最终:`)
  console.log(`  主进程: RSS=${fmtMB(final.main.rss)}MB heap=${fmtMB(final.main.heapUsed)}MB`)
  if (final.renderer) {
    console.log(`  渲染进程: JSHeap=${fmtMB(final.renderer.usedJSHeap)}MB / ${fmtMB(final.renderer.totalJSHeap)}MB`)
  }

  // 9. 统计
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length
  const max = arr => Math.max(...arr)
  const min = arr => Math.min(...arr)

  const wallTimes = allDeltas.map(d => d.wallMs)
  const mainCpuPcts = allDeltas.map(d => d.mainCpuPercent)
  const mainRss = allAfter.map(s => s.main.rss)
  const mainHeap = allAfter.map(s => s.main.heapUsed)
  const rendererHeap = allAfter.map(s => s.renderer?.usedJSHeap).filter(v => v != null)

  console.log('\n=== 统计报告 ===')
  console.log(`切换次数: ${allDeltas.length}`)
  console.log()
  console.log('── 主进程 ──')
  console.log(`  耗时:     avg=${avg(wallTimes).toFixed(0)}ms max=${max(wallTimes)}ms min=${min(wallTimes)}ms`)
  console.log(`  CPU 占用: avg=${avg(mainCpuPcts).toFixed(1)}% peak=${max(mainCpuPcts).toFixed(1)}%`)
  console.log(`  RSS:      baseline=${fmtMB(baseline.main.rss)}MB avg=${fmtMB(avg(mainRss))}MB peak=${fmtMB(max(mainRss))}MB final=${fmtMB(final.main.rss)}MB delta=${fmtMB(final.main.rss - baseline.main.rss)}MB`)
  console.log(`  Heap:     baseline=${fmtMB(baseline.main.heapUsed)}MB avg=${fmtMB(avg(mainHeap))}MB peak=${fmtMB(max(mainHeap))}MB final=${fmtMB(final.main.heapUsed)}MB delta=${fmtMB(final.main.heapUsed - baseline.main.heapUsed)}MB`)

  if (rendererHeap.length > 0) {
    console.log()
    console.log('── 渲染进程 ──')
    console.log(`  JSHeap:   baseline=${fmtMB(baseline.renderer.usedJSHeap)}MB avg=${fmtMB(avg(rendererHeap))}MB peak=${fmtMB(max(rendererHeap))}MB final=${fmtMB(final.renderer.usedJSHeap)}MB delta=${fmtMB(final.renderer.usedJSHeap - baseline.renderer.usedJSHeap)}MB`)
    const rendererCpuVals = allDeltas.map(d => d.rendererCpuPercent).filter(v => v != null)
    if (rendererCpuVals.length > 0) {
      console.log(`  CPU 占用: avg=${avg(rendererCpuVals).toFixed(1)}% peak=${max(rendererCpuVals).toFixed(1)}% (app.getAppMetrics)`)
    }
  }

  const gpuCpuVals = allDeltas.map(d => d.gpuCpuPercent).filter(v => v != null)
  if (gpuCpuVals.length > 0) {
    console.log()
    console.log('── GPU 进程 ──')
    console.log(`  CPU 占用: avg=${avg(gpuCpuVals).toFixed(1)}% peak=${max(gpuCpuVals).toFixed(1)}%`)
  }

  // 总内存（所有进程 workingSet 之和）
  const totalMemVals = allDeltas.map(d => d.totalWorkingSetMB)
  const baselineTotalMB = (baseline.main.rss / 1024 / 1024) + (baseline.rendererWorkingSetKB ? baseline.rendererWorkingSetKB / 1024 : 0) + (baseline.gpuWorkingSetKB ? baseline.gpuWorkingSetKB / 1024 : 0)
  const finalTotalMB = (final.main.rss / 1024 / 1024) + (final.rendererWorkingSetKB ? final.rendererWorkingSetKB / 1024 : 0) + (final.gpuWorkingSetKB ? final.gpuWorkingSetKB / 1024 : 0)
  console.log()
  console.log('── 总内存（所有进程）──')
  console.log(`  WorkingSet: baseline=${baselineTotalMB.toFixed(0)}MB avg=${avg(totalMemVals).toFixed(0)}MB peak=${max(totalMemVals).toFixed(0)}MB final=${finalTotalMB.toFixed(0)}MB delta=${(finalTotalMB - baselineTotalMB).toFixed(0)}MB`)

  // 10. 判定
  const rssGrowth = final.main.rss - baseline.main.rss
  const rendererHeapGrowth = final.renderer ? final.renderer.usedJSHeap - baseline.renderer.usedJSHeap : 0
  const totalMemGrowthMB = finalTotalMB - baselineTotalMB
  const avgTime = avg(wallTimes)
  const avgMainCpu = avg(mainCpuPcts)
  const rendererCpuVals = allDeltas.map(d => d.rendererCpuPercent).filter(v => v != null)
  const avgRendererCpu = rendererCpuVals.length > 0 ? avg(rendererCpuVals) : null

  const passRss = rssGrowth < 150 * 1024 * 1024
  const passHeap = rendererHeapGrowth < 80 * 1024 * 1024
  const passTotalMem = totalMemGrowthMB < 500
  const passTime = avgTime < 500
  const passMainCpu = avgMainCpu < 50
  const passRendererCpu = avgRendererCpu == null || avgRendererCpu < 50

  console.log()
  console.log('── 判定 ──')
  console.log(`  主RSS 增长: ${fmtMB(rssGrowth)}MB ${passRss ? 'PASS' : 'FAIL'} (<150MB)`)
  if (final.renderer) {
    console.log(`  渲染JSHeap 增长: ${fmtMB(rendererHeapGrowth)}MB ${passHeap ? 'PASS' : 'FAIL'} (<80MB)`)
  }
  console.log(`  总内存增长: ${totalMemGrowthMB.toFixed(0)}MB ${passTotalMem ? 'PASS' : 'FAIL'} (<500MB)`)
  console.log(`  平均耗时: ${avgTime.toFixed(0)}ms ${passTime ? 'PASS' : 'FAIL'} (<500ms)`)
  console.log(`  主进程CPU: ${avgMainCpu.toFixed(1)}% ${passMainCpu ? 'PASS' : 'FAIL'} (<50%)`)
  if (avgRendererCpu != null) {
    console.log(`  渲染进程CPU: ${avgRendererCpu.toFixed(1)}% ${passRendererCpu ? 'PASS' : 'FAIL'} (<50%)`)
  }

  const allPass = passRss && passHeap && passTotalMem && passTime && passMainCpu && passRendererCpu
  console.log(allPass ? '\n✅ 总体通过' : '\n❌ 总体未通过')

  appendPerfRow([
    nowStamp(),
    getTag(),
    allPass ? 'PASS' : 'FAIL',
    `${avgTime.toFixed(0)}ms`,
    `${fmtMB(rssGrowth)}MB`,
    final.renderer ? `${fmtMB(rendererHeapGrowth)}MB` : '-',
    `${totalMemGrowthMB.toFixed(0)}MB`,
    `${avgMainCpu.toFixed(1)}%`,
    avgRendererCpu != null ? `${avgRendererCpu.toFixed(1)}%` : '-',
  ])

  // 清理
  cdp.close()
  if (proc) proc.kill()

  process.exit(allPass ? 0 : 1)
}

main().catch(err => { appendPerfError(err.message || err); console.error('测试失败:', err); process.exit(1) })