/**
 * 探针：网状对话（Branch Graph）主进程链路
 *
 * 直接对运行中的 app 调 window.api.ai.sessionGraph，
 * 用一个真实的分叉组验证：IPC 注册 → projectDir 解析 → 组发现 → uuid 合并 → 建树。
 * 不创建会话、不落盘（只读）。
 *
 * 用法：node test/probe-branch-graph.mjs [--attach=<port>]
 */

import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'

const projectRoot = resolve(import.meta.dirname, '..')
const cdpPort = 9227
const userDataDir = join(tmpdir(), 'vibe-ide-probe-graph')
mkdirSync(userDataDir, { recursive: true })

const CLAUDE_CONFIG = 'C:/Users/luguan/.claude'
const WORKSPACE = projectRoot.replace(/\\/g, '/')

// 预置的分叉组（4 个文件共享 uuid 前缀，最长那个含 11 轮）
const GROUP_ROOT = '8889d87f-de9d-404d-9975-db0fdfd52735'
const SMALL_GROUP = '8ca78e8d-79df-4b6a-87c4-bce6929c2202'

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
    else if (data.method === 'Runtime.consoleAPICalled') logs.push(data.params.args.map(a => a.value ?? a.description ?? '').join(' '))
    else if (data.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (data.params.exceptionDetails?.exception?.description || data.params.exceptionDetails?.text))
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id
    pending.set(msgId, res)
    ws.send(JSON.stringify({ id: msgId, method, params }))
    setTimeout(() => { pending.delete(msgId); rej(new Error(`CDP ${method} timeout`)) }, 60000)
  })
  return { send, close: () => ws.close(), logs }
}

async function evalIn(cdp, expression) {
  const resp = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (resp.result?.exceptionDetails) throw new Error(resp.result.exceptionDetails.text + ' ' + (resp.result.exceptionDetails.exception?.description || ''))
  return resp.result?.result?.value
}

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  return ok
}

async function main() {
  const electronExe = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  const attachPort = parseInt(process.argv.find(a => a.startsWith('--attach='))?.split('=')[1] || '0', 10)

  let proc = null
  let cdp = null
  if (attachPort) {
    cdp = await connectCDP(attachPort)
  } else {
    const env = { ...process.env, ELECTRON_IS_DEV: '0' }
    delete env.ELECTRON_RENDERER_URL
    proc = spawn(electronExe, [
      `--remote-debugging-port=${cdpPort}`, '--no-sandbox',
      `--user-data-dir=${userDataDir}`, projectRoot, WORKSPACE,
    ], { stdio: 'pipe', env })
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 1000))
      try { cdp = await connectCDP(cdpPort); break } catch {}
    }
    if (!cdp) { console.error('启动超时'); proc?.kill(); process.exit(1) }
  }
  await cdp.send('Runtime.enable')
  for (let i = 0; i < 30; i++) {
    if (await evalIn(cdp, '!!window.api?.ai').catch(() => false)) break
    await new Promise(r => setTimeout(r, 500))
  }

  let failures = 0
  const apiOk = await evalIn(cdp, `typeof window.api.ai.sessionGraph === 'function' && typeof window.api.ai.forkTurn === 'function'`)
  if (!check('preload 暴露 sessionGraph / forkTurn', apiOk)) failures++

  const bogus = await evalIn(cdp, `window.api.ai.sessionGraph('nope-not-a-session', '${WORKSPACE}', '${CLAUDE_CONFIG}')`)
  if (!check('未知会话返回 null 且不抛错', bogus === null, JSON.stringify(bogus))) failures++

  const g = await evalIn(cdp, `window.api.ai.sessionGraph('${GROUP_ROOT}', '${WORKSPACE}', '${CLAUDE_CONFIG}')`)
  if (!g) {
    check('真实分叉组建树', false, '返回 null')
    failures++
  } else {
    const ids = new Set(g.nodes.map(n => n.id))
    const roots = g.nodes.filter(n => !n.parentId)
    const depthOk = g.nodes.every(n => !n.parentId || ids.has(n.parentId))
    const maxDepth = Math.max(...g.nodes.map(n => n.depth))
    failures += check('节点数 = 11', g.nodes.length === 11, `实际 ${g.nodes.length}`) ? 0 : 1
    failures += check('分支数 = 4', g.branches.length === 4, g.branches.map(b => b.claudeSessionId.slice(0, 8) + ':' + b.turnCount).join(' ')) ? 0 : 1
    failures += check('唯一根节点', roots.length === 1, roots.map(r => r.title.slice(0, 26)).join(' | ')) ? 0 : 1
    failures += check('parentId 全部可解析', depthOk) ? 0 : 1
    failures += check('depth 单调（0..' + maxDepth + '）', maxDepth === g.nodes.length - 1, 'depths=' + g.nodes.map(n => n.depth).join(',')) ? 0 : 1
    failures += check('每条分支 tip 都落到节点上', g.branches.every(b => b.tipNodeId && ids.has(b.tipNodeId))) ? 0 : 1
    const tipNodes = g.nodes.filter(n => n.tipBranchIds.length > 0)
    failures += check('tipBranchIds 覆盖 4 条分支', new Set(tipNodes.flatMap(n => n.tipBranchIds)).size === 4, tipNodes.map(n => n.title.slice(0, 18) + ':' + n.tipBranchIds.length).join(' | ')) ? 0 : 1
    failures += check('每轮带 fork 定位信息', g.nodes.every(n => n.fork?.claudeSessionId && typeof n.fork.content === 'string' && typeof n.fork.occurrence === 'number')) ? 0 : 1
    failures += check('active 命中当前会话路径', g.nodes.filter(n => n.active).length === 11 && g.activeClaudeSessionId === GROUP_ROOT) ? 0 : 1
    failures += check('hasReply 必有 preview', g.nodes.every(n => !n.hasReply || n.preview.length > 0)) ? 0 : 1
    console.log('   节点：' + g.nodes.map(n => `[${n.depth}]${n.title.slice(0, 14)}${n.preview ? '' : '(空)'}`).join(' → '))
  }

  const g2 = await evalIn(cdp, `window.api.ai.sessionGraph('${SMALL_GROUP}', '${WORKSPACE}', '${CLAUDE_CONFIG}')`)
  if (!g2) {
    check('第二组（含真分叉点）', false, '返回 null')
    failures++
  } else {
    const tipNode = g2.nodes.find(n => n.tipBranchIds.length > 0 && n.branchIds.length > 1)
    failures += check('短组节点数 = 3 / 分支 2', g2.nodes.length === 3 && g2.branches.length === 2, `${g2.nodes.length}/${g2.branches.length}`) ? 0 : 1
    failures += check('存在既是 tip 又在多条分支上的节点', !!tipNode, tipNode ? `"${tipNode.title.slice(0, 20)}" tip=${tipNode.tipBranchIds.length} branches=${tipNode.branchIds.length}` : '无') ? 0 : 1
  }

  const perf = await evalIn(cdp, `(async () => { const t = performance.now(); await window.api.ai.sessionGraph('${GROUP_ROOT}', '${WORKSPACE}', '${CLAUDE_CONFIG}'); return Math.round(performance.now() - t) })()`)
  check('单次建树耗时 < 1500ms', perf < 1500, perf + 'ms')

  const errs = cdp.logs.filter(l => l.includes('[EXC]') || l.toLowerCase().includes('uncaught'))
  check('渲染进程无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' ; '))

  console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`)
  cdp.close()
  proc?.kill()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('探针异常:', e.message); process.exit(1) })
